import mongoose from 'mongoose';
import GithubTalentCampaign from '../models/GithubTalentCampaign.js';
import ProspectList from '../models/ProspectList.js';
import { generateKeywords } from '../services/scraper/githubTalentScraper.js';
import { queueGithubTalentCampaign } from '../services/pipeline/githubTalentQueue.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getCampaigns = async (req, res) => {
  try {
    const { search = '', limit = 20, page = 1 } = req.query;
    const query = { organization: req.organization._id, isArchived: false };

    if (search.trim()) {
      query.name = { $regex: escapeRegex(search.trim()), $options: 'i' };
    }

    const campaigns = await GithubTalentCampaign.find(query)
      .populate('prospectListId', 'prospects')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();

    const total = await GithubTalentCampaign.countDocuments(query);

    const formatted = campaigns.map(c => ({
      ...c,
      prospectCount: c.prospectListId?.prospects?.length || 0,
      prospectListId: c.prospectListId?._id || c.prospectListId
    }));

    res.json({
      success: true,
      data: formatted,
      pagination: { total, page: Number(page), limit: Number(limit) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCampaign = async (req, res) => {
  try {
    const campaign = await GithubTalentCampaign.findOne({
      _id: req.params.id,
      organization: req.organization._id,
      isArchived: false
    }).populate({
      path: 'prospectListId',
      populate: { path: 'prospects', select: '_id firstName lastName company pipelineStatus compatibilityScore outreachPriority scoreLabel' }
    }).lean();

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    res.json({
      success: true,
      data: {
        ...campaign,
        prospectCount: campaign.prospectListId?.prospects?.length || 0,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createCampaign = async (req, res) => {
  try {
    const { name, talentDescription, maxRepos, targetEcosystemContext, preferredAiModel } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Campaign name is required' });
    }

    const existing = await GithubTalentCampaign.findOne({
      organization: req.organization._id,
      name: { $regex: `^${escapeRegex(name.trim())}$`, $options: 'i' },
      isArchived: false
    });

    if (existing) {
      return res.status(400).json({ success: false, message: 'Campaign name already exists' });
    }

    // 1. Generate keywords
    const keywords = await generateKeywords(talentDescription, preferredAiModel);

    // 2. Create backing ProspectList
    const prospectList = await ProspectList.create({
      organization: req.organization._id,
      createdBy: req.user._id,
      name: `GTE: ${name.trim()}`,
      type: 'manual',
      campaignDescription: talentDescription,
      targetEcosystemContext,
      preferredAiModel,
      targetPersonas: [
        { name: 'Top-gun Developer', description: 'A highly skilled, active open-source engineer whose public repositories and contributions demonstrate strong technical depth in the target ecosystem.' },
        { name: 'Founder', description: 'A technical founder or co-founder building in the target ecosystem, who could become a client or hiring partner.' },
      ] // Default personas for GTE
    });

    // 3. Create GTE campaign
    const campaign = await GithubTalentCampaign.create({
      organization: req.organization._id,
      createdBy: req.user._id,
      name: name.trim(),
      talentDescription: talentDescription?.trim(),
      aiKeywords: keywords,
      maxRepos: maxRepos || 10,
      prospectListId: prospectList._id,
      campaignDescription: talentDescription,
      targetEcosystemContext,
      preferredAiModel
    });

    res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCampaign = async (req, res) => {
  try {
    const { name, talentDescription, maxRepos, targetEcosystemContext, preferredAiModel } = req.body;
    
    const campaign = await GithubTalentCampaign.findOne({
      _id: req.params.id,
      organization: req.organization._id,
      isArchived: false
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    if (name) {
       const existing = await GithubTalentCampaign.findOne({
          organization: req.organization._id,
          name: { $regex: `^${escapeRegex(name.trim())}$`, $options: 'i' },
          isArchived: false,
          _id: { $ne: campaign._id }
       });
       if (existing) return res.status(400).json({ success: false, message: 'Campaign name already exists' });
       campaign.name = name.trim();
    }

    let keywordsUpdated = false;
    if (talentDescription !== undefined && talentDescription !== campaign.talentDescription) {
       campaign.talentDescription = talentDescription.trim();
       campaign.campaignDescription = talentDescription.trim();
       
       // Regenerate keywords if description changes
       campaign.aiKeywords = await generateKeywords(talentDescription, preferredAiModel || campaign.preferredAiModel);
       keywordsUpdated = true;
    }

    if (maxRepos !== undefined) campaign.maxRepos = maxRepos;
    if (targetEcosystemContext !== undefined) campaign.targetEcosystemContext = targetEcosystemContext;
    if (preferredAiModel !== undefined) campaign.preferredAiModel = preferredAiModel;

    await campaign.save();
    
    // Update backing ProspectList
    if (campaign.prospectListId) {
      await ProspectList.findByIdAndUpdate(campaign.prospectListId, {
         name: `GTE: ${campaign.name}`,
         campaignDescription: campaign.campaignDescription,
         targetEcosystemContext: campaign.targetEcosystemContext,
         preferredAiModel: campaign.preferredAiModel
      });
    }

    res.json({ success: true, data: campaign, keywordsUpdated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const archiveCampaign = async (req, res) => {
  try {
    const campaign = await GithubTalentCampaign.findOneAndUpdate(
      { _id: req.params.id, organization: req.organization._id, isArchived: false },
      { isArchived: true, status: 'paused' },
      { new: true }
    );

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    if (campaign.prospectListId) {
       await ProspectList.findByIdAndUpdate(campaign.prospectListId, { isArchived: true });
    }

    res.json({ success: true, message: 'Campaign archived' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const runCampaign = async (req, res) => {
  try {
    const campaign = await GithubTalentCampaign.findOne({
      _id: req.params.id,
      organization: req.organization._id,
      isArchived: false
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    if (campaign.status === 'running') {
      return res.status(400).json({ success: false, message: 'Campaign is already running' });
    }

    campaign.status = 'idle'; // Reset status before run
    campaign.totalReposSearched = 0;
    campaign.totalContributorsFound = 0;
    campaign.totalProspectsCreated = 0;
    await campaign.save();

    await queueGithubTalentCampaign(campaign._id);

    res.json({ success: true, message: 'Campaign queued to run' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const pauseCampaign = async (req, res) => {
  try {
    const campaign = await GithubTalentCampaign.findOneAndUpdate(
      { _id: req.params.id, organization: req.organization._id, isArchived: false },
      { status: 'paused' },
      { new: true }
    );
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    res.json({ success: true, message: 'Campaign paused' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const resumeCampaign = async (req, res) => {
  try {
    const campaign = await GithubTalentCampaign.findOne({
      _id: req.params.id,
      organization: req.organization._id,
      isArchived: false
    });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    if (campaign.status === 'running') return res.status(400).json({ success: false, message: 'Already running' });
    
    // Do NOT reset stats. Just queue it again.
    await queueGithubTalentCampaign(campaign._id);
    res.json({ success: true, message: 'Campaign resumed' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCampaignStatus = async (req, res) => {
  try {
    const campaign = await GithubTalentCampaign.findOne({
      _id: req.params.id,
      organization: req.organization._id
    }).select('status totalReposSearched totalContributorsFound totalProspectsCreated lastRunAt');

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    res.json({ success: true, data: campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const generateKeywordsPreview = async (req, res) => {
  try {
    const { talentDescription, preferredAiModel = 'gemini' } = req.body;
    
    if (!talentDescription?.trim()) {
      return res.status(400).json({ success: false, message: 'Description is required' });
    }

    const keywords = await generateKeywords(talentDescription, preferredAiModel);
    
    res.json({ success: true, data: { keywords } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
