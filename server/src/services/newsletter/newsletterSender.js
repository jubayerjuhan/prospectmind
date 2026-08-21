/**
 * The newsletter send loop.
 *
 * One BullMQ job drives one whole campaign, streaming its recipients rather
 * than enqueueing a job each. Per-recipient jobs would let BullMQ's `limiter`
 * pace Resend exactly, but a 5,000-recipient blast becomes 5,000 Redis jobs —
 * and the comments in pipeline/queue.js exist precisely because this codebase
 * is already fighting per-command Redis billing. Everything per-recipient jobs
 * would have bought is recovered here instead:
 *
 *   pacing        → an explicit interval between sends (below)
 *   idempotency   → a compare-and-swap claim on the contact row, backed by
 *                   Resend's own idempotency key
 *   resumability  → the cursor is `status: 'pending'` in Mongo, never memory
 *   cancellation  → the campaign's status is re-read every page
 *
 * Progress is written to the domain documents, not job.updateProgress(), so the
 * client polls the campaign exactly like it polls a pipeline run.
 */

import NewsletterCampaign from '../../models/NewsletterCampaign.js';
import NewsletterContact from '../../models/NewsletterContact.js';
import NewsletterSuppression from '../../models/NewsletterSuppression.js';
import { sendNewsletterEmail } from '../resend/emailService.js';
import { renderForContact } from './renderNewsletter.js';
import { unsubscribeUrl } from './unsubscribeToken.js';

const PAGE_SIZE = 200;
const MAX_RATE_RETRIES = 3;
const RATE_BACKOFF_MS = 2000;

// Default 1.5/s, not Resend's full ~2/s cap. The cap is account-wide, so a
// blast running flat out would be competing with password-reset and
// verification emails for the same budget for the entire run.
const ratePerSecond = () => Number(process.env.NEWSLETTER_SEND_RATE) || 1.5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isRateLimited = (err) => err?.statusCode === 429 || err?.code === 'rate_limit_exceeded';

/**
 * Rows stranded in the 'sending' claim by a crash between the API call and the
 * status write. Returning them to 'pending' is safe — and is the reason every
 * send carries an idempotency key: if the original call did reach Resend, the
 * retry returns that same result instead of delivering a second copy.
 */
const recoverStrandedClaims = async (campaignId) => {
  const { modifiedCount } = await NewsletterContact.updateMany(
    { campaign: campaignId, status: 'sending' },
    { $set: { status: 'pending' } }
  );
  if (modifiedCount) {
    console.log(`[newsletter] Recovered ${modifiedCount} recipient(s) stranded by an interrupted run.`);
  }
};

const bumpStats = (campaignId, field) =>
  NewsletterCampaign.updateOne({ _id: campaignId }, { $inc: { [`stats.${field}`]: 1 } });

