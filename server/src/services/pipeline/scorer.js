/**
 * Layer 4 — Compatibility Scoring
 * Generates a 0–100 fit score and outreach priority.
 */

import { askClaude } from '../ai/claudeClient.js';

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

export const scoreProfile = async (prospect, enrichedProfile, classification) => {
  const userPrompt = `Score this prospect's compatibility and outreach potential.

Prospect: ${prospect.firstName} ${prospect.lastName || ''} @ ${prospect.company || 'Unknown'}
Classification: ${JSON.stringify(classification)}
Enriched Profile: ${JSON.stringify(enrichedProfile, null, 2)}

Scoring criteria (weight each based on classification):
FOR TALENT:
- Web3 ecosystem depth (30%)
- Technical quality & seniority (25%)
- Open-source activity & contributions (20%)
- Community presence & influence (15%)
- Contactability / reachability (10%)

FOR CLIENT:
- Hiring urgency & activity (30%)
- Web3 native alignment (25%)
- Company stage & funding (20%)
- Decision-maker authority (15%)
- Tech stack relevance (10%)

Return JSON:
{
  "compatibilityScore": 0-100,
  "scoreLabel": "strong_talent_match|high_potential_client|strategic_advisor|low_priority|not_relevant",
  "outreachPriority": "high|medium|low",
  "scoreBreakdown": {
    "dimension1": { "score": 0-100, "weight": 0.30, "note": "..." },
    "dimension2": { "score": 0-100, "weight": 0.25, "note": "..." }
  },
  "scoreReasoning": "2–3 sentence explanation",
  "bestContactChannel": "email|linkedin|x|telegram",
  "contactabilityNotes": "where are they most active/reachable"
}`;

  return askClaude({ systemPrompt: SYSTEM_PROMPT, userPrompt });
};
