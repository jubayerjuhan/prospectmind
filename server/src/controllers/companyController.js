import mongoose from 'mongoose';
import Company from '../models/Company.js';
import Prospect from '../models/Prospect.js';
import Playbook from '../models/Playbook.js';
import Persona from '../models/Persona.js';
import { normalizeCompanyName, findOrCreateCompany } from '../services/company/companyService.js';
import { analyzeCompany } from '../services/company/companyAnalyzer.js';
import { findCompanyContacts } from '../services/company/contactFinder.js';
import { resolveCompanyLinkedin } from '../services/company/linkedinResolver.js';
import { findCompanyProspects } from '../services/company/prospectFinder.js';
import { findDuplicateGroups, mergeCompanies } from '../services/company/companyMerger.js';
import { ensureCompanyLink } from '../services/company/companyResolver.js';
import { detectCompanySignals } from '../services/pipeline/signalDetector.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizePagination = (page, limit) => ({
  page: Math.max(parseInt(page, 10) || DEFAULT_PAGE, 1),
  limit: Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT),
});

const formatPagination = ({ total, page, limit }) => ({
  total,
  page,
  limit,
  pages: Math.max(1, Math.ceil(total / limit)),
});

// GET /api/companies
export const getCompanies = async (req, res) => {
  try {
    const { page, limit } = normalizePagination(req.query.page, req.query.limit);
    const filter = { organization: req.organization._id };

    const search = req.query.search?.trim();
    if (search) {
      filter.name = { $regex: escapeRegex(search), $options: 'i' };
    }

    const [companies, total] = await Promise.all([
      Company.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Company.countDocuments(filter),
    ]);

    // Attach prospect counts per company (how many prospects reference it).
    const data = await Promise.all(
      companies.map(async (c) => ({
        ...c,
        prospectCount: await Prospect.countDocuments({
          organization: req.organization._id,
          companyRef: c._id,
          isArchived: false,
        }),
      }))
    );

    res.json({ success: true, data, pagination: formatPagination({ total, page, limit }) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/companies/:id
export const getCompany = async (req, res) => {
  try {
    const company = await Company.findOne({
      _id: req.params.id,
      organization: req.organization._id,
    }).lean();

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found.' });
    }

    const [prospectCount, prospects] = await Promise.all([
      Prospect.countDocuments({
        organization: req.organization._id,
        companyRef: company._id,
        isArchived: false,
      }),
      Prospect.find({
        organization: req.organization._id,
        companyRef: company._id,
        isArchived: false,
      })
        .sort({ compatibilityScore: -1, createdAt: -1 })
        .limit(50)
        .select('_id firstName lastName pipelineStatus compatibilityScore scoreLabel outreachPriority enrichedProfile.currentRole')
        .lean(),
    ]);

    res.json({ success: true, data: { ...company, prospectCount, prospects } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/companies
// Uses find-or-create so creating a duplicate name returns the existing company.
export const createCompany = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Company name is required.' });
    }

    const company = await findOrCreateCompany({
      organization: req.organization._id,
      name,
      createdBy: req.user._id,
    });

    // Apply any additional editable fields provided on create.
    const editable = ['website', 'domain', 'industry', 'size'];
    let touched = false;
    for (const field of editable) {
      if (typeof req.body[field] === 'string') {
        company[field] = req.body[field].trim();
        touched = true;
      }
    }
    if (touched) await company.save();

    res.status(201).json({ success: true, data: company });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/companies/:id
export const updateCompany = async (req, res) => {
  try {
    const company = await Company.findOne({
      _id: req.params.id,
      organization: req.organization._id,
    });

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found.' });
    }

    if (typeof req.body.name === 'string') {
      if (!req.body.name.trim()) {
        return res.status(400).json({ success: false, message: 'Company name cannot be empty.' });
      }
      const newKey = normalizeCompanyName(req.body.name);
      // Name uniqueness now applies only to unresolved placeholders, so this
      // guard must match that index — two identified companies are allowed to
      // share a name (that is the whole point of keying on identity).
      if (newKey !== company.nameKey) {
        const clash = (company.linkedinKey || company.domainKey)
          ? null
          : await Company.findOne({
              organization: req.organization._id,
              nameKey: newKey,
              linkedinKey: '',
              domainKey: '',
              _id: { $ne: company._id },
            }).lean();
        if (clash) {
          return res.status(409).json({ success: false, message: 'Another company with this name already exists.' });
        }
        company.nameKey = newKey;
      }
      company.name = req.body.name.trim();
    }

    // Setting a website/domain/LinkedIn URL resolves the company's identity, so
    // the pre('validate') hook re-derives the keys and the analysis is no
    // longer describing whatever we previously guessed.
    for (const field of ['website', 'domain', 'industry', 'size', 'linkedinUrl']) {
      if (typeof req.body[field] === 'string') company[field] = req.body[field].trim();
    }
    if (company.isModified('domain') || company.isModified('website') || company.isModified('linkedinUrl')) {
      company.needsReview = false;
      company.reviewReason = '';
    }

    await company.save();
    res.json({ success: true, data: company });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/companies/:id/analyze
// Runs (or re-runs with force=true) the independent AI analysis (HLD §2.2).
export const analyzeCompanyHandler = async (req, res) => {
  try {
    const company = await Company.findOne({
      _id: req.params.id,
      organization: req.organization._id,
    });

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found.' });
    }

    const force = req.body?.force === true || req.query.force === 'true';
    const analyzed = await analyzeCompany(company, { force });

    res.json({
      success: true,
      data: analyzed,
      analyzed: Boolean(analyzed?.aiAnalysis?.lastAnalyzedAt),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/companies/:id/detect-signals
// Runs company-level Signals against this company (HLD §3.3). With a
// `signalIds` body the caller picks exactly which ones run; without it, every
// active company Signal in the org does (the pipeline's behaviour).
export const detectSignalsHandler = async (req, res) => {
  try {
    // Validated here rather than handed straight to the query: an unparseable
    // id would make the $in match nothing, and "no signals defined" is a very
    // different thing to report than "your request was malformed".
    const { signalIds } = req.body || {};
    if (signalIds !== undefined) {
      if (!Array.isArray(signalIds) || signalIds.length === 0) {
        return res.status(400).json({ success: false, message: 'Select at least one signal to detect.' });
      }
      if (!signalIds.every((id) => mongoose.Types.ObjectId.isValid(id))) {
        return res.status(400).json({ success: false, message: 'One or more selected signals are invalid.' });
      }
    }

    const company = await Company.findOne({
      _id: req.params.id,
      organization: req.organization._id,
    });

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found.' });
    }

    // Signals searched on a bare name can belong to a namesake, and they get
    // injected verbatim into outreach — so this needs a verified identity.
    if (!company.domainKey && !company.linkedinKey) {
      return res.status(409).json({
        success: false,
        code: 'NO_VERIFIED_IDENTITY',
        message: "Set this company's website or LinkedIn page before detecting signals — without one, results may describe a different company with the same name.",
      });
    }

    // Selection is still scoped to the org inside getActiveSignals, so an id
    // belonging to another tenant simply matches nothing.
    const entries = await detectCompanySignals(company, { selectedSignalIds: signalIds || [] });
    res.json({ success: true, data: company, detected: entries.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/companies/:id/find-contacts
// Runs (or re-runs with force=true) the AI contact-finder agent over the
// company's own website (homepage + a discovered contact/about/team page).
export const findContactsHandler = async (req, res) => {
  try {
    const company = await Company.findOne({
      _id: req.params.id,
      organization: req.organization._id,
    });

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found.' });
    }

    if (!company.website) {
      return res.status(409).json({
        success: false,
        code: 'NO_WEBSITE',
        message: "Set this company's website before finding contacts.",
      });
    }

    const force = req.body?.force === true || req.query.force === 'true';
    let updated = await findCompanyContacts(company, { force });

    // The website scan often turns up no LinkedIn link at all — actively
    // search for the company's LinkedIn page as a fallback when we still
    // don't have one, rather than leaving it permanently unresolved.
    let linkedinFound = false;
    if (updated && !updated.linkedinKey) {
      updated = (await resolveCompanyLinkedin(updated)) || updated;
      linkedinFound = Boolean(updated.linkedinKey);
    }

    res.json({
      success: true,
      data: updated,
      found: updated?.contacts?.length || 0,
      linkedinFound,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/companies/:id/find-linkedin
// Actively searches for (and AI-verifies) this company's LinkedIn page when
// it isn't already known. Run standalone, or automatically after find-contacts.
export const findLinkedinHandler = async (req, res) => {
  try {
    const company = await Company.findOne({
      _id: req.params.id,
      organization: req.organization._id,
    });

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found.' });
    }

    const force = req.body?.force === true || req.query.force === 'true';
    const updated = await resolveCompanyLinkedin(company, { force });

    res.json({
      success: true,
      data: updated,
      found: Boolean(updated?.linkedinKey),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/companies/:id/find-prospects
// Searches for people at this company matching an attached Playbook (+ optional
// Personas) and stores them as reviewable candidates. Creates nothing.
export const findProspectsHandler = async (req, res) => {
  try {
    const { playbookId, personaIds = [] } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(playbookId || '')) {
      return res.status(400).json({ success: false, message: 'Attach a playbook to search with.' });
    }
    if (!Array.isArray(personaIds) || !personaIds.every((id) => mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ success: false, message: 'One or more selected personas are invalid.' });
    }

    const company = await Company.findOne({
      _id: req.params.id,
      organization: req.organization._id,
    });

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found.' });
    }

    // Same rule as signal detection: a people search keyed on a bare name finds
    // the namesake's staff just as happily, and those become real prospects.
    if (!company.domainKey && !company.linkedinKey) {
      return res.status(409).json({
        success: false,
        code: 'NO_VERIFIED_IDENTITY',
        message: "Set this company's website or LinkedIn page before finding prospects — without one, the search may return people from a different company with the same name.",
      });
    }

    const playbook = await Playbook.findOne({ _id: playbookId, organization: req.organization._id }).lean();
    if (!playbook) {
      return res.status(404).json({ success: false, message: 'Playbook not found.' });
    }

    const personas = personaIds.length
      ? await Persona.find({ _id: { $in: personaIds }, organization: req.organization._id })
          .select('_id name prompt')
          .lean()
      : [];

    const updated = await findCompanyProspects(company, { playbook, personas });
    const candidates = updated.prospectSearch?.candidates || [];

    res.json({
      success: true,
      data: updated,
      found: candidates.filter((c) => !c.imported).length,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/companies/:id/import-prospects
// Turns selected candidates into real Prospects and starts the pipeline on each.
export const importProspectsHandler = async (req, res) => {
  try {
    const { candidateIds } = req.body || {};
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Select at least one prospect to import.' });
    }

    const company = await Company.findOne({
      _id: req.params.id,
      organization: req.organization._id,
    });

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found.' });
    }

    const wanted = new Set(candidateIds.map(String));
    const selected = (company.prospectSearch?.candidates || []).filter(
      (c) => wanted.has(String(c._id)) && !c.imported
    );

    if (!selected.length) {
      return res.status(400).json({ success: false, message: 'Those candidates are no longer available to import.' });
    }

    // Clamp to what the plan still allows rather than failing the whole batch —
    // importing the first eight of ten is more useful than importing none.
    //
    // Counted live instead of read from `usage.prospectsThisMonth`, because that
    // counter only increments when a pipeline COMPLETES (runner.js) and so lags
    // every prospect still sitting in the queue. One import of 25 leaves it
    // reading zero, and a second import moments later would be handed the same
    // full headroom — together overshooting the plan by a batch. Prospects exist
    // the instant they are created, so counting them is what makes this hold.
    const limit = req.organization.getProspectLimit();
    const usedThisPeriod = await Prospect.countDocuments({
      organization: req.organization._id,
      createdAt: { $gte: req.organization.usage?.lastResetAt || new Date(0) },
    });
    const available = limit - usedThisPeriod;

    if (available <= 0) {
      return res.status(403).json({
        success: false,
        code: 'LIMIT_REACHED',
        message: `You've reached your plan limit (${limit} prospects/month). Upgrade to import more.`,
      });
    }

    const toImport = selected.slice(0, available);
    const imported = [];

    for (const candidate of toImport) {
      // The employer hint is what makes ensureCompanyLink resolve back to THIS
      // company with honest provenance ('linkedin-company' / 'domain-hint')
      // instead of a weak name-only match. The identity guard on the search
      // above guarantees at least one of these exists.
      const prospect = await Prospect.create({
        organization: req.organization._id,
        createdBy: req.user._id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        company: company.name,
        rawLinkedin: candidate.linkedinUrl,
        rawCompanyLinkedin: company.linkedinUrl || '',
        rawCompanyDomain: company.domain || '',
        description: candidate.matchReason
          ? `Found by the prospect finder${company.prospectSearch?.playbookName ? ` using the "${company.prospectSearch.playbookName}" playbook` : ''}: ${candidate.matchReason}`
          : '',
      });

      await ensureCompanyLink(prospect).catch(() => null);

      candidate.imported = true;
      candidate.prospect = prospect._id;
      imported.push(prospect);
      // Not queued: like every other creation path, imported candidates wait in
      // 'not-started' until the user starts them.
    }

    await company.save();

    res.status(201).json({
      success: true,
      data: company,
      imported: imported.length,
      skipped: selected.length - imported.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/companies/duplicates
// Likely duplicate pairs awaiting review. Read-only — merging is always an
// explicit second call, so nothing collapses without the user seeing it first.
export const getDuplicatesHandler = async (req, res) => {
  try {
    // Pairs already carry prospectCount — it is what decided which side is
    // primary, so re-counting here could only disagree with the pick shown.
    const data = await findDuplicateGroups(req.organization._id);

    res.json({ success: true, data, count: data.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/companies/:id/merge  { duplicateId }
// Folds `duplicateId` into `:id` and deletes it. Irreversible, so the caller
// names both sides explicitly rather than letting the server choose.
export const mergeCompanyHandler = async (req, res) => {
  try {
    const { duplicateId } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(duplicateId || '')) {
      return res.status(400).json({ success: false, message: 'Select which company to merge in.' });
    }
    if (String(duplicateId) === String(req.params.id)) {
      return res.status(400).json({ success: false, message: 'A company cannot be merged into itself.' });
    }

    const { company, movedProspects, mergedName } = await mergeCompanies({
      organization: req.organization._id,
      primaryId: req.params.id,
      duplicateId,
    });

    res.json({ success: true, data: company, movedProspects, mergedName });
  } catch (error) {
    const notFound = /not found/i.test(error.message);
    res.status(notFound ? 404 : 500).json({ success: false, message: error.message });
  }
};

// DELETE /api/companies/:id
// Unlinks referencing prospects (clears companyRef) so no dangling refs remain.
export const deleteCompany = async (req, res) => {
  try {
    const company = await Company.findOneAndDelete({
      _id: req.params.id,
      organization: req.organization._id,
    }).lean();

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found.' });
    }

    await Prospect.updateMany(
      { organization: req.organization._id, companyRef: company._id },
      { $unset: { companyRef: '' } }
    );

    res.json({ success: true, message: 'Company deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
