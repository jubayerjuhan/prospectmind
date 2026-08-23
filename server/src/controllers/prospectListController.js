import mongoose from 'mongoose';
import Prospect from '../models/Prospect.js';
import ProspectList, { OUTREACH_CHANNELS } from '../models/ProspectList.js';
import Persona from '../models/Persona.js';
import Playbook from '../models/Playbook.js';
import Signal from '../models/Signal.js';
import { buildProspectFilter } from '../utils/buildProspectFilter.js';
import { queuePipelineRun } from '../services/pipeline/queue.js';
import { pauseProspectRun, ACTIVE_PIPELINE_STATUSES } from '../services/pipeline/pauseControl.js';
import { toCsv, safeFilename } from '../utils/csv.js';
import { buildOutreachLeads, outreachCsvColumns } from '../services/campaign/outreachExport.js';
import { ensureCompanyLink } from '../services/company/companyResolver.js';
import { previewSpeakerImport } from '../services/scraper/speakerImportService.js';
import { executeCampaignOutreach } from '../services/campaign/campaignExecutor.js';
import { executeLemlistPush, previewLemlistPush } from '../services/campaign/lemlistPushService.js';

// pipelinePaused rides along because the table has to tell "paused" apart from
// "pausing" — a run that is flagged but still finishing its current layer.
// aiProviderUsed was always rendered by the table but never selected, so the AI
// column sat empty in the campaign view while working in the pool view.
// companyRef comes along because `company` is only the raw string the prospect
// was created with — often empty for an imported or finder-sourced row, whose
// real employer is the resolved Company the pipeline linked afterwards. Without
// it the table showed "—" for prospects whose detail page clearly names a company.
const LIST_SUMMARY_PROJECTION = '_id firstName lastName company companyRef pipelineStatus pipelinePaused aiProviderUsed compatibilityScore outreachPriority primaryAngle';

// Only the name is needed to label a row; keep the payload small.
const COMPANY_REF_POPULATE = { path: 'companyRef', select: 'name' };
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

/** Normalize an outreach sequence, renumbering steps and dropping unknown channels. */
const normalizeSequence = (sequence) => {
  if (!Array.isArray(sequence)) return null;
  const steps = sequence
    .filter((step) => OUTREACH_CHANNELS.includes(step?.channel))
    .map((step, index) => ({
      stepOrder: index + 1,
      channel: step.channel,
      delayDays: Math.max(0, Number(step?.delayDays) || 0),
    }));
  return steps.length ? steps : null;
};

const STRATEGY_MODELS = { personas: Persona, playbooks: Playbook, signals: Signal };

/**
 * Validate that selected Personas/Playbooks/Signals exist in this org, and
 * return the deduped id list. An empty selection is valid and means "use every
 * active one" downstream.
 */
const resolveStrategySelection = async ({ organizationId, field, ids }) => {
  const uniqueIds = [...new Set((ids || []).map((id) => String(id).trim()).filter(Boolean))];
  if (uniqueIds.some((id) => !mongoose.isValidObjectId(id))) {
    return { ok: false, message: `One or more ${field} ids are invalid.` };
  }
  if (!uniqueIds.length) return { ok: true, ids: [] };

  const found = await STRATEGY_MODELS[field]
    .find({ _id: { $in: uniqueIds }, organization: organizationId })
    .select('_id')
    .lean();

  if (found.length !== uniqueIds.length) {
    return { ok: false, message: `One or more selected ${field} were not found in your organization.` };
  }
  return { ok: true, ids: uniqueIds };
};

/** Apply any strategy selections present on the request body to the campaign. */
const applyStrategySelections = async ({ list, body, organizationId }) => {
  for (const field of Object.keys(STRATEGY_MODELS)) {
    if (!Array.isArray(body[field])) continue;
    const resolved = await resolveStrategySelection({ organizationId, field, ids: body[field] });
    if (!resolved.ok) return resolved;
    list[field] = resolved.ids;
  }
  return { ok: true };
};

