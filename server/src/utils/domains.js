/**
 * Domain primitives for company identity resolution.
 *
 * A company's registrable domain (eTLD+1) is one of the identity keys behind
 * the unique indexes on Company, so getting it wrong merges unrelated
 * companies. Two classes of input must be rejected outright:
 *
 *   - free/consumer email hosts — a gmail.com address says nothing about
 *     where someone works;
 *   - shared platform hosts — jane.github.io and acme.github.io are different
 *     people on one platform, but both reduce to the eTLD+1 "github.io".
 *
 * eTLD+1 comes from tldts (bundled Public Suffix List). A hand-rolled suffix
 * table mis-keys foo.co.uk as "co.uk", which would merge every UK company in
 * an organization into a single record — exactly the failure mode this module
 * exists to prevent.
 */

import { parse as parseDomain } from 'tldts';

/** Consumer/free mail hosts. A work-email domain is never one of these. */
export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.fr',
  'yahoo.de', 'yahoo.es', 'yahoo.it', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.it', 'hotmail.de',
  'outlook.com', 'outlook.fr', 'outlook.de', 'live.com', 'live.co.uk', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me', 'tutanota.com', 'tuta.io',
  'zoho.com', 'zohomail.com', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de',
  'mail.com', 'mail.ru', 'yandex.com', 'yandex.ru', 'inbox.ru', 'bk.ru', 'list.ru',
  'qq.com', '163.com', '126.com', 'sina.com', 'naver.com', 'daum.net', 'hanmail.net',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 'sfr.fr',
  'libero.it', 'virgilio.it', 'alice.it', 'tiscali.it',
  'terra.com.br', 'uol.com.br', 'bol.com.br', 'rediffmail.com',
  'fastmail.com', 'hey.com', 'hushmail.com', 'seznam.cz', 'wp.pl', 'o2.pl',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net',
  'btinternet.com', 'sky.com', 'talktalk.net', 'shaw.ca', 'rogers.com', 'telus.net',
  'bigpond.com', 'optusnet.com.au', 'xtra.co.nz',
]);

/** Disposable / forwarding / relay hosts — never an employer. */
export const RELAY_EMAIL_DOMAINS = new Set([
  'privaterelay.appleid.com', 'simplelogin.com', 'simplelogin.io', 'slmail.me',
  'anonaddy.com', 'anonaddy.me', 'addy.io', 'duck.com', 'relay.firefox.com',
  'mailinator.com', 'guerrillamail.com', 'yopmail.com', '10minutemail.com',
  'temp-mail.org', 'throwawaymail.com', 'sharklasers.com', 'trashmail.com',
  'maildrop.cc', 'dispostable.com', 'getnada.com', 'mailnesia.com',
]);

/**
 * Multi-tenant hosting/publishing platforms. These are real eTLD+1 values, so
 * tldts happily returns them — but they identify a platform, not a company.
 */
export const PLATFORM_HOSTS = new Set([
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app',
  'netlify.com', 'herokuapp.com', 'firebaseapp.com', 'web.app', 'appspot.com',
  'azurewebsites.net', 'surge.sh', 'render.com', 'fly.dev', 'replit.app', 'repl.co',
  'glitch.me', 'codesandbox.io', 'stackblitz.io',
  'notion.site', 'notion.so', 'substack.com', 'medium.com', 'wordpress.com',
  'blogspot.com', 'blogger.com', 'tumblr.com', 'ghost.io', 'hashnode.dev', 'dev.to',
  'wixsite.com', 'wix.com', 'squarespace.com', 'webflow.io', 'weebly.com',
  'carrd.co', 'linktr.ee', 'about.me', 'beacons.ai', 'bento.me', 'bio.link',
  'notion.link', 'read.cv', 'super.site', 'framer.website', 'framer.app',
  'behance.net', 'dribbble.com', 'gumroad.com', 'buymeacoffee.com', 'patreon.com',
  'calendly.com', 'typeform.com', 'airtable.com', 'google.com', 'docs.google.com',
  'drive.google.com', 'sites.google.com', 'youtube.com', 'linkedin.com',
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'github.com', 'gitlab.com',
  'crunchbase.com', 'wikipedia.org', 'angel.co', 'wellfound.com', 'producthunt.com',
]);

/**
 * Registrable domain (eTLD+1) of a URL or bare hostname.
 * Accepts "https://www.kiln.fi/careers", "www.kiln.fi", "kiln.fi".
 *
 * @returns {String} lowercased eTLD+1, or '' when it cannot be determined
 */
