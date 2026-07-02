import { GoogleGenerativeAI } from '@google/generative-ai';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

const stripCodeFences = (text) =>
  text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();

export const parseGeminiResponse = (raw) => {
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Single-turn Gemini call that returns parsed JSON when possible, otherwise text.
 */
export const askGemini = async ({
  systemPrompt,
  userPrompt,
  model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  maxTokens = 2048,
  temperature = 0.4,
  apiKey = process.env.GEMINI_API_KEY,
  messages,
  jsonMode = false,
}) => {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required to call Gemini. Please add it to server/.env');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt || undefined,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
      ...(jsonMode && { responseMimeType: 'application/json' })
    }
  });

  try {
    let rawContent = '';
    let retries = 3;
    let delayMs = 6000;

    while (retries > 0) {
      try {
        if (messages) {
          const history = messages
            .filter(m => m.role !== 'system')
            .map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }]
            }));
          
          const lastMessage = history.pop();
          if (!lastMessage) throw new Error('No messages to send');
          
          const chat = generativeModel.startChat({ history });
          const result = await chat.sendMessage(lastMessage.parts[0].text);
          rawContent = result.response.text();
        } else {
          const result = await generativeModel.generateContent(userPrompt);
          rawContent = result.response.text();
        }
        break; // Success, exit retry loop
      } catch (err) {
        if (err.message?.includes('429') && retries > 1) {
          console.warn(`[gemini] Rate limit hit (429). Retrying in ${delayMs/1000}s...`);
          await delay(delayMs);
          delayMs *= 2;
          retries--;
        } else {
          throw err;
        }
      }
    }

    if (!rawContent) {
      throw new Error(`Gemini API returned an empty response`);
    }

    return parseGeminiResponse(rawContent);
  } catch (error) {
    console.error(`[gemini] Request failed:`, error.message);
    throw error;
  }
};

export default askGemini;
