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

/** Dedupe Serper results down to unique LinkedIn company/showcase pages. */
const extractCandidates = (results) => {
  const byKey = new Map();
  for (const r of results) {
    if (!r.link) continue;
    const key = linkedinCompanyKey(r.link);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, linkedinCompanyUrl(key));
  }
  return [...byKey.values()];
};

/** Progressively looser queries, most specific (verified domain) first. */
const findCandidates = async (company) => {
  const strategies = [
    company.domainKey ? `"${company.domainKey}" site:linkedin.com/company` : null,
    `"${company.name}" site:linkedin.com/company`,
    `${company.name} company linkedin`,
  ].filter(Boolean);

  for (const query of strategies) {
    console.log(`[linkedinResolver] Search: ${query}`);
    const results = await searchGoogle(query);
    const candidates = extractCandidates(results);
    if (candidates.length) return { candidates, results };
    console.log('[linkedinResolver] ↳ no candidates — trying next strategy');
  }
  return { candidates: [], results: [] };
};

const verifyWithAI = async (company, candidates, searchResults, callAI) => {
  const systemPrompt = `You are a company-identity verification assistant.
You are given REAL Google search results pointing to LinkedIn company pages. Pick the one that IS
this exact company — not a similarly named, unrelated, or different-industry organization sharing
the name. Do NOT invent or guess any URL; only select from the candidates list. Return null if none
match confidently.
Always return valid JSON.`;

  const userPrompt = `Company to identify:
- Name: ${company.name}
${company.domainKey ? `- Known website domain: ${company.domainKey}` : ''}
${company.industry ? `- Known industry: ${company.industry}` : ''}
${company.aiAnalysis?.summary ? `- Known summary: ${clipPromptText(company.aiAnalysis.summary, 500)}` : ''}

LinkedIn company page candidates (real URLs from Google):
${candidates.map((u, i) => `${i + 1}. ${u}`).join('\n')}

Search result snippets for context:
${searchResults.slice(0, 6).map((r) => `- ${r.title || ''}: ${r.snippet || ''} (${r.link})`).join('\n')}

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
