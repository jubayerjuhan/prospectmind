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
 * Routes through the session's PINNED proxy (linkedinBrowserIdentity.js), so
 * the login IP really is the IP that will later replay this session. It used
 * to call the random rotator here and claim the same thing, which was simply
 * untrue: the session was minted on one exit IP and scraped from a different
 * subnet minutes later, LinkedIn invalidated it, and the admin was sent back
 * to a checkpoint — the loop this module exists to escape. Set
 * LINKEDIN_USE_PROXY=false to disable, same flag as linkedinScraper.js.
 */

import puppeteer from 'puppeteer';
import { saveSession, restoreDeviceIdentity } from './linkedinScraper.js';
import {
  resolveSessionProxy,
  buildLaunchArgs,
  applyPageIdentity,
  attachProxyAuth,
  LOGIN_PROFILE_DIR,
} from './linkedinBrowserIdentity.js';

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

  // The session's pinned proxy — the same exit IP the headless scraper will
  // use with the cookies we're about to capture. A session minted on one IP
  // and replayed from another is exactly the mismatch LinkedIn's risk checks
  // flag, and it lands the admin right back on this screen.
  const proxy = await resolveSessionProxy();

  const args = buildLaunchArgs({ proxy, windowSize: '1280,920' });

  try {
    // Persistent profile so a second attempt after a failed challenge looks
    // like the same machine rather than a freshly-minted one.
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      userDataDir: LOGIN_PROFILE_DIR,
      args,
    });
  } catch (e) {
    // Chrome holds an exclusive lock on a profile dir — fall back to an
    // ephemeral one rather than blocking the admin's only recovery path.
    console.warn('[linkedin-live] Profile-backed launch failed, retrying without it:', e.message);
    try {
      browser = await puppeteer.launch({ headless: false, defaultViewport: null, args });
    } catch (e2) {
      console.warn('[linkedin-live] Could not launch visible browser:', e2.message);
      state = { status: 'failed', startedAt: state.startedAt };
      clearTimers();
      browser = null;
      return getStatus();
    }
  }

  try {
    // Covers every tab this browser opens from here on — see attachProxyAuth()
    // for why the initial page's page.authenticate() alone isn't enough.
    attachProxyAuth(browser, proxy);

    const page = (await browser.pages())[0] || (await browser.newPage());
    // Identical treatment to the headless scraper's pages — that's the point:
    // the browser that logs in and the browser that scrapes have to look like
    // one machine. No invented user-agent; it's derived from the real binary,
    // so the UA string and the Sec-CH-UA client hints can't contradict.
    await applyPageIdentity(page, { browser, proxy });

    // Present the device LinkedIn already knows. This replaces a
    // Network.clearBrowserCookies call that wiped `bcookie` on every start,
    // making each attempt an unrecognised device and mandating a challenge.
    await restoreDeviceIdentity(page);

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
