/**
 * Unit tests for the lemlist push planner.
 *
 * The point of this file is that ONE ProspectMind campaign becomes ONE lemlist
 * campaign, with steps built from the campaign's CONFIGURED sequence — not from
 * whatever channel campaignExecutor happened to fall back to for a given lead.
 * A lead who can't satisfy a step (no email for an email step) is still pushed;
 * that step just never fires for them, the same way it wouldn't for any real
 * lemlist campaign with a mixed contact list. Pure: no database, no network.
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

/** A lead in the shape buildOutreachLeads() emits. */
const lead = (over = {}) => ({
  prospectId: 'p1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  linkedinUrl: 'https://linkedin.com/in/ada',
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

/** A lead campaignExecutor fell back to LinkedIn for — no email on file. */
const linkedinOnlyLead = (over = {}) =>
  lead({
    prospectId: 'p2',
    firstName: 'Mickey',
    lastName: 'Marsden',
    email: '',
    messages: [
      { stepOrder: 1, channel: 'linkedin', delayDays: 0, body: 'Hi Mickey' },
      { stepOrder: 2, channel: 'linkedin', delayDays: 3, body: 'Following up' },
    ],
    step1Channel: 'linkedin', step1Subject: '', step1Message: 'Hi Mickey',
    step2Channel: 'linkedin', step2Subject: '', step2Message: 'Following up',
    ...over,
  });

// ── One campaign, always ──────────────────────────────────────────────────

test('every pushable lead lands in exactly one campaign, regardless of resolved channel', () => {
  const plan = buildPushPlan(LIST, [
    lead(),
    linkedinOnlyLead({ email: 'mickey@example.com' }), // needs an address to clear this all-email LIST
    lead({ prospectId: 'p9' }),
  ]);
  assert.equal(plan.campaigns.length, 1);
  assert.equal(plan.campaigns[0].leads.length, 3);
});

test('the campaign is named after the list, with no channel suffix', () => {
  const plan = buildPushPlan(LIST, [lead()]);
  assert.equal(plan.campaigns[0].name, 'GoodHive Demo');
});

test('a name longer than 140 chars is truncated rather than rejected', () => {
  const longName = 'x'.repeat(200);
  const plan = buildPushPlan({ ...LIST, name: longName }, [lead()]);
  assert.equal(plan.campaigns[0].name.length, 140);
});

test('an empty list plans nothing rather than throwing', () => {
  const plan = buildPushPlan(LIST, []);
  assert.deepEqual(plan.campaigns, []);
  assert.equal(plan.totals.leads, 0);
});

// ── Steps come from the CONFIGURED sequence, not from any one lead ─────────

test('steps mirror list.sequence exactly, independent of what any lead resolved to', () => {
  // every message this lead has is 'linkedin'; given an email only so it
  // clears LIST's all-email reachability check.
  const plan = buildPushPlan(LIST, [linkedinOnlyLead({ email: 'mickey@example.com' })]);
  const [step1, step2] = plan.campaigns[0].steps;
  assert.equal(step1.type, 'email'); // LIST configured email, not the lead's resolved linkedin
  assert.equal(step2.type, 'email');
});

test('email steps carry subject and message as templates, not baked-in copy', () => {
  const plan = buildPushPlan(LIST, [lead()]);
  const [step1, step2] = plan.campaigns[0].steps;
  assert.equal(step1.subject, '{{step1Subject}}');
  assert.equal(step1.message, '<p>{{step1Message}}</p>');
  assert.equal(step2.subject, '{{step2Subject}}');
});

test('a linkedin-configured step has a message and no subject', () => {
  const list = { name: 'X', sequence: [{ stepOrder: 1, channel: 'linkedin', delayDays: 0 }] };
  const [step1] = buildPushPlan(list, [lead()]).campaigns[0].steps;
  assert.equal(step1.type, 'linkedinSend');
  assert.equal(step1.message, '{{step1Message}}');
  assert.ok(!('subject' in step1), 'a linkedin step must not send a subject');
});

test('x and telegram become manual tasks rather than being dropped', () => {
  const list = { name: 'X', sequence: [{ stepOrder: 1, channel: 'x', delayDays: 0 }] };
  const [step1] = buildPushPlan(list, [lead({ xUrl: 'https://x.com/ada' })]).campaigns[0].steps;
  assert.equal(step1.type, 'manual');
  assert.match(step1.title, /^Send X message/);
});

test('delay comes from the configured sequence', () => {
  const plan = buildPushPlan(LIST, [lead()]);
  assert.deepEqual(plan.campaigns[0].steps.map((s) => s.delay), [0, 3]);
});

test('a gap in stepOrder does not create a gap in the lemlist sequence', () => {
  const list = {
    name: 'X',
    sequence: [{ stepOrder: 1, channel: 'email', delayDays: 0 }, { stepOrder: 5, channel: 'linkedin', delayDays: 2 }],
  };
  const plan = buildPushPlan(list, [lead()]);
  assert.deepEqual(plan.campaigns[0].steps.map((s) => s.index), [1, 2]);
});

test('an unconfigured campaign falls back to the one-step default sequence', () => {
  const plan = buildPushPlan({ name: 'X', sequence: [] }, [lead()]);
  assert.equal(plan.campaigns[0].steps.length, 1);
  assert.equal(plan.campaigns[0].steps[0].type, 'email');
});

// ── Reachability ────────────────────────────────────────────────────────────

test('a lead missing every field the sequence needs is refused', () => {
  // Configured sequence is all-email; a lead with no address can never
  // receive a single step, so pushing them would be pointless.
  const plan = buildPushPlan(LIST, [lead({ prospectId: 'dead', email: '' })]);
  assert.equal(plan.totals.pushable, 0);
  assert.match(plan.skipped[0].reason, /Not reachable on any configured channel/);
});

test('a lead reachable on only SOME configured steps is still pushed', () => {
  // Real case: the configured sequence is email-then-linkedin, and this lead
  // has no email — reachable on step 2 only. The email step will simply never
  // fire for them in lemlist — that is lemlist's own behaviour, not something
  // this planner needs to prevent.
  const mixed = {
    name: 'Mixed',
    sequence: [{ stepOrder: 1, channel: 'email', delayDays: 0 }, { stepOrder: 2, channel: 'linkedin', delayDays: 0 }],
  };
  const plan = buildPushPlan(mixed, [linkedinOnlyLead()]);
  assert.equal(plan.totals.pushable, 1);
  assert.equal(plan.skipped.length, 0);
});

test('a mixed sequence only requires ONE of its needed fields to be present', () => {
  const list = {
    name: 'X',
    sequence: [{ stepOrder: 1, channel: 'email', delayDays: 0 }, { stepOrder: 2, channel: 'linkedin', delayDays: 0 }],
  };
  const linkedinOnly = lead({ email: '', linkedinUrl: 'https://linkedin.com/in/ada' });
  assert.equal(buildPushPlan(list, [linkedinOnly]).totals.pushable, 1);
});

test('a lead skipped during generation is reported, not pushed', () => {
  const plan = buildPushPlan(LIST, [
    lead({ prospectId: 'p5', status: 'skipped', skipReason: 'Pipeline not ready (paused).' }),
  ]);
  assert.equal(plan.campaigns.length, 0);
  assert.equal(plan.skipped[0].reason, 'Pipeline not ready (paused).');
});

test('a lead with no generated messages is refused', () => {
  const plan = buildPushPlan(LIST, [lead({ prospectId: 'p7', messages: [] })]);
  assert.match(plan.skipped[0].reason, /No generated messages/);
});

test('one unreachable lead does not sink the rest', () => {
  const plan = buildPushPlan(LIST, [lead(), lead({ prospectId: 'bad', email: '' }), lead({ prospectId: 'ok2' })]);
  assert.equal(plan.totals.pushable, 2);
  assert.equal(plan.totals.skipped, 1);
});

// ── Lead bodies ────────────────────────────────────────────────────────────

test('step copy for every step rides on the lead as custom variables, even for steps it cannot receive', () => {
  // The lead's own generated text always travels with it, regardless of which
  // configured steps it can actually satisfy — lemlist just won't use the
  // variables belonging to a step that never fires for this lead. Mixed
  // sequence so this email-less lead is pushable at all (via its LinkedIn step).
  const mixed = {
    name: 'Mixed',
    sequence: [{ stepOrder: 1, channel: 'email', delayDays: 0 }, { stepOrder: 2, channel: 'linkedin', delayDays: 0 }],
  };
  const [body] = buildPushPlan(mixed, [linkedinOnlyLead()]).campaigns[0].leads;
  assert.equal(body.step1Message, 'Hi Mickey'); // rides along even though step 1 is an email step it can't receive
  assert.equal(body.step2Message, 'Following up');
});

test('empty values are dropped so a blank never renders as invisible text', () => {
  const [body] = buildPushPlan(LIST, [lead({ xUrl: '', telegramHandle: '' })]).campaigns[0].leads;
  assert.ok(!('xUrl' in body));
  assert.ok(!('telegramHandle' in body));
});

test('internal bookkeeping never becomes a lemlist custom variable', () => {
  const [body] = buildPushPlan(LIST, [lead()]).campaigns[0].leads;
  for (const key of ['messages', 'status', 'skipReason', 'prospectId']) {
    assert.ok(!(key in body), `${key} must not be sent to lemlist`);
  }
});

test('numeric values are stringified, since lemlist stores variables as text', () => {
  const [body] = buildPushPlan(LIST, [lead({ score: 87 })]).campaigns[0].leads;
  assert.equal(body.score, '87');
});

test('a zero score survives instead of being dropped as falsy', () => {
  const [body] = buildPushPlan(LIST, [lead({ score: 0 })]).campaigns[0].leads;
  assert.equal(body.score, '0');
});

// ── Message formatting ───────────────────────────────────────────────────────
// A real lemlist send showed "Hi Jubayer,I was impressed…" — the paragraph
// break in the generated copy ("Hi Jubayer,\n\nI was impressed…") vanished
// instead of becoming a line break, because lemlist substitutes {{step1Message}}
// as a literal string into `<p>{{step1Message}}</p>` with no newline handling
// of its own. These tests reproduce that exact case.

test('a blank-line paragraph break becomes a real HTML paragraph break on an email step', () => {
  const raw = "Hi Jubayer,\n\nI was impressed to see your work.\n\nBest,\n[Your Name]";
  const [body] = buildPushPlan(LIST, [lead({ step1Message: raw })]).campaigns[0].leads;
  assert.equal(body.step1Message, 'Hi Jubayer,</p><p>I was impressed to see your work.</p><p>Best,<br>[Your Name]');
});

test('the fixed bug: the exact real-world text no longer collapses into one run-together line', () => {
  const raw = "Hi Jubayer,\n\nI was impressed to see your work as a Founding Engineer at GoodHive.";
  const [body] = buildPushPlan(LIST, [lead({ step1Message: raw })]).campaigns[0].leads;
  assert.ok(!body.step1Message.includes('Jubayer,I was'), 'the paragraph break must not vanish');
  assert.ok(body.step1Message.includes('</p><p>'), 'it must become a real paragraph break instead');
});

test('a single newline within one paragraph becomes a <br>, not a new paragraph', () => {
  const raw = 'Line one\nLine two';
  const [body] = buildPushPlan(LIST, [lead({ step1Message: raw })]).campaigns[0].leads;
  assert.equal(body.step1Message, 'Line one<br>Line two');
});

test('HTML-special characters in generated copy are escaped on an email step', () => {
  const raw = 'Q&A: is x < y > z a valid check?';
  const [body] = buildPushPlan(LIST, [lead({ step1Message: raw })]).campaigns[0].leads;
  assert.equal(body.step1Message, 'Q&amp;A: is x &lt; y &gt; z a valid check?');
});

test('a linkedin-configured step keeps raw newlines — lemlist renders that field as plain text', () => {
  const list = { name: 'X', sequence: [{ stepOrder: 1, channel: 'linkedin', delayDays: 0 }] };
  const raw = 'Hi Ada,\n\nLoved your talk.';
  const [body] = buildPushPlan(list, [lead({ step1Message: raw })]).campaigns[0].leads;
  assert.equal(body.step1Message, raw, 'a plain-text field must not be HTML-formatted');
});

test('a linkedin-configured step does not HTML-escape ampersands or angle brackets', () => {
  const list = { name: 'X', sequence: [{ stepOrder: 1, channel: 'linkedin', delayDays: 0 }] };
  const raw = 'R&D at <Acme>';
  const [body] = buildPushPlan(list, [lead({ step1Message: raw })]).campaigns[0].leads;
  assert.equal(body.step1Message, raw);
});

test('a manual (x/telegram) step also keeps plain text, unformatted', () => {
  const list = { name: 'X', sequence: [{ stepOrder: 1, channel: 'telegram', delayDays: 0 }] };
  const raw = 'Hey!\n\nSaw your post.';
  const [body] = buildPushPlan(list, [lead({ telegramHandle: '@ada', step1Message: raw })]).campaigns[0].leads;
  assert.equal(body.step1Message, raw);
});

test('formatting is decided by the CAMPAIGN step, not by which channel the lead resolved to', () => {
  // linkedinOnlyLead's own step1 was generated as linkedin copy, but the
  // campaign's step1 is configured as email — it must be HTML-formatted
  // exactly like any other lead's step1, since that is the type the lemlist
  // step itself will actually be. Given an email address so it clears the
  // reachability check for this all-email LIST.
  const raw = 'Hi Mickey,\n\nFollowing up.';
  const [body] = buildPushPlan(LIST, [linkedinOnlyLead({ email: 'mickey@example.com', step1Message: raw })]).campaigns[0].leads;
  assert.equal(body.step1Message, 'Hi Mickey,</p><p>Following up.');
});

test('subjects are left untouched — a subject line is not HTML-rendered', () => {
  const [body] = buildPushPlan(LIST, [lead({ step1Subject: 'A & B <question>' })]).campaigns[0].leads;
  assert.equal(body.step1Subject, 'A & B <question>');
});

// ── Totals ──────────────────────────────────────────────────────────────────

test('totals account for every lead exactly once', () => {
  const leads = [lead(), linkedinOnlyLead(), lead({ prospectId: 'x', email: '' })];
  const { totals } = buildPushPlan(LIST, leads);
  assert.equal(totals.leads, 3);
  assert.equal(totals.pushable + totals.skipped, totals.leads);
  assert.equal(totals.campaigns, 1);
});

test('zero pushable leads means zero campaigns, not an empty one', () => {
  const plan = buildPushPlan(LIST, [lead({ email: '' })]);
  assert.equal(plan.campaigns.length, 0);
  assert.equal(plan.totals.campaigns, 0);
});
