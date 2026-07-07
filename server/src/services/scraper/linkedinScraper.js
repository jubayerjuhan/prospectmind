/**
 * LinkedIn Scraper — Auto Login + Session Cache
 *
 * Flow:
 *  1. First run → Puppeteer logs in with LINKEDIN_EMAIL + LINKEDIN_PASSWORD
 *  2. Saves session cookies to .linkedin-session.json
 *  3. All future scrapes reuse saved session (no re-login needed)
 *  4. If session expires → auto re-login
 *
 * Full profile data: experience with titles + dates, skills, education, about, etc.
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { askClaude } from '../ai/claudeClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '../../../../.linkedin-session.json');

// ─── Session Persistence ──────────────────────────────────────────────────────

const saveSession = (cookies) => {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
    console.log('[linkedin] ✅ Session saved to .linkedin-session.json');
  } catch (e) {
    console.warn('[linkedin] Could not save session:', e.message);
  }
};

const loadSession = () => {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const cookies = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      console.log('[linkedin] Loaded saved session from file');
      return cookies;
    }
  } catch (e) {
    console.warn('[linkedin] Could not load session:', e.message);
  }
  return null;
};

// ─── Browser Factory ──────────────────────────────────────────────────────────

const launchBrowser = () =>
  puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--window-size=1280,900',
    ],
  });

const setupPage = async (browser) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  return page;
};

// ─── LinkedIn Login ───────────────────────────────────────────────────────────

const loginToLinkedIn = async (page) => {
  const email    = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;

  if (!email || !password) {
    console.warn('[linkedin] LINKEDIN_EMAIL or LINKEDIN_PASSWORD not set in .env');
    return false;
  }

  console.log('[linkedin] Logging in as', email);

  await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000)); // let form fully render

  // ── Collect all input metadata and hand it to AI ─────────────────────────
  // Sending structured input properties (not raw HTML) gives the model clean
  // signal to identify email/password fields in any language or DOM structure.
  const inputMeta = await page.evaluate(() =>
    [...document.querySelectorAll('input')].map((el, i) => ({
      index: i,
      type: el.type,
      name: el.name || null,
      id: el.id || null,
      autocomplete: el.getAttribute('autocomplete'),
      ariaLabel: el.getAttribute('aria-label'),
      placeholder: el.placeholder || null,
      visible: el.offsetParent !== null,
      labelText: el.labels?.[0]?.innerText?.trim() || null,
    }))
  );

  // ── Try AI first; fall back to known LinkedIn selectors ─────────────────
  let emailSel = null;
  let passSel  = null;

  try {
    console.log('[linkedin] Asking AI to identify login fields from', inputMeta.length, 'inputs...');
    const aiResult = await askClaude({
      systemPrompt:
        'You are a login form field identifier. Given a JSON list of HTML input elements with their attributes, ' +
        'identify which index is the email/username field and which is the password field. ' +
        'Prefer visible inputs (visible: true). Return ONLY valid JSON, no extra text.',
      userPrompt:
        `Login page inputs:\n${JSON.stringify(inputMeta, null, 2)}\n\n` +
        `Return JSON:\n{"emailIndex": <number>, "passwordIndex": <number>}`,
      maxTokens: 80,
    });

    if (typeof aiResult?.emailIndex === 'number' && typeof aiResult?.passwordIndex === 'number') {
      const emailEl = inputMeta[aiResult.emailIndex];
      const passEl  = inputMeta[aiResult.passwordIndex];
      // Build a unique selector from the identified element's attributes
      if (emailEl && passEl) {
        // Prefer stable attributes (name/autocomplete/type) over dynamic IDs
        emailSel = emailEl.name         ? `input[name="${emailEl.name}"]`
                 : emailEl.autocomplete ? `input[autocomplete="${emailEl.autocomplete}"]`
                 : `input[type="${emailEl.type}"]`;
        passSel  = passEl.name          ? `input[name="${passEl.name}"]`
                 : passEl.autocomplete  ? `input[autocomplete="${passEl.autocomplete}"]`
                 : `input[type="${passEl.type}"]`;
        console.log('[linkedin] AI identified — email index:', aiResult.emailIndex, '| password index:', aiResult.passwordIndex);
      }
    }
  } catch (e) {
    console.warn('[linkedin] AI field detection failed, using fallback selectors:', e.message.slice(0, 80));
  }

  // Fallback: LinkedIn's form has used these name attributes for years
  if (!emailSel || !passSel) {
    // Wait a moment in case the form is still rendering
    await new Promise(r => setTimeout(r, 1000));
    const FALLBACK_EMAIL = ['input[name="session_key"]', 'input[type="email"]', 'input[autocomplete="username"]'];
    const FALLBACK_PASS  = ['input[name="session_password"]', 'input[type="password"]', 'input[autocomplete="current-password"]'];
    for (const sel of FALLBACK_EMAIL) { if (await page.$(sel)) { emailSel = sel; break; } }
    for (const sel of FALLBACK_PASS)  { if (await page.$(sel)) { passSel  = sel; break; } }
    if (emailSel && passSel) console.log('[linkedin] Fallback selectors — email:', emailSel, '| password:', passSel);
  }

  if (!emailSel || !passSel) {
    console.warn('[linkedin] Could not locate login fields via AI or fallback selectors');
    return false;
  }

  // Set values via JS native setter (works regardless of React/Angular state)
  // IMPORTANT: LinkedIn renders two copies of the form (hidden + visible).
  // We must target only the VISIBLE inputs (offsetParent !== null).
  const fillResult = await page.evaluate((emailSel, passSel, emailVal, passVal) => {
    const allEmail = [...document.querySelectorAll(emailSel)];
    const allPass  = [...document.querySelectorAll(passSel)];

    // Pick the visible one; fall back to first if none are visible
    const emailEl = allEmail.find(el => el.offsetParent !== null) || allEmail[0];
    const passEl  = allPass.find(el => el.offsetParent !== null)  || allPass[0];

    if (!emailEl || !passEl) return { ok: false, reason: 'fields not found' };

    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

    nativeSet.call(emailEl, emailVal);
    emailEl.dispatchEvent(new Event('input',  { bubbles: true }));
    emailEl.dispatchEvent(new Event('change', { bubbles: true }));

    nativeSet.call(passEl, passVal);
    passEl.dispatchEvent(new Event('input',  { bubbles: true }));
    passEl.dispatchEvent(new Event('change', { bubbles: true }));

    // Focus the password field so Enter key submits the form
    passEl.focus();

    return { ok: true };
  }, emailSel, passSel, email, password);

  if (!fillResult.ok) {
    console.warn('[linkedin] Could not fill form fields:', fillResult.reason);
    return false;
  }

  await new Promise(r => setTimeout(r, 500));

  // Submit — press Enter on the focused password field (language-agnostic)
  await page.keyboard.press('Enter');

  // Wait for navigation after login
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

  const url = page.url();
  console.log('[linkedin] Post-login URL:', url);

  if (url.includes('checkpoint') || url.includes('challenge')) {
    console.warn('[linkedin] ⚠️  LinkedIn triggered a security challenge — manual verification needed');
    return false;
  }

  if (url.includes('feed') || url.includes('mynetwork') || !url.includes('login')) {
    console.log('[linkedin] ✅ Login successful');
    // Save session cookies
    const cookies = await page.cookies();
    saveSession(cookies);
    return true;
  }

  console.warn('[linkedin] Login may have failed — URL:', url);
  return false;
};

// ─── Scrape a single page and return cleaned innerText ───────────────────────

const scrapePageText = async (page, url) => {
  console.log(`[linkedin] ↳ Navigating to ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const currentUrl = page.url();
  if (currentUrl.includes('authwall') || currentUrl.includes('login') || currentUrl.includes('checkpoint')) {
    console.warn(`[linkedin] ↳ Hit authwall/login at ${currentUrl}`);
    return null;
  }

  await page.waitForSelector('h1', { timeout: 10000 }).catch(() => {});

  // Scroll down slowly to trigger all lazy-loaded sections
  console.log(`[linkedin] ↳ Scrolling ${url}...`);
  await page.evaluate(async () => {
    for (let i = 0; i < 30; i++) {
      window.scrollBy(0, 400);
      await new Promise(r => setTimeout(r, 200));
    }
  });
  await new Promise(r => setTimeout(r, 2000));

  console.log(`[linkedin] ↳ Extracting text from ${url}...`);

  return page.evaluate(() => {
    ['script', 'style', 'nav', 'footer', 'aside'].forEach(s =>
      document.querySelectorAll(s).forEach(el => el.remove())
    );
    return document.body.innerText;
  });
};

// ─── Profile Scraper ──────────────────────────────────────────────────────────

const scrapeProfilePage = async (page, url) => {
  // 1. Scrape main profile page
  const mainText = await scrapePageText(page, url);

  if (!mainText) {
    return { text: null, posts: [], sessionExpired: true };
  }

  // 2. Also scrape the /details/experience/ sub-page (full timeline with dates)
  const experienceUrl = url.replace(/\/$/, '') + '/details/experience/';
  console.log('[linkedin] Also scraping experience page:', experienceUrl);
  const expText = await scrapePageText(page, experienceUrl).catch(() => null);

  // 3. Also scrape /details/education/
  const educationUrl = url.replace(/\/$/, '') + '/details/education/';
  const eduText = await scrapePageText(page, educationUrl).catch(() => null);

  // 4. Also scrape /recent-activity/all/ in the SAME browser session
  // (Running it here avoids a second parallel browser instance that causes
  //  "Execution context was destroyed" crashes.)
  const posts = await scrapeActivityPage(page, url).catch(() => []);

  // Combine all sections
  const combined = [
    '=== MAIN PROFILE ===',
    mainText || '',
    expText ? '\n=== EXPERIENCE DETAILS ===' : '',
    expText || '',
    eduText ? '\n=== EDUCATION DETAILS ===' : '',
    eduText || '',
  ].filter(Boolean).join('\n');

  return { text: combined, posts, sessionExpired: false };
};

// ─── Activity Feed Scraper ──────────────────────────────────────────────────────

/**
 * Scrape the prospect's recent LinkedIn activity feed.
 *
 * LinkedIn exposes a person's posts at:
 *   https://www.linkedin.com/in/<handle>/recent-activity/all/
 *
 * This page lists posts the person authored with timestamps.
 * We extract up to MAX_POSTS posts and return them as trimmed text strings.
 *
 * @param {import('puppeteer').Page} page - An authenticated Puppeteer page
 * @param {string} linkedinUrl - Normalized profile URL (no trailing slash)
 * @returns {Promise<string[]>} Array of post text strings (may be empty)
 */
