/**
 * Unit tests for the lemlist push planner.
 *
 * One ProspectMind campaign becomes ONE lemlist campaign, where each touch can
 * fan out into multiple lemlist steps — one per distinct channel any lead
 * actually resolved to at that touch, so a LinkedIn-only prospect and an
 * email-only prospect are BOTH reached from the same campaign, and a
 * dual-reachable prospect gets both (explicit product choice — see
 * plan-overview.md). Pure: no database, no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPushPlan } from './lemlistPush.js';

const LIST = {
  name: 'GoodHive Demo',
  sequence: [
    { stepOrder: 1, channel: 'email', delayDays: 0 },
    { stepOrder: 2, channel: 'email', delayDays: 3 },
  ],
};

/** A lead in the shape buildOutreachLeads() emits, resolved to email throughout. */
const emailLead = (over = {}) => ({
  prospectId: 'p1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  linkedinUrl: '',
  xUrl: '',
  telegramHandle: '',
  status: 'generated',
  skipReason: '',
  messages: [
    { stepOrder: 1, channel: 'email', delayDays: 0, subject: 'Hi', body: 'Body one' },
    { stepOrder: 2, channel: 'email', delayDays: 3, subject: 'Re: Hi', body: 'Body two' },
  ],
  step1Channel: 'email', step1Subject: 'Hi', step1Message: 'Body one', step1DelayDays: 0,
  step2Channel: 'email', step2Subject: 'Re: Hi', step2Message: 'Body two', step2DelayDays: 3,
  ...over,
});

/** A lead resolved to LinkedIn throughout — no email on file. */
const linkedinLead = (over = {}) =>
  emailLead({
    prospectId: 'p2',
    firstName: 'Mickey',
    lastName: 'Marsden',
    email: '',
    linkedinUrl: 'https://linkedin.com/in/mickey',
    messages: [
      { stepOrder: 1, channel: 'linkedin', delayDays: 0, body: 'Hi Mickey' },
      { stepOrder: 2, channel: 'linkedin', delayDays: 3, body: 'Following up' },
    ],
    step1Channel: 'linkedin', step1Subject: '', step1Message: 'Hi Mickey',
    step2Channel: 'linkedin', step2Subject: '', step2Message: 'Following up',
    ...over,
  });

/** A lead with BOTH an email and a LinkedIn URL on file. */
const dualLead = (over = {}) =>
  emailLead({
    prospectId: 'p3',
    firstName: 'Grace',
    lastName: 'Hopper',
    linkedinUrl: 'https://linkedin.com/in/grace',
    ...over,
  });

// ── One campaign, always ──────────────────────────────────────────────────

test('every pushable lead lands in exactly one campaign', () => {
  const plan = buildPushPlan(LIST, [emailLead(), linkedinLead(), emailLead({ prospectId: 'p9' })]);
  assert.equal(plan.campaigns.length, 1);
  assert.equal(plan.campaigns[0].leads.length, 3);
});

test('the campaign is named after the list', () => {
  const plan = buildPushPlan(LIST, [emailLead()]);
  assert.equal(plan.campaigns[0].name, 'GoodHive Demo');
});

test('a name longer than 140 chars is truncated rather than rejected', () => {
  const longName = 'x'.repeat(200);
  const plan = buildPushPlan({ ...LIST, name: longName }, [emailLead()]);
  assert.equal(plan.campaigns[0].name.length, 140);
});

test('an empty list plans nothing rather than throwing', () => {
  const plan = buildPushPlan(LIST, []);
  assert.deepEqual(plan.campaigns, []);
  assert.equal(plan.totals.leads, 0);
});

// ── Steps fan out per channel actually present at each touch ───────────────

test('a touch where every lead resolved to email gets exactly one email step', () => {
  const plan = buildPushPlan(LIST, [emailLead(), emailLead({ prospectId: 'p9' })]);
  assert.equal(plan.campaigns[0].steps.length, 2); // 2 touches, 1 channel each
  assert.equal(plan.campaigns[0].steps[0].type, 'email');
});

