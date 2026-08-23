# Architecture

## System Overview

```
┌───────────────────────────────────────────────────────────────┐
│                     CLIENT (Vite 6 + React 19)                │
│  Dashboard · Prospects · Companies · Company Finder ·         │
│  Campaigns · GitHub Talent Engine · Settings · Billing        │
│  Port: 5173                                                   │
└───────────────────────────┬───────────────────────────────────┘
                            │ REST (axios + auto token refresh)
┌───────────────────────────▼───────────────────────────────────┐
│                   SERVER (Express 5 + Node 24)                │
│  /api/auth /prospects /prospect-lists /companies              │
│  /company-finder /personas /playbooks /signals                │
│  /github-talent /organization /billing /ai                    │
│  Port: 5000 (5001 in local dev)                               │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Pipeline Runner (runner.js)                            │  │
│  │  L1 discovery → L2 enrichment → L3 classify → L4 score  │  │
│  │  → L4.5 persona score → L4.6 signals → L5 outreach      │  │
│  └─────────────────────────────────────────────────────────┘  │
└───┬─────────────┬──────────────┬─────────────┬────────────────┘
    │             │              │             │
┌───▼──────┐ ┌────▼──────┐ ┌─────▼──────┐ ┌────▼──────────────┐
│ MongoDB  │ │ Redis     │ │ Gemini API │ │ External sources  │
│ Atlas    │ │ (BullMQ)  │ │ (primary)  │ │ Serper · GitHub · │
│ Mongoose │ │ job queue │ │ Groq: held │ │ LinkedIn (Pptr)   │
└──────────┘ └───────────┘ └────────────┘ └───────────────────┘
```

**Deployment:** Docker (`server/Dockerfile` + `docker-entrypoint.sh`) via Cloud Build.

---

## ⚠️ AI provider: Gemini, not Groq

Despite the naming, **Gemini is the sole active AI provider.** `claudeClient.js` is a smart router:

```js
askAI(options, { preferredProvider })   // 'gemini' | 'groq' | 'auto'
askClaude(options)                      // backward-compatible alias
```

`GROQ_ENABLED` inside `claudeClient.js` is currently **false**, so Groq is held back org-wide regardless of a campaign's stored `preferredAiModel`. The full multi-provider routing is left intact — flip the flag to re-enable Groq without other changes.

**Always call AI through `askAI()` / `askClaude()`.** Never import a provider SDK directly.

---

## Backend File Structure

