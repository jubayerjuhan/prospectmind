# ProspectMind — Documentation Index

> For LLMs: Start with `/CLAUDE.md` in the repo root. It has a routing table that tells you exactly which file to read for any given task.

---

## 📁 File Map

```
docs/
├── README.md                  ← You are here
├── project-overview.md        ← Vision, problem, goals, differentiators
├── architecture.md            ← System design, file structure, data flow, env vars
├── features/
│   ├── pipeline.md            ← AI pipeline (L1–L5 incl. persona scoring + signals)
│   ├── auth.md                ← JWT auth, middleware, user roles
│   ├── prospects.md           ← Prospect schema, lifecycle, API, CSV format
│   ├── outreach.md            ← Message generation, human review, sending
│   ├── billing.md             ← Stripe plans, webhooks, local setup
│   └── frontend.md            ← Pages, components, state, styling conventions
├── status/
│   ├── plan-overview.md       ← ⭐ SINGLE SOURCE OF TRUTH: status, tasks, roadmap
│   └── redesign-v2.md         ← v2 HLD: Company/Persona/Playbook/Signal/Campaign
└── api/
    └── endpoints.md           ← Full API reference
```

> **Consolidated 2026-08-08:** `status/current.md`, `status/todos.md`, and `status/roadmap.md` were merged into `status/plan-overview.md`. They had drifted out of sync with each other and with the code — one file is easier to keep honest than four. Recover them from git history if needed.

---

## Quick Links

| I want to know… | Go to |
|---|---|
| What is this project? | `project-overview.md` |
| What's built / what's next? | `status/plan-overview.md` |
| How does the AI pipeline work? | `features/pipeline.md` |
| What's the v2 architecture pivot? | `status/redesign-v2.md` |
| How does auth work? | `features/auth.md` |
| What API endpoints exist? | `api/endpoints.md` |
| How is the frontend structured? | `features/frontend.md` |
| Where do env vars live? | `architecture.md` |

---

## Keeping these accurate

See the **Documentation** section of `/CLAUDE.md`. Update docs in the same change that ships the behavior; run `/sync-docs` to audit for drift.
