/**
 * Unit tests for company de-duplication.
 *
 * The rule in isLikelySameCompany decides whether two records get collapsed
 * into one, and a merge deletes a record — so a false positive is destructive
 * and irreversible. The negative cases below matter more than the positive one.
 *
 * Everything here is pure: no database, no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { __companyMergerTesting } from './companyMerger.js';

const { identityStrength, pickPrimary, isLikelySameCompany, buildMergePatch, unionBy } = __companyMergerTesting;

const ORG = 'org-1';

const company = (overrides = {}) => ({
  _id: overrides._id || Math.random().toString(36).slice(2),
  organization: ORG,
  name: 'CertiK',
  nameKey: 'certik',
  linkedinKey: '',
  domainKey: '',
  signals: [],
  contacts: [],
  sourceRefs: [],
  ...overrides,
});

/* ── the merge rule ───────────────────────────────────────────────── */

test('merges one brand held under two TLDs', () => {
  const a = company({ domainKey: 'certik.com', industry: 'Computer and Network Security' });
  const b = company({ domainKey: 'certik.org', industry: 'Blockchain Security' });

  assert.equal(isLikelySameCompany(a, b), true);
  assert.equal(isLikelySameCompany(b, a), true);
});

test('merges a keyless placeholder into the identified record', () => {
  const placeholder = company({ needsReview: true });
  const identified = company({ domainKey: 'certik.com' });

  assert.equal(isLikelySameCompany(placeholder, identified), true);
});

test('refuses one brand across two TLDs when the sectors disagree', () => {
  // Real records: kiln.fi is a staking company, kiln.com rents desks. Same
  // name, same brand, different businesses — the brand match is not enough.
  const staking = company({ name: 'Kiln', nameKey: 'kiln', domainKey: 'kiln.fi', industry: 'Software Development' });
  const coworking = company({
    name: 'Kiln', nameKey: 'kiln', domainKey: 'kiln.com',
    industry: 'Coworking and Flexible Office Spaces',
  });

  assert.equal(isLikelySameCompany(staking, coworking), false);
});

test('allows sectors that are worded differently but overlap', () => {
  // The real CertiK pair — both say "Security", so this is one company.
  const a = company({ domainKey: 'certik.com', industry: 'Computer and Network Security' });
  const b = company({ domainKey: 'certik.org', industry: 'Blockchain Security' });

  assert.equal(isLikelySameCompany(a, b), true);
});

test('an unanalyzed record does not contradict anything', () => {
  const analyzed = company({ domainKey: 'certik.com', industry: 'Computer and Network Security' });
  const blank = company({ domainKey: 'certik.org', industry: '' });

  assert.equal(isLikelySameCompany(analyzed, blank), true);
});

test('a placeholder is steered to the sibling whose sector it matches', () => {
  // The keyless "Kiln / Coworking" placeholder belongs to kiln.com, not kiln.fi.
  const placeholder = company({ name: 'Kiln', nameKey: 'kiln', industry: 'Coworking' });
  const coworking = company({ name: 'Kiln', nameKey: 'kiln', domainKey: 'kiln.com', industry: 'Coworking and Flexible Office Spaces' });
  const staking = company({ name: 'Kiln', nameKey: 'kiln', domainKey: 'kiln.fi', industry: 'Software Development' });

  assert.equal(isLikelySameCompany(placeholder, coworking), true);
  assert.equal(isLikelySameCompany(placeholder, staking), false);
});

test('refuses two different companies that merely share a name', () => {
  // The case the keyed identity model exists for: same name, unrelated brands.
  const staking = company({ name: 'Kiln', nameKey: 'kiln', domainKey: 'kiln.fi' });
  const studio = company({ name: 'Kiln', nameKey: 'kiln', domainKey: 'kilnstudio.co' });

  assert.equal(isLikelySameCompany(staking, studio), false);
});

test('two different LinkedIn pages veto a merge the domains would allow', () => {
  const a = company({ domainKey: 'certik.com', linkedinKey: 'certik' });
  const b = company({ domainKey: 'certik.org', linkedinKey: 'certik-labs' });

  assert.equal(isLikelySameCompany(a, b), false);
});

test('a linkedin slug and a numeric id are not a contradiction', () => {
  // The real CertiK pair: LinkedIn serves both URL shapes for one page, so
  // linkedinCompanyKey stores 'certik' for one record and 'id:11831043' for
  // the other. Reading that as two different companies vetoed a merge that
  // the matching name and brand had already established.
  const a = company({ domainKey: 'certik.org', linkedinKey: 'certik' });
  const b = company({ domainKey: 'certik.com', linkedinKey: 'id:11831043' });

  assert.equal(isLikelySameCompany(a, b), true);
});

