/**
 * Pipeline Runner — orchestrates all 5 layers for a single prospect.
 * Updates the prospect document at each stage.
 */

import Prospect from '../../models/Prospect.js';
import Organization from '../../models/Organization.js';
import ProspectList from '../../models/ProspectList.js';
import { findOrCreatePlaceholder } from '../company/companyService.js';
import { resolveCompanyForProspect, deriveCompanyIdentity } from '../company/companyResolver.js';
import { analyzeCompany } from '../company/companyAnalyzer.js';
import { askAI } from '../ai/claudeClient.js';
import { resolveIdentity } from './discovery.js';
import { enrichProfile } from './enrichment.js';
import { classifyProfile } from './classifier.js';
import { scoreProfile } from './scorer.js';
import { scorePersonas } from './personaScorer.js';
import { detectProspectSignals, detectCompanySignals } from './signalDetector.js';
import { formatPersonasForPrompt, loadCampaignPersonas } from '../../utils/personas.js';

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

  // A company hint derived from the raw fields alone (no DB, no network). Used
  // only to anchor Layer 2's searches; the authoritative link happens AFTER
  // enrichment, once the profile can actually say who the employer is.
  const identityHint = deriveCompanyIdentity(prospect);
  const companyDomainHint = identityHint.keyField === 'domainKey' ? identityHint.key : '';

  const campaignDescription =
    (campaignList?.campaignDescription?.trim()) ||
    org?.settings?.campaignDescription ||
    org?.settings?.icpRules ||
    '';

  const targetEcosystemContext =
    (campaignList?.targetEcosystemContext?.trim()) ||
    org?.settings?.defaultEcosystem ||
    '';

  // The campaign's selected Personas (or every active one) drive both the
  // scoring context below and Layer 4.5's per-persona scoring.
  const campaignPersonas = await loadCampaignPersonas(campaignList || { organization: prospect.organization });
  const personaBlock = formatPersonasForPrompt(campaignPersonas);
  const personaContext = personaBlock
    ? `Target Personas for this campaign (the user is specifically looking for these persona types — use each definition to judge how well the prospect fits):\n${personaBlock}`
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
    const enrichedProfile = await enrichProfile(prospect, identity, { callAI, prospectContext, companyDomainHint });
    if (await pauseIfRequested(prospectId)) return { success: false, paused: true, prospectId };

    // ── Company identity resolution ─────────────────────────────────────────
    // Deliberately placed AFTER enrichment: Layer 2 is the only thing that can
    // produce the employer's LinkedIn page, work email and contact website,
    // and without them the resolver has nothing but the name to go on — which
    // is exactly how a prospect ends up attached to a same-named company they
    // have never worked for. Best-effort: never fail the run over it.
    let linkedCompany = null;
    try {
      const resolution = await resolveCompanyForProspect({
        // enrichedProfile is not persisted yet, so hand it over in-memory.
        prospect: { ...(prospect.toObject?.() ?? prospect), enrichedProfile },
        organization: prospect.organization,
      });
      linkedCompany = resolution.company;

      if (linkedCompany) {
        const changed = String(prospect.companyRef || '') !== String(linkedCompany._id);
        prospect.companyRef = linkedCompany._id;
        await Prospect.findByIdAndUpdate(prospectId, {
          companyRef: linkedCompany._id,
          companyLinkSource: resolution.evidence.source,
          companyLinkConfidence: resolution.evidence.confidence,
          companyLinkedAt: new Date(),
          // This run regenerates the prose, so any prior contamination clears.
          needsReenrichment: false,
          reenrichmentReason: '',
          ...(changed && { outreachStale: false }),
        });
        console.log(
          `  🏢 Company: "${linkedCompany.name}" via ${resolution.evidence.source}` +
          `${resolution.evidence.value ? ` (${resolution.evidence.value})` : ''} — ${resolution.action}`
        );

        // First-time company analysis + signal detection (HLD §2.2, §3.3) —
        // fire-and-forget so the prospect pipeline never waits; both are
        // cached/persistent after the first run.
        const identityKey = linkedCompany.linkedinKey || linkedCompany.domainKey || '';
        const stale = linkedCompany.aiAnalysis?.analyzedForKey !== identityKey;
        if (stale || !(linkedCompany.signals || []).length) {
          analyzeCompany(linkedCompany)
            .then((analyzed) => {
              if (analyzed && !(analyzed.signals || []).length) {
                return detectCompanySignals(analyzed, { selectedSignalIds: campaignList?.signals || [] });
              }
              return null;
            })
            .catch((err) =>
              console.warn(`  ⚠ Company analysis/signals failed for "${linkedCompany.name}": ${err.message}`)
            );
        }
      }
    } catch (companyErr) {
      console.warn(`  ⚠ Company link skipped: ${companyErr.message}`);
    }

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
    // Score against the campaign's selected Personas using their user-authored
    // prompts. Additive — does not affect compatibilityScore.
    // Failures here must not break the pipeline (best-effort enrichment).
    let personaScores = [];
    try {
      if (campaignPersonas.length) {
        console.log(`  → Layer 4.5: Persona Scoring (${campaignPersonas.length} persona(s))`);
        // Each persona is scored on its own definition (HLD §3.1): how well the
        // prospect matches that persona TYPE, so scores stay reusable.
        // `companyContext` is reserved for real Company analysis (Phase A), not
        // the campaign description.
        personaScores = await scorePersonas(prospect, enrichedProfile, campaignPersonas, { callAI });
      }
    } catch (personaErr) {
      console.warn(`  ⚠ Persona scoring skipped: ${personaErr.message}`);
    }
    if (await pauseIfRequested(prospectId)) return { success: false, paused: true, prospectId };

    // ── Layer 4.6: Prospect Signal Detection (v2 Phase C) ───────────────────
    // Run the org's active prospect-level Signal prompts. Best-effort.
    let prospectSignals = [];
    try {
      prospectSignals = await detectProspectSignals(prospect, enrichedProfile, {
        callAI,
        selectedSignalIds: campaignList?.signals || [],
      });
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

    // The company link now happens after Layer 2, so a failure before that
    // (a dead LinkedIn session, most often) would leave the prospect with no
    // company at all — worse than the name-only link it used to get. Fall back
    // to a placeholder so the Companies view still accounts for them.
    if (prospect.company?.trim() && !prospect.companyRef) {
      try {
        const placeholder = await findOrCreatePlaceholder({
          organization: prospect.organization,
          name: prospect.company,
        });
        if (placeholder) {
          await Prospect.findByIdAndUpdate(prospectId, {
            companyRef: placeholder._id,
            companyLinkSource: 'name-only',
            companyLinkConfidence: 'low',
            companyLinkedAt: new Date(),
          });
        }
      } catch (linkErr) {
        console.warn(`  ⚠ Fallback company link failed: ${linkErr.message}`);
      }
    }

    await updateStatus(prospectId, 'failed', { pipelineError: error.message });
    throw error;
  }
};
