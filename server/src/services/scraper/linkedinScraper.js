/**
 * LinkedIn Scraper — Auto Login + Session Cache
 *
 * Flow:
 *  1. First run → Puppeteer logs in with LINKEDIN_EMAIL + LINKEDIN_PASSWORD
 *  2. Saves session cookies to MongoDB (LinkedInSession — a singleton doc)
 *  3. All future scrapes reuse saved session (no re-login needed)
 *  4. If session expires → auto re-login
 *
 * Session storage lives in MongoDB rather than a local file so it survives
 * redeploys (ephemeral filesystems) and works if this ever runs on more than
 * one server instance.
 *
 * Full profile data: experience with titles + dates, skills, education, about, etc.
 */

import puppeteer from 'puppeteer';
import { askClaude } from '../ai/claudeClient.js';
import LinkedInSession from '../../models/LinkedInSession.js';
import {
  resolveSessionProxy,
  clearSessionProxy,
  pickDeviceCookies,
  buildLaunchArgs,
  applyPageIdentity,
  attachProxyAuth,
  LOGIN_PROFILE_DIR,
} from './linkedinBrowserIdentity.js';

// ─── Session Persistence (MongoDB, singleton doc) ────────────────────────────

// CDP's getAllCookies (page.cookies()) returns output-only fields like
// `partitionKey`, `size`, `session`, `priority`, `sourceScheme`, `sourcePort`
// that Network.setCookies either ignores or, in the case of `partitionKey`,
// fails to deserialize ("CBOR: map start expected") because the captured shape
// (a string) doesn't match the map shape setCookies expects. Keep only the
// fields setCookies actually accepts. LinkedIn's auth cookies (li_at,
// JSESSIONID, bcookie…) are never partitioned, so dropping partitionKey is safe.
const sanitizeCookies = (cookies) =>
  (cookies || [])
    .filter((c) => c && c.name)
    .map(({ name, value, url, domain, path, secure, httpOnly, sameSite, expires }) => {
      const clean = { name, value };
      if (url) clean.url = url;
      if (domain) clean.domain = domain;
      if (path) clean.path = path;
      if (typeof secure === 'boolean') clean.secure = secure;
      if (typeof httpOnly === 'boolean') clean.httpOnly = httpOnly;
      if (sameSite) clean.sameSite = sameSite;
      if (typeof expires === 'number' && expires > 0) clean.expires = expires;
      return clean;
    });