test('two different numeric ids still veto', () => {
  const a = company({ domainKey: 'certik.org', linkedinKey: 'id:11831043' });
  const b = company({ domainKey: 'certik.com', linkedinKey: 'id:99999999' });

  assert.equal(isLikelySameCompany(a, b), false);
});

test('refuses short generic brands that collide by accident', () => {
  // isSameBrandDomain's 4-character floor: "ai.com" and "ai.io" are not evidence.
  const a = company({ name: 'AI', nameKey: 'ai', domainKey: 'ai.com' });
  const b = company({ name: 'AI', nameKey: 'ai', domainKey: 'ai.io' });

  assert.equal(isLikelySameCompany(a, b), false);
});

test('never merges across organizations or with itself', () => {
  const a = company({ _id: 'x', domainKey: 'certik.com' });

  assert.equal(isLikelySameCompany(a, { ...a }), false);
  assert.equal(isLikelySameCompany(a, company({ _id: 'y', domainKey: 'certik.org', organization: 'org-2' })), false);
});

test('leaves two keyless placeholders to the unique index', () => {
  assert.equal(isLikelySameCompany(company({ _id: 'a' }), company({ _id: 'b' })), false);
});

test('requires the names to match even when the brand does', () => {
  const a = company({ name: 'CertiK', nameKey: 'certik', domainKey: 'certik.com' });
  const b = company({ name: 'CertiK Ventures', nameKey: 'certik ventures', domainKey: 'certik.org' });

  assert.equal(isLikelySameCompany(a, b), false);
});

/* ── choosing the survivor ────────────────────────────────────────── */

test('identityStrength ranks linkedin over domain over nothing', () => {
  assert.equal(identityStrength({ linkedinKey: 'certik', domainKey: 'certik.com' }), 2);
  assert.equal(identityStrength({ domainKey: 'certik.com' }), 1);
  assert.equal(identityStrength({}), 0);
});

test('the record with the stronger identity survives', () => {
  const withLinkedin = company({ _id: 'li', linkedinKey: 'certik' });
  const withDomain = company({ _id: 'dom', domainKey: 'certik.com', industry: 'Security', size: '201-500' });

  assert.equal(pickPrimary(withDomain, withLinkedin)._id, 'li');
});

test('the record the org actually uses survives, even if thinner', () => {
  // The real CertiK pair. certik.org is older and knows its industry, but the
  // prospect is attached to certik.com — that is the record people recognize.
  const used = company({ _id: 'com', domainKey: 'certik.com', prospectCount: 1, createdAt: '2026-06-01' });
  const unused = company({
    _id: 'org', domainKey: 'certik.org', prospectCount: 0, createdAt: '2026-01-01',
    industry: 'Blockchain Security', size: '201-500', founded: '2017',
  });

  assert.equal(pickPrimary(unused, used)._id, 'com');
  assert.equal(pickPrimary(used, unused)._id, 'com');
});

test('a stronger identity still outranks prospect count', () => {
  const linked = company({ _id: 'li', linkedinKey: 'certik', prospectCount: 0 });
  const busy = company({ _id: 'dom', domainKey: 'certik.com', prospectCount: 9 });

  assert.equal(pickPrimary(busy, linked)._id, 'li');
});

test('on equal identity the richer record survives', () => {
  // The pair from the screenshot: both domain-keyed, one knows more.
  const rich = company({ _id: 'com', domainKey: 'certik.com', industry: 'Computer and Network Security', size: '201-500' });
  const thin = company({ _id: 'org', domainKey: 'certik.org', industry: 'Blockchain Security' });

  assert.equal(pickPrimary(thin, rich)._id, 'com');
  assert.equal(pickPrimary(rich, thin)._id, 'com');
});

test('on an equal tie the older record survives, keeping its _id and URL', () => {
  const older = company({ _id: 'older', domainKey: 'certik.com', createdAt: '2026-01-01' });
  const newer = company({ _id: 'newer', domainKey: 'certik.org', createdAt: '2026-06-01' });

  assert.equal(pickPrimary(newer, older)._id, 'older');
});

/* ── what the survivor ends up holding ────────────────────────────── */

test('buildMergePatch fills gaps without overwriting what the survivor knows', () => {
  const primary = company({ domainKey: 'certik.com', industry: 'Computer and Network Security', size: '' });
  const duplicate = company({ domainKey: 'certik.org', industry: 'Blockchain Security', size: '201-500', founded: '2017' });

  const patch = buildMergePatch(primary, duplicate);

  assert.equal(patch.industry, undefined, 'a known industry must not be replaced');
  assert.equal(patch.size, '201-500');
  assert.equal(patch.founded, '2017');
});

