/**
 * LinkedIn company page scraper.
 *
 * Company research used to start from a Google search for the bare name and
 * take whatever ranked first as the official site. For an ambiguous name that
 * is a coin flip, and the loser's facts were written onto the company record
 * and then into every outreach message.
 *
 * A LinkedIn company slug is an exact entity id, and the /about/ tab publishes
 * the same fields we were guessing — Website, Industry, Company size,
 * Headquarters, Founded, Specialties, plus the overview text. So when a
 * prospect's profile tells us which company page their employer is, we read
 * the facts instead of inferring them.
 *
 * Note this is the AUTHENTICATED path. pageScraper.js refuses linkedin.com by
 * design (its fetch-based requests only ever see a login wall); this reuses the
 * logged-in Puppeteer session instead.
 */

import { withLinkedInSession, scrapeLinkedInPageText } from './linkedinScraper.js';
import { linkedinCompanyKey, linkedinCompanyUrl, normalizeDomainKey } from '../../utils/domains.js';

/**
 * The /about/ tab renders as a label/value list. Pull one field by its label,
 * tolerating both "Label\nValue" and "Label Value" layouts and LinkedIn's
 * localized ordering.
 */
const fieldFrom = (text, labels) => {
  for (const label of labels) {
    const re = new RegExp(`^\\s*${label}\\s*[:\\n]\\s*(.+)$`, 'im');
    const match = text.match(re);
    const value = match?.[1]?.trim();
    if (value && value.length < 300) return value;
  }
  return '';
};

/** "11-50 employees" / "1,001-5,000 employees" → "11-50" / "1001-5000" */
const parseSize = (raw = '') => {
  const match = raw.match(/([\d,]+(?:\s*[-–]\s*[\d,]+)?\+?)\s*employees/i);
  if (!match) return raw.replace(/\s*employees\s*/i, '').trim();
  return match[1].replace(/,/g, '').replace(/\s*[-–]\s*/, '-');
};

/** LinkedIn shows the website as a bare host as often as a full URL. */
const parseWebsite = (raw = '') => {
  const match = raw.match(/https?:\/\/[^\s)]+/i);
  if (match) return match[0].replace(/[.,;]+$/, '');
  const host = raw.trim().split(/\s+/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) ? `https://${host}` : '';
};

const parseAboutText = (text = '') => {
  const website = parseWebsite(fieldFrom(text, ['Website', 'Site web', 'Webseite']));
  const sizeRaw = fieldFrom(text, ['Company size', 'Taille de l.entreprise', 'Unternehmensgr..e']);
  const specialtiesRaw = fieldFrom(text, ['Specialties', 'Sp.cialit.s']);

  // The overview paragraph sits between the "About"/"Overview" heading and the
  // first labelled field.
  const overviewMatch = text.match(/^\s*(?:About us|About|Overview)\s*\n([\s\S]{40,4000}?)(?=\n\s*(?:Website|Industry|Company size|Headquarters|Founded|Specialties|Locations)\b)/im);

  return {
    description: overviewMatch?.[1]?.trim() || '',
    website,
    domain: normalizeDomainKey(website),
    industry: fieldFrom(text, ['Industry', 'Secteur', 'Branche']),
    size: parseSize(sizeRaw),
    headquarters: fieldFrom(text, ['Headquarters', 'Si.ge social', 'Hauptsitz']),
    founded: fieldFrom(text, ['Founded', 'Fond.e en', 'Gegr.ndet']),
    specialties: specialtiesRaw
      ? specialtiesRaw.split(/\s*,\s*|\s+and\s+/i).map((s) => s.trim()).filter(Boolean).slice(0, 25)
      : [],
  };
};

/**
 * Scrape a company's LinkedIn About tab.
 *
 * @param {String} slugOrUrl  'kiln-fi', 'id:1234567', or any /company/ URL
 * @returns {Promise<Object|null>} parsed fields, or null when unavailable.
 *   `authFailed: true` means the session is dead — the caller should fall back
 *   to web research rather than treating the company as having no data.
 */
export const scrapeLinkedInCompany = async (slugOrUrl) => {
  const raw = String(slugOrUrl || '').trim();
  if (!raw) return null;

  // Accept a bare key as readily as a URL: callers hold the stored linkedinKey.
  const key = raw.includes('/') ? linkedinCompanyKey(raw) : raw.toLowerCase();
  if (!key) return null;

  const aboutUrl = `${linkedinCompanyUrl(key)}/about/`;
  console.log(`[linkedin-company] Scraping ${aboutUrl}`);

  const session = await withLinkedInSession((page) => scrapeLinkedInPageText(page, aboutUrl));

  if (!session.ok) {
    if (session.authFailed) {
      console.warn(`[linkedin-company] Session dead — cannot read ${key}`);
      return { linkedinKey: key, linkedinUrl: linkedinCompanyUrl(key), authFailed: true };
    }
    console.warn(`[linkedin-company] Failed for ${key}: ${session.error?.message}`);
    return null;
  }

  const text = session.result;
  if (!text || text.length < 100) {
    console.warn(`[linkedin-company] About page empty or restricted for ${key}`);
    return null;
  }

  // Deliberately no display name: the first text line is as often LinkedIn's
  // own chrome ("0 notifications total") as the company's h1, and a wrong name
  // on a company record is exactly the confusion this module exists to end.
  // The name we already hold from the prospect is good enough.
  const parsed = parseAboutText(text);

  console.log(
    `[linkedin-company] ✅ ${key} → website=${parsed.website || '—'} industry=${parsed.industry || '—'} size=${parsed.size || '—'}`
  );

  return {
    linkedinKey: key,
    linkedinUrl: linkedinCompanyUrl(key),
    ...parsed,
    authFailed: false,
  };
};

export const __companyScraperTesting = { parseAboutText, parseSize, parseWebsite, fieldFrom };
