/**
 * Layer 1 — Identity Resolution
 * Uses Serper (Google Search API) to find real LinkedIn URLs.
 * AI is used only to VERIFY / pick the best match — not to guess.
 *
 * Search strategy (tries progressively looser queries until URLs are found):
 *  1. "Full Name" site:linkedin.com/in  (most precise)
 *  2. Full Name Company linkedin         (no site filter — broader)
 *  3. Full Name Company github           (for GitHub)
 */

import { askClaude } from '../ai/claudeClient.js';

const SERPER_API_URL = 'https://google.serper.dev/search';

// ─── Serper Search Helper ────────────────────────────────────────────────────

const searchGoogle = async (query) => {
  const apiKey = process.env.SERPER_API_KEY;

  if (!apiKey) {
    console.warn('[discovery] SERPER_API_KEY not set — skipping real search');
    return [];
  }

  try {
    const res = await fetch(SERPER_API_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 5 }),
    });

    if (!res.ok) {
      console.error('[discovery] Serper error:', res.status, await res.text());
      return [];
    }

    const data = await res.json();
    return data.organic || [];
  } catch (err) {
    console.error('[discovery] Serper fetch failed:', err.message);
    return [];
  }
};

// ─── URL Extractors ──────────────────────────────────────────────────────────

const extractLinkedinUrls = (results) => {
  const urls = [];
  for (const r of results) {
    if (r.link && r.link.includes('linkedin.com/in/')) {
      // Normalize regional subdomains: fr.linkedin.com → linkedin.com
      const clean = r.link
        .replace(/^https?:\/\/[a-z]{2}\.linkedin\.com/, 'https://www.linkedin.com')
        .replace(/^https?:\/\/linkedin\.com/, 'https://www.linkedin.com')
        .split('?')[0]
        .replace(/\/$/, '');
      if (!urls.includes(clean)) urls.push(clean);
    }
  }
  return urls;
};

const extractGithubUrls = (results) => {
  const urls = [];
  for (const r of results) {
    if (
      r.link &&
      r.link.includes('github.com/') &&
      !r.link.includes('github.com/orgs/') &&
      !r.link.includes('/issues') &&
      !r.link.includes('/pull') &&
      !r.link.includes('/blob')
    ) {
      const clean = r.link.split('?')[0].replace(/\/$/, '');
      const parts = clean.replace('https://github.com/', '').split('/');
      if (parts.length === 1 && !urls.includes(clean)) {
        urls.push(clean);
      }
    }
  }
  return urls;
};

// ─── LinkedIn Search with Fallback ──────────────────────────────────────────

/**
 * Try multiple search strategies until we get LinkedIn URLs.
 * Goes from specific → broad to maximise hit rate.
 */
const findLinkedinUrl = async (fullName, company) => {
  const strategies = [
    // Most precise — name only with site filter
    `"${fullName}" site:linkedin.com/in`,
    // Broader — name + company, no site filter (Google still surfaces LinkedIn)
    `${fullName} ${company} linkedin`,
    // Broadest — just name + linkedin
    `${fullName} linkedin profile`,
  ];

  for (const query of strategies) {
    console.log(`[discovery] LinkedIn search: ${query}`);
    const results = await searchGoogle(query);
    const urls = extractLinkedinUrls(results);

    if (urls.length > 0) {
      console.log(`[discovery] ✅ Found LinkedIn: ${urls.join(', ')}`);
      return { urls, results };
    }

    console.log(`[discovery] ↳ No LinkedIn URLs — trying next strategy`);
  }

  console.log(`[discovery] ❌ No LinkedIn found after all strategies`);
  return { urls: [], results: [] };
};

// ─── AI Verifier ─────────────────────────────────────────────────────────────

