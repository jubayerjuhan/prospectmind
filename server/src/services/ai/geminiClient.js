import { GoogleGenAI } from '@google/genai';
import { parseGroqResponse } from './groqClient.js';

// Alias names, not pinned versions — Google resolves them server-side to
// whatever's current for that key's PROJECT, which matters because different
// keys can be on different projects with different model generations (an
// older project may still see 2.5-class models; a newer one may only have
// access to 3.x, with 2.5 returning 404 "no longer available to new users").
// A pinned version number is a ticking deprecation; discovered live when
// gemini-2.5-flash-lite/-flash and even the hardcoded 2.0/1.5 fallbacks below
// all came back quota-exhausted or 404 across both configured keys.
const DEFAULT_GEMINI_MODEL = 'gemini-flash-lite-latest';
const DEFAULT_GEMINI_FALLBACK_MODELS = ['gemini-flash-latest'];
const DEFAULT_VERTEX_LOCATION = 'us-central1';

// Gemini 2.5 models carry a very large input context, so we cap the input prompt
// at a generous, fixed size that is independent of maxOutputTokens. This lets rich
// multi-source profiles (LinkedIn + GitHub + other socials) flow in without a higher
// output budget silently shrinking the input (the previous 5500-maxTokens formula did).
const MAX_INPUT_CHARS = 48000;

// Hard ceiling on a single generateContent call. Without this the SDK waits
// indefinitely: if the socket dies mid-flight (Cloud Run CPU throttling can do
// this to a background job), the await never settles and the pipeline job hangs
// at whatever layer it was in — the prospect sits at "enriching" forever with
// no error and no retry. Enforced twice: httpOptions.timeout asks the SDK to
// abort, and the race guarantees we move on even if the SDK ignores it.
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 120000;

const withTimeout = (promise, ms, label) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// Vertex AI (billed against a GCP project's billing account, e.g. GOOGLE_CLOUD_PROJECT's
// $-credit balance) when a project is configured; otherwise the AI Studio API key path.
//
// AI Studio's free tier caps at a small number of requests PER DAY, PER MODEL,
// PER PROJECT — a key is tied to one Google Cloud project, so the cap is a
// property of the project, not of "Gemini access" generally. A second key
// from a second project gets its own independent daily allowance. GEMINI_API_KEYS
// (comma-separated) lists as many as are available; GEMINI_API_KEY (singular)
// still works as a one-key list for backward compatibility. `askGemini` rotates
// across all of them, so exhausting one project's quota falls through to the
// next rather than failing the whole request.
let cachedVertexClient = null;
const clientsByKey = new Map();

const getVertexClient = () => {
  if (cachedVertexClient) return cachedVertexClient;
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  console.log(`[gemini] Using Vertex AI (project: ${project}, location: ${process.env.GOOGLE_CLOUD_LOCATION || DEFAULT_VERTEX_LOCATION})`);
  cachedVertexClient = new GoogleGenAI({
    vertexai: true,
    project,
    location: process.env.GOOGLE_CLOUD_LOCATION || DEFAULT_VERTEX_LOCATION,
  });
  return cachedVertexClient;
};

const getClientForKey = (apiKey) => {
  let client = clientsByKey.get(apiKey);
  if (!client) {
    client = new GoogleGenAI({ apiKey });
    clientsByKey.set(apiKey, client);
  }
  return client;
};

/** @returns {Array<String>} every configured AI Studio key, in order. */
const resolveApiKeys = () => {
  const list = process.env.GEMINI_API_KEYS;
  if (list) return list.split(',').map((k) => k.trim()).filter(Boolean);
  return process.env.GEMINI_API_KEY ? [process.env.GEMINI_API_KEY] : [];
};

// Rotates which key each new askGemini() call tries FIRST. Without this, every
// call starts at key[0] — the moment that key's daily quota is exhausted,
// every subsequent call wastes an attempt hitting the same dead key before
// falling through, and the other keys' quota goes mostly unused because they
// only ever get reached as a last resort within a single call.
let keyRotationOffset = 0;

