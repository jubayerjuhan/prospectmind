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
import { scrapeLinkedInCompany } from '../scraper/linkedinCompanyScraper.js';
import { recordLinkedInAuthFailure } from '../scraper/linkedinSessionAlert.js';
import { linkedinCompanyKey, linkedinCompanyUrl, normalizeDomainKey, isSameBrandDomain } from '../../utils/domains.js';
import { domainsResolveToSame } from '../../utils/domainRedirect.js';
import { clipPromptText } from '../pipeline/profileSnapshot.js';

const MIN_CONFIDENCE = 60;

/**
 * A brand-alias candidate (certik.org vs certik.com with no redirect between
 * them) is weaker evidence than an exact or redirect-proven domain, so the AI
 * has to be more sure before one is accepted.
 */
const MIN_ALIAS_CONFIDENCE = 75;

// Each check opens a real authenticated LinkedIn session — bounded to keep a
// single resolution from taking minutes or hammering the shared login. Kept
// a bit above the number of query strategies below: each strategy can
// contribute a junk candidate before a real match appears in a later one, and
// checks are consumed in pool order, so too tight a cap can starve a real
// match out of ever being checked.
const MAX_DOMAIN_CHECKS = 6;

/** "San Francisco, Seattle, London, ..." → "San Francisco". A source's full
 *  location list quoted verbatim as one exact phrase matches nothing — only
 *  the primary (first-listed) location is usable as an X-ray search term. */
const primaryLocation = (headquarters = '') => headquarters.split(',')[0].trim();

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
    // A location qualifier is an X-ray-search narrowing technique: it cuts
    // through generic-name collisions (many "Atlas"es, one "Atlas" in Austin)
    // the same way the domain qualifier does. headquarters is only ever
    // populated from a source that actually reports it (e.g. Company Finder
    // import) — never guessed — so this is real signal when present.
    company.headquarters ? `"${company.name}" "${primaryLocation(company.headquarters)}" site:linkedin.com/company` : null,
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

/** Facts scraped from a candidate's own About page, for the AI prompt. */
const aboutFactsBlock = (url, about) => {
  if (!about) return '';
  const facts = [
    about.website ? `website ${about.website}` : '',
    about.industry ? `industry ${about.industry}` : '',
    about.headquarters ? `HQ ${about.headquarters}` : '',
    about.size ? `size ${about.size}` : '',
    about.founded ? `founded ${about.founded}` : '',
  ].filter(Boolean).join(' · ');
  const overview = about.description ? `\n  overview: ${clipPromptText(about.description, 400)}` : '';
  return `- ${url}\n  ${facts}${overview}`;
};

