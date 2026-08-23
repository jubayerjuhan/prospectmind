# API Endpoints Reference

**Base URL:** `http://localhost:5000/api` (local dev often runs on `5001`)
**Auth:** `Authorization: Bearer <accessToken>` on all 🔒 routes
**Scoping:** every 🔒 route is scoped to `req.organization._id` unless noted.

---

## Auth — `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | Public | Create user + org. Body `{ name, email, password, organizationName }` |
| POST | `/auth/login` | Public | Returns tokens + user |
| POST | `/auth/refresh` | Public | Body `{ refreshToken }` → new token pair |
| POST | `/auth/logout` | 🔒 | Clears refresh token |
| GET | `/auth/me` | 🔒 | Current user + org |
| — | *verify-email / forgot-password / reset-password* | Public | Token-based flows via Resend |

---

## Prospects — `/api/prospects`

| Method | Path | Description |
|---|---|---|
| GET | `/prospects` | List. Query `?search=&status=&priority=&page=&limit=` |
| POST | `/prospects` | Create + enqueue pipeline |
| POST | `/prospects/bulk` | Bulk create. Body `{ prospects: [...] }` |
| GET | `/prospects/:id` | Full prospect with messages |
| PATCH | `/prospects/:id` | Update fields (incl. notes) |
| DELETE | `/prospects/:id` | Delete a prospect. Soft archive (`isArchived`), **plus** `$pull` from every campaign's `prospects[]` and cancellation of any queued run — all three, or the deletion is only half done |
| POST | `/prospects/:id/start` | Start enrichment — prospects are created `not-started`, nothing runs until this |
| POST | `/prospects/:id/retry` | Re-run pipeline (same handler as `/start`) |
| POST | `/prospects/:id/pause` · `/resume` | Pause/resume. Pause returns `immediate: true` when the run was still queued and was stopped outright; `false` means it was mid-layer and stops at the next boundary |
| POST | `/prospects/:id/generate-messages` | Generate outreach on demand (L5) |
| PATCH | `/prospects/:id/messages/:messageId/approve` | Approve. Body `{ editedBody? }` |
| POST | `/prospects/:id/messages/:messageId/send` | Send via Resend, marks `sent` |

---

## Campaigns (Prospect Lists) — `/api/prospect-lists`

A `ProspectList` **is** a campaign (v2 Phase D). It carries membership, strategy (`personas[]`/`playbooks[]`/`signals[]`), and outreach state.

| Method | Path | Description |
|---|---|---|
| GET | `/prospect-lists` | List campaigns. Query `?page=&limit=` |
| POST | `/prospect-lists` | Create. Manual `{ name, type:"manual", prospectIds? }` or dynamic `{ name, type:"dynamic", filters:{...} }` |
| GET | `/prospect-lists/:id` | Detail + paginated prospect summaries |
| PATCH | `/prospect-lists/:id` | Rename, update filters/strategy, replace manual membership |
| DELETE | `/prospect-lists/:id` | Soft archive |
| POST | `/prospect-lists/:id/prospects` | Add. Body `{ prospectIds: [] }` |
| DELETE | `/prospect-lists/:id/prospects` | Remove from the campaign only — the prospects stay in the pool. Body `{ prospectIds: [] }` |
| POST | `/prospect-lists/:id/add-and-create` | Create a prospect directly into the campaign |
| POST | `/prospect-lists/:id/prospects/bulk-import` | CSV bulk create into the campaign. Body `{ candidates: [] }`. Dedupes within the upload and against existing members, clamps to the plan's remaining prospect allowance, and only queues the pipeline when the campaign has a `campaignDescription` |
| POST | `/prospect-lists/:id/import-preview` · `/import-confirm` | Two-step bulk import |
| GET | `/prospect-lists/:id/outreach` | Generated sequences + status |
| POST | `/prospect-lists/:id/outreach/generate` | Build per-prospect sequences from **stored knowledge only** (skips non-ready prospects) |
| GET | `/prospect-lists/:id/outreach/export` | Generated sequences as CSV — one row per prospect, contacts + each step's message in its own columns |
| GET | `/prospect-lists/:id/outreach/leads` | Same data as JSON, for external tools (lemlist). **Accepts an organization API key** via `x-api-key`, or a normal session. `?includeSkipped=true` to include skipped prospects |
| POST | `/prospect-lists/:id/start` | Start every `not-started` prospect in the campaign (blocked by the campaign-goal gate) |
| POST | `/prospect-lists/:id/pause` · `/resume` | Pause/resume campaign processing. Pause reports `stoppedImmediately` vs `stillFinishing` |

