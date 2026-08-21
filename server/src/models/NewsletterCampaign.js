/**
 * Newsletter Campaign — a one-off bulk email send.
 *
 * Deliberately NOT a ProspectList. A prospecting campaign is a targeting +
 * AI-strategy container whose members run the enrichment pipeline and consume
 * the org's prospect quota; a newsletter is a piece of content mailed to a list
 * of addresses somebody typed in. Sharing one model would have meant every
 * newsletter recipient becoming a Prospect, which is both expensive and wrong.
 *
 * Recipients live in NewsletterContact (a separate collection, keyed by
 * `campaign`), because each one carries per-send state and embedding a few
 * thousand of those would rewrite the whole document on every single send.
 */

import mongoose from 'mongoose';

export const NEWSLETTER_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'failed', 'canceled'];

const newsletterCampaignSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    name: { type: String, required: true, trim: true },

    // ── Content ───────────────────────────────────────────────────────────────
    subject: { type: String, default: '', trim: true },
    // Editor output. Sanitized on write (see newsletterController.applyContent),
    // so what is stored here is already safe to render.
    bodyHtml: { type: String, default: '' },
    // Plain-text alternative, derived from bodyHtml on every write. A real
    // text/plain part is a meaningful spam-filter signal and some corporate
    // gateways strip HTML entirely — see renderNewsletter.buildTextFromHtml.
    bodyText: { type: String, default: '' },

    // ── Sender identity ───────────────────────────────────────────────────────
    // Only the display name and reply-to vary per campaign; the envelope address
    // is always the verified RESEND_* domain, which is all Resend allows without
    // verifying another one. Empty means "fall back to the creator" at send time.
    fromName: { type: String, default: '', trim: true },
    replyTo: { type: String, default: '', trim: true },

    // ── Send state ────────────────────────────────────────────────────────────
    status: { type: String, enum: NEWSLETTER_STATUSES, default: 'draft', index: true },
    scheduledFor: Date,
    // BullMQ job id, so a scheduled send can be found and removed on cancel.
    sendJobId: String,
    startedAt: Date,
    completedAt: Date,
    // Denormalised counters. The gallery must not run a countDocuments per card
    // per poll — that is the cost getProspectLists pays today.
    stats: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
    error: String,

    isArchived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

newsletterCampaignSchema.index({ organization: 1, createdAt: -1 });
newsletterCampaignSchema.index({ organization: 1, name: 1 });

export default mongoose.model('NewsletterCampaign', newsletterCampaignSchema);
