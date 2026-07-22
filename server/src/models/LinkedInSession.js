import mongoose from 'mongoose';

// Singleton document — there is one shared LinkedIn scraping identity for the
// whole platform (mirrors the old single .linkedin-session.json file), not a
// per-organization resource. Always query/update with findOne({})/upsert,
// never scope by organization.
const linkedInSessionSchema = new mongoose.Schema(
  {
    cookies: { type: mongoose.Schema.Types.Mixed, default: null },
    // The LINKEDIN_LI_AT env value that was last reconciled into this session.
    // Lets the scraper tell "user pasted a new cookie into .env" (re-seed) apart
    // from steady state (keep using the richer, self-refreshing saved jar).
    seedLiAt: { type: String, default: null },
    // Defaults to 'dead' rather than 'active' — a freshly-created doc (e.g. via
    // notifyLinkedInSessionDead's debounce upsert, before any real session has
    // ever been saved) has no cookies yet and must not read as healthy.
    status: { type: String, enum: ['active', 'dead'], default: 'dead' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastVerifiedAt: Date,
    lastAlertSentAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model('LinkedInSession', linkedInSessionSchema);
