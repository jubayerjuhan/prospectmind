import mongoose from 'mongoose';
import Prospect from '../models/Prospect.js';
import ProspectList from '../models/ProspectList.js';
import { buildProspectFilter } from '../utils/buildProspectFilter.js';
import { queuePipelineRun } from '../services/pipeline/queue.js';
import { previewSpeakerImport } from '../services/scraper/speakerImportService.js';
import { normalizePersonas } from '../utils/personas.js';

const LIST_SUMMARY_PROJECTION = '_id firstName lastName company pipelineStatus compatibilityScore outreachPriority primaryAngle';
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizePagination = (page, limit) => {
  const parsedPage = Math.max(parseInt(page, 10) || DEFAULT_PAGE, 1);
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { page: parsedPage, limit: parsedLimit };
};

const normalizeFilters = (filters = {}) => ({
  search: filters.search?.trim() || '',
  status: filters.status?.trim() || '',
  priority: filters.priority?.trim() || '',
});

const splitName = (name = '') => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
};

const normalizeImportedCandidate = (candidate = {}) => ({
  sourceKey: candidate.sourceKey || '',
  name: candidate.name?.trim() || '',
  company: candidate.company?.trim() || '',
  role: candidate.role?.trim() || '',
  detailText: candidate.detailText?.trim() || '',
  avatarUrl: candidate.avatarUrl?.trim() || '',
  sourceUrl: candidate.sourceUrl?.trim() || '',
  socials: {
    linkedinUrl: candidate.socials?.linkedinUrl?.trim() || '',
    xUrl: candidate.socials?.xUrl?.trim() || '',
    githubUrl: candidate.socials?.githubUrl?.trim() || '',
    telegramHandle: candidate.socials?.telegramHandle?.trim() || '',
  },
  eventContext: {
    eventName: candidate.eventContext?.eventName?.trim() || '',
    talkTitle: candidate.eventContext?.talkTitle?.trim() || '',
    track: candidate.eventContext?.track?.trim() || '',
    dateLabel: candidate.eventContext?.dateLabel?.trim() || '',
    timeLabel: candidate.eventContext?.timeLabel?.trim() || '',
    stageLabel: candidate.eventContext?.stageLabel?.trim() || '',
    description: candidate.eventContext?.description?.trim() || '',
  },
});

const getManualList = async ({ listId, organizationId }) => {
  const list = await ProspectList.findOne({
    _id: listId,
    organization: organizationId,
    isArchived: false,
  });

  if (!list) {
    return { error: { status: 404, message: 'Campaign not found.' } };
  }

  if (list.type !== 'manual') {
    return { error: { status: 400, message: 'Only manual campaigns support direct membership changes.' } };
  }

  return { list };
};

