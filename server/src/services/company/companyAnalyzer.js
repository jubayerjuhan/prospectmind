/**
 * Company AI Analysis (v2 Phase A, HLD §2.2).
 *
 * Analyzes a Company independently of any prospect or campaign: gathers public
 * context (website scrape, Google snippets, evidence from linked prospects),
 * asks the AI for a structured summary, and stores it on the Company doc.
 *
 * Analyzed once and cached (HLD §5.1 persistent knowledge) — re-analysis only
 * happens with `force: true` (the future refresh endpoints will use this).
 */

import Company from '../../models/Company.js';
import Prospect from '../../models/Prospect.js';
import { askClaude, AIFallbackRequiredError } from '../ai/claudeClient.js';
import { searchGoogle } from '../pipeline/discovery.js';
import { scrapePage } from '../scraper/pageScraper.js';
import { clipPromptText } from '../pipeline/profileSnapshot.js';

const SYSTEM_PROMPT = `You are a precision company-research engine for a B2B prospect intelligence platform.
Given raw public context about a company, produce a concise, factual analysis.
Never invent facts — if the context doesn't support a field, leave it empty.
Always return valid JSON.`;

const SOCIAL_HOSTS = ['linkedin.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'crunchbase.com', 'github.com', 'wikipedia.org', 'youtube.com'];

const extractDomain = (url = '') => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Pick the most likely official website from Serper organic results. */
const pickOfficialWebsite = (results = []) => {
  for (const r of results) {
    const link = r?.link || '';
    if (!link) continue;
    if (SOCIAL_HOSTS.some((h) => link.includes(h))) continue;
    return link.split('?')[0];
  }
  return '';
};

/** Gather all available public context for a company. Best-effort per source. */
const gatherContext = async (company) => {
  const sourceRefs = [];
  let website = (company.website || '').trim();
  let snippets = '';
  let websiteText = '';

  // 1. Google snippets (also used to discover the website if unknown)
  try {
    const results = await searchGoogle(`"${company.name}" company`);
    snippets = results
      .map((r) => `- ${r.title || ''}: ${r.snippet || ''}`)
      .filter((s) => s.length > 5)
      .join('\n');
    if (snippets) sourceRefs.push({ source: 'serper', note: `query: "${company.name}" company` });

    if (!website) {
      website = pickOfficialWebsite(results);
    }
  } catch (err) {
    console.warn(`[companyAnalyzer] Serper failed for "${company.name}": ${err.message}`);
  }

  // 2. Website scrape
  if (website) {
    try {
      const page = await scrapePage(website);
      if (page?.text) {
        websiteText = page.text;
        sourceRefs.push({ source: 'website', url: website });
      }
    } catch (err) {
      console.warn(`[companyAnalyzer] Website scrape failed for ${website}: ${err.message}`);
    }
  }

  // 3. Evidence from prospects already linked to this company
  let prospectEvidence = '';
  try {
    const linked = await Prospect.find({
      organization: company.organization,
      companyRef: company._id,
      'enrichedProfile.bio': { $exists: true, $ne: '' },
    })
      .select('firstName lastName enrichedProfile.currentRole enrichedProfile.bio')
      .limit(5)
      .lean();

    prospectEvidence = linked
      .map((p) => `- ${p.firstName} ${p.lastName || ''} (${p.enrichedProfile?.currentRole || 'role unknown'}): ${clipPromptText(p.enrichedProfile?.bio, 240)}`)
      .join('\n');
    if (prospectEvidence) sourceRefs.push({ source: 'linked-prospects', note: `${linked.length} prospect profile(s)` });
  } catch (err) {
    console.warn(`[companyAnalyzer] Prospect evidence failed: ${err.message}`);
  }

  return { website, snippets, websiteText, prospectEvidence, sourceRefs };
};

/**
 * Analyze one company and persist the result.
 *
 * @param {String|Object} companyOrId  Company doc or id
 * @param {Object}   opts
 * @param {Function} opts.callAI  AI caller (defaults to askClaude)
 * @param {Boolean}  opts.force   Re-analyze even if cached
 * @returns {Promise<Object|null>} the updated company, or null on failure
 */
export const analyzeCompany = async (companyOrId, { callAI = askClaude, force = false } = {}) => {
  const company =
    typeof companyOrId === 'object' && companyOrId?._id
      ? companyOrId
      : await Company.findById(companyOrId);
  if (!company) return null;

  // Persistent knowledge: analyzed once, reused — unless forced (HLD §5.1/§5.2).
  if (company.aiAnalysis?.lastAnalyzedAt && !force) return company;

  const { website, snippets, websiteText, prospectEvidence, sourceRefs } = await gatherContext(company);

  const hasContext = Boolean(snippets || websiteText || prospectEvidence);
  if (!hasContext) {
    console.warn(`[companyAnalyzer] No public context found for "${company.name}" — skipping analysis`);
    return company;
  }

  const userPrompt = `Analyze this company from the public context below.

Company name: ${company.name}
${website ? `Website: ${website}` : ''}

${websiteText ? `=== WEBSITE CONTENT ===\n${clipPromptText(websiteText, 4000)}\n` : ''}
${snippets ? `=== GOOGLE SNIPPETS ===\n${clipPromptText(snippets, 1500)}\n` : ''}
${prospectEvidence ? `=== PEOPLE AT THIS COMPANY (from our data) ===\n${clipPromptText(prospectEvidence, 1500)}\n` : ''}
Return JSON:
{
  "summary": "3-5 sentence factual overview: what the company does, its market, product, positioning, and anything notable (funding, growth, hiring). Grounded in the context only.",
  "industry": "short industry label, e.g. 'Web3 Recruiting' — empty string if unclear",
  "size": "employee-range estimate like '1-10', '11-50', '51-200' — empty string if unclear"
}`;

  try {
    const result = await callAI({ systemPrompt: SYSTEM_PROMPT, userPrompt, maxTokens: 1024, jsonMode: true, thinkingBudget: 0 });

    company.aiAnalysis = {
      summary: typeof result?.summary === 'string' ? result.summary : '',
      lastAnalyzedAt: new Date(),
    };
    if (website && !company.website) {
      company.website = website;
      company.domain = company.domain || extractDomain(website);
    }
    if (result?.industry && !company.industry) company.industry = String(result.industry);
    if (result?.size && !company.size) company.size = String(result.size);
    if (sourceRefs.length) company.sourceRefs.push(...sourceRefs);

    await company.save();
    console.log(`[companyAnalyzer] ✅ Analyzed "${company.name}"`);
    return company;
  } catch (error) {
    if (error instanceof AIFallbackRequiredError) {
      console.warn(`[companyAnalyzer] AI fallback for "${company.name}" — analysis skipped`);
      return company;
    }
    console.warn(`[companyAnalyzer] Failed for "${company.name}": ${error.message}`);
    return company;
  }
};