/** Campaign strategy + outreach summary shared by the list and detail responses. */
const serializeCampaignConfig = (list) => ({
  campaignDescription: list.campaignDescription || '',
  targetEcosystemContext: list.targetEcosystemContext || '',
  preferredAiModel: list.preferredAiModel || 'gemini',
  personas: (list.personas || []).map(String),
  playbooks: (list.playbooks || []).map(String),
  signals: (list.signals || []).map(String),
  sequence: (list.sequence || []).map((step) => ({
    stepOrder: step.stepOrder,
    channel: step.channel,
    delayDays: step.delayDays || 0,
  })),
});

/** Outreach state without the (potentially large) generated message bodies. */
const serializeOutreachSummary = (outreach = {}) => {
  const results = outreach.results || [];
  return {
    status: outreach.status || 'idle',
    playbook: outreach.playbook ? String(outreach.playbook) : null,
    lastGeneratedAt: outreach.lastGeneratedAt || null,
    error: outreach.error || null,
    generatedCount: results.filter((r) => r.status === 'generated').length,
    skippedCount: results.filter((r) => r.status === 'skipped').length,
  };
};

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
    companyLinkedinUrl: candidate.socials?.companyLinkedinUrl?.trim() || '',
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
      .populate(COMPANY_REF_POPULATE)
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
    .populate(COMPANY_REF_POPULATE)
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
          ...serializeCampaignConfig(list),
          outreach: serializeOutreachSummary(list.outreach),
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
        ...serializeCampaignConfig(list),
        outreach: serializeOutreachSummary(list.outreach),
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
    };

    for (const field of Object.keys(STRATEGY_MODELS)) {
      if (!Array.isArray(req.body[field])) continue;
      const resolved = await resolveStrategySelection({
        organizationId: req.organization._id,
        field,
        ids: req.body[field],
      });
      if (!resolved.ok) {
        return res.status(400).json({ success: false, message: resolved.message });
      }
      payload[field] = resolved.ids;
    }

    const sequence = normalizeSequence(req.body.sequence);
    if (sequence) payload.sequence = sequence;

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

    if (typeof req.body.targetEcosystemContext === 'string') {
      list.targetEcosystemContext = req.body.targetEcosystemContext.trim();
    }

    const strategy = await applyStrategySelections({
      list,
      body: req.body,
      organizationId: req.organization._id,
    });
    if (!strategy.ok) {
      return res.status(400).json({ success: false, message: strategy.message });
    }

    if (req.body.sequence !== undefined) {
      const sequence = normalizeSequence(req.body.sequence);
      if (!sequence) {
        return res.status(400).json({ success: false, message: 'The outreach sequence needs at least one valid step.' });
      }
      list.sequence = sequence;
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

    // Link a company regardless of whether the pipeline runs — this branch is
    // skipped below when the campaign has no description, and the pipeline used
    // to be the only place a companyRef was ever set.
    await ensureCompanyLink(prospect);

    // Enrichment is opt-in everywhere, campaigns included: the prospect lands
    // in 'not-started' and the user starts it (per prospect, or per campaign
    // with POST /:id/start). campaignSettingsMissing still rides along so the
    // UI can keep warning that a start would be blocked by the gate.
    res.status(201).json({
      success: true,
      data: prospect,
      pipelineQueued: false,
      campaignSettingsMissing: !hasCampaignSettings,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospect-lists/:id/prospects/bulk-import
// Bulk version of add-and-create for CSV import: creates many prospects and
// adds them to the campaign in one shot. Same campaign-gate behavior as
// add-and-create — pipeline only queues when the campaign has settings.
export const bulkImportProspectsToList = async (req, res) => {
  try {
    const { list, error } = await getManualList({
      listId: req.params.id,
      organizationId: req.organization._id,
    });
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    const rows = Array.isArray(req.body.candidates) ? req.body.candidates : [];
    const withName = rows.filter((row) => row.firstName?.trim());
    if (!withName.length) {
      return res.status(400).json({ success: false, message: 'At least one row with a name is required.' });
    }

    const limit = req.organization.getProspectLimit();
    const used = req.organization.usage.prospectsThisMonth;
    const available = limit - used;
    if (available <= 0) {
      return res.status(403).json({ success: false, message: 'Monthly prospect limit reached.', code: 'LIMIT_REACHED' });
    }

    // Dedupe within the upload itself, then against what's already in this campaign.
    const dedupeKey = (row) =>
      `${row.firstName.trim().toLowerCase()} ${row.lastName?.trim().toLowerCase() || ''}`.trim() +
      `::${row.company?.trim().toLowerCase() || ''}`;

    const seen = new Set();
    const deduped = [];
    for (const row of withName) {
      const key = dedupeKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
    }

    const existingProspects = await Prospect.find({
      _id: { $in: list.prospects },
      organization: req.organization._id,
      isArchived: false,
    })
      .select('firstName lastName company')
      .lean();
    const existingKeys = new Set(
      existingProspects.map(
        (p) => `${p.firstName.trim().toLowerCase()} ${p.lastName?.trim().toLowerCase() || ''}`.trim() + `::${(p.company || '').trim().toLowerCase()}`
      )
    );

    const importable = deduped.filter((row) => !existingKeys.has(dedupeKey(row)));
    const hasCampaignSettings = Boolean(list.campaignDescription?.trim());

    const toCreate = importable.slice(0, available).map((row) => ({
      organization: req.organization._id,
      createdBy: req.user._id,
      firstName: row.firstName.trim(),
      lastName: row.lastName?.trim() || '',
      company: row.company?.trim() || '',
      typeHint: row.typeHint || 'unknown',
      description: row.description?.trim() || '',
      rawEmail: row.rawEmail?.trim() || '',
      rawLinkedin: row.rawLinkedin?.trim() || '',
      rawX: row.rawX?.trim() || '',
      rawTelegram: row.rawTelegram?.trim() || '',
      rawGithub: row.rawGithub?.trim() || '',
      rawPhone: row.rawPhone?.trim() || '',
      rawWebsite: row.rawWebsite?.trim() || '',
    }));

    const created = toCreate.length ? await Prospect.insertMany(toCreate) : [];

    if (created.length) {
      list.prospects = dedupeProspectIds([...list.prospects.map((id) => id.toString()), ...created.map((p) => p._id.toString())]);
      await list.save();

      // insertMany bypasses document middleware, so the company link has to be explicit.
      for (const p of created) await ensureCompanyLink(p).catch(() => null);

      // Not queued — see addAndCreateProspect. Imported rows wait in
      // 'not-started' until the user starts them.

    }

    res.status(201).json({
      success: true,
      data: {
        created: created.length,
        skipped: rows.length - created.length,
      },
      pipelineQueued: hasCampaignSettings,
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
        rawCompanyLinkedin: candidate.socials.companyLinkedinUrl,
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

      // Imported speakers carry a company LinkedIn URL when the source page
      // linked one — resolve it now so the Companies view is correct even
      // before the pipeline gets to them.
      for (const prospect of created) {
        await ensureCompanyLink(prospect).catch(() => null);
      }

      // Not queued — imported prospects wait in 'not-started' for an explicit
      // start, like every other creation path.

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

// GET /api/prospect-lists/:id/outreach
// Full outreach state for a campaign, including every generated message.
export const getCampaignOutreach = async (req, res) => {
  try {
    const list = await ProspectList.findOne({
      _id: req.params.id,
      organization: req.organization._id,
      isArchived: false,
    })
      .select('name sequence playbooks outreach')
      .populate('outreach.playbook', 'name')
      .lean();

    if (!list) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }

    const outreach = list.outreach || {};
    res.json({
      success: true,
      data: {
        _id: list._id,
        name: list.name,
        sequence: list.sequence || [],
        status: outreach.status || 'idle',
        playbook: outreach.playbook || null,
        lastGeneratedAt: outreach.lastGeneratedAt || null,
        error: outreach.error || null,
        results: outreach.results || [],
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospect-lists/:id/outreach/generate
// Kicks off sequence generation in the background. Never analyzes prospects —
// it only reads analysis the pipeline already stored.
export const generateCampaignOutreach = async (req, res) => {
  try {
    const list = await ProspectList.findOne({
      _id: req.params.id,
      organization: req.organization._id,
      isArchived: false,
    }).select('_id outreach.status');

    if (!list) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }
    if (list.outreach?.status === 'generating') {
      return res.status(400).json({ success: false, message: 'Outreach is already generating for this campaign.' });
    }

    const { playbookId } = req.body || {};
    if (playbookId && !mongoose.isValidObjectId(playbookId)) {
      return res.status(400).json({ success: false, message: 'Invalid playbookId.' });
    }

    executeCampaignOutreach(list._id, { playbookId }).catch((err) =>
      console.error(`[campaign] Outreach generation error for ${list._id}:`, err.message)
    );

    res.json({ success: true, message: 'Outreach generation started.', status: 'generating' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Shared by the CSV download and the JSON endpoint below.
const loadCampaignForExport = async (listId, organizationId) =>
  ProspectList.findOne({ _id: listId, organization: organizationId, isArchived: false })
    .select('name sequence outreach')
    .lean();

// GET /api/prospect-lists/:id/outreach/export
//
// The generated sequences as a CSV: one row per prospect, with every way to
// reach them and each step's message in its own columns.
export const exportCampaignOutreach = async (req, res) => {
  try {
    const list = await loadCampaignForExport(req.params.id, req.organization._id);
    if (!list) return res.status(404).json({ success: false, message: 'Campaign not found.' });

    const { leads, maxSteps } = await buildOutreachLeads(list, req.organization._id);
    if (!leads.length) {
      return res.status(400).json({
        success: false,
        message: 'Nothing to export yet — generate the outreach sequences first.',
      });
    }

    const filename = safeFilename(`${list.name} outreach ${new Date().toISOString().slice(0, 10)}`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(toCsv(outreachCsvColumns(maxSteps), leads));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/prospect-lists/:id/outreach/leads
//
// The same data as JSON, for an external tool (lemlist) to pull on a schedule.
// Authenticated by organization API key OR a normal session — see
// apiKeyOrProtect. Flat camelCase keys are deliberate: lemlist maps them
// straight onto lead fields and custom variables, so {{step1Message}} works in
// a template with no transformation in between.
export const getCampaignOutreachLeads = async (req, res) => {
  try {
    const list = await loadCampaignForExport(req.params.id, req.organization._id);
    if (!list) return res.status(404).json({ success: false, message: 'Campaign not found.' });

    const { leads } = await buildOutreachLeads(list, req.organization._id);

    // Skipped prospects have no messages; an integration pulling leads to send
    // to almost never wants them, but the raw record should still be reachable.
    const includeSkipped = String(req.query.includeSkipped || '') === 'true';
    const payload = includeSkipped ? leads : leads.filter((lead) => lead.status !== 'skipped');

    res.json({
      success: true,
      campaign: {
        id: String(list._id),
        name: list.name,
        status: list.outreach?.status || 'idle',
        lastGeneratedAt: list.outreach?.lastGeneratedAt || null,
        sequence: (list.sequence || []).map((step) => ({
          stepOrder: step.stepOrder,
          channel: step.channel,
          delayDays: step.delayDays,
        })),
      },
      count: payload.length,
      leads: payload,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/prospect-lists/:id/lemlist-push/preview
//
// What a push WOULD do — reachability against the campaign's current sequence
// — without touching lemlist. lemlist has no delete-campaign endpoint, so
// "2 leads aren't reachable on this sequence" is worth surfacing before the
// click, not discovered afterward in the push result of a campaign that
// already exists and can't be undone.
export const getLemlistPushPreview = async (req, res) => {
  try {
    const preview = await previewLemlistPush(req.params.id, req.organization._id);
    res.json({ success: true, data: preview });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

// POST /api/prospect-lists/:id/lemlist-push
//
// Kicks off pushing this campaign's generated outreach into lemlist as one
// lemlist campaign matching the configured sequence. Fire-and-forget, same
// shape as generateCampaignOutreach — the frontend polls the GET below for
// progress.
//
// lemlist has no delete-campaign endpoint, so a second click while a push is
// already running (or already done) is refused rather than silently creating
// a duplicate campaign nobody can remove.
export const startLemlistPush = async (req, res) => {
  try {
    const list = await ProspectList.findOne({
      _id: req.params.id,
      organization: req.organization._id,
      isArchived: false,
    }).select('_id lemlistPush.status');

    if (!list) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }
    if (list.lemlistPush?.status === 'pushing') {
      return res.status(400).json({ success: false, message: 'A push to lemlist is already running for this campaign.' });
    }

    const { autoReview, timezone } = req.body || {};

    executeLemlistPush(list._id, req.organization._id, {
      autoReview: autoReview === true, // explicit opt-in only; undefined/anything else stays false
      timezone: typeof timezone === 'string' && timezone.trim() ? timezone.trim() : undefined,
    }).catch((err) => console.error(`[lemlist-push] Push error for ${list._id}:`, err.message));

    res.json({ success: true, message: 'Push to lemlist started.', status: 'pushing' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/prospect-lists/:id/lemlist-push
//
// Poll target for the push started above — one or more lemlist campaign
// records with per-campaign lead counts, failures, and the overall totals.
export const getLemlistPushStatus = async (req, res) => {
  try {
    const list = await ProspectList.findOne({
      _id: req.params.id,
      organization: req.organization._id,
      isArchived: false,
    }).select('lemlistPush').lean();

    if (!list) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }

    res.json({ success: true, data: list.lemlistPush || { status: 'idle' } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prospect-lists/:id/start
//
// Starts every prospect in the campaign that is still 'not-started'. Since
// creation no longer auto-runs the pipeline, this is how a campaign of imported
// rows gets enriched — one click instead of one per prospect.
export const startCampaign = async (req, res) => {
  try {
    const { list, error } = await getManualList({
      listId: req.params.id,
      organizationId: req.organization._id,
    });
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    // Same gate the per-prospect start enforces: a prospect scored against an
    // empty campaign goal looks scored but isn't.
    if (!list.campaignDescription?.trim()) {
      return res.status(400).json({
        success: false,
        message: `Campaign "${list.name}" is missing required settings before the pipeline can run. Please fill in: Campaign Description & Goals.`,
        code: 'CAMPAIGN_SETTINGS_REQUIRED',
        campaignId: list._id,
        missingFields: ['Campaign Description & Goals'],
      });
    }

    const toStart = await Prospect.find({
      _id: { $in: list.prospects },
      organization: req.organization._id,
      isArchived: false,
      pipelineStatus: 'not-started',
    }).select('_id').lean();

    if (!toStart.length) {
      return res.json({ success: true, started: 0, message: 'Nothing left to start in this campaign.' });
    }

    await Prospect.updateMany(
      { _id: { $in: toStart.map((prospect) => prospect._id) } },
      { $set: { pipelineStatus: 'pending', pipelineError: null, pipelinePaused: false, pipelinePausedAt: null } }
    );

    // The queue runs one prospect at a time, so these line up behind each other
    // and the campaign works through them in order. Pausing one takes only that
    // one out (see pauseControl.js) — the rest keep moving.
    for (const prospect of toStart) {
      await queuePipelineRun(prospect._id).catch((err) =>
        console.error(`Queue error for ${prospect._id}:`, err.message)
      );
    }

    res.json({
      success: true,
      started: toStart.length,
      message: `Started enrichment for ${toStart.length} prospect(s).`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    const toPause = await Prospect.find({
      _id: { $in: list.prospects },
      pipelineStatus: { $in: ACTIVE_PIPELINE_STATUSES },
      pipelinePaused: false,
    }).select('_id pipelineStatus').lean();

    // Per prospect rather than one updateMany: the queued ones have to be
    // pulled out of BullMQ to stop for real, and only pauseProspectRun knows
    // which of them was still cancellable. Sequential on purpose — this is a
    // handful of Redis calls, and racing them risks removing a job the worker
    // is in the middle of locking.
    let stoppedImmediately = 0;
    for (const prospect of toPause) {
      const { immediate } = await pauseProspectRun(prospect);
      if (immediate) stoppedImmediately += 1;
    }

    // Whatever was mid-run keeps going until its current layer returns, so say
    // so rather than reporting a clean stop that has not happened yet.
    const stillFinishing = toPause.length - stoppedImmediately;

    res.json({
      success: true,
      paused: toPause.length,
      stoppedImmediately,
      stillFinishing,
      message: stillFinishing
        ? `Paused ${toPause.length} prospect(s). ${stillFinishing} will stop after the current step finishes.`
        : `Paused ${toPause.length} prospect(s).`,
    });
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
