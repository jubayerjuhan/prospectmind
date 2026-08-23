/**
 * Pausing a run, in the two shapes it actually takes.
 *
 * A queued prospect and a running one need opposite treatment, and conflating
 * them is what made Pause feel broken: the old handler only set
 * `pipelinePaused`, so a prospect still sitting in the queue kept its 'pending'
 * badge until a worker eventually picked it up, noticed the flag and dropped
 * it — which, behind a concurrency-1 queue, could be many minutes later.
 *
 *  - Not started yet → remove it from the queue and mark it paused NOW. The
 *    user sees the state they asked for on the next poll.
 *  - Already running → cooperative. The runner checks between layers
 *    (pauseIfRequested), so the flag is all we can set; the prospect keeps its
 *    active status until the current layer returns. The UI renders that
 *    in-between state as "Pausing…" rather than pretending it stopped.
 */

import Prospect from '../../models/Prospect.js';
import { cancelQueuedPipelineRun } from './queue.js';

export const ACTIVE_PIPELINE_STATUSES = [
  'pending',
  'discovering',
  'enriching',
  'classifying',
  'scoring',
  'generating',
];

/**
 * @param {Object} prospect  A prospect document or lean object.
 * @returns {Promise<{ immediate: Boolean }>} immediate=true when the run was
 *   stopped before it began and the prospect is already 'paused'.
 */
export const pauseProspectRun = async (prospect) => {
  // Only a job that has not been picked up can be pulled out of the queue.
  // Once BullMQ locks it, remove() refuses and this returns false — so a run
  // that started between the click and this line still pauses correctly, just
  // cooperatively.
  const removedFromQueue =
    prospect.pipelineStatus === 'pending' ? await cancelQueuedPipelineRun(prospect._id) : false;

  await Prospect.findByIdAndUpdate(prospect._id, {
    pipelinePaused: true,
    pipelinePausedAt: new Date(),
    ...(removedFromQueue && { pipelineStatus: 'paused' }),
  });

  return { immediate: removedFromQueue };
};
