# API Endpoints Reference

**Base URL:** `http://localhost:5000/api`
**Auth:** `Authorization: Bearer <accessToken>` on all 🔒 routes

---

## Auth — `/api/auth`

| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| POST | `/auth/register` | Public | `{ name, email, password, organizationName }` | Create user + org |
| POST | `/auth/login` | Public | `{ email, password }` | Returns tokens + user |
| POST | `/auth/refresh` | Public | `{ refreshToken }` | Returns new token pair |
| POST | `/auth/logout` | 🔒 | — | Clears refresh token |
| GET | `/auth/me` | 🔒 | — | Current user + org |

---

## Prospects — `/api/prospects`

All routes require auth. All queries scoped to `req.organization._id`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/prospects` | 🔒 | List prospects. Query: `?search=&status=&priority=&page=&limit=` |
| POST | `/prospects` | 🔒 | Create + auto-run pipeline. Body: prospect fields |
| POST | `/prospects/bulk` | 🔒 | Bulk create. Body: `{ prospects: [...] }` |
| GET | `/prospects/:id` | 🔒 | Full prospect with messages |
| DELETE | `/prospects/:id` | 🔒 | Soft archive |
| POST | `/prospects/:id/retry` | 🔒 | Re-run pipeline |
| PATCH | `/prospects/:id/messages/:msgId/approve` | 🔒 | Approve message. Body: `{ editedBody? }` |

## Prospect Lists — `/api/prospect-lists`

All routes require auth. All queries scoped to `req.organization._id`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/prospect-lists` | 🔒 | List prospect lists. Query: `?page=&limit=` |
| POST | `/prospect-lists` | 🔒 | Create a list. Manual body: `{ name, type: "manual", prospectIds? }`. Dynamic body: `{ name, type: "dynamic", filters: { search?, status?, priority? } }` |
| GET | `/prospect-lists/:id` | 🔒 | Get list detail with paginated lightweight prospect summaries. Query: `?page=&limit=` |
| PATCH | `/prospect-lists/:id` | 🔒 | Rename list, update dynamic filters, or replace manual membership |
| DELETE | `/prospect-lists/:id` | 🔒 | Soft archive a list |
| POST | `/prospect-lists/:id/prospects` | 🔒 | Add prospects to a manual list. Body: `{ prospectIds: [] }` |
| DELETE | `/prospect-lists/:id/prospects` | 🔒 | Remove prospects from a manual list. Body: `{ prospectIds: [] }` |

---

## Organization — `/api/organization`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/organization/me` | 🔒 | Org details + members |
| PATCH | `/organization/me` | 🔒 Admin | Update name or settings |
| GET | `/organization/usage` | 🔒 | `{ plan, used, limit, percentUsed }` |

---

## Billing — `/api/billing`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/billing/plans` | Public | Returns plan definitions |
| POST | `/billing/checkout` | 🔒 | Body: `{ plan: "pro"\|"enterprise" }`. Returns `{ url }` |
| POST | `/billing/portal` | 🔒 | Returns `{ url }` to Stripe billing portal |
| POST | `/billing/webhook` | Stripe sig | Raw body. Handles Stripe events |

---

## System

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Returns `{ status: "ok", timestamp }` |

---

## Common Response Shapes

### Success
```json
{ "success": true, "data": { ... } }
{ "success": true, "data": [...], "pagination": { "total": 100, "page": 1, "limit": 20, "pages": 5 } }
```

### Error
```json
{ "success": false, "message": "Human-readable error" }
{ "success": false, "message": "...", "code": "TOKEN_EXPIRED" }
{ "success": false, "message": "...", "code": "LIMIT_REACHED" }
{ "success": false, "message": "...", "code": "UPGRADE_REQUIRED" }
```

### Special codes to handle in frontend
| Code | Meaning | Action |
|---|---|---|
| `TOKEN_EXPIRED` | Access token expired | `api.js` handles this automatically |
| `LIMIT_REACHED` | Monthly prospect limit hit | Show upgrade modal |
| `UPGRADE_REQUIRED` | Feature needs higher plan | Show upgrade prompt |
