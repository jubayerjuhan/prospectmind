/**
 * Execution half of the lemlist push: replays a plan from buildPushPlan over
 * the API. All the judgement lives in the planner; this file is sequencing,
 * bookkeeping, and failure containment.
 *
 * ── Why this is so careful about partial state ─────────────────────────────
 * lemlist has no delete-campaign endpoint. Anything we create is permanent, so
 * a crash halfway through must not leave campaigns the caller never heard
 * about — the user would have orphans in their sidebar with no way to remove
 * them from ProspectMind and no way to delete them from lemlist except by
 * hand. Every id is therefore reported the moment it exists, before the work
 * that might fail, and the returned record is complete even on failure.
 */

/** Order matters: a campaign must exist before its steps, steps before leads. */
const PHASES = { CAMPAIGN: 'campaign', STEPS: 'steps', LEADS: 'leads', DONE: 'done' };

const noop = () => {};

// `{ ...record }` alone is not a real snapshot: `leadFailures` and `stepIds`
// are arrays, so every shallow copy still points at the SAME array objects,
// and a later push() onto them silently rewrites every snapshot already
// handed to onProgress — including ones a caller may have already persisted.
// Caught by a test that compared an early snapshot's contents against itself
// after the run finished.
const snapshot = (record) => ({ ...record, stepIds: [...record.stepIds], leadFailures: [...record.leadFailures] });

/**
 * @param {Object}   plan              Output of buildPushPlan().
 * @param {Object}   deps.client       createLemlistClient() instance.
 * @param {Function} [deps.onProgress] Called with narration events.
 * @param {String}   [deps.timezone]   IANA tz for the campaign schedule.
 * @param {Boolean}  [deps.autoReview] Launch leads on add. Defaults FALSE — a
 *                                     one-click button must not start emailing
 *                                     real people without a human looking.
 */
export const executePushPlan = async (plan, { client, onProgress = noop, timezone, autoReview = false } = {}) => {
  const results = [];
  const totalLeads = plan.campaigns.reduce((sum, c) => sum + c.leads.length, 0);
  let leadsPushed = 0;

  for (const [index, bucket] of plan.campaigns.entries()) {
    const record = {
      signature: bucket.signature,
      name: bucket.name,
      lemlistCampaignId: null,
      sequenceId: null,
      stepIds: [],
      leadsPushed: 0,
      leadFailures: [],
      status: 'pending',
      error: null,
    };
    results.push(record);

    // ── Campaign ────────────────────────────────────────────────────────────
    // `record` rides along as a snapshot on every event — not a reference to
    // the mutable object above — so a caller persisting progress (see
    // lemlistPushService.js) always has the complete, current state to save
    // without needing to reach back into a results array that does not exist
    // yet at this point in the run.
    onProgress({
      phase: PHASES.CAMPAIGN, campaign: bucket.name, index: index + 1,
      total: plan.campaigns.length, message: `Creating campaign "${bucket.name}"`, record: snapshot(record),
    });

    try {
      const created = await client.createCampaign({
        name: bucket.name,
        ...(timezone ? { timezone } : {}),
        autoReview,
      });
      record.lemlistCampaignId = created?._id || null;
      record.sequenceId = created?.sequenceId || null;
      if (!record.lemlistCampaignId || !record.sequenceId) {
        throw new Error('lemlist did not return a campaign id and sequence id');
      }
    } catch (error) {
      record.status = 'failed';
      record.error = `Could not create campaign: ${error.message}`;
      onProgress({ phase: PHASES.CAMPAIGN, campaign: bucket.name, error: record.error, record: snapshot(record) });
      continue; // the next bucket is independent; one failure is not all of them
    }

    // Surfaced before the steps run: if the process dies next line, the caller
    // still knows this campaign exists and can show it rather than orphan it.
    onProgress({
      phase: PHASES.CAMPAIGN, campaign: bucket.name,
      lemlistCampaignId: record.lemlistCampaignId, message: 'Campaign created', record: snapshot(record),
    });

    // ── Steps ───────────────────────────────────────────────────────────────
    try {
      for (const step of bucket.steps) {
        const added = await client.addStep(record.sequenceId, step);
        record.stepIds.push(added?._id || null);
        onProgress({
          phase: PHASES.STEPS, campaign: bucket.name,
          done: record.stepIds.length, total: bucket.steps.length,
          message: `Added step ${step.index} (${step.type})`, record: snapshot(record),
        });
      }
    } catch (error) {
      // Leads must not go into a campaign whose sequence is wrong: a lead in a
      // half-built sequence is worse than a lead that was never added, because
      // it looks ready to send.
      record.status = 'failed';
      record.error = `Sequence incomplete, leads not added: ${error.message}`;
      onProgress({ phase: PHASES.STEPS, campaign: bucket.name, error: record.error, record: snapshot(record) });
      continue;
    }

    // ── Leads ───────────────────────────────────────────────────────────────
    for (const lead of bucket.leads) {
      try {
        await client.addLead(record.lemlistCampaignId, lead);
        record.leadsPushed += 1;
        leadsPushed += 1;
      } catch (error) {
        // One bad address must not cost the other 499.
        record.leadFailures.push({ email: lead.email || '', name: `${lead.firstName || ''} ${lead.lastName || ''}`.trim(), error: error.message });
      }
      // Provisional, updated after every lead rather than only at the end: the
      // record snapshot handed to onProgress is then always an accurate status
      // as of that point, and a caller persisting it (lemlistPushService.js)
      // never has to wait for a separate "final" event to know the real state.
      record.status = record.leadFailures.length ? 'partial' : 'complete';
      onProgress({
        phase: PHASES.LEADS, campaign: bucket.name,
        done: record.leadsPushed + record.leadFailures.length, total: bucket.leads.length,
        overallDone: leadsPushed, overallTotal: totalLeads,
        message: `${record.leadsPushed}/${bucket.leads.length} leads added`, record: snapshot(record),
        final: record.leadsPushed + record.leadFailures.length === bucket.leads.length,
      });
    }
  }

  const totals = {
    campaigns: plan.campaigns.length,
    created: results.filter((r) => r.lemlistCampaignId).length,
    leadsPushed,
    leadsFailed: results.reduce((sum, r) => sum + r.leadFailures.length, 0),
    skippedInPlanning: plan.skipped.length,
  };

  onProgress({ phase: PHASES.DONE, message: `Pushed ${leadsPushed}/${totalLeads} leads into ${totals.created} campaign(s)`, totals });

  return { campaigns: results, totals, ok: results.every((r) => r.status === 'complete') };
};

export const __testables = { PHASES };
