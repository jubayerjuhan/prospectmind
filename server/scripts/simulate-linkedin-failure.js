import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import LinkedInSession from '../src/models/LinkedInSession.js';

/**
 * Toggle the shared LinkedIn session's REPORTED health, so the dead-session
 * modal can be exercised without waiting for a real expiry.
 *
 * Safe to run against a working session: `status` is display-only. Nothing in
 * the scraper reads it — withLinkedInSession() authenticates off `cookies`,
 * which this never touches — and the next successful scrape calls saveSession()
 * and flips it back to 'active' on its own. `down` therefore changes what the
 * UI says, not whether scraping works.
 *
 *   node scripts/simulate-linkedin-failure.js down [context]
 *   node scripts/simulate-linkedin-failure.js up
 *   node scripts/simulate-linkedin-failure.js status
 *
 * context is one of: prospect-enrichment (default) | company-analysis |
 * company-linkedin-search — it selects which "what just broke" copy the modal
 * leads with.
 */

const CONTEXTS = ['prospect-enrichment', 'company-analysis', 'company-linkedin-search'];

const show = (doc) => {
  if (!doc) return console.log('No LinkedInSession document exists yet.');
  console.log({
    status: doc.status,
    cookieCount: Array.isArray(doc.cookies) ? doc.cookies.length : 0,
    lastVerifiedAt: doc.lastVerifiedAt,
    lastFailureAt: doc.lastFailureAt,
    lastFailureContext: doc.lastFailureContext,
  });
};

const run = async () => {
  const [, , action = 'status', context = 'prospect-enrichment'] = process.argv;

  if (!['down', 'up', 'status'].includes(action)) {
    console.error(`Unknown action "${action}". Use: down | up | status`);
    process.exit(1);
  }
  if (action === 'down' && !CONTEXTS.includes(context)) {
    console.error(`Unknown context "${context}". Use one of: ${CONTEXTS.join(', ')}`);
    process.exit(1);
  }

  await connectDB();

  if (action === 'status') {
    show(await LinkedInSession.findOne({}));
  }

  if (action === 'down') {
    // A fresh timestamp is what re-opens the modal for a user who already
    // dismissed an earlier failure, so re-running this always re-triggers it.
    const doc = await LinkedInSession.findOneAndUpdate(
      {},
      { status: 'dead', lastFailureAt: new Date(), lastFailureContext: context },
      { upsert: true, new: true }
    );
    console.log(`⚠️  Session reported DOWN as "${context}". Cookies untouched — scraping still works.`);
    show(doc);
    console.log('\nOpen the app (not /settings) — the modal appears within 60s, or instantly on reload.');
    console.log('Undo with: npm run linkedin:simulate-up');
  }

  if (action === 'up') {
    const doc = await LinkedInSession.findOneAndUpdate(
      {},
      { status: 'active', $unset: { lastFailureAt: '', lastFailureContext: '' } },
      { new: true }
    );
    console.log('✅ Session reported ACTIVE again.');
    show(doc);
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