---

## Newsletters — `/api/newsletters`

Bulk opt-in email, entirely separate from the prospecting pipeline. Recipients are
`NewsletterContact`s scoped to one campaign — **not** `Prospect`s — and consume no
prospect quota. Full design: `docs/features/newsletters.md`.

### Public — no authentication

These two sit **above** `router.use(protect)` in `routes/newsletters.js`, because a
recipient clicking Unsubscribe in their mail client has no account. Authority comes
from an HMAC over the contact id.

| Method | Path | Description |
|---|---|---|
| GET | `/newsletters/unsubscribe/:contactId/:sig` | Renders an HTML confirmation page. **Mutates nothing** — mail scanners and link prefetchers fetch every URL in a delivered email, so a GET that unsubscribed would opt out part of the list on delivery |
| POST | `/newsletters/unsubscribe/:contactId/:sig` | Performs it. Idempotent. Serves both the browser form and RFC 8058 one-click; returns HTML for browsers, `{success:true}` otherwise |

### Authenticated

| Method | Path | Description |
|---|---|---|
| GET | `/newsletters` | List. Query `?page=&limit=&status=&search=` |
| POST | `/newsletters` | Create `{ name, subject?, fromName?, replyTo? }`. 409 on duplicate name |
| GET | `/newsletters/:id` | Detail + `recipientCount` |
| PATCH | `/newsletters/:id` | Update. Sanitizes `bodyHtml` and regenerates `bodyText`. **409 once `sending`/`sent`**; 400 if a merge tag appears inside an `href`/`src` |
| DELETE | `/newsletters/:id` | Soft archive. 409 while `sending` |
| GET | `/newsletters/:id/contacts` | Paginated. Query `?page=&limit=&status=&search=` |
| POST | `/newsletters/:id/contacts` | Add one `{ email, firstName?, lastName?, company? }`. 409 on duplicate; a suppressed address is added as `unsubscribed` rather than silently dropped |
| POST | `/newsletters/:id/contacts/import` | CSV bulk. Body `{ contacts: [] }` — JSON, not multipart. Returns `{ created, skipped, invalid, suppressed }`. **No plan-limit clamp** |
| DELETE | `/newsletters/:id/contacts` | Remove. Body `{ contactIds: [] }` |
| GET | `/newsletters/:id/preview` | Renders exactly what would be sent, against the first contact. Sends nothing |
| POST | `/newsletters/:id/send` | Enqueue now. 400 without a subject, body, or pending recipients |
| POST | `/newsletters/:id/schedule` | Body `{ scheduledFor }` (ISO). Future, ≤90 days. BullMQ delayed job |
| POST | `/newsletters/:id/cancel` | Removes a scheduled job, or cooperatively stops an in-flight send |

---

## Companies — `/api/companies`

| Method | Path | Description |
|---|---|---|
| GET | `/companies` | List |
| POST | `/companies` | Create |
| GET | `/companies/duplicates` | Likely duplicate pairs awaiting review |
| GET | `/companies/:id` | Detail |
| PATCH | `/companies/:id` | Update |
| DELETE | `/companies/:id` | Delete |
| POST | `/companies/:id/analyze` | Website discovery → scrape → AI analysis (cached, with `sourceRefs`) |
| POST | `/companies/:id/detect-signals` | Run active company-scoped Signals |
| POST | `/companies/:id/find-contacts` | Scan the company website for contacts |
| POST | `/companies/:id/find-linkedin` | Resolve + verify the company's LinkedIn page |
| POST | `/companies/:id/find-prospects` | Find people at this company against a Playbook |
| POST | `/companies/:id/import-prospects` | Turn selected candidates into Prospects |
| POST | `/companies/:id/merge` | Fold a duplicate company into this one |

---

## Company Finder — `/api/company-finder`

Browse external sources and save results as Companies.