test('a touch with both email-only and LinkedIn-only leads gets BOTH an email and a LinkedIn step', () => {
  const plan = buildPushPlan(LIST, [emailLead(), linkedinLead()]);
  const touch1Steps = plan.campaigns[0].steps.filter((s) => s.message?.includes('step1'));
  const types = touch1Steps.map((s) => s.type).sort();
  assert.deepEqual(types, ['email', 'linkedinSend']);
});

test('email steps carry subject and HTML message templates', () => {
  const plan = buildPushPlan(LIST, [emailLead()]);
  const [step1] = plan.campaigns[0].steps;
  assert.equal(step1.subject, '{{step1Subject}}');
  assert.equal(step1.message, '<p>{{step1Message}}</p>');
});

test('a linkedin step references the plain-text variable, not the HTML one, and has no subject', () => {
  const plan = buildPushPlan(LIST, [linkedinLead()]);
  const [step1] = plan.campaigns[0].steps;
  assert.equal(step1.type, 'linkedinSend');
  assert.equal(step1.message, '{{step1MessageText}}');
  assert.ok(!('subject' in step1));
});

test('x and telegram become manual tasks referencing the plain-text variable', () => {
  const xLead = emailLead({
    prospectId: 'p4', email: '', xUrl: 'https://x.com/ada',
    messages: [{ stepOrder: 1, channel: 'x', body: 'hi on X' }],
    step1Channel: 'x', step1Subject: '', step1Message: 'hi on X',
  });
  const list = { name: 'X', sequence: [{ stepOrder: 1, channel: 'email', delayDays: 0 }] };
  const [step1] = buildPushPlan(list, [xLead]).campaigns[0].steps;
  assert.equal(step1.type, 'manual');
  assert.match(step1.title, /^Send X message/);
  assert.equal(step1.message, '{{step1MessageText}}');
});

test('an unconfigured campaign falls back to the one-touch default sequence', () => {
  const plan = buildPushPlan({ name: 'X', sequence: [] }, [emailLead()]);
  assert.equal(plan.campaigns[0].steps.length, 1);
});

// ── Delay: first sub-step of a touch carries it, later sub-steps fire same-day ─

test('a single-channel touch carries the configured delay', () => {
  const plan = buildPushPlan(LIST, [emailLead()]);
  assert.deepEqual(plan.campaigns[0].steps.map((s) => s.delay), [0, 3]);
});

test('a fanned-out touch: only the FIRST sub-step carries the delay, the rest fire same-day', () => {
  const plan = buildPushPlan(LIST, [emailLead(), linkedinLead()]);
  // touch 1 (delay 0) -> 2 sub-steps: email(delay 0), linkedin(delay 0)
  // touch 2 (delay 3) -> 2 sub-steps: email(delay 3), linkedin(delay 0)
  assert.deepEqual(plan.campaigns[0].steps.map((s) => s.delay), [0, 0, 3, 0]);
});

test('sub-steps at one touch are ordered email, linkedin, x, telegram — deterministic across runs', () => {
  const xLead = emailLead({
    prospectId: 'p5', email: '', linkedinUrl: '', xUrl: 'https://x.com/a',
    messages: [{ stepOrder: 1, channel: 'x', body: 'hi' }],
    step1Channel: 'x', step1Subject: '', step1Message: 'hi',
  });
  const list = { name: 'X', sequence: [{ stepOrder: 1, channel: 'email', delayDays: 0 }] };
  const linkedinOnly = linkedinLead({
    messages: [{ stepOrder: 1, channel: 'linkedin', body: 'hi' }],
    step1Channel: 'linkedin', step1Message: 'hi',
  });
  const plan = buildPushPlan(list, [linkedinOnly, xLead, emailLead()]);
  assert.deepEqual(plan.campaigns[0].steps.map((s) => s.type), ['email', 'linkedinSend', 'manual']);
});

