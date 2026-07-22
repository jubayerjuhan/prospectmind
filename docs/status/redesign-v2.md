# ProspectMind v2 — Architecture Redesign

**Source:** Stakeholder-provided HLD PDF, "ProspectMind – High-Level Architecture (Draft v1)", shared 2026-07-22.
**Status:** Planning only — nothing in this doc is implemented yet.

---

## Why

The current build is a hardcoded Web3-recruiting pipeline (GoodHive-flavored prompts baked directly into `classifier.js`, `scorer.js`, `outreach.js`). The HLD reframes ProspectMind as a **generic, configurable B2B outreach platform**: behavior is driven by three user-authored prompt types (**Persona**, **Playbook**, **Signal**) instead of fixed code, `Company` becomes a first-class module analyzed independently of any prospect, and `Campaign` becomes a pure orchestration layer that reuses stored analysis instead of recomputing it per send.

---

## Current vs. Target

| Concern | Current build | HLD target |
|---|---|---|
| Company | Free-text field on `Prospect` | Own model, own AI analysis, own signals, reused across prospects |
| Role/fit scoring | Hardcoded `talent\|client\|...` classification + one fixed scoring rubric | User-defined `Persona` prompts; a prospect can score against N personas |
| Messaging strategy | Hardcoded GoodHive copywriting rules in `outreach.js` | User-defined `Playbook` prompts, selected per campaign |
| Business signals | Not modeled | User-defined `Signal` prompts (hiring, funding, product launch, etc.), applied to Prospect or Company |
| Outreach generation | Runs once, automatically, inside the per-prospect pipeline | Runs per `Campaign`, on demand, reusing existing analysis |
| Enrichment sources | Bundled together in `enrichment.js` | Modular, independently toggleable/rerunnable sources |
| Data freshness | No refresh concept — full pipeline rerun only via `/retry` on failure | Explicit refresh at prospect / company / list / campaign level, diff-aware |
| Provenance | Not tracked | Every stored fact carries source, date, confidence, last-refresh |

---

## New / Changed Data Models

### `Company` (new model)
`organization(ref), name, website, domain, industry, size, aiAnalysis{ summary, lastAnalyzedAt }, signals[{ signal(ref), result, confidence, source, detectedAt }], sourceRefs[], createdAt, updatedAt`

Analyzed independently of any Prospect (HLD §2.2); prospects reference it, they don't own it.

### `Prospect` (changed)
- `company` changes from a free-text string to `company: ObjectId ref Company` — needs a one-time migration (string → find-or-create `Company` doc).
- New `personaScores: [{ persona(ref Persona), score, reasoning, evidence[], scoredAt }]` — replaces the single hardcoded `roleClassification` + `compatibilityScore` pair; a prospect can be scored against every active Persona, not just one.
- `enrichedProfile` fields gain provenance where practical: `source`, `confidence`, `lastRefreshedAt`.

### `Persona` (new model)
`organization(ref), name, prompt, isActive, createdBy, createdAt`

### `Playbook` (new model)
`organization(ref), name, prompt, isActive, createdBy, createdAt`

### `Signal` (new model)
`organization(ref), name, prompt, appliesTo: ['prospect','company'], isActive, createdAt`

### `Campaign` (new model)
`organization(ref), name, targetList(ref ProspectList), persona(ref), playbook(ref), channels[], sequence[{ stepOrder, channel, delayDays }], status, createdAt`

Campaigns never analyze — they only read existing Prospect/Company/Signal data (HLD §2.3).

---

## Pipeline Changes

1. **Discovery + Enrichment** (current Layers 1–2) stay conceptually similar but become modular per-source jobs (LinkedIn, GitHub, Website, X, Job boards, Email/Phone provider), each independently enable/disable-able and rerunnable (HLD §5.3).
2. **Company analysis** becomes its own pass, decoupled from any single prospect.
3. **Persona scoring** replaces the hardcoded classifier/scorer: loop over the org's active Personas, run each one's user-authored prompt against Prospect+Company data, store an array of `personaScores` instead of one fixed classification.
4. **Signal detection** (new layer): loop over active Signals, run each against Prospect or Company per its `appliesTo`.
5. **Outreach generation** moves out of the automatic per-prospect pipeline and into **Campaign execution**: triggered when a campaign runs, using its selected Playbook + Persona + the target list's stored analysis and signals.

---

## Refresh Semantics (HLD §5.2)

New endpoints, all diff-aware (only touch fields that may have changed, not a full rerun):
- `POST /api/prospects/:id/refresh`
- `POST /api/companies/:id/refresh`
- `POST /api/prospect-lists/:id/refresh` (bulk)
- `POST /api/campaigns/:id/refresh`

---

## Phased Migration Plan

**Phase A — Company as a first-class module**
- `Company` model, controller, routes (CRUD + analyze)
- Migrate `Prospect.company` string → ref, with a backfill script (existing docs: find-or-create `Company`)
- Point discovery/enrichment at `Company` where the data is company-level, not person-level

**Phase B — Settings: Persona / Playbook / Signal**
- Models + CRUD controllers/routes for all three
- Turn the current placeholder Settings page into real CRUD UI
- Seed each org with GoodHive's current hardcoded prompts as defaults (Persona: "Founder hiring Web3 talent", Playbook: "Sell GoodHive to Web3 startups", Signal: "Engineering Hiring Activity") so day-1 behavior doesn't regress

**Phase C — Dynamic pipeline**
- Replace `classifier.js`/`scorer.js` hardcoded prompts with a loop over active Personas
- Add a `signals.js` layer that loops over active Signals
- Make `outreach.js` Playbook-driven instead of hardcoded GoodHive copy

**Phase D — Campaign module**
- `Campaign` model + controller/routes + execution service (pulls target list + persona + playbook, generates/queues the outreach sequence)
- Frontend: Campaigns page (list, create, view generated sequence per prospect)

**Phase E — Traceability + refresh**
- Add `source`/`confidence`/`lastRefreshedAt` metadata to stored fields
- Implement the four refresh endpoints above with diff-aware updates

---

## Open Questions for Stakeholder / Product

- Can a Prospect belong to multiple concurrent Campaigns, or only one at a time?
- Do `roleClassification`/`compatibilityScore` get dropped once `personaScores` exists, or kept during a transition window for backward compat?
- Are Personas/Playbooks/Signals strictly per-organization, or should there be platform-level defaults every new org is seeded with (the GoodHive example in the HLD reads like a seed template)?
- Does `Company` need its own plan-limit/usage counter, or does it ride along with the existing `Prospect` limit?

---

## Status

Nothing here is implemented. See `docs/status/todos.md` — Priority 0 — for the ordered checklist once we're ready to start building.
