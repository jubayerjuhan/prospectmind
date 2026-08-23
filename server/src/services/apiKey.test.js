import test from 'node:test';
import assert from 'node:assert/strict';
import { generateApiKey, hashApiKey, looksLikeApiKey } from './apiKey.js';

test('a key is identifiable, long, and never repeats', () => {
  const a = generateApiKey();
  const b = generateApiKey();
  assert.ok(looksLikeApiKey(a.key));
  assert.equal(a.key.length, 'pm_live_'.length + 64);
  assert.notEqual(a.key, b.key);
  assert.notEqual(a.hash, b.hash);
});

test('the stored hash does not contain the key', () => {
  // The whole point: a database dump must not be a set of live credentials.
  const { key, hash } = generateApiKey();
  assert.ok(!hash.includes(key));
  assert.ok(!hash.includes(key.slice('pm_live_'.length)));
  assert.equal(hash.length, 64);
});

test('hashing is stable, so a presented key can be looked up', () => {
  const { key, hash } = generateApiKey();
  assert.equal(hashApiKey(key), hash);
  assert.notEqual(hashApiKey(`${key}x`), hash);
});

test('last4 identifies a key without revealing it', () => {
  const { key, last4 } = generateApiKey();
  assert.equal(last4.length, 4);
  assert.ok(key.endsWith(last4));
});

test('a JWT is not mistaken for an API key', () => {
  assert.ok(!looksLikeApiKey('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def'));
  assert.ok(!looksLikeApiKey(''));
  assert.ok(!looksLikeApiKey(undefined));
});
