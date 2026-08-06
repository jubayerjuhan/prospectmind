/**
 * "Do these two domains serve the same site?" — resolved by following HTTP
 * redirects rather than comparing strings.
 *
 * A company's LinkedIn About page states ONE website, and it is often not the
 * domain we already hold: CertiK's page lists certik.com while our record was
 * built from certik.org. String equality calls that a different company and
 * throws away a correct match. But certik.org 301s to certik.com — the two
 * domains resolve to one site, which is proof of the same company that no
 * amount of name reasoning can fake.
 *
 * This also covers rebrands and acquisitions, where the brands differ entirely
 * (oldname.com → newname.io) and a brand-similarity check would find nothing.
 *
 * Kept out of domains.js on purpose: that module is pure string logic used on
 * every write path, and this one does network I/O.
 */

import { registrableDomain } from './domains.js';

const TIMEOUT_MS = 8000;

// Resolutions are stable and a single company resolution re-checks the same
// domain once per candidate, so cache for the life of the process.
const cache = new Map();

/**
 * Follow redirects from a domain's homepage and report where it lands.
 *
 * @returns {Promise<String>} registrable domain of the final URL, or '' when
 *   the host is unreachable (offline, DNS failure, TLS error, timeout) — an
 *   unknown answer, never to be read as "different".
 */
export const resolveFinalDomain = async (domain = '') => {
  const start = registrableDomain(domain);
  if (!start) return '';
  if (cache.has(start)) return cache.get(start);

  let landed = '';
  try {
    const res = await fetch(`https://${start}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'ProspectMind/1.0', Accept: 'text/html' },
    });
    // Only the final URL matters; drop the body without reading it.
    res.body?.cancel().catch(() => {});
    landed = registrableDomain(res.url);
  } catch {
    landed = '';
  }

  cache.set(start, landed);
  return landed;
};

/**
 * True when two domains provably serve the same site — either one redirects to
 * the other, or both redirect to a common third domain.
 *
 * Returns false when a host could not be reached: absence of proof, not proof
 * of absence. Callers decide what an unproven pair means.
 */
export const domainsResolveToSame = async (a = '', b = '') => {
  const da = registrableDomain(a);
  const db = registrableDomain(b);
  if (!da || !db) return false;
  if (da === db) return true;

  const [landedA, landedB] = await Promise.all([resolveFinalDomain(da), resolveFinalDomain(db)]);
  if (landedA && landedA === db) return true;
  if (landedB && landedB === da) return true;
  return Boolean(landedA) && landedA === landedB;
};
