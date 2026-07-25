import mongoose from 'mongoose';

/**
 * Signal — a first-class Setting (HLD §3.3).
 *
 * A Signal defines business information ProspectMind should detect (hiring
 * activity, funding, product launch, technology stack…). Its user-authored
 * prompt explains what to detect, where to look, and how to qualify the
 * result. A Signal applies to a Prospect, a Company, or both (`appliesTo`).
 *
 * Detection results are stored on the target object (e.g. Company.signals[]),
 * not here — this model is only the definition.
 */
const signalSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    // User-authored AI prompt: what to detect, where to look, how to qualify.
    prompt: { type: String, required: true, trim: true },
    appliesTo: {
      type: [{ type: String, enum: ['prospect', 'company'] }],
      default: ['company'],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'Signal must apply to at least one of: prospect, company.',
      },
    },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

signalSchema.index({ organization: 1, name: 1 });
signalSchema.index({ organization: 1, isActive: 1 });

export default mongoose.model('Signal', signalSchema);
