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
import { scrapeLinkedInCompany } from '../scraper/linkedinCompanyScraper.js';
import { recordLinkedInAuthFailure } from '../scraper/linkedinSessionAlert.js';
import { clipPromptText } from '../pipeline/profileSnapshot.js';
import { registrableDomain, normalizeDomainKey } from '../../utils/domains.js';

const SYSTEM_PROMPT = `You are a precision company-research engine for a B2B prospect intelligence platform.
Given raw public context about a company, produce a concise, factual analysis.
Never invent facts — if the context doesn't support a field, leave it empty.

Distinguish what a company SAYS about itself from what is independently reported.
Marketing copy a company wrote about itself is evidence of positioning, not of
fact. Never restate a self-reported figure, ranking, or superlative as though it
were established: attribute it ("the company says…", "it describes itself as…")
or leave it out. This output is used to write outreach that the company's own
employees will read, and a confidently wrong number is worse than no number.

Always return valid JSON.`;

const SOCIAL_HOSTS = ['linkedin.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'crunchbase.com', 'github.com', 'wikipedia.org', 'youtube.com'];

/** Registrable domain of a URL — eTLD+1, so foo.co.uk stays foo.co.uk. */
const extractDomain = (url = '') => registrableDomain(url);

/** The identity this company's research is (or would be) tied to. */
const identityKeyOf = (company) => company.linkedinKey || company.domainKey || '';

/**
 * Gather public context for a company.
 *
 * The mode matters enormously. With a verified identity we read facts from the
 * company's own LinkedIn page or site. Without one we must NOT pick a website
 * off a name search — that is precisely how a namesake's facts ended up on the
 * record, and now that domain would become a unique identity key, making the
 * mistake permanent and contagious.
 */
const gatherContext = async (company) => {
  const sourceRefs = [];
  let website = (company.website || '').trim();
  let snippets = '';
  let websiteText = '';
  let linkedinFacts = null;
  let mode = 'name-only';

  // 1. The employer's own LinkedIn page — exact entity, published facts.
  if (company.linkedinKey) {
    mode = 'linkedin';
    try {
      const about = await scrapeLinkedInCompany(company.linkedinKey);
      if (about && !about.authFailed) {
        linkedinFacts = about;
        if (!website && about.website) website = about.website;
        sourceRefs.push({ source: 'linkedin', url: about.linkedinUrl });
      } else if (about?.authFailed) {
        console.warn(`[companyAnalyzer] LinkedIn session dead — falling back to web for "${company.name}"`);
        // Company analysis degrades to web research rather than failing, which
        // means nothing else here would ever tell the user their session died —
        // they'd just get quietly worse company data. Record it so the UI can.
        await recordLinkedInAuthFailure('company-analysis').catch((e) =>
          console.warn('[companyAnalyzer] Failed to record LinkedIn auth failure:', e.message)
        );
        mode = company.domainKey || website ? 'domain' : 'name-only';
      }
    } catch (err) {
      console.warn(`[companyAnalyzer] LinkedIn company scrape failed for "${company.name}": ${err.message}`);
      mode = company.domainKey || website ? 'domain' : 'name-only';
    }
  } else if (company.domainKey || website) {
    mode = 'domain';
  }

  const domainKey = company.domainKey || normalizeDomainKey(website);

  // 2. Search snippets — anchored on the verified domain whenever we have one.
  try {
    const query = domainKey
      ? `"${company.name}" "${domainKey}"`
      : `"${company.name}" company`;
    const results = await searchGoogle(query);
    snippets = results
      .map((r) => `- ${r.title || ''}: ${r.snippet || ''}`)
      .filter((s) => s.length > 5)
      .join('\n');
    if (snippets) sourceRefs.push({ source: 'serper', note: `query: ${query}` });
  } catch (err) {
    console.warn(`[companyAnalyzer] Serper failed for "${company.name}": ${err.message}`);
  }

  // 3. Website scrape — ONLY a website we can vouch for. Never one picked off
  //    a name search: an unverified guess must not become an identity key.
  if (!website && domainKey) website = `https://${domainKey}`;
  if (website && (company.linkedinKey || domainKey)) {
    try {
      const page = await scrapePage(website);
      if (page?.text) {
        websiteText = page.text;
        sourceRefs.push({ source: 'website', url: website });
      }
    } catch (err) {
      console.warn(`[companyAnalyzer] Website scrape failed for ${website}: ${err.message}`);
    }
  } else if (!domainKey && !company.linkedinKey) {
    website = ''; // nothing verified — do not persist a guess
  }

  // 4. Evidence from prospects already linked to this company
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

  return { website, snippets, websiteText, prospectEvidence, sourceRefs, linkedinFacts, mode };
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

  // Persistent knowledge: analyzed once, reused (HLD §5.1/§5.2) — but only
  // while it still describes the SAME entity. When a placeholder is later
  // resolved to a real company its identity key changes, and the cached
  // summary (written about an unverified name) becomes wrong by definition, so
  // it re-analyzes on its own without needing a migration to chase it.
  const identityKey = identityKeyOf(company);
  if (company.aiAnalysis?.lastAnalyzedAt && company.aiAnalysis?.analyzedForKey === identityKey && !force) {
    return company;
  }

  const { website, snippets, websiteText, prospectEvidence, sourceRefs, linkedinFacts, mode } =
    await gatherContext(company);

  const hasContext = Boolean(snippets || websiteText || prospectEvidence || linkedinFacts?.description);
  if (!hasContext) {
    console.warn(`[companyAnalyzer] No public context found for "${company.name}" — skipping analysis`);
    return company;
  }

  const verified = mode !== 'name-only';

  // Without a verified identity the context may describe any company sharing
  // this name, so say so rather than letting the model narrate confidently.
  const uncertaintyNote = verified
    ? ''
    : `\nIMPORTANT: this company's identity is UNCONFIRMED — no verified website or LinkedIn page
is known, and several unrelated organizations may share this name. State only facts the context
ties unambiguously to a single organization; leave any field you cannot pin down as "".\n`;

  const userPrompt = `Analyze this company from the public context below.
${uncertaintyNote}
Company name: ${company.name}
${website ? `Website: ${website}` : ''}
${company.linkedinUrl ? `LinkedIn: ${company.linkedinUrl}` : ''}

${linkedinFacts ? `=== THE COMPANY'S OWN DESCRIPTION (self-authored marketing copy) ===
This text confirms WHICH company this is, and is reliable for that. The claims
inside it are the company's own — treat figures, rankings and superlatives as
claims to attribute, not as verified facts.
${clipPromptText(
    [linkedinFacts.description, linkedinFacts.specialties?.length ? `Specialties: ${linkedinFacts.specialties.join(', ')}` : '']
      .filter(Boolean).join('\n'),
    3000
  )}\n` : ''}
${websiteText ? `=== WEBSITE CONTENT ===\n${clipPromptText(websiteText, 4000)}\n` : ''}
${snippets ? `=== GOOGLE SNIPPETS ===\n${clipPromptText(snippets, 1500)}\n` : ''}
${prospectEvidence ? `=== PEOPLE AT THIS COMPANY (from our data) ===\n${clipPromptText(prospectEvidence, 1500)}\n` : ''}
Return JSON:
{
  "summary": "3-5 sentence factual overview: what the company does, its market, product, positioning, and anything notable (funding, growth, hiring). Grounded in the context only. Any figure or superlative that comes only from the company's own description must be attributed to them, not stated as fact.",
  "industry": "short industry label, e.g. 'Web3 Recruiting' — empty string if unclear",
  "size": "employee-range estimate like '1-10', '11-50', '51-200' — empty string if unclear"
}`;

  try {
    const result = await callAI({ systemPrompt: SYSTEM_PROMPT, userPrompt, maxTokens: 1024, jsonMode: true, thinkingBudget: 0 });

    company.aiAnalysis = {
      summary: typeof result?.summary === 'string' ? result.summary : '',
      lastAnalyzedAt: new Date(),
      // Stamped even for an unverified run, so we don't re-burn tokens every
      // pass — the mismatch check above re-triggers the moment a key arrives.
      analyzedForKey: identityKey,
      source: mode === 'linkedin' ? 'linkedin' : verified ? 'web' : 'none',
    };

    // Facts published by the company itself outrank anything the model inferred.
    if (linkedinFacts) {
      if (linkedinFacts.industry) company.industry = linkedinFacts.industry;
      if (linkedinFacts.size) company.size = linkedinFacts.size;
      if (linkedinFacts.headquarters) company.headquarters = linkedinFacts.headquarters;
      if (linkedinFacts.founded) company.founded = linkedinFacts.founded;
      if (linkedinFacts.linkedinUrl) company.linkedinUrl = linkedinFacts.linkedinUrl;
    }

    // Only persist a website we can vouch for. Writing back a search guess is
    // what created the original bug, and it would now become an identity key.
    if (verified && website && !company.website) {
      company.website = website;
      company.domain = company.domain || extractDomain(website);
      if (!company.domainKey) company.domainKey = normalizeDomainKey(website);
    }

    if (result?.industry && !company.industry) company.industry = String(result.industry);
    if (result?.size && !company.size) company.size = String(result.size);
    if (sourceRefs.length) company.sourceRefs.push(...sourceRefs);

    company.needsReview = !verified;
    company.reviewReason = verified ? '' : 'no-verified-identity';

    await company.save();
    console.log(`[companyAnalyzer] ✅ Analyzed "${company.name}" (${mode})`);
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
