/**
 * General Page Scraper
 *
 * Strategy:
 *  1. Puppeteer (headless Chrome) — renders JS, captures all links in the DOM
 *     Best for: personal portfolio sites, SPA / React / Next.js pages
 *  2. Jina AI Reader fallback — if Puppeteer gets blocked or returns too little
 *     Best for: static sites, blogs, news articles
 *
 * Returns: { text, links } where links is every external href found on the page.
 * The links array is key for finding GitHub, X, Telegram etc. in footers/navbars.
 */

import puppeteer from 'puppeteer';
import https from 'https';

// ─── Puppeteer scrape ─────────────────────────────────────────────────────────

const scrapeWithPuppeteer = async (url) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise(r => setTimeout(r, 1500));

    // Scroll to bottom to load lazy content
    await page.evaluate(async () => {
      for (let i = 0; i < 10; i++) {
        window.scrollBy(0, 600);
        await new Promise(r => setTimeout(r, 150));
      }
    });

    const { text, links } = await page.evaluate(() => {
      ['script', 'style', 'nav', 'footer'].forEach(tag =>
        document.querySelectorAll(tag).forEach(el => el.remove())
      );
      const cleaned = document.body.innerText.replace(/\s+/g, ' ').slice(0, 1500);

      // Capture ALL external hrefs — footers often have GitHub/X/Telegram links
      const links = [...document.querySelectorAll('a[href]')]
        .map(a => a.href)
        .filter(href => href.startsWith('http') && !href.includes(window.location.hostname));

      return { text, links };
    });

    await browser.close();
    return { text: text.trim(), links: [...new Set(links)] };
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    return null;
  }
};

// ─── Jina AI fallback ─────────────────────────────────────────────────────────

const scrapeWithJina = (url) =>
  new Promise((resolve) => {
    const req = https.get(
      `https://r.jina.ai/${url}`,
      { headers: { Accept: 'text/plain', 'User-Agent': 'ProspectMind/1.0' }, timeout: 15000 },
      (res) => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200 || body.length < 100) return resolve(null);
          if (body.includes('Target URL returned error') || body.includes('not yet fully loaded')) return resolve(null);

          // Extract any github/x/telegram links from the Jina markdown text
          const links = [];
          const ghMatches = body.matchAll(/https?:\/\/github\.com\/[a-zA-Z0-9_-]+/g);
          for (const m of ghMatches) links.push(m[0]);
          const xMatches = body.matchAll(/https?:\/\/(?:twitter|x)\.com\/[a-zA-Z0-9_]+/g);
          for (const m of xMatches) links.push(m[0]);

          resolve({ text: body.slice(0, 3000).trim(), links: [...new Set(links)] });
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Scrape a page and return { text, links }.
 * `links` contains every external URL found — crucial for discovering social profiles.
 */
export const scrapePage = async (url) => {
  if (!url || url.includes('linkedin.com')) return null;

  console.log(`[scraper] Scraping: ${url}`);

  // Try Puppeteer first (renders JS, sees React footer links)
  const puppeteerResult = await scrapeWithPuppeteer(url);
  if (puppeteerResult && puppeteerResult.text.length > 200) {
    console.log(`[scraper] ✅ Puppeteer scraped ${puppeteerResult.text.length} chars, ${puppeteerResult.links.length} links from ${url}`);
    return puppeteerResult;
  }

  // Fallback to Jina
  console.log(`[scraper] Puppeteer got little content, trying Jina for ${url}`);
  const jinaResult = await scrapeWithJina(url);
  if (jinaResult) {
    console.log(`[scraper] ✅ Jina scraped ${jinaResult.text.length} chars from ${url}`);
  } else {
    console.warn(`[scraper] ❌ Both scrapers failed for ${url}`);
  }
  return jinaResult;
};
