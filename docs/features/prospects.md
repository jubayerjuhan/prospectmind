# Prospects

**Files:**
- `server/src/models/Prospect.js` — full schema
- `server/src/controllers/prospectController.js` — all handlers
- `server/src/routes/prospects.js` — route definitions
- `server/src/models/ProspectList.js` — manual and dynamic prospect list schema
- `server/src/controllers/prospectListController.js` — list CRUD and membership handlers
- `server/src/routes/prospectLists.js` — prospect list route definitions

---

## Prospect Lifecycle

```
created (pending) → pipeline runs → ready → messages approved → outreach sent
                                  ↘ failed → user retries manually
```

---

## The Prospect Schema (key fields)

### Raw Input (from user)
| Field | Type | Description |
|---|---|---|
| `firstName` | String | Required |
| `lastName` | String | Optional |
| `company` | String | Optional |
| `typeHint` | `talent\|client\|unknown` | User's initial guess |
| `rawEmail` | String | If already known |
| `rawLinkedin` | String | If already known |
| `rawX` | String | If already known |
| `rawTelegram` | String | If already known |
| `rawGithub` | String | If already known |

### Pipeline Output (auto-populated)
| Field | Type | Description |
|---|---|---|
| `pipelineStatus` | Enum | Current pipeline stage |
| `enrichedProfile` | Object | Full enriched data (see below) |
| `roleClassification` | Array | e.g. `["talent", "founder"]` |
| `primaryAngle` | String | Main outreach angle |
| `compatibilityScore` | Number 0–100 | AI fit score |
| `scoreLabel` | Enum | Human-readable label |
| `outreachPriority` | `high\|medium\|low` | |
| `bestContactChannel` | `email\|linkedin\|x\|telegram` | |
| `messages` | Array | Generated outreach messages |

### enrichedProfile fields
`linkedinUrl, xUrl, githubUrl, telegramHandle, email, identityConfidenceScore, programmingLanguages[], blockchainEcosystems[], frameworks[], githubStats{}, currentRole, seniority, yearsOfExperience, previousCompanies[], founderExperience, web3NativeScore, daoInvolvement[], influenceLevel, bio, recentActivity[]`

### Message sub-document
`channel, subject(email only), body, status(draft/approved/sent/replied/rejected), sentAt, approvedBy, editedBody`

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/prospects` | List with pagination + filters (search, status) |
| POST | `/api/prospects` | Create single prospect + kick off pipeline |
| POST | `/api/prospects/bulk` | Bulk create from CSV (respects plan limit) |
| GET | `/api/prospects/:id` | Full prospect with messages |
| DELETE | `/api/prospects/:id` | Soft archive (isArchived: true) |
| POST | `/api/prospects/:id/retry` | Re-run pipeline on failed prospect |
| PATCH | `/api/prospects/:id/messages/:msgId/approve` | Approve (+ optional edit) a message |

### Prospect Lists

| Method | Path | Description |
|---|---|---|
| GET | `/api/prospect-lists` | List manual + dynamic prospect lists |
| POST | `/api/prospect-lists` | Create manual or dynamic list |
| GET | `/api/prospect-lists/:id` | Paginated lightweight prospect summaries for a list |
| PATCH | `/api/prospect-lists/:id` | Rename list, update dynamic filters, or replace manual membership |
| DELETE | `/api/prospect-lists/:id` | Soft archive a list |
| POST | `/api/prospect-lists/:id/prospects` | Add prospects to a manual list |
| DELETE | `/api/prospect-lists/:id/prospects` | Remove prospects from a manual list |

Manual lists store only prospect reference IDs. Dynamic lists store `{ search, status, priority }` filters and resolve live matches at read time.

---

## Plan Limits Enforcement

```js
// In prospectController.js — checked BEFORE creating
if (!req.organization.canAddProspect()) {
  return 403 { code: 'LIMIT_REACHED' }
}

// In Organization model
getProspectLimit() → { free: 50, pro: 500, enterprise: Infinity }
canAddProspect()   → usage.prospectsThisMonth < getProspectLimit()
```

Usage counter is incremented in `runner.js` after pipeline completes successfully.

---

## Bulk CSV Import Format

Required columns: `firstName`
Optional: `lastName, company, typeHint, email, linkedin, x, telegram, github`

```csv
firstName,lastName,company,typeHint,email,linkedin
Ashwin,Kumar,Polygon,talent,ashwin@polygon.technology,https://linkedin.com/in/ashwinkumar
```
