# Internal CRM Frontend — Slice 1 Design Spec
**Date:** 2026-05-11

---

## 1. Overview

A fully responsive internal CRM frontend for Customer Success Managers (CSMs), Account Executives (AEs), and Admins. Slice 1 covers: Login, Dashboard, Account List, and Account Detail (Overview, Health, Tasks, and Contacts tabs). Built as a standalone React SPA that consumes the existing FastAPI backend.

**Primary users:** CSMs (power users), AEs (read/create), Admins (full access)

**Out of scope for Slice 1:**
- Timeline tab, Success Plan tab, Opportunities tab, Playbooks tab
- Manager Dashboard, Churn Report, Settings pages
- Customer portal (separate app)
- QBR Builder, PDF export

---

## 2. Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Build tool | Vite 5 | Fast HMR, native ESM, small bundle |
| UI framework | React 18 + TypeScript | Component model, type safety |
| Routing | React Router v6 | Layout routes, nested routes, protected routes |
| Server state | TanStack Query v5 | Caching, background refetch, loading/error states |
| Client state | Zustand | Auth store (JWT + user in memory + localStorage) |
| HTTP | Axios | Interceptors for token injection + auto-refresh |
| Components | Shadcn/ui + Tailwind CSS | Accessible, customizable, consistent design |
| Charts | Recharts | Health score trend line, sparklines |
| Forms | React Hook Form | Validation, field-level errors |
| Testing | Vitest + React Testing Library | Unit + integration tests |

---

## 3. Project Structure