```
server/src/
├── server.js                 # Entry — connects DB, starts Express
├── app.js                    # CORS, helmet, rate limit, route mounting
├── config/db.js              # MongoDB connection
├── models/
│   ├── User.js               # email, password, org ref, role, refreshToken
│   ├── Organization.js       # plan, usage, members, Stripe ids, settings
│   │                         #   + apiKey: hash of the key WE issue (inbound pulls)
│   │                         #   + integrations.lemlist: key THEY issue, plaintext because
│   │                         #     it must be replayed on every outbound call (select:false)
│   ├── Prospect.js           # raw input + enriched profile + personaScores + signals + messages
│   │                         #   + scoringContext: snapshot of what Layer 4 scored against
│   │                         #     (campaign, goalSource, ecosystem, personaNames), written
│   │                         #     at scoring time because it can't be re-derived later
│   ├── Company.js            # first-class company (v2 Phase A)
│   ├── ProspectList.js       # IS the campaign (v2 Phase D) — personas/playbooks/signals/sequence/outreach
│   ├── Persona.js            # who we're scoring against (v2 Phase B)
│   ├── Playbook.js           # business context, tone, CTA for outreach
│   ├── Signal.js             # detectable condition + appliesTo (prospect | company)
│   ├── GithubTalentCampaign.js
│   ├── NewsletterCampaign.js # bulk email: content, sender, status, schedule, stats
│   ├── NewsletterContact.js  # recipient + per-send state. Scoped to ONE campaign,
│   │                         #     own collection so a send is a small targeted write
│   ├── NewsletterSuppression.js # org-wide do-not-mail list, keyed on the address
│   └── LinkedInSession.js    # shared cookie jar + health/failure state
├── routes/                   # index.js mounts all groups under /api
├── controllers/
├── middleware/auth.js        # protect(), requirePlan(), requireRole()
└── services/
    ├── ai/
    │   ├── claudeClient.js       # askAI()/askClaude() — provider router (see above)
    │   ├── geminiClient.js       # askGemini() — ACTIVE provider
    │   └── groqClient.js         # askGroq() — dormant behind GROQ_ENABLED
    ├── pipeline/
    │   ├── runner.js             # orchestrates every layer, updates DB per step
    │   ├── queue.js              # BullMQ queue + worker (gated by RUN_WORKERS)
    │   ├── discovery.js          # L1 identity resolution (Serper-backed)
    │   ├── enrichment.js         # L2 enrichment (GitHub API + LinkedIn scrape)
    │   ├── classifier.js         # L3 role classification
    │   ├── scorer.js             # L4 legacy compatibility score
    │   ├── personaScorer.js      # L4.5 per-Persona scoring
    │   ├── signalDetector.js     # L4.6 prospect + company signal detection
    │   ├── outreach.js           # L5 Playbook-driven message generation
    │   ├── activityLog.js        # user-facing run narration (AsyncLocalStorage-scoped)
    │   ├── pauseControl.js       # pause: dequeue if not started, cooperative if running
    │   ├── jobId.js              # the one BullMQ job id per prospect (unit-tested)
    │   └── (campaign/outreachExport.js — one lead shape for the CSV and the JSON API)
    │   ├── profileSnapshot.js
    │   └── githubTalentQueue.js
    ├── company/
    │   ├── companyService.js     # findOrCreatePlaceholder, CRUD helpers
    │   ├── companyResolver.js    # resolve a prospect's employer → Company
    │   ├── companyAnalyzer.js    # website discovery → scrape → AI analysis (cached)
    │   ├── linkedinResolver.js   # find + VERIFY a company's LinkedIn page
    │   ├── companyMerger.js      # duplicate detection + merge (certik.com/.org)
    │   ├── prospectFinder.js     # find the right PEOPLE at a known company
    │   ├── contactFinder.js
    │   └── atsBoards.js
    ├── newsletter/
    │   ├── newsletterQueue.js          # send queue + delayed scheduling + boot reconciler
    │   ├── newsletterSender.js         # the paced, resumable send loop
    │   ├── renderNewsletter.js         # sanitize → merge → wrap → plain-text
    │   └── unsubscribeToken.js         # stateless HMAC over the contact id
    ├── scraper/
    │   ├── linkedinBrowserIdentity.js  # one consistent "device" per launch
    │   ├── linkedinScraper.js          # profile scraping
    │   ├── linkedinCompanyScraper.js   # company page scraping
    │   ├── linkedinLiveLogin.js        # remote-driven Chrome login (VNC)
    │   ├── linkedinSessionAlert.js     # dead-session recording + owner email
    │   ├── companyContactScraper.js
    │   ├── githubTalentScraper.js
    │   └── pageScraper.js
    ├── finder/
    │   ├── sourceRegistry.js           # pluggable company sources
    │   └── sources/cryptojobslist.js
    ├── campaign/campaignExecutor.js
    ├── campaign/lemlistPush.js         # buildPushPlan: groups leads into lemlist
    │                                   #   campaigns by channel signature (pure, unit-tested)
    ├── campaign/lemlistPushExecutor.js # executePushPlan: replays a plan, contains failure
    ├── campaign/lemlistClient.js       # lemlist HTTP: basic auth, 20-req/2s pacing, 429
    │                                   #   retry, and removeLead pinned to ?action=remove
    └── campaign/lemlistPushService.js  # wires plan+execute+client to a real ProspectList,
                                        #   persists progress for the poll endpoint below
    ├── cron/usageReset.js              # monthly usage reset (node-cron)
    ├── stripe/stripeService.js
    └── resend/emailService.js
```

---

## Frontend File Structure

```
client/src/
├── App.jsx                   # Router, QueryClient, Toaster
├── lib/api.js                # Axios — attaches token, handles 401 refresh
├── stores/authStore.js       # Zustand (persisted)
├── components/
│   ├── layout/               # AppLayout, Sidebar, LinkedInSessionBanner, LinkedInSessionModal
│   ├── prospects/            # Add/Edit/BulkUpload/ProspectList/CampaignImport modals, PersonaRadar
│   ├── campaigns/            # CampaignCard, StrategyPicker, Strategy/Outreach tabs, ProspectTable
│   ├── settings/             # Personas/Playbooks/Signals settings + PromptSettingsSection
│   ├── companyFinder/        # CompanyFinderDetailModal
│   ├── githubTalent/         # GteCampaignModal
│   └── ui/                   # MicButton (voice input)
└── pages/                    # see docs/features/frontend.md for the route table
```

---

## Data Flow: Adding a Prospect

