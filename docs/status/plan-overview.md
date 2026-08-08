# ProspectMind — Status & Plan

> **Single source of truth** for what's built, what's in flight, and what's next.
> Replaces the former `current.md`, `todos.md`, and `roadmap.md` (consolidated 2026-08-08 — they had drifted out of sync with each other and with the code).
>
> **Last verified against the codebase:** 2026-08-08 (commit `7498399`)
> Architecture detail for the v2 redesign lives in [`redesign-v2.md`](redesign-v2.md).

---

## Where the project stands

Phase 1 (MVP foundation) and the **entire v2 architecture redesign, Phases A–D**, are shipped and running. The app is deployed (Docker + Cloud Build), backed by MongoDB Atlas, with a BullMQ/Redis job queue and real LinkedIn scraping.

Active work is **company-identity accuracy** — making sure a company resolves to the *right* LinkedIn page — plus the operational UX around the shared LinkedIn session.

---

## ✅ Shipped

### Core platform (Phase 1)
Express 5 + Mongoose 8 API, Vite 6 + React 19 client, JWT multi-tenant auth (access 15m / refresh 7d), prospect CRUD + bulk CSV, Stripe billing plumbing, Resend transactional email, email verification, forgot/reset password, monthly usage reset cron, plan-limit upgrade prompts, pagination, and graceful pipeline-failure states.

### v2 Redesign — Phases A–D

| Phase | Status | What shipped |
|---|---|---|
| **A · Company module** | ✅ Done | `Company` model, `/api/companies` CRUD, AI company analysis (website discovery → scrape → summary/industry/size, cached with `sourceRefs` provenance), Companies list + detail pages. `Prospect.companyRef` added *alongside* the legacy string (additive; 119 prospects → 61 companies backfilled). |
| **B · Settings** | ✅ Done | `Persona` / `Playbook` / `Signal` models, shared CRUD factory, routes, and real Settings UI for all three (Signals carry an `appliesTo`). GoodHive defaults seeded org-wide via `db:seed-settings`. |
| **C · Dynamic pipeline** | ✅ Done | Persona scoring → `personaScores[]` (Layer 4.5). Signal detection per `appliesTo` — prospect signals in-pipeline (Layer 4.6), company signals chained onto company analysis + on-demand. Playbook-driven outreach: the org's active Playbook drives business context, tone, and CTA. |
| **D · Campaign module** | ✅ Done | Unified into one object (2026-07-28): `ProspectList` **is** the campaign, carrying `personas[]`/`playbooks[]`/`signals[]`, the outreach `sequence`, and `outreach{status,playbook,results[]}`. Generation builds per-prospect sequences from **stored knowledge only** — never re-analyzes. UI is a campaign gallery + workspace with Prospects / Strategy / Outreach tabs. |
| **E · Traceability + refresh** | ⬜ **Not started** | `source`/`confidence`/`lastRefreshedAt` on stored fields; diff-aware refresh endpoints. The only untouched redesign phase. |

### Built beyond the original plan

These shipped after the v2 phases and were never in the roadmap:

- **LinkedIn scraping, in-house** — `linkedinScraper`, `linkedinCompanyScraper`, `linkedinResolver`, plus **live remote login**: a real Chrome inside the production container driven by an owner/admin over VNC. The roadmap had assumed Apify.
- **Company Finder** (`/api/company-finder`) — pluggable source registry (currently `cryptojobslist`), browse → detail → save into Companies, plus website contact scanning.
- **GitHub Talent Engine** — `GithubTalentCampaign` model, dedicated scraper + queue, AI keyword generation, run/pause/resume, and two frontend pages.
- **BullMQ + Redis queue** — was Phase 4 "Scale"; already live. Workers are gated behind `RUN_WORKERS` so only the designated instance polls Redis.
- **Deployment** — Dockerfile, entrypoint, Cloud Build.
- **Voice input** — `/api/ai/transcribe` + `MicButton`.

---

## 🔄 In flight (uncommitted working tree)

