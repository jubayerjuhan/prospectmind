/**
 * Company LinkedIn Resolver.
 *
 * The website contact scan (contactFinder.js) only surfaces a LinkedIn page
 * when the company's own site happens to link to it — many don't. This fills
 * that gap by actively searching for it, mirroring discovery.js's person-lookup
 * pattern: Serper search for real candidate URLs, then AI verifies (never
 * guesses) the one that is actually this company.
 *
 * A wrong pick here is worse than a miss — linkedinKey is a unique identity key
 * (Company.js), so an incorrect match would permanently misattribute this
 * company's research to someone else's LinkedIn page. Low-confidence results
 * are dropped rather than accepted.
 */

import Company from '../../models/Company.js';
import { askClaude, AIFallbackRequiredError } from '../ai/claudeClient.js';
import { searchGoogle } from '../pipeline/discovery.js';
import { linkedinCompanyKey, linkedinCompanyUrl } from '../../utils/domains.js';
import { clipPromptText } from '../pipeline/profileSnapshot.js';

const MIN_CONFIDENCE = 60;

/**
 * Run every query and pool the results, rather than stopping at the first
 * strategy that returns anything. A quoted search for the exact display name
 * (which for an imported company can be a verbose legal-sounding name like
 * "Kraken Digital Asset Exchange") reliably surfaces data-broker DBA/alias
 * listings that spell that name out verbatim — and NOT the real branded page,
 * which just says "Kraken". Stopping early on that first hit meant the
 * broader query that would have found the real page never even ran. Pooling
 * candidates instead means a bad early match can't crowd out the real one —
 * it just becomes one more (rejectable) option for the AI to weigh.
 */
const findCandidates = async (company) => {
  const queries = [
    company.domainKey ? `"${company.domainKey}" site:linkedin.com/company` : null,
    `"${company.name}" site:linkedin.com/company`,
    `${company.name} company linkedin`,
  ].filter(Boolean);

  const byKey = new Map();
  const allResults = [];
  for (const query of queries) {
    console.log(`[linkedinResolver] Search: ${query}`);
    const results = await searchGoogle(query, { num: 8 });
    allResults.push(...results);
    for (const r of results) {
      if (!r.link) continue;
      const key = linkedinCompanyKey(r.link);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, linkedinCompanyUrl(key));
    }
  }
  return { candidates: [...byKey.values()], results: allResults };
};

const verifyWithAI = async (company, candidates, searchResults, callAI) => {
  const systemPrompt = `You are a company-identity verification assistant.
You are given REAL Google search results pointing to LinkedIn company pages. Pick the one that IS
this exact company — not a similarly named, unrelated, or different-industry organization sharing
the name. Do NOT invent or guess any URL; only select from the candidates list. Return null if none
match confidently.

Watch for these traps:
- Slugs like "undisclosed_<n>" or pages whose title starts "Undisclosed" are data-broker/DBA listings
  a third party created, NOT the company's own official page — even when their text repeats the
  company's legal name verbatim. Prefer the page that is actually BRANDED as the company (its slug
  and title are the company's own name, e.g. "kraken" / "krakenfx" for Kraken), not one that merely
  mentions the company.
- Company names imported from a directory are sometimes a verbose legal-style name (e.g. "Kraken
  Digital Asset Exchange") rather than the brand the company is actually known by and listed under on
  LinkedIn — don't penalize a candidate just for using a shorter/different-looking name if its content
  (industry, described product, and especially its stated website) matches.
- Snippets for real company pages usually state "Website: <domain>" — if a candidate's snippet gives a
  website domain, treat that as strong evidence for or against, comparing it to the known domain above.

Do NOT invent or guess; only select from the candidates list. Return null if none match confidently.
Always return valid JSON.`;

  // Duplicate hits across the pooled queries would just waste context.
  const seenLinks = new Set();
  const uniqueResults = searchResults.filter((r) => {
    if (!r.link || seenLinks.has(r.link)) return false;
    seenLinks.add(r.link);
    return true;
  });

  const userPrompt = `Company to identify:
- Name: ${company.name}
${company.domainKey ? `- Known website domain: ${company.domainKey}` : ''}
${company.industry ? `- Known industry: ${company.industry}` : ''}
${company.aiAnalysis?.summary ? `- Known summary: ${clipPromptText(company.aiAnalysis.summary, 500)}` : ''}

LinkedIn company page candidates (real URLs from Google):
${candidates.map((u, i) => `${i + 1}. ${u}`).join('\n')}

Search result snippets for context:
${uniqueResults.slice(0, 15).map((r) => `- ${r.title || ''}: ${r.snippet || ''} (${r.link})`).join('\n')}

Return JSON:
{
  "linkedinUrl": "exact URL from the candidates list above, or null if none confidently match",
  "confidenceScore": 0-100,
  "reasoning": "one sentence"
}`;

  try {
    const result = await callAI({ systemPrompt, userPrompt, maxTokens: 512, jsonMode: true, thinkingBudget: 0 });
    return {
      linkedinUrl: result?.linkedinUrl || null,
      confidenceScore: Number(result?.confidenceScore) || 0,
      reasoning: result?.reasoning || '',
    };
  } catch (error) {
    if (error instanceof AIFallbackRequiredError) {
      console.warn(`[linkedinResolver] AI unavailable for "${company.name}" — not guessing, skipping`);
      return { linkedinUrl: null, confidenceScore: 0, reasoning: 'AI unavailable' };
    }
    throw error;
  }
};

