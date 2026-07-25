import Campaign from '../models/Campaign.js';
import ProspectList from '../models/ProspectList.js';
import Persona from '../models/Persona.js';
import Playbook from '../models/Playbook.js';
import { executeCampaign } from '../services/campaign/campaignExecutor.js';

const CHANNELS = ['email', 'linkedin', 'x', 'telegram'];

/** Validate that the referenced list/persona/playbook belong to this org. */
const validateRefs = async ({ organizationId, targetList, persona, playbook }) => {
  const checks = [
    targetList && {
      label: 'Target list',
      find: ProspectList.findOne({ _id: targetList, organization: organizationId, isArchived: false }),
    },
    persona && {
      label: 'Persona',
      find: Persona.findOne({ _id: persona, organization: organizationId }),
    },
    playbook && {
      label: 'Playbook',
      find: Playbook.findOne({ _id: playbook, organization: organizationId }),
    },
  ].filter(Boolean);

  for (const check of checks) {
    const doc = await check.find.select('_id').lean();
    if (!doc) return { ok: false, message: `${check.label} not found in your organization.` };
  }
  return { ok: true };
};

const normalizeSequence = (sequence) => {
  if (!Array.isArray(sequence) || sequence.length === 0) return null;
  const steps = sequence
    .map((s, i) => ({
      stepOrder: i + 1,
      channel: s?.channel,
      delayDays: Math.max(0, Number(s?.delayDays) || 0),
    }))
    .filter((s) => CHANNELS.includes(s.channel));
  return steps.length ? steps : null;
};

// GET /api/campaigns
export const getCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ organization: req.organization._id })
      .sort({ createdAt: -1 })
      .select('-results')
      .populate('targetList', 'name')
      .populate('persona', 'name')
      .populate('playbook', 'name')
      .lean();

    res.json({ success: true, data: campaigns });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/campaigns/:id
export const getCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      organization: req.organization._id,
    })
      .populate('targetList', 'name type')
      .populate('persona', 'name')
      .populate('playbook', 'name')
      .lean();

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }

    res.json({ success: true, data: campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/campaigns
export const createCampaign = async (req, res) => {
  try {
    const { name, targetList, persona, playbook, sequence } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Campaign name is required.' });
    }
    if (!targetList || !persona || !playbook) {
      return res.status(400).json({ success: false, message: 'targetList, persona and playbook are required.' });
    }

    const refCheck = await validateRefs({
      organizationId: req.organization._id,
      targetList,
      persona,
      playbook,
    });
    if (!refCheck.ok) {
      return res.status(400).json({ success: false, message: refCheck.message });
    }

    const normalizedSequence = normalizeSequence(sequence);

    const campaign = await Campaign.create({
      organization: req.organization._id,
      createdBy: req.user._id,
      name: name.trim(),
      targetList,
      persona,
      playbook,
      ...(normalizedSequence ? { sequence: normalizedSequence } : {}),
    });

    res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/campaigns/:id
export const updateCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      organization: req.organization._id,
    });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }
    if (campaign.status === 'generating') {
      return res.status(400).json({ success: false, message: 'Campaign is currently generating — try again when it finishes.' });
    }

    const refCheck = await validateRefs({
      organizationId: req.organization._id,
      targetList: req.body.targetList,
      persona: req.body.persona,
      playbook: req.body.playbook,
    });
    if (!refCheck.ok) {
      return res.status(400).json({ success: false, message: refCheck.message });
    }

    if (typeof req.body.name === 'string' && req.body.name.trim()) campaign.name = req.body.name.trim();
    if (req.body.targetList) campaign.targetList = req.body.targetList;
    if (req.body.persona) campaign.persona = req.body.persona;
    if (req.body.playbook) campaign.playbook = req.body.playbook;
    if (req.body.sequence !== undefined) {
      const normalizedSequence = normalizeSequence(req.body.sequence);
      if (!normalizedSequence) {
        return res.status(400).json({ success: false, message: 'Sequence needs at least one valid step.' });
      }
      campaign.sequence = normalizedSequence;
    }

    await campaign.save();
    res.json({ success: true, data: campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/campaigns/:id/execute
// Kicks off sequence generation in the background (never analyzes prospects).
export const executeCampaignHandler = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      organization: req.organization._id,
    }).select('_id status');

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }
    if (campaign.status === 'generating') {
      return res.status(400).json({ success: false, message: 'Campaign is already generating.' });
    }

    executeCampaign(campaign._id).catch((err) =>
      console.error(`[campaign] Execution error for ${campaign._id}:`, err.message)
    );

    res.json({ success: true, message: 'Campaign execution started.', status: 'generating' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/campaigns/:id
export const deleteCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndDelete({
      _id: req.params.id,
      organization: req.organization._id,
    }).lean();

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }

    res.json({ success: true, message: 'Campaign deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
