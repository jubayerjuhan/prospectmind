/**
 * Company identity — regression tests.
 *
 *   npm run test:company-identity
 *
 * Guards the logic behind a real bug: a prospect at "Kiln" (the staking
 * platform) was shown research for a coworking chain sharing the name, and his
 * bio was corroborated by pages about pottery kilns. Both failures came from
 * treating a company NAME as an identity.
 *
 * Deliberately dependency-free and I/O-free. It imports only pure modules, so
 * it needs no .env, no database and no network, and runs on a fresh clone.
 * Exits non-zero on failure so CI can gate on it.
 */

import {
  registrableDomain, normalizeDomainKey, domainFromEmail,
  linkedinCompanyKey, linkedinCompanyUrl, isPersonalNameDomain, isFreeEmailDomain,
} from '../src/utils/domains.js';
import { matchesAnchor, companyTokensOf, wordSpace, buildAnchor } from '../src/utils/anchorMatch.js';

let pass = 0;
let fail = 0;

const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(
    `${ok ? '  ok  ' : ' FAIL ' } ${label}` +
    (ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`)
  );
};

const group = (t) => console.log(`\n── ${t} ──`);

// ── Domain primitives ────────────────────────────────────────────────────────
// A wrong eTLD+1 is not cosmetic: domainKey is a unique index, so keying
// foo.co.uk as "co.uk" would merge every UK company in an org into one record.
group('domains');
eq('eTLD+1 keeps multi-label suffix', registrableDomain('https://www.foo.co.uk/careers'), 'foo.co.uk');
eq('eTLD+1 from bare host', registrableDomain('kiln.fi'), 'kiln.fi');
eq('eTLD+1 from scheme-less path', registrableDomain('kiln.fi/careers'), 'kiln.fi');
eq('platform host rejected', normalizeDomainKey('https://jane.github.io'), '');
eq('free mail rejected', normalizeDomainKey('gmail.com'), '');
eq('real company domain kept', normalizeDomainKey('https://www.kiln.fi/'), 'kiln.fi');
eq('work email → domain', domainFromEmail('Bob@Kiln.fi'), 'kiln.fi');
eq('free email normalizes away', normalizeDomainKey(domainFromEmail('bob@gmail.com')), '');
eq('relay address rejected', isFreeEmailDomain('privaterelay.appleid.com'), true);

group('linkedinCompanyKey');
eq('slug form', linkedinCompanyKey('https://www.linkedin.com/company/kiln-fi/about/'), 'kiln-fi');
eq('numeric id form', linkedinCompanyKey('/company/1234567/'), 'id:1234567');
eq('locale subdomain + query', linkedinCompanyKey('https://fr.linkedin.com/company/Kiln-Fi?trk=x'), 'kiln-fi');
eq('showcase page', linkedinCompanyKey('https://linkedin.com/showcase/kiln-labs'), 'kiln-labs');
eq('person profile is not a company', linkedinCompanyKey('https://linkedin.com/in/jane-doe'), '');
eq('empty input', linkedinCompanyKey(''), '');
eq('round-trips to a URL', linkedinCompanyUrl('kiln-fi'), 'https://www.linkedin.com/company/kiln-fi');

group('personal-name domains');
eq('own name is not an employer', isPersonalNameDomain('farhadhossain.dev', { firstName: 'Farhad', lastName: 'Hossain' }), true);
eq('company domain is', isPersonalNameDomain('kiln.fi', { firstName: 'Farhad', lastName: 'Hossain' }), false);

group('companyTokensOf');
eq('drops generic "labs"', companyTokensOf('Kiln Labs'), ['kiln']);
eq('drops 3-char tokens', companyTokensOf('IBM'), []);
eq('keeps the distinctive word', companyTokensOf('Chainlink Foundation'), ['chainlink']);

// ── The anchor guard ─────────────────────────────────────────────────────────
// The original bug: any page containing the token "kiln" counted as evidence
// about a person who works at Kiln.
group('matchesAnchor — the Kiln case');
const anchor = buildAnchor({
  company: 'Kiln',
  linkedinUrl: 'https://linkedin.com/in/jane-doe-123',
  firstName: 'Jane',
  lastName: 'Doe',
});

eq('pottery page REJECTED', matchesAnchor({
  source: 'https://ceramicsupply.com/kilns',
  title: 'Electric Kiln Buying Guide',
  snippet: 'Choosing the right kiln for your pottery studio.',
}, anchor), false);

eq('substring "kilning" REJECTED', matchesAnchor({
  source: 'https://example.com/a',
  title: 'Kilning malted barley',
  snippet: 'The kilning stage dries the grain.',
}, anchor), false);

eq('token only in the URL path REJECTED', matchesAnchor({
  source: 'https://example.com/blog/kiln/2024',
  title: 'Unrelated article',
  snippet: 'Nothing to do with anyone.',
}, anchor), false);

eq('company + person ACCEPTED', matchesAnchor({
  source: 'https://coindesk.com/x',
  title: 'Kiln appoints new CTO',
  snippet: 'Jane Doe joins Kiln as chief technology officer.',
}, anchor), true);

eq('confirmed LinkedIn slug ACCEPTED', matchesAnchor({
  source: 'https://www.linkedin.com/in/jane-doe-123',
  title: '', snippet: '',
}, anchor), true);

group('matchesAnchor — verified domain');
const domainAnchor = buildAnchor({
  company: 'Kiln',
  companyDomainKey: 'kiln.fi',
  linkedinUrl: 'https://linkedin.com/in/jane-doe-123',
  firstName: 'Jane',
  lastName: 'Doe',
});

eq("the company's own site ACCEPTED", matchesAnchor({
  source: 'https://www.kiln.fi/team', title: 'Team', snippet: 'Our people.',
}, domainAnchor), true);

eq('domain named in body text ACCEPTED', matchesAnchor({
  source: 'https://news.example.com/x',
  title: 'Staking roundup',
  snippet: 'kiln.fi expanded its validator set this quarter.',
}, domainAnchor), true);

group('matchesAnchor — multi-word names stay permissive');
const multi = buildAnchor({
  company: 'Chainlink Foundation',
  linkedinUrl: 'https://linkedin.com/in/jane-doe-123',
  firstName: 'Jane',
  lastName: 'Doe',
});
eq('distinctive name ACCEPTED without the person', matchesAnchor({
  source: 'https://example.com/x',
  title: 'Chainlink Foundation announces grants',
  snippet: 'New funding round for the ecosystem.',
}, multi), true);

eq('wordSpace pads for boundary matching', wordSpace('Kiln.fi'), ' kiln fi ');

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