// Build the minimal LinkedIn auth cookie set from a raw li_at (+ optional
// JSESSIONID). li_at alone is enough to authenticate; JSESSIONID is only needed
// for write actions we never perform. Shared by the env-seed path and the
// admin "paste a cookie" Settings flow so both produce identical cookies.
const buildAuthCookies = ({ liAt, jsessionId }) => {
  const oneYear = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const cookies = [
    { name: 'li_at', value: liAt, domain: '.linkedin.com', path: '/', expires: oneYear, httpOnly: true, secure: true, sameSite: 'None' },
  ];
  if (jsessionId) {
    cookies.push({
      name: 'JSESSIONID', value: jsessionId.replace(/"/g, ''), domain: '.linkedin.com',
      path: '/', expires: oneYear, secure: true, sameSite: 'None',
    });
  }
  return cookies;
};

export const saveSession = async (cookies) => {
  try {
    const clean = sanitizeCookies(cookies);
    // Bank the device-identity cookies (bcookie et al) separately. `cookies` is
    // wiped whenever the session dies; these have to outlive that, because
    // re-presenting the same bcookie on the next login is what stops LinkedIn
    // treating every login as a brand-new device (and challenging it).
    const deviceCookies = pickDeviceCookies(clean);

    await LinkedInSession.findOneAndUpdate(
      {},
      {
        cookies: clean,
        ...(deviceCookies.length ? { deviceCookies } : {}),
        status: 'active',
        lastVerifiedAt: new Date(),
        // Reconcile the env-cookie marker on every save: once a session is
        // established by ANY means, the current env li_at is considered
        // "consumed", so we won't stomp this good jar with it next run — only a
        // later edit to LINKEDIN_LI_AT (marker !== env) triggers a re-seed.
        seedLiAt: process.env.LINKEDIN_LI_AT || null,
      },
      { upsert: true }
    );
    console.log('[linkedin] ✅ Session saved to database');
  } catch (e) {
    console.warn('[linkedin] Could not save session:', e.message);
  }
};

const loadSession = async () => {
  try {
    const doc = await LinkedInSession.findOne({});
    if (doc?.cookies?.length) {
      console.log('[linkedin] Loaded saved session from database');
      return sanitizeCookies(doc.cookies);
    }
  } catch (e) {
    console.warn('[linkedin] Could not load session:', e.message);
  }
  return null;
};

// The device-identity cookies survive a dead session on purpose — see
// saveSession() and linkedinBrowserIdentity.js.
const loadDeviceCookies = async () => {
  try {
    const doc = await LinkedInSession.findOne({}).select('deviceCookies').lean();
    return sanitizeCookies(doc?.deviceCookies || []);
  } catch (e) {
    console.warn('[linkedin] Could not load device cookies:', e.message);
    return [];
  }
};

const clearSession = async () => {
  try {
    // Note: deviceCookies is deliberately NOT cleared. A revoked auth session
    // doesn't make the browser a different browser, and re-presenting the same
    // bcookie on the next login is what keeps it from being challenged.
    await LinkedInSession.findOneAndUpdate({}, { cookies: null, status: 'dead' }, { upsert: true });
    // The next identity starts fresh anyway, so let it pick a new exit IP.
    await clearSessionProxy();
    console.log('[linkedin] Cleared stale session in database');
  } catch (e) {
    console.warn('[linkedin] Could not clear session:', e.message);
  }
};

// ─── Browser Factory ──────────────────────────────────────────────────────────
// Routes through the session's PINNED Webshare proxy (not a fresh random one
// per launch — see linkedinBrowserIdentity.js for why that mattered). Set
// LINKEDIN_USE_PROXY=false to disable, e.g. while troubleshooting a challenge
// loop, where going direct from the server's own IP is the fastest way to tell
// an IP-reputation problem apart from a fingerprint problem.

const launchBrowser = async () => {
  const proxy = await resolveSessionProxy();

  // defaultViewport: null so the page size derives from --window-size alone.
  // Overriding the viewport separately leaves window.innerWidth disagreeing
  // with screen.width, which is one more inconsistency to be scored on.
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
    args: buildLaunchArgs({ proxy, windowSize: '1280,900' }),
  });
  return { browser, proxy };
};

const setupPage = async (browser, proxy = null) => {
  const page = await browser.newPage();
  // No invented user-agent. applyPageIdentity derives it from the running
  // binary so the UA string, the Sec-CH-UA client hints and navigator.platform
  // all agree — the hardcoded "macOS Chrome 124" that used to live here
  // contradicted every one of them.
  await applyPageIdentity(page, { browser, proxy });
  return page;
};

// ─── LinkedIn Login ───────────────────────────────────────────────────────────

