import Company from '../models/Company.js';
import Prospect from '../models/Prospect.js';
import { normalizeCompanyName, findOrCreateCompany } from '../services/company/companyService.js';
import { analyzeCompany } from '../services/company/companyAnalyzer.js';

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

    const prospectCount = await Prospect.countDocuments({
      organization: req.organization._id,
      companyRef: company._id,
      isArchived: false,
    });

    res.json({ success: true, data: { ...company, prospectCount } });
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
      // Guard the unique (organization, nameKey) index: block a rename that
      // would collide with a different existing company.
      if (newKey !== company.nameKey) {
        const clash = await Company.findOne({
          organization: req.organization._id,
          nameKey: newKey,
          _id: { $ne: company._id },
        }).lean();
        if (clash) {
          return res.status(409).json({ success: false, message: 'Another company with this name already exists.' });
        }
        company.nameKey = newKey;
      }
      company.name = req.body.name.trim();
    }

    for (const field of ['website', 'domain', 'industry', 'size']) {
      if (typeof req.body[field] === 'string') company[field] = req.body[field].trim();
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
