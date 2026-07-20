/**
 * Layer 3 — Profile Classification
 * Determines what role(s) this person plays and the best angle to approach them.
 */

import { askClaude, AIFallbackRequiredError } from '../ai/claudeClient.js';
import { buildProfileSnapshot } from './profileSnapshot.js';

const SYSTEM_PROMPT = `You are a senior talent intelligence analyst specializing in Web3 and tech ecosystems.
Your job is to classify prospects into roles and determine the most effective outreach angle.
Be precise — wrong classification leads to wrong outreach and destroys trust.
Always return valid JSON.`;

export const classifyProfile = async (prospect, enrichedProfile, { callAI = askClaude } = {}) => {
  const profileSnapshot = buildProfileSnapshot(enrichedProfile, { includeContact: false });
  const userPrompt = `Classify this prospect based on their enriched profile.

Prospect:
- Name: ${prospect.firstName} ${prospect.lastName || ''}
- Company: ${prospect.company || 'Unknown'}
- Original type hint: ${prospect.typeHint}

Enriched Profile:
${JSON.stringify(profileSnapshot, null, 2)}

Classification categories:
- talent: Developer, engineer, builder, contributor
- client: Company that hires talent, hiring manager, startup
- mentor: Senior expert who guides others
- advisor: Strategic operator, board-level
- influencer: Community amplifier, large following
- founder: Startup founder (may also be talent or client)
- recruiter: Recruiting professional
- hybrid: Genuinely spans multiple major roles

Instructions:
1. Assign ALL applicable roles (can be multiple)
2. Determine the PRIMARY angle (most commercially relevant for outreach)
3. Determine the SECONDARY angle if hybrid

Return JSON:
{
  "roleClassification": ["talent", "founder"],
  "primaryAngle": "talent",
  "secondaryAngle": "founder",
  "classificationReasoning": "brief explanation",
  "isHybrid": true/false,
  "keySignals": ["signal1", "signal2", "signal3"]
}`;

  try {
    return await callAI({ systemPrompt: SYSTEM_PROMPT, userPrompt, maxTokens: 1024, jsonMode: true, thinkingBudget: 0 });
  } catch (error) {
    if (error instanceof AIFallbackRequiredError) {
      console.warn(`[classifier] Hard fallback triggered for prospect ${prospect._id}`);
      return {
        roleClassification: ['talent'],
        primaryAngle: 'talent',
        secondaryAngle: null,
        classificationReasoning: 'Automatically assigned due to AI unavailability.',
        isHybrid: false,
        keySignals: [],
        __isFallback: true,
      };
    }
    throw error;
  }
};
