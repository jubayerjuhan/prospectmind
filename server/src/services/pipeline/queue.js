import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { runPipeline } from './runner.js';
import 'dotenv/config';

// Initialize Redis connection for BullMQ (maxRetriesPerRequest must be null)
const connection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});

// Create the queue
export const pipelineQueue = new Queue('pipelineQueue', { connection });

// Define the worker that processes pipeline jobs
// Concurrency is set to 1 to run one job at a time and avoid AI rate limits
export const pipelineWorker = new Worker('pipelineQueue', async (job) => {
    const { prospectId } = job.data;
    try {
        await runPipeline(prospectId);
    } catch (err) {
        console.error(`Queue pipeline error for ${prospectId}:`, err.message);
        throw err;
    }
}, {
    connection,
    concurrency: 1 
});

pipelineWorker.on('failed', (job, err) => {
    console.error(`Pipeline Job ${job?.id} failed:`, err.message);
});

// Helper function to add a job to the queue
export const queuePipelineRun = async (prospectId) => {
    await pipelineQueue.add('runPipeline', { prospectId }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false
    });
};