export const registrableDomain = (urlOrHost = '') => {
  const raw = String(urlOrHost || '').trim();
  if (!raw) return '';
  // tldts parses bare hosts and full URLs alike, but chokes on a leading
  // scheme-less path ("kiln.fi/careers"), so strip anything after the host.
  const candidate = raw.includes('://') ? raw : raw.split(/[/?#]/)[0];
  const parsed = parseDomain(candidate);
  return (parsed?.domain || '').toLowerCase();
};

/** True when this domain is a shared platform rather than one company's site. */
export const isPlatformHost = (domain = '') => PLATFORM_HOSTS.has(String(domain).toLowerCase());

/** True when this domain belongs to a consumer mail provider or a relay. */
export const isFreeEmailDomain = (domain = '') => {
  const d = String(domain).toLowerCase();
  return FREE_EMAIL_DOMAINS.has(d) || RELAY_EMAIL_DOMAINS.has(d);
};

/**
 * Normalize any URL/host into a Company identity key, or '' when the input is
 * not usable as one. This is the ONLY function that should ever produce a
 * `domainKey` — everything else delegates here so the value behind the unique
 * index is derived one way.
 */
export const normalizeDomainKey = (urlOrHost = '') => {
  const domain = registrableDomain(urlOrHost);
  if (!domain) return '';
  if (isPlatformHost(domain)) return '';
  if (isFreeEmailDomain(domain)) return '';
  return domain;
};

/** Registrable domain of an email address ('' when absent or malformed). */
export const domainFromEmail = (email = '') => {
  const at = String(email || '').trim().toLowerCase().lastIndexOf('@');
  if (at < 1) return '';
  return registrableDomain(String(email).trim().toLowerCase().slice(at + 1));
};

const compact = (s = '') => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The brand portion of a registrable domain — everything before the public
 * suffix, compacted. 'certik.com' and 'certik.org' both → 'certik'.
 */
export const domainBrand = (domain = '') => compact(String(domain).split('.')[0]);

/**
 * True when two DIFFERENT registrable domains share one brand under different
 * public suffixes (certik.org / certik.com, kiln.fi / kiln.com).
 *
 * A company routinely owns its brand across several TLDs and lists only one of
 * them on LinkedIn, so the two are usually the same organization — but not
 * always (unrelated owners can hold example.com and example.org), which is why
 * callers must treat this as a candidate signal to corroborate, never as proof
 * of identity on its own. The 4-character floor keeps generic short brands
 * ("ai.com" / "ai.io") from matching anything.
 */
export const isSameBrandDomain = (a = '', b = '') => {
  const da = String(a).toLowerCase();
  const db = String(b).toLowerCase();
  if (!da || !db || da === db) return false;
  const brand = domainBrand(da);
  return brand.length >= 4 && brand === domainBrand(db);
};

/**
 * True when a domain is the person's own name rather than their employer's
 * (e.g. farhadhossain.dev, or a domain matching their LinkedIn slug).
 * Mirrors the heuristic already used for personal sites in enrichment.js.
 */
export const isPersonalNameDomain = (domain = '', { firstName = '', lastName = '', linkedinSlug = '' } = {}) => {
  const sld = compact(String(domain).split('.')[0]);
  if (!sld || sld.length < 3) return true; // too short to identify anything

  const fn = compact(firstName);
  const ln = compact(lastName);
  if (fn && ln && sld.includes(fn) && sld.includes(ln)) return true;

  const slug = compact(linkedinSlug).replace(/[0-9a-f]{6,}$/, ''); // strip LinkedIn's hash suffix
  if (slug && slug.length >= 5 && sld === slug) return true;

  return false;
};

/**
 * Normalize a LinkedIn company URL into a stable identity key.
 * LinkedIn serves both slug and numeric-id forms, plus locale subdomains,
 * trailing slashes and tracking query strings — all of which must collapse.
 *
 *   https://www.linkedin.com/company/kiln-fi/about/  → 'kiln-fi'
 *   /company/1234567/                                → 'id:1234567'
 *   https://fr.linkedin.com/company/Kiln-Fi?trk=x    → 'kiln-fi'
 *
 * @returns {String} the key, or '' when the URL is not a company page
 */
export const linkedinCompanyKey = (url = '') => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/(?:company|showcase)\/([^/?#]+)/i);
  if (!match) return '';

  const slug = decodeURIComponent(match[1]).toLowerCase().replace(/\/+$/, '');
  if (!slug) return '';
  // A purely numeric segment is LinkedIn's internal company id, not a slug.
  return /^\d+$/.test(slug) ? `id:${slug}` : slug;
};

/** Canonical company URL for a stored linkedinKey ('' for an empty key). */
export const linkedinCompanyUrl = (key = '') => {
  const k = String(key || '').trim();
  if (!k) return '';
  const slug = k.startsWith('id:') ? k.slice(3) : k;
  return `https://www.linkedin.com/company/${slug}`;
};
