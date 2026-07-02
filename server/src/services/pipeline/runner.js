/**
 * Pipeline Runner — orchestrates all 5 layers for a single prospect.
 * Updates the prospect document at each stage.
 */

import Prospect from '../../models/Prospect.js';
import Organization from '../../models/Organization.js';
import { resolveIdentity } from './discovery.js';
import { enrichProfile } from './enrichment.js';
import { classifyProfile } from './classifier.js';
import { scoreProfile } from './scorer.js';

const updateStatus = async (prospectId, status, extra = {}) => {
  await Prospect.findByIdAndUpdate(prospectId, { pipelineStatus: status, ...extra });
};

const pauseIfRequested = async (prospectId) => {
  const current = await Prospect.findById(prospectId).select('pipelinePaused');
  if (!current?.pipelinePaused) return false;

  await Prospect.findByIdAndUpdate(prospectId, {
    pipelineStatus: 'paused',
    pipelinePausedAt: new Date(),
  });
  return true;
};

export const runPipeline = async (prospectId) => {
  const prospect = await Prospect.findById(prospectId);
  if (!prospect) throw new Error(`Prospect ${prospectId} not found`);

  if (prospect.pipelinePaused) {
    await Prospect.findByIdAndUpdate(prospectId, {
      pipelineStatus: 'paused',
      pipelinePausedAt: prospect.pipelinePausedAt || new Date(),
    });
    return { success: false, paused: true, prospectId };
  }

  // Load organization to retrieve campaign goals/descriptions
  const org = await Organization.findById(prospect.organization);
  const campaignDescription = org?.settings?.campaignDescription || org?.settings?.icpRules || '';

  console.log(`🚀 Pipeline starting for: ${prospect.firstName} ${prospect.lastName}`);

  try {
    await Prospect.findByIdAndUpdate(prospectId, {
      pipelinePaused: false,
      pipelinePausedAt: null,
      pipelineError: null,
    });

    // ── Layer 1: Identity Resolution ────────────────────────────────────────
    await updateStatus(prospectId, 'discovering');
    console.log('  → Layer 1: Identity Resolution');
    const identity = await resolveIdentity(prospect);
    if (await pauseIfRequested(prospectId)) return { success: false, paused: true, prospectId };

    // ── Layer 2: Enrichment ─────────────────────────────────────────────────
    await updateStatus(prospectId, 'enriching');
    console.log('  → Layer 2: Profile Enrichment');
    const enrichedProfile = await enrichProfile(prospect, identity);
    if (await pauseIfRequested(prospectId)) return { success: false, paused: true, prospectId };

    // ── Layer 3: Classification ─────────────────────────────────────────────
    await updateStatus(prospectId, 'classifying');
    console.log('  → Layer 3: Classification');
    const classification = await classifyProfile(prospect, enrichedProfile);
    if (await pauseIfRequested(prospectId)) return { success: false, paused: true, prospectId };

    // ── Layer 4: Scoring ────────────────────────────────────────────────────
    await updateStatus(prospectId, 'scoring');
    console.log('  → Layer 4: Scoring');
    const scoring = await scoreProfile(prospect, enrichedProfile, classification, campaignDescription);
    if (await pauseIfRequested(prospectId)) return { success: false, paused: true, prospectId };

    // ── Layer 5: Outreach Generation (SKIPPED INITIALLY) ────────────────────
    // We now skip this by default to save tokens. User can trigger manually later.
    const messages = [];

    // ── Save results ────────────────────────────────────────────────────────
    if (await pauseIfRequested(prospectId)) return { success: false, paused: true, prospectId };
    await Prospect.findByIdAndUpdate(prospectId, {
      pipelineStatus: 'ready',
      pipelinePaused: false,
      pipelinePausedAt: null,
      pipelineError: null,
      enrichedProfile,
      roleClassification: classification.roleClassification || [],
      primaryAngle: classification.primaryAngle,
      secondaryAngle: classification.secondaryAngle,
      compatibilityScore: scoring.compatibilityScore,
      scoreLabel: scoring.scoreLabel,
      scoreReasoning: scoring.scoreReasoning,
      outreachPriority: scoring.outreachPriority,
      bestContactChannel: scoring.bestContactChannel,
      messages,
    });

    // Update org usage counter
    await Organization.findByIdAndUpdate(prospect.organization, {
      $inc: { 'usage.prospectsThisMonth': 1 },
    });

    console.log(`  ✅ Pipeline complete. Score: ${scoring.compatibilityScore}/100`);
    return { success: true, prospectId };
  } catch (error) {
    console.error(`  ❌ Pipeline failed:`, error.message);
    const latest = await Prospect.findById(prospectId).select('pipelinePaused pipelinePausedAt pipelineStatus');
    if (latest?.pipelinePaused || latest?.pipelineStatus === 'paused') {
      await Prospect.findByIdAndUpdate(prospectId, {
        pipelineStatus: 'paused',
        pipelinePausedAt: latest.pipelinePausedAt || new Date(),
      });
      return { success: false, paused: true, prospectId };
    }

    await updateStatus(prospectId, 'failed', { pipelineError: error.message });
    throw error;
  }
};
