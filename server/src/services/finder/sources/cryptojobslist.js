/**
 * Company Finder source adapter — CryptoJobsList.com
 *
 * Cloudflare fronts the site with a JS challenge, so plain fetch()/curl gets a
 * "Just a moment..." 403 — Puppeteer is required (same as pageScraper.js).
 * Unlike pageScraper.js's launch-per-call pattern (fine for occasional pipeline
 * enrichment calls), this adapter backs an interactive search box, so it keeps
 * one browser alive across requests and only opens/closes a page per call.
 *
 * Both list and detail pages embed a Next.js __NEXT_DATA__ <script> with the
 * page's server-fetched JSON — reading that directly is far more reliable than
 * scraping the rendered DOM.
 */

import puppeteer from 'puppeteer';

const BASE_URL = 'https://cryptojobslist.com';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// robots.txt sets "Crawl-delay: 1" — serialize outbound requests so an
// interactive search box (typing, sorting, paging) never bursts past that.
const MIN_REQUEST_GAP_MS = 1000;
let lastRequestAt = 0;
let throttleChain = Promise.resolve();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const throttle = () => {
  const run = throttleChain.then(async () => {
    const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  throttleChain = run.catch(() => {});
  return run;
};

let browserPromise = null;
const getBrowser = () => {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
    });
    browserPromise.catch(() => {
      browserPromise = null; // let the next call retry a fresh launch
    });
  }
  return browserPromise;
};

const withPage = async (fn) => {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(USER_AGENT);
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
};

const readNextData = async (page) =>
  page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent)?.props?.pageProps || null;
    } catch {
      return null;
    }
  });

// UI label -> CryptoJobsList's own ?sort= value, confirmed by clicking each
// option on cryptojobslist.com/companies and reading the resulting URL.
export const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'verified', label: 'Verified' },
  { value: 'recent', label: 'Recently Active' },
  { value: 'active-jobs', label: 'Active Jobs' },
];

const asUrl = (handle, base) => {
  if (!handle) return null;
  return handle.startsWith('http') ? handle : `${base}${handle}`;
};

/**
 * Browse/search companies. Mirrors https://cryptojobslist.com/companies
 * exactly — same fields, same sort values, same 40-per-page default.
 */
export const browse = async ({ query = '', sort = '', page = 1 } = {}) => {
  await throttle();
  return withPage(async (p) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (sort && sort !== 'relevance') params.set('sort', sort);
    if (page > 1) params.set('page', String(page));

    const url = `${BASE_URL}/companies${params.toString() ? `?${params}` : ''}`;
    await p.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    const pageProps = await readNextData(p);

    const companies = (pageProps?.companies || []).map((c) => ({
      sourceId: c.id,
      source: 'cryptojobslist',
      name: c.name,
      slug: c.slug,
      logo: c.logo || null,
      tagline: c.tagline || null,
      tags: c.tags || [],
      verified: Boolean(c.verified),
      activeJobs: c.activeJobs ?? 0,
    }));

    const meta = pageProps?.meta || {};
    return {
      companies,
      pagination: {
        total: meta.totalCount ?? companies.length,
        page: meta.page ?? page,
        limit: meta.limit ?? companies.length,
        pages: meta.totalPages ?? 1,
      },
    };
  });
};

/**
 * Full company profile — website, socials, location, etc. Only available on
 * the individual company page, not the list/search response.
 */
export const getDetail = async ({ slug } = {}) => {
  if (!slug) return null;
  await throttle();
  return withPage(async (p) => {
    const sourceUrl = `${BASE_URL}/companies/${slug}`;
    await p.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    const company = (await readNextData(p))?.company || null;
    if (!company) return null;

    return {
      source: 'cryptojobslist',
      sourceId: company.id,
      slug: company.slug,
      name: company.name,
      about: company.about || null,
      website: company.url || null,
      twitter: asUrl(company.twitter, 'https://x.com/'),
      discord: company.discord || null,
      github: asUrl(company.github, 'https://github.com/'),
      location: company.location || null,
      foundedDate: company.foundedDate || null,
      techStack: company.techStack || null,
      funding: company.funding || null,
      sourceUrl,
    };
  });
};

export default { key: 'cryptojobslist', label: 'CryptoJobsList', sortOptions: SORT_OPTIONS, browse, getDetail };
