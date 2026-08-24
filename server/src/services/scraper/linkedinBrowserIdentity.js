/**
 * LinkedIn Browser Identity — one consistent "device" across every launch
 *
 * Why this module exists
 * ─────────────────────
 * LinkedIn's login challenge is an Arkose Labs FunCaptcha. Unlike a plain
 * rate-limit block, Arkose doesn't reject you outright when it dislikes the
 * client — it serves a challenge that can never be *passed*. You solve it, it
 * accepts the solve, and immediately serves another. The "infinite captcha"
 * loop is that state, and it is caused by a self-contradictory fingerprint,
 * not by an unpopular IP.
 *
 * We were producing three contradictions at once:
 *
 *  1. A hardcoded `Chrome/124.0.0.0` macOS user-agent, while the actual binary
 *     was Puppeteer's pinned Linux Chrome 139+. `page.setUserAgent(ua)` with a
 *     single argument does NOT override Client Hints, so every request carried
 *     `Sec-CH-UA: Chromium;v="139"` + `Sec-CH-UA-Platform: "Linux"` next to a
 *     UA string swearing it was macOS Chrome 124. Two hard mismatches.
 *  2. `Network.clearBrowserCookies` before every login, which wipes `bcookie`
 *     — LinkedIn's persistent browser/device ID. Every login therefore came
 *     from an unrecognised device, which mandates a challenge by policy.
 *  3. A randomly rotated proxy per launch, so the session was minted on one IP
 *     and then used from a different subnet on the very next scrape.
 *
 * Everything here exists to make the login browser and the scraping browser
 * look like the same machine on the same connection, every time.
 *
 * Note on persistence: Cloud Run's filesystem is ephemeral, so `userDataDir`
 * alone cannot carry device identity across a cold start. The durable half is
 * the device cookies (`bcookie` et al), which we keep in the LinkedInSession
 * doc and re-inject before login — see pickDeviceCookies().
 */

import os from 'os';
import path from 'path';
import { getProxy, findProxy, isProxyReachable } from './proxyRotator.js';
import LinkedInSession from '../../models/LinkedInSession.js';
import { lowMemoryArgs } from './browserMemory.js';

export const USE_PROXY = process.env.LINKEDIN_USE_PROXY !== 'false';

// ─── Sticky proxy ─────────────────────────────────────────────────────────────
// The LinkedIn identity is pinned to ONE exit IP, stored on the session doc.
// getProxy() still rotates randomly for anything that wants a fresh IP per
// request, but an authenticated LinkedIn session must not: a session minted on
// one IP and replayed from another ASN is exactly what LinkedIn's risk checks
// invalidate, which bounces us to a checkpoint and starts the loop again.

export const resolveSessionProxy = async () => {
  if (!USE_PROXY) return null;

  let pinnedKey = null;
  try {
    const doc = await LinkedInSession.findOne({}).select('proxy').lean();
    pinnedKey = doc?.proxy || null;
  } catch (e) {
    console.warn('[linkedin] Could not read pinned proxy:', e.message);
  }

  if (pinnedKey) {
    const pinned = findProxy(pinnedKey);
    // Only abandon the pin if the proxy is genuinely gone or unreachable —
    // re-pinning changes our IP, which is itself a risk signal, so it is a
    // last resort rather than a routine fallback.
    if (pinned && (await isProxyReachable(pinned))) {
      console.log(`[linkedin] Using pinned session proxy ${pinned.host}:${pinned.port}`);
      return pinned;
    }
    console.warn(`[linkedin] ⚠️  Pinned proxy ${pinnedKey} is gone/unreachable — re-pinning (expect a fresh challenge).`);
  }

  const picked = await getProxy().catch(() => null);
  if (!picked) return null;

  try {
    await LinkedInSession.findOneAndUpdate(
      {},
      { proxy: `${picked.host}:${picked.port}` },
      { upsert: true }
    );
  } catch (e) {
    console.warn('[linkedin] Could not persist pinned proxy:', e.message);
  }
  return picked;
};

// Called when the session is cleared/revoked: the next identity is a new
// device anyway, so it may as well start on a freshly chosen IP.
export const clearSessionProxy = async () => {
  try {
    await LinkedInSession.findOneAndUpdate({}, { proxy: null }, { upsert: true });
  } catch (e) {
    console.warn('[linkedin] Could not clear pinned proxy:', e.message);
  }
};

// ─── Device cookies ───────────────────────────────────────────────────────────
// LinkedIn recognises a returning device primarily by `bcookie` (a stable
// browser GUID) plus a handful of companions. Preserving these across logins
// is the single highest-value thing we can do about the challenge loop, and
// unlike a Chrome profile directory it survives a Cloud Run cold start because
// it rides along in the session document we already persist.
//
// Deliberately excludes the auth cookies (li_at / JSESSIONID): we only inject
// these before a *fresh* login, and replaying a revoked li_at there lands us
// on a checkpoint instead of the login form.
const DEVICE_COOKIE_NAMES = new Set([
  'bcookie',    // persistent browser GUID — the important one
  'bscookie',   // signed companion to bcookie
  'li_gc',      // consent/guest state
  'lidc',       // datacenter routing hint
  'li_sugr',    // device-level analytics id
  '_guid',      // device-level analytics id
  'li_alerts',
  'lang',
  'timezone',
]);

