import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    logo: { type: String },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        role: { type: String, enum: ['admin', 'member'], default: 'member' },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
    // Billing
    stripeCustomerId: { type: String },
    stripeSubscriptionId: { type: String },
    plan: { type: String, enum: ['free', 'pro', 'enterprise'], default: 'free' },
    planStatus: { type: String, enum: ['active', 'canceled', 'past_due', 'trialing'], default: 'active' },
    planRenewsAt: { type: Date },
    // Usage limits
    usage: {
      prospectsThisMonth: { type: Number, default: 0 },
      lastResetAt: { type: Date, default: Date.now },
    },
    // ── API key ──────────────────────────────────────────────────────────────
    // For external tools (lemlist and friends) pulling generated outreach.
    // A JWT cannot serve here: the access token expires in 15 minutes and no
    // third-party integration can run the refresh dance.
    //
    // Only a SHA-256 hash is stored. The plaintext key is shown once, at
    // creation, and is unrecoverable afterwards — a leaked database must not
    // hand out live credentials to every customer's prospect data.
    apiKey: {
      hash: { type: String, index: true, sparse: true },
      last4: String,          // so the UI can identify which key is installed
      createdAt: Date,
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      lastUsedAt: Date,       // the cheapest way to answer "is the integration live?"
    },

    // Settings
    settings: {
      defaultEcosystem: { type: String, default: 'web3' }, // web3 | web2 | any
      autoEnrich: { type: Boolean, default: false },
      outreachReviewRequired: { type: Boolean, default: true },
      icpRules: { type: String, default: '' }, // Deprecated, use campaignDescription
      campaignDescription: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

// Plan limits
organizationSchema.methods.getProspectLimit = function() {
  const limits = { free: 100, pro: 500, enterprise: Infinity };
  return limits[this.plan] || 100;
};

organizationSchema.methods.canAddProspect = function () {
  return this.usage.prospectsThisMonth < this.getProspectLimit();
};

export default mongoose.model('Organization', organizationSchema);
