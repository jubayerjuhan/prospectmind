import Prospect from '../models/Prospect.js';
import ProspectList from '../models/ProspectList.js';
import Company from '../models/Company.js';
import { queuePipelineRun, cancelQueuedPipelineRun } from '../services/pipeline/queue.js';
import { pauseProspectRun } from '../services/pipeline/pauseControl.js';
import { ensureCompanyLink } from '../services/company/companyResolver.js';
import { sendOutreachEmail } from '../services/resend/emailService.js';
import { generateOutreachMessages } from '../services/pipeline/outreach.js';
import { buildProspectFilter } from '../utils/buildProspectFilter.js';
import { checkCampaignGate } from '../utils/campaignGate.js';

const ACTIVE_PIPELINE_STATUSES = ['pending', 'discovering', 'enriching', 'classifying', 'scoring', 'generating'];

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
        // pipelineActivity is a per-run narration only the detail page reads —
        // shipping it for every row would bloat the list payload for nothing.
        .select('-messages -pipelineActivity')
        // `company` is only the raw string the prospect was created with, and is
        // often empty for imported rows whose employer the pipeline resolved
        // afterwards. Populate the link so the list can name it.
        .populate('companyRef', 'name'),
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
    })
      // Without this the page only ever had the raw ObjectId, so it could not
      // show which company was linked — or that the link was unverified.
      .populate(
        'companyRef',
        'name domain website linkedinUrl industry size headquarters founded needsReview reviewReason aiAnalysis.summary aiAnalysis.source'
      )
      .lean();
    if (!prospect) return res.status(404).json({ success: false, message: 'Prospect not found.' });

    // The campaign this prospect belongs to, with the Personas it targets — the
    // detail page charts persona fit against this selection, not every persona
    // in the org. Same campaign-resolution rule the pipeline uses.
    const campaign = await ProspectList.findOne({
      organization: req.organization._id,
      type: 'manual',
      isArchived: false,
      prospects: prospect._id,
    })
      .select('name personas')
      .populate('personas', 'name')
      .lean();

    res.json({
      success: true,
      data: {
        ...prospect,
        campaign: campaign
          ? {
              _id: campaign._id,
              name: campaign.name,
              personas: (campaign.personas || []).map((p) => ({ _id: p._id, name: p.name })),
            }
          : null,
      },
    });
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

    await ensureCompanyLink(prospect);

    // Enrichment is opt-in: the prospect lands in 'not-started' and waits for an
    // explicit Start (POST /:id/start). Auto-running on create spent AI budget
    // and plan quota on rows the user had not even reviewed yet.
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

    // Reassigning the company by hand. Needed because the resolver flags a
    // prospect it cannot identify rather than guessing, and without an override
    // that flag would be a dead end. A manual link is never re-derived.
    if (req.body.companyRef !== undefined) {
      if (req.body.companyRef === null || req.body.companyRef === '') {
        Object.assign(updates, { companyRef: null, companyLinkSource: 'none', companyLinkConfidence: 'none' });
      } else {
        const target = await Company.findOne({ _id: req.body.companyRef, organization: req.organization._id }).lean();
        if (!target) {
          return res.status(404).json({ success: false, message: 'Company not found in this organization.' });
        }
        Object.assign(updates, {
          companyRef: target._id,
          company: target.name,
          companyLinkSource: 'manual',
          companyLinkConfidence: 'high',
          companyLinkedAt: new Date(),
          // Prose written against the previous company is now wrong.
          needsReenrichment: true,
          reenrichmentReason: 'company-reassigned-manually',
          outreachStale: true,
        });
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

    // insertMany bypasses document middleware, so the link has to be explicit.
    for (const p of created) await ensureCompanyLink(p).catch(() => null);

    // No pipeline run here — a bulk upload of hundreds of rows is exactly the
    // case where auto-enrichment used to burn a month's quota in one click.
    // They land in 'not-started'; the user starts them per prospect or per
    // campaign.

    res.status(201).json({
      success: true,
      data: { created: created.length, skipped: prospects.length - created.length },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospects/:id/start  ·  POST /api/prospects/:id/retry
//
// One handler for both: starting a 'not-started' prospect and re-running a
// finished or failed one are the same operation — gate, reset, enqueue. Only
// the wording the user sees differs.
export const startPipeline = async (req, res) => {
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

    const isFirstRun = prospect.pipelineStatus === 'not-started';

    await Prospect.findByIdAndUpdate(prospect._id, {
      pipelineStatus: 'pending',
      pipelineError: null,
      pipelinePaused: false,
      pipelinePausedAt: null,
    });
    queuePipelineRun(prospect._id).catch(console.error);

    res.json({
      success: true,
      message: isFirstRun ? 'Enrichment started.' : 'Pipeline restarted.',
    });
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

    if (prospect.pipelineStatus === 'not-started') {
      return res.status(400).json({ success: false, message: 'This prospect has not been started yet.' });
    }

    if (!ACTIVE_PIPELINE_STATUSES.includes(prospect.pipelineStatus)) {
      return res.status(400).json({ success: false, message: 'Only active pipeline runs can be paused.' });
    }

    // Queued but not yet running → stopped and marked paused immediately.
    // Already running → paused at the next layer boundary (see pauseControl.js).
    const { immediate } = await pauseProspectRun(prospect);

    res.json({
      success: true,
      immediate,
      message: immediate
        ? 'Paused.'
        : 'Pause requested. The pipeline will pause after the current step finishes.',
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
// DELETE /api/prospects/:id
//
// Archive, not a hard delete: the row keeps its enrichment history and can be
// recovered, but it leaves every view the user has. Three things have to happen
// together, or the deletion is only half done:
//   1. the flag, which is what every list query filters on
//   2. removal from every campaign's prospects[] — otherwise the campaign's
//      prospectCount keeps counting a prospect nobody can see
//   3. cancelling a queued run, so we don't spend AI budget enriching a
//      prospect the user just deleted
export const archiveProspect = async (req, res) => {
  try {
    const prospect = await Prospect.findOneAndUpdate(
      { _id: req.params.id, organization: req.organization._id },
      { isArchived: true, pipelinePaused: true, pipelinePausedAt: new Date() },
      { new: true }
    );
    if (!prospect) return res.status(404).json({ success: false, message: 'Prospect not found.' });

    await ProspectList.updateMany(
      { organization: req.organization._id, prospects: prospect._id },
      { $pull: { prospects: prospect._id } }
    );

    // Best-effort: a run already under way stops at its next layer boundary via
    // the pipelinePaused flag set above.
    await cancelQueuedPipelineRun(prospect._id).catch(() => false);

    res.json({ success: true, message: 'Prospect deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospects/:id/generate-messages
export const generateMessages = async (req, res) => {
  try {
    const prospect = await Prospect.findOne({ _id: req.params.id, organization: req.organization._id });
    if (!prospect) return res.status(404).json({ success: false, message: 'Prospect not found.' });

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
