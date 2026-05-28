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
│   ├── pipeline.md            ← AI pipeline (all 5 layers), Gemini integration
│   ├── auth.md                ← JWT auth, middleware, user roles
│   ├── prospects.md           ← Prospect schema, lifecycle, API, CSV format
│   ├── outreach.md            ← Message generation, human review, sending
│   ├── billing.md             ← Stripe plans, webhooks, local setup
│   └── frontend.md            ← Pages, components, state, styling conventions
├── status/
│   ├── current.md             ← What's done, what's broken, env status
│   ├── todos.md               ← Immediate task list by priority
│   └── roadmap.md             ← Phase 2, 3, 4, 5 plans
└── api/
    └── endpoints.md           ← Full API reference with request/response shapes
```

---

## Quick Links

| I want to know… | Go to |
|---|---|
| What is this project? | `project-overview.md` |
| How does the AI pipeline work? | `features/pipeline.md` |
| What has been built? | `status/current.md` |
| What should I work on next? | `status/todos.md` |
| What's coming in future phases? | `status/roadmap.md` |
| How does auth work? | `features/auth.md` |
| What API endpoints exist? | `api/endpoints.md` |
| How is the frontend structured? | `features/frontend.md` |