// ── Reachability ────────────────────────────────────────────────────────────

test('a lead with none of the resolved channels is refused', () => {
  const plan = buildPushPlan(LIST, [emailLead({ prospectId: 'dead', email: '' })]);
  assert.equal(plan.totals.pushable, 0);
  assert.match(plan.skipped[0].reason, /Not reachable on any configured channel/);
});

test('a LinkedIn-only lead is pushed even though the configured sequence says "email"', () => {
  // This is the whole point of the redesign: the campaign's configured
  // channel is advisory, not authoritative — reachability is real.
  const plan = buildPushPlan(LIST, [linkedinLead()]);
  assert.equal(plan.totals.pushable, 1);
  assert.equal(plan.skipped.length, 0);
});

test('a lead skipped during generation is reported, not pushed', () => {
  const plan = buildPushPlan(LIST, [
    emailLead({ prospectId: 'p6', status: 'skipped', skipReason: 'Pipeline not ready (paused).' }),
  ]);
  assert.equal(plan.campaigns.length, 0);
  assert.equal(plan.skipped[0].reason, 'Pipeline not ready (paused).');
});

test('a lead with no generated messages is refused', () => {
  const plan = buildPushPlan(LIST, [emailLead({ prospectId: 'p7', messages: [] })]);
  assert.match(plan.skipped[0].reason, /No generated messages/);
});

test('one unreachable lead does not sink the rest', () => {
  const plan = buildPushPlan(LIST, [emailLead(), emailLead({ prospectId: 'bad', email: '' }), emailLead({ prospectId: 'ok2' })]);
  assert.equal(plan.totals.pushable, 2);
  assert.equal(plan.totals.skipped, 1);
});

// ── Dual-reachable: both steps fire ─────────────────────────────────────────

test('a dual-reachable lead is pushed once, with variables for every channel it might receive', () => {
  const plan = buildPushPlan(LIST, [dualLead()]);
  assert.equal(plan.campaigns[0].leads.length, 1); // one lead entry, not two
});

test('a dual-reachable lead carries both the HTML and plain-text encoding of its message', () => {
  // Whichever steps exist at a touch, the lead carries the variables either
  // could need — a lemlist step only fires if the lead also has the contact
  // field it requires, so an unused encoding is harmless.
  const [body] = buildPushPlan(LIST, [dualLead()]).campaigns[0].leads;
  assert.equal(body.step1Message, 'Body one');       // HTML-safe encoding (no special chars here)
  assert.equal(body.step1MessageText, 'Body one');   // plain encoding
});

test('when both an email-only and a LinkedIn-only lead exist, a dual-reachable lead can satisfy both steps', () => {
  const plan = buildPushPlan(LIST, [emailLead(), linkedinLead(), dualLead()]);
  assert.equal(plan.totals.pushable, 3);
  const touch1Steps = plan.campaigns[0].steps.filter((s) => s.message?.includes('step1'));
  assert.equal(touch1Steps.length, 2); // email + linkedin, built once for the whole campaign
});

// ── Message formatting ───────────────────────────────────────────────────────
// A real lemlist send showed "Hi Jubayer,I was impressed…" — the paragraph
// break in the generated copy ("Hi Jubayer,\n\nI was impressed…") vanished
// instead of becoming a line break, because lemlist substitutes {{step1Message}}
// as a literal string into `<p>{{step1Message}}</p>` with no newline handling
// of its own. These tests reproduce that exact case.

test('a blank-line paragraph break becomes a real HTML paragraph break in the email variable', () => {
  const raw = "Hi Jubayer,\n\nI was impressed to see your work.\n\nBest,\n[Your Name]";
  const [body] = buildPushPlan(LIST, [emailLead({ step1Message: raw })]).campaigns[0].leads;
  assert.equal(body.step1Message, 'Hi Jubayer,</p><p>I was impressed to see your work.</p><p>Best,<br>[Your Name]');
});

