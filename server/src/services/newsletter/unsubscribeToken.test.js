/**
 * Unit tests for the unsubscribe token.
 *
 * The signature is the only thing preventing one recipient from unsubscribing
 * another, so tamper rejection is the point of this file. Pure: no database,
 * no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = 'test-secret-for-unsubscribe-tokens';
process.env.PUBLIC_API_URL = 'https://api.example.test';

const { sign, verify, unsubscribeUrl } = await import('./unsubscribeToken.js');

const ID = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439012';

test('a freshly signed token verifies', () => {
  assert.equal(verify(ID, sign(ID)), true);
});

test('signing is deterministic, so a link stays valid for the life of the email', () => {
  assert.equal(sign(ID), sign(ID));
});

test("one contact's signature does not unsubscribe another", () => {
  assert.equal(verify(OTHER, sign(ID)), false);
});

test('a tampered signature is rejected', () => {
  const sig = sign(ID);
  const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
  assert.equal(verify(ID, flipped), false);
});

test('a truncated signature is rejected rather than throwing', () => {
  // timingSafeEqual throws on a length mismatch — verify() must guard it.
  assert.equal(verify(ID, sign(ID).slice(0, 10)), false);
});

test('missing pieces are rejected', () => {
  assert.equal(verify(ID, ''), false);
  assert.equal(verify('', sign(ID)), false);
  assert.equal(verify(undefined, undefined), false);
});

test('different contacts get different signatures', () => {
  assert.notEqual(sign(ID), sign(OTHER));
});

test('the URL points at the API origin, not the SPA, and is self-verifying', () => {
  const url = unsubscribeUrl(ID);
  assert.equal(url.startsWith('https://api.example.test/api/newsletters/unsubscribe/'), true);

  const [contactId, sig] = url.split('/unsubscribe/')[1].split('/');
  assert.equal(contactId, ID);
  assert.equal(verify(contactId, sig), true);
});

test('the signature is URL-safe, so mail clients cannot mangle it', () => {
  assert.equal(/^[A-Za-z0-9_-]+$/.test(sign(ID)), true);
});
