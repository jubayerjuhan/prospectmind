import mongoose from 'mongoose';

/**
 * Campaign (stored as `ProspectList` for backwards compatibility).
 *
 * A Campaign is the single unit of work in the product: it holds the target
 * prospects, the goal ("what we want out of this"), the strategy selected from
 * Settings (Personas / Playbooks / Signals), and the outreach sequence plus its
 * generated messages. Outreach used to live in a separate `Campaign` model with
 * its own page — that split is gone; everything hangs off this document now.
 */

const OUTREACH_CHANNELS = ['email', 'linkedin', 'x', 'telegram'];

const dynamicFilterSchema = new mongoose.Schema(
  {
    search: { type: String, trim: true, default: '' },
    status: { type: String, trim: true, default: '' },
    priority: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const sequenceStepSchema = new mongoose.Schema(
  {
    stepOrder: { type: Number, required: true, min: 1 },
    channel: { type: String, enum: OUTREACH_CHANNELS, required: true },
    delayDays: { type: Number, default: 0, min: 0 }, // days after the previous step
  },
  { _id: false }
);

const generatedMessageSchema = new mongoose.Schema(
  {
    stepOrder: Number,
    channel: { type: String, enum: OUTREACH_CHANNELS },
    delayDays: Number,
    subject: String, // email only
    body: String,
  },
  { _id: false }
);

const outreachResultSchema = new mongoose.Schema(
  {
    prospect: { type: mongoose.Schema.Types.ObjectId, ref: 'Prospect' },
    prospectName: String, // denormalized for display
    status: { type: String, enum: ['generated', 'skipped'], default: 'generated' },
    skipReason: String,
    personaName: String, // which persona this prospect was addressed as
    personaScore: Number, // that persona's stored score for this prospect
    messages: { type: [generatedMessageSchema], default: [] },
    generatedAt: Date,
  },
  { _id: false }
);

const outreachSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['idle', 'generating', 'ready', 'failed'], default: 'idle' },
    playbook: { type: mongoose.Schema.Types.ObjectId, ref: 'Playbook' }, // playbook used for the last run
    lastGeneratedAt: Date,
    error: String,
    results: { type: [outreachResultSchema], default: [] },
  },
  { _id: false }
);

const prospectListSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['manual', 'dynamic'], default: 'manual', index: true },
    prospects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Prospect' }],
    filters: { type: dynamicFilterSchema, default: undefined },
    isArchived: { type: Boolean, default: false, index: true },
    // ── Campaign goal + AI settings ──────────────────────────────────────────
    campaignDescription: { type: String, default: '' }, // Natural-language campaign goals for AI scoring/outreach
    targetEcosystemContext: { type: String, default: '' }, // Free-text ecosystem/context hint fed into the pipeline
    preferredAiModel: { type: String, enum: ['gemini', 'groq', 'auto'], default: 'gemini' }, // Preferred AI provider for pipeline runs (Groq on hold — see claudeClient.js)
    // ── Strategy: reusable prompt settings selected for this campaign ────────
    // Empty means "use every active one in the org" so existing campaigns keep
    // behaving exactly as before this became selectable.
    personas: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Persona' }],
    playbooks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Playbook' }],
    signals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Signal' }],
    // ── Outreach (merged in from the old standalone Campaign model) ──────────
    sequence: {
      type: [sequenceStepSchema],
      default: () => [{ stepOrder: 1, channel: 'email', delayDays: 0 }],
    },
    outreach: { type: outreachSchema, default: () => ({}) },
  },
  { timestamps: true }
);

prospectListSchema.index({ organization: 1, name: 1 });
prospectListSchema.index({ organization: 1, createdAt: -1 });
prospectListSchema.index({ organization: 1, type: 1, isArchived: 1 });

prospectListSchema.pre('validate', function () {
  if (this.type === 'manual') {
    this.filters = undefined;
  }

  if (this.type === 'dynamic') {
    this.prospects = [];
  }
});

export { OUTREACH_CHANNELS };
export default mongoose.model('ProspectList', prospectListSchema);
