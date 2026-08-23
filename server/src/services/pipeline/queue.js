import { Queue, Worker, UnrecoverableError } from 'bullmq';
import Redis from 'ioredis';
import { runPipeline } from './runner.js';
import { LinkedInAuthError } from '../../utils/pipelineErrors.js';
import { jobIdFor } from './jobId.js';
import 'dotenv/config';

// Initialize Redis connection for BullMQ (maxRetriesPerRequest must be null)
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  tls: redisUrl.includes('upstash.io') || redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
});

// Create the queue
export const pipelineQueue = new Queue('pipelineQueue', { connection });

// An idle BullMQ worker still costs Redis commands: one blocking BZPOPMIN per
// `drainDelay`, plus a stalled-job sweep per `stalledInterval`. On a per-request
// billed Redis (Upstash) with Cloud Run holding an instance warm 24/7, the
// defaults (5s / 30s) burn ~500 commands/hour per worker and exhaust the plan
// quota on their own. These values cut that ~7x. They do not delay job pickup:
// queue.add() sets the marker key, which wakes the blocked worker immediately.
// BullMQ throws if either value is not a positive number, so a malformed env
// var must fall back rather than take the server down at boot.
const positiveEnv = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const IDLE_POLL_OPTS = {
  drainDelay: positiveEnv('BULLMQ_DRAIN_DELAY', 60),              // seconds
  stalledInterval: positiveEnv('BULLMQ_STALLED_INTERVAL', 300000), // ms
};

// Workers are gated so that only the instance meant to process jobs polls Redis.
// Cloud Run scales the API to maxScale 3, and without this every instance runs
// its own pair of pollers, multiplying the Redis spend by the replica count.
export const runWorkers = process.env.RUN_WORKERS !== 'false';

// Define the worker that processes pipeline jobs
// Concurrency is set to 1 to run one job at a time and avoid AI rate limits
export const pipelineWorker = !runWorkers ? null : new Worker('pipelineQueue', async (job) => {
    const { prospectId } = job.data;
    try {
        await runPipeline(prospectId);
    } catch (err) {
        console.error(`Queue pipeline error for ${prospectId}:`, err.message);
        // LinkedIn auth failures (especially security checkpoints) must NOT be
        // retried — each retry fires another headless login that trips the same
        // checkpoint again and flags the account harder. Fail immediately.
        if (err instanceof LinkedInAuthError || err?.code === 'LINKEDIN_AUTH') {
            throw new UnrecoverableError(err.message);
        }
        throw err;
    }
}, {
    connection,
    concurrency: 1,
    ...IDLE_POLL_OPTS,
});

pipelineWorker?.on('failed', (job, err) => {
    console.error(`Pipeline Job ${job?.id} failed:`, err.message);
});

// One job id per prospect, so a queued run can be found again — pausing a
// prospect that has not started yet must actually take it OUT of the queue, not
// just mark it and let the worker pick it up minutes later. It also makes
// double-queueing impossible: two clicks on Start cannot enrich the same
// prospect twice.


// Helper function to add a job to the queue
export const queuePipelineRun = async (prospectId) => {
    const jobId = jobIdFor(prospectId);

    // BullMQ ignores add() for an id that still exists, and this queue keeps
    // failed jobs (removeOnFail: false). Without this remove, a prospect that
    // failed once could never be started again — the add would be silently
    // dropped and the UI would sit at "pending" forever.
    await pipelineQueue.remove(jobId).catch(() => {});

    await pipelineQueue.add('runPipeline', { prospectId }, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false
    });
};

/**
 * Take a prospect out of the queue if it has not started running yet.
 *
 * @returns {Promise<Boolean>} true if the job was removed before it began —
 *   the caller can then mark the prospect paused immediately. False means the
 *   job is already running (BullMQ refuses to remove a locked job) or was never
 *   queued, and the run has to be stopped the cooperative way, at the next
 *   layer boundary.
 */
export const cancelQueuedPipelineRun = async (prospectId) => {
    try {
        const job = await pipelineQueue.getJob(jobIdFor(prospectId));
        if (!job) return false;
        if (await job.isActive()) return false;
        await job.remove();
        return true;
    } catch (err) {
        console.warn(`[queue] Could not cancel queued run for ${prospectId}: ${err.message}`);
        return false;
    }
};
