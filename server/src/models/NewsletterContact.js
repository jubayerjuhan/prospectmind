/**
 * Newsletter Contact — one recipient of one newsletter campaign.
 *
 * A separate collection rather than an array on the campaign. ProspectList gets
 * away with `prospects: [ObjectId]` because it stores nothing but ids; a
 * recipient carries per-send state, so embedding would rewrite the entire array
 * on every send, race with concurrent writes, and walk a few thousand
 * recipients toward the 16MB document ceiling. Its own collection buys cheap
 * pagination, a targeted updateOne per send, and a unique index for dedupe.
 *
 * Contacts are scoped to a single campaign by design (importing per campaign is
 * the workflow). Unsubscribes are NOT scoped that way — those live org-wide in
 * NewsletterSuppression, because a person who opts out must stay opted out no
 * matter which campaign re-imports their address.
 */

import mongoose from 'mongoose';

// 'sending' is a claim marker, not a user-facing state: the worker
// compare-and-swaps pending → sending so two workers can never grab the same
// recipient. See newsletterSender.js for how a row left stranded in it recovers.
export const CONTACT_STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped', 'unsubscribed'];

const newsletterContactSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'NewsletterCampaign', required: true, index: true },

    firstName: { type: String, default: '', trim: true },
    lastName: { type: String, default: '', trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    company: { type: String, default: '', trim: true },
    // Unmapped CSV columns land here and become merge tags of the same name.
    customFields: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    status: { type: String, enum: CONTACT_STATUSES, default: 'pending', index: true },
    sentAt: Date,
    error: String,
    // Kept so a bounce/complaint webhook, if one is ever added, has a key to
    // join back on. Nothing reads it today.
    resendMessageId: String,
  },
  { timestamps: true }
);

// Dedupe within a campaign. The import relies on this to absorb races, which is
// why it inserts with { ordered: false } rather than pre-checking.
newsletterContactSchema.index({ campaign: 1, email: 1 }, { unique: true });
// The send worker's cursor: { campaign, status: 'pending' }.
newsletterContactSchema.index({ campaign: 1, status: 1 });

export default mongoose.model('NewsletterContact', newsletterContactSchema);
