# ProspectMind — Status & Plan

> **Single source of truth** for what's built, what's in flight, and what's next.
> Replaces the former `current.md`, `todos.md`, and `roadmap.md` (consolidated 2026-08-08 — they had drifted out of sync with each other and with the code).
>
> **Last verified against the codebase:** 2026-08-24 (lemlist push: self-contained HTML fragments — a live push mangled 5 messages)
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
- **Outreach export — CSV + a lemlist-facing JSON API** (`services/campaign/outreachExport.js`, `utils/csv.js`, `GET /prospect-lists/:id/outreach/{export,leads}`) — generated sequences were readable only in the UI, one card at a time. Both formats are built from **one lead shape**, because a column present in one and missing from the other is the kind of drift nobody notices until a sequence goes out with an empty variable. Keys are flat camelCase (`step1Message`, `step2Subject`) so lemlist maps them onto variables with no transformation. This forced the first **organization API key**: a JWT expires in 15 minutes and no third-party integration can run the refresh dance. Only a SHA-256 hash is stored and the plaintext is shown exactly once — a database dump must not be a set of live credentials to every customer's prospect data — and the key-accepting middleware is mounted on that single endpoint rather than app-wide. CSV specifics that matter: every field is quoted (message bodies contain commas and newlines as a matter of course, and an unquoted newline silently splits a row), a leading `=`/`+`/`-`/`@` is neutralised so Excel does not evaluate a message as a formula, and the file carries a UTF-8 BOM so accented names render instead of mojibake.
- **Deleting prospects** (`ConfirmDialog` + a fixed `DELETE /prospects/:id`) — the endpoint only set `isArchived`, so a "deleted" prospect stayed in every campaign's `prospects[]` and kept inflating `prospectCount`, and a queued run for it would still have spent AI budget. It now does all three: flag, `$pull` from every campaign, cancel the queued job. The UI distinguishes **remove from campaign** (prospect survives, keeps its enrichment) from **delete prospect** (gone everywhere), because a single "remove" affordance made those look like one action; both go through a real modal that names the person and states the blast radius, replacing `window.confirm`.
- **Opt-in enrichment** (`not-started` status + `/start` endpoints) — every creation path used to queue a pipeline run immediately, so a CSV import spent quota and AI budget on rows the user had not reviewed. Prospects are now created `not-started` and run only when started, per prospect or per campaign. `pending` finally means one thing: queued. Pausing was reworked in the same change because the two states need opposite handling — a queued prospect is *removed from BullMQ* and marked paused in the same write (instant), while a running one can only be flagged and stops at the next layer boundary, which the UI shows honestly as "Pausing…" rather than claiming it stopped. Each run is filed under one job id, which is what makes cancellation possible and makes a double click on Start harmless. Not changed: the GitHub Talent Engine still enriches automatically, because there the run *is* the thing the user started. Left behind by the old behaviour: ~55 prospects sit in `pending`/`enriching` with no job in the queue — `npm run pipeline:reset-stale` reconciles them (dry run by default).
- **Pipeline activity log** (`services/pipeline/activityLog.js` + `PipelineActivity.jsx`) — a run took minutes behind the single word `enriching`, so a user watching the page could not tell progress from a hang. The layers now narrate themselves into `Prospect.pipelineActivity[]` and the detail page renders it live. Three decisions: (1) the log context is bound with `AsyncLocalStorage` in `runPipeline()` rather than passed as a parameter — the interesting details sit several calls deep, and `scrapePage`/`searchGoogle` are shared with callers that have no prospect, so `logActivity()` must no-op silently outside a run; a module global would cross-contaminate concurrent BullMQ jobs. (2) Writes are fire-and-forget: narration must never slow or fail the work it describes. (3) The messages are a **separate track from the console logs**, phrased for a customer — no layer numbers, scraper names or prompt internals — because the point is to show what was learned, not how. Fixed alongside it: the detail page's `refetchInterval` used the React Query **v4** callback signature (`(data) => …`), which in v5 receives the *query* — the read was always `undefined`, so the page never polled and a finished run only appeared after a manual refresh. Same bug fixed on both GitHub Talent pages.
- **Server unit tests** — `node --test` via `npm test` in `server/`, no new dependencies. First tests cover the prospect finder's URL allowlist and the merge rule: both are places where a wrong call silently corrupts data.

