/**
 * Newsletter Suppression — the org's permanent do-not-mail list.
 *
 * Keyed on the email address, not on a contact id, and living outside any one
 * campaign. That is the whole point: contacts belong to a single campaign, so
 * if an unsubscribe only flipped the contact row, the next CSV import would
 * silently re-subscribe someone who opted out. That is the mistake that gets a
 * sending domain blacklisted, so the record has to outlive both the contact and
 * the campaign that created it.
 *
 * `reason` is wider than what writes to it today ('unsubscribed' and 'manual');
 * 'bounced' / 'complained' are there for a Resend webhook that isn't built yet.
 */

import mongoose from 'mongoose';

export const SUPPRESSION_REASONS = ['unsubscribed', 'bounced', 'complained', 'manual'];

const newsletterSuppressionSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    reason: { type: String, enum: SUPPRESSION_REASONS, default: 'unsubscribed' },
    sourceCampaign: { type: mongoose.Schema.Types.ObjectId, ref: 'NewsletterCampaign' },
  },
  { timestamps: true }
);

newsletterSuppressionSchema.index({ organization: 1, email: 1 }, { unique: true });

export default mongoose.model('NewsletterSuppression', newsletterSuppressionSchema);
