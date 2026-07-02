/**
 * Layer 5 — Personalized Message Generation
 * Generates hyper-personalized outreach for each available channel.
 * Messages must NOT feel AI-generated.
 */

import { askClaude } from '../ai/claudeClient.js';

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
  const platformContext = isClient ? CLIENT_CONTEXT : TALENT_CONTEXT;

  const availableChannels = [];
  if (enrichedProfile.email) availableChannels.push('email');
  if (enrichedProfile.linkedinUrl) availableChannels.push('linkedin');
  if (enrichedProfile.xUrl) availableChannels.push('x');
  if (enrichedProfile.telegramHandle) availableChannels.push('telegram');

  if (availableChannels.length === 0) availableChannels.push('email', 'linkedin');

  const userPrompt = `Generate personalized outreach messages for this prospect.

Prospect: ${prospect.firstName} ${prospect.lastName || ''} @ ${prospect.company || 'Unknown'}
Role: ${classification.primaryAngle} ${classification.secondaryAngle ? `(also: ${classification.secondaryAngle})` : ''}
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

Available channels: ${availableChannels.join(', ')}

Rules for every message:
1. Must NOT sound AI-generated
2. Open with something specific to THEM (their work, project, recent activity)
3. Keep it concise: email max 120 words, linkedin/x/telegram max 80 words
4. End with a soft, non-pushy CTA
5. No generic openers like "I came across your profile" or "Hope this finds you well"
6. Reference their specific ecosystem/tech when possible

Return JSON with only the channels that are available:
{
  "email": {
    "subject": "compelling subject line",
    "body": "full email body"
  },
  "linkedin": {
    "body": "linkedin message"
  },
  "x": {
    "body": "x/twitter DM"
  },
  "telegram": {
    "body": "telegram message"
  }
}

Only include keys for available channels: ${availableChannels.join(', ')}`;

  const messages = await askClaude({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 1200,
  });

  // Format into message documents
  return availableChannels
    .filter((ch) => messages[ch])
    .map((channel) => ({
      channel,
      subject: messages[channel].subject || null,
      body: messages[channel].body,
      status: 'draft',
    }));
};
