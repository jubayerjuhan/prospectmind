/**
 * Identity anchor guard.
 *
 * A name-based Google search has no idea which of the many people sharing a
 * name we mean, nor which of the many companies sharing a name they work for.
 * A snippet is only allowed into the enrichment prompt if it corroborates
 * something already known for certain about THIS confirmed profile: the exact
 * LinkedIn slug, the verified company domain, the company name in a form
 * distinctive enough to mean something, or a personal domain that is literally
 * the person's name.
 *
 * Pure string logic with no I/O, so it lives here rather than inside the
 * pipeline — it can be reasoned about and tested without loading the pipeline's
 * module graph (which reaches Resend, Puppeteer and the AI clients on import).
 */

import { registrableDomain } from './domains.js';

// Generic corporate/industry words carry no identifying power: "Kiln Labs"
// must not be corroborated by any page that happens to say "labs".
export const STOPWORDS = new Set([
  'the', 'inc', 'llc', 'ltd', 'co', 'corp', 'group', 'company', 'companies',
  'technologies', 'technology', 'labs', 'lab', 'studio', 'studios', 'team', 'and', 'of', 'for',
  'ventures', 'capital', 'partners', 'holdings', 'global', 'network', 'protocol',
  'foundation', 'dao', 'digital', 'solutions', 'systems', 'services', 'international',
]);

export const extractLinkedinSlug = (linkedinUrl) => {
  if (!linkedinUrl) return null;
  const match = linkedinUrl.match(/\/in\/([^/?]+)/i);
  return match ? match[1].toLowerCase() : null;
};

/**
 * Collapse to space-separated alphanumeric words, padded with a leading and
 * trailing space so `.includes(' word ')` is an exact word-boundary test.
 * Substring matching is not good enough here — "kiln" must not match
 * "kilning" or "Wilkilnson".
 */
export const wordSpace = (s = '') => ` ${String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/**
 * A 3-character token like "ai" or "web" matches far too much of the internet
 * to corroborate anything on its own. Short real names (IBM, SAP) still work:
 * they fall through to the full-phrase path below, which requires the person's
 * name to co-occur.
 */
export const companyTokensOf = (company) =>
  wordSpace(company)
    .trim()
    .split(' ')
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));

/**
 * Decide whether a name-based search result is really about THIS person.
 *
 * The company name alone is not enough evidence. "Kiln" is a staking company,
 * a design studio, and a piece of pottery equipment; a page mentioning "kiln"
 * says nothing about which one — and treating it as evidence is what feeds a
 * prospect's bio with facts about the wrong employer.
 *
 * So a company-name hit only corroborates when it is distinctive on its own
 * (a multi-word name), or when the person is named on the same page.
 */
export const matchesAnchor = (
  { source = '', title = '', snippet = '' },
  { companyPhrase = '', companyTokens = [], companyDomainKey = '', linkedinSlug, firstName, lastName }
) => {
  // The confirmed LinkedIn slug in the URL — decisive.
  if (linkedinSlug && source.toLowerCase().includes(linkedinSlug)) return true;

  // The page IS the company's own site — decisive.
  if (companyDomainKey && registrableDomain(source) === companyDomainKey) return true;

  // The URL is deliberately excluded from the text below. A token buried in a
  // path or query string is not a statement about this person, and the old
  // implementation matched exactly that.
  const text = wordSpace(`${title} ${snippet}`);
  const fn = wordSpace(firstName).trim();
  const ln = wordSpace(lastName).trim();
  const namedHere = (fn && text.includes(` ${fn} `)) || (ln && text.includes(` ${ln} `));

  // The verified company domain spelled out in the body text ("kiln.fi" →
  // " kiln fi ", matching how the text itself was normalized).
  if (companyDomainKey && text.includes(wordSpace(companyDomainKey))) return true;

  const phraseWords = companyPhrase ? companyPhrase.split(' ').filter(Boolean) : [];
  const fullPhraseHit = phraseWords.length > 0 && text.includes(wordSpace(companyPhrase));

  // A multi-word company name is distinctive enough by itself.
  if (fullPhraseHit && phraseWords.length > 1) return true;

  // A single-word name ("Kiln") is not — require the person on the same page.
  const tokensAllHit = companyTokens.length > 0 && companyTokens.every((t) => text.includes(` ${t} `));
  if (namedHere && (fullPhraseHit || tokensAllHit)) return true;

  // A domain that is literally the person's own name (e.g. farhadhossain.dev)
  // is strong self-identifying evidence, independent of company.
  try {
    const host = new URL(source).hostname.toLowerCase().replace(/^www\./, '');
    const hostCompact = host.replace(/[^a-z0-9]/g, '');
    const fnc = (firstName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const lnc = (lastName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (fnc && lnc && hostCompact.includes(fnc) && hostCompact.includes(lnc)) return true;
  } catch {
    // invalid URL — ignore
  }
  return false;
};

/** Build the anchor for a prospect once, for reuse across every snippet. */
export const buildAnchor = ({ company = '', companyDomainKey = '', linkedinUrl = '', firstName = '', lastName = '' } = {}) => ({
  companyPhrase: wordSpace(company).trim(),
  companyTokens: companyTokensOf(company),
  companyDomainKey,
  linkedinSlug: extractLinkedinSlug(linkedinUrl),
  firstName,
  lastName,
});
