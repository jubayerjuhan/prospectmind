# ProspectMind — Status & Plan

> **Single source of truth** for what's built, what's in flight, and what's next.
> Replaces the former `current.md`, `todos.md`, and `roadmap.md` (consolidated 2026-08-08 — they had drifted out of sync with each other and with the code).
>
> **Last verified against the codebase:** 2026-08-21 (newsletters)
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
- **LinkedIn browser identity** (`linkedinBrowserIdentity.js`) — fixes an infinite-CAPTCHA loop on live login. LinkedIn's challenge is an Arkose FunCaptcha, which responds to a contradictory fingerprint by serving challenges that can never be *passed*, rather than by blocking. Three contradictions were removed: (1) a hardcoded `Chrome/124` **macOS** user-agent sitting next to un-overridden `Sec-CH-UA` client hints that correctly reported **Linux, Chrome 139+** — the UA is now derived from the running binary, and headful browsers get no UA override at all; (2) `Network.clearBrowserCookies` before every login, which wiped `bcookie` and made every attempt an unrecognised device — device cookies now persist on the session doc (`deviceCookies`) and are re-injected pre-login, which survives a Cloud Run cold start in a way `userDataDir` cannot; (3) a randomly rotated proxy per launch, so a session minted on one exit IP was replayed from another subnet — the identity is now **pinned** to one proxy stored on `LinkedInSession.proxy`. `LINKEDIN_USE_PROXY=false` remains the fastest way to tell an IP-reputation problem apart from a fingerprint one.
- **Newsletters** (`/api/newsletters`) — a second, deliberately separate sending surface: `NewsletterCampaign` + `NewsletterContact` + `NewsletterSuppression`, a TipTap composer producing sanitized HTML with `{{firstName}}` merge tags, one-off blasts sent now or scheduled via BullMQ **delayed jobs**, and a compliant unsubscribe. Recipients are **not** `Prospect`s: no pipeline, no enrichment, and no consumption of the prospect quota. Three decisions worth remembering: (1) unsubscribe **GET renders a confirmation page and mutates nothing** — Outlook Safe Links and Gmail prefetch every URL in a delivered email, so a GET-unsubscribes design silently opts out part of the list on delivery; POST performs it and also serves RFC 8058 one-click. (2) Suppression is **org-wide and keyed on the address**, not on the contact row, so a later import into a different campaign cannot resurrect someone who opted out. (3) Scheduling uses BullMQ delayed jobs rather than `node-cron` because `startUsageResetCron` is not gated by `RUN_WORKERS` and Cloud Run runs up to three replicas — a cron sweep would send every scheduled newsletter three times.
- **Company Finder** (`/api/company-finder`) — pluggable source registry (currently `cryptojobslist`), browse → detail → save into Companies, plus website contact scanning.
- **GitHub Talent Engine** — `GithubTalentCampaign` model, dedicated scraper + queue, AI keyword generation, run/pause/resume, and two frontend pages.
- **BullMQ + Redis queue** — was Phase 4 "Scale"; already live. Workers are gated behind `RUN_WORKERS` so only the designated instance polls Redis.
- **Deployment** — Dockerfile, entrypoint, Cloud Build.
- **Voice input** — `/api/ai/transcribe` + `MicButton`.
- **Company Prospect Finder** (`prospectFinder.js`) — plan Google queries from a Playbook, pool LinkedIn hits, AI-verify against the brief. Results are *candidates* held on the Company for review, so a loose run costs nothing against the plan limit until explicitly imported.
- **Company de-duplication** (`companyMerger.js`) — `certik.com` and `certik.org` were two rows for one company. Detection is deliberately conservative (matching name **plus** same brand across TLDs, or a keyless placeholder), and merging is always user-confirmed from the Companies page. A bare name match never merges — that collapse is exactly what the keyed identity model exists to prevent. Three vetoes were each added because real data broke the rule without them: differing LinkedIn keys *of the same form* (a slug and a numeric id are one page written two ways), contradicting industries (`kiln.fi` staking vs `kiln.com` coworking share a brand but are different companies), and ambiguity (a bare placeholder matching several keyed siblings is withheld rather than offered as a coin flip).
- **Scoring context, surfaced** (`Prospect.scoringContext` + `ScoreCell`) — a score on the Prospects list read as an absolute judgement, but the same prospect scores differently depending on whether Layer 4 saw a campaign goal, the org-level fallback, or nothing. The pipeline now snapshots what it scored against and the list labels each score accordingly (`🎯 <campaign>` / `Org default goal` / amber `No campaign goal`). Recorded at scoring time on purpose: re-deriving it on read drifts as soon as a prospect is moved between campaigns, and the reverse lookup is non-deterministic for a prospect in two. Prospects scored before the field existed render as `Context not recorded` rather than falsely claiming no campaign.
- **CSV import into a campaign** (`CampaignCsvImportModal` + `POST /prospect-lists/:id/prospects/bulk-import`) — the existing two-step URL import assumed a scrapeable page; a list that already exists as a spreadsheet had no route in. Parsing and column mapping happen in the browser so the user confirms the mapping before anything is created. The server still owns the guarantees: dedupe within the upload and against current members, clamp to the plan's remaining allowance rather than rejecting the whole file, and hold the pipeline until the campaign has a goal — an unscored prospect is recoverable, a prospect scored against an empty goal looks scored but isn't.
- **Server unit tests** — `node --test` via `npm test` in `server/`, no new dependencies. First tests cover the prospect finder's URL allowlist and the merge rule: both are places where a wrong call silently corrupts data.

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
  - ⚠️ **Not a straight swap.** `scorer.js` is the only analysis-layer prompt that sees the campaign *goal*; Layer 4.5 is campaign-blind by design (`runner.js` deliberately passes no `companyContext`, and persona prompts describe a person *type*, not the campaign objective). Deleting `scorer.js` as-is removes goal-aware scoring entirely. Feed `fullCampaignContext` into `personaScorer.js` first.
- [ ] Decide on Groq: either re-enable (`GROQ_ENABLED` in `claudeClient.js`) or remove the dormant routing

### 🔵 Priority 4 — Billing activation *(manual, outside the codebase)*
- [ ] Create Stripe products + prices in the dashboard
- [ ] Add price IDs to `.env`
- [ ] Install Stripe CLI + test the webhook locally

### 🟣 Priority 5 — Campaign sending
Single-message email send works end-to-end, and **Newsletters** now ship a full queued/scheduled bulk sender (see Shipped). Generated prospect **sequences** still can't be sent or scheduled — they remain copy for a human. The newsletter queue is the obvious thing to model that on when it happens.
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
Cold mass-mail / spam tooling · fake profile generation · ToS-bypassing scraping · anything trading message quality for volume.

> **Amended 2026-08-21.** This line used to read "Mass email/spam tools", which the Newsletters feature would have contradicted. The distinction that matters is consent, not volume: sending an opt-in newsletter to a list the operator brought, with a working unsubscribe and a permanent org-wide suppression list, is in scope. Blasting scraped or purchased addresses is not, and nothing in the product helps you do it — newsletter recipients have to be supplied by the operator and can never be created from prospecting output.

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
