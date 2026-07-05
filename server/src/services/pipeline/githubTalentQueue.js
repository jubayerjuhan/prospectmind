import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import 'dotenv/config';

import GithubTalentCampaign from '../../models/GithubTalentCampaign.js';
import Prospect from '../../models/Prospect.js';
import ProspectList from '../../models/ProspectList.js';
import Organization from '../../models/Organization.js';
import { queuePipelineRun } from './queue.js';
import { searchRepositories, fetchContributors, fetchUserProfile, buildProspectData } from '../scraper/githubTalentScraper.js';

// Initialize Redis connection for BullMQ
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  tls: redisUrl.includes('upstash.io') || redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
});

export const githubTalentQueue = new Queue('githubTalentQueue', { connection });

const delay = (ms) => new Promise(res => setTimeout(res, ms));

const processGithubTalentCampaign = async (campaignId) => {
  const campaign = await GithubTalentCampaign.findById(campaignId).populate('organization');
  if (!campaign) {
    console.error(`[githubTalentQueue] Campaign ${campaignId} not found`);
    return;
  }
  
  if (campaign.status === 'paused') {
    return;
  }
  
  const org = campaign.organization;
  const listId = campaign.prospectListId;

  try {
    await GithubTalentCampaign.findByIdAndUpdate(campaignId, { 
      status: 'running', 
      lastRunAt: new Date() 
    });

    console.log(`🚀 [GTE] Starting campaign: ${campaign.name} (Keywords: ${campaign.aiKeywords.join(', ')})`);

    // 1. Search Repositories
    const repos = await searchRepositories(campaign.aiKeywords, campaign.maxRepos);
    
    await GithubTalentCampaign.findByIdAndUpdate(campaignId, { 
      totalReposSearched: repos.length 
    });
    
    // 2. Fetch Contributors for each repo
    const uniqueContributors = new Map(); // dedupe by github login
    
    for (const repo of repos) {
      // Check if paused
      const currentCamp = await GithubTalentCampaign.findById(campaignId).select('status');
      if (currentCamp?.status === 'paused') break;

      const contributors = await fetchContributors(repo.fullName);
      for (const c of contributors) {
        if (!uniqueContributors.has(c.login)) {
          uniqueContributors.set(c.login, { ...c, sourceRepo: repo.fullName });
        }
      }
      
      await GithubTalentCampaign.findByIdAndUpdate(campaignId, { 
        totalContributorsFound: uniqueContributors.size 
      });
      
      await delay(500); // respect rate limits
    }

    console.log(`[GTE] Found ${uniqueContributors.size} unique contributors for campaign ${campaign.name}`);
    
    // 3. Process Contributors and Create Prospects
    let createdCount = 0;
    const prospectIds = [];
    
    for (const contributor of uniqueContributors.values()) {
      // Check pause
      const currentCamp = await GithubTalentCampaign.findById(campaignId).select('status');
      if (currentCamp?.status === 'paused') break;

      // HARD DEMO LIMIT: Stop after 5 to prevent AI rate limits
      if (createdCount >= 5) {
        console.log(`[GTE] Hard limit of 5 prospects reached for demo/rate-limits. Stopping.`);
        break;
      }

      // Check plan limits
      const updatedOrg = await Organization.findById(org._id);
      if (!updatedOrg.canAddProspect()) {
        console.warn(`[GTE] Plan limit reached for org ${org.name}. Stopping prospect creation.`);
        break; // Stop creating, plan limit hit
      }
      
      const githubUrl = `https://github.com/${contributor.login}`;
      
      // Org-level dedup: Check if prospect already exists
      const existingProspect = await Prospect.findOne({
        organization: org._id,
        rawGithub: githubUrl
      }).select('_id');
      
      if (existingProspect) {
        // Prospect exists. Add to this campaign's list if not already there, but do NOT re-create or re-enrich
        if (listId) {
          await ProspectList.findByIdAndUpdate(listId, {
            $addToSet: { prospects: existingProspect._id }
          });
        }
        continue;
      }
      
      // Fetch full user profile
      const userProfile = await fetchUserProfile(contributor.login);
      if (!userProfile) continue;
      
      // Build prospect data
      const sourceContext = `Discovered via GTE campaign "${campaign.name}" in repo ${contributor.sourceRepo}`;
      const prospectData = buildProspectData(userProfile, sourceContext);
      
      // Create prospect
      const prospect = new Prospect({
        organization: org._id,
        createdBy: campaign.createdBy,
        ...prospectData,
        pipelineStatus: 'pending'
      });
      
      await prospect.save();
      createdCount++;
      
      // Instantly add to ProspectList so it shows up in UI immediately
      if (listId) {
        await ProspectList.findByIdAndUpdate(listId, {
          $addToSet: { prospects: prospect._id }
        });
      }
      
      // Enqueue for AI Pipeline
      await queuePipelineRun(prospect._id);
      
      await GithubTalentCampaign.findByIdAndUpdate(campaignId, { 
        totalProspectsCreated: campaign.totalProspectsCreated + createdCount 
      });
      
      await delay(300); // small delay between profile fetches
    }
    
    // 5. Mark Completed
    const finalCamp = await GithubTalentCampaign.findById(campaignId).select('status');
    if (finalCamp?.status !== 'paused') {
      await GithubTalentCampaign.findByIdAndUpdate(campaignId, { 
        status: 'completed'
      });
      console.log(`✅ [GTE] Campaign ${campaign.name} completed! Created ${createdCount} new prospects.`);
    } else {
      console.log(`⏸️ [GTE] Campaign ${campaign.name} paused.`);
    }

  } catch (err) {
    console.error(`❌ [GTE] Campaign ${campaignId} failed:`, err);
    await GithubTalentCampaign.findByIdAndUpdate(campaignId, { 
      status: 'failed'
    });
  }
};

export const githubTalentWorker = new Worker('githubTalentQueue', async (job) => {
    const { campaignId } = job.data;
    await processGithubTalentCampaign(campaignId);
}, {
    connection,
    concurrency: 1 
});

githubTalentWorker.on('failed', (job, err) => {
    console.error(`GithubTalentQueue Job ${job?.id} failed:`, err.message);
});

export const queueGithubTalentCampaign = async (campaignId) => {
    await githubTalentQueue.add('runGteCampaign', { campaignId }, {
        attempts: 1, // Don't retry automatically to avoid massive re-scraping
        removeOnComplete: true,
        removeOnFail: false
    });
};
