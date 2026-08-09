---
name: sync-docs
description: Audit ProspectMind's docs against the actual codebase and fix the drift. Use when the user asks to update, sync, check, or refresh the docs, asks whether the docs are current, or after shipping a feature that changed routes, models, env vars, pipeline layers, or frontend pages.
---

# Sync Docs

Compare `docs/` and `CLAUDE.md` against what the code actually does, then fix what's wrong.

**Default to doing the work, not just reporting it.** Only stop and ask if you find drift that implies a *decision* (e.g. a documented feature that no longer exists — was it removed deliberately?).

## Ground rules

- **The code is the truth.** A doc claim that contradicts the code is wrong, no matter how confidently written.
- **Never mark something ✅ Done without seeing it in the code.** This is how the docs broke last time.
- **Preserve the "why."** Rationale for deliberate decisions (transitional debt, intentional exceptions) is the most valuable thing in these docs and the easiest to accidentally delete. Carry it forward.
- **Don't create new doc files.** Update existing ones. Especially: do not add new status files — `docs/status/plan-overview.md` is the single source of truth.

## Step 1 — Gather reality

Run these and work from the output, not from memory:

```bash
git log --pretty='%ad %s' --date=short -30
git status --short
cat server/src/routes/index.js
ls server/src/models server/src/routes client/src/pages
ls -R server/src/services client/src/components
grep -rhoE "process\.env\.[A-Z0-9_]+" server/src server/scripts | sort -u
grep -nE "router\.(get|post|patch|put|delete)\(" server/src/routes/*.js
grep -nE "Layer|updateStatus" server/src/services/pipeline/runner.js
node -e "const p=require('./server/package.json');console.log(Object.keys(p.dependencies).join(', '));console.log(JSON.stringify(p.scripts,null,1))"
```

Read `client/src/App.jsx` for the real route table.

## Step 2 — Check each doc

| Doc | Verify against |
|---|---|
| `docs/status/plan-overview.md` | Commit log since "Last verified"; uncommitted work in `git status`; every ✅ claim |
| `docs/api/endpoints.md` | `routes/index.js` mounts + every `router.<verb>` |
| `docs/architecture.md` | `ls` of models/services; the `process.env` sweep; `package.json` deps |
| `docs/features/pipeline.md` | `runner.js` layer ordering + `claudeClient.js` provider flags |
| `docs/features/frontend.md` | `App.jsx` routes + `components/` tree |
| `CLAUDE.md` | Conventions, stack versions, active AI provider, routing table targets exist |

## Step 3 — Look for these specific failure modes

They have all happened in this repo:

1. **Provider drift** — `CLAUDE.md` claimed Groq while `GROQ_ENABLED=false` made Gemini the only active provider. Always re-check `claudeClient.js` flags.
2. **Roadmap items silently shipped** — LinkedIn scraping, BullMQ, and custom scoring were all built while still listed as future work. Cross-check "planned" items against the code before believing them.
3. **Whole modules missing from docs** — Company Finder and the GitHub Talent Engine existed for weeks undocumented. Diff `ls` output against the docs' file maps.
4. **Stale "Not built yet" lists** — verify each entry still doesn't exist.
5. **Routing tables pointing at deleted files.**

## Step 4 — Apply fixes and report

Edit the docs directly. Then update the `Last verified against the codebase` line in `plan-overview.md` to today's date and the current commit SHA.

Report back as a short list: what was stale, what you corrected, and anything you left alone because it needs the user's decision.
