/**
 * Monthly usage reset cron job
 * Runs at 00:00 on the 1st of every month.
 * Resets `usage.prospectsThisMonth` to 0 for all organizations.
 */
import cron from 'node-cron';
import Organization from '../../models/Organization.js';

export function startUsageResetCron() {
  // "0 0 1 * *" = at 00:00 on day-of-month 1
  cron.schedule('0 0 1 * *', async () => {
    console.log('[Cron] Running monthly usage reset…');
    try {
      const result = await Organization.updateMany(
        {},
        {
          $set: {
            'usage.prospectsThisMonth': 0,
            'usage.lastResetAt': new Date(),
          },
        }
      );
      console.log(`[Cron] ✅ Reset usage for ${result.modifiedCount} organizations.`);
    } catch (err) {
      console.error('[Cron] ❌ Usage reset failed:', err.message);
    }
  });

  console.log('📅 Monthly usage reset cron scheduled (1st of each month at 00:00)');
}
