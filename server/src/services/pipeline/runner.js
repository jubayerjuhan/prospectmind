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
import { generateOutreachMessages } from './outreach.js';

const updateStatus = async (prospectId, status, extra = {}) => {
  await Prospect.findByIdAndUpdate(prospectId, { pipelineStatus: status, ...extra });
};

export const runPipeline = async (prospectId) => {
  const prospect = await Prospect.findById(prospectId);
  if (!prospect) throw new Error(`Prospect ${prospectId} not found`);

  console.log(`🚀 Pipeline starting for: ${prospect.firstName} ${prospect.lastName}`);

  try {
    // ── Layer 1: Identity Resolution ────────────────────────────────────────
    await updateStatus(prospectId, 'discovering');
    console.log('  → Layer 1: Identity Resolution');
    const identity = await resolveIdentity(prospect);

    // ── Layer 2: Enrichment ─────────────────────────────────────────────────
    await updateStatus(prospectId, 'enriching');
    console.log('  → Layer 2: Profile Enrichment');
    const enrichedProfile = await enrichProfile(prospect, identity);

    // ── Layer 3: Classification ─────────────────────────────────────────────
    await updateStatus(prospectId, 'classifying');
    console.log('  → Layer 3: Classification');
    const classification = await classifyProfile(prospect, enrichedProfile);

    // ── Layer 4: Scoring ────────────────────────────────────────────────────
    await updateStatus(prospectId, 'scoring');
    console.log('  → Layer 4: Scoring');
    const scoring = await scoreProfile(prospect, enrichedProfile, classification);

    // ── Layer 5: Outreach Generation ────────────────────────────────────────
    await updateStatus(prospectId, 'generating');
    console.log('  → Layer 5: Message Generation');
    const messages = await generateOutreachMessages(prospect, enrichedProfile, classification, scoring);

    // ── Save results ────────────────────────────────────────────────────────
    await Prospect.findByIdAndUpdate(prospectId, {
      pipelineStatus: 'ready',
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
    await updateStatus(prospectId, 'failed', { pipelineError: error.message });
    throw error;
  }
};