test('the fixed bug: the exact real-world text no longer collapses into one run-together line', () => {
  const raw = "Hi Jubayer,\n\nI was impressed to see your work as a Founding Engineer at GoodHive.";
  const [body] = buildPushPlan(LIST, [emailLead({ step1Message: raw })]).campaigns[0].leads;
  assert.ok(!body.step1Message.includes('Jubayer,I was'), 'the paragraph break must not vanish');
  assert.ok(body.step1Message.includes('</p><p>'), 'it must become a real paragraph break instead');
});

test('a single newline within one paragraph becomes a <br> in the email variable', () => {
  const raw = 'Line one\nLine two';
  const [body] = buildPushPlan(LIST, [emailLead({ step1Message: raw })]).campaigns[0].leads;
  assert.equal(body.step1Message, 'Line one<br>Line two');
});

test('HTML-special characters are escaped in the email variable', () => {
  const raw = 'Q&A: is x < y > z a valid check?';
  const [body] = buildPushPlan(LIST, [emailLead({ step1Message: raw })]).campaigns[0].leads;
  assert.equal(body.step1Message, 'Q&amp;A: is x &lt; y &gt; z a valid check?');
});

test('the plain-text variable keeps raw newlines — a LinkedIn/manual field is not HTML', () => {
  const raw = 'Hi Ada,\n\nLoved your talk.';
  const [body] = buildPushPlan(LIST, [emailLead({ step1Message: raw })]).campaigns[0].leads;
  assert.equal(body.step1MessageText, raw, 'the plain-text encoding must not be HTML-formatted');
});

test('the plain-text variable does not HTML-escape ampersands or angle brackets', () => {
  const raw = 'R&D at <Acme>';
  const [body] = buildPushPlan(LIST, [emailLead({ step1Message: raw })]).campaigns[0].leads;
  assert.equal(body.step1MessageText, raw);
});

test('subjects are left untouched — a subject line is not HTML-rendered', () => {
  const [body] = buildPushPlan(LIST, [emailLead({ step1Subject: 'A & B <question>' })]).campaigns[0].leads;
  assert.equal(body.step1Subject, 'A & B <question>');
});

// ── Lead bodies ────────────────────────────────────────────────────────────

test('empty values are dropped so a blank never renders as invisible text', () => {
  const [body] = buildPushPlan(LIST, [emailLead({ xUrl: '', telegramHandle: '' })]).campaigns[0].leads;
  assert.ok(!('xUrl' in body));
  assert.ok(!('telegramHandle' in body));
});

test('internal bookkeeping never becomes a lemlist custom variable', () => {
  const [body] = buildPushPlan(LIST, [emailLead()]).campaigns[0].leads;
  for (const key of ['messages', 'status', 'skipReason', 'prospectId']) {
    assert.ok(!(key in body), `${key} must not be sent to lemlist`);
  }
});

test('numeric values are stringified, since lemlist stores variables as text', () => {
  const [body] = buildPushPlan(LIST, [emailLead({ score: 87 })]).campaigns[0].leads;
  assert.equal(body.score, '87');
});

test('a zero score survives instead of being dropped as falsy', () => {
  const [body] = buildPushPlan(LIST, [emailLead({ score: 0 })]).campaigns[0].leads;
  assert.equal(body.score, '0');
});

// ── Totals ──────────────────────────────────────────────────────────────────

test('totals account for every lead exactly once', () => {
  const leads = [emailLead(), linkedinLead(), emailLead({ prospectId: 'x', email: '' })];
  const { totals } = buildPushPlan(LIST, leads);
  assert.equal(totals.leads, 3);
  assert.equal(totals.pushable + totals.skipped, totals.leads);
  assert.equal(totals.campaigns, 1);
});

test('zero pushable leads means zero campaigns, not an empty one', () => {
  const plan = buildPushPlan(LIST, [emailLead({ email: '' })]);
  assert.equal(plan.campaigns.length, 0);
  assert.equal(plan.totals.campaigns, 0);
});
