/**
 * Layer 2 — Profile Enrichment
 *
 * Real data flow:
 *  1. Scrape LinkedIn page via rotating Webshare proxies → real HTML content
 *  2. If LinkedIn scrape fails (login wall) → fallback to Serper snippets
 *  3. Fetch GitHub API → real repos/stars/languages
 *  4. Feed ALL real data to AI → structured profile (no guessing)
 */

import { askClaude, AIFallbackRequiredError } from '../ai/claudeClient.js';
import { scrapeLinkedIn } from '../scraper/linkedinScraper.js';
import { scrapePage } from '../scraper/pageScraper.js';
import { clipPromptText } from './profileSnapshot.js';

const SYSTEM_PROMPT = `You are an expert B2B prospect research analyst.
You are given real scraped data about ONE confirmed person, tied to a specific LinkedIn profile URL.

Two tiers of data, treat them very differently:
1. CONFIRMED — the "LINKEDIN PROFILE", "LINKEDIN RECENT POSTS", and "GITHUB DATA" sections. This
   data is already tied to the exact confirmed profile. Extract from it fully, confidently, and
   in detail — this is exactly what you're here to do. Do not under-report or leave a field null
   just because it's only mentioned once.
2. UNVERIFIED — "OTHER SEARCH SNIPPETS" and "ADDITIONAL SCRAPED PAGES". These come from a generic
   name search and may describe a different person who happens to share this name. Use them only
   as minor supplementary color that doesn't conflict with the CONFIRMED data — never as your
   primary source for a fact, and never to override something already stated in CONFIRMED data.

Never use your own pretrained/background knowledge about a specific person with this name — many
people share common names, and anything you "remember" is very likely about someone else, not
present in the data you were actually given. (General knowledge about a well-known company or
product — what it does, when it was founded — is fine; general knowledge about a *person* is not.)

Only leave a field null if it is genuinely absent from BOTH the CONFIRMED and UNVERIFIED sections.
Always return valid JSON.`;

const SERPER_API_URL = 'https://google.serper.dev/search';
const LINKEDIN_SECTION_LIMIT = 4500;
const EXTRA_PAGE_SECTION_LIMIT = 4000;
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
  const currentYear = new Date().getFullYear();
  const queries = [
    `"${fullName}" site:linkedin.com/in`,
    `"${fullName}" ${company}`,
    `"${fullName}" github`,
    `"${fullName}" web3 OR blockchain OR developer`,
    // Recent activity: Google-indexed LinkedIn posts (most likely to be current)
    `"${fullName}" site:linkedin.com/posts`,
    // Recent talks, announcements, events (scoped to current + last year)
    `"${fullName}" speaking OR keynote OR announced OR launched ${currentYear} OR ${currentYear - 1}`,
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

// ─── Identity anchor guard ────────────────────────────────────────────────────
// A generic "name-based" Google search has no idea which of the many people
// sharing this name we mean. We only trust a non-LinkedIn snippet/page enough
// to feed it into the enrichment prompt if it corroborates something we
// already know for certain about THIS confirmed profile: the exact LinkedIn
// slug, the known company, or a personal domain that is literally their name.

const STOPWORDS = new Set([
  'the', 'inc', 'llc', 'ltd', 'co', 'corp', 'group', 'company', 'companies',
  'technologies', 'technology', 'labs', 'lab', 'studio', 'studios', 'team', 'and', 'of', 'for',
]);

const extractLinkedinSlug = (linkedinUrl) => {
  if (!linkedinUrl) return null;
  const match = linkedinUrl.match(/\/in\/([^/?]+)/i);
  return match ? match[1].toLowerCase() : null;
};

const companyTokensOf = (company) =>
  (company || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));

