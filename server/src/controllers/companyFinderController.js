import { getSource, listSources } from '../services/finder/sourceRegistry.js';
import { findOrCreateCompany } from '../services/company/companyService.js';

const DEFAULT_PAGE = 1;

// GET /api/company-finder/sources
export const getSources = async (req, res) => {
  res.json({ success: true, data: listSources() });
};

// GET /api/company-finder/companies?source=cryptojobslist&q=&sort=&page=
export const browseCompanies = async (req, res) => {
  try {
    const { source = 'cryptojobslist', q = '', sort = '', page } = req.query;
    const adapter = getSource(source);
    if (!adapter) {
      return res.status(400).json({ success: false, message: `Unknown source "${source}"` });
    }

    const pageNum = Math.max(parseInt(page, 10) || DEFAULT_PAGE, 1);
    const { companies, pagination } = await adapter.browse({ query: q, sort, page: pageNum });

    res.json({ success: true, data: companies, pagination });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/company-finder/companies/:source/:slug
export const getCompanyDetail = async (req, res) => {
  try {
    const { source, slug } = req.params;
    const adapter = getSource(source);
    if (!adapter) {
      return res.status(400).json({ success: false, message: `Unknown source "${source}"` });
    }

    const detail = await adapter.getDetail({ slug });
    if (!detail) {
      return res.status(404).json({ success: false, message: 'Company not found on source' });
    }

    res.json({ success: true, data: detail });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/company-finder/companies/:source/:slug/save
export const saveCompany = async (req, res) => {
  try {
    const { source, slug } = req.params;
    const adapter = getSource(source);
    if (!adapter) {
      return res.status(400).json({ success: false, message: `Unknown source "${source}"` });
    }

    // Re-fetch server-side rather than trusting a client-supplied payload.
    const detail = await adapter.getDetail({ slug });
    if (!detail) {
      return res.status(404).json({ success: false, message: 'Company not found on source' });
    }

    const company = await findOrCreateCompany({
      organization: req.organization._id,
      name: detail.name,
      website: detail.website,
      createdBy: req.user._id,
    });

    if (!company) {
      return res.status(400).json({ success: false, message: 'Could not save company — no name or website found' });
    }

    const sourceRefs = [{ source: detail.source, url: detail.sourceUrl, note: 'Company Finder import' }];
    if (detail.twitter) sourceRefs.push({ source: 'twitter', url: detail.twitter });
    if (detail.github) sourceRefs.push({ source: 'github', url: detail.github });
    if (detail.discord) sourceRefs.push({ source: 'discord', url: detail.discord });

    // Was scraped but previously discarded — useful as a query qualifier when
    // later searching for this company's LinkedIn page (see linkedinResolver.js).
    if (detail.location && !company.headquarters) {
      company.headquarters = detail.location;
    }

    company.sourceRefs.push(...sourceRefs);
    await company.save();

    res.json({ success: true, data: company });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
