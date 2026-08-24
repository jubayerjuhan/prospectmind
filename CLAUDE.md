# ProspectMind — LLM Context Guide

> **Read this file first. Then use the context routing table below to load ONLY what you need.**
> Do NOT read all files blindly — each doc is self-contained for its topic.

---

## What Is This Project

**ProspectMind** is a B2B SaaS that takes minimal prospect data (name + company) and runs it through a multi-layer AI pipeline to auto-enrich profiles, classify roles, score prospects against user-defined **Personas**, detect **Signals**, and generate **Playbook**-driven outreach.

Built with: **Vite + React** (frontend) · **Node.js + Express** (backend) · **MongoDB** (database) · **Gemini** (AI) · **BullMQ/Redis** (queue) · **Puppeteer** (LinkedIn scraping) · **Stripe** (billing) · **Resend** (email)

Initial use case: Web3 recruiting intelligence (powering GoodHive internally), but built as a standalone multi-tenant SaaS.

**Core domain objects** (post-v2 redesign): `Prospect` · `Company` · `ProspectList` (= a Campaign) · `Persona` · `Playbook` · `Signal`.

A separate, intentionally disconnected surface: `NewsletterCampaign` · `NewsletterContact` · `NewsletterSuppression` — bulk opt-in email that never touches the AI pipeline or the prospect quota. See `docs/features/newsletters.md`.

---

## Monorepo Layout

```
prospectmind/
├── client/          # Vite + React frontend (port 5173)
├── server/          # Express API (port 5000; 5001 in local dev)
│   └── src/
│       ├── models/           # Mongoose schemas
│       ├── routes/           # Express route definitions
│       ├── controllers/      # Request handlers
│       ├── middleware/       # auth.js (JWT protect, requirePlan, requireRole)
│       └── services/
│           ├── ai/           # claudeClient.js router → geminiClient / groqClient
│           ├── pipeline/     # AI pipeline layers + BullMQ queue
│           ├── company/      # company resolution, analysis, LinkedIn matching
│           ├── scraper/      # LinkedIn (profile/company/live-login), web pages
│           ├── finder/       # pluggable Company Finder sources
│           ├── campaign/     # campaign execution
│           ├── cron/ stripe/ resend/
└── docs/            # All project documentation (see routing table below)
```

---

## 🗺️ Context Routing Table

**Use this to load only the file relevant to your task. Do not read others.**

| If you are working on… | Read this file |
|---|---|
| Project vision, goals, target market | `docs/project-overview.md` |
| System architecture, data flow, env vars | `docs/architecture.md` |
| The AI pipeline (any layer) | `docs/features/pipeline.md` |
| Auth — login, register, JWT, refresh | `docs/features/auth.md` |
| Billing — Stripe plans, webhooks, limits | `docs/features/billing.md` |
| Prospect model, enrichment, classification | `docs/features/prospects.md` |
| Outreach message generation logic | `docs/features/outreach.md` |
| Newsletters — bulk email, unsubscribe, scheduling | `docs/features/newsletters.md` |
| **What's done / in flight / next** | `docs/status/plan-overview.md` |
| v2 HLD (Company/Persona/Playbook/Signal/Campaign) | `docs/status/redesign-v2.md` |
| API endpoints reference | `docs/api/endpoints.md` |
| Frontend pages, components, routing | `docs/features/frontend.md` |

---

## Key Conventions

- **ES Modules** everywhere (`import/export`, `"type": "module"` in server `package.json`)
- **All AI calls** go through `server/src/services/ai/claudeClient.js` — `askAI()` (returns `{ result, providerUsed }`) or the `askClaude()` alias. **Never import a provider SDK directly.**
- **Pipeline runs on a queue** — prospect creation enqueues a BullMQ job; `runner.js` executes the layers in sequence and updates `pipelineStatus` at each step
- **Multi-tenant** — every DB query must be scoped to `organization: req.organization._id`. The single exception is `LinkedInSession`, a shared platform-level document.
- **JWT auth** — access token (15m) + refresh token (7d). Use `protect` middleware on all private routes
- **Plan limits** — check `org.canAddProspect()` before creating prospects. Newsletter contacts are exempt by design — they are not prospects and cost no quota
- **Email must be checked** — the Resend SDK returns `{ data, error }` and does **not** throw on API errors. Send through `deliver()` in `services/resend/emailService.js`, which throws; a bare `resend.emails.send()` reports failures as successes

