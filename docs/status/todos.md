# Current TODOs

**Last updated:** 2026-07-22 (added Priority 0 — architecture redesign)
**Focus:** Stakeholder handed down a new high-level design (see `docs/status/redesign-v2.md`). It's a significant pivot — Company as its own module, user-defined Personas/Playbooks/Signals instead of hardcoded Web3 prompts, Campaigns as a separate orchestration layer. Priority 0 below is that plan, ordered. Everything under Priority 1+ is the pre-existing MVP polish list and still applies in parallel.

---

## ⭐ Priority 0 — Architecture Redesign (stakeholder HLD, 2026-07-22)

**Full plan:** `docs/status/redesign-v2.md` — read this before starting any of the below.

Not started. Suggested order:

- [ ] **Phase A — Company as a first-class module**
  - [ ] `Company` model + controller + routes (CRUD + analyze)
  - [ ] Migrate `Prospect.company` (string) → ref, with backfill script for existing docs
  - [ ] Point discovery/enrichment at `Company` for company-level data
- [ ] **Phase B — Settings: Persona / Playbook / Signal**
  - [ ] `Persona`, `Playbook`, `Signal` models + CRUD routes/controllers
  - [ ] Real Settings page UI (currently a placeholder)
  - [ ] Seed each org with GoodHive's current hardcoded prompts as defaults so behavior doesn't regress
- [ ] **Phase C — Dynamic pipeline**
  - [ ] Replace hardcoded classifier/scorer prompts with a loop over active Personas → `personaScores[]`
  - [ ] Add a Signal-detection layer
  - [ ] Make outreach generation Playbook-driven
- [ ] **Phase D — Campaign module**
  - [ ] `Campaign` model + controller/routes + execution service
  - [ ] Campaigns page in frontend
- [ ] **Phase E — Traceability + refresh**
  - [ ] `source` / `confidence` / `lastRefreshedAt` metadata on stored fields
  - [ ] Refresh endpoints: prospect, company, list, campaign (diff-aware, not full rerun)

**Open questions before starting** (see redesign-v2.md for full context): can a prospect belong to multiple concurrent campaigns; do old classification fields get dropped or kept during transition; are Personas/Playbooks/Signals org-only or is there a platform-level default seed; does Company get its own usage/plan limit.

---

## 🔴 Priority 1 — Get It Running

These are blocking. Do these first.

- [ ] **Start MongoDB** — `brew services start mongodb-community` or use MongoDB Atlas
- [ ] **Set `MONGODB_URI`** in `server/.env`
- [ ] **Run both servers** and confirm they start without errors:
  ```bash
  cd server && npm run dev   # should print ✅ MongoDB connected
  cd client && npm run dev   # should open http://localhost:5173
  ```
- [ ] **Register an account** — test full register flow, org creation, JWT
- [ ] **Add a prospect manually** — verify it saves to DB with `pipelineStatus: "pending"`
- [ ] **Watch pipeline run** — open prospect detail, confirm status updates through all 5 stages
- [ ] **Verify Groq output** — check enrichedProfile, classification, score, messages in DB

---

## 🟡 Priority 2 — Polish Core Flow

- [x] Add upgrade prompt/modal when user hits plan limit (currently just returns 403)
- [x] Add loading skeleton to ProspectDetailPage while pipeline is processing
- [x] Add empty state to Dashboard for new users with "Add your first prospect" CTA
- [x] Show `scoreLabel` as a badge on prospect detail page
- [x] Add pagination to prospects table (currently hardcoded limit=50)
- [x] Handle pipeline `failed` state more gracefully in UI (show error message)

---

## 🟢 Priority 3 — Auth Completeness

- [x] Email verification on register (send verification email via Resend)
- [x] Forgot password / reset password flow
- [ ] Protect routes from unverified users (optional, can skip for MVP)

---

## 🔵 Priority 4 — Billing Activation

- [ ] Create Stripe products + prices in dashboard  ← manual: Stripe dashboard
- [ ] Add price IDs to `.env`                       ← manual: after Stripe setup
- [ ] Install Stripe CLI + test webhook locally     ← manual: local testing
- [x] Add monthly usage reset (cron or serverless function — resets `usage.prospectsThisMonth` on 1st of month)
- [x] Show plan badge + usage % in sidebar

---

## 🟣 Priority 5 — Outreach Sending

- [x] Wire up "Send via Email" button on approved messages (calls `emailService.sendOutreachEmail`)
- [x] Update message status to `sent` after sending
- [x] Add sent timestamp

---

## How to Update This File

After completing a task:
1. Check it off `[x]`
2. Move it to `docs/status/current.md` under ✅ Done
3. Update the "Last updated" date at the top