const loginToLinkedIn = async (page) => {
  const email    = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;

  if (!email || !password) {
    console.warn('[linkedin] LINKEDIN_EMAIL or LINKEDIN_PASSWORD not set in .env');
    return { ok: false, reason: 'no_credentials' };
  }

  console.log('[linkedin] Logging in as', email);

  // Clear any stale/invalid cookies first. With a dead session still set, LinkedIn
  // serves a form-less variant of /login (0 inputs), so login silently fails.
  // A clean cookie jar guarantees the real login form renders.
  try {
    const client = await page.createCDPSession();
    await client.send('Network.clearBrowserCookies');
    console.log('[linkedin] Cleared browser cookies before login');
  } catch (e) {
    console.warn('[linkedin] Could not clear browser cookies:', e.message);
  }

  // …then put the DEVICE identity straight back. The clear above only needs to
  // drop the dead auth cookies so the form renders; taking `bcookie` with it is
  // collateral damage that makes us an unrecognised device on every attempt,
  // which is what escalates a routine login into a challenge loop.
  await restoreDeviceIdentity(page);

  await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2500)); // let form fully render

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
    return { ok: false, reason: 'no_fields' };
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
    return { ok: false, reason: 'fill_failed' };
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
    return { ok: false, reason: 'checkpoint' };
  }

  // Success must be proven, not inferred from the absence of "login" in the
  // URL. A navigation that fails outright (proxy down, DNS, connection reset)
  // leaves the page on chrome-error://chromewebdata/, which contains neither
  // "login" nor "feed" — the old `!url.includes('login')` test read that as a
  // successful login and handed saveSession() a logged-out cookie jar, marking
  // the shared session 'active' with a fresh lastVerifiedAt. The Settings page
  // then showed "Active" while every scrape failed to authenticate.
  if (await verifyLoggedIn(page)) {
    console.log('[linkedin] ✅ Login successful');
    // Save session cookies
    const cookies = await page.cookies();
    await saveSession(cookies);
    return { ok: true, reason: 'ok' };
  }

  console.warn('[linkedin] Login may have failed — post-login URL:', url);
  return { ok: false, reason: 'failed' };
};

// ─── Interactive (visible-browser) Login Fallback ────────────────────────────
// LinkedIn's bot detection trips a security checkpoint on almost every headless
// credential login these days, so the automated path in loginToLinkedIn() above
// frequently can't recover a dead session on its own. Rather than just failing
// the pipeline and telling the user to go run a separate terminal command, open
// a REAL, visible Chrome window right here and wait for a human to log in and
// clear whatever challenge LinkedIn shows. Once the window reaches the feed, we
// capture the session cookies and continue automatically — no separate script,
// no manual terminal command.
//
// This only works when the process has a real desktop to draw a window on (i.e.
// a local dev machine). Set LINKEDIN_INTERACTIVE_LOGIN=false to disable it (e.g.
// on a headless server), in which case we fall straight through to the existing
// "run npm run linkedin:login manually" error.
const INTERACTIVE_LOGIN_ENABLED = process.env.LINKEDIN_INTERACTIVE_LOGIN !== 'false';
const INTERACTIVE_LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes to finish login + any challenge
const INTERACTIVE_LOGIN_POLL_MS = 3000;

// Seeds a fresh browser with the device-identity cookies from a previous
// successful login. Auth cookies are excluded by pickDeviceCookies(), so this
// never short-circuits the login form with a revoked li_at — it only makes the
// browser recognisable. Exported for the live-login flow, which needs the
// identical treatment for the fingerprints to match.
export const restoreDeviceIdentity = async (page) => {
  try {
    const deviceCookies = await loadDeviceCookies();
    if (!deviceCookies.length) {
      console.log('[linkedin] No stored device cookies yet — this login establishes the device.');
      return;
    }
    const client = await page.createCDPSession();
    await client.send('Network.setCookies', {
      cookies: deviceCookies.map((c) => ({ ...c, domain: c.domain || '.linkedin.com', path: c.path || '/' })),
    });
    console.log(`[linkedin] Restored ${deviceCookies.length} device cookies — presenting as a returning device.`);
  } catch (e) {
    console.warn('[linkedin] Could not restore device identity:', e.message);
  }
};

