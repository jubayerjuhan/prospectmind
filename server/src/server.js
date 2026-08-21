import 'dotenv/config';
import app from './app.js';
import connectDB from './config/db.js';
import { startUsageResetCron } from './services/cron/usageReset.js';
import { attachVncBridge } from './services/scraper/vncBridge.js';
import './services/pipeline/queue.js';
import './services/pipeline/githubTalentQueue.js';
import { startNewsletterReconciler } from './services/newsletter/newsletterQueue.js';

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();

  // Start background jobs
  startUsageResetCron();
  // Re-queues scheduled newsletters whose delayed job is missing from Redis.
  startNewsletterReconciler();
  import('./services/pipeline/queue.js');

  const server = app.listen(PORT, () => {
    console.log(`\n🚀 ProspectMind API running on http://localhost:${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });

  attachVncBridge(server);
};

start();