const MAX_ACTIVITY_POSTS = 8;

const scrapeActivityPage = async (page, linkedinUrl) => {
  const activityUrl = linkedinUrl.replace(/\/$/, '') + '/recent-activity/all/';
  console.log('[linkedin] Scraping activity feed:', activityUrl);

  try {
    await page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const currentUrl = page.url();
    if (
      currentUrl.includes('authwall') ||
      currentUrl.includes('login') ||
      currentUrl.includes('checkpoint')
    ) {
      console.warn('[linkedin] Activity feed blocked — not authenticated or challenged');
      return [];
    }

    // Scroll to load several posts (lazy-loaded)
    await page.evaluate(async () => {
      for (let i = 0; i < 20; i++) {
        window.scrollBy(0, 500);
        await new Promise((r) => setTimeout(r, 300));
      }
    });
    await new Promise((r) => setTimeout(r, 2000));

    // Extract post content from the activity feed.
    // LinkedIn renders each activity item in an <article> or a div with
    // data-urn attributes. We grab the visible text of each item.
    const posts = await page.evaluate((maxPosts) => {
      // Try known containers; LinkedIn changes class names frequently so we
      // cast a wide net and deduplicate by content.
      const selectors = [
        'div[data-urn] .feed-shared-update-v2__description',
        'div[data-urn] .update-components-text',
        'article .feed-shared-update-v2__description',
        'article .update-components-text',
        '.feed-shared-update-v2__description',
        '.update-components-text',
        '[data-finite-scroll-hotkey-item]',
      ];

      const seen = new Set();
      const results = [];

      for (const sel of selectors) {
        if (results.length >= maxPosts) break;
        document.querySelectorAll(sel).forEach((el) => {
          if (results.length >= maxPosts) return;
          const txt = el.innerText?.trim();
          if (txt && txt.length > 30 && !seen.has(txt)) {
            seen.add(txt);
            results.push(txt);
          }
        });
      }

      if (results.length === 0) {
        document.querySelectorAll('article').forEach((el) => {
          if (results.length >= maxPosts) return;
          const txt = el.innerText?.trim();
          if (txt && txt.length > 40 && !seen.has(txt)) {
            seen.add(txt);
            results.push(txt.slice(0, 800));
          }
        });
      }

      return results;
    }, MAX_ACTIVITY_POSTS);

    const trimmed = posts
      .map((p) => p.replace(/\n{3,}/g, '\n\n').trim().slice(0, 600))
      .filter((p) => p.length > 30);

    console.log(`[linkedin] ✅ Activity feed: ${trimmed.length} posts found`);
    return trimmed;
  } catch (err) {
    console.warn('[linkedin] Activity feed scrape failed (non-fatal):', err.message);
    return [];
  }
};

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Standalone export — scrapes ONLY the activity feed in its own browser session.
 * Use this only when you already have the profile text and just need posts.
 * For full pipeline use, call scrapeLinkedIn() which returns both.
 */
