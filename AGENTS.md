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
- Use the shared `askClaude()` wrapper; do not import AI provider SDKs directly in feature code.
- Scope tenant-owned database queries by organization.
- Protect private API routes with the existing auth middleware.
- Check plan limits before creating prospects.

## Running Locally

Use the commands documented in `CLAUDE.md`:

```bash
cd server && npm run dev
cd client && npm run dev
```

## Before Finishing

When code changes are made, run the smallest relevant validation available for the touched area. If validation cannot be run, explain why in the final response.
