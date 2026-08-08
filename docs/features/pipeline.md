# AI Pipeline

**File:** `server/src/services/pipeline/runner.js` (orchestrator)
**Queue:** `server/src/services/pipeline/queue.js` — BullMQ on Redis, concurrency 1
**AI Client:** `server/src/services/ai/claudeClient.js` → **Gemini** via `geminiClient.js`

---

## Overview

Creating a prospect enqueues a pipeline job. The runner updates `pipelineStatus` in MongoDB at each step so the frontend can show live progress.

```
Status progression:
pending → discovering → enriching → classifying → scoring → ready
                                                          ↘ failed (on error)
                                                          ↘ paused (on request)
```

Layers call `askAI()` / `askClaude()`, which route to **Gemini** — Groq is held back behind the `GROQ_ENABLED` flag in `claudeClient.js`, so `preferredAiModel` on a campaign is currently ignored. If a model fails, the client retries its configured fallback chain before failing the pipeline. **Never import a provider SDK directly.**

**Layer 5 does not run automatically.** Outreach is generated on demand — per prospect (`POST /prospects/:id/generate-messages`) or per campaign (`POST /prospect-lists/:id/outreach/generate`) — so a prospect reaches `ready` after scoring and signals.

### Company linking

The prospect→`Company` link happens **after Layer 2**, because enrichment is the only step that can identify the real employer. Company analysis and company-scoped signal detection are then chained onto that link in the background, so they never block the prospect pipeline.

---

## Layer 1 — Identity Resolution
**File:** `discovery.js`

**Input:** `{ firstName, lastName, company, typeHint, rawEmail, rawLinkedin, ... }`

**What it does:**
- Sends prospect data to the AI provider
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

**✅ Implemented:** Uses Serper API (Google Search) to find real LinkedIn/GitHub URLs. AI only verifies from real candidates — it does NOT guess. Falls back gracefully if `SERPER_API_KEY` is not set.

---

## Layer 2 — Profile Enrichment
**File:** `enrichment.js`

**Input:** prospect + discovered identity from Layer 1

**What it does:**
1. Calls GitHub public API (`/users/:username` + `/repos`) — free, no auth required
2. Extracts: repos, stars, top languages, recent repo names, bio, location
3. Scrapes the LinkedIn profile using the shared session (see `scraper/linkedinScraper.js`)
4. Sends everything to the AI provider to synthesize a complete profile

**Dead-session behavior:** if the shared LinkedIn session is expired, enrichment records the failure (`recordLinkedInAuthFailure`) so the UI can surface it, and degrades rather than silently producing a weaker profile.

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

**✅ LinkedIn scraping is built in-house** (Puppeteer + a shared session), not via Apify. Still open: Hunter.io for verified email, ENS resolution.

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

> **Transitional:** this legacy score runs *alongside* Layer 4.5's persona scores rather than being replaced by them. Retiring `scorer.js` in favour of `personaScores[]` is a tracked cleanup — see `docs/status/plan-overview.md`.

---

## Layer 4.5 — Persona Scoring *(v2 Phase C)*
**File:** `personaScorer.js`

**Input:** prospect + enriched profile + the campaign's active `Persona` records

**What it does:**
- Loads the campaign's selected Personas (empty selection = all active org Personas)
- Scores the prospect against **each** Persona's user-authored prompt
- Persists to `Prospect.personaScores[]`

This is what replaces hardcoded Web3 prompts with user-defined targeting: an org authors "Founder hiring Web3 talent" in Settings, and every prospect gets scored against it. A research scientist can score high as generic talent but low against that Persona — which is the whole point.

---

## Layer 4.6 — Signal Detection *(v2 Phase C)*
**File:** `signalDetector.js`

Runs each active `Signal` whose `appliesTo` is `prospect`, persisting qualified results — **including honest negatives** — to `Prospect.signals[]`.

Company-scoped Signals (`appliesTo: "company"`) run separately: chained onto company analysis, or on demand via `POST /companies/:id/detect-signals`.

---

## Layer 5 — Outreach Generation *(on demand, not auto-run)*
**File:** `outreach.js`

**Input:** prospect + enriched profile + classification + scoring + persona scores + signals + saved notes + the org's active **Playbook**

**What it does:**
- The active `Playbook` prompt drives business context, tone, and CTA (legacy hardcoded copy is only a fallback)
- Company analysis and detected signals are fed in as context
- Saved prospect notes are included — they are first-class input, not an ephemeral prompt
- Generates personalized messages per available channel
- Returns message objects with `status: "draft"`

**Campaign generation** (`/prospect-lists/:id/outreach/generate`) additionally: builds a multi-step `sequence`, addresses each prospect as their **best-scoring campaign Persona**, falls back per step across channels (email → first available), skips non-`ready` prospects, and works from **stored knowledge only** — it never re-analyzes.

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

## AI Prompt Design Rules

All prompts follow this structure:
```js
askClaude({
  systemPrompt: "You are a [role]. [context]. Always return valid JSON.",
  userPrompt:   "Here is the data: ... Return JSON in this shape: {...}",
  maxTokens:    2048
})

// Or, when the caller needs provider preference and wants to know what ran:
const { result, providerUsed } = await askAI(options, { preferredProvider: 'gemini' });
```

Key rules:
- System prompt sets the persona and output format constraint
- User prompt provides data + exact JSON schema expected
- The client auto-strips markdown code fences before `JSON.parse`
- On parse failure, the raw string is returned (for debugging)
- Temperature is set to `0.4` for consistent, structured output
- Model/fallback selection comes from env (`GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`) — don't hardcode model ids at call sites