/**
 * Find (or re-find, with force) this company's LinkedIn page and, once
 * confidently identified, persist it as the company's linkedinUrl — the
 * pre('validate') hook on Company derives linkedinKey from it.
 *
 * @param {String|Object} companyOrId
 * @param {Object} opts
 * @param {Function} opts.callAI  AI caller (defaults to askClaude)
 * @param {Boolean} opts.force    Re-search even if linkedinKey is already set
 * @returns {Promise<Object|null>} the updated company, or null if not found
 */
export const resolveCompanyLinkedin = async (companyOrId, { callAI = askClaude, force = false } = {}) => {
  const company =
    typeof companyOrId === 'object' && companyOrId?._id
      ? companyOrId
      : await Company.findById(companyOrId);
  if (!company) return null;
  if (company.linkedinKey && !force) return company;

  const { candidates, results } = await findCandidates(company);
  if (!candidates.length) {
    console.log(`[linkedinResolver] No LinkedIn candidates for "${company.name}"`);
    return company;
  }

  let chosen = null;
  let confidence = 0;
  let reasoning = '';

  if (candidates.length === 1) {
    // A single hit from a name/domain-scoped search — same trust level
    // discovery.js gives a lone person-profile match.
    [chosen] = candidates;
    confidence = 85;
    reasoning = 'Single LinkedIn company match found via search';
  } else {
    const verified = await verifyWithAI(company, candidates, results, callAI);
    if (verified.linkedinUrl && candidates.includes(verified.linkedinUrl) && verified.confidenceScore >= MIN_CONFIDENCE) {
      chosen = verified.linkedinUrl;
      confidence = verified.confidenceScore;
      reasoning = verified.reasoning;
    }
  }

  if (!chosen) {
    console.log(`[linkedinResolver] No confident LinkedIn match for "${company.name}"`);
    return company;
  }

  company.linkedinUrl = chosen;
  company.sourceRefs.push({ source: 'linkedin-search', url: chosen, note: `confidence ${confidence}: ${reasoning}` });

  try {
    await company.save();
    console.log(`[linkedinResolver] ✅ "${company.name}" → ${chosen} (confidence ${confidence})`);
  } catch (error) {
    // Another company in this org already owns that slug (unique index) — the
    // match is wrong for OUR record even if it looked right, so back out
    // rather than leave the doc invalid or crash the caller.
    if (error?.code === 11000) {
      console.warn(`[linkedinResolver] "${chosen}" already belongs to another company — discarding match`);
      company.linkedinUrl = '';
      company.linkedinKey = '';
      company.sourceRefs.pop();
    } else {
      throw error;
    }
  }

  return company;
};
