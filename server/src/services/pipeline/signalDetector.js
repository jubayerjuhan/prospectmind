/**
 * Signal Detection (v2 Phase C, HLD §3.3).
 *
 * Runs the org's active, user-authored Signal prompts against a Prospect or a
 * Company (per each signal's `appliesTo`) and stores qualified results with
 * provenance. Detection is evidence-based: each signal gets fresh Google
 * snippets (Serper) plus whatever stored knowledge exists on the target.
 *
 * Best-effort by design — a failing signal is skipped, never fatal.
 */

import Signal from '../../models/Signal.js';
import { askClaude, AIFallbackRequiredError } from '../ai/claudeClient.js';
import { searchGoogle } from './discovery.js';
import { buildProfileSnapshot, clipPromptText } from './profileSnapshot.js';
import { fetchBoardOpenRoles, resolveBoardFromUrls, formatBoardBlock } from '../company/atsBoards.js';

const SYSTEM_PROMPT = `You are a precision business-signal detection engine for a B2B prospect intelligence platform.
You are given a user-authored signal definition and context about a target (a person or a company).
Determine whether the signal is present, strictly following the definition's own criteria for what to detect and how to qualify it.
Never invent evidence — if the context doesn't support detection, say so plainly.
Always return valid JSON.`;

const RESULT_SHAPE = `Return JSON:
{
  "detected": true|false,
  "result": "2-4 sentence qualified finding following the signal definition (or a clear statement that nothing could be confirmed)",
  "confidence": 0.0-1.0,
  "sources": ["where the evidence came from, e.g. 'google: <snippet title>'"]
}`;

const runOneSignal = async (signal, { targetLabel, contextBlocks, callAI }) => {
  const userPrompt = `=== SIGNAL DEFINITION (user-authored) ===
Signal name: ${signal.name}

${clipPromptText(signal.prompt, 4000)}
==================================================

=== TARGET ===
${targetLabel}

${contextBlocks.filter(Boolean).join('\n\n')}

=== YOUR TASK ===
Apply the signal definition to this target. ${RESULT_SHAPE}`;

  try {
    const res = await callAI({ systemPrompt: SYSTEM_PROMPT, userPrompt, maxTokens: 1024, jsonMode: true, thinkingBudget: 0 });
    const confidence = Number(res?.confidence);
    return {
      signal: signal._id,
      name: signal.name,
      detected: Boolean(res?.detected),
      result: typeof res?.result === 'string' ? res.result : '',
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
      source: Array.isArray(res?.sources) ? res.sources.filter((s) => typeof s === 'string').slice(0, 5).join('; ') : '',
      detectedAt: new Date(),
    };
  } catch (error) {
    if (!(error instanceof AIFallbackRequiredError)) {
      console.warn(`[signalDetector] Signal "${signal.name}" failed: ${error.message}`);
    }
    return null;
  }
};

/**
 * Fresh Google snippets for a signal query — best-effort, empty on failure.
 *
 * Returns links as well as text: a snippet about hiring usually points at the
 * company's actual job board, which can then be read directly instead of
 * guessed at. Serper's `date` is surfaced inline so the model can weigh how old
 * a claim is rather than treating every result as current.
 */
const searchSnippets = async (query, { tbs } = {}) => {
  try {
    const results = await searchGoogle(query, { tbs });
    const text = results
      .map((r) => `- ${r.date ? `[${r.date}] ` : '[undated] '}${r.title || ''}: ${r.snippet || ''}`)
      .filter((s) => s.length > 15)
      .join('\n');
    return { text, links: results.map((r) => r.link).filter(Boolean) };
  } catch {
    return { text: '', links: [] };
  }
};

// Signals whose truth changes week to week and whose evidence therefore rots.
const HIRING_RE = /hir|job|recruit|vacan|opening|role|headcount|talent|team expansion|growth of the team/i;
const isHiringSignal = (s) => HIRING_RE.test(`${s.name || ''} ${s.prompt || ''}`);

const RECENCY_NOTE = `=== HOW TO WEIGH THIS EVIDENCE ===
Each snippet is prefixed with its publication date, or [undated] when Google
reports none. Search results persist long after the thing they describe ends —
a filled role, a finished round, a departed employee. Undated evidence, and
evidence older than about a year, cannot establish that something is true NOW.
Treat it as historical, say so in the finding, and lower your confidence
accordingly rather than presenting it as the current state.`;

/**
 * Signals to run for a target. When a campaign has selected specific Signals,
 * only those run (still filtered by `appliesTo`); otherwise every active Signal
 * in the org does.
 */
export const getActiveSignals = (organizationId, appliesTo, selectedIds = []) =>
  Signal.find(
    selectedIds?.length
      ? { organization: organizationId, appliesTo, _id: { $in: selectedIds } }
      : { organization: organizationId, isActive: true, appliesTo }
  )
    .select('_id name prompt')
    .lean();

