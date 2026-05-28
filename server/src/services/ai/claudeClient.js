/**
 * AI Client — powered by Google Gemini
 * Drop-in replacement for the original Claude client.
 * Same `askClaude` export so no other files need to change.
 *
 * Free tier: https://aistudio.google.com/app/apikey
 * Default model: gemini-2.0-flash (free, fast, great for JSON tasks)
 * Upgrade to: gemini-2.0-pro for higher quality
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// Lazily initialised so dotenv has time to populate process.env before first use
let _genAI = null;
const getGenAI = () => {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _genAI;
};

/**
 * Single-turn AI call that expects a JSON (or text) response.
 *
 * @param {object} options
 * @param {string} options.systemPrompt  - System / context instructions
 * @param {string} options.userPrompt    - The actual user message
 * @param {string} [options.model]       - Gemini model name (default: gemini-1.5-flash)
 * @param {number} [options.maxTokens]   - Max output tokens (default: 2048)
 * @returns {object|string} Parsed JSON object or raw string
 */
export const askClaude = async ({
  systemPrompt,
  userPrompt,
  model = 'gemini-2.0-flash',
  maxTokens = 2048,
}) => {
  const geminiModel = getGenAI().getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.4,
    },
  });

  const result = await geminiModel.generateContent(userPrompt);
  const raw = result.response.text();

  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Return raw string for non-JSON calls
    return cleaned;
  }
};

export default getGenAI;
