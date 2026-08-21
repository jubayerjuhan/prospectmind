/**
 * Newsletter send queue.
 *
 * Same skeleton as pipeline/queue.js — its own Redis connection, the shared
 * IDLE_POLL_OPTS throttling, and the runWorkers gate so only the instance meant
 * to process jobs polls Redis. See that file for why those exist.
 *
 * Scheduling rides on BullMQ's delayed jobs rather than node-cron. That is not
 * a stylistic choice: startUsageResetCron() in server.js is not gated by
 * RUN_WORKERS, and Cloud Run runs up to three replicas, so a cron sweep would
 * fire on all three and send every scheduled newsletter three times. A delayed
 * job lives in Redis, which is the single coordinator, and fires exactly once.
 */

import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { IDLE_POLL_OPTS, runWorkers } from '../pipeline/queue.js';
import { runNewsletterSend } from './newsletterSender.js';
import NewsletterCampaign from '../../models/NewsletterCampaign.js';
import 'dotenv/config';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  tls: redisUrl.includes('upstash.io') || redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
});

export const newsletterQueue = new Queue('newsletterQueue', { connection });

// concurrency 1 so two campaigns never send at once and blow the shared Resend
// account cap. lockDuration is generous because one job legitimately runs for
// the length of a whole blast — BullMQ renews the lock while the processor is
// alive, and the loop only ever awaits I/O.
export const newsletterWorker = !runWorkers
  ? null
  : new Worker('newsletterQueue', async (job) => runNewsletterSend(job.data.campaignId), {
      connection,
      concurrency: 1,
      lockDuration: 600000,
      ...IDLE_POLL_OPTS,
    });

newsletterWorker?.on('failed', (job, err) => {
  console.error(`[newsletter] Job ${job?.id} failed:`, err.message);
});

/**
 * `attempts: 1` — a whole-campaign automatic re-run is never what we want;
 * resuming is an explicit user action, and the per-recipient status makes it
 * safe. BullMQ's stalled-job recovery still re-runs a crashed job once, which
 * IS wanted and is safe because of the claim/idempotency-key pair in the sender.
 *
 * The job id carries a timestamp rather than being derived from the campaign
 * alone: BullMQ silently DROPS an add whose id already exists, so a
 * deterministic id would make a re-send vanish without an error whenever the
 * previous job hadn't been reaped yet. Double-sends are prevented by the
 * campaign's own status check in the controller, which can return a visible 409.
 */
export const queueNewsletterSend = async (campaignId, { scheduledFor = null, jobId = null } = {}) =>
  newsletterQueue.add(
    'sendNewsletter',
    { campaignId: String(campaignId) },
    {
      delay: scheduledFor ? Math.max(0, new Date(scheduledFor).getTime() - Date.now()) : 0,
      jobId: jobId || `nl:${campaignId}:${Date.now()}`,
      attempts: 1,
      removeOnComplete: true,
      // Bounded, unlike the older queues' `removeOnFail: false` — failed jobs
      // that accumulate forever are exactly the Redis cost this codebase is
      // careful about elsewhere.
      removeOnFail: { age: 7 * 24 * 3600 },
    }
  );

/** Remove a job that has not started. Never call this on an active one — see cancelNewsletter. */
export const cancelQueuedSend = async (jobId) => {
  if (!jobId) return false;
  try {
    const job = await newsletterQueue.getJob(jobId);
    if (!job) return false;
    await job.remove();
    return true;
  } catch (e) {
    console.warn(`[newsletter] Could not remove job ${jobId}:`, e.message);
    return false;
  }
};

/**
 * Boot reconciliation.
 *
 * A delayed job exists only in Redis. An eviction, a flush, or a plan migration
 * would make every scheduled campaign silently never fire — no error, no log,
 * just a newsletter that never went out. Mongo holds the durable intent, so on
 * startup we re-enqueue anything scheduled whose job has gone missing, and fire
 * anything whose window was missed while the process was down.
 *
 * Gated on runWorkers so three Cloud Run replicas don't each do it.
 */
const reconcileScheduledSends = async () => {
  try {
    const scheduled = await NewsletterCampaign.find({ status: 'scheduled', isArchived: false })
      .select('_id scheduledFor sendJobId')
      .lean();

    for (const campaign of scheduled) {
      const existing = campaign.sendJobId ? await newsletterQueue.getJob(campaign.sendJobId) : null;
      if (existing) continue;

      // A DETERMINISTIC id here, unlike a normal send. Cloud Run runs several
      // replicas and this reconciler is gated only on runWorkers, so all of them
      // boot, all of them find the same job missing, and all of them re-queue —
      // three copies of the same newsletter. BullMQ drops an add whose id
      // already exists, which is normally the footgun that makes us avoid fixed
      // ids; here it is precisely the lock we want, and it costs nothing because
      // campaign + scheduled time uniquely identify this one intended send.
      const job = await queueNewsletterSend(campaign._id, {
        scheduledFor: campaign.scheduledFor,
        jobId: `nl-fix:${campaign._id}:${new Date(campaign.scheduledFor).getTime()}`,
      });

      // job.id comes back as the existing job's id when another replica won the
      // race, so this stays correct either way.
      await NewsletterCampaign.updateOne({ _id: campaign._id }, { $set: { sendJobId: job.id } });
      console.log(`[newsletter] Re-queued scheduled campaign ${campaign._id} (its job was missing from Redis).`);
    }
  } catch (e) {
    console.warn('[newsletter] Could not reconcile scheduled sends:', e.message);
  }
};

export const startNewsletterReconciler = () => {
  if (!runWorkers) return;
  reconcileScheduledSends();
};