```
frontend-internal/
├── src/
│   ├── api/
│   │   ├── client.ts         # Axios instance, request/response interceptors
│   │   ├── auth.ts           # login(), logout(), refresh()
│   │   ├── accounts.ts       # listAccounts(), getAccount(), updateAccount(), getHealth(), recalculateHealth()
│   │   ├── contacts.ts       # listContacts(), createContact(), updateContact(), deleteContact()
│   │   └── tasks.ts          # listTasks(), createTask(), updateTask(), deleteTask()
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx  # Sidebar + Topbar wrapper for authenticated pages
│   │   │   ├── Sidebar.tsx   # Fixed left nav, collapses to hamburger < 768px
│   │   │   └── Topbar.tsx    # User info, logout button
│   │   ├── ui/               # Shadcn/ui re-exports (Button, Input, Badge, Card, Tabs, etc.)
│   │   └── shared/
│   │       ├── HealthBadge.tsx      # Green/Yellow/Red pill badge
│   │       ├── ScoreGauge.tsx       # Semicircular 0–100 gauge (Recharts)
│   │       ├── LoadingSpinner.tsx   # Centered spinner for loading states
│   │       └── ErrorMessage.tsx     # Inline error display
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── AccountListPage.tsx
│   │   └── AccountDetailPage.tsx   # Tab container: Overview, Health, Tasks, Contacts
│   ├── hooks/
│   │   ├── useAuth.ts              # Auth actions (login, logout) + current user
│   │   ├── useAccounts.ts          # TanStack Query wrappers for account endpoints
│   │   ├── useAccountHealth.ts     # TanStack Query wrapper for health endpoint
│   │   ├── useTasks.ts             # TanStack Query wrappers for task endpoints
│   │   └── useContacts.ts          # TanStack Query wrappers for contact endpoints
│   ├── store/
│   │   └── authStore.ts            # Zustand store: accessToken, refreshToken, userId, role
│   ├── router.tsx                  # Route definitions + ProtectedRoute component
│   ├── queryClient.ts              # TanStack Query client config
│   └── main.tsx                   # App entry point
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 4. Authentication

### Flow

1. User visits any protected route → `ProtectedRoute` checks Zustand auth store → redirects to `/login` if no token
2. `LoginPage` submits `POST /auth/login` → on success, stores `{ accessToken, refreshToken, userId, role }` in Zustand store + `localStorage`
3. Axios request interceptor attaches `Authorization: Bearer <accessToken>` to every outgoing request
4. Axios response interceptor: on 401, calls `POST /auth/refresh` with stored `refreshToken`, updates tokens in store, retries the original request once. If refresh also fails → `clearAuth()` + redirect to `/login`
5. Logout: calls `POST /auth/logout` with refresh token, then `clearAuth()` + redirect to `/login`

### Auth Store (Zustand)

```typescript
interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  userId: number | null
  role: 'admin' | 'csm' | 'ae' | 'customer' | null
  setAuth: (tokens: AuthPayload) => void
  clearAuth: () => void
}
```

Persisted to `localStorage` via `zustand/middleware` persist so auth survives page refresh.

### ProtectedRoute

Wraps authenticated pages. Redirects to `/login` if `accessToken` is null. Does not check token expiry (the Axios interceptor handles refresh).

### Role-based UI

`role` from the auth store is used to conditionally render:
- Admin-only: "Recalculate" button on health tab, weight config links
- AE: read-only account fields, cannot edit tasks

---

## 5. API Client

### Axios Instance (`src/api/client.ts`)

```typescript
const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL,  // e.g. http://localhost:8000
  timeout: 15000,
})
```

**Request interceptor:** Inject `Authorization: Bearer <token>` from auth store.

**Response interceptor:**
- On 401: attempt token refresh once (guarded by `isRefreshing` flag to prevent concurrent refresh storms)
- Queue other 401 requests while refresh is in-flight, retry all on success
- On refresh failure: `clearAuth()` + `window.location.href = '/login'`

### Typed API Functions

Each file exports async functions returning typed response objects:

```typescript
// accounts.ts
export const listAccounts = (params: AccountListParams): Promise<AccountListResponse>
export const getAccount = (id: number): Promise<AccountDetail>
export const updateAccount = (id: number, data: AccountUpdate): Promise<AccountOut>
export const getAccountHealth = (id: number): Promise<HealthScoreOut>
export const recalculateHealth = (id: number, forceNarrative?: boolean): Promise<RecalculateResponse>
```

TypeScript interfaces mirror the backend Pydantic schemas exactly (AccountOut, HealthScoreOut, TaskOut, ContactOut, etc.).

---

## 6. Pages

### LoginPage (`/login`)

- Email + password form (React Hook Form)
- Inline error on invalid credentials (401)
- Redirect to `/` on success
- No topbar/sidebar (unauthenticated layout)

### DashboardPage (`/`)

Four sections, each powered by a TanStack Query call:

| Section | Data source | Display |
|---|---|---|
| At-risk accounts | `GET /accounts?risk_tier=red&risk_tier=yellow` | List of top 5, each with HealthBadge + renewal date |
| Tasks due today | `GET /tasks?owner_id=<me>&due_date=today` | Bulleted task list with account name |
| Renewal calendar | `GET /accounts?renewal_window=90` | Grouped by 30/60/90 day buckets |
| Health summary | `GET /accounts` | Count of green/yellow/red as colored summary cards |

### AccountListPage (`/accounts`)

- Table with columns: Name, Tier, ARR, CSM, Health Score (HealthBadge), Renewal Date, Last Activity
- Filter bar: Risk tier (multi-select), CSM (dropdown from user list), Renewal window (30/60/90d)
- Sortable columns: Name, ARR, Renewal Date, Health Score
- Pagination: 25 rows/page, prev/next buttons
- Click row → navigate to `/accounts/:id`
- Horizontal scroll on mobile

### AccountDetailPage (`/accounts/:id`)

Tab container. Tab labels: Overview | Health | Tasks | Contacts. On mobile (< 768px), tabs collapse to a `<select>` dropdown.

**Overview tab:**
- Account fields displayed as a form: name, tier, ARR, MRR, renewal date, CSM, AE, industry, employee count, notes, ticket_trend (1–5), csm_sentiment (1–5)
- "Edit" button toggles fields to editable inputs
- "Save" submits `PATCH /accounts/:id`, invalidates account query, shows success toast
- Cancel reverts changes

**Health tab:**
- `ScoreGauge` showing current `health_score` (0–100)
- `HealthBadge` for `churn_risk_tier`
- Rule signal breakdown: 6 signals as labeled progress bars with score and weight
- ML section (shown only if `ml_probability` is not null): probability percentage + top features list
- AI Narrative card: displays `ai_narrative` text; "Refresh Narrative" button calls `POST /scoring/recalculate/:id` with `force_narrative: true`
- 90-day trend: line chart (Recharts `LineChart`) with date on x-axis and score on y-axis

**Tasks tab:**
- Task list filtered to this account (`GET /tasks?account_id=:id`)
- Filter: status (open/in_progress/completed), priority (high/urgent)
- Each task row: title, priority badge, due date, owner, status toggle (checkbox for complete)
- "Add Task" opens an inline form: title, description, priority, due date
- Mark complete: `PATCH /tasks/:id` with `status: "completed"`, invalidates tasks query

**Contacts tab:**
- Contact cards in a grid: name, title, role badge (champion/economic_buyer/etc.), email, influence rating
- "Add Contact" button opens a form modal: name, email, title, role, influence_rating, is_primary toggle
- Edit icon on each card opens pre-filled form modal
- Delete icon with confirmation dialog

---

## 7. Shared Components

### HealthBadge
```typescript
// Props: tier: 'green' | 'yellow' | 'red'
// Renders: colored pill — green bg for green, amber for yellow, red for red
```

### ScoreGauge
Recharts-based semicircular gauge. Accepts `score: number` (0–100). Color follows risk tier thresholds (≥70 green, 40–69 amber, <40 red).

### AppShell
Layout wrapper: fixed sidebar on left (240px wide on desktop), topbar across top (64px tall). Content area fills remaining space. On mobile, sidebar is hidden by default, toggled by hamburger in topbar.

### Sidebar navigation items:
- Dashboard (home icon)
- Accounts (list icon)
- Tasks (checkbox icon) — links to `/tasks` (global task list, Slice 2)

---

## 8. Query Keys + Cache Invalidation

| Query key | Endpoint | Invalidated by |
|---|---|---|
| `['accounts']` | GET /accounts | updateAccount mutation |
| `['accounts', id]` | GET /accounts/:id | updateAccount mutation |
| `['accounts', id, 'health']` | GET /accounts/:id/health | recalculateHealth mutation |
| `['tasks', { accountId }]` | GET /tasks?account_id= | createTask, updateTask, deleteTask |
| `['contacts', accountId]` | GET /accounts/:id/contacts | createContact, updateContact, deleteContact |

Stale time: 60 seconds for accounts, 30 seconds for health, 0 (always fresh) for tasks.

---

## 9. Error Handling

| Error | Behavior |
|---|---|
| Network error | `<ErrorMessage>` inline in the failed component, retry button |
| 401 (expired token) | Auto-refresh via interceptor; transparent to user |
| 403 (wrong role) | Inline "You don't have permission" message |
| 404 (account not found) | Redirect to `/accounts` + toast notification |
| Form validation error | Field-level inline message (React Hook Form) |
| API validation error (422) | Parse `detail` from response, show as form-level error |

---

## 10. Responsive Breakpoints

| Breakpoint | Behavior |
|---|---|
| < 640px (mobile) | Sidebar hidden (hamburger toggle), table scrolls horizontally, tabs → dropdown |
| 640–1024px (tablet) | Sidebar collapses to icon-only (48px wide), tabs visible |
| > 1024px (desktop) | Full sidebar (240px), all features visible |

---

## 11. Environment Config

`.env.local`:
```
VITE_API_URL=http://localhost:8000
```

`.env.production`:
```
VITE_API_URL=https://api.yourcompany.com
```

---

## 12. Testing

| Test file | What it covers |
|---|---|
| `ProtectedRoute.test.tsx` | Redirects to /login when unauthenticated |
| `LoginPage.test.tsx` | Form submission, 401 error display, redirect on success |
| `AccountListPage.test.tsx` | Renders table rows, filter UI, pagination |
| `AccountDetailPage.test.tsx` | Tab switching, health tab data display, task create |
| `HealthBadge.test.tsx` | Correct color class for each tier |
| `client.test.ts` | Axios interceptor: token injection, 401 → refresh → retry |

Tests use `msw` (Mock Service Worker) to intercept API calls without a real backend.