| Method | Path | Description |
|---|---|---|
| GET | `/company-finder/sources` | Available sources (currently `cryptojobslist`) |
| GET | `/company-finder/companies` | Browse companies from a source |
| GET | `/company-finder/companies/:source/:slug` | Source-specific detail |
| POST | `/company-finder/companies/:source/:slug/save` | Save into Companies |

---

## Settings: Personas / Playbooks / Signals

All three share an identical CRUD shape via a common controller factory.

| Method | Path | Description |
|---|---|---|
| GET · POST | `/api/personas`, `/api/playbooks`, `/api/signals` | List / create |
| GET · PATCH · DELETE | `…/:id` | Get / update / delete |

`Signal` additionally carries `appliesTo: "prospect" \| "company"`.

---

## GitHub Talent Engine — `/api/github-talent`

| Method | Path | Description |
|---|---|---|
| GET · POST | `/github-talent` | List / create campaigns |
| POST | `/github-talent/keywords-preview` | AI keyword generation preview |
| GET · PATCH · DELETE | `/github-talent/:id` | Get / update / archive |
| POST | `/github-talent/:id/run` · `/pause` · `/resume` | Execution control |
| GET | `/github-talent/:id/status` | Live progress counters |

## Companies — `/api/companies`

All routes require auth. All queries scoped to `req.organization._id`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/companies` | 🔒 | List companies. Query: `?search=&page=&limit=` |
| POST | `/companies` | 🔒 | Create (or reuse an existing match on the normalized name) |
| GET | `/companies/:id` | 🔒 | Company detail with linked prospects |
| PATCH | `/companies/:id` | 🔒 | Update company fields |
| DELETE | `/companies/:id` | 🔒 | Delete a company |
| POST | `/companies/:id/analyze` | 🔒 | AI company analysis. Body: `{ force? }` |
| POST | `/companies/:id/detect-signals` | 🔒 | Run company Signals. Body: `{ signalIds? }` — see below |
| POST | `/companies/:id/find-contacts` | 🔒 | Scan the company website for contacts. Body: `{ force? }` |
| POST | `/companies/:id/find-linkedin` | 🔒 | Resolve the company's LinkedIn page. Body: `{ force? }` |
| POST | `/companies/:id/find-prospects` | 🔒 | Find people at this company. Body: `{ playbookId, personaIds? }` — see below |
| POST | `/companies/:id/import-prospects` | 🔒 | Import candidates as Prospects. Body: `{ candidateIds }` |
| GET | `/companies/duplicates` | 🔒 | Likely duplicate pairs — see below |
| POST | `/companies/:id/merge` | 🔒 | Merge `duplicateId` into `:id`. Body: `{ duplicateId }` |

**Prospect finder.** `find-prospects` plans Google queries from the Playbook (and
any Personas), pools LinkedIn hits, and has the AI keep only people who visibly
work at that company. Results are stored on `company.prospectSearch.candidates`
as *candidates, not prospects* — they cost nothing against the plan limit until
`import-prospects` is called with an explicit selection. The search 409s with
`NO_VERIFIED_IDENTITY` unless the company has a domain or LinkedIn page: a
name-only people search returns the namesake's staff just as happily.

**Duplicates.** `GET /companies/duplicates` never mutates. A pair is reported
only when the normalized names match AND either the domains are one brand under
two public suffixes (`certik.com` / `certik.org`) or one side is a keyless
placeholder. A bare name match is never enough — see `docs/architecture.md` on
why identity is keyed. Three things veto a pair:

- **Different LinkedIn pages.** Compared only within the same key form: a slug
  (`certik`) and a numeric id (`id:11831043`) are two ways of writing one page,
  so they are not a contradiction. Two differing slugs, or two differing ids, are.
- **Contradicting sectors.** A brand across two TLDs is genuinely ambiguous —
  `certik.com`/`certik.org` is one company, `kiln.fi`/`kiln.com` is a staking
  company and a coworking operator. Once both sides are analyzed, industries
  sharing no term settle it. An unanalyzed record is silent, not contradicting.
- **Ambiguity.** A bare placeholder matches every keyed sibling sharing its
  name. When more than one matches there is nothing to choose between them, so
  the pair is withheld rather than offered as an irreversible coin flip.

The survivor is chosen by identity strength, then linked prospects (the record
the org's work points at), then how much each knows, then age. `POST /:id/merge`
is the only thing that combines records, it is irreversible, and the caller
names both sides — the UI's suggestion is a default, not a decision.

**`detect-signals` selection.** `signalIds` is optional. Omitted, every *active*
company Signal in the org runs — the same set the background pipeline uses.
Supplied, only those Signals run, active or not: an explicit pick is treated as
deliberate intent, matching how a campaign's selected Signals work. An empty
array is rejected (400) rather than silently falling back to "run everything",
since detection costs a search plus an AI call per signal. Selection is still
scoped to the org, so a foreign id matches nothing.

Returns `409 NO_VERIFIED_IDENTITY` when the company has neither a `domainKey`
nor a `linkedinKey` — signals searched on a bare name can describe a namesake,
and they get injected verbatim into outreach.

---

## Organization — `/api/organization`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/organization/me` | 🔒 | Org details + members |
| PATCH | `/organization/me` | 🔒 owner/admin | Update name or settings |
| GET | `/organization/usage` | 🔒 | `{ plan, used, limit, percentUsed }` |
| GET | `/organization/linkedin-session` | 🔒 owner/admin | Health: `status`, `lastVerifiedAt`, `lastFailureAt`, `lastFailureContext` |
| POST | `/organization/linkedin-session` | 🔒 owner/admin | Set the session from a pasted `li_at` |
| DELETE | `/organization/linkedin-session` | 🔒 owner/admin | **Destructive** — drops the cookie jar; cannot be restored |
| POST · GET · DELETE | `/organization/linkedin-session/live` | 🔒 owner/admin | Start / poll / stop the remote-driven Chrome login |
| GET | `/organization/api-key` | 🔒 owner/admin | Metadata only — `{ exists, last4, createdAt, lastUsedAt }`. The key itself is unrecoverable |
| POST | `/organization/api-key` | 🔒 owner/admin | Create or rotate. **Returns the plaintext key once**; rotating invalidates the previous one immediately |
| DELETE | `/organization/api-key` | 🔒 owner/admin | Revoke without issuing a replacement |

