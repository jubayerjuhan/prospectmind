import mongoose from 'mongoose';

const enrichedProfileSchema = new mongoose.Schema(
  {
    // Identity
    linkedinUrl: String,
    xUrl: String,
    githubUrl: String,
    telegramHandle: String,
    website: String,
    email: String,
    ensAddress: String,

    // Confidence
    identityConfidenceScore: { type: Number, min: 0, max: 100 },

    // Technical (for talents)
    programmingLanguages: [String],
    blockchainEcosystems: [String],
    frameworks: [String],
    githubStats: {
      repos: Number,
      stars: Number,
      contributions: Number,
      topLanguages: [String],
    },

    // Professional
    currentRole: String,
    seniority: { type: String, enum: ['junior', 'mid', 'senior', 'lead', 'executive', 'unknown'] },
    yearsOfExperience: Number,
    previousCompanies: [String],
    founderExperience: Boolean,

    // Company (for clients)
    companySize: String,
    fundingStage: String,
    hiringActivity: Boolean,
    recentFundingAmount: String,
    openRoles: [String],

    // Community
    web3NativeScore: { type: Number, min: 0, max: 100 },
    daoInvolvement: [String],
    conferenceParticipation: [String],
    influenceLevel: { type: String, enum: ['low', 'medium', 'high', 'very_high', 'unknown'] },

    // Location
    location: String,

    // Experience history (work only)
    experience: [
      {
        title: String,
        company: String,
        duration: String,
        location: String,
        description: String,
        skills: [String],
        _id: false,
      },
    ],

    // Education (universities, institutes — separate from companies)
    education: [
      {
        institution: String,
        degree: String,
        _id: false,
      },
    ],

    // Bio / summary
    bio: String,
    recentActivity: [String],
  },
  { _id: false }
);

const outreachMessageSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ['email', 'linkedin', 'x', 'telegram'] },
    subject: String, // for email
    body: { type: String, required: true },
    status: { type: String, enum: ['draft', 'approved', 'sent', 'replied', 'rejected'], default: 'draft' },
    sentAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    editedBody: String, // human-edited version
  },
  { timestamps: true }
);

const prospectSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Raw input
    firstName: { type: String, required: true },
    lastName: String,
    company: String,
    typeHint: { type: String, enum: ['talent', 'client', 'unknown'], default: 'unknown' },

    // Raw contact hints (may be incomplete)
    rawEmail: String,
    rawLinkedin: String,
    rawX: String,
    rawTelegram: String,
    rawGithub: String,

    // Pipeline status
    pipelineStatus: {
      type: String,
      enum: ['pending', 'discovering', 'enriching', 'classifying', 'scoring', 'generating', 'ready', 'failed'],
      default: 'pending',
      index: true,
    },
    pipelineError: String,
    pipelineJobId: String,

    // Enriched data (populated by pipeline)
    enrichedProfile: enrichedProfileSchema,

    // Classification output
    roleClassification: [
      {
        type: String,
        enum: ['talent', 'client', 'mentor', 'advisor', 'influencer', 'founder', 'recruiter', 'hybrid'],
      },
    ],
    primaryAngle: String,
    secondaryAngle: String,

    // Scoring output
    compatibilityScore: { type: Number, min: 0, max: 100 },
    scoreLabel: {
      type: String,
      enum: ['strong_talent_match', 'high_potential_client', 'strategic_advisor', 'low_priority', 'not_relevant'],
    },
    scoreReasoning: String,
    outreachPriority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },

    // Best contact channel
    bestContactChannel: { type: String, enum: ['email', 'linkedin', 'x', 'telegram'] },

    // Generated messages
    messages: [outreachMessageSchema],

    // Tags for filtering
    tags: [String],
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

prospectSchema.index({ organization: 1, pipelineStatus: 1 });
prospectSchema.index({ organization: 1, compatibilityScore: -1 });
prospectSchema.index({ organization: 1, createdAt: -1 });

export default mongoose.model('Prospect', prospectSchema);
