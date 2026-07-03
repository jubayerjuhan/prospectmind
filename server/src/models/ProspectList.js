import mongoose from 'mongoose';

const dynamicFilterSchema = new mongoose.Schema(
  {
    search: { type: String, trim: true, default: '' },
    status: { type: String, trim: true, default: '' },
    priority: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const prospectListSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['manual', 'dynamic'], default: 'manual', index: true },
    prospects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Prospect' }],
    filters: { type: dynamicFilterSchema, default: undefined },
    isArchived: { type: Boolean, default: false, index: true },
    // Per-campaign AI settings
    campaignDescription: { type: String, default: '' }, // Natural-language campaign goals for AI scoring/outreach
    targetEcosystemContext: { type: String, default: '' }, // Free-text ecosystem/context hint fed into the pipeline
    targetPersonas: [{ type: String, trim: true }], // Free-form persona labels (e.g. 'Startup', 'VC', 'Recruiter')
    preferredAiModel: { type: String, enum: ['gemini', 'groq', 'auto'], default: 'auto' }, // Preferred AI provider for pipeline runs
  },
  { timestamps: true }
);

prospectListSchema.index({ organization: 1, name: 1 });
prospectListSchema.index({ organization: 1, createdAt: -1 });
prospectListSchema.index({ organization: 1, type: 1, isArchived: 1 });

prospectListSchema.pre('validate', function () {
  if (this.type === 'manual') {
    this.filters = undefined;
  }

  if (this.type === 'dynamic') {
    this.prospects = [];
  }
});

export default mongoose.model('ProspectList', prospectListSchema);
