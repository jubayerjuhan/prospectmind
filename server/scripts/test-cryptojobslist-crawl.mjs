/**
 * Test script — crawls CryptoJobsList.com for company name/website/socials.
 *
 * Not wired into the app yet; this is for inspecting data quality before
 * deciding how (or whether) to turn it into a real import feature.
 *
 * robots.txt (checked 2026-08-03) explicitly allows /companies/ and sets
 * Crawl-delay: 1 — respected below. Cloudflare fronts the site with a JS
 * challenge, so plain fetch() gets a "Just a moment..." page; Puppeteer is
 * required, same as the existing pageScraper.js pattern.
 *
 * Each /companies/{slug} page embeds a Next.js __NEXT_DATA__ script with a
 * structured `company` object (name, url, twitter, discord, github, ...) —
 * reading that JSON directly is far more reliable than scraping the DOM.
 *
 * There's also a search endpoint, https://cryptojobslist.com/companies/search?q=,
 * which returns a lightweight list (name/slug only — no website/socials) via
 * the same __NEXT_DATA__ mechanism, under pageProps.companies. Their search
 * relevance is inconsistent (e.g. "Alchemy" returns only "Arbitrum"), so
 * results should be treated as candidates, not a guaranteed exact match.
 *
 * Usage:
 *   node scripts/test-cryptojobslist-crawl.mjs [--limit=10]
 *   node scripts/test-cryptojobslist-crawl.mjs --search="Kraken" [--limit=5]
 */

import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const getArg = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const LIMIT = parseInt(getArg('limit') || '10', 10);
const SEARCH_QUERY = getArg('search');
const CRAWL_DELAY_MS = 1200;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const fetchSitemapSlugs = async (page, limit) => {
  await page.goto('https://cryptojobslist.com/sitemap-companies.xml', {
    waitUntil: 'networkidle2',
    timeout: 20000,
  });
  const xml = await page.content();
  const slugs = [...xml.matchAll(/https:\/\/cryptojobslist\.com\/companies\/([a-z0-9-]+)/gi)].map((m) => m[1]);
  return [...new Set(slugs)].slice(0, limit);
};

const searchCompanySlugs = async (page, query, limit) => {
  const url = `https://cryptojobslist.com/companies/search?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
  const pageProps = await readNextData(page);
  const matches = pageProps?.companies || [];
  console.log(`[crawl] Search "${query}" → ${matches.length} match(es): ${matches.map((c) => c.name).join(', ') || '(none)'}`);
  return matches.slice(0, limit).map((c) => c.slug);
};

const fetchCompany = async (page, slug) => {
  const url = `https://cryptojobslist.com/companies/${slug}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
  const company = (await readNextData(page))?.company || null;
  if (!company) return null;

  const asUrl = (handle, base) => {
    if (!handle) return null;
    return handle.startsWith('http') ? handle : `${base}${handle}`;
  };

  return {
    name: company.name,
    slug: company.slug,
    website: company.url || null,
    twitter: asUrl(company.twitter, 'https://x.com/'),
    discord: company.discord || null,
    github: asUrl(company.github, 'https://github.com/'),
    location: company.location || null,
    foundedDate: company.foundedDate || null,
    techStack: company.techStack || null,
    sourceUrl: url,
  };
};

const main = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  let slugs;
  if (SEARCH_QUERY) {
    slugs = await searchCompanySlugs(page, SEARCH_QUERY, LIMIT);
  } else {
    console.log('[crawl] Fetching company sitemap...');
    slugs = await fetchSitemapSlugs(page, LIMIT);
    console.log(`[crawl] Found ${slugs.length} company slugs (limit ${LIMIT})`);
  }
  await sleep(CRAWL_DELAY_MS);

  const results = [];
  for (const slug of slugs) {
    try {
      const company = await fetchCompany(page, slug);
      if (company) {
        results.push(company);
        console.log(
          `  ✅ ${company.name} | website=${company.website || '-'} | twitter=${company.twitter || '-'} | github=${company.github || '-'} | discord=${company.discord || '-'}`
        );
      } else {
        console.log(`  ⚠️  ${slug}: no __NEXT_DATA__ company object found`);
      }
    } catch (err) {
      console.log(`  ❌ ${slug}: ${err.message}`);
    }
    await sleep(CRAWL_DELAY_MS);
  }

  await browser.close();

  console.log(`\n[crawl] Done. ${results.length}/${slugs.length} companies extracted.\n`);
  console.log(JSON.stringify(results, null, 2));
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
