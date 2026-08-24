/**
 * AI Client — smart router with per-campaign provider preference.
 *
 * askAI(options, { preferredProvider })
 *   preferredProvider: 'gemini' | 'groq' | 'auto' (default: 'gemini')
 *   Returns: { result, providerUsed: 'gemini' | 'groq' | 'local' | 'fallback' }
 *
 * askClaude(options) — backward-compatible alias; returns result directly.
 *
 * Routing logic:
 *   'gemini' → Gemini first, fallback to Groq, fallback to local AI
 *   'groq'   → Groq first (no Gemini fallback beyond Groq's own chain)
 *   'auto'   → Groq first, then Gemini (original behavior)
 *
 * GROQ_ENABLED (below): Groq is temporarily held back org-wide — Gemini is the
 * sole active provider regardless of a campaign's stored `preferredAiModel`.
 * The full multi-provider routing logic below is left intact and untouched;
 * flip GROQ_ENABLED back to true to re-integrate Groq without further changes.
 *
 * Local AI (localAiClient.js): a self-hosted `groq-ai-api` backend that fans
 * out across six Groq-hosted models behind one endpoint. It's a last-resort
 * fallback after Gemini's own model+key chain is exhausted — only reached
 * when LOCAL_AI_BASE_URL is configured; otherwise this step is a no-op.
 */

import { askGroq } from './groqClient.js';
import { askGemini } from './geminiClient.js';
import { askLocalAI, resolveLocalAiBaseUrl } from './localAiClient.js';

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

// Shared last-resort step: try the local AI backend, but only if it's actually
// configured — keeps this a no-op in environments (e.g. prod) that don't run it.
const tryLocalAI = async (options) => {
  if (!resolveLocalAiBaseUrl()) return null;
  try {
    const result = await askLocalAI(options);
    return { result, providerUsed: 'local' };
  } catch (localError) {
    console.warn(`[router] Local AI fallback also failed: ${localError.message}`);
    return null;
  }
};

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
      const local = await tryLocalAI(options);
      if (local) return local;
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
      const local = await tryLocalAI(options);
      if (local) return local;
      throw new AIFallbackRequiredError(`Gemini (preferred), Groq, and local AI all failed: ${groqError.message}`);
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
      const local = await tryLocalAI(options);
      if (local) return local;
      throw new AIFallbackRequiredError('Groq, Gemini, and local AI all failed to deliver.');
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
