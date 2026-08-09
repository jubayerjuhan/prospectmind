# ProspectMind - Agent Instructions

This file is for Codex, Cursor, Copilot, Claude Code, and other coding agents working in this repository.

## Read First

Read `CLAUDE.md` first. Despite the filename, it is the shared LLM context guide for this project and is the source of truth for:

- Project overview and stack
- Monorepo layout
- Context routing table for docs
- Key conventions
- Environment variables
- Local run commands

Do not duplicate or reinterpret the project context here. If `CLAUDE.md` and this file ever conflict, follow `CLAUDE.md` for project-specific guidance.

## Working Style

- Load only the docs needed for the task, using the routing table in `CLAUDE.md`.
- Keep changes scoped to the requested work.
- Preserve existing architecture and naming patterns.
- Do not rewrite unrelated code or documentation.
- Do not revert user changes unless explicitly asked.

## Project Rules To Remember

- Use ES Modules everywhere.
- All AI calls must go through `server/src/services/ai/claudeClient.js`.
- Use the shared `askAI()` / `askClaude()` wrapper; do not import AI provider SDKs directly in feature code.
- **Gemini is the active provider**, not Groq — see the AI provider note in `CLAUDE.md`.
- Scope tenant-owned database queries by organization (`LinkedInSession` is the one deliberate exception).
- Protect private API routes with the existing auth middleware.
- Check plan limits before creating prospects.

## Documentation Is Part Of The Change

Docs in this repo have drifted badly before. When your change adds or alters a route, model, service, env var, pipeline layer, or frontend page, **update the matching doc in the same change** — see the "Documentation — keep it current" table in `CLAUDE.md` for which file.

`docs/status/plan-overview.md` is the single source of truth for project status. Do not create new status files, and do not mark anything ✅ Done without verifying it in the code.

## Running Locally

Use the commands documented in `CLAUDE.md`:

```bash
cd server && npm run dev
cd client && npm run dev
```

## Before Finishing

When code changes are made, run the smallest relevant validation available for the touched area. If validation cannot be run, explain why in the final response.
