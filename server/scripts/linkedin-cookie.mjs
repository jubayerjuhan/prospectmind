/**
 * LinkedIn Session from Cookie (fastest, most reliable)
 *
 * LinkedIn blocks the automated login browser with a security challenge that it
 * won't complete even after you approve it. The way around that is to log in
 * with your NORMAL everyday browser (where you're trusted), then reuse that
 * session's auth cookie here.
 *
 * Steps:
 *   1. In your normal browser, log in to https://www.linkedin.com
 *   2. Open DevTools → Application (Storage) → Cookies → https://www.linkedin.com
 *   3. Copy the VALUE of the `li_at` cookie.
 *   4. Put it in server/.env:   LINKEDIN_LI_AT=<the value>
 *      (optional but helps: also copy `JSESSIONID` → LINKEDIN_JSESSIONID=<value>)
 *   5. Run:  cd server && npm run linkedin:cookie
 *
 * It writes `.linkedin-session.json` at the repo root and then verifies the
 * cookie actually authenticates before telling you it worked.
 */

import 'dotenv/config';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.resolve(__dirname, '../../.linkedin-session.json');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const liAt = process.env.LINKEDIN_LI_AT?.trim();
if (!liAt) {
  console.error('\n❌ LINKEDIN_LI_AT is not set in server/.env.');
  console.error('   Copy the li_at cookie from your logged-in browser (DevTools → Application → Cookies)');
  console.error('   and add it to server/.env as:  LINKEDIN_LI_AT=<value>\n');
  process.exit(1);
}

const oneYear = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
const cookies = [
  { name: 'li_at', value: liAt, domain: '.linkedin.com', path: '/', expires: oneYear, httpOnly: true, secure: true, sameSite: 'None' },
];
const jsession = process.env.LINKEDIN_JSESSIONID?.trim();
if (jsession) {
  cookies.push({
    name: 'JSESSIONID', value: jsession.replace(/"/g, ''), domain: '.linkedin.com',
    path: '/', expires: oneYear, secure: true, sameSite: 'None',
  });
}

fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
console.log(`\nWrote ${cookies.length} cookie(s) to:\n  ${SESSION_FILE}\nVerifying...`);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.setCookies', { cookies });

  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  const u = page.url();
  const ok = u.includes('/feed') && !/authwall|\/login|checkpoint|uas\/login|signup/i.test(u);

  if (ok) {
    console.log('\n✅ Cookie works — the scraper is now logged in. Re-run your enrichment.\n');
  } else {
    console.log(`\n❌ Cookie did NOT authenticate (landed on ${u}).`);
    console.log('   Make sure you copied the CURRENT li_at from a browser where you are logged in,');
    console.log('   and that you did not log out of that browser (that revokes li_at).\n');
  }
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error('[linkedin-cookie] Error:', err.message);
  await browser.close().catch(() => {});
  process.exit(1);
}
