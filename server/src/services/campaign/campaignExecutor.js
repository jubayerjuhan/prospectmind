/**
 * Campaign Outreach Generation (HLD §2.3, §4 step 7).
 *
 * Generates a per-prospect outreach sequence from knowledge that is ALREADY
 * STORED — prospect analysis, persona scores, company analysis, detected
 * signals — combined with the campaign's own strategy (selected Playbook +
 * Personas + sequence). Generation never analyzes and never re-runs the
 * pipeline; prospects that aren't ready are skipped with a reason.
 *
 * The campaign is a ProspectList document (see models/ProspectList.js) — the
 * outreach state lives on `list.outreach`.
 */

import ProspectList from '../../models/ProspectList.js';
import Prospect from '../../models/Prospect.js';
import Company from '../../models/Company.js';
import Persona from '../../models/Persona.js';
import Playbook from '../../models/Playbook.js';
import { askClaude, AIFallbackRequiredError } from '../ai/claudeClient.js';
import { buildProfileSnapshot, clipPromptText } from '../pipeline/profileSnapshot.js';
import { buildProspectFilter } from '../../utils/buildProspectFilter.js';

const MAX_PROSPECTS_PER_EXECUTION = 50;

const SYSTEM_PROMPT = `You are a master of personalized B2B outreach sequences.
You write multi-step sequences that feel genuinely human, informed, and relevant — never AI-generated.
Each step must build on the previous one (a follow-up references the earlier touch without repeating it).
Follow the provided Playbook exactly for business context, positioning, tone, and call to action.
Always return valid JSON.`;

/** Resolve the campaign's target prospects (manual membership or saved filters). */
const resolveTargetProspects = async (campaign) => {
  if (campaign.type === 'dynamic') {
    const filter = buildProspectFilter({
      organizationId: campaign.organization,
      search: campaign.filters?.search || '',
      status: campaign.filters?.status || '',
      priority: campaign.filters?.priority || '',
    });
    return Prospect.find(filter).limit(MAX_PROSPECTS_PER_EXECUTION).lean();
  }

  return Prospect.find({
    _id: { $in: campaign.prospects || [] },
    organization: campaign.organization,
    isArchived: false,
  })
    .limit(MAX_PROSPECTS_PER_EXECUTION)
    .lean();
};

/**
 * Resolve which Playbook this run should use: the explicitly requested one, the
 * campaign's first selected playbook, or the org's newest active playbook.
 */
const resolvePlaybook = async (campaign, requestedPlaybookId) => {
  const candidateIds = [requestedPlaybookId, ...(campaign.playbooks || [])].filter(Boolean);

  for (const id of candidateIds) {
    const playbook = await Playbook.findOne({ _id: id, organization: campaign.organization }).lean();
    if (playbook) return playbook;
  }

  return Playbook.findOne({ organization: campaign.organization, isActive: true })
    .sort({ createdAt: -1 })
    .lean();
};

