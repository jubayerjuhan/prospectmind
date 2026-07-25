import mongoose from 'mongoose';

/**
 * Campaign — pure orchestration (v2 Phase D, HLD §2.3).
 *
 * A Campaign defines HOW ProspectMind communicates: which prospects to target
 * (via a ProspectList), which Persona to focus on, which Playbook to use,
 * which channels, and the sequence timing. A Campaign NEVER analyzes — its
 * execution only reads knowledge already stored on Prospects and Companies.
 *
 * Note: distinct from ProspectList (which the legacy UI calls a "campaign") —
 * that is the target-list + pipeline-context object; this is the outreach
 * orchestration layer on top of it.
 */

const CHANNELS = ['email', 'linkedin', 'x', 'telegram'];

const sequenceStepSchema = new mongoose.Schema(
  {
    stepOrder: { type: Number, required: true, min: 1 },
    channel: { type: String, enum: CHANNELS, required: true },
    delayDays: { type: Number, default: 0, min: 0 }, // days after the previous step
  },
  { _id: false }
);

const generatedMessageSchema = new mongoose.Schema(
  {
    stepOrder: Number,
    channel: { type: String, enum: CHANNELS },
    delayDays: Number,
    subject: String, // email only
    body: String,
  },
  { _id: false }
);

const resultSchema = new mongoose.Schema(
  {
    prospect: { type: mongoose.Schema.Types.ObjectId, ref: 'Prospect' },
    prospectName: String, // denormalized for display
    status: { type: String, enum: ['generated', 'skipped'], default: 'generated' },
    skipReason: String,
    personaScore: Number, // this prospect's stored score for the campaign persona
    messages: { type: [generatedMessageSchema], default: [] },
    generatedAt: Date,
  },
  { _id: false }
);

const campaignSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    targetList: { type: mongoose.Schema.Types.ObjectId, ref: 'ProspectList', required: true },
    persona: { type: mongoose.Schema.Types.ObjectId, ref: 'Persona', required: true },
    playbook: { type: mongoose.Schema.Types.ObjectId, ref: 'Playbook', required: true },
    sequence: {
      type: [sequenceStepSchema],
      default: [{ stepOrder: 1, channel: 'email', delayDays: 0 }],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'Campaign needs at least one sequence step.',
      },
    },
    status: {
      type: String,
      enum: ['draft', 'generating', 'ready', 'failed'],
      default: 'draft',
      index: true,
    },
    executionError: String,
    lastExecutedAt: Date,
    results: { type: [resultSchema], default: [] },
  },
  { timestamps: true }
);

campaignSchema.index({ organization: 1, createdAt: -1 });

export default mongoose.model('Campaign', campaignSchema);
