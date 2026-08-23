/**
 * Reconcile prospects that *claim* to be running with what the queue actually holds.
 *
 * Before enrichment became opt-in, every created prospect was queued
 * immediately. Rows whose job was lost — a drained Redis, a replaced instance,
 * a crashed worker — kept their 'pending'/'enriching' status forever. Under the
 * new UI that is worse than cosmetic: the table shows a spinner and a Pause
 * button for work that nothing is doing, and Start is hidden because the row
 * does not look 'not-started'.
 *
 * This finds prospects in an active status with no corresponding BullMQ job and
 * puts them back to 'not-started', so they can be started deliberately.
 * Nothing that is genuinely queued or running is touched.
 *
 *   node scripts/reset-stale-pipeline-status.mjs                    # dry run (default)
 *   node scripts/reset-stale-pipeline-status.mjs --apply            # actually write
 *   node scripts/reset-stale-pipeline-status.mjs --status=pending   # narrow to one status
 */

// RUN_WORKERS must be false BEFORE queue.js is evaluated, or importing it starts
// a real worker that picks jobs off the shared queue — this script would then
// begin enriching prospects, and closing the connection at the end would kill a
// run mid-flight. Static `import` statements are hoisted and run before ANY
// statement in the file, so setting the env var at the top of the source is not
// enough: everything that reaches queue.js has to be imported dynamically,
// after the assignment below has actually executed.
process.env.RUN_WORKERS = 'false';

import 'dotenv/config';
import mongoose from 'mongoose';

const { default: connectDB } = await import('../src/config/db.js');
const { default: Prospect } = await import('../src/models/Prospect.js');
const { pipelineQueue } = await import('../src/services/pipeline/queue.js');
const { jobIdFor } = await import('../src/services/pipeline/jobId.js');

const ACTIVE = ['pending', 'discovering', 'enriching', 'classifying', 'scoring', 'generating'];

const run = async () => {
  const apply = process.argv.includes('--apply');
  const statusArg = process.argv.find((arg) => arg.startsWith('--status='))?.split('=')[1];
  if (statusArg && !ACTIVE.includes(statusArg)) {
    console.error(`--status must be one of: ${ACTIVE.join(', ')}`);
    process.exit(1);
  }
  const statuses = statusArg ? [statusArg] : ACTIVE;

  await connectDB();

  const candidates = await Prospect.find({ pipelineStatus: { $in: statuses } })
    .select('_id firstName lastName pipelineStatus organization')
    .lean();

  const stale = [];
  for (const prospect of candidates) {
    const job = await pipelineQueue.getJob(jobIdFor(prospect._id));
    if (!job) stale.push(prospect);
  }

  console.log(`${candidates.length} prospect(s) in an active status; ${stale.length} have no job in the queue.`);
  for (const p of stale.slice(0, 20)) {
    console.log(`  ${p._id}  ${p.firstName} ${p.lastName || ''} — ${p.pipelineStatus}`);
  }
  if (stale.length > 20) console.log(`  … and ${stale.length - 20} more`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to reset these to "not-started".');
  } else if (stale.length) {
    const res = await Prospect.updateMany(
      { _id: { $in: stale.map((p) => p._id) } },
      { $set: { pipelineStatus: 'not-started', pipelinePaused: false, pipelinePausedAt: null } }
    );
    console.log(`\nReset ${res.modifiedCount} prospect(s) to "not-started".`);
  }

  await pipelineQueue.close();
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
