import mongoose from 'mongoose';

/**
 * Company — a first-class module (HLD §2.2).
 *
 * A Company is analyzed independently of any Prospect and reused across every
 * prospect that belongs to it. Prospects reference a Company via `companyRef`;
 * they don't own it.
 *
 * Deduped per organization by `nameKey` (a normalized lowercase name), which
 * powers find-or-create so the same company isn't created twice.
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
    // Normalized lowercase name used for dedupe / find-or-create.
    nameKey: { type: String, required: true, index: true },
    website: { type: String, default: '' },
    domain: { type: String, default: '' },
    industry: { type: String, default: '' },
    size: { type: String, default: '' },
    aiAnalysis: {
      summary: { type: String, default: '' },
      lastAnalyzedAt: Date,
    },
    signals: { type: [companySignalSchema], default: [] },
    sourceRefs: { type: [sourceRefSchema], default: [] },
  },
  { timestamps: true }
);

// One company per normalized name per org — enables safe find-or-create upserts.
companySchema.index({ organization: 1, nameKey: 1 }, { unique: true });
companySchema.index({ organization: 1, updatedAt: -1 });

export default mongoose.model('Company', companySchema);