const openInteractiveLoginWindow = async () => {
  console.log('[linkedin] 🖥️  Opening a visible LinkedIn login window — please log in and complete any security check.');
  console.log(`[linkedin]     Waiting up to ${INTERACTIVE_LOGIN_TIMEOUT_MS / 60000} minutes for you to reach your feed...`);

  // Same pinned proxy the headless scraper uses, so the session is minted on
  // the IP that will later replay it.
  const proxy = await resolveSessionProxy();
  const launchArgs = buildLaunchArgs({ proxy, windowSize: '1300,920' });

  let browser;
  try {
    // Persistent profile: localStorage/IndexedDB continuity across back-to-back
    // login attempts is exactly what's missing during a challenge loop.
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      userDataDir: LOGIN_PROFILE_DIR,
      args: launchArgs,
    });
  } catch (e) {
    // Chrome takes an exclusive lock on a profile dir; if one is already held
    // (a live-login browser still open), fall back to an ephemeral profile
    // rather than failing the login outright.
    console.warn('[linkedin] Profile-backed launch failed, retrying without it:', e.message);
    try {
      browser = await puppeteer.launch({ headless: false, defaultViewport: null, args: launchArgs });
    } catch (e2) {
      console.warn('[linkedin] Could not open a visible browser window in this environment:', e2.message);
      return false;
    }
  }

  try {
    // Covers every tab this browser opens from here on — see attachProxyAuth()
    // for why the initial page's page.authenticate() alone isn't enough.
    attachProxyAuth(browser, proxy);

    const page = (await browser.pages())[0] || (await browser.newPage());
    await applyPageIdentity(page, { browser, proxy });

    // Restore the device cookies (bcookie et al) BEFORE the login page loads,
    // so LinkedIn sees a device it already knows. We used to do the exact
    // opposite here — Network.clearBrowserCookies — which minted a brand-new
    // browser identity on every attempt and guaranteed a new-device challenge.
    await restoreDeviceIdentity(page);

    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

    // Purely passive polling — we never navigate the page ourselves after this,
    // so whatever the human is doing (typing, solving a captcha, an app-approval
    // prompt) is never interrupted.
    const deadline = Date.now() + INTERACTIVE_LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, INTERACTIVE_LOGIN_POLL_MS));
      const url = page.url();
      if (url.includes('/feed') && !/authwall|\/login|checkpoint|uas\/login|signup/i.test(url)) {
        const cookies = await page.cookies();
        await saveSession(cookies);
        console.log('[linkedin] ✅ Manual login detected — session saved. Continuing automatically.');
        await browser.close();
        return true;
      }
    }

    console.warn('[linkedin] ⏱️  Timed out waiting for manual LinkedIn login.');
    await browser.close();
    return false;
  } catch (e) {
    console.warn('[linkedin] Interactive login window error:', e.message);
    await browser.close().catch(() => {});
    return false;
  }
};

// ─── Auth Verification ────────────────────────────────────────────────────────
// The only reliable, language-agnostic way to know we are actually logged in:
// try to open a login-ONLY page (/feed/). If LinkedIn keeps us there we're in;
// if it redirects to a login/authwall/uas page, the session is invalid — even if
// the li_at cookie is still timestamp-valid (LinkedIn can revoke it server-side).
const FEED_URL = 'https://www.linkedin.com/feed/';

const verifyLoggedIn = async (page) => {
  try {
    await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const finalUrl = page.url();
    const loggedIn = finalUrl.includes('/feed') &&
      !/authwall|\/login|checkpoint|uas\/login|signup/i.test(finalUrl);
    if (!loggedIn) {
      console.warn(`[linkedin] Not authenticated — /feed/ redirected to ${finalUrl}`);
    }
    return loggedIn;
  } catch (e) {
    console.warn('[linkedin] verifyLoggedIn error:', e.message);
    return false;
  }
};