---

## 🔄 In flight (uncommitted working tree)

**Push a campaign into lemlist (shipped: planner, executor, client, service,
routes, settings connector, and the button).**

One ProspectMind campaign → **one** lemlist campaign. Each touch (stepOrder)
can fan out into MULTIPLE lemlist steps — one per distinct channel any lead
actually resolved to at that position (`services/campaign/lemlistPush.js`,
pure, see `touchesFor`). `list.sequence[i].channel` only ever decided touch
COUNT and delay now, never the lemlist step type — that field is advisory,
reachability is real.

Two corrections landed on top of each other here, both from the same user
report ("why did we lose 2 leads, we clearly have 5"):
1. An earlier version bucketed leads by their per-prospect resolved channel
   and created one lemlist campaign per bucket — `Demo Campaign 2` fanned out
   into 4 campaigns from 6 leads. Corrected to one campaign after explicit
   pushback: "I want everything under one campaign."
2. The one-campaign-per-configured-sequence version that followed still lost
   people: `Demo Campaign 2`'s configured sequence was email-only, so three
   prospects who only had a LinkedIn URL (no email, no fallback field the
   sequence's steps needed) were silently unreachable — correct given the
   design, invisible until the reachability preview (below) surfaced it. Fixed
   by deriving each touch's channel(s) from what leads actually resolved to,
   not from the configured sequence's single channel field.

Dual-reachable leads (both email and LinkedIn on file) get BOTH steps at a
touch — explicit product choice, asked directly: same generated text sent via
every channel the lead has, prioritizing reach over the (real, accepted) risk
of a duplicate-content contact. Verified live: `Demo Campaign 2` went from
2 pushable / 4 skipped to 5 pushable / 1 skipped (the 1 is Benoit Kulesza,
whose pipeline never finished — no contact data of any kind, not a sequence
gap), 4 lemlist steps (email, linkedin, email, linkedin) instead of 2.

**Formatting is channel-aware, and now double-encoded per touch.** A real push
surfaced a formatting bug: generated copy's `\n\n` paragraph breaks were
vanishing in lemlist's own preview ("Hi Jubayer,I was impressed…" instead of
two paragraphs), because lemlist substitutes `{{step1Message}}` as a literal
string into `<p>{{step1Message}}</p>` with no newline handling of its own.

Fixing the fan-out above reintroduced this at a sharper angle: since the SAME
touch can now be sent by both an email step (needs HTML) and a LinkedIn step
(needs plain text) to a dual-reachable lead, one flat `stepNMessage` value
cannot correctly serve both — HTML entities/`<br>` would appear as literal
text in a LinkedIn DM, and raw `\n\n` still collapses in an email. Every
message is therefore emitted in two encodings: `stepNMessage` (HTML-escaped,
paragraph breaks converted — for an email step) and `stepNMessageText` (plain,
untouched — for LinkedIn/manual). Each step template reads whichever key is
correct for it; a lead who can't satisfy a given step never has that step fire
regardless of which encoding it referenced.

**Third bug, found live, after the encoding fix above: the value must be a
self-contained HTML fragment — nothing may rely on the step's own wrapper.**
The encoding fix's first version deliberately produced an UNBALANCED fragment
("Hi Jubayer,</p><p>I was…", no leading `<p>` or trailing `</p>`), meant to
complete itself once substituted into the step's own
`<p>{{step1Message}}</p>` template. A real push to a real lemlist campaign
showed lemlist does not treat the two as one string before storing the
variable — something in that path "balances" an unbalanced fragment on its
own: the orphan leading `</p>` got an empty `<p></p>` inserted before it, and
the unclosed trailing paragraph got a spurious `</p>` appended, corrupting
five real prospects' messages in a live-pushed campaign. Confirmed by testing
a brand-new never-before-seen contact with the same shape of value — not
specific to one lead, a property of how lemlist stores any variable that looks
like an HTML fragment. Fixed by making `toEmailHtml` wrap every paragraph in
its own `<p>…</p>` and dropping the outer wrap from the step template
entirely — verified by round-tripping the corrected value through a real
lemlist lead and diffing it byte-for-byte against what was sent.

