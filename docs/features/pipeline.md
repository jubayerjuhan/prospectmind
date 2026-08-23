# AI Pipeline

**File:** `server/src/services/pipeline/runner.js` (orchestrator)
**Queue:** `server/src/services/pipeline/queue.js` — BullMQ on Redis, concurrency 1
**AI Client:** `server/src/services/ai/claudeClient.js` → **Gemini** via `geminiClient.js`

---

## Overview

**Enrichment is opt-in.** Creating a prospect does *not* enqueue anything — it lands in `not-started` and waits for `POST /prospects/:id/start`, or for `POST /prospect-lists/:id/start` which starts every not-started prospect in a campaign at once. Auto-running on create meant a 500-row CSV spent a month of quota and AI budget on rows nobody had looked at yet. Once started, the runner updates `pipelineStatus` at each step so the frontend can show live progress.

```
Status progression:
not-started → pending → discovering → enriching → classifying → scoring → ready
   (created)  (queued)                                        ↘ failed (on error)
                                                              ↘ paused (on request)
```

### Pausing

Two different mechanisms, because a queued run and a running one need opposite treatment (`services/pipeline/pauseControl.js`):

| The prospect is… | What happens | What the user sees |
|---|---|---|
| Queued (`pending`) | The BullMQ job is removed outright and the status flips to `paused` in the same write | `Paused`, on the next poll |
| Mid-run | Cooperative: `pipelinePaused` is set and the runner stops at the next layer boundary (`pauseIfRequested`) | `Pausing…` until the layer returns, then `Paused` |

The queue runs one prospect at a time, so a campaign works through its prospects in order. Pausing one takes **only that one** out — the rest keep moving, and the worker picks up the next unpaused prospect immediately.

Each run is filed under a single job id (`jobId.js`), which is what makes a queued run cancellable and makes a double click on Start impossible to turn into two runs. That module is separate from `queue.js` only so it can be unit-tested without opening a Redis connection.

Layers call `askAI()` / `askClaude()`, which route to **Gemini** — Groq is held back behind the `GROQ_ENABLED` flag in `claudeClient.js`, so `preferredAiModel` on a campaign is currently ignored. If a model fails, the client retries its configured fallback chain before failing the pipeline. **Never import a provider SDK directly.**

**Layer 5 does not run automatically.** Outreach is generated on demand — per prospect (`POST /prospects/:id/generate-messages`) or per campaign (`POST /prospect-lists/:id/outreach/generate`) — so a prospect reaches `ready` after scoring and signals.

### Activity log — what the user sees while it runs

`pipelineStatus` alone gave the UI one word (`enriching`) for what is often the
longest minutes of the run. The runner also writes a plain-language trace to
`prospect.pipelineActivity[]` — `{ at, step, message, level }`, capped at the
last 60 entries and cleared at the start of each run.

- Emitted with `logActivity(message, { step, level })` from
  `services/pipeline/activityLog.js`.
- The context is bound once, in `runPipeline()`, via `AsyncLocalStorage` — so
  any layer can narrate without a logger being threaded through its signature,
  and `logActivity()` is a **silent no-op outside a pipeline run**. That matters
  because `scrapePage` / `searchGoogle` are shared with company analysis and the
  GitHub talent queue, which have no prospect to log against. A module-level
  global would have cross-contaminated concurrent BullMQ jobs; the run-scoped
  store keeps each prospect's trace to itself.
- Writes are **fire-and-forget** `$push`es. Narration must never slow down or
  fail the work it narrates — a dropped line is invisible, an awaited write per
  step would add a round-trip each time.
- Messages are written **for the end user**, not for us: no layer numbers, no
  scraper engine names, no prompt sizes. The console logs remain the technical
  track; these two are deliberately separate. When adding one, ask whether a
  customer reading it would learn something they could act on.
- Excluded from the prospect **list** payload (`-pipelineActivity`) — only the
  detail page reads it.

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

**Input:** prospect + enriched profile + classification + `fullCampaignContext`

`fullCampaignContext` is assembled in `runner.js` and is the *only* place campaign
intent reaches the analysis pipeline. It concatenates:

| Part | Source | Fallback |
|---|---|---|
| Campaign goal | `ProspectList.campaignDescription` | `org.settings.campaignDescription` → `org.settings.icpRules` → `''` |
| Ecosystem hint | `ProspectList.targetEcosystemContext` | `org.settings.defaultEcosystem` (default `web3`) |
| Persona definitions | the campaign's selected `personas[]` | **every active Persona in the org** |

The campaign is reverse-resolved from list membership (`ProspectList.findOne({ prospects: prospect._id, type: 'manual' })`)
because the queue payload is only `{ prospectId }`. A prospect that belongs to no
campaign is therefore scored against an **empty goal** plus all org personas — the
prompt still frames it as a campaign, which is why orphan prospects trend generic.

**What it does:**
- Dynamically generates 3–5 scoring dimensions per prospect based on their
  classification and the campaign goal, then scores 0–100 across them.
  *(There is no longer a fixed weighted rubric — the old "Web3 depth 30% /
  technical quality 25%…" tables were removed when scoring went dynamic.)*
- Determines outreach priority: `high | medium | low`
- Identifies best contact channel
- Returns a human-readable score label
- Persists a `scoringContext` snapshot (which campaign, which goal source,
  ecosystem, persona names) alongside the score, so the UI can state what the
  number was measured against. Re-deriving it at read time would drift once
  campaign membership or org settings change.

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
6. Add a `step` value to the `pipelineActivity.step` enum plus a `STEP_LABEL`
   entry in `client/src/components/prospects/PipelineActivity.jsx`, and call
   `logActivity()` at the points a user would want narrated

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