const matchesAnchor = ({ source = '', title = '', snippet = '' }, { companyTokens, linkedinSlug, firstName, lastName }) => {
  const haystack = `${source} ${title} ${snippet}`.toLowerCase();
  if (linkedinSlug && haystack.includes(linkedinSlug)) return true;
  if (companyTokens.some((token) => haystack.includes(token))) return true;

  // A domain that is literally the person's own name (e.g. farhadhossain.dev)
  // is strong self-identifying evidence, independent of company.
  try {
    const host = new URL(source).hostname.toLowerCase().replace(/^www\./, '');
    const hostCompact = host.replace(/[^a-z0-9]/g, '');
    const fn = (firstName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const ln = (lastName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (fn && ln && hostCompact.includes(fn) && hostCompact.includes(ln)) return true;
  } catch {
    // invalid URL — ignore
  }
  return false;
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

export const enrichProfile = async (prospect, discoveredIdentity, { callAI = askClaude, prospectContext = '' } = {}) => {
  let { linkedinUrl, githubUrl, xUrl, telegramHandle, email, website } = discoveredIdentity;
  const fullName = `${prospect.firstName} ${prospect.lastName || ''}`.trim();

  console.log(`[enrichment] Starting enrichment for ${fullName}`);

  // ── Step 1: LinkedIn profile+activity + Serper snippets in parallel ────────
  // scrapeLinkedIn() now runs a single browser session that visits:
  //   main profile → /details/experience → /details/education → /recent-activity/all
  // This avoids the "Execution context was destroyed" crash that happened
  // when two browser instances shared the same CDPSession cookies.
  const [linkedinResult, snippets] = await Promise.all([
    scrapeLinkedIn(linkedinUrl),
    collectSnippets(fullName, prospect.company || ''),
  ]);

  const linkedinText  = linkedinResult?.text || null;
  const linkedinPosts = linkedinResult?.posts || [];

  if (linkedinPosts.length > 0) {
    console.log(`[enrichment] ✅ ${linkedinPosts.length} LinkedIn posts fetched for recent activity`);
  } else {
    console.log('[enrichment] ⚠️  No LinkedIn posts scraped — will rely on Serper snippets for recent activity');
  }

  // Contact Info is scraped directly from the confirmed profile URL — authoritative
  // by construction. Prefer it over anything mined later from generic web search,
  // but a manually-provided rawEmail (already present in `email`) always wins.
  if (linkedinResult?.contactInfo) {
    if (!email && linkedinResult.contactInfo.email) {
      email = linkedinResult.contactInfo.email;
      console.log(`[enrichment] 🔗 Email from LinkedIn contact info: ${email}`);
    }
    if (!website && linkedinResult.contactInfo.website) {
      website = linkedinResult.contactInfo.website;
      console.log(`[enrichment] 🔗 Website from LinkedIn contact info: ${website}`);
    }
  }

  // ── Step 1b: Anchor-filter the name-based snippets ──────────────────────────
  // collectSnippets() is a pure name search — for a common name it will surface
  // unrelated people. Only keep results that corroborate the confirmed LinkedIn
  // slug, the known company, or a personal domain matching the person's name.
  const linkedinSlug = extractLinkedinSlug(linkedinUrl);
  const companyTokens = companyTokensOf(prospect.company);
  const anchor = { companyTokens, linkedinSlug, firstName: prospect.firstName, lastName: prospect.lastName };

  const linkedinSlugSnippets = linkedinSlug
    ? snippets.filter((s) => s.source.toLowerCase().includes(linkedinSlug))
    : [];
  const nonLinkedinSnippets = snippets.filter((s) => !s.source.includes('linkedin.com'));
  const corroboratedSnippets = nonLinkedinSnippets.filter((s) => matchesAnchor(s, anchor));

  const droppedCount = nonLinkedinSnippets.length - corroboratedSnippets.length;
  if (droppedCount > 0) {
    console.log(`[enrichment] 🛡️  Dropped ${droppedCount} unanchored snippet(s) — no corroboration with confirmed profile (possible namesake)`);
  }

  // ── Step 2: Scrape top non-LinkedIn/GitHub pages from search results ───────
  // These often contain personal websites, portfolios, dev.to, etc.
  // Only pages that already passed the anchor filter are worth the scrape budget.
  const scrapableUrls = corroboratedSnippets
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
      if (!email && link.startsWith('mailto:')) {
        const extractedEmail = link.replace('mailto:', '').split('?')[0].trim();
        if (extractedEmail && !extractedEmail.includes('example') && !extractedEmail.includes('test')) {
          email = extractedEmail;
          console.log(`[enrichment] 🔗 Email from ${scrapableUrls[i]}: ${email}`);
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
  // linkedinSection fallback: when the direct scrape fails, only trust Google-
  // indexed snippets whose URL contains the EXACT confirmed profile slug — not
  // just any linkedin.com link, which could belong to a different person
  // entirely (a same-named profile, someone else's post, a company page).
  const linkedinSection = linkedinText
    ? `=== LINKEDIN PROFILE (directly scraped — most reliable) ===\n${clipPromptText(linkedinText, LINKEDIN_SECTION_LIMIT)}`
    : linkedinSlugSnippets.length > 0
    ? `=== LINKEDIN SNIPPETS (Google indexed — LinkedIn scrape unavailable, filtered to profile /in/${linkedinSlug} only) ===
${summarizeSnippets(
  linkedinSlugSnippets,
  (s) => `Title: ${clipPromptText(s.title, 120)}\nSnippet: ${clipPromptText(s.snippet, SNIPPET_SECTION_LIMIT)}`
)}`
    : `=== LINKEDIN SNIPPETS ===
No Google-indexed snippets matched the confirmed profile URL. Do not substitute snippets about a
different linkedin.com profile — leave fields null instead of guessing.`;

  const snippetSection = `=== OTHER SEARCH SNIPPETS (anchor-corroborated only — may still be a namesake, do NOT use for bio/location/experience) ===
${corroboratedSnippets.length > 0
  ? summarizeSnippets(
      corroboratedSnippets,
      (s) =>
        `Source: ${s.source}\nTitle: ${clipPromptText(s.title, 120)}\nSnippet: ${clipPromptText(s.snippet, SNIPPET_SECTION_LIMIT)}`
    )
  : 'None — no search results could be corroborated against the confirmed identity.'}`;

  const extraSection = extraContent
    ? `=== ADDITIONAL SCRAPED PAGES (anchor-corroborated only — may still be a namesake, do NOT use for bio/location/experience) ===\n${extraContent}`
    : '';

  const linkedinActivitySection = linkedinPosts.length > 0
    ? `=== LINKEDIN RECENT POSTS (directly scraped — use these as the SOLE source for recentActivity) ===
${linkedinPosts.map((p, i) => `[Post ${i + 1}]\n${p}`).join('\n\n---\n\n')}`
    : `=== LINKEDIN RECENT POSTS ===
No posts could be scraped. Use Serper snippets tagged site:linkedin.com/posts below for any activity signals.
Do NOT infer activities from your training data.`;

  const userPrompt = `Build a comprehensive, detailed structured profile for this person, using the
scraped data below. The "LINKEDIN PROFILE" / "LINKEDIN RECENT POSTS" / "GITHUB DATA" sections are
CONFIRMED — they were scraped directly from this exact person's profile (${linkedinUrl || 'not resolved'},
identity confidence ${discoveredIdentity.identityConfidenceScore ?? 'unknown'}/100). Read them
closely and extract everything they contain — do not leave a field null if the CONFIRMED sections
actually state it. "OTHER SEARCH SNIPPETS" / "ADDITIONAL SCRAPED PAGES" are UNVERIFIED (may
describe a namesake) — use them only to add supplementary detail that doesn't conflict with the
CONFIRMED sections, never as your primary source. Do not use general/pretrained knowledge about
this specific person — their name may be shared by unrelated individuals online.

=== PERSON ===
Name: ${fullName}
Company: ${prospect.company || 'Unknown'}
${prospectContext ? `\n=== USER-PROVIDED CONTEXT (treat as reliable background info — verify against scraped data) ===\n${prospectContext}\n` : ''}
${linkedinSection}

${linkedinActivitySection}

${snippetSection}

${extraSection}

=== GITHUB DATA (from GitHub API) ===
${githubData ? JSON.stringify(githubData, null, 2) : 'No GitHub profile found.'}

=== INSTRUCTIONS ===
- Use scraped data as the primary source of truth
- The user-provided context gives you additional hints — use it to cross-verify and fill gaps, but always prefer scraped data when it conflicts
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
  // recentActivity RULES (CRITICAL):
  // - ONLY use content from the "LINKEDIN RECENT POSTS" section above.
  // - If no posts were scraped, use Serper snippets from site:linkedin.com/posts.
  // - NEVER invent activities from your training data or general knowledge.
  // - Each entry = a concise 1-sentence summary of one real post topic (up to 5).
  // - If no post data exists at all → return an empty array [].
  "recentActivity": ["one concise 1-sentence activity per post, sourced only from scraped posts above"],
  "previousCompanies": ["ONLY real companies — never universities, institutes, or schools"],
  "daoInvolvement": ["only if mentioned"],
  "githubStats": {
    "repos": number or null,
    "stars": number or null,
    "contributions": null,
    "topLanguages": []
  }
}`;

  let enriched = {};
  try {
    enriched = await callAI({ systemPrompt: SYSTEM_PROMPT, userPrompt, maxTokens: 1500, jsonMode: true });
  } catch (error) {
    if (error instanceof AIFallbackRequiredError) {
      console.warn(`[enrichment] Hard fallback triggered for prospect ${prospect._id}`);
      enriched = {
        currentRole: null,
        seniority: "unknown",
        yearsOfExperience: null,
        location: null,
        programmingLanguages: [],
        blockchainEcosystems: [],
        frameworks: [],
        founderExperience: false,
        web3NativeScore: 0,
        influenceLevel: "unknown",
        bio: "Fallback data applied because AI routing failed across all providers.",
        experience: [],
        education: [],
        recentActivity: [],
        previousCompanies: [],
        daoInvolvement: [],
        __isFallback: true
      };
    } else {
      throw error;
    }
  }

  return {
    ...discoveredIdentity,
    // Overwrite with any newly discovered links from page scraping
    githubUrl:       githubUrl       || discoveredIdentity.githubUrl,
    xUrl:            xUrl            || discoveredIdentity.xUrl,
    telegramHandle:  telegramHandle  || discoveredIdentity.telegramHandle,
    email:           email           || discoveredIdentity.email,
    website:         website         || discoveredIdentity.website,
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
