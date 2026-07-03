import { GoogleGenerativeAI } from '@google/generative-ai';
import { parseGroqResponse } from './groqClient.js';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_GEMINI_FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];

export const askGemini = async ({
  systemPrompt,
  userPrompt,
  model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  maxTokens = 2048,
  temperature = 0.4,
  jsonMode = false,
  fallbackModels,
}) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required to call Gemini');
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  let fallbackStr = process.env.GEMINI_FALLBACK_MODELS || '';
  const parsedFallbacks = fallbackStr ? fallbackStr.split(',').map(m => m.trim()) : DEFAULT_GEMINI_FALLBACK_MODELS;
  let modelsToTry = [model, ...(fallbackModels || parsedFallbacks)];
  modelsToTry = [...new Set(modelsToTry.filter(Boolean))];

  let lastError = null;

  for (const candidateModel of modelsToTry) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const generationConfig = {
          maxOutputTokens: maxTokens,
          temperature,
        };

        if (jsonMode) {
          generationConfig.responseMimeType = 'application/json';
        }

        const generativeModel = genAI.getGenerativeModel({
          model: candidateModel,
          systemInstruction: systemPrompt || undefined,
        });

        // Limit user prompt length just to be safe
        const safePromptTokens = 5500 - maxTokens;
        const maxSafeChars = Math.floor(safePromptTokens * 3.5);
        let safeUserPrompt = userPrompt || '';
        if (safeUserPrompt.length > maxSafeChars) {
           safeUserPrompt = safeUserPrompt.slice(0, maxSafeChars) + '\n...[TRUNCATED BY AI SAFETY NET]';
        }

        const result = await generativeModel.generateContent({
          contents: [{ role: 'user', parts: [{ text: safeUserPrompt }] }],
          generationConfig
        });
        
        const responseText = result.response.text();

        return parseGroqResponse(responseText);

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
