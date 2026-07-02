/**
 * Layer 2 — Profile Enrichment
 *
 * Real data flow:
 *  1. Scrape LinkedIn page via rotating Webshare proxies → real HTML content
 *  2. If LinkedIn scrape fails (login wall) → fallback to Serper snippets
 *  3. Fetch GitHub API → real repos/stars/languages
 *  4. Feed ALL real data to AI → structured profile (no guessing)
 */

import { askClaude } from '../ai/claudeClient.js';
import { scrapeLinkedIn } from '../scraper/linkedinScraper.js';
import { scrapePage } from '../scraper/pageScraper.js';
import { clipPromptText } from './profileSnapshot.js';

const SYSTEM_PROMPT = `You are an expert B2B prospect research analyst.
You are given scraped content from LinkedIn, GitHub, personal websites, and Google search snippets.
Your job is to produce the richest possible structured profile by combining:
1. The scraped data provided (treat as primary source)
2. Your general knowledge about this person, their company, and their public work

Prioritise scraped data when it contradicts your knowledge.
Make reasonable inferences where data is sparse — clearly mark inferred fields with best-effort estimates.
Always return valid JSON.`;

const SERPER_API_URL = 'https://google.serper.dev/search';
const LINKEDIN_SECTION_LIMIT = 4500;
const EXTRA_PAGE_SECTION_LIMIT = 1400;
const SNIPPET_SECTION_LIMIT = 240;

// ─── Serper Fallback Search ───────────────────────────────────────────────────

const searchGoogle = async (query) => {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(SERPER_API_URL, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.organic || [];
  } catch {
    return [];
  }
};

const collectSnippets = async (fullName, company) => {
  const queries = [
    `"${fullName}" site:linkedin.com/in`,
    `"${fullName}" ${company}`,
    `"${fullName}" github`,
    `"${fullName}" web3 OR blockchain OR developer`,
  ];

  const allResults = await Promise.all(queries.map((q) => searchGoogle(q)));

  const seen = new Set();
  const snippets = [];
  for (const results of allResults) {
    for (const r of results) {
      if (!seen.has(r.link)) {
        seen.add(r.link);
        snippets.push({ source: r.link, title: r.title || '', snippet: r.snippet || '' });
      }
    }
  }
  return snippets;
};

const summarizeSnippets = (snippets = [], formatter) =>
  snippets
    .slice(0, 6)
    .map((snippet) => formatter(snippet))
    .join('\n\n');

// ─── GitHub API ───────────────────────────────────────────────────────────────

