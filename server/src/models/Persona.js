import mongoose from 'mongoose';

/**
 * Persona — a first-class, reusable Setting (HLD §3.1).
 *
 * A Persona describes a *type* of prospect (Founder, CTO, Recruiter, Investor…)
 * and carries a user-authored AI prompt that explains how to recognize and
 * score that type. The pipeline's scoring layer runs each active Persona's
 * prompt against the enriched prospect + company data, producing a per-persona
 * score. This replaces the hardcoded scoring rubric so behavior is configurable
 * without changing core code.
 *
 * Personas are org-wide and reusable. A campaign selects the ones it targets
 * (`ProspectList.personas`); selecting none means every active Persona runs.
 */
const personaSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    // User-authored AI prompt: how to recognize and score this persona type.
    prompt: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

personaSchema.index({ organization: 1, name: 1 });
personaSchema.index({ organization: 1, isActive: 1 });

export default mongoose.model('Persona', personaSchema);