// ─── Env-provided session (authoritative) ────────────────────────────────────
// If LINKEDIN_LI_AT is set in .env, it is the single source of truth for the
// scraping identity: we apply it on every run (so updating the cookie in .env
// takes effect immediately), verify it, and only fall back to saved-session /
// password / interactive login when the env cookie is missing or expired.
// Copy a fresh li_at from a logged-in browser (DevTools → Application → Cookies)
// whenever this stops authenticating.
const seedSessionFromEnv = async (page) => {
  const liAt = process.env.LINKEDIN_LI_AT;
  if (!liAt) return false;

  const cookies = buildAuthCookies({ liAt, jsessionId: process.env.LINKEDIN_JSESSIONID });
  try {
    const cdp = await page.createCDPSession();
    await cdp.send('Network.setCookies', { cookies });
  } catch (e) {
    console.warn('[linkedin] Could not apply LINKEDIN_LI_AT cookie:', e.message);
    return false;
  }

  if (await verifyLoggedIn(page)) {
    console.log('[linkedin] ✅ Authenticated via LINKEDIN_LI_AT from .env');
    await saveSession(cookies);
    return true;
  }
  console.warn('[linkedin] ⚠️  LINKEDIN_LI_AT did not authenticate (expired?) — falling back to saved session / login');
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

  // Language-agnostic auth-wall detection: LinkedIn often serves a login/signup
  // wall INLINE at the profile URL (HTTP 200, no redirect) and localized to the
  // viewer's language. A real logged-in profile page never contains a password
  // or signup (first name) field, so their presence means we are logged OUT.
  // This replaces the old English-only text heuristic that missed localized walls.
  const isAuthWall = await page.evaluate(() =>
    !!document.querySelector(
      'input[type="password"], input[name="session_password"], input#password, input[name="firstName"], input[name="first-name"]'
    )
  );
  if (isAuthWall) {
    console.warn(`[linkedin] ↳ Login/signup wall detected inline at ${url} — NOT logged in`);
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

// Exposed so other LinkedIn scrapers (e.g. company pages) reuse the same
// authwall detection, lazy-load scrolling and text cleanup.
export const scrapeLinkedInPageText = scrapePageText;

// ─── Employer links ───────────────────────────────────────────────────────────
// Every role on the experience page links to the employer's own LinkedIn page.
// That href is an EXACT company id — the one piece of evidence that separates
// two unrelated companies sharing a name — and scrapePageText discards it,
// since it returns innerText only. Read it straight off the DOM instead.
//
// Scoped to <main> because the "People also viewed" and ads rails carry company
// links for entirely unrelated companies. DOM order is reverse-chronological,
// so entry 0 is the current employer.
const extractCompanyLinks = async (page) => {
  try {
    return await page.evaluate(() =>
      [...document.querySelectorAll('main a[href*="/company/"]')]
        .map((a) => a.getAttribute('href'))
        .filter(Boolean)
    );
  } catch (err) {
    console.warn('[linkedin] Could not read company links (non-fatal):', err.message);
    return [];
  }
};

// ─── Contact Info Scraper ─────────────────────────────────────────────────────
// LinkedIn exposes the "Contact info" modal at a dedicated overlay URL — no
// click-through needed. Because this is scraped from the exact confirmed
// profile URL, any email/website found here is authoritative by construction
// (unlike email/website mined from generic name-based web search, which
// requires the usernameMatchesName guard to avoid picking up a namesake).
const scrapeContactInfo = async (page, linkedinUrl) => {
  const contactUrl = linkedinUrl.replace(/\/$/, '') + '/overlay/contact-info/';
  console.log('[linkedin] Scraping contact info:', contactUrl);

  try {
    const text = await scrapePageText(page, contactUrl);
    if (!text) return null;

    const emailMatch = text.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
    const websiteMatch = text.match(/https?:\/\/(?!(?:www\.)?linkedin\.com)[^\s)]+/i);

    const contactInfo = {
      email: emailMatch ? emailMatch[1] : null,
      website: websiteMatch ? websiteMatch[0].replace(/[.,;]+$/, '') : null,
    };

    if (contactInfo.email || contactInfo.website) {
      console.log('[linkedin] ✅ Contact info found:', contactInfo);
    } else {
      console.log('[linkedin] ⚠️  Contact info panel had no email/website');
    }

    return contactInfo;
  } catch (err) {
    console.warn('[linkedin] Contact info scrape failed (non-fatal):', err.message);
    return null;
  }
};

// ─── Profile Scraper ──────────────────────────────────────────────────────────

const scrapeProfilePage = async (page, url) => {
  // 1. Scrape main profile page
  const mainText = await scrapePageText(page, url);

  if (!mainText) {
    return { text: null, posts: [], contactInfo: null, companyLinks: [], sessionExpired: true };
  }

  // Employer links from the main profile, as a fallback for profiles whose
  // experience sub-page is restricted.
  let companyLinks = await extractCompanyLinks(page);

  // 2. Also scrape the /details/experience/ sub-page (full timeline with dates)
  const experienceUrl = url.replace(/\/$/, '') + '/details/experience/';
  console.log('[linkedin] Also scraping experience page:', experienceUrl);
  const expText = await scrapePageText(page, experienceUrl).catch(() => null);

  // Read the employer hrefs while still on the experience page — this listing
  // is complete and strictly reverse-chronological, so it beats the main page.
  if (expText) {
    const expLinks = await extractCompanyLinks(page);
    if (expLinks.length) companyLinks = expLinks;
  }

  // 3. Also scrape /details/education/
  const educationUrl = url.replace(/\/$/, '') + '/details/education/';
  const eduText = await scrapePageText(page, educationUrl).catch(() => null);

  // 4. Also scrape /recent-activity/all/ in the SAME browser session
  // (Running it here avoids a second parallel browser instance that causes
  //  "Execution context was destroyed" crashes.)
  const posts = await scrapeActivityPage(page, url).catch(() => []);

  // 5. Also scrape the Contact Info overlay — non-fatal, may be restricted/empty
  const contactInfo = await scrapeContactInfo(page, url).catch(() => null);

  // Combine all sections
  const combined = [
    '=== MAIN PROFILE ===',
    mainText || '',
    expText ? '\n=== EXPERIENCE DETAILS ===' : '',
    expText || '',
    eduText ? '\n=== EDUCATION DETAILS ===' : '',
    eduText || '',
  ].filter(Boolean).join('\n');

  return { text: combined, posts, contactInfo, companyLinks, sessionExpired: false };
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
    const launched = await launchBrowser();
    browser = launched.browser;
    const page = await setupPage(browser, launched.proxy);

    // Prefer the rich saved session (durable); fall back to the env li_at
    // bootstrap, then a full login — same preference order as scrapeLinkedIn.
    const savedCookies = await loadSession();
    if (savedCookies) {
      const cdp = await page.createCDPSession();
      await cdp.send('Network.setCookies', { cookies: savedCookies });
    } else if (!(await seedSessionFromEnv(page))) {
      const { ok } = await loginToLinkedIn(page);
      if (!ok) {
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
 * Returns: { text: string|null, posts: string[], contactInfo: {email, website}|null }
 *   text        — combined profile text for the AI enrichment prompt
 *   posts       — array of recent LinkedIn post strings (may be empty)
 *   contactInfo — email/website scraped directly from this profile's Contact
 *                 Info panel, authoritative since it's tied to the exact URL
 */
/**
 * Establish an authenticated LinkedIn session, hand the page to `fn`, then
 * persist the (rotated) cookie jar and tear the browser down.
 *
 * Everything that needs a logged-in LinkedIn page goes through here — profile
 * scraping and company-page scraping alike — so the login/verify/recover
 * ladder below exists once rather than per caller.
 *
 * @param {(page: import('puppeteer').Page) => Promise<any>} fn
 * @param {Object}   opts
 * @param {Function} opts.persist  Given fn's result, decide whether to save the
 *                                 jar. Skipped when a wall appeared mid-scrape,
 *                                 so a dead session is never written back.
 * @returns {Promise<{ok: boolean, result?: any, authFailed?: boolean, reason?: string|null, error?: Error}>}
 */
export const withLinkedInSession = async (fn, { persist = () => true } = {}) => {
  let browser;
  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    const page = await setupPage(browser, launched.proxy);

    // ── Establish an authenticated session ────────────────────────────────
    // Steady state uses the rich, self-refreshing saved jar (companion cookies
    // intact, tokens as LinkedIn last rotated them) — far more durable than a
    // bare li_at, which LinkedIn is quick to revoke. The env LINKEDIN_LI_AT is a
    // bootstrap/override: it seeds a session when none is saved and re-seeds
    // ONLY when you change it in .env (marker !== env). Every candidate is
    // verified against /feed/ first, since a cookie can be timestamp-valid but
    // revoked server-side (LinkedIn then serves a login wall inline).
    let loginReason = null;
    let loggedIn = false;

    const doc = await LinkedInSession.findOne({});
    const savedCookies = sanitizeCookies(doc?.cookies);
    const envLiAt = process.env.LINKEDIN_LI_AT || null;
    const envChanged = !!envLiAt && envLiAt !== (doc?.seedLiAt || null);

    const restoreSaved = async (label) => {
      const cdp = await page.createCDPSession();
      await cdp.send('Network.setCookies', { cookies: savedCookies });
      console.log(`[linkedin] ${label}`);
      return verifyLoggedIn(page);
    };

    // 1) Prefer the saved session, unless the env cookie was just changed.
    if (savedCookies.length && !envChanged) {
      loggedIn = await restoreSaved('Using saved session');
    }

    // 2) Seed from env li_at — first-time bootstrap, or you pasted a new cookie.
    if (!loggedIn && envLiAt) {
      if (envChanged) console.log('[linkedin] LINKEDIN_LI_AT changed in .env — re-seeding session');
      loggedIn = await seedSessionFromEnv(page);
    }

    // 3) Env cookie failed but a saved jar exists — try it before a full login.
    if (!loggedIn && savedCookies.length && envChanged) {
      loggedIn = await restoreSaved('Env cookie failed — falling back to saved session');
    }

    // 4) Nothing usable — clear and do a fresh email/password login.
    if (!loggedIn) {
      console.log('[linkedin] ⚠️  No usable session — clearing and logging in');
      await clearSession();
      const login = await loginToLinkedIn(page);
      loginReason = login.reason;
      loggedIn = login.ok && (await verifyLoggedIn(page));
    }

    // ── Last resort: automated login keeps tripping LinkedIn's bot detection.
    // Open a real, visible browser window and let a human clear the checkpoint,
    // then load that freshly-saved session into THIS headless page and retry.
    if (!loggedIn && INTERACTIVE_LOGIN_ENABLED) {
      const recovered = await openInteractiveLoginWindow();
      if (recovered) {
        const freshCookies = await loadSession();
        if (freshCookies) {
          const cdp = await page.createCDPSession();
          await cdp.send('Network.setCookies', { cookies: freshCookies });
          loggedIn = await verifyLoggedIn(page);
        }
      }
    }

    if (!loggedIn) {
      console.warn('[linkedin] ❌ Could not establish an authenticated session — aborting (will NOT scrape logged-out)');
      await browser.close();
      return { ok: false, authFailed: true, reason: loginReason };
    }
    console.log('[linkedin] ✅ Confirmed logged in — proceeding');

    const result = await fn(page);

    // Persist the jar AS IT NOW STANDS. LinkedIn rotates session tokens during a
    // visit; capturing the live cookies (full companion set included) and saving
    // them keeps the stored session current, so the next run resumes a fresh
    // session instead of replaying a stale one that gets revoked.
    if (persist(result)) {
      try {
        await saveSession(await page.cookies());
      } catch (e) {
        console.warn('[linkedin] Could not persist refreshed session:', e.message);
      }
    }

    await browser.close();
    return { ok: true, result };

  } catch (err) {
    console.error('[linkedin] Error:', err.message);
    if (browser) await browser.close().catch(() => {});
    return { ok: false, error: err };
  }
};

/**
 * Make a stored profile URL safe to hand to page.goto().
 *
 * Puppeteer rejects a schemeless URL outright ("Cannot navigate to invalid
 * URL"), and a manually-entered prospect frequently arrives as a bare
 * `linkedin.com/in/<handle>` — someone copied it out of the address bar, where
 * Chrome hides the scheme. That killed the whole enrichment for that prospect
 * while every other layer reported success, so the failure read as "LinkedIn
 * has no data on them" rather than "we never asked LinkedIn".
 *
 * Scheme and subdomain are rewritten in one pass for the same reason
 * prospectFinder's normalizeProfileUrl does it: handling them separately
 * leaves `http://www.` matching neither rule.
 */
const toAbsoluteProfileUrl = (raw = '') => {
  const trimmed = String(raw).trim();
  if (!trimmed) return '';

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;

  return withScheme
    .replace(/^https?:\/\/([a-z0-9-]+\.)?linkedin\.com/i, 'https://www.linkedin.com')
    .split('#')[0]
    .split('?')[0]
    .replace(/\/$/, '');
};

export const scrapeLinkedIn = async (linkedinUrl) => {
  const empty = { text: null, posts: [], contactInfo: null, companyLinks: [], authFailed: false };
  if (!linkedinUrl) return empty;

  const url = toAbsoluteProfileUrl(linkedinUrl);
  if (!url) return empty;
  console.log(`[linkedin] Scraping: ${url}`);

  const session = await withLinkedInSession(
    (page) => scrapeProfilePage(page, url),
    // If a wall appears mid-scrape the session died — do not write that jar back.
    { persist: (r) => !r?.sessionExpired }
  );

  if (!session.ok) {
    if (session.authFailed) return { ...empty, authFailed: true, reason: session.reason };
    return empty;
  }

  const { text, posts, contactInfo, companyLinks, sessionExpired } = session.result;

  // scrapePageText returns null on a login/signup wall — fail rather than
  // enriching garbage from a logged-out page.
  if (sessionExpired) {
    console.warn('[linkedin] ❌ Auth wall appeared during profile scrape — aborting');
    return { ...empty, authFailed: true };
  }

  if (!text || text.length < 200) {
    console.warn('[linkedin] Profile text too short');
    return { ...empty, posts, contactInfo, companyLinks };
  }

  // Clean up text
  const cleaned = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 2)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 5000);

  console.log(`[linkedin] ✅ Scraped ${cleaned.length} chars | ${posts.length} activity posts | ${companyLinks.length} company link(s)`);
  return { text: cleaned, posts, contactInfo, companyLinks, authFailed: false };
};

// ─── Admin-triggered Session Refresh (headless-safe) ─────────────────────────
// Lets an admin paste a li_at cookie (copied from their own logged-in browser)
// from the Settings page to fix a dead session without any server/terminal
// access — this is the one recovery path that works in a headless production
// deployment, since it never performs a login action, just resumes an
// already-trusted session.
export const refreshLinkedInSessionFromCookie = async ({ liAt, jsessionId, updatedBy }) => {
  const cookies = buildAuthCookies({ liAt, jsessionId });

  let browser;
  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    const page = await setupPage(browser, launched.proxy);

    const cdp = await page.createCDPSession();
    await cdp.send('Network.setCookies', { cookies });

    const loggedIn = await verifyLoggedIn(page);
    await browser.close();

    if (!loggedIn) {
      return { ok: false, message: 'That cookie did not authenticate — copy a fresh li_at from a logged-in browser and try again.' };
    }

    await saveSession(cookies);
    await LinkedInSession.findOneAndUpdate({}, { updatedBy, status: 'active' });
    console.log('[linkedin] ✅ Session refreshed via admin-provided cookie');
    return { ok: true };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return { ok: false, message: err.message };
  }
};
