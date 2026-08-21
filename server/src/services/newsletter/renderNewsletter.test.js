/**
 * Unit tests for newsletter rendering.
 *
 * These matter more than most: this module is the only thing standing between
 * an uploaded CSV — arbitrary text from outside the system — and the HTML of an
 * email sent to a third party. A miss here is an injection into someone else's
 * inbox, not a rendering glitch.
 *
 * Everything here is pure: no database, no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeBody,
  renderMergeTags,
  escapeHtml,
  buildTextFromHtml,
  findMergeTagInUrl,
  renderForContact,
} from './renderNewsletter.js';

const contact = (overrides = {}) => ({
  _id: '507f1f77bcf86cd799439011',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines',
  ...overrides,
});

/* ── the sanitizer ────────────────────────────────────────────────────────── */

test('drops script tags and their contents entirely', () => {
  const out = sanitizeBody('<p>hi</p><script>alert(1)</script>');
  assert.equal(out.includes('script'), false);
  assert.equal(out.includes('alert'), false);
  assert.equal(out.includes('<p>hi</p>'), true);
});

test('strips event handlers but keeps the element', () => {
  const out = sanitizeBody('<img src="https://x.test/a.png" onerror="alert(1)">');
  assert.equal(out.includes('onerror'), false);
  assert.equal(out.includes('https://x.test/a.png'), true);
});

test('rejects javascript: and data: URLs', () => {
  assert.equal(sanitizeBody('<a href="javascript:alert(1)">x</a>').includes('javascript:'), false);
  assert.equal(sanitizeBody('<img src="data:image/png;base64,AAAA">').includes('data:'), false);
});

test('keeps the formatting the editor actually emits', () => {
  const html = '<h2>Title</h2><p><strong>bold</strong> <em>italic</em></p><ul><li>one</li></ul>';
  const out = sanitizeBody(html);
  for (const tag of ['<h2>', '<strong>', '<em>', '<ul>', '<li>']) {
    assert.equal(out.includes(tag), true, `expected ${tag} to survive`);
  }
});

test('forces target and rel onto links', () => {
  const out = sanitizeBody('<a href="https://x.test">x</a>');
  assert.equal(out.includes('target="_blank"'), true);
  assert.equal(out.includes('rel="noopener noreferrer"'), true);
});

/* ── merge tags ───────────────────────────────────────────────────────────── */

test('substitutes the known tags', () => {
  const out = renderMergeTags('Hi {{firstName}} at {{company}}', contact());
  assert.equal(out, 'Hi Ada at Analytical Engines');
});

test('a hostile contact name cannot inject markup', () => {
  const out = renderMergeTags('Hi {{firstName}}', contact({ firstName: '<img src=x onerror=alert(1)>' }));
  assert.equal(out.includes('<img'), false);
  assert.equal(out.includes('&lt;img'), true);
});

test('an ampersand in a real name survives as text, not an entity bug', () => {
  const out = renderMergeTags('{{company}}', contact({ company: 'Marks & Spencer' }));
  assert.equal(out, 'Marks &amp; Spencer');
});

test('empty values fall back rather than leaving "Hi ,"', () => {
  assert.equal(renderMergeTags('Hi {{firstName}},', contact({ firstName: '' })), 'Hi there,');
  assert.equal(renderMergeTags('at {{company}}', contact({ company: '' })), 'at ');
});

test('an inline fallback beats the default', () => {
  const out = renderMergeTags('Hi {{firstName|friend}},', contact({ firstName: '' }));
  assert.equal(out, 'Hi friend,');
});

test('an unknown tag renders empty rather than leaking the placeholder', () => {
  assert.equal(renderMergeTags('x{{nope}}y', contact()), 'xy');
});

test('fullName is composed, and degrades when there is no last name', () => {
  assert.equal(renderMergeTags('{{fullName}}', contact()), 'Ada Lovelace');
  assert.equal(renderMergeTags('{{fullName}}', contact({ lastName: '' })), 'Ada');
});

test('escape:false leaves text-part values alone', () => {
  const out = renderMergeTags('{{company}}', contact({ company: 'A & B' }), { escape: false });
  assert.equal(out, 'A & B');
});

/* ── merge tags in URLs are refused, not escaped ──────────────────────────── */

test('flags a merge tag inside href or src', () => {
  assert.equal(findMergeTagInUrl('<a href="https://x.test/{{email}}">x</a>'), 'href');
  assert.equal(findMergeTagInUrl('<img src="https://x.test/{{email}}.png">'), 'src');
});

test('does not flag a merge tag in ordinary body text', () => {
  assert.equal(findMergeTagInUrl('<p>Hi {{firstName}}</p><a href="https://x.test">x</a>'), null);
});

/* ── plain text ───────────────────────────────────────────────────────────── */

test('keeps link destinations, which are invisible once tags are stripped', () => {
  const out = buildTextFromHtml('<p>See <a href="https://x.test/a">our post</a>.</p>');
  assert.equal(out.includes('our post (https://x.test/a)'), true);
});

test('renders list items as dashes and drops all markup', () => {
  const out = buildTextFromHtml('<ul><li>one</li><li>two</li></ul>');
  assert.equal(out.includes('- one'), true);
  assert.equal(out.includes('- two'), true);
  assert.equal(out.includes('<'), false);
});

test('decodes entities and collapses runaway blank lines', () => {
  const out = buildTextFromHtml('<p>a &amp; b</p><p></p><p></p><p>c</p>');
  assert.equal(out.includes('a & b'), true);
  assert.equal(/\n{3,}/.test(out), false);
});

/* ── the whole render ─────────────────────────────────────────────────────── */

test('renderForContact produces a complete, merged, unsubscribable email', () => {
  const campaign = { subject: 'Hello {{firstName}}', bodyHtml: '<p>Hi {{firstName}}</p>' };
  const { subject, html, text } = renderForContact(campaign, contact(), { orgName: 'Acme' });

  assert.equal(subject, 'Hello Ada');
  assert.equal(html.includes('Hi Ada'), true);
  assert.equal(html.includes('/api/newsletters/unsubscribe/'), true);
  assert.equal(html.includes('Acme'), true);
  assert.equal(text.includes('Unsubscribe: '), true);
});

test('a newline in a merged subject is stripped, not passed to the mail headers', () => {
  // A CSV company field containing CRLF is enough to attempt header injection.
  const campaign = { subject: 'News from {{company}}', bodyHtml: '<p>x</p>' };
  const { subject } = renderForContact(campaign, contact({ company: 'Acme\r\nBcc: evil@x.test' }), {});

  assert.equal(/[\r\n]/.test(subject), false);
  assert.equal(subject, 'News from Acme Bcc: evil@x.test');
});

test('a script in the stored body never reaches the rendered email', () => {
  const campaign = { subject: 's', bodyHtml: '<p>hi</p><script>alert(1)</script>' };
  const { html } = renderForContact(campaign, contact(), {});
  assert.equal(html.includes('alert(1)'), false);
});