/** The Personas this campaign targets — its selection, or every active one. */
const resolvePersonas = async (campaign) => {
  const selected = campaign.personas || [];
  const query = selected.length
    ? { _id: { $in: selected }, organization: campaign.organization }
    : { organization: campaign.organization, isActive: true };

  return Persona.find(query).select('_id name prompt').lean();
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

/**
 * Pick the persona to address this prospect as: the campaign persona they score
 * highest against. Falls back to the first campaign persona when the prospect
 * has no stored score for any of them.
 */
const pickPersonaFor = (prospect, personas) => {
  const scores = prospect.personaScores || [];
  let best = null;

  for (const persona of personas) {
    const entry = scores.find((s) => s.persona?.toString() === persona._id.toString());
    if (entry && typeof entry.score === 'number' && (!best || entry.score > best.score)) {
      best = { persona, score: entry.score, reasoning: entry.reasoning };
    }
  }

  return best || { persona: personas[0], score: null, reasoning: '' };
};

/** Build the stored-knowledge block for one prospect (no fresh analysis). */
const buildKnowledgeBlock = async (prospect, personaScoreEntry) => {
  const snapshot = buildProfileSnapshot(prospect.enrichedProfile || {});

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

  const userNotes = prospect.description?.trim()
    ? `=== NOTES ABOUT THIS PROSPECT (from the user) ===\nThe user has saved background info and/or specific instructions for reaching this person. Follow any tone, language, or approach guidance exactly; otherwise treat it as verified context.\n${clipPromptText(prospect.description.trim(), 1500)}\n================================`
    : '';

  return [
    `Profile: ${clipPromptText(JSON.stringify(snapshot), 2500)}`,
    personaScoreEntry?.score != null
      ? `Persona fit (stored): ${personaScoreEntry.score}/100 — ${clipPromptText(personaScoreEntry.reasoning || '', 400)}`
      : '',
    companyBlock,
    prospectSignals,
    userNotes,
  ].filter(Boolean).join('\n\n');
};

const generateSequenceForProspect = async ({ prospect, personaPick, playbook, sequence, campaignGoal, callAI }) => {
  const knowledgeText = await buildKnowledgeBlock(prospect, personaPick);
  const available = availableChannelsFor(prospect.enrichedProfile);

  // No fallback substitution: a step keeps the channel it was configured
  // with, or is dropped entirely for this prospect. An earlier version
  // reassigned an unreachable step to email-if-available, else whatever
  // channel the prospect had — which meant a LinkedIn-only prospect facing an
  // email→LinkedIn sequence got TWO LinkedIn touches back to back (step 1
  // reassigned, step 2 already LinkedIn), not the one the user configured for
  // them. Resolved open question from redesign-v2.md ("Channel availability
  // enforcement") — explicit product decision: skip, never substitute.
  const steps = sequence.filter((s) => available.includes(s.channel));

  // Nobody reachable on any configured step — nothing to ask the AI to
  // write. The caller (executeCampaignOutreach) treats an empty result as
  // skipped rather than a zero-step "success".
  if (!steps.length) return [];

  const userPrompt = `Write a personalized outreach sequence for this prospect.

=== PLAYBOOK (user-authored — follow for context, positioning, tone, CTA) ===
${clipPromptText(playbook.prompt, 6000)}
${campaignGoal ? `\n=== CAMPAIGN GOAL (what this specific campaign is trying to achieve) ===\n${clipPromptText(campaignGoal, 2000)}\n` : ''}
=== TARGET PERSONA (who we are addressing them as) ===
${personaPick.persona.name}
${clipPromptText(personaPick.persona.prompt, 1500)}

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
  return (Array.isArray(result) ? result : [])
    .filter((m) => m && typeof m.body === 'string')
    .map((m, i) => ({
      stepOrder: Number(m.stepOrder) || steps[i]?.stepOrder || i + 1,
      channel: steps.find((s) => s.stepOrder === Number(m.stepOrder))?.channel || m.channel,
      delayDays: steps.find((s) => s.stepOrder === Number(m.stepOrder))?.delayDays ?? 0,
      subject: m.subject || null,
      body: m.body,
    }));
};

/**
 * Generate the outreach sequence for every ready prospect in a campaign, from
 * stored knowledge only. Updates `campaign.outreach` in place.
 *
 * @param {String} campaignId   ProspectList _id
 * @param {Object} opts
 * @param {String} opts.playbookId Playbook to write with (defaults to the campaign's first)
 * @param {Function} opts.callAI   AI caller (defaults to askClaude)
 */
export const executeCampaignOutreach = async (campaignId, { playbookId, callAI = askClaude } = {}) => {
  const campaign = await ProspectList.findById(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const [playbook, personas] = await Promise.all([
    resolvePlaybook(campaign, playbookId),
    resolvePersonas(campaign),
  ]);

  if (!playbook) {
    campaign.outreach.status = 'failed';
    campaign.outreach.error = 'No playbook available. Create one in Settings, then select it for this campaign.';
    await campaign.save();
    return campaign;
  }
  if (!personas.length) {
    campaign.outreach.status = 'failed';
    campaign.outreach.error = 'No persona available. Create one in Settings, then select it for this campaign.';
    await campaign.save();
    return campaign;
  }

  campaign.outreach.status = 'generating';
  campaign.outreach.error = null;
  campaign.outreach.playbook = playbook._id;
  await campaign.save();

  // The campaign goal gives the writer campaign-specific intent on top of the
  // playbook's reusable positioning. (Each prospect's own persona definition is
  // added per-message in generateSequenceForProspect.)
  const campaignGoal = [
    campaign.campaignDescription?.trim(),
    campaign.targetEcosystemContext?.trim() ? `Target ecosystem / context: ${campaign.targetEcosystemContext.trim()}` : '',
  ].filter(Boolean).join('\n\n');

  const sequence = campaign.sequence?.length
    ? campaign.sequence
    : [{ stepOrder: 1, channel: 'email', delayDays: 0 }];

  try {
    const prospects = await resolveTargetProspects(campaign);
    console.log(`[campaign] Generating outreach for "${campaign.name}" — ${prospects.length} prospect(s), playbook "${playbook.name}"`);

    const results = [];
    for (const prospect of prospects) {
      const name = `${prospect.firstName} ${prospect.lastName || ''}`.trim();

      if (prospect.pipelineStatus !== 'ready') {
        results.push({
          prospect: prospect._id,
          prospectName: name,
          status: 'skipped',
          skipReason: `Pipeline not ready (${prospect.pipelineStatus}). Outreach only uses existing analysis.`,
          messages: [],
        });
        continue;
      }

      const personaPick = pickPersonaFor(prospect, personas);

      try {
        const messages = await generateSequenceForProspect({
          prospect,
          personaPick,
          playbook,
          sequence,
          campaignGoal,
          callAI,
        });

        // No step's configured channel matched anything this prospect has —
        // skip rather than record a "generated" result with nothing in it.
        if (!messages.length) {
          const neededChannels = [...new Set(sequence.map((s) => s.channel))];
          results.push({
            prospect: prospect._id,
            prospectName: name,
            status: 'skipped',
            skipReason: `Not reachable on any configured channel (needs one of: ${neededChannels.join(', ')})`,
            messages: [],
          });
          console.log(`[campaign]   ⏭ ${name} — not reachable on any of: ${neededChannels.join(', ')}`);
          continue;
        }

        results.push({
          prospect: prospect._id,
          prospectName: name,
          status: 'generated',
          personaName: personaPick.persona.name,
          personaScore: personaPick.score,
          messages,
          generatedAt: new Date(),
        });
        console.log(`[campaign]   ✅ ${name} — ${messages.length} step(s) as "${personaPick.persona.name}"`);
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

    campaign.outreach.results = results;
    campaign.outreach.status = 'ready';
    campaign.outreach.lastGeneratedAt = new Date();
    await campaign.save();
    console.log(`[campaign] ✅ "${campaign.name}" outreach ready — ${results.filter((r) => r.status === 'generated').length} generated, ${results.filter((r) => r.status === 'skipped').length} skipped`);
    return campaign;
  } catch (error) {
    campaign.outreach.status = 'failed';
    campaign.outreach.error = error.message;
    await campaign.save();
    throw error;
  }
};
