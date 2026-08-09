# Frontend

**Stack:** Vite 6 + React 19 + TailwindCSS v4 + React Query + Zustand + React Router v6

---

## Pages & Routes

| Route | Component | Auth | Description |
|---|---|---|---|
| `/login` | `LoginPage.jsx` | Public | Email + password |
| `/register` | `RegisterPage.jsx` | Public | Create account + org |
| `/forgot-password` | `ForgotPasswordPage.jsx` | Public | Request reset email |
| `/reset-password/:token` | `ResetPasswordPage.jsx` | Public | Set a new password |
| `/verify-email/:token` | `VerifyEmailPage.jsx` | Public | Confirm email address |
| `/dashboard` | `DashboardPage.jsx` | 🔒 | Stats, usage bar, recent prospects, empty state CTA |
| `/prospects` | `ProspectsPage.jsx` | 🔒 | Table with search, filter, pagination, bulk import |
| `/prospects/:id` | `ProspectDetailPage.jsx` | 🔒 | Profile, persona scores, signals, message approval/send |
| `/companies` | `CompaniesPage.jsx` | 🔒 | Company list |
| `/companies/:id` | `CompanyDetailPage.jsx` | 🔒 | Analysis, signals, contacts, LinkedIn resolution |
| `/company-finder` | `CompanyFinderPage.jsx` | 🔒 | Browse external sources → save as Companies |
| `/campaigns` | `CampaignsPage.jsx` | 🔒 | Gallery + workspace (Prospects / Strategy / Outreach tabs) |
| `/github-talent-engine` | `GithubTalentEnginePage.jsx` | 🔒 | GTE campaign list |
| `/github-talent-engine/:id` | `GithubTalentCampaignDetailPage.jsx` | 🔒 | Run/pause/resume + live progress |
| `/billing` | `BillingPage.jsx` | 🔒 | Plan cards + Stripe checkout |
| `/settings` | `SettingsPage.jsx` | 🔒 | Personas, Playbooks, Signals, LinkedIn session |

`/outreach` and `/outreach/:id` redirect to `/campaigns` — Outreach was merged into Campaign as one module (2026-07-28).

Protected routes are wrapped in `AppLayout.jsx`, which redirects to `/login` when unauthenticated and hosts the LinkedIn session banner + modal.

---

## Component Map

```
components/
├── layout/        AppLayout · Sidebar · LinkedInSessionBanner · LinkedInSessionModal
├── prospects/     AddProspectModal · EditProspectModal · BulkUploadModal
│                  ProspectListModal · CampaignImportModal · PersonaRadar
├── campaigns/     CampaignCard · StrategyPicker · CampaignStrategyTab
│                  CampaignOutreachTab · ProspectTable · prospectStatus.js
├── settings/      PersonasSettings · PlaybooksSettings · SignalsSettings
│                  PromptSettingsSection
├── companyFinder/ CompanyFinderDetailModal
├── githubTalent/  GteCampaignModal
└── ui/            MicButton (voice input → /api/ai/transcribe)
```

### LinkedIn session surfacing — two components, deliberately

`LinkedInSessionBanner` is the **standing reminder** that stays until the session is fixed. `LinkedInSessionModal` is the **one-time interrupt**, and its dismissal is keyed to the *failure event* (`lastFailureAt`), not a boolean — so a new failure re-opens it for a user who dismissed the previous one. A plain boolean would let someone dismiss it once and never be warned again.

---

## State Management

### Zustand — `authStore.js`
Persisted to `localStorage` under `prospectmind-auth`.

```js
{ user, organization, accessToken, refreshToken, isAuthenticated }

setAuth(user, accessToken, refreshToken)  // login/register
setTokens(accessToken, refreshToken)      // token refresh
updateUser(user)
logout()
```

### React Query
All server data. Key patterns:

```js
// List with polling (live pipeline status)
useQuery({ queryKey: ['prospects', search, filter], refetchInterval: 8000 })

// Single prospect — polls only while processing
useQuery({
  queryKey: ['prospect', id],
  refetchInterval: (data) => isProcessing(data) ? 5000 : false
})

useMutation({ mutationFn, onSuccess: () => queryClient.invalidateQueries(...) })
```

---

## API Client — `lib/api.js`

Axios instance with:
- Base URL: `VITE_API_URL` or `http://localhost:5000/api`
- Request interceptor: attaches `Authorization: Bearer <accessToken>`
- Response interceptor: on 401 `TOKEN_EXPIRED` → `/auth/refresh` → retries the original request

---

## Styling

- **TailwindCSS v4** via the `@tailwindcss/vite` plugin (no `tailwind.config.js`)
- **Palette:** `slate-950` bg, `slate-900` cards, `slate-800` inputs, `indigo-600` primary
- **Dark mode only**
- Shared utilities live in `index.css` (e.g. `.input-field`)

---

## Component Patterns

**Modals** — full-screen overlay (`fixed inset-0 bg-black/60`) + centered card. See `AddProspectModal.jsx`.

**Status badges** — campaign/prospect status colors are centralized in `components/campaigns/prospectStatus.js`; reuse it rather than redefining maps per page.

**Toasts** — `react-hot-toast`, dark themed, top-right.

---

## Current Limitations

- No mobile/responsive layout (desktop only)
- No light-mode toggle
- Prospect status polling is interval-based, not push
