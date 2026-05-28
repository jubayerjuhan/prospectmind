# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────┐
│                    CLIENT (Vite + React)             │
│  Login / Register → Dashboard → Prospects → Billing  │
│  Port: 5173                                          │
└────────────────────────┬────────────────────────────┘
                         │ REST API (axios + auto token refresh)
┌────────────────────────▼────────────────────────────┐
│                 SERVER (Express + Node.js)           │
│  /api/auth  /api/prospects  /api/billing  /api/org   │
│  Port: 5000                                          │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │              AI Pipeline Runner              │   │
│  │  discovery → enrichment → classify →         │   │
│  │  score → outreach (all via Gemini API)        │   │
│  └──────────────────────────────────────────────┘   │
└────────┬──────────────────────────┬─────────────────┘
         │                          │
┌────────▼──────────┐    ┌──────────▼──────────┐
│  MongoDB Atlas    │    │  Google Gemini API   │
│  (Mongoose ODM)   │    │  gemini-2.0-flash    │
└───────────────────┘    └─────────────────────┘
```

---

## Backend File Structure

```
server/src/
├── server.js                    # Entry point — connects DB, starts Express
├── app.js                       # Express setup: CORS, helmet, rate limit, routes
├── config/
│   └── db.js                    # MongoDB connection
├── models/
│   ├── User.js                  # email, password (bcrypt), org ref, role, refreshToken
│   ├── Organization.js          # name, slug, owner, members, plan, usage, settings
│   └── Prospect.js              # full prospect schema (raw input + enriched + messages)
├── routes/
│   ├── index.js                 # Mounts all route groups under /api
│   ├── auth.js                  # POST /register /login /refresh /logout, GET /me
│   ├── prospects.js             # CRUD + /bulk + /retry + message approval
│   ├── billing.js               # /checkout /portal /webhook (Stripe)
│   └── organization.js          # GET/PATCH org, GET usage
├── controllers/
│   ├── authController.js        # register, login, refresh, logout, getMe
│   └── prospectController.js    # getProspects, createProspect, bulkCreate, retry, approve
├── middleware/
│   └── auth.js                  # protect(), requirePlan(), requireRole()
└── services/
    ├── ai/
    │   └── claudeClient.js      # askClaude() — Gemini wrapper, parses JSON response
    ├── pipeline/
    │   ├── runner.js            # Orchestrates all 5 layers, updates DB at each step
    │   ├── discovery.js         # Layer 1: identity resolution
    │   ├── enrichment.js        # Layer 2: enrichment + GitHub API
    │   ├── classifier.js        # Layer 3: role classification
    │   ├── scorer.js            # Layer 4: 0–100 compatibility score
    │   └── outreach.js          # Layer 5: personalized message generation
    ├── stripe/
    │   └── stripeService.js     # createCheckoutSession, createBillingPortalSession, handleWebhook
    └── resend/
        └── emailService.js      # sendWelcomeEmail, sendOutreachEmail
```

---

## Frontend File Structure

```
client/src/
├── App.jsx                      # Router setup, QueryClient, Toaster
├── main.jsx                     # React DOM entry
├── index.css                    # Tailwind v4 import + .input-field utility
├── lib/
│   └── api.js                   # Axios instance — auto-attaches token, handles 401 refresh
├── stores/
│   └── authStore.js             # Zustand (persisted) — user, org, tokens, isAuthenticated
├── components/
│   ├── layout/
│   │   ├── AppLayout.jsx        # Protected route wrapper + sidebar layout
│   │   └── Sidebar.jsx          # Nav links, org name, user avatar, logout
│   └── prospects/
│       ├── AddProspectModal.jsx  # Single prospect form modal
│       └── BulkUploadModal.jsx  # CSV upload + preview modal
└── pages/
    ├── LoginPage.jsx             # Email + password login
    ├── RegisterPage.jsx          # Name + org + email + password
    ├── DashboardPage.jsx         # Stats cards, usage bar, recent prospects
    ├── ProspectsPage.jsx         # Table with search/filter, live polling (8s)
    ├── ProspectDetailPage.jsx    # Full profile + message approve/edit flow
    └── BillingPage.jsx           # Plan cards + Stripe checkout + portal
```

---

## Data Flow: Adding a Prospect

```
1. User submits form (AddProspectModal)
2. POST /api/prospects → prospectController.createProspect()
3. Check org.canAddProspect() → 403 if over limit
4. Prospect saved to MongoDB with status: "pending"
5. runPipeline(prospect._id) fired async (no await)
6. Response 201 returned to frontend immediately
7. Pipeline runs in background:
   pending → discovering → enriching → classifying → scoring → generating → ready
8. Frontend polls GET /api/prospects every 8 seconds
9. Status updates appear in real time in the table
10. On "ready": user opens detail page, reviews messages, approves/edits
```

---

## Authentication Flow

```
Register/Login → { accessToken (15m), refreshToken (7d) }
                         ↓
               Stored in Zustand (persisted to localStorage)
                         ↓
Every request: Authorization: Bearer <accessToken>
                         ↓
If 401 + TOKEN_EXPIRED → api.js interceptor calls POST /auth/refresh
                         ↓
New tokens issued → retry original request transparently
```

---

## MongoDB Models Summary

### User
`name, email, password(hashed), organization(ref), role(owner/admin/member), refreshToken, lastLogin`

### Organization
`name, slug, owner(ref), members[], plan(free/pro/enterprise), planStatus, stripeCustomerId, stripeSubscriptionId, usage.prospectsThisMonth, settings`

### Prospect
`organization(ref), firstName, lastName, company, typeHint, pipelineStatus, enrichedProfile{}, roleClassification[], compatibilityScore, scoreLabel, messages[], tags, isArchived`

---

## Environment Variables

| Variable | Used In | Required |
|---|---|---|
| `PORT` | server.js | No (default 5000) |
| `MONGODB_URI` | config/db.js | ✅ |
| `JWT_SECRET` | authController.js | ✅ |
| `JWT_REFRESH_SECRET` | authController.js | ✅ |
| `JWT_EXPIRES_IN` | authController.js | No (default 15m) |
| `JWT_REFRESH_EXPIRES_IN` | authController.js | No (default 7d) |
| `GEMINI_API_KEY` | services/ai/claudeClient.js | ✅ |
| `STRIPE_SECRET_KEY` | services/stripe/stripeService.js | Billing only |
| `STRIPE_WEBHOOK_SECRET` | routes/billing.js | Billing only |
| `STRIPE_PRO_PRICE_ID` | services/stripe/stripeService.js | Billing only |
| `STRIPE_ENTERPRISE_PRICE_ID` | services/stripe/stripeService.js | Billing only |
| `RESEND_API_KEY` | services/resend/emailService.js | Email only |
| `RESEND_FROM_EMAIL` | services/resend/emailService.js | Email only |
| `CLIENT_URL` | app.js (CORS) + emailService.js | ✅ |
| `GITHUB_TOKEN` | services/pipeline/enrichment.js | No (increases rate limit) |