const ensureUniqueListName = async ({ organizationId, name, excludeId }) => {
  const existing = await ProspectList.findOne({
    organization: organizationId,
    isArchived: false,
    name: { $regex: `^${escapeRegex(name.trim())}$`, $options: 'i' },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).lean();

  return !existing;
};

const dedupeProspectIds = (prospectIds = []) => {
  const ids = prospectIds.map((id) => id.toString().trim()).filter(Boolean);
  return [...new Set(ids)];
};

const validateProspectIds = async ({ organizationId, prospectIds }) => {
  if (!Array.isArray(prospectIds)) {
    return { ok: false, message: 'prospectIds array required.' };
  }

  const uniqueIds = dedupeProspectIds(prospectIds);
  const hasInvalidId = uniqueIds.some((id) => !mongoose.isValidObjectId(id));
  if (hasInvalidId) {
    return { ok: false, message: 'One or more prospectIds are invalid.' };
  }

  const matched = await Prospect.find({
    _id: { $in: uniqueIds },
    organization: organizationId,
    isArchived: false,
  })
    .select('_id')
    .lean();

  if (matched.length !== uniqueIds.length) {
    return { ok: false, message: 'One or more prospects were not found in your organization.' };
  }

  return { ok: true, prospectIds: uniqueIds };
};

const formatPagination = ({ total, page, limit }) => ({
  total,
  page,
  limit,
  pages: Math.max(1, Math.ceil(total / limit)),
});

const resolveDynamicListProspects = async ({ organizationId, filters, page, limit }) => {
  const filter = buildProspectFilter({
    organizationId,
    status: filters.status,
    priority: filters.priority,
    search: filters.search,
  });

  const [prospects, total] = await Promise.all([
    Prospect.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(LIST_SUMMARY_PROJECTION)
      .lean(),
    Prospect.countDocuments(filter),
  ]);

  return { prospects, total };
};

const resolveManualListProspects = async ({ list, page, limit }) => {
  const activeProspects = await Prospect.find({
    _id: { $in: list.prospects },
    organization: list.organization,
    isArchived: false,
  })
    .select('_id')
    .lean();

  const activeIdSet = new Set(activeProspects.map((prospect) => prospect._id.toString()));
  const orderedActiveIds = list.prospects
    .map((id) => id.toString())
    .filter((id) => activeIdSet.has(id));

  const total = orderedActiveIds.length;
  const ids = orderedActiveIds.slice((page - 1) * limit, page * limit);

  const prospects = await Prospect.find({
    _id: { $in: ids },
    organization: list.organization,
    isArchived: false,
  })
    .select(LIST_SUMMARY_PROJECTION)
    .lean();

  const prospectMap = new Map(prospects.map((prospect) => [prospect._id.toString(), prospect]));
  const ordered = ids.map((id) => prospectMap.get(id.toString())).filter(Boolean);

  return { prospects: ordered, total };
};

// GET /api/prospect-lists
export const getProspectLists = async (req, res) => {
  try {
    const { page, limit } = normalizePagination(req.query.page, req.query.limit);

    const filter = { organization: req.organization._id, isArchived: false };

    const [lists, total] = await Promise.all([
      ProspectList.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ProspectList.countDocuments(filter),
    ]);

    const data = await Promise.all(
      lists.map(async (list) => {
        let prospectCount = 0;

        if (list.type === 'dynamic') {
          const dynamicFilter = buildProspectFilter({
            organizationId: req.organization._id,
            ...normalizeFilters(list.filters),
          });
          prospectCount = await Prospect.countDocuments(dynamicFilter);
        } else {
          prospectCount = await Prospect.countDocuments({
            _id: { $in: list.prospects || [] },
            organization: req.organization._id,
            isArchived: false,
          });
        }

        return {
          _id: list._id,
          name: list.name,
          type: list.type,
          filters: list.type === 'dynamic' ? normalizeFilters(list.filters) : undefined,
          campaignDescription: list.campaignDescription || '',
          targetEcosystemContext: list.targetEcosystemContext || '',
          targetPersonas: normalizePersonas(list.targetPersonas),
          prospectCount,
          createdAt: list.createdAt,
          updatedAt: list.updatedAt,
        };
      })
    );

    res.json({
      success: true,
      data,
      pagination: formatPagination({ total, page, limit }),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/prospect-lists/:id
export const getProspectList = async (req, res) => {
  try {
    const { page, limit } = normalizePagination(req.query.page, req.query.limit);
    const list = await ProspectList.findOne({
      _id: req.params.id,
      organization: req.organization._id,
      isArchived: false,
    }).lean();

    if (!list) {
      return res.status(404).json({ success: false, message: 'Prospect list not found.' });
    }

    let resolved;
    if (list.type === 'dynamic') {
      resolved = await resolveDynamicListProspects({
        organizationId: req.organization._id,
        filters: normalizeFilters(list.filters),
        page,
        limit,
      });
    } else {
      resolved = await resolveManualListProspects({ list, page, limit });
    }

    res.json({
      success: true,
      data: {
        _id: list._id,
        name: list.name,
        type: list.type,
        filters: list.type === 'dynamic' ? normalizeFilters(list.filters) : undefined,
        campaignDescription: list.campaignDescription || '',
        targetEcosystemContext: list.targetEcosystemContext || '',
        targetPersonas: normalizePersonas(list.targetPersonas),
        prospectCount: resolved.total,
        prospects: resolved.prospects,
        createdAt: list.createdAt,
        updatedAt: list.updatedAt,
      },
      pagination: formatPagination({ total: resolved.total, page, limit }),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospect-lists
export const createProspectList = async (req, res) => {
  try {
    const { name, type = 'manual', prospectIds = [], filters, campaignDescription = '' } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'List name is required.' });
    }

    if (!['manual', 'dynamic'].includes(type)) {
      return res.status(400).json({ success: false, message: 'List type must be manual or dynamic.' });
    }

    const hasUniqueName = await ensureUniqueListName({
      organizationId: req.organization._id,
      name,
    });
    if (!hasUniqueName) {
      return res.status(409).json({ success: false, message: 'A prospect list with this name already exists.' });
    }

    const payload = {
      organization: req.organization._id,
      createdBy: req.user._id,
      name: name.trim(),
      type,
      campaignDescription: campaignDescription.trim(),
      targetPersonas: normalizePersonas(req.body.targetPersonas),
    };

    if (type === 'manual') {
      const validation = await validateProspectIds({
        organizationId: req.organization._id,
        prospectIds,
      });
      if (!validation.ok) {
        return res.status(400).json({ success: false, message: validation.message });
      }
      payload.prospects = validation.prospectIds;
    } else {
      payload.filters = normalizeFilters(filters);
    }

    const list = await ProspectList.create(payload);
    res.status(201).json({ success: true, data: list });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/prospect-lists/:id
export const updateProspectList = async (req, res) => {
  try {
    const list = await ProspectList.findOne({
      _id: req.params.id,
      organization: req.organization._id,
      isArchived: false,
    });

    if (!list) {
      return res.status(404).json({ success: false, message: 'Prospect list not found.' });
    }

    if (typeof req.body.name === 'string') {
      if (!req.body.name.trim()) {
        return res.status(400).json({ success: false, message: 'List name cannot be empty.' });
      }

      const hasUniqueName = await ensureUniqueListName({
        organizationId: req.organization._id,
        name: req.body.name,
        excludeId: list._id,
      });
      if (!hasUniqueName) {
        return res.status(409).json({ success: false, message: 'A prospect list with this name already exists.' });
      }

      list.name = req.body.name.trim();
    }

    if (list.type === 'dynamic' && req.body.filters) {
      list.filters = normalizeFilters(req.body.filters);
    }

    if (list.type === 'manual' && req.body.prospectIds) {
      const validation = await validateProspectIds({
        organizationId: req.organization._id,
        prospectIds: req.body.prospectIds,
      });
      if (!validation.ok) {
        return res.status(400).json({ success: false, message: validation.message });
      }
      list.prospects = validation.prospectIds;
    }

    if (list.type === 'dynamic' && req.body.prospectIds) {
      return res.status(400).json({ success: false, message: 'Dynamic lists cannot store manual prospect membership.' });
    }

    if (typeof req.body.campaignDescription === 'string') {
      list.campaignDescription = req.body.campaignDescription.trim();
    }

    if (Array.isArray(req.body.targetPersonas)) {
      list.targetPersonas = normalizePersonas(req.body.targetPersonas);
    }

    // Groq is on hold — only 'gemini' is accepted for new writes. Existing lists
    // that already have 'groq'/'auto' stored keep running (routed to Gemini
    // anyway, see claudeClient.js GROQ_ENABLED) but can't be set again via API.
    const ALLOWED_AI_MODELS = ['gemini'];
    if (req.body.preferredAiModel !== undefined) {
      if (!ALLOWED_AI_MODELS.includes(req.body.preferredAiModel)) {
        return res.status(400).json({
          success: false,
          message: `Invalid preferredAiModel. Must be one of: ${ALLOWED_AI_MODELS.join(', ')}.`,
        });
      }
      list.preferredAiModel = req.body.preferredAiModel;
    }

    await list.save();
    res.json({ success: true, data: list });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/prospect-lists/:id
export const archiveProspectList = async (req, res) => {
  try {
    const list = await ProspectList.findOneAndUpdate(
      { _id: req.params.id, organization: req.organization._id, isArchived: false },
      { isArchived: true },
      { new: true }
    ).lean();

    if (!list) {
      return res.status(404).json({ success: false, message: 'Prospect list not found.' });
    }

    res.json({ success: true, message: 'Prospect list archived.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospect-lists/:id/prospects
export const addProspectsToList = async (req, res) => {
  try {
    const { list, error } = await getManualList({
      listId: req.params.id,
      organizationId: req.organization._id,
    });
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    const validation = await validateProspectIds({
      organizationId: req.organization._id,
      prospectIds: req.body.prospectIds,
    });
    if (!validation.ok) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    list.prospects = dedupeProspectIds([...list.prospects.map((id) => id.toString()), ...validation.prospectIds]);
    await list.save();

    res.json({
      success: true,
      data: { _id: list._id, prospectCount: list.prospects.length },
      message: 'Prospects added to list.',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospect-lists/:id/add-and-create
// Atomic endpoint: creates a new prospect + adds to campaign in one shot.
// Respects campaign gate — pipeline only queued if campaign settings are present.
export const addAndCreateProspect = async (req, res) => {
  try {
    const { list, error } = await getManualList({
      listId: req.params.id,
      organizationId: req.organization._id,
    });
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    // Plan limit check
    if (!req.organization.canAddProspect()) {
      return res.status(403).json({
        success: false,
        message: `You've reached your plan limit (${req.organization.getProspectLimit()} prospects/month). Upgrade to add more.`,
        code: 'LIMIT_REACHED',
      });
    }

    const { firstName, lastName, company, typeHint, description, rawEmail, rawLinkedin, rawX, rawTelegram, rawGithub } = req.body;

    if (!firstName?.trim()) {
      return res.status(400).json({ success: false, message: 'First name is required.' });
    }

    // Check campaign gate BEFORE creating
    const hasCampaignSettings = Boolean(list.campaignDescription?.trim());

    // Create the prospect
    const prospect = await Prospect.create({
      organization: req.organization._id,
      createdBy: req.user._id,
      firstName: firstName.trim(),
      lastName: lastName?.trim() || '',
      company: company?.trim() || '',
      typeHint: typeHint || 'unknown',
      description: description?.trim() || '',
      rawEmail: rawEmail?.trim() || '',
      rawLinkedin: rawLinkedin?.trim() || '',
      rawX: rawX?.trim() || '',
      rawTelegram: rawTelegram?.trim() || '',
      rawGithub: rawGithub?.trim() || '',
    });

    // Add to the campaign
    list.prospects = dedupeProspectIds([...list.prospects.map((id) => id.toString()), prospect._id.toString()]);
    await list.save();

    // Only queue pipeline if campaign settings are present
    let pipelineQueued = false;
    if (hasCampaignSettings) {
      queuePipelineRun(prospect._id).catch((err) =>
        console.error(`Queue error for ${prospect._id}:`, err.message)
      );
      pipelineQueued = true;
    }

    res.status(201).json({
      success: true,
      data: prospect,
      pipelineQueued,
      campaignSettingsMissing: !hasCampaignSettings,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/prospect-lists/:id/prospects
export const removeProspectsFromList = async (req, res) => {
  try {
    const { list, error } = await getManualList({
      listId: req.params.id,
      organizationId: req.organization._id,
    });
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    if (!Array.isArray(req.body.prospectIds)) {
      return res.status(400).json({ success: false, message: 'prospectIds array required.' });
    }

    const idsToRemove = new Set(dedupeProspectIds(req.body.prospectIds));
    list.prospects = list.prospects.filter((id) => !idsToRemove.has(id.toString()));
    await list.save();

    res.json({
      success: true,
      data: { _id: list._id, prospectCount: list.prospects.length },
      message: 'Prospects removed from list.',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospect-lists/:id/import-preview
export const importProspectPreview = async (req, res) => {
  try {
    const { list, error } = await getManualList({
      listId: req.params.id,
      organizationId: req.organization._id,
    });
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    const { url } = req.body;
    if (!url?.trim()) {
      return res.status(400).json({ success: false, message: 'A page URL is required.' });
    }

    const result = await previewSpeakerImport(url.trim());
    res.json({
      success: true,
      data: {
        campaign: { _id: list._id, name: list.name },
        ...result,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to preview import.' });
  }
};

// POST /api/prospect-lists/:id/import-confirm
export const importProspectsConfirm = async (req, res) => {
  try {
    const { list, error } = await getManualList({
      listId: req.params.id,
      organizationId: req.organization._id,
    });
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    if (!list.campaignDescription?.trim()) {
      return res.status(400).json({ success: false, message: 'Please configure the Campaign & Outreach Goal before importing prospects.' });
    }

    const candidates = Array.isArray(req.body.candidates) ? req.body.candidates.map(normalizeImportedCandidate) : [];
    if (!candidates.length) {
      return res.status(400).json({ success: false, message: 'At least one candidate is required.' });
    }

    const limit = req.organization.getProspectLimit();
    const used = req.organization.usage.prospectsThisMonth;
    const available = limit - used;
    if (available <= 0) {
      return res.status(403).json({ success: false, message: 'Monthly prospect limit reached.', code: 'LIMIT_REACHED' });
    }

    const dedupedCandidates = [];
    const seenKeys = new Set();
    for (const candidate of candidates) {
      if (!candidate.name) continue;
      const key = candidate.sourceKey || `${candidate.name.toLowerCase()}::${candidate.company.toLowerCase()}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      dedupedCandidates.push(candidate);
    }

    const existingProspects = await Prospect.find({
      _id: { $in: list.prospects },
      organization: req.organization._id,
      isArchived: false,
    })
      .select('firstName lastName company')
      .lean();

    const existingKeys = new Set(
      existingProspects.map((prospect) =>
        `${`${prospect.firstName || ''} ${prospect.lastName || ''}`.trim().toLowerCase()}::${(prospect.company || '').trim().toLowerCase()}`
      )
    );

    const importable = dedupedCandidates.filter((candidate) => {
      const key = `${candidate.name.toLowerCase()}::${candidate.company.toLowerCase()}`;
      return !existingKeys.has(key);
    });

    const toCreate = importable.slice(0, available).map((candidate) => {
      const { firstName, lastName } = splitName(candidate.name);
      const eventTags = [
        candidate.eventContext.eventName && `event:${candidate.eventContext.eventName}`,
        candidate.eventContext.track && `track:${candidate.eventContext.track}`,
        candidate.eventContext.stageLabel && `stage:${candidate.eventContext.stageLabel}`,
        candidate.eventContext.talkTitle && `talk:${candidate.eventContext.talkTitle}`,
        `campaign:${list.name}`,
      ].filter(Boolean);

      return {
        organization: req.organization._id,
        createdBy: req.user._id,
        firstName,
        lastName,
        company: candidate.company,
        typeHint: 'unknown',
        rawLinkedin: candidate.socials.linkedinUrl,
        rawX: candidate.socials.xUrl,
        rawTelegram: candidate.socials.telegramHandle,
        rawGithub: candidate.socials.githubUrl,
        tags: [...new Set(eventTags)],
        enrichedProfile: candidate.detailText || candidate.eventContext.description
          ? {
              bio: candidate.detailText || candidate.eventContext.description,
              currentRole: candidate.role || undefined,
              conferenceParticipation: [candidate.eventContext.eventName].filter(Boolean),
            }
          : undefined,
      };
    });

    const created = toCreate.length ? await Prospect.insertMany(toCreate) : [];
    if (created.length) {
      list.prospects = dedupeProspectIds([
        ...list.prospects.map((id) => id.toString()),
        ...created.map((prospect) => prospect._id.toString()),
      ]);
      await list.save();

      created.forEach((prospect) =>
        queuePipelineRun(prospect._id).catch((err) => console.error(`Queue error for ${prospect._id}:`, err.message))
      );
    }

    res.status(201).json({
      success: true,
      data: {
        created: created.length,
        skipped: candidates.length - created.length,
        campaignId: list._id,
        prospectIds: created.map((prospect) => prospect._id),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to import prospects.' });
  }
};

// POST /api/prospect-lists/:id/pause
export const pauseCampaign = async (req, res) => {
  try {
    const { list, error } = await getManualList({
      listId: req.params.id,
      organizationId: req.organization._id,
    });
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    const statusesToPause = ['pending', 'discovering', 'enriching', 'classifying', 'scoring', 'generating'];

    await Prospect.updateMany(
      {
        _id: { $in: list.prospects },
        pipelineStatus: { $in: statusesToPause },
        pipelinePaused: false
      },
      {
        $set: {
          pipelinePaused: true,
          pipelinePausedAt: new Date(),
        }
      }
    );

    res.json({ success: true, message: 'Campaign paused successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospect-lists/:id/resume
export const resumeCampaign = async (req, res) => {
  try {
    const { list, error } = await getManualList({
      listId: req.params.id,
      organizationId: req.organization._id,
    });
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    const pausedProspects = await Prospect.find({
      _id: { $in: list.prospects },
      $or: [
        { pipelinePaused: true },
        { pipelineStatus: 'paused' }
      ]
    });

    if (pausedProspects.length > 0) {
      await Prospect.updateMany(
        { _id: { $in: pausedProspects.map(p => p._id) } },
        {
          $set: {
            pipelinePaused: false,
            pipelinePausedAt: null,
            pipelineStatus: 'pending',
            pipelineError: null,
          }
        }
      );

      pausedProspects.forEach(p => {
        queuePipelineRun(p._id).catch(err => console.error(`Queue error for ${p._id}:`, err.message));
      });
    }

    res.json({ success: true, message: 'Campaign resumed successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