const isQuotaExhausted = (error) =>
  error?.status === 'RESOURCE_EXHAUSTED' || /RESOURCE_EXHAUSTED|exceeded your current quota/i.test(error?.message || '');

export const askGemini = async ({
  systemPrompt,
  userPrompt,
  model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  maxTokens = 2048,
  temperature = 0.4,
  jsonMode = false,
  fallbackModels,
  thinkingBudget = null, // 0 disables "thinking" on 2.5 models so the whole output budget goes to the answer
  onUsage, // ({ model, promptTokens, outputTokens, thinkingTokens, totalTokens }) => void — see runOnce below
}) => {
  const useVertex = Boolean(process.env.GOOGLE_CLOUD_PROJECT);
  const apiKeys = useVertex ? [] : resolveApiKeys();
  if (!useVertex && !apiKeys.length) {
    throw new Error('Neither GOOGLE_CLOUD_PROJECT (Vertex AI) nor GEMINI_API_KEY/GEMINI_API_KEYS (AI Studio) is configured');
  }

  let fallbackStr = process.env.GEMINI_FALLBACK_MODELS || '';
  const parsedFallbacks = fallbackStr ? fallbackStr.split(',').map(m => m.trim()) : DEFAULT_GEMINI_FALLBACK_MODELS;
  let modelsToTry = [model, ...(fallbackModels || parsedFallbacks)];
  modelsToTry = [...new Set(modelsToTry.filter(Boolean))];

  const buildConfig = (candidateModel) => {
    const config = { maxOutputTokens: maxTokens, temperature };
    if (systemPrompt) config.systemInstruction = systemPrompt;
    if (jsonMode) config.responseMimeType = 'application/json';
    // "Thinking" tokens count against maxOutputTokens on 2.5 models and can
    // starve/truncate the actual answer. Only 2.5 models accept thinkingConfig;
    // the 2.0/1.5 fallbacks reject it, so guard by model name.
    if (thinkingBudget != null && /2\.5/.test(candidateModel)) {
      config.thinkingConfig = { thinkingBudget };
    }
    config.httpOptions = { timeout: REQUEST_TIMEOUT_MS };
    return config;
  };

  // Cap input prompt length at a generous fixed size (see MAX_INPUT_CHARS).
  let safeUserPrompt = userPrompt || '';
  if (safeUserPrompt.length > MAX_INPUT_CHARS) {
    safeUserPrompt = safeUserPrompt.slice(0, MAX_INPUT_CHARS) + '\n...[TRUNCATED BY AI SAFETY NET]';
  }

  const runOnce = async (ai, candidateModel) => {
    const response = await withTimeout(
      ai.models.generateContent({
        model: candidateModel,
        contents: [{ role: 'user', parts: [{ text: safeUserPrompt }] }],
        config: buildConfig(candidateModel),
      }),
      REQUEST_TIMEOUT_MS,
      `[gemini] ${candidateModel}`
    );

    // usageMetadata is what the free-tier daily cap actually counts against —
    // logged on every call so "how many tokens does an outreach generation
    // cost" is answerable from the logs, not a guess. onUsage lets a caller
    // (e.g. executeCampaignOutreach, summing across a whole campaign's worth
    // of prospects) accumulate a total instead of only ever seeing one call.
    const usage = response.usageMetadata || {};
    console.log(
      `[gemini] ${candidateModel} — prompt=${usage.promptTokenCount ?? '?'} ` +
      `output=${usage.candidatesTokenCount ?? '?'} thinking=${usage.thoughtsTokenCount ?? 0} ` +
      `total=${usage.totalTokenCount ?? '?'}`
    );
    if (typeof onUsage === 'function') {
      onUsage({
        model: candidateModel,
        promptTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
        thinkingTokens: usage.thoughtsTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0,
      });
    }

    return parseGroqResponse(response.text);
  };

  let lastError = null;

  if (useVertex) {
    // Vertex bills against the GCP project, not a per-key daily cap — one
    // client, the model-fallback loop is the only rotation that applies.
    const ai = getVertexClient();
    for (const candidateModel of modelsToTry) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await runOnce(ai, candidateModel);
        } catch (error) {
          lastError = error;
          if ((error.status === 429 || error.message?.includes('429')) && attempt < 2) {
            console.warn(`[gemini] ${candidateModel} rate limited. Retrying in 2000ms...`);
            await new Promise((res) => setTimeout(res, 2000));
            continue;
          }
          console.warn(`[gemini] ${candidateModel} request failed: ${error.message}. Trying fallback model...`);
          break;
        }
      }
    }
    throw new Error(`All Gemini models failed (${modelsToTry.join(', ')}): ${lastError?.message || 'Unknown error'}`);
  }

  // AI Studio: for each model, cycle through every configured key (starting
  // from the rotating offset) before falling through to the next model. A key
  // whose daily quota is already exhausted is skipped immediately — retrying
  // it with a backoff wastes time a day-scoped limit will not clear in
  // seconds. A key with a merely transient error gets one retry before moving
  // on, since that failure mode DOES often clear within a couple of seconds.
  for (const candidateModel of modelsToTry) {
    for (let k = 0; k < apiKeys.length; k += 1) {
      const keyIndex = (keyRotationOffset + k) % apiKeys.length;
      const apiKey = apiKeys[keyIndex];
      const keyLabel = apiKeys.length > 1 ? ` (key ${keyIndex + 1}/${apiKeys.length})` : '';
      const ai = getClientForKey(apiKey);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await runOnce(ai, candidateModel);
        } catch (error) {
          lastError = error;

          if (isQuotaExhausted(error)) {
            console.warn(`[gemini] ${candidateModel}${keyLabel} quota exhausted. Trying next key...`);
            break; // this key won't recover within the request — move on immediately
          }

          if ((error.status === 429 || error.message?.includes('429')) && attempt < 1) {
            console.warn(`[gemini] ${candidateModel}${keyLabel} rate limited. Retrying in 2000ms...`);
            await new Promise((res) => setTimeout(res, 2000));
            continue;
          }

          console.warn(`[gemini] ${candidateModel}${keyLabel} request failed: ${error.message}.`);
          break;
        }
      }
    }
  }

  // Rotate the starting key for the NEXT call, so a run of many calls spreads
  // across all keys' daily allowances instead of every call hammering key[0]
  // first and only reaching the others as a last resort.
  if (apiKeys.length > 1) keyRotationOffset = (keyRotationOffset + 1) % apiKeys.length;

  const keysTried = apiKeys.length > 1 ? ` across ${apiKeys.length} keys` : '';
  throw new Error(`All Gemini models failed${keysTried} (${modelsToTry.join(', ')}): ${lastError?.message || 'Unknown error'}`);
};

// Voice-dictation transcription. Bypasses askGemini/parseGroqResponse on purpose —
// this sends a multimodal (audio inlineData) request and wants raw transcript text
// back, not JSON parsing.
export const transcribeAudio = async ({ audioBase64, mimeType }) => {
  let ai;
  if (process.env.GOOGLE_CLOUD_PROJECT) {
    ai = getVertexClient();
  } else {
    const [firstKey] = resolveApiKeys();
    if (!firstKey) throw new Error('Neither GOOGLE_CLOUD_PROJECT (Vertex AI) nor GEMINI_API_KEY/GEMINI_API_KEYS (AI Studio) is configured');
    ai = getClientForKey(firstKey);
  }
  const model = process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-2.5-flash';

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          {
            text: 'Transcribe the spoken audio exactly as spoken. Return ONLY the transcript text — no commentary, no quotes, no markdown.',
          },
        ],
      },
    ],
    config: { maxOutputTokens: 1024, temperature: 0.1 },
  });

  return (response.text || '').trim();
};

export const __testables = { resolveApiKeys, isQuotaExhausted };
