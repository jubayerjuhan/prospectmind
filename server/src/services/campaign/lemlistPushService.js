/**
 * Orchestrates one "Push to lemlist" click: loads the campaign's generated
 * outreach, plans it (lemlistPush.js), replays the plan over the API
 * (lemlistPushExecutor.js + lemlistClient.js), and persists progress onto the
 * ProspectList so the button's poll has something to show.
 *
 * Fire-and-forget from the controller, the same shape as
 * campaignExecutor.executeCampaignOutreach: the HTTP handler starts this and
 * returns immediately, the frontend polls GET .../lemlist-push for status.
 */

import ProspectList from '../../models/ProspectList.js';
import Organization from '../../models/Organization.js';
import { buildOutreachLeads } from './outreachExport.js';
import { buildPushPlan } from './lemlistPush.js';
import { executePushPlan } from './lemlistPushExecutor.js';
import { createLemlistClient } from './lemlistClient.js';

const FLUSH_INTERVAL_MS = 1000; // caps DB writes on a large push without making progress feel stale

const toStoredCampaign = (record, leadCount) => ({
  signature: record.signature,
  name: record.name,
  lemlistCampaignId: record.lemlistCampaignId,
  sequenceId: record.sequenceId,
  leadsPushed: record.leadsPushed,
  leadCount,
  leadFailures: record.leadFailures,
  status: record.status,
  error: record.error,
});

/**
 * What a push WOULD do, without doing it — no lemlist call, no write to
 * `lemlistPush`. Reachability against a fixed sequence is easy to get wrong
 * silently: a campaign configured email→telegram→email→x has no LinkedIn step
 * at all, so a lead who only has a LinkedIn URL is unreachable no matter how
 * good their generated copy is. lemlist has no delete-campaign endpoint, so
 * that is worth knowing before the click, not discovered after in the "not
 * pushed" list of a campaign that already exists.
 *
 * @param {ObjectId|String} listId
 * @param {ObjectId|String} organizationId
 * @returns {Promise<{ totals: Object, skipped: Array, campaignName: String|null, stepCount: Number }>}
 */
export const previewLemlistPush = async (listId, organizationId) => {
  const list = await ProspectList.findOne({ _id: listId, organization: organizationId, isArchived: false })
    .select('name sequence outreach')
    .lean();
  if (!list) throw new Error(`Campaign ${listId} not found`);

  const { leads } = await buildOutreachLeads(list, organizationId);
  const plan = buildPushPlan(list, leads);

  return {
    totals: plan.totals,
    skipped: plan.skipped,
    campaignName: plan.campaigns[0]?.name || null,
    stepCount: plan.campaigns[0]?.steps.length || 0,
  };
};

/**
 * @param {ObjectId|String} listId
 * @param {ObjectId|String} organizationId  From req.organization — never trust the body for this.
 * @param {{ autoReview?: Boolean, timezone?: String }} [opts]
 */
export const executeLemlistPush = async (listId, organizationId, { autoReview = false, timezone } = {}) => {
  const list = await ProspectList.findOne({ _id: listId, organization: organizationId, isArchived: false });
  if (!list) throw new Error(`Campaign ${listId} not found`);

  const org = await Organization.findById(organizationId).select('+integrations.lemlist.apiKey');
  const apiKey = org?.integrations?.lemlist?.apiKey;
  if (!apiKey) {
    list.lemlistPush.status = 'failed';
    list.lemlistPush.error = 'No lemlist API key connected. Add one in Settings.';
    await list.save();
    return list;
  }

  if (!list.outreach?.results?.length) {
    list.lemlistPush.status = 'failed';
    list.lemlistPush.error = 'This campaign has no generated outreach yet — generate it first.';
    await list.save();
    return list;
  }

  list.lemlistPush.status = 'pushing';
  list.lemlistPush.error = null;
  list.lemlistPush.startedAt = new Date();
  await list.save();

  let plan;
  try {
    const { leads } = await buildOutreachLeads(list.toObject(), organizationId);
    plan = buildPushPlan(list.toObject(), leads);
  } catch (error) {
    list.lemlistPush.status = 'failed';
    list.lemlistPush.error = `Could not plan the push: ${error.message}`;
    await list.save();
    throw error;
  }

  if (!plan.campaigns.length) {
    list.lemlistPush.status = 'failed';
    list.lemlistPush.error = plan.skipped.length
      ? `None of the ${plan.skipped.length} generated lead(s) could be pushed — see the skip reasons below.`
      : 'Nothing to push.';
    list.lemlistPush.skipped = plan.skipped;
    list.lemlistPush.totals = plan.totals;
    await list.save();
    return list;
  }

  const leadCountBySignature = new Map(plan.campaigns.map((c) => [c.signature, c.leads.length]));

  // Persisted, not merely logged: lemlist has no delete-campaign endpoint, so
  // an id that only ever lived in memory and the process then died is an
  // orphan nobody can find again.
  list.lemlistPush.campaigns = plan.campaigns.map((c) => ({
    signature: c.signature, name: c.name, leadCount: c.leads.length, status: 'pending',
  }));
  list.lemlistPush.skipped = plan.skipped;
  list.lemlistPush.totals = { ...plan.totals, leadsPushed: 0, leadsFailed: 0 };
  await list.save();

  let lastFlush = 0;
  const persistRecord = async (record, { force = false } = {}) => {
    const now = Date.now();
    if (!force && now - lastFlush < FLUSH_INTERVAL_MS) return;
    lastFlush = now;
    const i = list.lemlistPush.campaigns.findIndex((c) => c.signature === record.signature);
    if (i === -1) return;
    list.lemlistPush.campaigns[i] = toStoredCampaign(record, leadCountBySignature.get(record.signature) ?? 0);
    await list.save().catch((err) => {
      // Progress is best-effort narration; a save hiccup here must not abort
      // the push itself, which continues driving the real lemlist calls.
      console.error(`[lemlist-push] Could not persist progress for ${listId}: ${err.message}`);
    });
  };

  let result;
  try {
    const client = createLemlistClient(apiKey);
    result = await executePushPlan(plan, {
      client,
      timezone,
      autoReview,
      onProgress: (event) => {
        if (!event.record) return;
        persistRecord(event.record, { force: event.phase === 'campaign' || event.final }).catch(() => {});
      },
    });
  } catch (error) {
    list.lemlistPush.status = 'failed';
    list.lemlistPush.error = `Push failed: ${error.message}`;
    await list.save();
    throw error;
  }

  // Final, unthrottled write — the true end state, independent of the 1s gate
  // and of whatever the last periodic flush happened to catch.
  list.lemlistPush.campaigns = result.campaigns.map((r) =>
    toStoredCampaign(r, leadCountBySignature.get(r.signature) ?? r.leadsPushed));
  list.lemlistPush.totals = {
    ...plan.totals, leadsPushed: result.totals.leadsPushed, leadsFailed: result.totals.leadsFailed,
  };
  list.lemlistPush.status = result.ok
    ? 'done'
    : result.totals.leadsPushed > 0 || result.totals.created > 0
      ? 'partial'
      : 'failed';
  list.lemlistPush.lastPushedAt = new Date();
  list.lemlistPush.error = result.ok
    ? null
    : `${result.totals.leadsFailed} lead(s) failed and ${result.campaigns.length - result.totals.created} campaign(s) could not be created — see details below.`;
  await list.save();
  return list;
};
