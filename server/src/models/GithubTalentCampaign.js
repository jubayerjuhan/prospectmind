import mongoose from 'mongoose';

const githubTalentCampaignSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    
    name: { type: String, required: true, trim: true },
    talentDescription: { type: String, default: '' },
    aiKeywords: [{ type: String, trim: true }],
    
    maxRepos: { type: Number, default: 10, min: 1, max: 30 },
    
    status: { 
      type: String, 
      enum: ['idle', 'running', 'paused', 'completed', 'failed'], 
      default: 'idle',
      index: true
    },
    
    lastRunAt: Date,
    totalReposSearched: { type: Number, default: 0 },
    totalContributorsFound: { type: Number, default: 0 },
    totalProspectsCreated: { type: Number, default: 0 },
    
    // The ProspectList created for this campaign's prospects
    prospectListId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProspectList' },
    
    // Campaign context passed to the AI pipeline scorer
    campaignDescription: { type: String, default: '' },
    targetEcosystemContext: { type: String, default: '' },
    preferredAiModel: { type: String, enum: ['gemini', 'groq', 'auto'], default: 'gemini' }, // Groq on hold — see claudeClient.js
    
    isArchived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

githubTalentCampaignSchema.index({ organization: 1, createdAt: -1 });

export default mongoose.model('GithubTalentCampaign', githubTalentCampaignSchema);
