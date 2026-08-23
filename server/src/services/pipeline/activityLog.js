/**
 * Pipeline Activity Log — the user-facing narration of a pipeline run.
 *
 * The console logs the layers already write are for us: they name scrapers,
 * prompt sections and layer numbers. This is the parallel, plain-language
 * track that the prospect detail page renders live, so a user watching a run
 * sees "Reading their LinkedIn profile" instead of five minutes of
 * "Pipeline running: enriching…".
 *
 * Why AsyncLocalStorage: the layers that know the interesting details
 * (discovery, enrichment) sit several calls below runPipeline, and some of
 * them — scrapePage, searchGoogle — are shared with code that has no prospect
 * at all (company analysis, the GitHub talent queue). Threading a logger
 * parameter through all of it would touch every signature and still break the
 * moment a new caller forgets to pass it. A run-scoped store keeps the call
 * sites to one argument and makes logActivity() a silent no-op everywhere
 * outside a pipeline run. A module-level global could not do this: BullMQ can
 * run several prospects concurrently in one process, and their logs would
 * interleave onto whichever prospect started last.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import Prospect from '../../models/Prospect.js';

const storage = new AsyncLocalStorage();

// Keep the tail of a run rather than the head: when something goes wrong the
// user needs the steps just before the failure, not the opening line.
const ACTIVITY_LOG_LIMIT = 60;

/**
 * Run `fn` with an activity-log context bound to one prospect.
 * @param {String|import('mongoose').Types.ObjectId} prospectId
 * @param {Function} fn
 */
export const runWithActivityLog = (prospectId, fn) =>
  storage.run({ prospectId: String(prospectId) }, fn);

/**
 * Append one user-facing line to the current run's log.
 *
 * Fire-and-forget by design: narration must never slow down, or fail, the work
 * it is narrating. A dropped line is invisible; an awaited write on every step
 * would add a round-trip per line, and a thrown one would kill the run.
 *
 * @param {String} message  Plain language, no internals. Written for the user.
 * @param {Object} [opts]
 * @param {String} [opts.step]   Which stage this belongs to (see the schema enum).
 * @param {String} [opts.level]  'info' | 'success' | 'warn' | 'error'
 */
export const logActivity = (message, { step = 'enrichment', level = 'info' } = {}) => {
  const ctx = storage.getStore();
  if (!ctx?.prospectId || !message) return;

  Prospect.updateOne(
    { _id: ctx.prospectId },
    {
      $push: {
        pipelineActivity: {
          $each: [{ at: new Date(), step, message, level }],
          $slice: -ACTIVITY_LOG_LIMIT,
        },
      },
    }
  ).catch((err) => console.warn(`[activity] Failed to log "${message}": ${err.message}`));
};

/**
 * Drop the previous run's narration. Called once at the top of a run so a
 * re-run reads as a fresh trace instead of appending to a stale one.
 */
export const resetActivityLog = async (prospectId) => {
  await Prospect.updateOne({ _id: prospectId }, { $set: { pipelineActivity: [] } }).catch((err) =>
    console.warn(`[activity] Failed to reset log: ${err.message}`)
  );
};

/** Hostname of a URL, for messages that name a page without printing the URL. */
export const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
