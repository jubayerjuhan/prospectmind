import mongoose from 'mongoose';
import { normalizeDomainKey, linkedinCompanyKey } from '../utils/domains.js';

/**
 * Company — a first-class module (HLD §2.2).
 *
 * A Company is analyzed independently of any Prospect and reused across every
 * prospect that belongs to it. Prospects reference a Company via `companyRef`;
 * they don't own it.
 *
 * ── Identity ────────────────────────────────────────────────────────────────
 * A company NAME is not an identity. "Kiln" is a staking company, a design
 * studio, and a piece of pottery equipment; keying on the name alone made two
 * unrelated companies physically impossible to represent and silently merged
 * them, so every prospect at either one got the other one's research.
 *
 * Identity is therefore keyed, in descending order of trust, on:
 *   1. linkedinKey — the employer's LinkedIn company slug. Exact and verifiable.
 *   2. domainKey   — the registrable domain (eTLD+1) of the official website.
 *   3. nameKey     — normalized name, used ONLY while neither key is known.
 *
 * The three partial unique indexes below encode that: a company holding a real
 * key is unique on that key, and name-uniqueness applies only to the remaining
 * unresolved placeholders. Two companies may share a nameKey once they are
 * distinguished by a real key — that is the case the old schema could not
 * express.
 */

const companySignalSchema = new mongoose.Schema(
  {
    // `signal` refs the Signal model (not built until a later phase). Mongoose
    // resolves refs lazily (only on populate), so this is safe to declare now.
    signal: { type: mongoose.Schema.Types.ObjectId, ref: 'Signal' },
    name: String, // denormalized signal name for display
    result: mongoose.Schema.Types.Mixed,
    confidence: Number,
    source: String,
    detectedAt: Date,
  },
  { _id: false }
);

const sourceRefSchema = new mongoose.Schema(
  {
    source: String, // e.g. "website", "serper", "linkedin"
    url: String,
    note: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const companySchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true, trim: true },
    // Normalized lowercase name. Still used for lookup and for placeholder
    // dedupe, but on its own it is NOT an identity — see the header.
    nameKey: { type: String, required: true, index: true },

    // ── Identity keys. '' means "unknown", never null (see the hook below). ──
    linkedinKey: { type: String, default: '' }, // 'kiln-fi' | 'id:1234567'
    linkedinUrl: { type: String, default: '' },
    domainKey: { type: String, default: '' }, // registrable domain, derived only

    website: { type: String, default: '' },
    domain: { type: String, default: '' },
    industry: { type: String, default: '' },
    size: { type: String, default: '' },
    headquarters: { type: String, default: '' },
    founded: { type: String, default: '' },

    // Set when we could not verify WHICH company this is. Surfaced in the UI
    // so an unverified record is never mistaken for a researched one.
    needsReview: { type: Boolean, default: false },
    reviewReason: { type: String, default: '' },

    // The company's applicant tracking system, once discovered. Cached so we
    // don't re-search for it every run; the role COUNT is re-read live each
    // time, since that is precisely the value that goes stale.
    atsBoard: {
      provider: { type: String, default: '' }, // 'ashby' | 'greenhouse' | 'lever' | …
      slug: { type: String, default: '' },
      url: { type: String, default: '' },
      openRoles: { type: Number, default: null },
      lastCheckedAt: Date,
    },

    aiAnalysis: {
      summary: { type: String, default: '' },
      lastAnalyzedAt: Date,
      // The identity key the stored summary actually describes. When it no
      // longer matches the company's current key the analysis is stale by
      // definition and re-runs itself — so a placeholder that later resolves
      // to a real company heals without a migration.
      analyzedForKey: { type: String, default: null },
      source: { type: String, enum: ['linkedin', 'web', 'none'], default: 'none' },
    },
    signals: { type: [companySignalSchema], default: [] },
    sourceRefs: { type: [sourceRefSchema], default: [] },
  },
  { timestamps: true }
);

// Derive the identity keys in ONE place. Several controllers accept a free-text
// `domain`/`website`; without this they would set the display value and leave
// the indexed key behind, silently defeating dedupe.
companySchema.pre('validate', function normalizeIdentityKeys() {
  if (this.isModified('domain') || this.isModified('website') || this.isNew) {
    const derived = normalizeDomainKey(this.domain || this.website || '');
    if (derived) this.domainKey = derived;
  }
  if (this.isModified('linkedinUrl') && this.linkedinUrl) {
    const derived = linkedinCompanyKey(this.linkedinUrl);
    if (derived) this.linkedinKey = derived;
  }
  // A null key would match NEITHER partial filter below and so escape both
  // unique constraints entirely. '' must be the only "unknown" value.
  if (this.domainKey == null) this.domainKey = '';
  if (this.linkedinKey == null) this.linkedinKey = '';
});

// $gt: '' is type-bracketed to strings, so it means exactly "non-empty string".
// ($ne is not permitted in a partialFilterExpression.) The three filters are
// complementary: every document falls under exactly one uniqueness rule.
companySchema.index(
  { organization: 1, linkedinKey: 1 },
  { unique: true, name: 'org_linkedinKey_unique', partialFilterExpression: { linkedinKey: { $gt: '' } } }
);
companySchema.index(
  { organization: 1, domainKey: 1 },
  { unique: true, name: 'org_domainKey_unique', partialFilterExpression: { domainKey: { $gt: '' } } }
);
// Name uniqueness applies ONLY to unresolved placeholders. Once two same-named
// companies each hold a real key they may legitimately coexist.
companySchema.index(
  { organization: 1, nameKey: 1 },
  { unique: true, name: 'org_nameKey_placeholder_unique', partialFilterExpression: { linkedinKey: '', domainKey: '' } }
);

// Plain lookup indexes. A partial index is only usable by the planner when the
// query provably implies its filter, so these carry the ordinary reads.
// Named explicitly: the auto-generated name would be "organization_1_nameKey_1",
// which is the LEGACY unique index the migration drops — same name, different
// definition, so the build would be rejected until then.
companySchema.index({ organization: 1, nameKey: 1 }, { name: 'org_nameKey_lookup' });
companySchema.index({ organization: 1, domainKey: 1 }, { name: 'org_domainKey_lookup' });
companySchema.index({ organization: 1, updatedAt: -1 });

const Company = mongoose.model('Company', companySchema);

// autoIndex is on, so these build at boot — and a unique build that fails on
// pre-existing duplicates otherwise only surfaces as an unheard 'index' event,
// leaving the server running with the constraint silently missing. Say so.
Company.on('index', (err) => {
  if (!err) return;
  console.error(
    `❌ [Company] Index build failed: ${err.message}\n` +
    '   Company identity uniqueness may NOT be enforced. If this reports duplicate\n' +
    '   keys, run "npm run db:reresolve-companies -- --apply" to merge the colliding\n' +
    '   records and switch the indexes, then restart.'
  );
});

export default Company;
