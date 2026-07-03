/**
 * Pipeline Runner — orchestrates all 5 layers for a single prospect.
 * Updates the prospect document at each stage.
 */

import Prospect from '../../models/Prospect.js';
import Organization from '../../models/Organization.js';
import ProspectList from '../../models/ProspectList.js';
import { askAI } from '../ai/claudeClient.js';
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

/**
 * Build a callAI function bound to the campaign's preferred provider.
 * Tracks which provider was actually used for the first successful call.
 */
const buildAIContext = (preferredProvider = 'auto') => {
  let firstProviderUsed = null;

  const callAI = async (options) => {
    const { result, providerUsed } = await askAI(options, { preferredProvider });
    if (!firstProviderUsed) {
      firstProviderUsed = providerUsed;
    }
    return result;
  };

  const getProviderUsed = () => firstProviderUsed || 'groq';

  return { callAI, getProviderUsed };
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

  // Load organization settings
  const org = await Organization.findById(prospect.organization);

  // Resolve campaign-level settings — prefer the first manual campaign containing this prospect
  const campaignList = await ProspectList.findOne({
    organization: prospect.organization,
    type: 'manual',
    isArchived: false,
    prospects: prospect._id,
  }).lean();

  const campaignDescription =
    (campaignList?.campaignDescription?.trim()) ||
    org?.settings?.campaignDescription ||
    org?.settings?.icpRules ||
    '';

  const targetEcosystemContext =
    (campaignList?.targetEcosystemContext?.trim()) ||
    org?.settings?.defaultEcosystem ||
    '';

  const personaContext = campaignList?.targetPersonas?.length
    ? `Target Personas for this campaign: ${campaignList.targetPersonas.join(', ')}`
    : '';

  const fullCampaignContext = [
    campaignDescription,
    targetEcosystemContext ? `Target Ecosystem / Context: ${targetEcosystemContext}` : '',
    personaContext,
  ]
    .filter(Boolean)
    .join('\n\n');

  // Optional user-provided context about this specific prospect
  const prospectContext = prospect.description?.trim()
    ? `Additional context provided by user about this person: ${prospect.description.trim()}`
    : '';

  // Read the campaign's preferred AI model ('gemini' | 'groq' | 'auto')
  const preferredAiModel = campaignList?.preferredAiModel || 'auto';
  const { callAI, getProviderUsed } = buildAIContext(preferredAiModel);

  console.log(`🚀 Pipeline starting for: ${prospect.firstName} ${prospect.lastName} [AI: ${preferredAiModel}]`);

  try {
    await Prospect.findByIdAndUpdate(prospectId, {
      pipelinePaused: false,
      pipelinePausedAt: null,
      pipelineError: null,
    });

    // ── Layer 1: Identity Resolution ────────────────────────────────────────
    await updateStatus(prospectId, 'discovering');
    console.log('  → Layer 1: Identity Resolution');
    const identity = await resolveIdentity(prospect, { callAI, prospectContext });
    if (await pauseIfRequested(prospectId)) return { success: false, paused: true, prospectId };

    // ── Layer 2: Enrichment ─────────────────────────────────────────────────
    await updateStatus(prospectId, 'enriching');
    console.log('  → Layer 2: Profile Enrichment');
    const enrichedProfile = await enrichProfile(prospect, identity, { callAI, prospectContext });
    if (await pauseIfRequested(prospectId)) return { success: false, paused: true, prospectId };

    // ── Layer 3: Classification ─────────────────────────────────────────────
    await updateStatus(prospectId, 'classifying');
    console.log('  → Layer 3: Classification');
    const classification = await classifyProfile(prospect, enrichedProfile, { callAI });
    if (await pauseIfRequested(prospectId)) return { success: false, paused: true, prospectId };

    // ── Layer 4: Scoring ────────────────────────────────────────────────────
    await updateStatus(prospectId, 'scoring');
    console.log('  → Layer 4: Scoring');
    const scoring = await scoreProfile(prospect, enrichedProfile, classification, fullCampaignContext, { callAI });
    if (await pauseIfRequested(prospectId)) return { success: false, paused: true, prospectId };

    // ── Layer 5: Outreach Generation (SKIPPED INITIALLY) ────────────────────
    // We now skip this by default to save tokens. User can trigger manually later.
    const messages = [];

    // ── Save results ────────────────────────────────────────────────────────
    if (await pauseIfRequested(prospectId)) return { success: false, paused: true, prospectId };
    
    const isFallbackData = Boolean(
      identity.__isFallback ||
      enrichedProfile.__isFallback ||
      classification.__isFallback ||
      scoring.__isFallback
    );

    // Determine the AI provider used; 'fallback' if isFallbackData path was hit
    const aiProviderUsed = isFallbackData ? 'fallback' : getProviderUsed();

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
      scoreBreakdown: scoring.scoreBreakdown,
      outreachPriority: scoring.outreachPriority,
      bestContactChannel: scoring.bestContactChannel,
      messages,
      isFallbackData,
      aiProviderUsed,
    });

    // Update org usage counter
    await Organization.findByIdAndUpdate(prospect.organization, {
      $inc: { 'usage.prospectsThisMonth': 1 },
    });

    console.log(`  ✅ Pipeline complete. Score: ${scoring.compatibilityScore}/100 | Provider: ${aiProviderUsed}`);
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
