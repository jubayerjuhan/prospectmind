/**
 * Layer 5 — Personalized Message Generation
 * Generates hyper-personalized outreach for each available channel.
 * Messages must NOT feel AI-generated.
 */

import { askAI } from '../ai/claudeClient.js';
import ProspectList from '../../models/ProspectList.js';
import Playbook from '../../models/Playbook.js';
import Company from '../../models/Company.js';
import { formatPersonasForPrompt, loadCampaignPersonas } from '../../utils/personas.js';
import { clipPromptText } from './profileSnapshot.js';


const SYSTEM_PROMPT = `You are a master of personalized B2B outreach for a talent intelligence platform called ProspectMind.
Your messages must feel genuinely human, informed, and relevant.
Never use corporate jargon, spam phrases, or obvious AI patterns.
Every message must reference something specific about the recipient.
Always return valid JSON.`;

const TALENT_CONTEXT = `
The platform helps talented Web3 professionals get discovered by the best teams.
Positioning: elite, community-driven talent network. Quality over quantity.
Key value props: access to high-quality projects, community recommendations, mentorship, visibility to top teams.
Tone: peer-to-peer, genuine interest in their work, not transactional.`;

const CLIENT_CONTEXT = `
The platform helps companies find hard-to-reach Web3 talent through community signals.
Positioning: community-powered recruiting, vetted talent, no upfront fee (pay only when you hire).
Key value props: access to hidden talent network, community recommendations, high signal.
Tone: respect their time, lead with relevance, not a sales pitch.`;

