/**
 * AI Client — smart router with per-campaign provider preference.
 *
 * askAI(options, { preferredProvider })
 *   preferredProvider: 'gemini' | 'groq' | 'auto' (default: 'gemini')
 *   Returns: { result, providerUsed: 'gemini' | 'groq' | 'fallback' }
 *
 * askClaude(options) — backward-compatible alias; returns result directly.
 *
 * Routing logic:
 *   'gemini' → Gemini first, fallback to Groq
 *   'groq'   → Groq first (no Gemini fallback beyond Groq's own chain)
 *   'auto'   → Groq first, then Gemini (original behavior)
 *
 * GROQ_ENABLED (below): Groq is temporarily held back org-wide — Gemini is the
 * sole active provider regardless of a campaign's stored `preferredAiModel`.
 * The full multi-provider routing logic below is left intact and untouched;
 * flip GROQ_ENABLED back to true to re-integrate Groq without further changes.
 */

import { askGroq } from './groqClient.js';
import { askGemini } from './geminiClient.js';

export class AIFallbackRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AIFallbackRequiredError';
  }
}

// Groq is on hold — kept fully implemented in groqClient.js and in the routing
// branches below, but not called while this is false. Gemini is the only
// provider actually invoked. Flip to true to restore Groq/auto/fallback routing.
const GROQ_ENABLED = false;

/**
 * Smart AI router.
 *
 * @param {object} options  - Prompt options forwarded to the underlying client
 * @param {object} [ctx]
 * @param {string} [ctx.preferredProvider='gemini'] - 'gemini' | 'groq' | 'auto'
 * @returns {{ result: any, providerUsed: 'gemini'|'groq'|'fallback' }}
 */
export const askAI = async (options, { preferredProvider = 'gemini' } = {}) => {
  // ── Groq on hold — Gemini-only, regardless of preferredProvider ────────────
  if (!GROQ_ENABLED) {
    if (!process.env.GEMINI_API_KEY) {
      throw new AIFallbackRequiredError('GEMINI_API_KEY is not configured and Groq is currently disabled.');
    }
    try {
      const result = await askGemini(options);
      return { result, providerUsed: 'gemini' };
    } catch (geminiError) {
      throw new AIFallbackRequiredError(`Gemini failed (Groq is currently disabled): ${geminiError.message}`);
    }
  }

  // ── Gemini-preferred ──────────────────────────────────────────────────────
  if (preferredProvider === 'gemini') {
    // Try Gemini first; fall back to Groq if Gemini fails or key is missing
    if (!process.env.GEMINI_API_KEY) {
      console.warn('[router] preferredProvider=gemini but GEMINI_API_KEY is not set. Falling back to Groq.');
    } else {
      try {
        const result = await askGemini(options);
        return { result, providerUsed: 'gemini' };
      } catch (geminiError) {
        console.warn(`[router] Gemini failed (preferred). Falling back to Groq... (${geminiError.message})`);
      }
    }

    try {
      const result = await askGroq(options);
      return { result, providerUsed: 'groq' };
    } catch (groqError) {
      throw new AIFallbackRequiredError(`Both Gemini (preferred) and Groq failed: ${groqError.message}`);
    }
  }

  // ── Groq-pinned ───────────────────────────────────────────────────────────
  if (preferredProvider === 'groq') {
    try {
      const result = await askGroq(options);
      return { result, providerUsed: 'groq' };
    } catch (groqError) {
      throw new AIFallbackRequiredError(`Groq (pinned) failed: ${groqError.message}`);
    }
  }

  // ── Auto (default) — Groq → Gemini ────────────────────────────────────────
  try {
    const result = await askGroq(options);
    return { result, providerUsed: 'groq' };
  } catch (groqError) {
    console.warn(`[router] Groq failed completely. Falling back to Gemini... (${groqError.message})`);

    try {
      const result = await askGemini(options);
      return { result, providerUsed: 'gemini' };
    } catch (geminiError) {
      console.warn(`[router] Gemini also failed completely: ${geminiError.message}`);
      throw new AIFallbackRequiredError('Both Groq and Gemini AI providers failed to deliver.');
    }
  }
};

/**
 * Backward-compatible alias — returns the raw result (no metadata).
 * All existing pipeline layers that import askClaude() continue to work.
 */
export const askClaude = async (options) => {
  const { result } = await askAI(options);
  return result;
};

export default askClaude;
