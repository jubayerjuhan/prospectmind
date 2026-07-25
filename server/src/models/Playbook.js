import mongoose from 'mongoose';

/**
 * Playbook — a first-class Setting (HLD §3.2).
 *
 * A Playbook defines HOW to communicate for a business objective ("Sell
 * GoodHive", "Recruit candidates", "Partnership outreach"…). Its user-authored
 * prompt carries the business context, value proposition, communication style,
 * messaging strategy, and call to action. Campaigns select a Playbook, and
 * outreach generation follows its prompt instead of hardcoded copy rules.
 */
const playbookSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    // User-authored AI prompt: business context, value prop, tone, strategy, CTA.
    prompt: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

playbookSchema.index({ organization: 1, name: 1 });
playbookSchema.index({ organization: 1, isActive: 1 });

export default mongoose.model('Playbook', playbookSchema);
