/**
 * Company Prospect Finder.
 *
 * Finds the RIGHT people at a known company, rather than any people. The user
 * attaches a Playbook (why they want to reach this company) and optionally the
 * Personas they target; both prompts become the search brief.
 *
 * Two AI calls bracket the search, and the split is the point:
 *   1. PLAN  — turn the brief into concrete Google queries. "Sell our staking
 *              product" is not a search term; "CTO OR Head of Engineering" is.
 *   2. VERIFY— read the results back and keep only people who actually work at
 *              THIS company and match the brief, with a stated reason.
 *
 * The AI never invents a person: every returned candidate must carry a LinkedIn
 * URL that appeared in the search results, and anything else is dropped. That is
 * the same rule discovery.js follows — search finds, AI only judges.
 *
 * Results are candidates, not prospects. Importing is a separate, explicit step
 * (see companyController.importProspectsHandler) so a loose run never spends the
 * org's prospect limit.
 */

import { askClaude, AIFallbackRequiredError } from '../ai/claudeClient.js';
import { searchGoogle } from '../pipeline/discovery.js';
import { clipPromptText } from '../pipeline/profileSnapshot.js';

const MAX_QUERIES = 4;
const RESULTS_PER_QUERY = 10;
const MAX_CANDIDATES = 25;

// How many pooled profiles may reach the verify prompt. This is the INPUT
// budget and is deliberately independent of MAX_CANDIDATES, which bounds the
// output: expressing the pool as `MAX_CANDIDATES * 2` made a search-breadth
// limit depend on a keep-count, so widening the search would have silently
// re-bound the pool through an unrelated constant. Today the search itself
// caps lower — MAX_QUERIES * RESULTS_PER_QUERY = 40 — so this does not yet
// truncate; it exists so that stays true on purpose rather than by accident.
const MAX_POOL = 50;

// The verify call is the one that can outgrow its budget: it may be handed up
// to MAX_POOL hits, and a full answer runs ~70 tokens per candidate (name,
// role, URL, a sentence of reasoning). At MAX_CANDIDATES that is ~1.8k, so the
// cap is set with headroom — a truncated response is unparseable JSON, which
// fails a run the user has already paid four searches for. The prompt caps the
// count too; this is the backstop for when the model ignores it.
const VERIFY_MAX_TOKENS = 4096;

const PLAN_SYSTEM_PROMPT = `You are a sourcing strategist. You convert a business brief into precise Google search queries that surface the LinkedIn profiles of specific people at a specific company.
You know that a query must contain job titles and the company name — never business goals, value propositions, or tone instructions.
Always return valid JSON.`;

const VERIFY_SYSTEM_PROMPT = `You are a precision people-matching engine for a B2B prospecting platform.
You are given Google search results and a brief describing which people at a company the user wants to reach.
Keep only real, named individuals whose result clearly indicates they currently work at the target company AND fit the brief.
Never invent a person and never invent a LinkedIn URL — you may only return URLs that appear verbatim in the results.
Discard company pages, job postings, aggregator listings, and anyone whose employer is ambiguous.
Always return valid JSON.`;

