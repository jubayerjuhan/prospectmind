/**
 * Unit tests for the lemlist push executor.
 *
 * lemlist has no delete-campaign endpoint, so the behaviour under test is
 * mostly about failure: what survives, what is reported, and what is NOT
 * created when something upstream went wrong. Pure: the lemlist client is a
 * stub, no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { executePushPlan } from './lemlistPushExecutor.js';

const plan = (over = {}) => ({
  campaigns: [
    {
      signature: 'email>email',
      name: 'List — Email',
      steps: [
        { type: 'email', index: 1, delay: 0, subject: '{{step1Subject}}', message: '<p>{{step1Message}}</p>' },
        { type: 'email', index: 2, delay: 3, subject: '{{step2Subject}}', message: '<p>{{step2Message}}</p>' },
      ],
      leads: [
        { email: 'a@example.com', firstName: 'A', step1Subject: 's', step1Message: 'm' },
        { email: 'b@example.com', firstName: 'B', step1Subject: 's', step1Message: 'm' },
      ],
    },
  ],
  skipped: [],
  totals: {},
  ...over,
});

/** Records every call; `fail` maps a method name to an error for one call. */
const stubClient = ({ failOn = {} } = {}) => {
  const calls = [];
  let campaignSeq = 0;
  let stepSeq = 0;
  const maybeFail = (method) => {
    if (failOn[method]) {
      const err = failOn[method];
      if (typeof err === 'number') { failOn[method] -= 1; if (failOn[method] >= 0) throw new Error(`${method} failed`); }
      else { delete failOn[method]; throw new Error(typeof err === 'string' ? err : `${method} failed`); }
    }
  };
  return {
    calls,
    async createCampaign(payload) {
      calls.push(['createCampaign', payload]); maybeFail('createCampaign');
      campaignSeq += 1;
      return { _id: `cam_${campaignSeq}`, sequenceId: `seq_${campaignSeq}` };
    },
    async addStep(sequenceId, step) {
      calls.push(['addStep', sequenceId, step]); maybeFail('addStep');
      stepSeq += 1; return { _id: `stp_${stepSeq}` };
    },
    async addLead(campaignId, lead) {
      calls.push(['addLead', campaignId, lead]); maybeFail('addLead');
      return { _id: 'lea_x' };
    },
  };
};

// ── Happy path ─────────────────────────────────────────────────────────────

test('creates the campaign, then its steps, then its leads — in that order', async () => {
  const client = stubClient();
  await executePushPlan(plan(), { client });
  const order = client.calls.map((c) => c[0]);
  assert.deepEqual(order, ['createCampaign', 'addStep', 'addStep', 'addLead', 'addLead']);
});

test('reports the lemlist ids it created', async () => {
  const client = stubClient();
  const result = await executePushPlan(plan(), { client });
  const [record] = result.campaigns;
  assert.equal(record.lemlistCampaignId, 'cam_1');
  assert.equal(record.sequenceId, 'seq_1');
  assert.deepEqual(record.stepIds, ['stp_1', 'stp_2']);
  assert.equal(record.status, 'complete');
  assert.equal(result.ok, true);
});

test('leads are added to the campaign that was just created', async () => {
  const client = stubClient();
  await executePushPlan(plan(), { client });
  for (const call of client.calls.filter((c) => c[0] === 'addLead')) assert.equal(call[1], 'cam_1');
});

// ── Safety defaults ────────────────────────────────────────────────────────

test('autoReview defaults to false so a click never starts emailing real people', async () => {
  const client = stubClient();
  await executePushPlan(plan(), { client });
  assert.equal(client.calls[0][1].autoReview, false);
});

test('autoReview can be opted into explicitly', async () => {
  const client = stubClient();
  await executePushPlan(plan(), { client, autoReview: true });
  assert.equal(client.calls[0][1].autoReview, true);
});

test('timezone is sent when given and omitted when not', async () => {
  const withTz = stubClient();
  await executePushPlan(plan(), { client: withTz, timezone: 'Asia/Dhaka' });
  assert.equal(withTz.calls[0][1].timezone, 'Asia/Dhaka');

  const withoutTz = stubClient();
  await executePushPlan(plan(), { client: withoutTz });
  assert.ok(!('timezone' in withoutTz.calls[0][1]));
});

// ── Failure containment ────────────────────────────────────────────────────

test('a failed campaign creation does not attempt steps or leads', async () => {
  const client = stubClient({ failOn: { createCampaign: 'boom' } });
  const result = await executePushPlan(plan(), { client });
  assert.deepEqual(client.calls.map((c) => c[0]), ['createCampaign']);
  assert.equal(result.campaigns[0].status, 'failed');
  assert.match(result.campaigns[0].error, /Could not create campaign/);
  assert.equal(result.ok, false);
});

test('a failed step means NO leads are added to a half-built sequence', async () => {
  // A lead sitting in a broken sequence looks ready to send; that is worse
  // than a lead that was never added at all.
  const client = stubClient({ failOn: { addStep: 'nope' } });
  const result = await executePushPlan(plan(), { client });
  assert.equal(client.calls.filter((c) => c[0] === 'addLead').length, 0);
  assert.match(result.campaigns[0].error, /Sequence incomplete, leads not added/);
});

test('a campaign id is still reported when a later step fails, so it is never orphaned', async () => {
  // lemlist cannot delete campaigns; an id we forget is an id the user can
  // never reconcile.
  const client = stubClient({ failOn: { addStep: 'nope' } });
  const result = await executePushPlan(plan(), { client });
  assert.equal(result.campaigns[0].lemlistCampaignId, 'cam_1');
});

