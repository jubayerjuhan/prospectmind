/**
 * Unit tests for the Gemini multi-key rotation logic.
 *
 * AI Studio's free tier caps requests PER DAY, PER MODEL, PER PROJECT — a key
 * is tied to one project, so the cap belongs to the project, not to "Gemini
 * access" generally. GEMINI_API_KEYS (comma-separated) lets multiple
 * projects' allowances be used as one pool. The two functions tested here —
 * parsing that list and telling a dead-for-today key apart from a merely
 * transient failure — are the part of that rotation most likely to silently
 * misbehave, so they're pulled out and tested without touching the network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables } from './geminiClient.js';

const { resolveApiKeys, isQuotaExhausted } = __testables;

// process.env stringifies everything it's assigned — Object.assign(process.env,
// { X: undefined }) sets the literal string "undefined", not an absent var, so
// unsetting has to go through `delete` explicitly.
const withEnv = (vars, fn) => {
  const saved = {};
  for (const key of Object.keys(vars)) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
};

// ── resolveApiKeys ───────────────────────────────────────────────────────────

test('GEMINI_API_KEYS splits on commas', () => {
  withEnv({ GEMINI_API_KEYS: 'key-one,key-two,key-three', GEMINI_API_KEY: undefined }, () => {
    assert.deepEqual(resolveApiKeys(), ['key-one', 'key-two', 'key-three']);
  });
});

test('whitespace around each key in GEMINI_API_KEYS is trimmed', () => {
  withEnv({ GEMINI_API_KEYS: ' key-one , key-two ,key-three ', GEMINI_API_KEY: undefined }, () => {
    assert.deepEqual(resolveApiKeys(), ['key-one', 'key-two', 'key-three']);
  });
});

test('an empty entry from a trailing comma is dropped, not kept as an empty key', () => {
  withEnv({ GEMINI_API_KEYS: 'key-one,key-two,', GEMINI_API_KEY: undefined }, () => {
    assert.deepEqual(resolveApiKeys(), ['key-one', 'key-two']);
  });
});

test('falls back to the singular GEMINI_API_KEY when GEMINI_API_KEYS is unset', () => {
  withEnv({ GEMINI_API_KEYS: undefined, GEMINI_API_KEY: 'only-key' }, () => {
    assert.deepEqual(resolveApiKeys(), ['only-key']);
  });
});

test('GEMINI_API_KEYS takes priority over GEMINI_API_KEY when both are set', () => {
  withEnv({ GEMINI_API_KEYS: 'key-a,key-b', GEMINI_API_KEY: 'old-single-key' }, () => {
    assert.deepEqual(resolveApiKeys(), ['key-a', 'key-b']);
  });
});

test('neither var set returns an empty list rather than throwing', () => {
  withEnv({ GEMINI_API_KEYS: undefined, GEMINI_API_KEY: undefined }, () => {
    assert.deepEqual(resolveApiKeys(), []);
  });
});

// ── isQuotaExhausted ─────────────────────────────────────────────────────────
// The real error a free-tier AI Studio key returns once its daily allowance
// for a model is used up.

test('the real RESOURCE_EXHAUSTED free-tier error is recognized as quota exhaustion', () => {
  const error = new Error(
    'You exceeded your current quota, please check your plan and billing details. ' +
    '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, ' +
    'limit: 20, model: gemini-2.5-flash-lite'
  );
  error.status = 'RESOURCE_EXHAUSTED';
  assert.equal(isQuotaExhausted(error), true);
});

test('a status field of RESOURCE_EXHAUSTED alone is enough, regardless of message wording', () => {
  const error = new Error('something else entirely');
  error.status = 'RESOURCE_EXHAUSTED';
  assert.equal(isQuotaExhausted(error), true);
});

test('the message text alone is enough when status is not set', () => {
  const error = new Error('RESOURCE_EXHAUSTED: quota exceeded');
  assert.equal(isQuotaExhausted(error), true);
});

test('a plain transient 503 is NOT treated as quota exhaustion — it should still retry the same key', () => {
  const error = new Error('This model is currently experiencing high demand. Please try again later.');
  error.status = 503;
  assert.equal(isQuotaExhausted(error), false);
});

test('a network/timeout error is not mistaken for quota exhaustion', () => {
  const error = new Error('[gemini] gemini-2.5-flash timed out after 120000ms');
  assert.equal(isQuotaExhausted(error), false);
});

test('an error-like object with no message property does not throw', () => {
  assert.doesNotThrow(() => isQuotaExhausted({ status: 500 }));
});

test('undefined does not throw', () => {
  assert.doesNotThrow(() => isQuotaExhausted(undefined));
});
