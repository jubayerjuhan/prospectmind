import Prospect from '../models/Prospect.js';
import { queuePipelineRun } from '../services/pipeline/queue.js';
import { sendOutreachEmail } from '../services/resend/emailService.js';
import { generateOutreachMessages } from '../services/pipeline/outreach.js';
import { buildProspectFilter } from '../utils/buildProspectFilter.js';
import { checkCampaignGate } from '../utils/campaignGate.js';

const ACTIVE_PIPELINE_STATUSES = ['discovering', 'enriching', 'classifying', 'scoring', 'generating'];

// GET /api/prospects
export const getProspects = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, priority, search } = req.query;
    const orgId = req.organization._id;
    const filter = buildProspectFilter({ organizationId: orgId, status, priority, search });

    const [prospects, total] = await Promise.all([
      Prospect.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .select('-messages'),
      Prospect.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: prospects,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/prospects/:id
export const getProspect = async (req, res) => {
  try {
    const prospect = await Prospect.findOne({
      _id: req.params.id,
      organization: req.organization._id,
    });
    if (!prospect) return res.status(404).json({ success: false, message: 'Prospect not found.' });
    res.json({ success: true, data: prospect });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospects
export const createProspect = async (req, res) => {
  try {
    if (!req.organization.canAddProspect()) {
      return res.status(403).json({
        success: false,
        message: `You've reached your plan limit (${req.organization.getProspectLimit()} prospects/month). Upgrade to add more.`,
        code: 'LIMIT_REACHED',
      });
    }

    const prospect = await Prospect.create({
      ...req.body,
      organization: req.organization._id,
      createdBy: req.user._id,
    });

    // Kick off pipeline async (don't await)
    queuePipelineRun(prospect._id).catch((err) =>
      console.error(`Queue error for ${prospect._id}:`, err.message)
    );

    res.status(201).json({ success: true, data: prospect });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/prospects/:id
export const updateProspect = async (req, res) => {
  try {
    const EDITABLE_FIELDS = ['description', 'typeHint', 'rawEmail', 'rawLinkedin', 'rawX', 'rawTelegram', 'rawGithub'];
    const updates = {};

    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) {
        updates[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No editable fields provided.' });
    }

    const prospect = await Prospect.findOneAndUpdate(
      { _id: req.params.id, organization: req.organization._id },
      { $set: updates },
      { new: true }
    );

    if (!prospect) {
      return res.status(404).json({ success: false, message: 'Prospect not found.' });
    }

    res.json({ success: true, data: prospect });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospects/bulk
export const bulkCreateProspects = async (req, res) => {
  try {
    const { prospects } = req.body;
    if (!Array.isArray(prospects) || prospects.length === 0) {
      return res.status(400).json({ success: false, message: 'prospects array required.' });
    }

    const limit = req.organization.getProspectLimit();
    const used = req.organization.usage.prospectsThisMonth;
    const available = limit - used;

    if (available <= 0) {
      return res.status(403).json({ success: false, message: 'Monthly prospect limit reached.', code: 'LIMIT_REACHED' });
    }

    const toCreate = prospects.slice(0, available).map((p) => ({
      ...p,
      organization: req.organization._id,
      createdBy: req.user._id,
    }));

    const created = await Prospect.insertMany(toCreate);

    // Fire pipeline for each
    created.forEach((p) => {
      queuePipelineRun(p._id).catch((err) => console.error(`Queue error for ${p._id}:`, err.message))
    });

    res.status(201).json({
      success: true,
      data: { created: created.length, skipped: prospects.length - created.length },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospects/:id/retry
export const retryPipeline = async (req, res) => {
  try {
    const prospect = await Prospect.findOne({ _id: req.params.id, organization: req.organization._id });
    if (!prospect) return res.status(404).json({ success: false, message: 'Prospect not found.' });

    // Campaign gate check — block if prospect is in a campaign without settings
    const gate = await checkCampaignGate(prospect._id, req.organization._id);
    if (!gate.allowed) {
      return res.status(400).json({
        success: false,
        message: `Campaign "${gate.campaignName}" is missing required settings before the pipeline can run. Please fill in: ${gate.missingFields.join(', ')}.`,
        code: 'CAMPAIGN_SETTINGS_REQUIRED',
        campaignId: gate.campaignId,
        missingFields: gate.missingFields,
      });
    }

    await Prospect.findByIdAndUpdate(prospect._id, {
      pipelineStatus: 'pending',
      pipelineError: null,
      pipelinePaused: false,
      pipelinePausedAt: null,
    });
    queuePipelineRun(prospect._id).catch(console.error);

    res.json({ success: true, message: 'Pipeline restarted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospects/:id/pause
export const pausePipeline = async (req, res) => {
  try {
    const prospect = await Prospect.findOne({ _id: req.params.id, organization: req.organization._id });
    if (!prospect) return res.status(404).json({ success: false, message: 'Prospect not found.' });

    if (prospect.pipelineStatus === 'paused' || prospect.pipelinePaused) {
      return res.status(400).json({ success: false, message: 'Pipeline is already paused.' });
    }

    if (!ACTIVE_PIPELINE_STATUSES.includes(prospect.pipelineStatus)) {
      return res.status(400).json({ success: false, message: 'Only active pipeline runs can be paused.' });
    }

    await Prospect.findByIdAndUpdate(prospect._id, {
      pipelinePaused: true,
      pipelinePausedAt: new Date(),
    });

    res.json({
      success: true,
      message: 'Pause requested. The pipeline will pause after the current step finishes.',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospects/:id/resume
export const resumePipeline = async (req, res) => {
  try {
    const prospect = await Prospect.findOne({ _id: req.params.id, organization: req.organization._id });
    if (!prospect) return res.status(404).json({ success: false, message: 'Prospect not found.' });

    if (!prospect.pipelinePaused && prospect.pipelineStatus !== 'paused') {
      return res.status(400).json({ success: false, message: 'Pipeline is not paused.' });
    }

    // Campaign gate check — block if prospect is in a campaign without settings
    const gate = await checkCampaignGate(prospect._id, req.organization._id);
    if (!gate.allowed) {
      return res.status(400).json({
        success: false,
        message: `Campaign "${gate.campaignName}" is missing required settings before the pipeline can run. Please fill in: ${gate.missingFields.join(', ')}.`,
        code: 'CAMPAIGN_SETTINGS_REQUIRED',
        campaignId: gate.campaignId,
        missingFields: gate.missingFields,
      });
    }

    await Prospect.findByIdAndUpdate(prospect._id, {
      pipelinePaused: false,
      pipelinePausedAt: null,
      pipelineStatus: 'pending',
      pipelineError: null,
    });

    queuePipelineRun(prospect._id).catch((err) =>
      console.error(`Queue error for ${prospect._id}:`, err.message)
    );

    res.json({
      success: true,
      message: 'Pipeline resumed from the start.',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/prospects/:id/messages/:messageId/approve
export const approveMessage = async (req, res) => {
  try {
    const prospect = await Prospect.findOne({ _id: req.params.id, organization: req.organization._id });
    if (!prospect) return res.status(404).json({ success: false, message: 'Prospect not found.' });

    const message = prospect.messages.id(req.params.messageId);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found.' });

    message.status = 'approved';
    message.approvedBy = req.user._id;
    if (req.body.editedBody) message.editedBody = req.body.editedBody;

    await prospect.save();
    res.json({ success: true, data: message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospects/:id/messages/:messageId/send
export const sendMessage = async (req, res) => {
  try {
    const prospect = await Prospect.findOne({ _id: req.params.id, organization: req.organization._id });
    if (!prospect) return res.status(404).json({ success: false, message: 'Prospect not found.' });

    const message = prospect.messages.id(req.params.messageId);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found.' });

    if (message.status === 'sent') {
      return res.status(400).json({ success: false, message: 'Message has already been sent.' });
    }
    if (message.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Message must be approved before sending.' });
    }
    if (message.channel !== 'email') {
      return res.status(400).json({ success: false, message: 'Only email channel is supported for direct sending.' });
    }

    // Resolve recipient email
    const toEmail = prospect.enrichedProfile?.email || prospect.rawEmail;
    if (!toEmail) {
      return res.status(400).json({ success: false, message: 'No email address found for this prospect.' });
    }

    await sendOutreachEmail({
      to: toEmail,
      subject: message.subject || `A message for ${prospect.firstName}`,
      body: message.editedBody || message.body,
      fromName: req.user.name || 'ProspectMind',
    });

    message.status = 'sent';
    message.sentAt = new Date();
    await prospect.save();

    res.json({ success: true, message: 'Email sent.', data: message });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ success: false, message: 'Failed to send email.' });
  }
};

// DELETE /api/prospects/:id
export const archiveProspect = async (req, res) => {
  try {
    await Prospect.findOneAndUpdate(
      { _id: req.params.id, organization: req.organization._id },
      { isArchived: true }
    );
    res.json({ success: true, message: 'Prospect archived.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospects/:id/generate-messages
export const generateMessages = async (req, res) => {
  try {
    const prospect = await Prospect.findOne({ _id: req.params.id, organization: req.organization._id });
    if (!prospect) return res.status(404).json({ success: false, message: 'Prospect not found.' });

    if (prospect.messages && prospect.messages.length > 0) {
      return res.status(400).json({ success: false, message: 'Messages already generated for this prospect.' });
    }

    if (prospect.pipelineStatus !== 'ready') {
      return res.status(400).json({ success: false, message: 'Prospect pipeline must be ready before generating messages.' });
    }

    // Set status to generating
    prospect.pipelineStatus = 'generating';
    await prospect.save();

    const messages = await generateOutreachMessages(
      prospect,
      prospect.enrichedProfile,
      {
        roleClassification: prospect.roleClassification,
        primaryAngle: prospect.primaryAngle,
        secondaryAngle: prospect.secondaryAngle
      },
      {
        compatibilityScore: prospect.compatibilityScore,
        scoreLabel: prospect.scoreLabel,
        scoreReasoning: prospect.scoreReasoning,
        outreachPriority: prospect.outreachPriority,
        bestContactChannel: prospect.bestContactChannel
      }
    );

    prospect.messages = messages;
    prospect.pipelineStatus = 'ready';
    await prospect.save();

    res.json({ success: true, data: messages });
  } catch (error) {
    console.error('Generate messages error:', error);
    // Reset status on error
    await Prospect.findOneAndUpdate(
      { _id: req.params.id },
      { pipelineStatus: 'ready' }
    );
    res.status(500).json({ success: false, message: 'Failed to generate messages.' });
  }
};