const fetchGitHubData = async (githubUrl) => {
  if (!githubUrl) return null;

  try {
    const username = githubUrl.replace('https://github.com/', '').replace(/\/$/, '');
    const headers = process.env.GITHUB_TOKEN
      ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
      : {};

    const [userRes, reposRes] = await Promise.all([
      fetch(`https://api.github.com/users/${username}`, { headers }),
      fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=30`, { headers }),
    ]);

    if (!userRes.ok) return null;

    const user = await userRes.json();
    const repos = reposRes.ok ? await reposRes.json() : [];

    const langCounts = {};
    repos.forEach((r) => {
      if (r.language) langCounts[r.language] = (langCounts[r.language] || 0) + 1;
    });
    const topLanguages = Object.entries(langCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([lang]) => lang);

    return {
      bio: user.bio,
      location: user.location,
      company: user.company,
      publicRepos: user.public_repos,
      followers: user.followers,
      totalStars: repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0),
      topLanguages,
      recentRepos: repos.slice(0, 5).map((r) => ({
        name: r.name,
        description: r.description,
        stars: r.stargazers_count,
        language: r.language,
      })),
    };
  } catch {
    return null;
  }
};

// ─── Main Export ──────────────────────────────────────────────────────────────

// ─── Name-match guard ────────────────────────────────────────────────────────
// A social link found on a company "about us" page may belong to a co-founder,
// not the prospect. Only accept a link if its username loosely matches the
// prospect's name (first name, last name, or common combo).

const GITHUB_BLOCKLIST = ['features','topics','collections','explore','marketplace','login','signup','orgs'];
const X_BLOCKLIST      = ['home','explore','notifications','messages','settings','i','intent'];

const usernameMatchesName = (username, firstName, lastName) => {
  const u  = username.toLowerCase().replace(/[^a-z0-9]/g, '');
  const fn = (firstName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ln = (lastName  || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Accept if username contains first name, last name, or both combined
  return (fn && u.includes(fn)) || (ln && u.includes(ln));
};

// ─── Extract social/profile links from scraped text ─────────────────────────

const extractLinksFromText = (text, firstName, lastName) => {
  const found = {};

  const github = text.match(/https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9_-]+)(?:\/)?(?!\S)/);
  if (github && !GITHUB_BLOCKLIST.includes(github[1]) && usernameMatchesName(github[1], firstName, lastName)) {
    found.githubUrl = `https://github.com/${github[1]}`;
  }

  const twitter = text.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/);
  if (twitter && !X_BLOCKLIST.includes(twitter[1]) && usernameMatchesName(twitter[1], firstName, lastName)) {
    found.xUrl = `https://x.com/${twitter[1]}`;
  }

  const telegram = text.match(/@([a-zA-Z0-9_]{5,32})\b.*telegram|telegram.*@([a-zA-Z0-9_]{5,32})/i);
  const tgHandle = telegram?.[1] || telegram?.[2];
  if (tgHandle && usernameMatchesName(tgHandle, firstName, lastName)) {
    found.telegramHandle = tgHandle;
  }

  const email = text.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
  if (email && !email[1].includes('example') && !email[1].includes('test')) {
    found.email = email[1];
  }

  return found;
};

// ─── Main Export ──────────────────────────────────────────────────────────────

export const enrichProfile = async (prospect, discoveredIdentity) => {
  let { linkedinUrl, githubUrl, xUrl, telegramHandle, email } = discoveredIdentity;
  const fullName = `${prospect.firstName} ${prospect.lastName || ''}`.trim();

  console.log(`[enrichment] Starting enrichment for ${fullName}`);

  // ── Step 1: LinkedIn + search snippets in parallel (GitHub comes later) ──
  const [linkedinText, snippets] = await Promise.all([
    scrapeLinkedIn(linkedinUrl),
    collectSnippets(fullName, prospect.company || ''),
  ]);

  // ── Step 2: Scrape top non-LinkedIn/GitHub pages from search results ───────
  // These often contain personal websites, portfolios, dev.to, etc.
  const scrapableUrls = snippets
    .map((s) => s.source)
    .filter((url) =>
      !url.includes('linkedin.com') &&
      !url.includes('github.com') &&
      !url.includes('google.com') &&
      url.startsWith('http')
    )
    .slice(0, 3); // up from 2 → scrape top 3 pages

  console.log(`[enrichment] Scraping ${scrapableUrls.length} extra pages:`, scrapableUrls);
  const extraPageTexts = await Promise.all(scrapableUrls.map((url) => scrapePage(url)));

  // ── Step 3: Mine scraped pages for social profile links ────────────────────
  // Puppeteer returns { text, links } — links[] contains every <a href> on the page.
  // Personal websites (e.g. jubayerjuhan.info) have GitHub/X/email in nav/footer.
  for (let i = 0; i < scrapableUrls.length; i++) {
    const result = extraPageTexts[i];
    if (!result) continue;

    const text  = typeof result === 'string' ? result : result.text  || '';
    const links = typeof result === 'string' ? []     : result.links || [];

    const { firstName, lastName } = prospect;

    // 1. Check the explicit links array first (most reliable — actual hrefs)
    //    NAME GUARD: skip any social link whose username doesn't match this person.
    //    e.g. goodhive.io/about-us has Benoit's Twitter — must not assign to Jubayer.
    for (const link of links) {
      if (!githubUrl) {
        const gh = link.match(/^https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9_-]+)\/?$/);
        if (gh && !GITHUB_BLOCKLIST.includes(gh[1]) && usernameMatchesName(gh[1], firstName, lastName)) {
          githubUrl = `https://github.com/${gh[1]}`;
          console.log(`[enrichment] 🔗 GitHub from ${scrapableUrls[i]}: ${githubUrl}`);
        }
      }
      if (!xUrl) {
        const xm = link.match(/^https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/);
        if (xm && !X_BLOCKLIST.includes(xm[1]) && usernameMatchesName(xm[1], firstName, lastName)) {
          xUrl = link.split('?')[0];
          console.log(`[enrichment] 🔗 X/Twitter from ${scrapableUrls[i]}: ${xUrl}`);
        }
      }
    }

    // 2. Also scan the text for anything the links array might have missed
    const found = extractLinksFromText(text, firstName, lastName);
    if (found.githubUrl && !githubUrl) {
      githubUrl = found.githubUrl;
      console.log(`[enrichment] 🔗 GitHub (text) from ${scrapableUrls[i]}: ${githubUrl}`);
    }
    if (found.xUrl && !xUrl) {
      xUrl = found.xUrl;
      console.log(`[enrichment] 🔗 X/Twitter (text) from ${scrapableUrls[i]}: ${xUrl}`);
    }
    if (found.telegramHandle && !telegramHandle) {
      telegramHandle = found.telegramHandle;
      console.log(`[enrichment] 🔗 Telegram from ${scrapableUrls[i]}: ${telegramHandle}`);
    }
    if (found.email && !email) {
      email = found.email;
      console.log(`[enrichment] 🔗 Email from ${scrapableUrls[i]}: ${email}`);
    }
  }

  // Also check LinkedIn text for social links
  if (linkedinText) {
    const found = extractLinksFromText(linkedinText, prospect.firstName, prospect.lastName);
    if (found.githubUrl && !githubUrl) githubUrl = found.githubUrl;
    if (found.xUrl && !xUrl) xUrl = found.xUrl;
    if (found.email && !email) email = found.email;
  }

  // ── Step 4: Now fetch GitHub API with the best URL we found ───────────────
  const githubData = await fetchGitHubData(githubUrl);
  if (githubData) console.log(`[enrichment] ✅ GitHub data fetched for ${githubUrl}`);

  const extraContent = scrapableUrls
    .map((url, i) => {
      const r = extraPageTexts[i];
      if (!r) return null;
      const text = typeof r === 'string' ? r : r.text;
      return text ? `Source: ${url}\n${clipPromptText(text, EXTRA_PAGE_SECTION_LIMIT)}` : null;
    })
    .filter(Boolean)
    .join('\n\n---\n\n');

  // ── Step 3: Build prompt sections ─────────────────────────────────────────
  const linkedinSection = linkedinText
    ? `=== LINKEDIN PROFILE (directly scraped — most reliable) ===\n${clipPromptText(linkedinText, LINKEDIN_SECTION_LIMIT)}`
    : `=== LINKEDIN SNIPPETS (Google indexed — LinkedIn scrape unavailable) ===
${summarizeSnippets(
  snippets.filter((s) => s.source.includes('linkedin')),
  (s) => `Title: ${clipPromptText(s.title, 120)}\nSnippet: ${clipPromptText(s.snippet, SNIPPET_SECTION_LIMIT)}`
)}`;

  const snippetSection = `=== OTHER SEARCH SNIPPETS ===
${summarizeSnippets(
  snippets.filter((s) => !s.source.includes('linkedin')),
  (s) =>
    `Source: ${s.source}\nTitle: ${clipPromptText(s.title, 120)}\nSnippet: ${clipPromptText(s.snippet, SNIPPET_SECTION_LIMIT)}`
)}`;

  const extraSection = extraContent
    ? `=== ADDITIONAL SCRAPED PAGES ===\n${extraContent}`
    : '';

  const userPrompt = `Build a comprehensive structured profile for this person.
Use the scraped data as primary source. Fill in gaps using your general knowledge where the scraped data is sparse.

=== PERSON ===
Name: ${fullName}
Company: ${prospect.company || 'Unknown'}

${linkedinSection}

${snippetSection}

${extraSection}

=== GITHUB DATA (from GitHub API) ===
${githubData ? JSON.stringify(githubData, null, 2) : 'No GitHub profile found.'}

=== INSTRUCTIONS ===
- Use scraped data as the primary source of truth
- Fill gaps with your general knowledge about this person and their public work
- Produce the richest possible profile — don't leave arrays empty if you know the information
- Estimate yearsOfExperience and seniority from available context

⚠️ CRITICAL — EDUCATION vs COMPANY:
LinkedIn snippets often list education institutions right after work companies with no separator.
Words like "University", "Institute", "College", "Academy", "School", "Technology Institute" are EDUCATION — NOT companies.
Never put an educational institution into "previousCompanies" or "experience".
Example: "GoodHive.io  Institute Of Science And Technology, Bangladesh" →
  company = "GoodHive.io", education = "Institute Of Science And Technology" (ignore for companies list)

⚠️ CRITICAL — EXPERIENCE array:
Only include WORK experience (jobs, contracts, freelance).
Do NOT include education, courses, or certifications in the experience array.

Return JSON:
{
  "currentRole": "exact current job title from LinkedIn headline or null",
  "seniority": "junior|mid|senior|lead|executive|unknown",
  "yearsOfExperience": number or null,
  "location": "city/country if mentioned or null",
  "programmingLanguages": ["only if explicitly mentioned"],
  "blockchainEcosystems": ["only if explicitly mentioned"],
  "frameworks": ["only if explicitly mentioned e.g. Next.js, PostgreSQL, GCP"],
  "founderExperience": true or false,
  "web3NativeScore": 0-100,
  "influenceLevel": "low|medium|high|very_high|unknown",
  "bio": "1-2 sentence summary from the scraped content only",
  "experience": [
    {
      "title": "job title — WORK ONLY, never education",
      "company": "company name — NEVER a university/institute/college",
      "duration": "e.g. Jun 2023 - Present · 3 yrs",
      "location": "city or Remote or null",
      "description": "what they did, max 2 sentences",
      "skills": ["skill1", "skill2"]
    }
  ],
  "education": [
    {
      "institution": "university or institute name",
      "degree": "degree or field of study or null"
    }
  ],
  "recentActivity": ["up to 3 things explicitly mentioned"],
  "previousCompanies": ["ONLY real companies — never universities, institutes, or schools"],
  "daoInvolvement": ["only if mentioned"],
  "githubStats": {
    "repos": number or null,
    "stars": number or null,
    "contributions": null,
    "topLanguages": []
  }
}`;

  const enriched = await askClaude({ systemPrompt: SYSTEM_PROMPT, userPrompt, maxTokens: 1500 });

  return {
    ...discoveredIdentity,
    // Overwrite with any newly discovered links from page scraping
    githubUrl:       githubUrl       || discoveredIdentity.githubUrl,
    xUrl:            xUrl            || discoveredIdentity.xUrl,
    telegramHandle:  telegramHandle  || discoveredIdentity.telegramHandle,
    email:           email           || discoveredIdentity.email,
    ...enriched,
    ...(githubData && {
      githubStats: {
        repos: githubData.publicRepos,
        stars: githubData.totalStars,
        contributions: null,
        topLanguages: githubData.topLanguages,
      },
    }),
  };
};
