# Current TODOs

**Last updated:** 2026-05-27 (Priority 2 complete)
**Focus:** Get the app running end-to-end for the first time.

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
- [ ] **Verify Gemini output** — check enrichedProfile, classification, score, messages in DB

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