test('one failing lead does not stop the rest of the campaign', async () => {
  const client = stubClient({ failOn: { addLead: 'bad address' } });
  const result = await executePushPlan(plan(), { client });
  const [record] = result.campaigns;
  assert.equal(record.leadsPushed, 1);
  assert.equal(record.leadFailures.length, 1);
  assert.equal(record.status, 'partial');
  assert.equal(result.ok, false);
});

test('a failing lead is named in the report', async () => {
  const client = stubClient({ failOn: { addLead: 'bad address' } });
  const result = await executePushPlan(plan(), { client });
  const [failure] = result.campaigns[0].leadFailures;
  assert.equal(failure.email, 'a@example.com');
  assert.match(failure.error, /bad address/);
});

test('one failed bucket does not stop the next bucket', async () => {
  const two = plan();
  two.campaigns.push({ ...two.campaigns[0], signature: 'linkedin', name: 'List — LinkedIn' });
  const client = stubClient({ failOn: { createCampaign: 1 } }); // fail only the first
  const result = await executePushPlan(two, { client });
  assert.equal(result.campaigns[0].status, 'failed');
  assert.equal(result.campaigns[1].status, 'complete');
  assert.equal(result.totals.created, 1);
});

test('a campaign response missing ids is treated as a failure, not a silent success', async () => {
  const client = { ...stubClient(), createCampaign: async () => ({ _id: 'cam_1' }) }; // no sequenceId
  const result = await executePushPlan(plan(), { client });
  assert.equal(result.campaigns[0].status, 'failed');
  assert.match(result.campaigns[0].error, /sequence id/);
});

// ── Progress + totals ──────────────────────────────────────────────────────

test('progress narrates each phase and ends with done', async () => {
  const events = [];
  await executePushPlan(plan(), { client: stubClient(), onProgress: (e) => events.push(e) });
  const phases = [...new Set(events.map((e) => e.phase))];
  assert.deepEqual(phases, ['campaign', 'steps', 'leads', 'done']);
});

test('the campaign id is announced before any step runs', async () => {
  const events = [];
  await executePushPlan(plan(), { client: stubClient(), onProgress: (e) => events.push(e) });
  const idEvent = events.findIndex((e) => e.lemlistCampaignId);
  const firstStep = events.findIndex((e) => e.phase === 'steps');
  assert.ok(idEvent < firstStep && idEvent !== -1, 'id must be surfaced before steps are attempted');
});

test('lead progress carries both per-campaign and overall counters', async () => {
  const events = [];
  await executePushPlan(plan(), { client: stubClient(), onProgress: (e) => events.push(e) });
  const last = events.filter((e) => e.phase === 'leads').pop();
  assert.equal(last.done, 2);
  assert.equal(last.total, 2);
  assert.equal(last.overallDone, 2);
  assert.equal(last.overallTotal, 2);
});

test('a snapshot taken early in the run is untouched by what happens later', async () => {
  // `{ ...record }` alone would still share the leadFailures/stepIds ARRAYS
  // across every snapshot — a caller (lemlistPushService.js) that persists an
  // early event's record would then see it silently mutate to the final state
  // the moment a later lead failed, corrupting whatever it already saved.
  const client = stubClient({ failOn: { addLead: 'bad address' } });
  const events = [];
  await executePushPlan(plan(), { client, onProgress: (e) => events.push(e) });
  const earliest = events.find((e) => e.record)?.record;
  const savedFailureCount = earliest.leadFailures.length;
  assert.equal(savedFailureCount, 0, 'the campaign-created event predates any lead failure');
  // The run has since finished and failed a lead; the saved snapshot must not
  // have moved.
  assert.equal(earliest.leadFailures.length, savedFailureCount);
});

test('the last leads event for a bucket reports its true final status, not "pending"', async () => {
  const events = [];
  await executePushPlan(plan(), { client: stubClient(), onProgress: (e) => events.push(e) });
  const last = events.filter((e) => e.phase === 'leads').pop();
  assert.equal(last.final, true);
  assert.equal(last.record.status, 'complete');
});

test('a mid-bucket leads event is marked final:false', async () => {
  const events = [];
  await executePushPlan(plan(), { client: stubClient(), onProgress: (e) => events.push(e) });
  const leadsEvents = events.filter((e) => e.phase === 'leads');
  assert.equal(leadsEvents[0].final, false);
});

test('a failing lead is reflected in the record snapshot on that same event', async () => {
  const client = stubClient({ failOn: { addLead: 'bad address' } });
  const events = [];
  await executePushPlan(plan(), { client, onProgress: (e) => events.push(e) });
  const failedEvent = events.find((e) => e.record?.leadFailures?.length === 1);
  assert.ok(failedEvent, 'expected an event whose record already shows the failure');
  assert.equal(failedEvent.record.status, 'partial');
});

test('totals count what happened, including planning-time skips', async () => {
  const p = plan({ skipped: [{ prospectId: 'x', reason: 'no email' }] });
  const result = await executePushPlan(p, { client: stubClient() });
  assert.deepEqual(result.totals, {
    campaigns: 1, created: 1, leadsPushed: 2, leadsFailed: 0, skippedInPlanning: 1,
  });
});

test('an empty plan is a no-op, not a crash', async () => {
  const client = stubClient();
  const result = await executePushPlan({ campaigns: [], skipped: [], totals: {} }, { client });
  assert.equal(client.calls.length, 0);
  assert.equal(result.ok, true);
  assert.equal(result.totals.leadsPushed, 0);
});

test('runs without an onProgress callback', async () => {
  await executePushPlan(plan(), { client: stubClient() }); // must not throw
});
