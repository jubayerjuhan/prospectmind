/**
 * Pipeline Runner — orchestrates all 5 layers for a single prospect.
 * Updates the prospect document at each stage.
 */

import Prospect from '../../models/Prospect.js';
import Organization from '../../models/Organization.js';
import ProspectList from '../../models/ProspectList.js';
import Persona from '../../models/Persona.js';
import { findOrCreateCompany } from '../company/companyService.js';
import { analyzeCompany } from '../company/companyAnalyzer.js';
import { askAI } from '../ai/claudeClient.js';
import { resolveIdentity } from './discovery.js';
import { enrichProfile } from './enrichment.js';
import { classifyProfile } from './classifier.js';
import { scoreProfile } from './scorer.js';
import { scorePersonas } from './personaScorer.js';
import { detectProspectSignals, detectCompanySignals } from './signalDetector.js';
import { formatPersonasForPrompt } from '../../utils/personas.js';

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

  // Link the prospect to a first-class Company (v2 Phase A). Single integration
  // point covering every creation path (single/bulk/add-and-create/import),
  // since they all flow through the pipeline. Best-effort — never block the run.
  if (prospect.company?.trim() && !prospect.companyRef) {
    try {
      const company = await findOrCreateCompany({ organization: prospect.organization, name: prospect.company });
      if (company) {
        prospect.companyRef = company._id;
        await Prospect.findByIdAndUpdate(prospectId, { companyRef: company._id });

        // First-time company analysis + signal detection (HLD §2.2, §3.3) —
        // fire-and-forget so the prospect pipeline never waits; both are
        // cached/persistent after the first run.
        if (!company.aiAnalysis?.lastAnalyzedAt || !(company.signals || []).length) {
          analyzeCompany(company)
            .then((analyzed) => {
              if (analyzed && !(analyzed.signals || []).length) {
                return detectCompanySignals(analyzed);
              }
              return null;
            })
            .catch((err) =>
              console.warn(`  ⚠ Company analysis/signals failed for "${company.name}": ${err.message}`)
            );
        }
      }
    } catch (companyErr) {
      console.warn(`  ⚠ Company link skipped: ${companyErr.message}`);
    }
  }

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

  const personaBlock = formatPersonasForPrompt(campaignList?.targetPersonas);
  const personaContext = personaBlock
    ? `Target Personas for this campaign (the user is specifically looking for these persona types — use each description to judge how well the prospect fits):\n${personaBlock}`
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

  // Read the campaign's preferred AI model ('gemini' | 'groq' | 'auto').
  // Groq is currently on hold (see claudeClient.js GROQ_ENABLED) — Gemini runs regardless.
  const preferredAiModel = campaignList?.preferredAiModel || 'gemini';
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

    // ── Layer 4.5: Persona Scoring (v2 Phase C) ─────────────────────────────
    // Score against the org's active first-class Personas using their
    // user-authored prompts. Additive — does not affect compatibilityScore.
    // Failures here must not break the pipeline (best-effort enrichment).
    let personaScores = [];
    try {
      const activePersonas = await Persona.find({
        organization: prospect.organization,
        isActive: true,
      }).select('_id name prompt').lean();

      if (activePersonas.length) {
        console.log(`  → Layer 4.5: Persona Scoring (${activePersonas.length} active persona(s))`);
        // Persona scoring is intentionally campaign-agnostic (HLD §3.1): it judges
        // how well the prospect matches the persona TYPE, so the scores are
        // reusable across campaigns. Campaign-specific fit is a separate concern.
        // `companyContext` is reserved for real Company analysis (Phase A), not
        // the campaign description.
        personaScores = await scorePersonas(prospect, enrichedProfile, activePersonas, { callAI });
      }
    } catch (personaErr) {
      console.warn(`  ⚠ Persona scoring skipped: ${personaErr.message}`);
    }
    if (await pauseIfRequested(prospectId)) return { success: false, paused: true, prospectId };

    // ── Layer 4.6: Prospect Signal Detection (v2 Phase C) ───────────────────
    // Run the org's active prospect-level Signal prompts. Best-effort.
    let prospectSignals = [];
    try {
      prospectSignals = await detectProspectSignals(prospect, enrichedProfile, { callAI });
      if (prospectSignals.length) {
        console.log(`  → Layer 4.6: Signal Detection (${prospectSignals.length} result(s))`);
      }
    } catch (signalErr) {
      console.warn(`  ⚠ Prospect signal detection skipped: ${signalErr.message}`);
    }
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
      personaBreakdown: scoring.personaBreakdown || [],
      personaScores,
      signals: prospectSignals,
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
    if (scoring.scoreReasoning) console.log(`  📊 Reasoning: ${scoring.scoreReasoning}`);
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
