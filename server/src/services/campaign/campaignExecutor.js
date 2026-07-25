/**
 * Campaign Execution (v2 Phase D, HLD §2.3, §4 step 7).
 *
 * Generates a complete per-prospect outreach sequence from knowledge that is
 * ALREADY STORED — prospect analysis, persona scores, company analysis,
 * detected signals — combined with the campaign's Persona + Playbook +
 * sequence configuration. A campaign never analyzes and never re-runs the
 * pipeline; prospects that aren't ready are skipped with a reason.
 */

import Campaign from '../../models/Campaign.js';
import Prospect from '../../models/Prospect.js';
import Company from '../../models/Company.js';
import Persona from '../../models/Persona.js';
import Playbook from '../../models/Playbook.js';
import ProspectList from '../../models/ProspectList.js';
import { askClaude, AIFallbackRequiredError } from '../ai/claudeClient.js';
import { buildProfileSnapshot, clipPromptText } from '../pipeline/profileSnapshot.js';
import { buildProspectFilter } from '../../utils/buildProspectFilter.js';

const MAX_PROSPECTS_PER_EXECUTION = 50;

const SYSTEM_PROMPT = `You are a master of personalized B2B outreach sequences.
You write multi-step sequences that feel genuinely human, informed, and relevant — never AI-generated.
Each step must build on the previous one (a follow-up references the earlier touch without repeating it).
Follow the provided Playbook exactly for business context, positioning, tone, and call to action.
Always return valid JSON.`;

/** Resolve the campaign's target prospects from its ProspectList. */
const resolveTargetProspects = async (campaign) => {
  const list = await ProspectList.findOne({
    _id: campaign.targetList,
    organization: campaign.organization,
  }).lean();
  if (!list) return [];

  if (list.type === 'dynamic') {
    const filter = buildProspectFilter({
      organizationId: campaign.organization,
      search: list.filters?.search || '',
      status: list.filters?.status || '',
      priority: list.filters?.priority || '',
    });
    return Prospect.find(filter).limit(MAX_PROSPECTS_PER_EXECUTION).lean();
  }

  return Prospect.find({
    _id: { $in: list.prospects || [] },
    organization: campaign.organization,
    isArchived: false,
  })
    .limit(MAX_PROSPECTS_PER_EXECUTION)
    .lean();
};

/** Channels this prospect is actually reachable on, from stored enrichment. */
const availableChannelsFor = (enrichedProfile = {}) => {
  const channels = [];
  if (enrichedProfile.email) channels.push('email');
  if (enrichedProfile.linkedinUrl) channels.push('linkedin');
  if (enrichedProfile.xUrl) channels.push('x');
  if (enrichedProfile.telegramHandle) channels.push('telegram');
  return channels;
};

/** Build the stored-knowledge block for one prospect (no fresh analysis). */
const buildKnowledgeBlock = async (prospect, personaId) => {
  const snapshot = buildProfileSnapshot(prospect.enrichedProfile || {});

  const personaScoreEntry = (prospect.personaScores || []).find(
    (s) => s.persona?.toString() === personaId.toString()
  );

  let companyBlock = '';
  if (prospect.companyRef) {
    const company = await Company.findById(prospect.companyRef)
      .select('name aiAnalysis.summary signals')
      .lean();
    if (company) {
      const detected = (company.signals || []).filter((s) => s.detected !== false && s.result);
      companyBlock = [
        company.aiAnalysis?.summary ? `Company (${company.name}): ${clipPromptText(company.aiAnalysis.summary, 800)}` : '',
        ...detected.map((s) => `Company signal — ${s.name}: ${clipPromptText(s.result, 300)}`),
      ].filter(Boolean).join('\n');
    }
  }

  const prospectSignals = (prospect.signals || [])
    .filter((s) => s.detected !== false && s.result)
    .map((s) => `Person signal — ${s.name}: ${clipPromptText(s.result, 300)}`)
    .join('\n');

  return {
    snapshot,
    personaScoreEntry,
    knowledgeText: [
      `Profile: ${clipPromptText(JSON.stringify(snapshot), 2500)}`,
      personaScoreEntry
        ? `Persona fit (stored): ${personaScoreEntry.score}/100 — ${clipPromptText(personaScoreEntry.reasoning, 400)}`
        : '',
      companyBlock,
      prospectSignals,
    ].filter(Boolean).join('\n\n'),
  };
};

