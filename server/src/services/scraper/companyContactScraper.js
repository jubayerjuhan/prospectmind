/**
 * Company Contact Scraper
 *
 * pageScraper.js (used by companyAnalyzer.js) deliberately strips internal
 * links — it only wants external footer/nav links for a single page. That
 * means it can never discover a site's own /contact or /team page. This
 * scraper is the "agent" hop that one: it loads the homepage, finds the best
 * internal contact-ish page, and visits that too, in the same browser session.
 *
 * Returns raw material for an AI step to reason over — this file only
 * gathers and classifies, it doesn't decide what's a real contact.
 */

import puppeteer from 'puppeteer';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CONTACT_PATH_RE = /\/(contact|about|team|people)(?:[/?#]|$)/i;
const MAX_TEXT_CHARS = 6000;

const scrapePageContent = async (page, url) => {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1000));

  return page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href]')]
      .map((a) => a.href)
      .filter((href) => href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:'));

    ['script', 'style', 'nav', 'footer'].forEach((tag) =>
      document.querySelectorAll(tag).forEach((el) => el.remove())
    );
    const text = document.body.innerText.replace(/\s+/g, ' ').trim();

    return { text, links: [...new Set(links)] };
  });
};

const findContactPageUrl = (links, hostname) => {
  const candidates = links.filter((href) => {
    try {
      const u = new URL(href);
      return u.hostname === hostname && CONTACT_PATH_RE.test(u.pathname);
    } catch {
      return false;
    }
  });
  // Prefer an explicit "contact" path over about/team/people.
  return candidates.find((h) => /\/contact/i.test(h)) || candidates[0] || null;
};

const classifyLink = (href) => {
  if (href.startsWith('mailto:')) {
    const value = href.replace('mailto:', '').split('?')[0].trim();
    if (!value || value.includes('example') || value.includes('test@')) return null;
    return { type: 'email', value };
  }
  if (href.startsWith('tel:')) {
    return { type: 'phone', value: href.replace('tel:', '').trim() };
  }
  if (/(?:twitter|x)\.com\//i.test(href)) return { type: 'twitter', value: href };
  if (/linkedin\.com\//i.test(href)) return { type: 'linkedin', value: href };
  if (/(?:t\.me|telegram\.me)\//i.test(href)) return { type: 'telegram', value: href };
  if (/discord\.(?:gg|com)\//i.test(href)) return { type: 'discord', value: href };
  if (/github\.com\//i.test(href)) return { type: 'github', value: href };
  return null;
};

/**
 * Scrape a company's own website for contact evidence: homepage plus (if
 * found) one contact/about/team page. Returns { text, rawLinks, pagesVisited }
 * or null if the site couldn't be reached at all.
 */
export const scrapeCompanySite = async (website) => {
  if (!website) return null;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--single-process'],
    });
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 900 });

    console.log(`[companyContactScraper] Scraping: ${website}`);
    const home = await scrapePageContent(page, website);
    const pagesVisited = [website];
    let combinedText = home.text;
    let allLinks = [...home.links];

    const hostname = new URL(website).hostname;
    const contactUrl = findContactPageUrl(home.links, hostname);
    if (contactUrl && contactUrl !== website) {
      try {
        console.log(`[companyContactScraper] Found contact-ish page: ${contactUrl}`);
        const contactPage = await scrapePageContent(page, contactUrl);
        pagesVisited.push(contactUrl);
        combinedText += `\n\n=== ${contactUrl} ===\n${contactPage.text}`;
        allLinks = [...allLinks, ...contactPage.links];
      } catch (err) {
        console.warn(`[companyContactScraper] Failed to load contact page ${contactUrl}: ${err.message}`);
      }
    }

    await browser.close();

    const rawLinks = [];
    const seen = new Set();
    for (const link of new Set(allLinks)) {
      const classified = classifyLink(link);
      if (!classified) continue;
      const key = `${classified.type}:${classified.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rawLinks.push(classified);
    }

    return {
      text: combinedText.trim().slice(0, MAX_TEXT_CHARS),
      rawLinks,
      pagesVisited,
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.warn(`[companyContactScraper] Failed to scrape ${website}: ${err.message}`);
    return null;
  }
};