### ⚠️ Gemini is the active AI provider, not Groq

`claudeClient.js` is a router over Gemini and Groq, but `GROQ_ENABLED` is currently **false** — Gemini serves every call regardless of a campaign's stored `preferredAiModel`. The Groq path is intact and dormant; flip the flag to re-enable. The `claudeClient` / `askClaude` naming is historical: **no Anthropic API is used.** A third client, `localAiClient.js`, wraps a self-hosted `groq-ai-api` backend (its own Groq model fallback chain behind one endpoint) as a last-resort fallback after Gemini's full chain fails — active only when `LOCAL_AI_BASE_URL` is set.

---

## Current Stack Versions

| Package | Version |
|---|---|
| Node.js | v24+ |
| React | 19 |
| Express | 5 |
| Mongoose | 8 |
| AI model | Gemini — configured via `GEMINI_MODEL` + `GEMINI_FALLBACK_MODELS` |
| Vite | 6 |
| TailwindCSS | v4 (via `@tailwindcss/vite`) |

---

## Environment Variables (server/.env)

Full table with per-file usage: `docs/architecture.md`. The essentials:

| Key | Required | Description |
|---|---|---|
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `REDIS_URL` | ✅ | BullMQ queue backend |
| `RUN_WORKERS` | Optional | Set `false` so an instance serves HTTP without polling Redis |
| `GEMINI_API_KEY` | ✅ | Active AI provider |
| `GEMINI_MODEL` / `GEMINI_FALLBACK_MODELS` | Optional | Model + fallback chain |
| `GROQ_API_KEY` | Only if re-enabled | Dormant behind `GROQ_ENABLED` |
| `LOCAL_AI_BASE_URL` | Optional | Self-hosted `groq-ai-api` backend; last-resort fallback after Gemini fails |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | ✅ | Token signing keys |
| `CLIENT_URL` | ✅ | Frontend URL for CORS + email links |
| `SERPER_API_KEY` | Recommended | Real Google results for identity resolution |
| `LINKEDIN_LI_AT` | Scraping | Seed cookie for the shared LinkedIn session |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Billing only | Stripe |
| `RESEND_API_KEY` | Email only | Transactional email |

---

## How to Run

```bash
# Backend
cd server && npm run dev     # → http://localhost:5000

# Frontend
cd client && npm run dev     # → http://localhost:5173
```

---

## 📝 Documentation — keep it current

Docs drift silently and then mislead. **Treat a doc update as part of the change, not a follow-up.**

**When you finish work that changes any of the following, update the matching doc in the same change:**

| You changed… | Update |
|---|---|
| Shipped a feature, or finished/started a planned one | `docs/status/plan-overview.md` |
| Added/removed/renamed a route | `docs/api/endpoints.md` |
| Added a model, service, or env var | `docs/architecture.md` |
| Changed a pipeline layer or its ordering | `docs/features/pipeline.md` |
| Added a page, route, or shared component | `docs/features/frontend.md` |
| Changed newsletter sending, rendering, or unsubscribe | `docs/features/newsletters.md` |
| Changed a core convention or the AI provider | This file (`CLAUDE.md`) |

**Rules:**
1. `docs/status/plan-overview.md` is the **single source of truth** for status. Don't create new status files — the old four-file split is exactly what drifted.
2. Update the "Last verified against the codebase" line in `plan-overview.md` when you check it against real code.
3. Record **why** a thing is the way it is, especially deliberate debt ("additive, string migration deferred"). A future reader can see *what* the code does; they can't see what was intentional.
4. Never mark something ✅ Done without verifying it in the code.
5. Prefer editing an existing doc over adding a new one.

**Audit command:** run `/sync-docs` to systematically compare the docs against the codebase and report drift.