const verifyWithAI = async (prospect, linkedinCandidates, githubCandidates, searchSnippets) => {
  const { firstName, lastName, company } = prospect;

  const systemPrompt = `You are an identity verification assistant.
You are given REAL Google search results. Pick the best matching profile URL from the candidates provided.
Do NOT invent or guess any URLs. Only select from the candidates list. Return null if none match confidently.
Always return valid JSON.`;

  const userPrompt = `Person to identify:
- Name: ${firstName} ${lastName || ''}
- Company: ${company || 'Unknown'}

LinkedIn candidates (real URLs from Google):
${linkedinCandidates.length ? linkedinCandidates.map((u, i) => `${i + 1}. ${u}`).join('\n') : 'None found'}

GitHub candidates (real URLs from Google):
${githubCandidates.length ? githubCandidates.map((u, i) => `${i + 1}. ${u}`).join('\n') : 'None found'}

Search result snippets for context:
${searchSnippets.slice(0, 5).map((s) => `- ${s.title}: ${s.snippet || ''}`).join('\n')}

Pick the best URL for each. Return JSON:
{
  "linkedinUrl": "exact URL from candidates or null",
  "githubUrl": "exact URL from candidates or null",
  "confidenceScore": 0-100,
  "reasoning": "one sentence"
}`;

  const result = await askClaude({ systemPrompt, userPrompt, maxTokens: 512 });

  return {
    linkedinUrl: result.linkedinUrl || null,
    githubUrl: result.githubUrl || null,
    confidenceScore: result.confidenceScore || 0,
    reasoning: result.reasoning || '',
  };
};

// ─── Main Export ──────────────────────────────────────────────────────────────

export const resolveIdentity = async (prospect) => {
  const { firstName, lastName, company, rawEmail, rawLinkedin, rawGithub, rawX, rawTelegram } = prospect;
  const fullName = `${firstName} ${lastName || ''}`.trim();

  // User already provided LinkedIn — skip search
  if (rawLinkedin) {
    console.log(`[discovery] LinkedIn provided manually for ${fullName}, skipping search`);
    return {
      linkedinUrl: rawLinkedin,
      githubUrl: rawGithub || null,
      xUrl: rawX || null,
      telegramHandle: rawTelegram || null,
      email: rawEmail || null,
      identityConfidenceScore: 100,
      confidenceReasoning: 'Manually provided by user',
      searchQueries: [],
    };
  }

  // ── Step 1: Find LinkedIn via smart fallback search ───────────────────────
  const { urls: linkedinCandidates, results: linkedinResults } = await findLinkedinUrl(fullName, company || '');

  // ── Step 2: Find GitHub ───────────────────────────────────────────────────
  let githubCandidates = rawGithub ? [rawGithub] : [];
  let githubResults = [];

  if (!rawGithub) {
    const githubQuery = `"${fullName}" site:github.com`;
    console.log(`[discovery] GitHub search: ${githubQuery}`);
    githubResults = await searchGoogle(githubQuery);
    githubCandidates = extractGithubUrls(githubResults);
    console.log(`[discovery] GitHub candidates: ${githubCandidates.join(', ') || 'none'}`);
  }

  const allSnippets = [...linkedinResults, ...githubResults];

  // ── Step 3: No candidates at all → return empty ───────────────────────────
  if (linkedinCandidates.length === 0 && githubCandidates.length === 0) {
    console.log(`[discovery] No social profiles found for ${fullName}`);
    return {
      linkedinUrl: null,
      githubUrl: null,
      xUrl: rawX || null,
      telegramHandle: rawTelegram || null,
      email: rawEmail || null,
      identityConfidenceScore: 0,
      confidenceReasoning: 'No profiles found in Google search',
      searchQueries: [],
    };
  }

  // ── Step 4: If only 1 LinkedIn candidate → use it directly (skip AI verify)
  if (linkedinCandidates.length === 1 && githubCandidates.length === 0) {
    console.log(`[discovery] Single LinkedIn match — using directly: ${linkedinCandidates[0]}`);
    return {
      linkedinUrl: linkedinCandidates[0],
      githubUrl: rawGithub || null,
      xUrl: rawX || null,
      telegramHandle: rawTelegram || null,
      email: rawEmail || null,
      identityConfidenceScore: 85,
      confidenceReasoning: 'Single LinkedIn match found via Google search',
      searchQueries: [],
    };
  }

  // ── Step 5: Multiple candidates → AI picks the best one ─────────────────
  const verified = await verifyWithAI(prospect, linkedinCandidates, githubCandidates, allSnippets);

  return {
    linkedinUrl: verified.linkedinUrl,
    githubUrl: verified.githubUrl || rawGithub || null,
    xUrl: rawX || null,
    telegramHandle: rawTelegram || null,
    email: rawEmail || null,
    identityConfidenceScore: verified.confidenceScore,
    confidenceReasoning: verified.reasoning,
    searchQueries: [],
  };
};