const generateSequenceForProspect = async ({ prospect, persona, playbook, sequence, callAI }) => {
  const { personaScoreEntry, knowledgeText } = await buildKnowledgeBlock(prospect, persona._id);
  const available = availableChannelsFor(prospect.enrichedProfile);

  // Per-step channel with fallback: keep the configured channel when the
  // prospect is reachable there, otherwise fall back to email, then to the
  // first channel we do have. (Channel-availability policy — see open
  // questions in redesign-v2.md.)
  const steps = sequence.map((s) => ({
    stepOrder: s.stepOrder,
    delayDays: s.delayDays,
    channel: available.includes(s.channel)
      ? s.channel
      : available.includes('email')
        ? 'email'
        : available[0] || s.channel,
  }));

  const userPrompt = `Write a personalized outreach sequence for this prospect.

=== PLAYBOOK (user-authored — follow for context, positioning, tone, CTA) ===
${clipPromptText(playbook.prompt, 6000)}

=== TARGET PERSONA (who we are addressing them as) ===
${persona.name}
${clipPromptText(persona.prompt, 1500)}

=== STORED PROSPECT KNOWLEDGE (already analyzed — use for personalization) ===
Prospect: ${prospect.firstName} ${prospect.lastName || ''} @ ${prospect.company || 'Unknown'}
${knowledgeText}

=== SEQUENCE TO WRITE ===
${steps.map((s) => `Step ${s.stepOrder}: channel=${s.channel}, sent ${s.delayDays} day(s) after previous step`).join('\n')}

Rules:
1. Must NOT sound AI-generated; no generic openers ("I came across your profile", "Hope this finds you well").
2. Step 1 opens with something specific to THEM from the stored knowledge.
3. Later steps are follow-ups: short, reference the earlier touch implicitly, add ONE new angle each (a signal, a company fact), never guilt-trip.
4. Length: email max 120 words; linkedin/x/telegram max 80 words. Emails need a subject.
5. Body formatting: short paragraphs separated by blank lines (\\n\\n); one-line greeting, 1-3 short paragraphs, short CTA line.
6. End every step with a soft, non-pushy CTA.

Return JSON — one object per step, same order:
[
  { "stepOrder": 1, "channel": "email", "subject": "…", "body": "…" },
  { "stepOrder": 2, "channel": "linkedin", "body": "…" }
]`;

  const result = await callAI({ systemPrompt: SYSTEM_PROMPT, userPrompt, maxTokens: 2048, jsonMode: true, thinkingBudget: 0 });
  const messages = (Array.isArray(result) ? result : [])
    .filter((m) => m && typeof m.body === 'string')
    .map((m, i) => ({
      stepOrder: Number(m.stepOrder) || steps[i]?.stepOrder || i + 1,
      channel: steps.find((s) => s.stepOrder === Number(m.stepOrder))?.channel || m.channel,
      delayDays: steps.find((s) => s.stepOrder === Number(m.stepOrder))?.delayDays ?? 0,
      subject: m.subject || null,
      body: m.body,
    }));

  return { messages, personaScore: personaScoreEntry?.score ?? null };
};

/**
 * Execute a campaign: generate the outreach sequence for every ready prospect
 * in its target list, from stored knowledge only. Updates campaign.status and
 * stores per-prospect results on the campaign document.
 */
export const executeCampaign = async (campaignId, { callAI = askClaude } = {}) => {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const [persona, playbook] = await Promise.all([
    Persona.findOne({ _id: campaign.persona, organization: campaign.organization }).lean(),
    Playbook.findOne({ _id: campaign.playbook, organization: campaign.organization }).lean(),
  ]);
  if (!persona || !playbook) {
    campaign.status = 'failed';
    campaign.executionError = 'Campaign persona or playbook no longer exists.';
    await campaign.save();
    return campaign;
  }

  campaign.status = 'generating';
  campaign.executionError = null;
  await campaign.save();

  try {
    const prospects = await resolveTargetProspects(campaign);
    console.log(`[campaign] Executing "${campaign.name}" — ${prospects.length} prospect(s)`);

    const results = [];
    for (const prospect of prospects) {
      const name = `${prospect.firstName} ${prospect.lastName || ''}`.trim();

      if (prospect.pipelineStatus !== 'ready') {
        results.push({
          prospect: prospect._id,
          prospectName: name,
          status: 'skipped',
          skipReason: `Pipeline not ready (${prospect.pipelineStatus}). Campaigns only use existing analysis.`,
          messages: [],
        });
        continue;
      }

      try {
        const { messages, personaScore } = await generateSequenceForProspect({
          prospect,
          persona,
          playbook,
          sequence: campaign.sequence,
          callAI,
        });
        results.push({
          prospect: prospect._id,
          prospectName: name,
          status: 'generated',
          personaScore,
          messages,
          generatedAt: new Date(),
        });
        console.log(`[campaign]   ✅ ${name} — ${messages.length} step(s)`);
      } catch (err) {
        const reason = err instanceof AIFallbackRequiredError ? 'AI unavailable' : err.message;
        results.push({
          prospect: prospect._id,
          prospectName: name,
          status: 'skipped',
          skipReason: `Generation failed: ${reason}`,
          messages: [],
        });
        console.warn(`[campaign]   ⚠ ${name} skipped: ${reason}`);
      }
    }

    campaign.results = results;
    campaign.status = 'ready';
    campaign.lastExecutedAt = new Date();
    await campaign.save();
    console.log(`[campaign] ✅ "${campaign.name}" ready — ${results.filter((r) => r.status === 'generated').length} generated, ${results.filter((r) => r.status === 'skipped').length} skipped`);
    return campaign;
  } catch (error) {
    campaign.status = 'failed';
    campaign.executionError = error.message;
    await campaign.save();
    throw error;
  }
};
