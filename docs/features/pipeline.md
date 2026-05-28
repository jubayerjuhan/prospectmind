# AI Pipeline

**File:** `server/src/services/pipeline/runner.js` (orchestrator)
**AI Client:** `server/src/services/ai/claudeClient.js` → Google Gemini `gemini-2.0-flash`

---

## Overview

The pipeline is triggered async after a prospect is created. It updates `pipelineStatus` in MongoDB at each step so the frontend can show live progress.

```
Status progression:
pending → discovering → enriching → classifying → scoring → generating → ready
                                                                        ↘ failed (on error)
```

All 5 layers call `askClaude()` which sends prompts to Gemini and parses the JSON response.

---

## Layer 1 — Identity Resolution
**File:** `discovery.js`

**Input:** `{ firstName, lastName, company, typeHint, rawEmail, rawLinkedin, ... }`

**What it does:**
- Sends prospect data to Gemini
- Asks it to infer likely LinkedIn URL, GitHub, X, Telegram, email
- Returns a confidence score (0–100) and reasoning
- Also returns suggested search queries for future real-scraping integration

**Output:**
```json
{
  "linkedinUrl": "https://linkedin.com/in/...",
  "githubUrl": "https://github.com/...",
  "xUrl": null,
  "telegramHandle": "@...",
  "identityConfidenceScore": 72,
  "searchQueries": ["ashwin kumar polygon linkedin", ...]
}
```

**✅ Implemented:** Uses Serper API (Google Search) to find real LinkedIn/GitHub URLs. Gemini only verifies from real candidates — it does NOT guess. Falls back gracefully if `SERPER_API_KEY` is not set.

---

## Layer 2 — Profile Enrichment
**File:** `enrichment.js`

**Input:** prospect + discovered identity from Layer 1

**What it does:**
1. Calls GitHub public API (`/users/:username` + `/repos`) — free, no auth required
2. Extracts: repos, stars, top languages, recent repo names, bio, location
3. Sends everything to Gemini to synthesize a complete profile

**Output:**
```json
{
  "currentRole": "Senior Solidity Engineer",
  "seniority": "senior",
  "blockchainEcosystems": ["Ethereum", "Polygon"],
  "programmingLanguages": ["Solidity", "TypeScript", "Rust"],
  "web3NativeScore": 88,
  "bio": "...",
  "recentActivity": ["Deployed ERC-4337 paymaster...", "..."],
  "githubStats": { "repos": 42, "stars": 310, "topLanguages": ["Solidity"] }
}
```

**⚠️ Production upgrade:** Add LinkedIn scraping (Apify), Hunter.io for email, ENS resolution.

---

## Layer 3 — Classification
**File:** `classifier.js`

**Input:** prospect + enriched profile

**What it does:**
- Classifies into one or more roles: `talent | client | mentor | advisor | influencer | founder | recruiter | hybrid`
- Determines `primaryAngle` (most commercially relevant angle)
- Determines `secondaryAngle` for hybrid profiles

**Output:**
```json
{
  "roleClassification": ["talent", "founder"],
  "primaryAngle": "talent",
  "secondaryAngle": "founder",
  "isHybrid": true,
  "keySignals": ["built 3 DeFi protocols", "hires engineers", "..."],
  "classificationReasoning": "..."
}
```

---

## Layer 4 — Compatibility Scoring
**File:** `scorer.js`

**Input:** prospect + enriched profile + classification

**What it does:**
- Scores 0–100 based on weighted criteria (different weights for talent vs client)
- Determines outreach priority: `high | medium | low`
- Identifies best contact channel
- Returns a human-readable score label

**Scoring criteria for Talent:**
- Web3 ecosystem depth (30%)
- Technical quality & seniority (25%)
- Open-source activity (20%)
- Community presence (15%)
- Contactability (10%)

**Scoring criteria for Client:**
- Hiring urgency (30%)
- Web3 alignment (25%)
- Company stage & funding (20%)
- Decision-maker authority (15%)
- Tech stack relevance (10%)

**Output:**
```json
{
  "compatibilityScore": 84,
  "scoreLabel": "strong_talent_match",
  "outreachPriority": "high",
  "bestContactChannel": "telegram",
  "scoreReasoning": "Senior Web3 engineer with strong Polygon ecosystem presence..."
}
```

**Score labels:** `strong_talent_match | high_potential_client | strategic_advisor | low_priority | not_relevant`

---

## Layer 5 — Outreach Generation
**File:** `outreach.js`

**Input:** prospect + enriched profile + classification + scoring

**What it does:**
- Generates personalized messages for each available channel
- Uses recent activity, ecosystem alignment, specific projects as hooks
- Adapts tone and CTA based on role (talent vs client vs hybrid)
- Returns array of message objects with `status: "draft"`

**Message constraints enforced in prompt:**
- Email: max 120 words
- LinkedIn / X / Telegram: max 80 words
- Must NOT start with "I came across your profile" or "Hope this finds you well"
- Must reference something specific to the recipient
- Soft, non-pushy CTA only

**Output:**
```json
[
  { "channel": "email", "subject": "...", "body": "...", "status": "draft" },
  { "channel": "linkedin", "body": "...", "status": "draft" },
  { "channel": "telegram", "body": "...", "status": "draft" }
]
```

---

## Adding a New Pipeline Layer

1. Create `server/src/services/pipeline/yourLayer.js`
2. Export an async function: `export const yourFunction = async (prospect, prevData) => { ... }`
3. Import and call it in `runner.js` between the existing steps
4. Add a new `pipelineStatus` enum value to `models/Prospect.js`
5. Call `updateStatus(prospectId, 'your_new_status')` before running it

---

## Gemini Prompt Design Rules

All prompts follow this structure:
```js
askClaude({
  systemPrompt: "You are a [role]. [context]. Always return valid JSON.",
  userPrompt:   "Here is the data: ... Return JSON in this shape: {...}",
  maxTokens:    2048
})
```

Key rules:
- System prompt sets the persona and output format constraint
- User prompt provides data + exact JSON schema expected
- `askClaude()` auto-strips markdown code fences before JSON.parse
- On parse failure, raw string is returned (for debugging)
- Temperature is set to `0.4` for consistent, structured output
