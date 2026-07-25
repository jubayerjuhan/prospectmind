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

/** Fresh Google snippets for a signal query — best-effort, empty on failure. */
const searchSnippets = async (query) => {
  try {
    const results = await searchGoogle(query);
    return results
      .map((r) => `- ${r.title || ''}: ${r.snippet || ''}`)
      .filter((s) => s.length > 5)
      .join('\n');
  } catch {
    return '';
  }
};

export const getActiveSignals = (organizationId, appliesTo) =>
  Signal.find({ organization: organizationId, isActive: true, appliesTo }).select('_id name prompt').lean();

/**
 * Detect company-level signals and persist them on the Company doc.
 * Replaces previous results per signal (a detection run supersedes the last).
 *
 * @returns {Promise<Array>} the stored signal entries
 */
export const detectCompanySignals = async (company, { callAI = askClaude } = {}) => {
  const signals = await getActiveSignals(company.organization, 'company');
  if (!signals.length) return company.signals || [];

  console.log(`[signalDetector] Detecting ${signals.length} company signal(s) for "${company.name}"`);
  const entries = [];

  for (const signal of signals) {
    const snippets = await searchSnippets(`"${company.name}" ${signal.name}`);
    const entry = await runOneSignal(signal, {
      callAI,
      targetLabel: `Company: ${company.name}${company.domain ? ` (${company.domain})` : ''}`,
      contextBlocks: [
        company.aiAnalysis?.summary ? `=== STORED COMPANY ANALYSIS ===\n${clipPromptText(company.aiAnalysis.summary, 1200)}` : '',
        snippets ? `=== FRESH GOOGLE SNIPPETS ===\n${clipPromptText(snippets, 1500)}` : '',
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
export const detectProspectSignals = async (prospect, enrichedProfile, { callAI = askClaude } = {}) => {
  const signals = await getActiveSignals(prospect.organization, 'prospect');
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