/** The playbook + personas, rendered as the brief both AI calls work from. */
const buildBrief = ({ playbook, personas = [] }) => {
  const personaBlock = personas.length
    ? personas
        .map((p) => `Persona — ${p.name}:\n${clipPromptText(p.prompt, 1200)}`)
        .join('\n\n')
    : '';

  return [
    `=== PLAYBOOK: ${playbook.name} (why we are approaching this company) ===\n${clipPromptText(playbook.prompt, 4000)}`,
    personaBlock ? `=== TARGET PERSONAS (the kind of person to find) ===\n${personaBlock}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
};

/** A short factual block so the planner qualifies queries with real details. */
const buildCompanyBlock = (company) =>
  [
    `Company name: ${company.name}`,
    company.domain ? `Website: ${company.domain}` : '',
    company.industry ? `Industry: ${company.industry}` : '',
    company.headquarters ? `Headquarters: ${company.headquarters}` : '',
    company.size ? `Size: ${company.size} employees` : '',
    company.aiAnalysis?.summary ? `What they do: ${clipPromptText(company.aiAnalysis.summary, 600)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

/**
 * Ask the AI for the search queries. Falls back to a plain title-free company
 * search so a planning failure degrades to fewer results rather than none.
 */
const planQueries = async (company, brief, callAI) => {
  const fallback = [`site:linkedin.com/in "${company.name}"`];

  const userPrompt = `Plan Google searches that will surface LinkedIn profiles of the people described below, at this specific company.

=== TARGET COMPANY ===
${buildCompanyBlock(company)}

${brief}

=== YOUR TASK ===
Write up to ${MAX_QUERIES} Google queries.

Rules:
1. Every query MUST include site:linkedin.com/in and the company name in quotes.
2. Derive job titles from the brief. Group synonyms with OR, e.g. ("CTO" OR "Head of Engineering" OR "VP Engineering").
3. Vary seniority and function across queries — do not write four near-identical searches.
4. Never put business goals, product names, or tone instructions in a query.
5. If the brief names no roles at all, search for leadership and decision-makers.

Return JSON:
{ "queries": ["site:linkedin.com/in \\"Acme\\" (\\"CTO\\" OR \\"VP Engineering\\")", "..."] }`;

  try {
    const res = await callAI({
      systemPrompt: PLAN_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 512,
      jsonMode: true,
      thinkingBudget: 0,
    });
    const queries = (Array.isArray(res?.queries) ? res.queries : [])
      .filter((q) => typeof q === 'string' && q.trim())
      .map((q) => q.trim())
      .slice(0, MAX_QUERIES);
    return queries.length ? queries : fallback;
  } catch (error) {
    if (error instanceof AIFallbackRequiredError) {
      console.warn(`[prospect-finder] Planning unavailable for ${company.name} — using a plain company search`);
      return fallback;
    }
    throw error;
  }
};

/**
 * linkedin.com/in/<slug>, normalized so the same person dedupes across queries.
 *
 * Scheme and subdomain are both rewritten in one pass. Doing it in two — one
 * rule for a regional prefix, one for a bare host — left `http://www.` matching
 * neither, so the same profile arriving over http and https produced two keys:
 * a silent duplicate in the results, and a miss against the verify allowlist.
 */
const normalizeProfileUrl = (link = '') => {
  if (!link.includes('linkedin.com/in/')) return '';
  return link
    .replace(/^https?:\/\/([a-z0-9-]+\.)?linkedin\.com/i, 'https://www.linkedin.com')
    .split('?')[0]
    .replace(/\/$/, '')
    .toLowerCase();
};

/** Run every planned query and pool the LinkedIn hits, deduped by profile URL. */
const gatherSearchHits = async (queries) => {
  const byUrl = new Map();

  for (const query of queries) {
    const results = await searchGoogle(query, { num: RESULTS_PER_QUERY });
    for (const r of results) {
      const url = normalizeProfileUrl(r.link || '');
      if (!url || byUrl.has(url)) continue;
      byUrl.set(url, { url, title: r.title || '', snippet: r.snippet || '' });
    }
  }

  return [...byUrl.values()].slice(0, MAX_POOL);
};

/** Judge the pooled hits against the brief. Returns candidate objects. */
const verifyCandidates = async ({ company, brief, hits, callAI }) => {
  const numbered = hits
    .map((h, i) => `[${i + 1}] ${h.url}\nTitle: ${h.title}\nSnippet: ${clipPromptText(h.snippet, 300)}`)
    .join('\n\n');

  const userPrompt = `Decide which of these search results are people we should reach at the target company.

=== TARGET COMPANY ===
${buildCompanyBlock(company)}

${brief}

=== SEARCH RESULTS ===
${numbered}

=== YOUR TASK ===
Return only people who (a) currently work at ${company.name} according to their result, and (b) match the brief.

Rules:
1. linkedinUrl MUST be copied verbatim from a result above. Never construct one.
2. Split the person's name into firstName and lastName. Drop any result with no readable human name.
3. role is their current job title at ${company.name}, as stated in the result.
4. matchReason is ONE sentence saying why this person fits the brief, referencing their role.
5. confidence 0.0-1.0 reflects how certain you are they currently work there AND match.
6. Return at most ${MAX_CANDIDATES} candidates. If more than that qualify, keep the highest-confidence ones.
7. An empty list is a valid, correct answer. Never pad it.

Return JSON:
{ "candidates": [ { "firstName": "…", "lastName": "…", "role": "…", "linkedinUrl": "…", "matchReason": "…", "confidence": 0.0 } ] }`;

  const res = await callAI({
    systemPrompt: VERIFY_SYSTEM_PROMPT,
    userPrompt,
    maxTokens: VERIFY_MAX_TOKENS,
    jsonMode: true,
    thinkingBudget: 0,
  });

  // The URL allowlist is the guardrail: a candidate whose profile link the
  // search never returned was invented, whatever the model's confidence says.
  const allowed = new Map(hits.map((h) => [h.url, h]));
  const seen = new Set();
  const candidates = [];

  for (const c of Array.isArray(res?.candidates) ? res.candidates : []) {
    const url = normalizeProfileUrl(String(c?.linkedinUrl || ''));
    const firstName = String(c?.firstName || '').trim();
    if (!firstName || !url || !allowed.has(url) || seen.has(url)) continue;
    seen.add(url);

    const confidence = Number(c?.confidence);
    candidates.push({
      firstName,
      lastName: String(c?.lastName || '').trim(),
      role: String(c?.role || '').trim(),
      // Store the allowlisted URL, never the model's echo of it — the two can
      // differ in scheme, subdomain and case, and only this one is known real.
      linkedinUrl: allowed.get(url).url,
      matchReason: String(c?.matchReason || '').trim(),
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
      imported: false,
      foundAt: new Date(),
    });
  }

  return candidates
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, MAX_CANDIDATES);
};

/**
 * Find prospects at a company and store them as reviewable candidates.
 *
 * Already-imported candidates from earlier runs are preserved and never
 * re-offered, so re-running with a different playbook adds to the list instead
 * of resetting the user's accepted picks.
 *
 * @param {Object} company   Company document (mutated and saved)
 * @param {Object} opts
 * @param {Object} opts.playbook  Playbook doc — required, supplies the brief
 * @param {Array}  opts.personas  Persona docs — optional role criteria
 * @param {Function} opts.callAI
 * @returns {Promise<Object>} the saved company
 */
export const findCompanyProspects = async (company, { playbook, personas = [], callAI = askClaude } = {}) => {
  const brief = buildBrief({ playbook, personas });

  // Companies created before this field existed have nothing here to assign to.
  if (!company.prospectSearch) company.prospectSearch = { status: 'idle', candidates: [] };

  company.prospectSearch.playbook = playbook._id;
  company.prospectSearch.playbookName = playbook.name;
  company.prospectSearch.personas = personas.map((p) => p._id);
  company.prospectSearch.error = '';

  try {
    const queries = await planQueries(company, brief, callAI);
    console.log(`[prospect-finder] ${company.name} — ${queries.length} query(s) planned via "${playbook.name}"`);

    const hits = await gatherSearchHits(queries);
    console.log(`[prospect-finder] ${company.name} — ${hits.length} LinkedIn profile(s) pooled`);

    const fresh = hits.length ? await verifyCandidates({ company, brief, hits, callAI }) : [];

    // Keep what the user already accepted; drop the rest of the previous run,
    // which was answering a different brief.
    const kept = (company.prospectSearch.candidates || []).filter((c) => c.imported);
    const keptUrls = new Set(kept.map((c) => (c.linkedinUrl || '').toLowerCase()));

    company.prospectSearch.candidates = [
      ...kept,
      ...fresh.filter((c) => !keptUrls.has(c.linkedinUrl.toLowerCase())),
    ];
    company.prospectSearch.status = 'ready';
    company.prospectSearch.lastRunAt = new Date();

    if (queries.length) {
      company.sourceRefs.push({ source: 'prospect-finder', note: `Playbook: ${playbook.name}` });
    }

    await company.save();
    console.log(`[prospect-finder] ✅ ${company.name} — ${fresh.length} new candidate(s)`);
    return company;
  } catch (error) {
    const message = error instanceof AIFallbackRequiredError ? 'AI is unavailable right now.' : error.message;
    company.prospectSearch.status = 'failed';
    company.prospectSearch.error = message;
    company.prospectSearch.lastRunAt = new Date();
    await company.save();
    console.warn(`[prospect-finder] ⚠ ${company.name} failed: ${message}`);
    throw error;
  }
};

export const __prospectFinderTesting = {
  normalizeProfileUrl,
  buildBrief,
  verifyCandidates,
  planQueries,
  // Exported so the budget test derives its threshold from the real cap rather
  // than a copy of it — a hardcoded 25 stops asserting anything the moment
  // MAX_CANDIDATES moves.
  MAX_CANDIDATES,
  MAX_POOL,
  VERIFY_MAX_TOKENS,
};
