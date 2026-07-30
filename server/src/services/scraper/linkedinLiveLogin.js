/**
 * Live LinkedIn Login — on-demand, streamed interactive session
 *
 * The production container has no physical desktop, so LinkedIn checkpoints
 * / dead sessions can't be cleared by a human sitting at the machine. This
 * module launches a real, visible (headless:false) Chrome onto the virtual
 * display started by docker-entrypoint.sh, and lets an admin drive it
 * remotely over VNC (bridged to the browser by vncBridge.js) from the
 * Settings page — click "Open Live Browser", log in / solve the checkpoint,
 * and the moment LinkedIn's feed loads we capture + save the session cookies
 * automatically, same as the local-only openInteractiveLoginWindow() in
 * linkedinScraper.js. Kept separate from that function on purpose: this one
 * is async/background/cancellable/polled instead of blocking a scrape call,
 * so sharing one abstraction wasn't worth the coupling.
 *
 * Single in-memory session — there is one shared LinkedIn identity for the
 * whole platform (mirrors LinkedInSession being a singleton doc), so only
 * one live login can run at a time. Multiple admins CAN watch/drive the same
 * session concurrently (x11vnc runs with -shared).
 *
 * Routes through the same rotating proxy as the headless scraper (see
 * proxyRotator.js) so the login IP matches the IP that will later use this
 * session — set LINKEDIN_USE_PROXY=false to disable, same flag as
 * linkedinScraper.js.
 */

import puppeteer from 'puppeteer';
import { saveSession } from './linkedinScraper.js';
import { getProxy } from './proxyRotator.js';

const USE_PROXY = process.env.LINKEDIN_USE_PROXY !== 'false';

const LOGIN_URL = 'https://www.linkedin.com/login';
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes to finish login + any challenge
const POLL_MS = 3000;
const SUCCESS_GRACE_MS = 5000; // let the admin see the success state before we close the window

let state = { status: 'idle', startedAt: null };
let browser = null;
let pollTimer = null;
let deadlineTimer = null;
let graceTimer = null;

// Bumped on every start()/stop(). Deferred callbacks (the poll, the deadline,
// the post-success close) capture the value current when they were scheduled
// and no-op once a newer session supersedes them — otherwise the 5s
// post-success close timer from one session would close the browser of the
// NEXT session an admin starts moments later.
let generation = 0;

const clearTimers = () => {
  clearInterval(pollTimer);
  clearTimeout(deadlineTimer);
  clearTimeout(graceTimer);
  pollTimer = null;
  deadlineTimer = null;
  graceTimer = null;
};

const teardown = async () => {
  clearTimers();
  const closing = browser;
  browser = null;
  if (closing) await closing.close().catch(() => {});
};

export const getStatus = () => ({ status: state.status, startedAt: state.startedAt });

export const stop = async () => {
  generation++;
  await teardown();
  state = { status: 'idle', startedAt: null };
  return getStatus();
};

export const start = async () => {
  if (state.status === 'running') {
    return getStatus();
  }

  // A previous session may still be inside its post-success grace window —
  // invalidate its callbacks and close its browser so it isn't orphaned.
  generation++;
  await teardown();
  const gen = generation;

  state = { status: 'running', startedAt: new Date() };

  // Same rotating Webshare proxy the headless scraper uses (proxyRotator.js)
  // — logging in from a different IP than the one that later scrapes with
  // this session is exactly the kind of mismatch LinkedIn's risk checks flag.
  const proxy = USE_PROXY ? await getProxy().catch(() => null) : null;

  try {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,920',
    ];
    if (proxy) args.push(`--proxy-server=${proxy.host}:${proxy.port}`);

    browser = await puppeteer.launch({ headless: false, defaultViewport: null, args });
  } catch (e) {
    console.warn('[linkedin-live] Could not launch visible browser:', e.message);
    state = { status: 'failed', startedAt: state.startedAt };
    clearTimers();
    browser = null;
    return getStatus();
  }

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    if (proxy) {
      await page.authenticate({ username: proxy.username, password: proxy.password });
    }
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    const client = await page.createCDPSession();
    await client.send('Network.clearBrowserCookies');

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

    console.log('[linkedin-live] 🖥️  Live login browser started — waiting for admin to reach the feed...');

    deadlineTimer = setTimeout(async () => {
      if (gen !== generation || state.status !== 'running') return;
      console.warn('[linkedin-live] ⏱️  Timed out waiting for live login.');
      state = { status: 'timeout', startedAt: state.startedAt };
      await teardown();
    }, TIMEOUT_MS);

    // Purely passive polling — never navigate the page ourselves, so whatever
    // the admin is doing (typing, solving a captcha, an app-approval prompt)
    // is never interrupted.
    pollTimer = setInterval(async () => {
      if (gen !== generation || state.status !== 'running') return;
      let url;
      try {
        url = page.url();
      } catch {
        return;
      }
      if (url.includes('/feed') && !/authwall|\/login|checkpoint|uas\/login|signup/i.test(url)) {
        clearInterval(pollTimer);
        clearTimeout(deadlineTimer);
        pollTimer = null;
        deadlineTimer = null;
        try {
          const cookies = await page.cookies();
          await saveSession(cookies);
          console.log('[linkedin-live] ✅ Live login detected — session saved.');
          state = { status: 'success', startedAt: state.startedAt };
        } catch (e) {
          console.warn('[linkedin-live] Could not save session:', e.message);
          state = { status: 'failed', startedAt: state.startedAt };
        }
        graceTimer = setTimeout(() => {
          if (gen === generation) teardown();
        }, SUCCESS_GRACE_MS);
      }
    }, POLL_MS);
  } catch (e) {
    console.warn('[linkedin-live] Live login error:', e.message);
    state = { status: 'failed', startedAt: state.startedAt };
    await teardown();
  }

  return getStatus();
};
