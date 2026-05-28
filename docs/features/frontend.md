# Frontend

**Stack:** Vite 6 + React 19 + TailwindCSS v4 + React Query + Zustand + React Router v6

---

## Pages & Routes

| Route | Component | Auth | Description |
|---|---|---|---|
| `/login` | `LoginPage.jsx` | Public | Email + password login |
| `/register` | `RegisterPage.jsx` | Public | Create account + org |
| `/dashboard` | `DashboardPage.jsx` | 🔒 | Stats, usage bar, recent prospects |
| `/prospects` | `ProspectsPage.jsx` | 🔒 | Table with search, filter, bulk import |
| `/prospects/:id` | `ProspectDetailPage.jsx` | 🔒 | Full profile + message approval |
| `/billing` | `BillingPage.jsx` | 🔒 | Plan cards + Stripe checkout |
| `/settings` | — | 🔒 | Placeholder (not built yet) |

Protected routes are wrapped in `AppLayout.jsx` which redirects to `/login` if not authenticated.

---

## State Management

### Zustand — `authStore.js`
Persisted to `localStorage` under key `prospectmind-auth`.

```js
{ user, organization, accessToken, refreshToken, isAuthenticated }

setAuth(user, accessToken, refreshToken)  // on login/register
setTokens(accessToken, refreshToken)      // on token refresh
updateUser(user)                          // on profile update
logout()                                  // clears everything
```

### React Query
Used for all server data. Key patterns:

```js
// List with polling (auto-refreshes every 8s for pipeline status)
useQuery({ queryKey: ['prospects', search, filter], refetchInterval: 8000 })

// Single prospect (polls while pipeline is running)
useQuery({
  queryKey: ['prospect', id],
  refetchInterval: (data) => isProcessing(data) ? 5000 : false
})

// Mutations
useMutation({ mutationFn, onSuccess: () => queryClient.invalidateQueries(...) })
```

---

## API Client — `lib/api.js`

Axios instance with:
- Base URL: `VITE_API_URL` or `http://localhost:5000/api`
- Request interceptor: attaches `Authorization: Bearer <accessToken>`
- Response interceptor: on 401 `TOKEN_EXPIRED` → calls `/auth/refresh` → retries original request

---

## Styling

- **TailwindCSS v4** — configured via `@tailwindcss/vite` plugin (no `tailwind.config.js` needed)
- **Color palette:** `slate-950` bg, `slate-900` cards, `slate-800` inputs, `indigo-600` primary
- **Dark mode only** — no light mode currently
- **Reusable class:** `.input-field` defined in `index.css`

---

## Component Patterns

### Modals
Full-screen overlay (`fixed inset-0 bg-black/60`), centered card. Close on button click.
See `AddProspectModal.jsx` and `BulkUploadModal.jsx` as reference.

### Status badges
```js
const STATUS_COLOR = {
  pending: 'bg-slate-700 text-slate-300',
  ready: 'bg-green-900/50 text-green-400',
  failed: 'bg-red-900/50 text-red-400',
  // ...
}
```

### Toast notifications
`react-hot-toast` — dark themed, top-right position. Use `toast.success()` and `toast.error()`.

---

## Current Limitations

- Settings page is a placeholder
- No mobile/responsive layout (desktop only)
- No dark/light toggle (dark only)
- No pagination UI on prospects table (limit=50 hardcoded)
