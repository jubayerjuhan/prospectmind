/**
 * Unit tests for the company prospect finder.
 *
 * Everything here runs offline: `callAI` is injected, and the functions under
 * test never touch Serper or Mongo. The one that matters most is the allowlist
 * check in verifyCandidates — it is the only thing stopping an invented person
 * from becoming a real prospect with a confidence score attached.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { AIFallbackRequiredError } from '../ai/claudeClient.js';
import { __prospectFinderTesting } from './prospectFinder.js';

const {
  normalizeProfileUrl, buildBrief, verifyCandidates, planQueries,
  MAX_CANDIDATES, MAX_POOL, VERIFY_MAX_TOKENS,
} = __prospectFinderTesting;

/** Tokens one verified candidate costs: name, role, URL, a sentence of why. */
const TOKENS_PER_CANDIDATE = 70;

const COMPANY = { name: 'Acme Protocol', domain: 'acme.xyz', industry: 'Web3' };

/** A callAI stub that ignores the prompt and returns whatever you give it. */
const stubAI = (response) => async () => response;

/** hits[] as gatherSearchHits would produce them — urls already normalized. */
const hit = (slug, title = 'Someone — Acme Protocol') => ({
  url: `https://www.linkedin.com/in/${slug}`,
  title,
  snippet: `${title} · Acme Protocol`,
});

/* ── normalizeProfileUrl ──────────────────────────────────────────── */

test('normalizeProfileUrl canonicalizes the shapes Google actually returns', () => {
  const expected = 'https://www.linkedin.com/in/jane-doe';

  assert.equal(normalizeProfileUrl('https://www.linkedin.com/in/jane-doe'), expected);
  assert.equal(normalizeProfileUrl('https://uk.linkedin.com/in/jane-doe'), expected);
  assert.equal(normalizeProfileUrl('https://linkedin.com/in/jane-doe'), expected);
  assert.equal(normalizeProfileUrl('http://www.linkedin.com/in/jane-doe'), expected);
  assert.equal(normalizeProfileUrl('https://www.linkedin.com/in/jane-doe/'), expected);
  assert.equal(normalizeProfileUrl('https://www.linkedin.com/in/jane-doe?trk=public'), expected);
  assert.equal(normalizeProfileUrl('https://www.linkedin.com/in/Jane-Doe'), expected);
});

test('normalizeProfileUrl rejects anything that is not a person profile', () => {
  assert.equal(normalizeProfileUrl('https://www.linkedin.com/company/acme'), '');
  assert.equal(normalizeProfileUrl('https://www.linkedin.com/jobs/view/123'), '');
  assert.equal(normalizeProfileUrl('https://acme.xyz/team'), '');
  assert.equal(normalizeProfileUrl(''), '');
  assert.equal(normalizeProfileUrl(), '');
});

test('normalizeProfileUrl collapses regional duplicates to one key', () => {
  // The whole point: the same person found by two queries must dedupe.
  assert.equal(
    normalizeProfileUrl('https://uk.linkedin.com/in/jane-doe/'),
    normalizeProfileUrl('https://www.linkedin.com/in/jane-doe?originalSubdomain=uk')
  );
});

/* ── verifyCandidates ─────────────────────────────────────────────── */

test('verifyCandidates drops a candidate whose URL was never in the results', async () => {
  const hits = [hit('real-person')];
  const callAI = stubAI({
    candidates: [
      { firstName: 'Real', lastName: 'Person', role: 'CTO', linkedinUrl: hits[0].url, matchReason: 'CTO', confidence: 0.9 },
      // Plausible, well-formed, and entirely invented.
      { firstName: 'Ghost', lastName: 'Employee', role: 'VP Eng', linkedinUrl: 'https://www.linkedin.com/in/ghost-employee', matchReason: 'VP', confidence: 0.95 },
    ],
  });

  const result = await verifyCandidates({ company: COMPANY, brief: '', hits, callAI });

  assert.equal(result.length, 1);
  assert.equal(result[0].firstName, 'Real');
});

test('verifyCandidates keeps the allowlisted URL, not the model echo', async () => {
  const hits = [hit('jane-doe')];
  const callAI = stubAI({
    candidates: [
      { firstName: 'Jane', lastName: 'Doe', role: 'CTO', linkedinUrl: 'https://UK.linkedin.com/in/Jane-Doe/', matchReason: 'CTO', confidence: 0.8 },
    ],
  });

  const result = await verifyCandidates({ company: COMPANY, brief: '', hits, callAI });

  assert.equal(result.length, 1);
  assert.equal(result[0].linkedinUrl, hits[0].url);
});

test('verifyCandidates drops nameless entries and de-duplicates by profile', async () => {
  const hits = [hit('jane-doe'), hit('john-roe')];
  const callAI = stubAI({
    candidates: [
      { firstName: 'Jane', lastName: 'Doe', linkedinUrl: hits[0].url, confidence: 0.7 },
      { firstName: '  ', lastName: 'Nameless', linkedinUrl: hits[1].url, confidence: 0.9 },
      { firstName: 'Jane', lastName: 'Doe (dupe)', linkedinUrl: hits[0].url, confidence: 0.6 },
    ],
  });

  const result = await verifyCandidates({ company: COMPANY, brief: '', hits, callAI });

  assert.equal(result.length, 1);
  assert.equal(result[0].lastName, 'Doe');
});