/**
 * Detect company-level signals and persist them on the Company doc.
 * Replaces previous results per signal (a detection run supersedes the last).
 *
 * @returns {Promise<Array>} the stored signal entries
 */
export const detectCompanySignals = async (company, { callAI = askClaude, selectedSignalIds = [] } = {}) => {
  const signals = await getActiveSignals(company.organization, 'company', selectedSignalIds);
  if (!signals.length) return company.signals || [];

  // A signal searched on the bare name ("Kiln raised $17M") can easily belong
  // to a namesake — and it is persisted, then injected verbatim into outreach.
  // Detecting nothing is strictly better than asserting someone else's news.
  const identity = company.domainKey || company.linkedinKey;
  if (!identity) {
    console.warn(
      `[signalDetector] Skipping company signals for "${company.name}" — no verified domain or LinkedIn page to anchor the search`
    );
    return company.signals || [];
  }

  console.log(`[signalDetector] Detecting ${signals.length} company signal(s) for "${company.name}"`);
  const entries = [];
  const anchor = company.domainKey ? `"${company.domainKey}" ` : '';

  // Whether a company is hiring is a fact with an expiry date, and search
  // results have none. Read the company's own applicant tracking system so an
  // empty board can actually say "not hiring" — the half of the answer that
  // snippets structurally cannot provide.
  let boardBlock = '';
  if (signals.some(isHiringSignal)) {
    try {
      const stored = company.atsBoard?.slug
        ? { provider: company.atsBoard.provider, slug: company.atsBoard.slug, url: company.atsBoard.url }
        : null;

      let board = stored ? await fetchBoardOpenRoles(stored) : null;
      if (!board) {
        const { links } = await searchSnippets(`"${company.name}" ${anchor}careers jobs`);
        board = await resolveBoardFromUrls([...links, company.website || '']);
      }

      if (board) {
        boardBlock = formatBoardBlock(board);
        company.atsBoard = {
          provider: board.provider, slug: board.slug, url: board.url,
          openRoles: board.openRoles, lastCheckedAt: board.fetchedAt,
        };
      }
    } catch (err) {
      // A board we cannot read is NOT the same as a board with no roles, so we
      // simply fall through to snippet evidence rather than implying "0".
      console.warn(`[signalDetector] Job board lookup failed for "${company.name}": ${err.message}`);
    }
  }

  for (const signal of signals) {
    const hiring = isHiringSignal(signal);
    const snippets = await searchSnippets(
      `"${company.name}" ${anchor}${signal.name}`,
      // Restrict time-sensitive signals to the past year so three-year-old
      // postings stop arguing that a company is hiring today.
      hiring ? { tbs: 'qdr:y' } : {}
    );
    const entry = await runOneSignal(signal, {
      callAI,
      targetLabel: `Company: ${company.name}${identity ? ` (${identity})` : ''}`,
      contextBlocks: [
        hiring ? boardBlock : '',
        company.aiAnalysis?.summary ? `=== STORED COMPANY ANALYSIS ===\n${clipPromptText(company.aiAnalysis.summary, 1200)}` : '',
        snippets.text ? `=== GOOGLE SNIPPETS (may be stale) ===\n${clipPromptText(snippets.text, 1500)}` : '',
        snippets.text ? RECENCY_NOTE : '',
      ],
    });
    if (entry) entries.push(entry);
  }

  if (entries.length) {
    const refreshedIds = new Set(entries.map((e) => e.signal.toString()));
    company.signals = [
      ...(company.signals || []).filter((s) => !s.signal || !refreshedIds.has(s.signal.toString())),
      ...entries,
    ];
    await company.save();
    console.log(`[signalDetector] ✅ Stored ${entries.length} signal result(s) on "${company.name}"`);
  }

  return entries;
};

/**
 * Detect prospect-level signals. Returns entries for the caller to persist
 * (the pipeline runner saves them with the rest of its results).
 */
export const detectProspectSignals = async (prospect, enrichedProfile, { callAI = askClaude, selectedSignalIds = [] } = {}) => {
  const signals = await getActiveSignals(prospect.organization, 'prospect', selectedSignalIds);
  if (!signals.length) return [];

  console.log(`[signalDetector] Detecting ${signals.length} prospect signal(s) for ${prospect.firstName}`);
  const profileSnapshot = buildProfileSnapshot(enrichedProfile, { includeContact: false });
  const entries = [];

  for (const signal of signals) {
    const entry = await runOneSignal(signal, {
      callAI,
      targetLabel: `Person: ${prospect.firstName} ${prospect.lastName || ''} @ ${prospect.company || 'Unknown'}`,
      contextBlocks: [`=== ENRICHED PROFILE ===\n${clipPromptText(JSON.stringify(profileSnapshot), 3000)}`],
    });
    if (entry) entries.push(entry);
  }

  return entries;
};