export const runNewsletterSend = async (campaignId) => {
  const campaign = await NewsletterCampaign.findById(campaignId)
    .populate('organization', 'name')
    .populate('createdBy', 'name');

  if (!campaign || campaign.isArchived) {
    console.log(`[newsletter] Campaign ${campaignId} is gone — nothing to send.`);
    return;
  }
  if (campaign.status === 'canceled') {
    console.log(`[newsletter] Campaign ${campaignId} was canceled before it started.`);
    return;
  }

  const orgName = campaign.organization?.name || 'us';
  const fromName = campaign.fromName?.trim() || campaign.createdBy?.name?.trim() || orgName;
  const replyTo = campaign.replyTo?.trim() || undefined;

  await recoverStrandedClaims(campaign._id);

  campaign.status = 'sending';
  campaign.startedAt = campaign.startedAt || new Date();
  campaign.error = undefined;
  await campaign.save();

  // Loaded once as a fast path. It is NOT the only defence: someone who
  // unsubscribes from this very blast is caught by the claim below, because the
  // unsubscribe route flips their row out of 'pending'.
  const suppressed = new Set(
    (await NewsletterSuppression.find({ organization: campaign.organization._id }).select('email').lean())
      .map((s) => s.email)
  );

  const minIntervalMs = Math.ceil(1000 / ratePerSecond());
  let lastSentAt = 0;
  let canceled = false;

  try {
    for (;;) {
      // Cooperative cancel, checked once per page — the same idiom
      // pipeline/runner.js uses to stop an in-flight enrichment.
      const fresh = await NewsletterCampaign.findById(campaign._id).select('status').lean();
      if (fresh?.status === 'canceled') {
        canceled = true;
        break;
      }

      const page = await NewsletterContact.find({ campaign: campaign._id, status: 'pending' })
        .sort({ _id: 1 })
        .limit(PAGE_SIZE);

      if (!page.length) break;

      for (const contact of page) {
        // Claim it. If nothing was modified another pass already took this row,
        // so skip rather than risk a second delivery.
        const claim = await NewsletterContact.updateOne(
          { _id: contact._id, status: 'pending' },
          { $set: { status: 'sending' } }
        );
        if (!claim.modifiedCount) continue;

        if (suppressed.has(contact.email)) {
          await NewsletterContact.updateOne(
            { _id: contact._id },
            { $set: { status: 'unsubscribed', error: 'On the organization suppression list.' } }
          );
          await bumpStats(campaign._id, 'skipped');
          continue;
        }

        const wait = minIntervalMs - (Date.now() - lastSentAt);
        if (wait > 0) await sleep(wait);

        try {
          const { subject, html, text } = renderForContact(campaign, contact, { orgName });

          let sent;
          for (let attempt = 1; ; attempt++) {
            try {
              sent = await sendNewsletterEmail({
                to: contact.email,
                subject,
                html,
                text,
                fromName,
                replyTo,
                headers: {
                  // Required of bulk senders by Gmail and Yahoo. Advertising
                  // One-Click is only legitimate because the POST route really
                  // does accept an unauthenticated submission.
                  'List-Unsubscribe': `<${unsubscribeUrl(contact._id)}>`,
                  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                },
                idempotencyKey: `newsletter:${campaign._id}:${contact._id}`,
              });
              break;
            } catch (err) {
              // The cap is account-wide, so transactional mail firing alongside
              // us can push a well-paced blast over it. Back off and retry the
              // same recipient rather than marking them failed.
              if (isRateLimited(err) && attempt < MAX_RATE_RETRIES) {
                await sleep(RATE_BACKOFF_MS * attempt);
                continue;
              }
              throw err;
            }
          }

          lastSentAt = Date.now();

          await NewsletterContact.updateOne(
            { _id: contact._id },
            { $set: { status: 'sent', sentAt: new Date(), resendMessageId: sent?.id || '', error: '' } }
          );
          await bumpStats(campaign._id, 'sent');
        } catch (err) {
          lastSentAt = Date.now();
          console.error(`[newsletter] ${contact.email}: ${err.message}`);
          await NewsletterContact.updateOne(
            { _id: contact._id },
            { $set: { status: 'failed', error: err.message?.slice(0, 500) || 'Send failed.' } }
          );
          await bumpStats(campaign._id, 'failed');
        }
      }
    }
  } catch (err) {
    // Only a top-level throw is a failed campaign — a per-recipient failure was
    // already recorded on that recipient and does not condemn the run.
    await NewsletterCampaign.updateOne(
      { _id: campaign._id },
      { $set: { status: 'failed', error: err.message?.slice(0, 500) || 'Send failed.', completedAt: new Date() } }
    );
    throw err;
  }

  if (canceled) {
    // Whatever is still 'pending' stays that way, so the results view can show
    // it as "not sent — canceled" and a resume is a normal send.
    await NewsletterCampaign.updateOne({ _id: campaign._id }, { $set: { completedAt: new Date() } });
    console.log(`[newsletter] Campaign ${campaign._id} canceled mid-send.`);
    return;
  }

  // 'sent' even with failures: a blast where 3 of 5,000 addresses were bad is not
  // a failed campaign, and calling it one invites a re-send that duplicates the
  // other 4,997.
  //
  // Unless NOTHING got through. A run where every single recipient failed is not
  // a delivered newsletter — it is almost always one cause affecting all of them
  // (an invalid API key, an unverified sending domain, an exhausted quota), and
  // marking it 'sent' both misreports it and strands it: re-sending requires a
  // status in SENDABLE_FROM, so the campaign could never be retried after the
  // underlying problem was fixed.
  const totals = await NewsletterCampaign.findById(campaign._id).select('stats').lean();
  const nothingDelivered = totals.stats.sent === 0 && totals.stats.failed > 0;

  const firstError = nothingDelivered
    ? await NewsletterContact.findOne({ campaign: campaign._id, status: 'failed' }).select('error').lean()
    : null;

  await NewsletterCampaign.updateOne(
    { _id: campaign._id },
    {
      $set: {
        status: nothingDelivered ? 'failed' : 'sent',
        completedAt: new Date(),
        ...(nothingDelivered
          ? { error: `No emails were delivered — every recipient failed. ${firstError?.error || ''}`.trim() }
          : {}),
      },
    }
  );

  console.log(
    `[newsletter] Campaign ${campaign._id} ${nothingDelivered ? 'FAILED — nothing delivered' : 'finished'} — ${totals.stats.sent} sent, ${totals.stats.failed} failed, ${totals.stats.skipped} skipped.`
  );
};