> The LinkedIn session is a **single shared platform-level document**, not per-org — the one deliberate exception to org scoping.

### API keys

One key per organization, for external tools pulling generated outreach. A JWT
cannot serve that purpose — the access token lives 15 minutes and no third-party
integration can run the refresh dance.

- Format `pm_live_<64 hex>`. The prefix makes a leaked key identifiable in a log,
  a repo, or a secret scanner.
- **Only a SHA-256 hash is stored** (`Organization.apiKey.hash`). SHA-256 rather
  than bcrypt is correct here: the input is 32 bytes of CSPRNG output, so there
  is nothing to brute-force, and a fast hash keeps per-request verification cheap.
- Presented as `x-api-key` (or `Authorization: Bearer pm_live_…`) and accepted by
  `apiKeyOrProtect`, which is mounted on **only** the leads endpoint. Keeping it
  off everything else is deliberate: a key that could drive the whole API would
  be a much bigger thing to leak.
- `req.user` is null on key-authenticated requests — there is no person on the
  other end — so no handler behind this middleware may read it.

---

## AI — `/api/ai`

| Method | Path | Description |
|---|---|---|
| POST | `/ai/transcribe` | Audio → text (Gemini) for voice input |

---

## Billing — `/api/billing`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/billing/plans` | Public | Plan definitions |
| POST | `/billing/checkout` | 🔒 | Body `{ plan: "pro"\|"enterprise" }` → `{ url }` |
| POST | `/billing/portal` | 🔒 | → `{ url }` to Stripe billing portal |
| POST | `/billing/webhook` | Stripe sig | Raw body |

---

## System

| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{ status: "ok", timestamp }` |

---

## Common Response Shapes

```json
{ "success": true, "data": { ... } }
{ "success": true, "data": [...], "pagination": { "total": 100, "page": 1, "limit": 20, "pages": 5 } }
{ "success": false, "message": "Human-readable error" }
{ "success": false, "message": "...", "code": "TOKEN_EXPIRED" }
```

### Special codes to handle in the frontend
| Code | Meaning | Action |
|---|---|---|
| `TOKEN_EXPIRED` | Access token expired | `api.js` handles automatically |
| `LIMIT_REACHED` | Monthly prospect limit hit | Show upgrade modal |
| `UPGRADE_REQUIRED` | Feature needs a higher plan | Show upgrade prompt |
