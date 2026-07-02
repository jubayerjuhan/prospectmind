# Current Status

**Last updated:** 2026-05-27
**Phase:** 1 — Foundation (scaffolding complete, not yet tested end-to-end)

---

## ✅ Done

### Backend
- [x] Express app with CORS, helmet, rate limiting
- [x] MongoDB connection (`config/db.js`)
- [x] User model with bcrypt password hashing
- [x] Organization model with multi-tenant support + plan limits
- [x] Prospect model (full schema: raw input + enriched profile + messages)
- [x] JWT auth (access + refresh tokens, auto-refresh interceptor)
- [x] Register / Login / Logout / GetMe endpoints
- [x] Prospect CRUD (create, list, get, archive)
- [x] Bulk CSV prospect creation
- [x] Pipeline runner (orchestrates all 5 layers)
- [x] Layer 1: Identity resolution (Groq)
- [x] Layer 2: Profile enrichment (Groq + GitHub public API)
- [x] Layer 3: Role classification (Groq)
- [x] Layer 4: Compatibility scoring (Groq)
- [x] Layer 5: Outreach message generation (Groq)
- [x] Message approval endpoint (approve + optional human edit)
- [x] Pipeline retry on failure
- [x] Stripe checkout + billing portal + webhook handler
- [x] Resend welcome email + outreach email helpers
- [x] Organization usage endpoint

### Frontend
- [x] Vite + React + TailwindCSS v4 setup
- [x] React Router v6 with protected routes
- [x] Zustand auth store (persisted)
- [x] Axios API client with auto token refresh
- [x] Login page
- [x] Register page (creates user + org)
- [x] Dashboard (stats, usage bar, recent prospects)
- [x] Prospects table (search, filter, live polling)
- [x] Add prospect modal
- [x] Bulk CSV upload modal
- [x] Prospect detail page (profile + message approve/edit)
- [x] Billing page (plan cards + Stripe upgrade)
- [x] Sidebar with nav + user info + logout

### Infrastructure
- [x] Groq API key documented (`llama-3.3-70b-versatile` default)
- [x] `.env.example` with all required variables documented
- [x] `.gitignore` (env files excluded)
- [x] `port_dust` global CLI command (kills dev ports)

---

## ⚠️ Built But Not Tested End-to-End

- Pipeline (needs real MongoDB + Groq key to test full flow)
- Stripe webhooks (needs Stripe CLI for local testing)
- Resend emails (needs Resend API key)
- Bulk CSV import (client parses CSV, backend creates prospects)

---

## ❌ Not Built Yet

- Email verification on register
- Forgot password / reset password
- Team member invites
- Monthly usage reset (cron job)
- Actual outreach sending (email via Resend wired up but not triggered from UI)
- LinkedIn / X / Telegram sending integrations
- Settings page (placeholder only)
- Mobile / responsive layout
- Pagination UI on prospects table
- Real identity resolution with web search (Serper API)
- LinkedIn profile scraping (Apify)
- Upgrade prompt when plan limit is hit

---

## 🐛 Known Issues

- None confirmed yet (untested)
- `port_dust` zshrc entry was added redundantly (also exists in `/usr/local/bin`) — harmless

---

## Environment Setup Status

| Variable | Status |
|---|---|
| `GROQ_API_KEY` | ⬜ Required for pipeline testing |
| `MONGODB_URI` | ⬜ Set to localhost — needs MongoDB running |
| `JWT_SECRET` | ✅ Set |
| `JWT_REFRESH_SECRET` | ✅ Set |
| `STRIPE_*` | ⬜ Not configured |
| `RESEND_API_KEY` | ⬜ Not configured |
