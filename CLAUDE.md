# ProspectMind — LLM Context Guide

> **Read this file first. Then use the context routing table below to load ONLY what you need.**
> Do NOT read all files blindly — each doc is self-contained for its topic.

---

## What Is This Project

**ProspectMind** is a B2B SaaS that takes minimal prospect data (name + company) and runs it through a 5-layer AI pipeline to auto-enrich profiles, classify roles, score compatibility, and generate hyper-personalized outreach messages.

Built with: **Vite + React** (frontend) · **Node.js + Express** (backend) · **MongoDB** (database) · **Groq API** (AI) · **Stripe** (billing) · **Resend** (email)

Initial use case: Web3 recruiting intelligence (powering GoodHive internally), but built as a standalone multi-tenant SaaS.

---

## Monorepo Layout

```
prospectmind/
├── client/          # Vite + React frontend (port 5173)
├── server/          # Express API (port 5000)
│   └── src/
│       ├── models/           # Mongoose schemas
│       ├── routes/           # Express route definitions
│       ├── controllers/      # Request handlers
│       ├── middleware/        # auth.js (JWT protect, requirePlan, requireRole)
│       └── services/
│           ├── ai/           # groqClient.js + claudeClient.js compatibility wrapper
│           └── pipeline/     # 5-layer AI pipeline (discovery → outreach)
└── docs/            # All project documentation (see routing table below)
```

---

## 🗺️ Context Routing Table

**Use this to load only the file relevant to your task. Do not read others.**

| If you are working on… | Read this file |
|---|---|
| Project vision, goals, target market | `docs/project-overview.md` |
| System architecture, data flow, env vars | `docs/architecture.md` |
| The AI pipeline (any of the 5 layers) | `docs/features/pipeline.md` |
| Auth — login, register, JWT, refresh | `docs/features/auth.md` |
| Billing — Stripe plans, webhooks, limits | `docs/features/billing.md` |
| Prospect model, enrichment, classification | `docs/features/prospects.md` |
| Outreach message generation logic | `docs/features/outreach.md` |
| What is done / what is broken right now | `docs/status/current.md` |
| What to work on next (immediate todos) | `docs/status/todos.md` |
| Phase 2 & 3 features, long-term roadmap | `docs/status/roadmap.md` |
| API endpoints reference | `docs/api/endpoints.md` |
| Frontend pages, components, routing | `docs/features/frontend.md` |

---

## Key Conventions

- **ES Modules** everywhere (`import/export`, `"type": "module"` in server `package.json`)
- **All AI calls** go through `server/src/services/ai/claudeClient.js` — the `askClaude()` compatibility function (Groq under the hood). New modular Groq usage can import `askGroq()` from `server/src/services/ai/groqClient.js`.
- **Pipeline is synchronous per prospect** — `runner.js` calls all 5 layers in sequence, updates DB at each step
- **Multi-tenant** — every DB query must be scoped to `organization: req.organization._id`
- **JWT auth** — access token (15m) + refresh token (7d). Use `protect` middleware on all private routes
- **Plan limits** — check `org.canAddProspect()` before creating prospects
- **No raw `anthropic` imports** — always use the shared `askClaude()` wrapper

---

## Current Stack Versions

| Package | Version |
|---|---|
| Node.js | v24+ |
| React | 19 |
| Express | 5 |
| Mongoose | 8 |
| Groq model | `llama-3.3-70b-versatile` by default, with fallback models via `GROQ_FALLBACK_MODELS` |
| Vite | 6 |
| TailwindCSS | v4 (via `@tailwindcss/vite`) |

---

## Environment Variables (server/.env)

| Key | Required | Description |
|---|---|---|
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `GROQ_API_KEY` | ✅ | Groq API key |
| `GROQ_MODEL` | Optional | Default Groq model for AI calls |
| `GROQ_FALLBACK_MODELS` | Optional | Comma-separated fallback models tried when the primary model fails |
| `JWT_SECRET` | ✅ | Access token signing key |
| `JWT_REFRESH_SECRET` | ✅ | Refresh token signing key |
| `STRIPE_SECRET_KEY` | Billing only | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Billing only | Stripe webhook validation |
| `RESEND_API_KEY` | Email only | Resend transactional email |
| `CLIENT_URL` | ✅ | Frontend URL for CORS + email links |

---

## How to Run

```bash
# Backend
cd server && npm run dev     # → http://localhost:5000

# Frontend
cd client && npm run dev     # → http://localhost:5173
```