export const pickDeviceCookies = (cookies) =>
  (cookies || []).filter((c) => c?.name && DEVICE_COOKIE_NAMES.has(c.name));

// ─── Persistent Chrome profile ────────────────────────────────────────────────
// Gives localStorage / IndexedDB / device continuity to back-to-back logins
// within one container lifetime — which is precisely the window in which the
// "solve it, get another" loop plays out. Only the visible login flows use it:
// Chrome takes an exclusive lock on a profile directory, and headless scrapes
// run concurrently off the BullMQ queue, so they must not share one.
export const LOGIN_PROFILE_DIR =
  process.env.LINKEDIN_PROFILE_DIR || path.join(os.tmpdir(), 'prospectmind-linkedin-profile');

// ─── Launch args ──────────────────────────────────────────────────────────────
export const buildLaunchArgs = ({ proxy, windowSize = '1280,920', sandbox = false }) => {
  const args = [
    '--disable-blink-features=AutomationControlled',
    `--window-size=${windowSize}`,
    // Keep the UI language, the Accept-Language header and navigator.languages
    // telling the same story — another cheap consistency win.
    '--lang=en-US',
    '--disable-dev-shm-usage',
  ];
  if (!sandbox) args.push('--no-sandbox', '--disable-setuid-sandbox');
  if (proxy) args.push(`--proxy-server=${proxy.host}:${proxy.port}`);
  args.push(...lowMemoryArgs(args));
  return args;
};

// ─── Page identity ────────────────────────────────────────────────────────────
// Timezone: a US datacenter/residential exit IP paired with a container running
// on UTC is a mismatch Arkose weighs. Only applied when we are actually behind
// a proxy — forcing a US timezone on a direct connection from an EU host would
// create the very mismatch we are removing.
const PROXY_TIMEZONE = process.env.LINKEDIN_TIMEZONE || 'America/New_York';

const CH_PLATFORM = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' }[process.platform] || 'Linux';

/**
 * Apply the shared identity to a page.
 *
 * The user-agent is *derived from the running binary* rather than invented.
 * A headful Chrome is left completely pristine — we don't even install an
 * Emulation override, since the override itself is a detectable artefact and
 * a real Chrome already agrees with its own Client Hints by construction.
 * Only new-headless mode needs a touch-up, because its real UA advertises
 * `HeadlessChrome`; there we strip the marker from both the UA string and the
 * Client Hint brands so the two still match each other.
 */
/**
 * Authenticate every tab the browser ever opens, present and future.
 *
 * page.authenticate() is per-page — it only wires proxy credentials into the
 * CDP session of the page it's called on. A visible login flow isn't one
 * page for its whole life: LinkedIn's checkpoint step opens a second tab, and
 * that tab is a brand-new CDP target that never got credentials, so Chrome
 * falls back to its native "the proxy needs a username and password" dialog
 * instead of the request just going through. Listening on 'targetcreated'
 * covers every tab from here on, not just the one that existed at launch.
 */
export const attachProxyAuth = (browser, proxy) => {
  if (!proxy) return;
  browser.on('targetcreated', async (target) => {
    if (target.type() !== 'page') return;
    try {
      const page = await target.page();
      if (page) await page.authenticate({ username: proxy.username, password: proxy.password });
    } catch (e) {
      console.warn('[linkedin] Could not authenticate new tab against proxy:', e.message);
    }
  });
};

export const applyPageIdentity = async (page, { browser, proxy = null } = {}) => {
  if (proxy) {
    await page.authenticate({ username: proxy.username, password: proxy.password });
  }

  // No Accept-Language override. Verified: Chrome launched with --lang=en-US
  // already sends exactly `en-US,en;q=0.9`, so setExtraHTTPHeaders() bought us
  // nothing while installing one more CDP override to be detected on. Letting
  // the browser derive it keeps the header and navigator.languages in sync by
  // construction.

  if (browser) {
    const realUa = await browser.userAgent();
    if (/Headless/i.test(realUa)) {
      const fullVersion = (await browser.version()).split('/')[1] || '';
      const major = fullVersion.split('.')[0] || '';
      await page.setUserAgent(realUa.replace(/HeadlessChrome/g, 'Chrome'), {
        brands: [
          { brand: 'Not;A=Brand', version: '99' },
          { brand: 'Chromium', version: major },
          { brand: 'Google Chrome', version: major },
        ],
        fullVersion,
        platform: CH_PLATFORM,
        platformVersion: '',
        architecture: 'x86',
        model: '',
        mobile: false,
      });
    }
  }

  if (proxy) {
    try {
      const client = await page.createCDPSession();
      await client.send('Emulation.setTimezoneOverride', { timezoneId: PROXY_TIMEZONE });
    } catch (e) {
      console.warn('[linkedin] Could not align timezone with proxy:', e.message);
    }
  }
};
