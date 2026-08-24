/**
 * Local AI client — self-hosted `groq-ai-api` (Express backend wrapping Groq
 * chat completions with its own model fallback chain: gpt-oss-120b →
 * qwen3.6-27b → gpt-oss-20b → compound → compound-mini → allam-2-7b).
 *
 * This is a *different* backend from groqClient.js (which calls Groq's own
 * api.groq.com directly). It fans out across six Groq-hosted models behind
 * one endpoint, so a single call here already carries its own fallback —
 * askAI() in claudeClient.js only needs to reach for it once, as a last
 * resort after Gemini's full chain fails.
 *
 * Response envelope: { success: true, data } | { success: false, message, retryInMs? }.
 * See groq-ai-api's README for the full contract.
 */

import { parseGroqResponse } from './groqClient.js';

const DEFAULT_BASE_URL = 'http://localhost:4000';
// No default fetch timeout — see the same guard in geminiClient.js/groqClient.js.
const REQUEST_TIMEOUT_MS = Number(process.env.LOCAL_AI_TIMEOUT_MS) || 120000;

/** @returns {string|null} configured base URL, or null if the local AI backend isn't set up. */
export const resolveLocalAiBaseUrl = () => {
  const url = process.env.LOCAL_AI_BASE_URL;
  return url ? url.replace(/\/$/, '') : null;
};

/**
 * @param {object} options
 * @param {string} [options.systemPrompt]
 * @param {string} [options.userPrompt]
 * @param {Array<{role: string, content: string}>} [options.messages]
 * @param {number} [options.maxTokens]
 * @param {number} [options.temperature]
 * @param {string[]} [options.only] - restrict/reorder groq-ai-api's own model chain
 * @returns {object|string} parsed JSON when possible, otherwise raw text
 */
export const askLocalAI = async ({
  systemPrompt,
  userPrompt,
  messages,
  maxTokens,
  temperature = 0.4,
  only,
}) => {
  const baseUrl = resolveLocalAiBaseUrl();
  if (!baseUrl) {
    throw new Error('LOCAL_AI_BASE_URL is not configured');
  }

  const requestMessages =
    messages ||
    [
      systemPrompt ? { role: 'system', content: systemPrompt } : null,
      userPrompt ? { role: 'user', content: userPrompt } : null,
    ].filter(Boolean);

  if (!requestMessages.length) {
    throw new Error('askLocalAI requires systemPrompt/userPrompt or messages');
  }

  const body = {
    messages: requestMessages,
    temperature,
    // Leave unset when not provided — a tight cap can starve gpt-oss models'
    // internal reasoning and yield an empty content string (see API docs).
    ...(maxTokens != null && { max_completion_tokens: maxTokens }),
    ...(only && { only }),
  };

  let response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Local AI request failed: ${error.message}`);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success) {
    const message = payload?.message || response.statusText || 'Unknown local AI error';
    const retryNote = response.status === 503 && payload?.retryInMs ? ` (retry in ${payload.retryInMs}ms)` : '';
    throw new Error(`Local AI error (${response.status}): ${message}${retryNote}`);
  }

  const { data } = payload;
  const content = data?.message?.content;
  if (!content) {
    throw new Error(`Local AI (${data?.model || 'unknown model'}) returned an empty response`);
  }

  console.log(
    `[local-ai] ${data.model} — tokens=${data.usage?.total_tokens ?? '?'} finish=${data.finishReason ?? '?'}`
  );

  return parseGroqResponse(content);
};

export default askLocalAI;
