import { GoogleGenAI } from '@google/genai';
import { parseGroqResponse } from './groqClient.js';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_GEMINI_FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];
const DEFAULT_VERTEX_LOCATION = 'us-central1';

// Vertex AI (billed against a GCP project's billing account, e.g. GOOGLE_CLOUD_PROJECT's
// $-credit balance) when a project is configured; otherwise the AI Studio API key path
// (GEMINI_API_KEY, billed against that key's separate prepay balance).
let cachedClient = null;
const getClient = () => {
  if (cachedClient) return cachedClient;

  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (project) {
    console.log(`[gemini] Using Vertex AI (project: ${project}, location: ${process.env.GOOGLE_CLOUD_LOCATION || DEFAULT_VERTEX_LOCATION})`);
    cachedClient = new GoogleGenAI({
      vertexai: true,
      project,
      location: process.env.GOOGLE_CLOUD_LOCATION || DEFAULT_VERTEX_LOCATION,
    });
    return cachedClient;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Neither GOOGLE_CLOUD_PROJECT (Vertex AI) nor GEMINI_API_KEY (AI Studio) is configured');
  }
  console.log('[gemini] Using AI Studio API key (set GOOGLE_CLOUD_PROJECT to route through Vertex AI instead)');
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
};

export const askGemini = async ({
  systemPrompt,
  userPrompt,
  model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  maxTokens = 2048,
  temperature = 0.4,
  jsonMode = false,
  fallbackModels,
}) => {
  const ai = getClient();

  let fallbackStr = process.env.GEMINI_FALLBACK_MODELS || '';
  const parsedFallbacks = fallbackStr ? fallbackStr.split(',').map(m => m.trim()) : DEFAULT_GEMINI_FALLBACK_MODELS;
  let modelsToTry = [model, ...(fallbackModels || parsedFallbacks)];
  modelsToTry = [...new Set(modelsToTry.filter(Boolean))];

  let lastError = null;

  for (const candidateModel of modelsToTry) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const config = {
          maxOutputTokens: maxTokens,
          temperature,
        };

        if (systemPrompt) {
          config.systemInstruction = systemPrompt;
        }

        if (jsonMode) {
          config.responseMimeType = 'application/json';
        }

        // Limit user prompt length just to be safe
        const safePromptTokens = 5500 - maxTokens;
        const maxSafeChars = Math.floor(safePromptTokens * 3.5);
        let safeUserPrompt = userPrompt || '';
        if (safeUserPrompt.length > maxSafeChars) {
           safeUserPrompt = safeUserPrompt.slice(0, maxSafeChars) + '\n...[TRUNCATED BY AI SAFETY NET]';
        }

        const response = await ai.models.generateContent({
          model: candidateModel,
          contents: [{ role: 'user', parts: [{ text: safeUserPrompt }] }],
          config,
        });

        return parseGroqResponse(response.text);

      } catch (error) {
        lastError = error;

        if ((error.status === 429 || error.message?.includes('429')) && attempt < 2) {
          console.warn(`[gemini] ${candidateModel} rate limited. Retrying in 2000ms...`);
          await new Promise((res) => setTimeout(res, 2000));
          continue;
        }

        console.warn(`[gemini] ${candidateModel} request failed: ${error.message}. Trying fallback model...`);
        break; // break to try the next model
      }
    }
  }

  throw new Error(`All Gemini models failed (${modelsToTry.join(', ')}): ${lastError?.message || 'Unknown error'}`);
};