test('buildMergePatch never replaces the survivor identity key', () => {
  const primary = company({ domainKey: 'certik.com' });
  const duplicate = company({ domainKey: 'certik.org' });

  assert.equal(buildMergePatch(primary, duplicate).domainKey, undefined);
});

test('buildMergePatch adopts an identity key into a gap', () => {
  const primary = company({ domainKey: 'certik.com' });
  const duplicate = company({ linkedinKey: 'certik', linkedinUrl: 'https://www.linkedin.com/company/certik' });

  const patch = buildMergePatch(primary, duplicate);

  assert.equal(patch.linkedinKey, 'certik');
  assert.equal(patch.linkedinUrl, 'https://www.linkedin.com/company/certik');
});

test('buildMergePatch clears analyzedForKey on borrowed analysis', () => {
  const primary = company({ domainKey: 'certik.com' });
  const duplicate = company({
    domainKey: 'certik.org',
    aiAnalysis: { summary: 'Blockchain security auditor.', lastAnalyzedAt: '2026-06-01', analyzedForKey: 'certik.org' },
  });

  const patch = buildMergePatch(primary, duplicate);

  assert.equal(patch.aiAnalysis.summary, 'Blockchain security auditor.');
  // Keeping the old key would claim this text describes certik.com, which it
  // does not. Null is what makes the analyzer re-run.
  assert.equal(patch.aiAnalysis.analyzedForKey, null);
});

test('buildMergePatch keeps the survivor own analysis untouched', () => {
  const primary = company({
    domainKey: 'certik.com',
    aiAnalysis: { summary: 'Mine.', lastAnalyzedAt: '2026-07-01', analyzedForKey: 'certik.com' },
  });
  const duplicate = company({
    domainKey: 'certik.org',
    aiAnalysis: { summary: 'Theirs.', lastAnalyzedAt: '2026-08-01', analyzedForKey: 'certik.org' },
  });

  assert.equal(buildMergePatch(primary, duplicate).aiAnalysis, undefined);
});

test('buildMergePatch unions contacts and signals without duplicating them', () => {
  const primary = company({
    domainKey: 'certik.com',
    contacts: [{ type: 'email', value: 'hi@certik.com' }],
    signals: [{ name: 'hiring', detectedAt: '2026-01-01' }],
  });
  const duplicate = company({
    domainKey: 'certik.org',
    contacts: [{ type: 'email', value: 'HI@certik.com' }, { type: 'twitter', value: '@certik' }],
    signals: [{ name: 'hiring', detectedAt: '2026-02-01' }, { name: 'funding' }],
  });

  const patch = buildMergePatch(primary, duplicate);

  assert.equal(patch.contacts.length, 2, 'the same email in different case is one contact');
  assert.equal(patch.signals.length, 2);
});

test('buildMergePatch records the merge in sourceRefs', () => {
  const patch = buildMergePatch(company({ domainKey: 'certik.com' }), company({ domainKey: 'certik.org' }));

  assert.ok(patch.sourceRefs.some((r) => r.source === 'merge' && /certik\.org/.test(r.note)));
});

test('buildMergePatch keeps imported candidates from both sides', () => {
  const primary = company({
    domainKey: 'certik.com',
    prospectSearch: {
      lastRunAt: '2026-01-01',
      candidates: [{ linkedinUrl: 'https://www.linkedin.com/in/a', imported: true }],
    },
  });
  const duplicate = company({
    domainKey: 'certik.org',
    prospectSearch: {
      lastRunAt: '2026-08-01',
      candidates: [
        { linkedinUrl: 'https://www.linkedin.com/in/b', imported: true },
        { linkedinUrl: 'https://www.linkedin.com/in/c', imported: false },
      ],
    },
  });

  const urls = buildMergePatch(primary, duplicate).prospectSearch.candidates.map((c) => c.linkedinUrl);

  assert.ok(urls.includes('https://www.linkedin.com/in/a'), 'an imported pick points at a real prospect');
  assert.ok(urls.includes('https://www.linkedin.com/in/b'));
  assert.ok(urls.includes('https://www.linkedin.com/in/c'));
});

test('buildMergePatch clears needsReview once a key is present', () => {
  const placeholder = company({ needsReview: true, reviewReason: 'no-verified-identity' });
  const identified = company({ domainKey: 'certik.com' });

  const patch = buildMergePatch(placeholder, identified);

  assert.equal(patch.needsReview, false);
  assert.equal(patch.domainKey, 'certik.com');
});

/* ── helper ───────────────────────────────────────────────────────── */

test('unionBy keeps first occurrence and drops keyless items', () => {
  const out = unionBy([{ v: 'a' }, { v: 'a' }], [{ v: 'b' }, { v: '' }], (i) => i.v);

  assert.deepEqual(out.map((i) => i.v), ['a', 'b']);
});
