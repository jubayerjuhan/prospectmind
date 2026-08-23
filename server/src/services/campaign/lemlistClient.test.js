/**
 * Unit tests for the lemlist HTTP client.
 *
 * Two things here are safety-critical rather than cosmetic: the delete call can
 * silently unsubscribe a real prospect if a query param goes missing, and the
 * rate limiter is what stands between a 500-lead push and a 429 storm. Pure:
 * fetch and sleep are injected, no network and no real waiting.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createLemlistClient, LemlistError } from './lemlistClient.js';

const res = (status, body = {}, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/**
 * Queues responses; records requests and sleeps. Time is virtual: a sleep
 * advances the clock, so pacing behaves as it would in production instead of
 * compounding into ever-longer waits.
 */
const harness = (responses) => {
  const requests = [];
  const sleeps = [];
  const queue = [...responses];
  let clock = 1_000_000;
  const fetchImpl = async (url, options) => {
    requests.push({ url, ...options });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next ?? res(200, {});
  };
  const sleep = async (ms) => { sleeps.push(ms); clock += ms; };
  return { requests, sleeps, fetchImpl, sleep, now: () => clock };
};

const client = (h) =>
  createLemlistClient('test-key', { fetchImpl: h.fetchImpl, sleep: h.sleep, now: h.now });

// ── The guardrail ──────────────────────────────────────────────────────────

test('removeLead always sends action=remove', async () => {
  // Without it lemlist UNSUBSCRIBES the lead: 200, lead still present, address
  // written to the team-wide suppression list. Unrecoverable at scale.
  const h = harness([res(200, { ok: true })]);
  await client(h).removeLead('cam_1', 'lea_1');
  assert.match(h.requests[0].url, /\?action=remove$/);
  assert.equal(h.requests[0].method, 'DELETE');
});

test('a lead id with url-unsafe characters is encoded, keeping action=remove intact', async () => {
  const h = harness([res(200, {})]);
  await client(h).removeLead('cam_1', 'a+b@example.com');
  assert.match(h.requests[0].url, /a%2Bb%40example\.com\?action=remove$/);
});

// ── Auth ───────────────────────────────────────────────────────────────────

test('authenticates with basic auth, empty username, key as password', async () => {
  const h = harness([res(200, {})]);
  await client(h).getCampaign('cam_1');
  const expected = 'Basic ' + Buffer.from(':test-key').toString('base64');
  assert.equal(h.requests[0].headers.Authorization, expected);
});

test('a missing api key fails loudly at construction, not mid-push', async () => {
  assert.throws(() => createLemlistClient(''), LemlistError);
  assert.throws(() => createLemlistClient(undefined), /No lemlist API key/);
});

// ── Rate limiting ──────────────────────────────────────────────────────────

test('paces successive requests instead of firing them back to back', async () => {
  const h = harness([res(200, {}), res(200, {}), res(200, {})]);
  const c = client(h);
  await c.getCampaign('a');
  await c.getCampaign('b');
  await c.getCampaign('c');
  // The first request goes immediately; each later one waits exactly one slot,
  // which is what keeps a 500-lead push under 20 requests per 2 seconds.
  const waits = h.sleeps.filter((ms) => ms > 0);
  assert.deepEqual(waits, [120, 120]);
});

test('a 429 is retried after the Retry-After the server asked for', async () => {
  const h = harness([res(429, { error: 'slow down' }, { 'Retry-After': '3' }), res(200, { ok: true })]);
  const out = await client(h).getCampaign('cam_1');
  assert.deepEqual(out, { ok: true });
  assert.ok(h.sleeps.includes(3000), `expected a 3000ms wait, got ${JSON.stringify(h.sleeps)}`);
});

test('a 429 without Retry-After still backs off rather than hammering', async () => {
  const h = harness([res(429, {}), res(200, {})]);
  await client(h).getCampaign('cam_1');
  assert.ok(h.sleeps.includes(2000));
});

test('a persistent 429 eventually throws with its status attached', async () => {
  const h = harness([res(429, {}), res(429, {}), res(429, {}), res(429, {})]);
  await assert.rejects(() => client(h).getCampaign('cam_1'), (e) => e.status === 429);
});

// ── Retries ────────────────────────────────────────────────────────────────

test('a 500 is retried', async () => {
  const h = harness([res(500, { error: 'oops' }), res(200, { ok: true })]);
  assert.deepEqual(await client(h).getCampaign('cam_1'), { ok: true });
  assert.equal(h.requests.length, 2);
});

test('a 400 is NOT retried — repeating our own mistake just wastes the budget', async () => {
  const h = harness([res(400, { error: 'Bad params' })]);
  await assert.rejects(() => client(h).addLead('cam_1', {}), (e) => e.status === 400);
  assert.equal(h.requests.length, 1);
});

test('a 404 is not retried either', async () => {
  const h = harness([res(404, { error: 'not found' })]);
  await assert.rejects(() => client(h).getCampaign('nope'), (e) => e.status === 404);
  assert.equal(h.requests.length, 1);
});

test('a dropped connection is retried', async () => {
  const h = harness([new Error('ECONNRESET'), res(200, { ok: true })]);
  assert.deepEqual(await client(h).getCampaign('cam_1'), { ok: true });
  assert.equal(h.requests.length, 2);
});

test('a persistent network failure throws a LemlistError, not a raw fetch error', async () => {
  const h = harness([new Error('ECONNRESET'), new Error('ECONNRESET'), new Error('ECONNRESET'), new Error('ECONNRESET')]);
  await assert.rejects(() => client(h).getCampaign('cam_1'), LemlistError);
});

// ── Payloads ───────────────────────────────────────────────────────────────

test('createCampaign posts to /campaigns with a json body', async () => {
  const h = harness([res(200, { _id: 'cam_1', sequenceId: 'seq_1' })]);
  await client(h).createCampaign({ name: 'X', autoReview: false });
  assert.match(h.requests[0].url, /\/api\/campaigns$/);
  assert.equal(h.requests[0].method, 'POST');
  assert.deepEqual(JSON.parse(h.requests[0].body), { name: 'X', autoReview: false });
});

test('addStep targets the sequence, not the campaign', async () => {
  const h = harness([res(200, { _id: 'stp_1' })]);
  await client(h).addStep('seq_9', { type: 'email', subject: 's', message: 'm' });
  assert.match(h.requests[0].url, /\/api\/sequences\/seq_9\/steps$/);
});

test('addLead posts to the campaign lead collection', async () => {
  const h = harness([res(200, { _id: 'lea_1' })]);
  await client(h).addLead('cam_7', { email: 'a@example.com' });
  assert.match(h.requests[0].url, /\/api\/campaigns\/cam_7\/leads\/$/);
});

test('a GET sends no body', async () => {
  const h = harness([res(200, {})]);
  await client(h).getSequences('cam_1');
  assert.equal(h.requests[0].body, undefined);
});

test('an empty response body does not crash the parser', async () => {
  const h = harness([res(200, '')]);
  assert.equal(await client(h).getCampaign('cam_1'), null);
});

test('a non-json error body is still surfaced in the message', async () => {
  const h = harness([res(400, '<html>nope</html>')]);
  await assert.rejects(() => client(h).getCampaign('cam_1'), /nope/);
});
