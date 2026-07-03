/**
 * Layer 4 — Compatibility Scoring
 * Generates a 0–100 fit score and outreach priority.
 */

import { askClaude, AIFallbackRequiredError } from '../ai/claudeClient.js';
import { buildProfileSnapshot, clipPromptText } from './profileSnapshot.js';

const SYSTEM_PROMPT = `You are a precision scoring engine for a talent intelligence platform.
Score prospects based on their fit, quality, and outreach potential.
Be rigorous — scores must be meaningful and defensible.
Always return valid JSON.`;

const SCORE_LABELS = {
  high_talent: 'strong_talent_match',
  high_client: 'high_potential_client',
  advisor: 'strategic_advisor',
  low: 'low_priority',
  irrelevant: 'not_relevant',
};

export const scoreProfile = async (prospect, enrichedProfile, classification, campaignDescription = '', { callAI = askClaude } = {}) => {
  const profileSnapshot = buildProfileSnapshot(enrichedProfile);
  let campaignPrompt = '';
  if (campaignDescription && campaignDescription.trim() !== '') {
    campaignPrompt = `\n=== CAMPAIGN DESCRIPTION & OUTREACH GOALS ===
The user running this pipeline has specified the following overarching goals and requirements for this campaign:
"${clipPromptText(campaignDescription, 1200)}"

You MUST dynamically evaluate this prospect's value toward achieving this specific campaign goal based on their assigned persona.
- If the prospect is highly valuable for the campaign (as a talent, a client, a partner, an influencer, etc.), give a high compatibilityScore.
- If the prospect is irrelevant to the campaign's goals, decrease the compatibilityScore accordingly (even down to 0).
- In the "scoreReasoning" response field, EXPLICITLY state why they are a good or bad fit for this campaign based on their persona.
==================================================\n`;
  }

  const userPrompt = `${campaignPrompt}Score this prospect's compatibility and outreach potential dynamically.

Prospect: ${prospect.firstName} ${prospect.lastName || ''} @ ${prospect.company || 'Unknown'}
Classification: ${JSON.stringify(classification)}
Enriched Profile: ${JSON.stringify(profileSnapshot, null, 2)}

INSTRUCTIONS FOR DYNAMIC SCORING:
1. Analyze the prospect's Classification (e.g., Talent, Founder, Recruiter, Client, Influencer).
2. Look at the Campaign Description (if provided).
3. Based on their specific Persona AND the Campaign Goals, dynamically generate 3-5 scoring dimensions that make the most sense for evaluating them.
   - For example, if they are a Talent, dimensions might be "Technical Seniority", "Web3 Experience", "Open Source Activity".
   - If they are a Client/Founder, dimensions might be "Hiring Budget Potential", "Company Stage", "Decision Maker Authority".
   - If they are a Recruiter, dimensions might be "Network Size", "Agency Alignment".
4. Evaluate the prospect across these dynamically generated dimensions and compute a final compatibilityScore (0-100).

CRITICAL LABEL INSTRUCTIONS:
- Assign the most appropriate \`scoreLabel\` from this exact list: ["strong_talent_match", "high_potential_client", "strategic_advisor", "influential_voice", "low_priority", "not_relevant"].
- Make sure the label matches their persona (do not label a non-technical CEO as a "strong_talent_match").

Return JSON:
{
  "compatibilityScore": 0-100,
  "scoreLabel": "strong_talent_match|high_potential_client|strategic_advisor|influential_voice|low_priority|not_relevant",
  "outreachPriority": "high|medium|low",
  "scoreBreakdown": {
    "dynamicDimensionName1": { "score": 0-100, "weight": 0.40, "note": "..." },
    "dynamicDimensionName2": { "score": 0-100, "weight": 0.30, "note": "..." }
  },
  "scoreReasoning": "2–3 sentence explanation focusing on campaign fit and persona value",
  "bestContactChannel": "email|linkedin|x|telegram",
  "contactabilityNotes": "where are they most active/reachable"
}`;

  try {
    return await callAI({ systemPrompt: SYSTEM_PROMPT, userPrompt, maxTokens: 512, jsonMode: true });
  } catch (error) {
    if (error instanceof AIFallbackRequiredError) {
      console.warn(`[scorer] Hard fallback triggered for prospect ${prospect._id}`);
      return {
        compatibilityScore: 50,
        scoreLabel: 'low_priority',
        outreachPriority: 'low',
        scoreBreakdown: {
          "Fallback Default": { score: 50, weight: 1.0, note: "AI Unavailable" }
        },
        scoreReasoning: "Fallback data applied because AI routing failed across all providers.",
        bestContactChannel: "email",
        contactabilityNotes: "Fallback default",
        __isFallback: true
      };
    }
    throw error;
  }
};
