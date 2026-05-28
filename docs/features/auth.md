# Authentication

**Files:**
- `server/src/controllers/authController.js` — register, login, refresh, logout, getMe
- `server/src/middleware/auth.js` — protect(), requirePlan(), requireRole()
- `server/src/models/User.js` — User schema
- `client/src/stores/authStore.js` — Zustand persisted store
- `client/src/lib/api.js` — Axios interceptor for auto token refresh

---

## How It Works

### Registration
1. POST `/api/auth/register` with `{ name, email, password, organizationName }`
2. User created with bcrypt-hashed password
3. Organization created with unique slug (`orgname-abc123`)
4. User linked to org as `owner`
5. JWT access + refresh tokens issued
6. Welcome email sent via Resend (fire-and-forget)

### Login
1. POST `/api/auth/login` with `{ email, password }`
2. Password compared with `bcrypt.compare`
3. Tokens issued, `lastLogin` updated

### Token Strategy
- **Access token:** 15 min expiry, sent in `Authorization: Bearer` header
- **Refresh token:** 7 day expiry, stored in MongoDB on User doc
- On 401 with `code: "TOKEN_EXPIRED"`: `api.js` interceptor auto-calls `/auth/refresh`, retries original request transparently

### Middleware
```js
protect            // Verifies access token, attaches req.user + req.organization
requirePlan('pro') // Blocks if org.plan not in allowed plans, returns 403 UPGRADE_REQUIRED
requireRole('owner', 'admin') // Blocks if user.role not in allowed roles
```

---

## User Roles

| Role | Can do |
|---|---|
| `owner` | Everything — billing, org settings, invite members |
| `admin` | Manage prospects, approve outreach, org settings |
| `member` | View and manage prospects only |

---

## Current Limitations (todos)

- No email verification flow yet
- No password reset / forgot password
- No team invite system (members must be added manually in DB)
- No Google OAuth

→ See `docs/status/todos.md` for priority
