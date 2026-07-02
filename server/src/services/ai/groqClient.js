/**
 * Groq AI client
 *
 * Modular wrapper for single-turn chat completions. Call `askGroq()` directly
 * when a feature needs to choose a Groq model or generation settings.
 */

const GROQ_API_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_GROQ_FALLBACK_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];

const parseModelList = (value) =>
  (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const unique = (items) => [...new Set(items.filter(Boolean))];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const extractRetryDelayMs = (message = '') => {
  const secondsMatch = message.match(/try again in\s+(\d+(?:\.\d+)?)s/i);
  if (secondsMatch) {
    return Math.min(30000, Math.max(1000, Math.ceil(Number(secondsMatch[1]) * 1000) + 250));
  }

  const msMatch = message.match(/try again in\s+(\d+)\s*ms/i);
  if (msMatch) {
    return Math.min(30000, Math.max(1000, Number(msMatch[1]) + 250));
  }

  return 2000;
};

const getFallbackModels = (model) =>
  unique([
    model,
    ...parseModelList(process.env.GROQ_FALLBACK_MODELS),
    ...DEFAULT_GROQ_FALLBACK_MODELS,
  ]);

let cachedAvailableModels = null;
let lastFetchTime = 0;

const fetchAvailableGroqModels = async (apiKey, baseUrl) => {
  if (cachedAvailableModels && Date.now() - lastFetchTime < 1000 * 60 * 60) {
    return cachedAvailableModels;
  }
  try {
    const cleanUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const response = await fetch(`${cleanUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (payload?.data && Array.isArray(payload.data)) {
      cachedAvailableModels = payload.data.map((m) => m.id);
      lastFetchTime = Date.now();
      return cachedAvailableModels;
    }
  } catch (error) {
    console.warn('[groq] Failed to fetch available models:', error.message);
  }
  return null;
};

const stripCodeFences = (text) =>
  text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();

export const parseGroqResponse = (raw) => {
  const cleaned = stripCodeFences(raw || '');

  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to find the first JSON object { ... }
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch (e) {
        // Keep trying
      }
    }
    // Try to find the first JSON array [ ... ]
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch (e) {
        // Keep trying
      }
    }
    return cleaned;
  }
};

/**
 * Single-turn Groq call that returns parsed JSON when possible, otherwise text.
 *
 * @param {object} options
 * @param {string} options.systemPrompt
 * @param {string} options.userPrompt
 * @param {string} [options.model]
 * @param {number} [options.maxTokens]
 * @param {number} [options.temperature]
 * @param {string} [options.apiKey]
 * @param {string} [options.baseUrl]
 * @param {Array<{role: string, content: string}>} [options.messages]
 * @param {boolean} [options.jsonMode]
 * @param {string[]} [options.fallbackModels]
 * @returns {object|string}
 */
export const askGroq = async ({
  systemPrompt,
  userPrompt,
  model = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
  maxTokens = 2048,
  temperature = 0.4,
  apiKey = process.env.GROQ_API_KEY,
  baseUrl = process.env.GROQ_API_BASE_URL || GROQ_API_BASE_URL,
  messages,
  jsonMode = false,
  fallbackModels,
}) => {
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is required to call Groq');
  }

  const requestMessages =
    messages ||
    [
      systemPrompt ? { role: 'system', content: systemPrompt } : null,
      userPrompt ? { role: 'user', content: userPrompt } : null,
    ].filter(Boolean);

  // Auto-truncate extremely large inputs to prevent 413 TPM errors
  const safePromptTokens = 5500 - maxTokens;
  const maxSafeChars = Math.floor(safePromptTokens * 3.5); // Safe ratio of chars per token
  
  let currentChars = 0;
  for (const msg of requestMessages) {
    if (msg?.content && typeof msg.content === 'string') {
      if (currentChars + msg.content.length > maxSafeChars) {
        const allowedLength = Math.max(0, maxSafeChars - currentChars);
        msg.content = msg.content.slice(0, allowedLength) + '\n...[TRUNCATED BY AI SAFETY NET]';
      }
      currentChars += msg.content.length;
    }
  }

  let modelsToTry = unique([model, ...(fallbackModels || getFallbackModels(model))]);
  
  // Dynamically fetch and filter available models to avoid 400 errors for decommissioned ones
  const availableModels = await fetchAvailableGroqModels(apiKey, baseUrl);
  if (availableModels) {
    modelsToTry = modelsToTry.filter((m) => availableModels.includes(m));
    
    // If all preferred models are decommissioned, fallback to any available llama model
    if (modelsToTry.length === 0) {
      const activeLlamas = availableModels.filter(m => m.includes('llama') && !m.includes('guard'));
      modelsToTry = activeLlamas.length > 0 ? [activeLlamas[0]] : [availableModels[0]];
    }
  }

  let lastError = null;

  for (const candidateModel of modelsToTry) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const body = {
        model: candidateModel,
        messages: requestMessages,
        max_tokens: maxTokens,
        temperature,
        ...(jsonMode && { response_format: { type: 'json_object' } }),
      };

      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          const message = payload?.error?.message || response.statusText || 'Unknown Groq API error';
          lastError = new Error(`Groq API error (${response.status}) on ${candidateModel}: ${message}`);

          if (response.status === 401 || response.status === 403) {
            throw lastError;
          }

          if (response.status === 429 && attempt < 2) {
            const delayMs = extractRetryDelayMs(message);
            console.warn(`[groq] ${candidateModel} rate limited. Retrying in ${delayMs}ms...`);
            await sleep(delayMs);
            continue;
          }

          console.warn(`[groq] ${candidateModel} failed: ${message}. Trying fallback model...`);
          break;
        }

        const raw = payload?.choices?.[0]?.message?.content;
        if (!raw) {
          lastError = new Error(`Groq API returned an empty response from ${candidateModel}`);
          console.warn(`[groq] ${candidateModel} returned an empty response. Trying fallback model...`);
          break;
        }

        return parseGroqResponse(raw);
      } catch (error) {
        lastError = error;

        if (error.message?.includes('401') || error.message?.includes('403')) {
          throw error;
        }

        if (/429|rate limit/i.test(error.message || '') && attempt < 2) {
          const delayMs = extractRetryDelayMs(error.message);
          console.warn(`[groq] ${candidateModel} request rate limited. Retrying in ${delayMs}ms...`);
          await sleep(delayMs);
          continue;
        }

        console.warn(`[groq] ${candidateModel} request failed: ${error.message}. Trying fallback model...`);
        break;
      }
    }
  }

  throw new Error(
    `All Groq models failed (${modelsToTry.join(', ')}): ${lastError?.message || 'Unknown error'}`
  );
};

export const groqDefaults = {
  baseUrl: GROQ_API_BASE_URL,
  model: DEFAULT_GROQ_MODEL,
  fallbackModels: DEFAULT_GROQ_FALLBACK_MODELS,
};

export default askGroq;
