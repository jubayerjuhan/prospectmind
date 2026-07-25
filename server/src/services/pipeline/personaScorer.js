/**
 * Layer 4.5 — Persona Scoring (v2 Phase C)
 *
 * Scores a prospect against each active first-class Persona using that
 * persona's user-authored prompt (HLD §3.1 / §3.4.1). This is the mechanism
 * that makes behavior configurable without changing code: the org edits a
 * Persona's prompt in Settings, and scoring adapts.
 *
 * Additive by design — this does NOT replace the legacy compatibilityScore in
 * scorer.js. It produces a separate `personaScores[]` array so the two can be
 * compared before persona-driven scoring is ever promoted to the primary score.
 */

import { askClaude, AIFallbackRequiredError } from '../ai/claudeClient.js';
import { buildProfileSnapshot, clipPromptText } from './profileSnapshot.js';

const SYSTEM_PROMPT = `You are a precision persona-scoring engine for a B2B prospect intelligence platform.
You are given a user-authored persona definition and a prospect's data.
Judge how well the prospect matches that specific persona, following the persona definition exactly.
Be rigorous and evidence-based — scores must be defensible. Always return valid JSON.`;

const buildUserPrompt = ({ persona, prospect, profileSnapshot, companyContext }) => `=== PERSONA DEFINITION (user-authored) ===
Persona name: ${persona.name}

${clipPromptText(persona.prompt, 6000)}
==================================================

=== PROSPECT ===
Name: ${prospect.firstName} ${prospect.lastName || ''}
Company: ${prospect.company || 'Unknown'}
${companyContext ? `Company context: ${clipPromptText(companyContext, 1500)}\n` : ''}Enriched Profile:
${JSON.stringify(profileSnapshot, null, 2)}

=== YOUR TASK ===
Evaluate how well THIS prospect matches the persona defined above, applying that
definition's own criteria. Return JSON:
{
  "score": 0-100,                       // how strongly this prospect fits this persona
  "reasoning": "1-3 sentence explanation of the score, grounded in the persona's criteria",
  "evidence": ["concrete fact from the prospect data supporting the score", "..."]  // 1-5 items
}`;

/**
 * Score one prospect against one persona. Returns a normalized result object,
 * or null if the AI hard-fell-back (so a single bad call doesn't poison the set).
 */
const scoreOnePersona = async (persona, { prospect, profileSnapshot, companyContext, callAI }) => {
  const userPrompt = buildUserPrompt({ persona, prospect, profileSnapshot, companyContext });
  try {
    const result = await callAI({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 1024,
      jsonMode: true,
      thinkingBudget: 0,
    });

    const rawScore = Number(result?.score);
    const score = Number.isFinite(rawScore) ? Math.min(100, Math.max(0, Math.round(rawScore))) : null;

    return {
      persona: persona._id,
      personaName: persona.name,
      score,
      reasoning: typeof result?.reasoning === 'string' ? result.reasoning : '',
      evidence: Array.isArray(result?.evidence) ? result.evidence.filter((e) => typeof e === 'string').slice(0, 5) : [],
      scoredAt: new Date(),
    };
  } catch (error) {
    if (error instanceof AIFallbackRequiredError) {
      console.warn(`[personaScorer] AI fallback for persona "${persona.name}" on prospect ${prospect._id}`);
      return null;
    }
    // Per-persona failure shouldn't kill the whole pipeline — log and skip.
    console.warn(`[personaScorer] Failed persona "${persona.name}" on prospect ${prospect._id}: ${error.message}`);
    return null;
  }
};

/**
 * Score a prospect against every active Persona.
 *
 * @param {Object}   prospect         Mongoose prospect doc (needs firstName/lastName/company/_id)
 * @param {Object}   enrichedProfile  Enrichment output (Layer 2)
 * @param {Array}    personas         Active Persona docs ({ _id, name, prompt })
 * @param {Object}   opts
 * @param {Function} opts.callAI      AI caller (defaults to askClaude)
 * @param {String}   opts.companyContext Optional company-level context string
 * @returns {Promise<Array>}          personaScores entries (failed personas omitted)
 */
export const scorePersonas = async (prospect, enrichedProfile, personas = [], { callAI = askClaude, companyContext = '' } = {}) => {
  if (!Array.isArray(personas) || personas.length === 0) return [];

  const profileSnapshot = buildProfileSnapshot(enrichedProfile);

  // Sequential to stay gentle on AI provider rate limits — persona counts per
  // org are expected to be small (a handful). Revisit with batching if needed.
  const results = [];
  for (const persona of personas) {
    const entry = await scoreOnePersona(persona, { prospect, profileSnapshot, companyContext, callAI });
    if (entry) results.push(entry);
  }

  return results;
};