The corrupted variables on the 5 already-pushed leads in the live
`Demo Campaign 2` lemlist campaign were repaired in place via
`PATCH /leads/{id}/variables` (recomputed from the same DB data, same
function, now fixed). The campaign's STEP TEMPLATES were not repaired: by the
time this was attempted, the sequence had been restructured directly inside
lemlist's own UI (a conditional "has email?" branch, not the flat linear
sequence this push created) — editing it back via API would have destroyed
work in progress there. This is a standing risk worth naming: nothing on our
side knows if a pushed campaign's sequence has since been hand-edited in
lemlist, so a "Push again" from ProspectMind after that point could
re-diverge from — or conflict with — whatever exists live. Not solved here;
flagged for whoever picks this up next.

**A reachability preview runs before every push.** `GET
/prospect-lists/:id/lemlist-push/preview` (`previewLemlistPush` in
`lemlistPushService.js`) computes the exact same plan `buildPushPlan` would,
without calling lemlist or writing anything — so "2 of 6 aren't reachable
on this sequence" is visible on the outreach tab before the click, not
discovered after in the result of a campaign that now exists and can't be
deleted. Added after a real case: `Demo Campaign 2` configured
email→telegram→email→x has no LinkedIn step at all, so two prospects who
only had a LinkedIn URL were silently unreachable — correct behavior, but
invisible until the preview surfaced it as "not reachable on any configured
channel." The frontend refetches it automatically when generation completes
(keyed on `outreach.lastGeneratedAt`) and when the sequence is saved.

Live-fired for real against the connected Fanzio lemlist account (with the
user's explicit go-ahead) and verified against lemlist's own API afterward,
not just the local DB record — both before and after the one-campaign fix.

Routes: `GET .../lemlist-push/preview`, `POST/GET .../lemlist-push`
(fire-and-forget + poll, same shape as `outreach/generate`), and
`GET/POST/DELETE /organization/lemlist`. Frontend: `LemlistSettings.jsx`
(mirrors `ApiKeySettings.jsx`) on the Settings page, and the "Push to lemlist"
section on `CampaignOutreachTab.jsx` — reachability panel, push button,
per-campaign progress card, all polling/refetching live.

The design constraint, verified against the live lemlist API: `campaignExecutor`
resolves a step's channel **per prospect** (the fallback in
`generateSequenceForProspect`), while a lemlist step has one `type` for every
lead under it, and lemlist's `conditional` step keys are behavioural, not
"this lead has an email". A prospect reachable on none of the campaign's
configured steps is refused with a reason (`buildPushPlan`'s `refusalFor`);
one reachable on only some steps is still pushed.

Also confirmed against the live API and worth not rediscovering:
- There is **no delete-campaign endpoint**. A bad push is permanent — this
  drove both the reachability preview above and the "unsafe delete is not
  expressible" choice below.
- `DELETE /campaigns/{id}/leads/{id}` **without `?action=remove` unsubscribes**
  the lead and adds it to the team-wide suppression list.
- `GET /export/leads` returns a header row only unless given `?state=all`.
- Rate limit is 20 requests per 2 seconds per key, so the push must be a job.

Deliberate choices worth keeping:
- `autoReview` defaults **false**. A one-click button must not start emailing
  real people before a human looks at the campaign.
- The unsafe delete is **not expressible**: `removeLead` hard-codes
  `?action=remove` rather than accepting it as an argument.
- A failed step aborts that campaign's leads. A lead sitting in a half-built
  sequence looks ready to send, which is worse than a lead never added.
- Every lemlist id is reported before the work that might fail, so an
  interrupted push cannot leave campaigns the caller never heard about — they
  could never be deleted. `executePushPlan` hands a self-contained snapshot
  (not a live reference) to `onProgress` on every event for exactly this
  reason — a caught bug during testing: `{ ...record }` alone still shared the
  `leadFailures`/`stepIds` ARRAYS across snapshots, so an early "campaign
  created" snapshot would silently mutate later in the run.
- A second `POST /lemlist-push` while one is already `pushing` is refused
  (400) rather than queued — lemlist has no delete-campaign endpoint, so a
  double-click must not be able to make duplicates.

The dead-LinkedIn-session UX that previously sat here shipped in `7c17464`
(`lastFailureAt`/`lastFailureContext` on `LinkedInSession`, `LinkedInSessionModal`,
`DELETE /api/organization/linkedin-session`, the `linkedin:simulate-*` scripts,
and the `CompanyDetailPage` rework).

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