test('verifyCandidates clamps confidence into 0-1 and nulls junk', async () => {
  const hits = [hit('a'), hit('b'), hit('c')];
  const callAI = stubAI({
    candidates: [
      { firstName: 'Over', linkedinUrl: hits[0].url, confidence: 4.2 },
      { firstName: 'Under', linkedinUrl: hits[1].url, confidence: -1 },
      { firstName: 'Junk', linkedinUrl: hits[2].url, confidence: 'very high' },
    ],
  });

  const byName = Object.fromEntries(
    (await verifyCandidates({ company: COMPANY, brief: '', hits, callAI })).map((c) => [c.firstName, c.confidence])
  );

  assert.equal(byName.Over, 1);
  assert.equal(byName.Under, 0);
  assert.equal(byName.Junk, null);
});

test('verifyCandidates sorts by confidence and caps the batch', async () => {
  const hits = Array.from({ length: 40 }, (_, i) => hit(`person-${i}`));
  const callAI = stubAI({
    candidates: hits.map((h, i) => ({
      firstName: `P${i}`,
      linkedinUrl: h.url,
      confidence: i / 100, // ascending, so the cap must not just take the first N
    })),
  });

  const result = await verifyCandidates({ company: COMPANY, brief: '', hits, callAI });

  assert.equal(result.length, 25);
  assert.equal(result[0].firstName, 'P39');
  assert.ok(result[0].confidence >= result.at(-1).confidence);
});

test('verifyCandidates treats a malformed response as no candidates', async () => {
  const hits = [hit('jane-doe')];

  assert.deepEqual(await verifyCandidates({ company: COMPANY, brief: '', hits, callAI: stubAI({}) }), []);
  assert.deepEqual(await verifyCandidates({ company: COMPANY, brief: '', hits, callAI: stubAI(null) }), []);
  assert.deepEqual(
    await verifyCandidates({ company: COMPANY, brief: '', hits, callAI: stubAI({ candidates: 'nope' }) }),
    []
  );
});

test('verifyCandidates asks for a budget that fits the batch it allows', async () => {
  const hits = [hit('jane-doe')];
  let seen;
  const callAI = async (opts) => {
    seen = opts;
    return { candidates: [] };
  };

  await verifyCandidates({ company: COMPANY, brief: '', hits, callAI });

  // A cap below what MAX_CANDIDATES answers cost truncates the JSON mid-object
  // and fails a run the user already paid four searches for. Derived from the
  // constant so raising the keep-count cannot quietly outgrow the budget.
  const needed = MAX_CANDIDATES * TOKENS_PER_CANDIDATE;
  assert.ok(seen.maxTokens >= needed, `maxTokens ${seen.maxTokens} is too small for ${MAX_CANDIDATES} candidates`);
  assert.equal(seen.jsonMode, true);
});

test('the pool cap is a real bound, not one the search can never reach', () => {
  // MAX_POOL used to be written as MAX_CANDIDATES * 2, which sat above the
  // search's own ceiling and so never applied — until someone widened the
  // search, at which point an output constant would have started bounding the
  // input. Keeping it independent is the point; this pins that it stays so.
  assert.equal(typeof MAX_POOL, 'number');
  assert.ok(MAX_POOL >= MAX_CANDIDATES, 'the pool must be able to feed a full batch of candidates');
  assert.ok(VERIFY_MAX_TOKENS >= MAX_CANDIDATES * TOKENS_PER_CANDIDATE);
});

/* ── planQueries ──────────────────────────────────────────────────── */

test('planQueries returns the planned queries, capped', async () => {
  const callAI = stubAI({ queries: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] });

  const queries = await planQueries(COMPANY, 'brief', callAI);

  assert.equal(queries.length, 4);
  assert.equal(queries[0], 'q1');
});

test('planQueries discards non-string and blank entries', async () => {
  const callAI = stubAI({ queries: ['  good  ', '', '   ', null, 42, { q: 'x' }] });

  assert.deepEqual(await planQueries(COMPANY, 'brief', callAI), ['good']);
});

test('planQueries falls back to a plain company search when AI is unavailable', async () => {
  const callAI = async () => {
    throw new AIFallbackRequiredError('no provider');
  };

  const queries = await planQueries(COMPANY, 'brief', callAI);

  assert.deepEqual(queries, ['site:linkedin.com/in "Acme Protocol"']);
});

test('planQueries falls back when the model returns nothing usable', async () => {
  assert.deepEqual(await planQueries(COMPANY, 'brief', stubAI({ queries: [] })), [
    'site:linkedin.com/in "Acme Protocol"',
  ]);
  assert.deepEqual(await planQueries(COMPANY, 'brief', stubAI({})), ['site:linkedin.com/in "Acme Protocol"']);
});

test('planQueries rethrows errors that are not an AI outage', async () => {
  const callAI = async () => {
    throw new Error('serper exploded');
  };

  await assert.rejects(() => planQueries(COMPANY, 'brief', callAI), /serper exploded/);
});

/* ── buildBrief ───────────────────────────────────────────────────── */

test('buildBrief always carries the playbook and omits an empty persona block', () => {
  const brief = buildBrief({ playbook: { name: 'Sell GoodHive', prompt: 'Reach hiring decision-makers.' } });

  assert.match(brief, /PLAYBOOK: Sell GoodHive/);
  assert.match(brief, /Reach hiring decision-makers\./);
  assert.doesNotMatch(brief, /TARGET PERSONAS/);
});

test('buildBrief appends every selected persona', () => {
  const brief = buildBrief({
    playbook: { name: 'PB', prompt: 'why' },
    personas: [
      { name: 'Technical Founder', prompt: 'founders who still ship' },
      { name: 'Head of Talent', prompt: 'owns hiring budget' },
    ],
  });

  assert.match(brief, /TARGET PERSONAS/);
  assert.match(brief, /Technical Founder/);
  assert.match(brief, /Head of Talent/);
  assert.match(brief, /owns hiring budget/);
});