const verifyWithAI = async (company, candidates, searchResults, callAI, { aboutByUrl = null, aliasMode = false } = {}) => {
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

${aliasMode ? `
IMPORTANT — this is an alternate-domain decision. None of these candidates state the exact domain we
hold for the company; each states a DIFFERENT domain that shares the same brand name (e.g. we know
acme.org, the page states acme.com). A company routinely owns its brand across several TLDs and
publishes only one of them, so this is often the same company — but two unrelated organizations can
also hold the same brand under different TLDs. Decide from the scraped About facts below (industry,
headquarters, size, founding year, overview) whether this page describes the SAME organization we
know, not merely one with a similar-looking domain. If the facts contradict what we know, or say too
little to tell, return null.
` : ''}
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
${aboutByUrl ? `
Facts scraped from each candidate's own LinkedIn About page (authoritative — prefer these over snippets):
${candidates.map((u) => aboutFactsBlock(u, aboutByUrl.get(u))).filter(Boolean).join('\n')}
` : ''}
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
 * Mechanically classify candidates by reading each one's own LinkedIn About
 * page and comparing the website IT states to the domain we already trust.
 *
 * This exists because the AI's textual reasoning can confabulate: verifying
 * "Assetize" (assetize.xyz), it picked an unrelated "assetize.today" company
 * with the justification that the domain matched — but neither candidate's
 * search snippet mentioned a domain at all. A scraped fact from the page
 * itself can't be talked into agreeing with a domain it never states.
 *
 * But an exact string match is too strict to be the only accept path. One
 * company legitimately has several domains, and the one on LinkedIn need not
 * be the one we hold: CertiK's page states certik.com while our record came
 * from certik.org. So a non-identical domain is graded rather than discarded:
 *
 *   exact    the stated domain IS our domain — proof.
 *   alias    the two provably serve one site (certik.org redirects to
 *            certik.com) — also proof, and it catches rebrands where the
 *            brands differ entirely (oldname.com → newname.io).
 *   alias    same brand under a different TLD with no redirect between them —
 *            a lead, not proof: unrelated owners can hold acme.com and
 *            acme.org, so these go to the AI with the scraped facts attached.
 *
 * @returns {Promise<{exact: string[], alias: object[], aboutByUrl: Map, anyFetchSucceeded: boolean}>}
 *   anyFetchSucceeded distinguishes "checked and none matched" (provably
 *   wrong — reject) from "couldn't check any of them" (session likely down —
 *   fall back to text-only verification instead of refusing outright).
 */
const domainVerifyCandidates = async (candidates, domainKey) => {
  const exact = [];
  const alias = [];
  const aboutByUrl = new Map();
  let anyFetchSucceeded = false;

  for (const url of candidates.slice(0, MAX_DOMAIN_CHECKS)) {
    const key = linkedinCompanyKey(url);
    const about = await scrapeLinkedInCompany(key);
    if (!about || about.authFailed) {
      // A dead session here is invisible otherwise: anyFetchSucceeded stays
      // false, the caller quietly drops to text-only verification, and that is
      // exactly the weaker path this whole mechanical check exists to avoid.
      if (about?.authFailed) {
        await recordLinkedInAuthFailure('company-linkedin-search').catch((e) =>
          console.warn('[linkedinResolver] Failed to record LinkedIn auth failure:', e.message)
        );
      }
      continue;
    }

    anyFetchSucceeded = true;
    aboutByUrl.set(url, about);

    const aboutDomain = about.domain || normalizeDomainKey(about.website);
    if (!aboutDomain) continue;

    if (aboutDomain === domainKey) {
      exact.push(url);
    } else if (await domainsResolveToSame(aboutDomain, domainKey)) {
      alias.push({ url, aboutDomain, proof: 'redirect' });
    } else if (isSameBrandDomain(aboutDomain, domainKey)) {
      alias.push({ url, aboutDomain, proof: 'brand' });
    }
  }

  return { exact, alias, aboutByUrl, anyFetchSucceeded };
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
  let mechanicallyChecked = false;

  // Prefer mechanical proof (the candidate's own About page) over textual
  // inference whenever we have a domain to check it against.
  if (company.domainKey) {
    const { exact, alias, aboutByUrl, anyFetchSucceeded } = await domainVerifyCandidates(candidates, company.domainKey);
    mechanicallyChecked = anyFetchSucceeded;

    if (anyFetchSucceeded && exact.length === 0 && alias.length === 0) {
      // We read real About pages and none state our domain, a domain that
      // redirects to it, or even our brand under another TLD — each checked
      // candidate is provably a different company. Falling back to a text
      // guess here would just repeat the mistake this check exists to catch.
      console.log(`[linkedinResolver] Checked candidate About page(s) for "${company.name}" — none state domain ${company.domainKey} or an equivalent of it`);
      return company;
    }

    if (exact.length === 1) {
      [chosen] = exact;
      confidence = 100;
      reasoning = `Confirmed via the page's own About section — stated website matches ${company.domainKey}.`;
    } else if (exact.length > 1) {
      const v = await verifyWithAI(company, exact, results, callAI, { aboutByUrl });
      if (v.linkedinUrl && exact.includes(v.linkedinUrl) && v.confidenceScore >= MIN_CONFIDENCE) {
        chosen = v.linkedinUrl;
        confidence = v.confidenceScore;
        reasoning = v.reasoning;
      }
    } else if (alias.length) {
      // No exact match, but at least one candidate states a domain that may be
      // another face of ours. Redirect-proven ones are mechanical facts and
      // are decided here; brand-only lookalikes need the AI to compare the
      // scraped About facts against what we already know.
      const redirectProven = alias.filter((a) => a.proof === 'redirect');

      if (redirectProven.length === 1) {
        const [match] = redirectProven;
        chosen = match.url;
        confidence = 95;
        reasoning = `Confirmed via the page's own About section — stated website ${match.aboutDomain} and ${company.domainKey} resolve to the same site.`;
      } else {
        const pool = redirectProven.length > 1 ? redirectProven : alias;
        const urls = pool.map((a) => a.url);
        const v = await verifyWithAI(company, urls, results, callAI, { aboutByUrl, aliasMode: true });
        const threshold = redirectProven.length > 1 ? MIN_CONFIDENCE : MIN_ALIAS_CONFIDENCE;

        if (v.linkedinUrl && urls.includes(v.linkedinUrl) && v.confidenceScore >= threshold) {
          chosen = v.linkedinUrl;
          confidence = v.confidenceScore;
          const picked = pool.find((a) => a.url === v.linkedinUrl);
          reasoning = `${v.reasoning} (states ${picked.aboutDomain}, an alternate domain of ${company.domainKey})`;
        } else {
          console.log(`[linkedinResolver] Alternate-domain candidate(s) for "${company.name}" not confirmed as the same company — skipping`);
        }
      }
    }
  }

  // Text-only fallback: no domain to mechanically check against, or the
  // LinkedIn session was down for every candidate so it couldn't be checked.
  if (!chosen && !mechanicallyChecked) {
    if (candidates.length === 1) {
      // A single hit from a name/domain-scoped search — same trust level
      // discovery.js gives a lone person-profile match.
      [chosen] = candidates;
      confidence = 85;
      reasoning = 'Single LinkedIn company match found via search';
    } else {
      const v = await verifyWithAI(company, candidates, results, callAI);
      if (v.linkedinUrl && candidates.includes(v.linkedinUrl) && v.confidenceScore >= MIN_CONFIDENCE) {
        chosen = v.linkedinUrl;
        confidence = v.confidenceScore;
        reasoning = v.reasoning;
      }
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