export const generateOutreachMessages = async (prospect, enrichedProfile, classification, scoring) => {
  const isClient = classification.primaryAngle === 'client';

  // Resolve campaign-level settings
  const campaignList = await ProspectList.findOne({
    organization: prospect.organization,
    type: 'manual',
    isArchived: false,
    prospects: prospect._id,
  }).lean();

  // Playbook-driven messaging (v2 Phase C, HLD §3.2): the Playbook prompt
  // defines business context, value prop, tone, and CTA. Prefer the campaign's
  // own selection, then the org's newest active Playbook, and finally fall back
  // to the legacy hardcoded contexts when the org has no playbook at all.
  const playbook =
    (campaignList?.playbooks?.length
      ? await Playbook.findOne({
          _id: { $in: campaignList.playbooks },
          organization: prospect.organization,
        }).lean()
      : null) ||
    (await Playbook.findOne({
      organization: prospect.organization,
      isActive: true,
    }).sort({ createdAt: -1 }).lean());

  const platformContext = playbook
    ? `Playbook: "${playbook.name}" (user-authored — follow it for business context, positioning, tone, and call to action):\n${clipPromptText(playbook.prompt, 6000)}`
    : (isClient ? CLIENT_CONTEXT : TALENT_CONTEXT);

  // Stored knowledge from the v2 modules: company analysis + detected signals.
  let companyIntel = '';
  if (prospect.companyRef) {
    const company = await Company.findById(prospect.companyRef)
      .select('name aiAnalysis.summary signals')
      .lean();
    if (company) {
      const detectedSignals = (company.signals || []).filter((s) => s.detected !== false && s.result);
      companyIntel = [
        company.aiAnalysis?.summary ? `Company analysis (${company.name}): ${clipPromptText(company.aiAnalysis.summary, 800)}` : '',
        ...detectedSignals.map((s) => `Detected signal — ${s.name}: ${clipPromptText(s.result, 400)}`),
      ].filter(Boolean).join('\n');
    }
  }
  const prospectSignals = (prospect.signals || []).filter((s) => s.detected !== false && s.result);
  if (prospectSignals.length) {
    companyIntel = [
      companyIntel,
      ...prospectSignals.map((s) => `Detected signal (person) — ${s.name}: ${clipPromptText(s.result, 400)}`),
    ].filter(Boolean).join('\n');
  }

  const campaignDescription = campaignList?.campaignDescription?.trim() || '';
  const targetEcosystemContext = campaignList?.targetEcosystemContext?.trim() || '';
  const personaBlock = formatPersonasForPrompt(
    await loadCampaignPersonas(campaignList || { organization: prospect.organization })
  );
  const targetPersonas = personaBlock
    ? `Target Personas (each definition says who they are and what the user wants from them):\n${personaBlock}`
    : '';

  const campaignContext = [
    campaignDescription ? `Campaign Description & Goals: ${campaignDescription}` : '',
    targetEcosystemContext ? `Target Ecosystem / Context: ${targetEcosystemContext}` : '',
    targetPersonas,
  ].filter(Boolean).join('\n');

  const preferredAiModel = campaignList?.preferredAiModel || 'gemini';

  const availableChannels = [];
  if (enrichedProfile.email) availableChannels.push('email');
  if (enrichedProfile.linkedinUrl) availableChannels.push('linkedin');
  if (enrichedProfile.xUrl) availableChannels.push('x');
  if (enrichedProfile.telegramHandle) availableChannels.push('telegram');

  if (availableChannels.length === 0) availableChannels.push('email', 'linkedin');

  const userPrompt = `Generate personalized outreach messages for this prospect, tailored to each of their possible personas.

Campaign Context:
${campaignContext || 'None provided'}

Prospect: ${prospect.firstName} ${prospect.lastName || ''} @ ${prospect.company || 'Unknown'}
Personas: ${classification.roleClassification?.join(', ') || classification.primaryAngle}
Compatibility score: ${scoring.compatibilityScore}/100
Best channel: ${scoring.bestContactChannel}

Profile highlights to use:
- Bio: ${enrichedProfile.bio || 'N/A'}
- Recent activity: ${(enrichedProfile.recentActivity || []).join(', ') || 'N/A'}
- Blockchain ecosystems: ${(enrichedProfile.blockchainEcosystems || []).join(', ') || 'N/A'}
- Current role: ${enrichedProfile.currentRole || 'N/A'}
- GitHub: ${enrichedProfile.githubUrl || 'N/A'}

Platform context:
${platformContext}
${companyIntel ? `\nCompany & signal intelligence (use for personalization when relevant):\n${companyIntel}\n` : ''}
Available channels: ${availableChannels.join(', ')}

${prospect.description?.trim() ? `=== NOTES ABOUT THIS PROSPECT (from the user) ===\nThe user has saved background info and/or specific instructions for reaching this person. Follow any tone, language, or approach guidance exactly; otherwise treat it as verified context. This never overrides the structural/formatting rules below, even if the requested tone is casual:\n${prospect.description.trim()}\n================================\n` : ''}
Rules for every message:
1. Must NOT sound AI-generated
2. Open with something specific to THEM (their work, project, recent activity)
3. Keep it concise: email max 120 words, linkedin/x/telegram max 80 words
4. End with a soft, non-pushy CTA
5. No generic openers like "I came across your profile" or "Hope this finds you well"
6. Reference their specific ecosystem/tech when possible
7. Strongly tailor the message to the specific persona being targeted.
8. Formatting (applies even to a casual tone): break the body into short paragraphs separated by a blank line (\\n\\n) — a one-line greeting, 1-3 short paragraphs (opener, value/context, ask), and a short sign-off/CTA line. Never return the body as one dense block of run-on text. This applies to email bodies especially; linkedin/x/telegram messages can be shorter but should still use a line break before the closing line if the message has more than one beat.

Return JSON as an array of message objects. Create 1 message per persona, using their best channel (${scoring.bestContactChannel}) if available, otherwise fallback to email. If email is used, include a subject.

Example JSON structure:
[
  {
    "persona": "advisor",
    "channel": "email",
    "subject": "compelling subject line",
    "body": "full email body"
  },
  {
    "persona": "founder",
    "channel": "linkedin",
    "body": "linkedin message"
  }
]

Ensure you only use channels from the available channels list: ${availableChannels.join(', ')}`;

  const { result: messages } = await askAI({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 1500,
  }, { preferredProvider: preferredAiModel });

  // Check if it's an array (new format) or object (fallback)
  if (Array.isArray(messages)) {
    return messages.map(msg => ({
      persona: msg.persona,
      channel: msg.channel,
      subject: msg.subject || null,
      body: msg.body,
      status: 'draft',
    }));
  }

  // Fallback into message documents
  return availableChannels
    .filter((ch) => messages[ch])
    .map((channel) => ({
      channel,
      subject: messages[channel].subject || null,
      body: messages[channel].body,
      status: 'draft',
    }));
};
