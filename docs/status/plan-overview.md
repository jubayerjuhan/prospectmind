# ProspectMind — Tasks & Roadmap (Single-Page Overview)

> Consolidated view of **what to do next** (tasks) and **where we're headed** (roadmap).
> Sources: [`todos.md`](todos.md) · [`roadmap.md`](roadmap.md) · [`redesign-v2.md`](redesign-v2.md)
> Generated 2026-07-25. When these diverge, the source files are authoritative.

---

## 📋 Task List

### ⭐ Priority 0 — Architecture Redesign (stakeholder HLD)
> Full plan + data models: [`redesign-v2.md`](redesign-v2.md). **In progress** — started with Persona (Phase B) as the lowest-risk, additive slice; see notes below the table.

| Phase | Tasks | Status |
|---|---|---|
| **A · Company module** | `Company` model + CRUD + `/api/companies` ✅; `Prospect.companyRef` added *alongside* the string (additive, no rename) + backfill (119 prospects → 61 companies) ✅; independent AI analysis (auto website discovery → scrape → summary/industry/size, cached, sourceRefs provenance) with `POST /:id/analyze` + auto-run on first pipeline link ✅; Companies page in sidebar ✅. Remaining: migrate string readers to the ref, then drop the string. | ✅ Done (additive; string migration deferred) |
| **B · Settings (Persona/Playbook/Signal)** | All three models + shared CRUD factory + routes ✅; Settings UI cards for all three (Signals with applies-to) ✅; GoodHive defaults seeded across all orgs (persona + playbook + signal, `db:seed-settings`) ✅ | ✅ Done |
| **C · Dynamic pipeline** | Persona scoring: active Personas scored via their prompts → `personaScores[]` (additive, campaign-agnostic) ✅. Signal-detection layer ⬜. Playbook-driven outreach ⬜. Note: legacy `compatibilityScore`/`scorer.js` deliberately kept alongside for now (not yet replaced). | 🟡 Persona scoring done; Signals + Playbook outreach pending |
| **D · Campaign module** | `Campaign` model + controller/routes + execution service; Campaigns page in frontend | ⬜ Not started |
| **E · Traceability + refresh** | `source`/`confidence`/`lastRefreshedAt` on stored fields; diff-aware refresh endpoints (prospect, company, list, campaign) | ⬜ Not started |

**Progress notes (as of 2026-07-25):**
- ✅ **Persona is first-class end-to-end** — authored in Settings → pipeline scores every prospect against each active Persona's prompt → `personaScores[]` persists. Verified on real prospects (a research scientist scores high as "talent" but low against a "Founder hiring Web3 talent" persona; a Web3 founder scores 95/100). Committed.
- **Deliberately additive:** old `compatibilityScore` untouched, so nothing regresses. Persona scoring runs *alongside* it. A later step can promote persona scores to the primary signal once trusted.
- **Not yet surfaced in the UI** — `personaScores` is stored but the Prospect detail page doesn't display it yet.
- **Remaining greenfield:** Company module (A), Playbook + Signal models/UI (B), Signal-detection + Playbook-driven outreach (C), Campaign module (D), traceability/refresh (E).

**Open questions (resolve before building):** multiple concurrent campaigns per prospect? drop vs. keep old classification fields during transition? Personas/Playbooks/Signals org-only or platform-level seed? does `Company` get its own plan limit? campaign targeting shape (`ProspectList` vs. ad-hoc/segment)? channel-availability enforcement when a prospect lacks a selected channel?

### 🔴 Priority 1 — Get It Running (blocking)
> Baseline confirmed running 2026-07-25 (Mongo Atlas connected, both servers healthy, pipeline produces real Gemini output; 164 prospects in DB, 69 `ready`).
- ✅ MongoDB running (Atlas)
- ✅ `MONGODB_URI` set in `server/.env`
- ✅ Both servers start clean (server :5001, client :5173)
- ⬜ Register an account — test full register flow, org creation, JWT *(not re-verified via UI this session)*
- ⬜ Add a prospect manually — verify save with `pipelineStatus: "pending"` *(not re-verified via UI this session)*
- ✅ Pipeline runs through all stages (verified end-to-end via runner)
- ✅ Verify AI output — real Gemini enrichedProfile/classification/score/personaScores (non-fallback), Serper discovery working with refreshed key

