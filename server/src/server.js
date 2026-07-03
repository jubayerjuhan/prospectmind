import 'dotenv/config';
import app from './app.js';
import connectDB from './config/db.js';
import { startUsageResetCron } from './services/cron/usageReset.js';
import './services/pipeline/queue.js';
import './services/pipeline/githubTalentQueue.js';

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();

  // Start background jobs
  startUsageResetCron();
  import('./services/pipeline/queue.js');

  app.listen(PORT, () => {
    console.log(`\n🚀 ProspectMind API running on http://localhost:${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });
};

start();
