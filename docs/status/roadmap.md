# Roadmap

---

## Phase 1 — Foundation (Current)
**Goal:** Working end-to-end MVP. One user can add prospects and get AI-generated outreach.

| Feature | Status |
|---|---|
| MERN stack setup | ✅ Done |
| JWT multi-tenant auth | ✅ Done |
| 5-layer Gemini AI pipeline | ✅ Done |
| Prospect management (CRUD + bulk) | ✅ Done |
| Message generation + human review | ✅ Done |
| Stripe billing (3 plans) | ✅ Done |
| Resend email integration | ✅ Done |
| First end-to-end test | ⬜ In progress |
| Auth completeness (verify, reset) | ⬜ Todo |
| Outreach email sending from UI | ⬜ Todo |

---

## Phase 2 — Real Enrichment (Next)
**Goal:** Replace AI-inferred identity with real scraped data. Make scores accurate and trustworthy.

| Feature | Priority |
|---|---|
| **Serper API integration** — pass real Google search results to Gemini for identity resolution | 🔴 High |
| **LinkedIn scraping (Apify)** — pull real profile data for enrichment | 🔴 High |
| **Hunter.io** — verified email finding | 🟡 Medium |
| **ENS resolution** — resolve `.eth` addresses to profiles | 🟡 Medium |
| **Twitter/X API** — real follower count, recent tweets as outreach context | 🟡 Medium |
| **GitHub token** — increase rate limit from 60 to 5000 req/hr | 🟢 Low |
| **Confidence score improvements** — cross-validate identity across platforms | 🟡 Medium |

---

## Phase 3 — Sending & Tracking
**Goal:** Full outreach automation with reply tracking. Close the loop.

| Feature | Priority |
|---|---|
| **Email sending from UI** (Resend) | 🔴 High |
| **LinkedIn message sending** (Phantombuster or native API) | 🟡 Medium |
| **Telegram bot** — send messages via Telegram bot API | 🟡 Medium |
| **Reply detection** — webhook/polling to detect replies | 🟡 Medium |
| **Outreach sequences** — follow-up messages if no reply in X days | 🟢 Future |
| **Analytics dashboard** — open rates, reply rates, conversion | 🟢 Future |

---

## Phase 4 — Scale & Intelligence
**Goal:** Make ProspectMind smarter, faster, and enterprise-ready.

| Feature | Notes |
|---|---|
| **Background job queue** (BullMQ + Redis) | Replace inline async pipeline with proper queue. Retry logic, concurrency control. |
| **Pipeline webhooks** | Notify external systems when a prospect is ready |
| **Team collaboration** | Comments on prospects, assignment to team members |
| **CRM integrations** | Push enriched prospects to HubSpot, Pipedrive, Salesforce |
| **API access** | Let customers run pipeline via API key (developer tier) |
| **Custom scoring criteria** | Let orgs define their own compatibility dimensions |
| **Prospect deduplication** | Detect + merge duplicate prospects across imports |
| **White-label** | Allow agencies to resell under their own brand |

---

## Phase 5 — Web3 Ecosystem Intelligence
**Goal:** Become the definitive intelligence layer for Web3 recruiting.

| Feature | Notes |
|---|---|
| **On-chain activity scoring** — wallet activity, DAO votes, protocol interactions | |
| **Token holder analysis** — detect ecosystem insiders by holdings | |
| **Conference speaker database** — ETHDenver, Devcon, etc. | |
| **Podcast guest tracking** — Bankless, Unchained, etc. | |
| **DAO contributor graph** — cross-DAO influence mapping | |
| **Job market signals** — detect when companies are actively hiring via on-chain treasury moves | |

---

## What Will NOT Be Built

- Mass email blasting / spam tools
- Fake profile generation
- Any feature that bypasses platform ToS (no scraping with fake accounts)
- Features that compromise message quality in favor of volume
