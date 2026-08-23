/**
 * The one job id a prospect's pipeline run is filed under.
 *
 * Lives in its own module so it can be unit-tested without importing queue.js,
 * which opens a Redis connection and (unless RUN_WORKERS=false) starts a worker.
 *
 * No colons: BullMQ namespaces its own Redis keys with ':' and rejects a custom
 * id containing one. Because queuePipelineRun is deliberately fire-and-forget,
 * that throw would surface only as a log line while the prospect sat at
 * 'pending' forever.
 */
export const jobIdFor = (prospectId) => `prospect-${prospectId}`;
