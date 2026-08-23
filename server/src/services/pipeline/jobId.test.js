import test from 'node:test';
import assert from 'node:assert/strict';
import { jobIdFor } from './jobId.js';

test('a pipeline job id is accepted by BullMQ', () => {
  const id = jobIdFor('6a8b4a15af938e1dd24d40a6');

  // BullMQ namespaces its own Redis keys with ':' and rejects a custom id
  // containing one — with a throw that every caller swallows, because
  // queuePipelineRun is deliberately fire-and-forget. The prospect would then
  // sit at 'pending' forever with nothing but a log line to explain it.
  assert.ok(!id.includes(':'), 'job id must not contain a colon');
  assert.equal(id, 'prospect-6a8b4a15af938e1dd24d40a6');
});

test('one prospect maps to exactly one job id', () => {
  // This is what makes a queued run cancellable (pause) and makes a double
  // click on Start impossible to turn into two runs.
  assert.equal(jobIdFor('abc'), jobIdFor('abc'));
  assert.notEqual(jobIdFor('abc'), jobIdFor('abd'));
});