**Dead-LinkedIn-session UX.** A coherent, near-complete feature sitting uncommitted (11 files, ~+800 lines):

- `lastFailureAt` + `lastFailureContext` on `LinkedInSession`, so the alert re-opens per *failure event* rather than being dismissible forever
- `LinkedInSessionModal.jsx` — blocking interrupt with per-context copy; the existing banner stays as the standing reminder
- `DELETE /api/organization/linkedin-session` — deliberate disconnect
- `scripts/simulate-linkedin-failure.js` + `linkedin:simulate-down|up|status` scripts to exercise it without waiting for a real expiry
- A substantial `CompanyDetailPage.jsx` rework

**Next step:** verify in-browser, then commit.

---

## 📋 What's next

### 🔴 Priority 1 — Close out in-flight work
- [ ] Verify + commit the dead-session UX above
- [ ] Continue company-identity accuracy work (the last ~2 weeks of commits: About-page verification, candidate pooling, location qualifiers, domain equivalence)

### 🟠 Priority 2 — Redesign Phase E (traceability + refresh)
- [ ] `source` / `confidence` / `lastRefreshedAt` metadata on stored fields
- [ ] Diff-aware refresh endpoints (prospect, company, list, campaign) — not full reruns

### 🟡 Priority 3 — Retire the transitional scaffolding
Deliberate debt from the additive migration, now safe to pay down:
- [ ] Migrate `Prospect.company` string readers → `companyRef`, then drop the string
- [ ] Promote `personaScores[]` to the primary signal and retire legacy `compatibilityScore` / `scorer.js`
- [ ] Decide on Groq: either re-enable (`GROQ_ENABLED` in `claudeClient.js`) or remove the dormant routing

### 🔵 Priority 4 — Billing activation *(manual, outside the codebase)*
- [ ] Create Stripe products + prices in the dashboard
- [ ] Add price IDs to `.env`
- [ ] Install Stripe CLI + test the webhook locally

### 🟣 Priority 5 — Campaign sending
Single-message email send works end-to-end. Generated **sequences** still can't be sent or scheduled.
- [ ] Send + schedule campaign outreach sequences
- [ ] Reply detection (webhook/polling)
- [ ] LinkedIn / Telegram sending channels

---

## 🗺️ Longer-term roadmap

### Enrichment depth
| Item | Priority |
|---|---|
| Hunter.io — verified email finding | 🟡 Medium |
| ENS resolution (`.eth` → profile) | 🟡 Medium |
| Twitter/X API — followers, recent posts as context | 🟡 Medium |
| Cross-platform confidence validation | 🟡 Medium |
| `GITHUB_TOKEN` for 60 → 5000 req/hr | 🟢 Low |

*Serper (real Google results) and LinkedIn scraping are **done** — see Shipped.*

### Scale & intelligence
Pipeline webhooks · team collaboration (comments, assignment) · CRM integrations (HubSpot, Pipedrive, Salesforce) · public API access for a developer tier · prospect deduplication across imports · white-label.

*Background job queue and custom scoring criteria are **done** — BullMQ, and Personas respectively.*

### Web3 ecosystem intelligence
On-chain activity scoring · token-holder analysis · conference-speaker DB · podcast-guest tracking · DAO contributor graph · on-chain hiring signals.

### 🚫 Will NOT be built
Mass email/spam tools · fake profile generation · ToS-bypassing scraping · anything trading message quality for volume.

---

## Open questions

- Can a prospect belong to multiple concurrent campaigns?
- Are Personas/Playbooks/Signals org-only, or is there a platform-level default seed?
- Does `Company` get its own usage/plan limit?
- How should channel availability be enforced when a prospect lacks a campaign's selected channel?
- Should unverified users be blocked from protected routes? (deferred as optional for MVP)

---

## Keeping this file honest

See the "Documentation" section of `/CLAUDE.md`. In short: update this file in the same change that ships the behavior, and run `/sync-docs` periodically to audit docs against the code.