export const scrapeLinkedInActivity = async (linkedinUrl) => {
  if (!linkedinUrl) return [];

  const url = linkedinUrl.split('?')[0].replace(/\/$/, '');

  let browser;
  try {
    browser = await launchBrowser();
    const page = await setupPage(browser);

    const savedCookies = loadSession();
    if (savedCookies) {
      const cdp = await page.createCDPSession();
      await cdp.send('Network.setCookies', { cookies: savedCookies });
    } else {
      const loggedIn = await loginToLinkedIn(page);
      if (!loggedIn) {
        await browser.close();
        return [];
      }
    }

    const posts = await scrapeActivityPage(page, url);
    await browser.close();
    return posts;
  } catch (err) {
    console.error('[linkedin] scrapeLinkedInActivity error:', err.message);
    if (browser) await browser.close().catch(() => {});
    return [];
  }
};

/**
 * Main export — scrapes profile + experience + education + activity feed
 * all in ONE browser session to avoid parallel-browser context crashes.
 *
 * Returns: { text: string|null, posts: string[] }
 *   text  — combined profile text for the AI enrichment prompt
 *   posts — array of recent LinkedIn post strings (may be empty)
 */
export const scrapeLinkedIn = async (linkedinUrl) => {
  if (!linkedinUrl) return { text: null, posts: [] };

  const url = linkedinUrl.split('?')[0].replace(/\/$/, '');
  console.log(`[linkedin] Scraping: ${url}`);

  let browser;
  try {
    browser = await launchBrowser();
    const page = await setupPage(browser);

    // ── Try saved session or login fresh ─────────────────────────────────
    const savedCookies = loadSession();

    if (savedCookies) {
      // Restore saved session
      const cdp = await page.createCDPSession();
      await cdp.send('Network.setCookies', { cookies: savedCookies });
      console.log('[linkedin] Using saved session');
    } else {
      // No session — must login first
      console.log('[linkedin] No saved session — logging in');
      const loggedIn = await loginToLinkedIn(page);
      if (!loggedIn) {
        await browser.close();
        return { text: null, posts: [] };
      }
    }

    // ── Scrape the profile (+ activity in the same session) ───────────────
    let { text, posts, sessionExpired } = await scrapeProfilePage(page, url);

    // ── Check if we're actually logged in (not just public view) ──────────
    const isLoggedOut = text && (
      text.includes('Join to view full profile') ||
      /View .+?'s full (profile|experience)/i.test(text) ||
      (text.includes('Sign in') && text.includes('Join now') && !text.includes('notifications'))
    );

    if (sessionExpired || isLoggedOut) {
      console.log('[linkedin] Not logged in — re-logging in');
      const loggedIn = await loginToLinkedIn(page);
      if (!loggedIn) {
        await browser.close();
        return { text: null, posts: [] };
      }
      const result = await scrapeProfilePage(page, url);
      text  = result.text;
      posts = result.posts;
    }

    await browser.close();

    if (!text || text.length < 200) {
      console.warn('[linkedin] Profile text too short');
      return { text: null, posts };
    }

    // Clean up text
    const cleaned = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .slice(0, 5000);

    console.log(`[linkedin] ✅ Scraped ${cleaned.length} chars | ${posts.length} activity posts`);
    return { text: cleaned, posts };

  } catch (err) {
    console.error('[linkedin] Error:', err.message);
    if (browser) await browser.close().catch(() => {});
    return { text: null, posts: [] };
  }
};
