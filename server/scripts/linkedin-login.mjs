/**
 * LinkedIn Session Helper (one-time, interactive)
 *
 * LinkedIn blocks headless/automated logins with a security checkpoint, so the
 * scraper cannot log in on its own. Run this ONCE to mint a valid session:
 *
 *   cd server && npm run linkedin:login
 *
 * A real Chrome window opens. Log in to LinkedIn and complete any verification
 * (email/SMS code, captcha, in-app approval). When you can see your home feed,
 * return to the terminal and press Enter. Your session cookies are saved to
 * `.linkedin-session.json` at the repo root — the exact file the scraper reuses
 * headlessly. Re-run when LinkedIn eventually revokes the session.
 *
 * This does not bypass any security check — YOU complete the login and any
 * challenge in the visible browser; the script only persists the resulting
 * session cookies.
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/scripts → repo root
const SESSION_FILE = path.resolve(__dirname, '../../.linkedin-session.json');

// Match the scraper's user agent so the session fingerprint stays consistent.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const ask = (q) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => {
      rl.close();
      resolve(a);
    });
  });

const isLoggedIn = async (page) => {
  await page
    .goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {});
  const u = page.url();
  return u.includes('/feed') && !/authwall|\/login|checkpoint|uas\/login|signup/i.test(u);
};

const main = async () => {
  console.log('\n=== LinkedIn session helper ===');
  console.log('A Chrome window will open.');
  console.log('  1. Log in to LinkedIn.');
  console.log('  2. Complete any security verification (email/SMS code, captcha, app approval).');
  console.log('  3. When you can see your LinkedIn home feed, come back here and press Enter.\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--disable-blink-features=AutomationControlled', '--window-size=1300,920'],
  });

  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  await page
    .goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 })
    .catch(() => {});

  let saved = false;
  while (!saved) {
    const ans = await ask('Press Enter once you are logged in and on your feed (or type q to quit): ');
    if (ans.trim().toLowerCase() === 'q') break;

    console.log('Verifying login...');
    const ok = await isLoggedIn(page);
    if (!ok) {
      console.log('❌ Not logged in yet — /feed/ still redirects to login/checkpoint. Finish logging in, then press Enter again.\n');
      continue;
    }

    const cookies = await page.cookies('https://www.linkedin.com/', 'https://www.linkedin.com/feed/');
    const hasLiAt = cookies.some((c) => c.name === 'li_at');

    if (!hasLiAt) {
      console.log('⚠️  Logged-in page loaded but the li_at auth cookie was not found. Try pressing Enter again.\n');
      continue;
    }

    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
    console.log(`\n✅ Saved ${cookies.length} cookies (including li_at) to:\n   ${SESSION_FILE}`);
    saved = true;
  }

  await browser.close();
  if (saved) {
    console.log('\nDone. The scraper will now reuse this session headlessly — re-run your enrichment.\n');
  } else {
    console.log('\nAborted — no session saved.\n');
  }
  process.exit(0);
};

main().catch((err) => {
  console.error('[linkedin-login] Error:', err.message);
  process.exit(1);
});