```
1. User submits AddProspectModal
2. POST /api/prospects → checks org.canAddProspect() → 403 LIMIT_REACHED if over
3. Prospect saved with pipelineStatus: "pending"
4. Job enqueued on BullMQ pipelineQueue (concurrency 1)
5. 201 returned immediately
6. Worker runs the pipeline, updating pipelineStatus at each layer:
     pending → discovering → enriching → classifying → scoring → ready
   The company link happens AFTER Layer 2, since enrichment is the only
   step that can identify the real employer. Company analysis + company
   signal detection are chained onto that link in the background.
7. Frontend polls and reflects status live
8. Outreach (L5) is deliberately NOT auto-run — messages are generated
   on demand, per prospect or per campaign, from stored knowledge
```

`RUN_WORKERS=false` lets an instance serve HTTP without polling Redis — important because idle workers otherwise drain the Redis request quota.

---

## Authentication Flow

```
Register/Login → { accessToken (15m), refreshToken (7d) }
        ↓  stored in Zustand (persisted to localStorage)
Every request: Authorization: Bearer <accessToken>
        ↓  on 401 + TOKEN_EXPIRED
api.js interceptor → POST /auth/refresh → retry original request transparently
```

---

## Multi-tenancy rule

**Every DB query must be scoped to `organization: req.organization._id`.** The one deliberate exception is `LinkedInSession`, which is a single shared platform-level document (`findOne({})`), not per-org.

---

## Environment Variables

| Variable | Used in | Required |
|---|---|---|
| `PORT` | server.js | No (default 5000) |
| `NODE_ENV` | various | No |
| `MONGODB_URI` | config/db.js | ✅ |
| `CLIENT_URL` / `CLIENT_URLS` | app.js CORS, emailService | ✅ |
| `JWT_SECRET` | authController | ✅ |
| `JWT_REFRESH_SECRET` | authController | ✅ |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | authController | No (15m / 7d) |
| **AI** | | |
| `GEMINI_API_KEY` | geminiClient | ✅ (active provider) |
| `GEMINI_MODEL` / `GEMINI_FALLBACK_MODELS` / `GEMINI_TIMEOUT_MS` | geminiClient | No |
| `GEMINI_TRANSCRIBE_MODEL` | aiController | No (voice input) |
| `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` | geminiClient | Vertex only |
| `GROQ_API_KEY` | groqClient | Only if `GROQ_ENABLED` |
| `GROQ_MODEL` / `GROQ_FALLBACK_MODELS` / `GROQ_TIMEOUT_MS` / `GROQ_API_BASE_URL` | groqClient | No |
| **Queue** | | |
| `REDIS_URL` | pipeline/queue.js | ✅ |
| `RUN_WORKERS` | pipeline/queue.js | No (`false` disables workers) |
| **Enrichment sources** | | |
| `SERPER_API_KEY` | discovery.js | Recommended (degrades gracefully) |
| `GITHUB_TOKEN` | enrichment.js | No (60 → 5000 req/hr) |
| **Newsletters** | | |
| `PUBLIC_API_URL` | unsubscribeToken | This server's public origin — `CLIENT_URL` is the SPA and is the wrong host for the unsubscribe route |
| `NEWSLETTER_UNSUBSCRIBE_SECRET` | unsubscribeToken | Signs unsubscribe links. **Never rotate it** — that invalidates every link already in a recipient's inbox. Falls back to `JWT_SECRET` in dev |
| `RESEND_NEWSLETTER_FROM_EMAIL` | emailService | Separate verified subdomain, so newsletter complaints can't damage password-reset deliverability. Defaults to `RESEND_FROM_EMAIL` |
| `NEWSLETTER_SEND_RATE` | newsletterSender | Emails/sec, default 1.5 — below Resend's ~2/s account cap, which is shared with transactional mail |
| `NEWSLETTER_DRY_RUN` | emailService | `true` logs instead of sending |
| **LinkedIn** | | |
| `LINKEDIN_LI_AT` / `LINKEDIN_JSESSIONID` | scraper | Seed session |
| `LINKEDIN_EMAIL` / `LINKEDIN_PASSWORD` | linkedinLiveLogin | Live login only |
| `LINKEDIN_INTERACTIVE_LOGIN` | linkedinLiveLogin | No |
| `LINKEDIN_USE_PROXY` / `WEBSHARE_PROXIES` | linkedinBrowserIdentity | No |
| `LINKEDIN_PROFILE_DIR` | linkedinBrowserIdentity | No (default `$TMPDIR/prospectmind-linkedin-profile`) |
| `LINKEDIN_TIMEZONE` | linkedinBrowserIdentity | No (default `America/New_York`; only applied behind a proxy) |
| **Billing / email** | | |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | stripe | Billing only |
| `STRIPE_PRO_PRICE_ID` / `STRIPE_ENTERPRISE_PRICE_ID` | stripe | Billing only |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | emailService | Email only |
