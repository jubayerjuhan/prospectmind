import Prospect from '../models/Prospect.js';
import { runPipeline } from '../services/pipeline/runner.js';
import { sendOutreachEmail } from '../services/resend/emailService.js';

// GET /api/prospects
export const getProspects = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, priority, search } = req.query;
    const orgId = req.organization._id;

    const filter = { organization: orgId, isArchived: false };
    if (status) filter.pipelineStatus = status;
    if (priority) filter.outreachPriority = priority;
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
      ];
    }

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
    runPipeline(prospect._id).catch((err) =>
      console.error(`Pipeline error for ${prospect._id}:`, err.message)
    );

    res.status(201).json({ success: true, data: prospect });
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
    created.forEach((p) =>
      runPipeline(p._id).catch((err) => console.error(`Pipeline error for ${p._id}:`, err.message))
    );

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

    await Prospect.findByIdAndUpdate(prospect._id, { pipelineStatus: 'pending', pipelineError: null });
    runPipeline(prospect._id).catch(console.error);

    res.json({ success: true, message: 'Pipeline restarted.' });
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