### 🟡 Priority 2 — Polish Core Flow
- ✅ Upgrade prompt/modal on plan limit
- ✅ Loading skeleton on ProspectDetailPage during pipeline
- ✅ Dashboard empty state + "Add your first prospect" CTA
- ✅ `scoreLabel` badge on prospect detail
- ✅ Pagination on prospects table
- ✅ Graceful `failed` pipeline state in UI

### 🟢 Priority 3 — Auth Completeness
- ✅ Email verification on register (Resend)
- ✅ Forgot / reset password flow
- ⬜ Protect routes from unverified users (optional for MVP)

### 🔵 Priority 4 — Billing Activation
- ⬜ Create Stripe products + prices *(manual: Stripe dashboard)*
- ⬜ Add price IDs to `.env` *(manual)*
- ⬜ Install Stripe CLI + test webhook locally *(manual)*
- ✅ Monthly usage reset
- ✅ Plan badge + usage % in sidebar

### 🟣 Priority 5 — Outreach Sending
- ✅ "Send via Email" on approved messages
- ✅ Message status → `sent`
- ✅ Sent timestamp

---

## 🗺️ Roadmap

### Phase 1 — Foundation *(current)*
Working end-to-end MVP: add prospects, get AI-generated outreach.

| Feature | Status |
|---|---|
| MERN stack setup | ✅ Done |
| JWT multi-tenant auth | ✅ Done |
| 5-layer Groq AI pipeline | ✅ Done |
| Prospect management (CRUD + bulk) | ✅ Done |
| Message generation + human review | ✅ Done |
| Stripe billing (3 plans) | ✅ Done |
| Resend email integration | ✅ Done |
| First end-to-end test | 🔄 In progress |
| Auth completeness (verify, reset) | ⬜ Todo |
| Outreach email sending from UI | ⬜ Todo |

### Phase 2 — Real Enrichment *(next)*
Replace AI-inferred identity with real scraped data; make scores trustworthy.

| Feature | Priority |
|---|---|
| Serper API — real Google results for identity resolution | 🔴 High |
| LinkedIn scraping (Apify) | 🔴 High |
| Hunter.io — verified email finding | 🟡 Medium |
| ENS resolution (`.eth` → profile) | 🟡 Medium |
| Twitter/X API — followers, recent tweets as context | 🟡 Medium |
| GitHub token — 60 → 5000 req/hr | 🟢 Low |
| Confidence-score cross-validation across platforms | 🟡 Medium |

### Phase 3 — Sending & Tracking
Full outreach automation with reply tracking.

| Feature | Priority |
|---|---|
| Email sending from UI (Resend) | 🔴 High |
| LinkedIn message sending (Phantombuster / native) | 🟡 Medium |
| Telegram bot sending | 🟡 Medium |
| Reply detection (webhook/polling) | 🟡 Medium |
| Outreach sequences (follow-ups if no reply) | 🟢 Future |
| Analytics dashboard (open/reply/conversion) | 🟢 Future |

### Phase 4 — Scale & Intelligence
| Feature | Notes |
|---|---|
| Background job queue (BullMQ + Redis) | Replace inline async pipeline; retry + concurrency |
| Pipeline webhooks | Notify external systems when a prospect is ready |
| Team collaboration | Comments, assignment to teammates |
| CRM integrations | HubSpot, Pipedrive, Salesforce |
| API access | Developer tier via API key |
| Custom scoring criteria | Orgs define their own dimensions |
| Prospect deduplication | Detect + merge duplicates across imports |
| White-label | Agencies resell under their brand |

### Phase 5 — Web3 Ecosystem Intelligence
On-chain activity scoring · token-holder analysis · conference-speaker DB · podcast-guest tracking · DAO contributor graph · on-chain hiring signals.

### 🚫 Will NOT be built
Mass email/spam tools · fake profile generation · ToS-bypassing scraping · anything trading message quality for volume.

---

## How the redesign maps onto the roadmap
Priority 0 (the HLD redesign) reshapes the **foundation** the later roadmap phases build on: Phase 2's real enrichment sources become the *modular enrichment* jobs (§5.3), Phase 3's sending becomes *Campaign execution*, and Phase 4's custom scoring is largely subsumed by user-defined *Personas*. Do Priority 0 Phases A–E before layering Phase 2+ integrations on top.
