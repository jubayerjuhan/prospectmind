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
    // "host:port" of the proxy this identity is pinned to. The session must be
    // used from the same exit IP that minted it — LinkedIn invalidates a session
    // whose IP jumps subnets, which bounces us to a checkpoint. Null means "not
    // pinned yet"; the next launch picks one and stores it here. Cleared with
    // the cookies, since a new identity may as well start on a fresh IP.
    proxy: { type: String, default: null },
    // Device-identity cookies (bcookie et al) kept separately from `cookies` so
    // they outlive a revoked session. Re-injected before a fresh login so
    // LinkedIn sees a returning device instead of demanding a new-device
    // challenge every single time. See services/scraper/linkedinBrowserIdentity.js.
    deviceCookies: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastVerifiedAt: Date,
    lastAlertSentAt: Date,
    // Stamped every time a pipeline step actually hits the dead session. The
    // client keys its blocking modal off this timestamp, so a fresh failure
    // re-opens the modal even for a user who dismissed the previous one —
    // `status` alone can't do that, since it stays 'dead' the whole time.
    lastFailureAt: Date,
    // Which step tripped it, so the modal can say what just broke rather than
    // only that something did.
    lastFailureContext: {
      type: String,
      enum: ['prospect-enrichment', 'company-analysis', 'company-linkedin-search', 'manual-revoke'],
    },
  },
  { timestamps: true }
);

export default mongoose.model('LinkedInSession', linkedInSessionSchema);
