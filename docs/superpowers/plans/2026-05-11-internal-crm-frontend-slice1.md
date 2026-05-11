# Internal CRM Frontend — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the internal CRM React frontend (Login, Dashboard, Account List, Account Detail with Overview/Health/Tasks/Contacts tabs) that consumes the existing FastAPI backend.

**Architecture:** Vite 5 SPA with React Router v6 for routing, TanStack Query v5 for server state, Zustand for auth state, Axios for API calls with token refresh interceptor, Shadcn/ui + Tailwind CSS for components.

**Tech Stack:** Node.js LTS, Vite 5, React 18, TypeScript, React Router v6, TanStack Query v5, Zustand, Axios, Shadcn/ui, Tailwind CSS, Recharts, React Hook Form, Vitest, React Testing Library, MSW

**Prerequisite:** Node.js LTS must be installed (`node --version` and `npm --version` must work). Backend running on `http://localhost:8000`.

---

## File Map

```
frontend-internal/
├── src/
│   ├── api/
│   │   ├── client.ts            # Axios instance + interceptors
│   │   ├── auth.ts              # login(), logout(), refresh()
│   │   ├── accounts.ts          # listAccounts(), getAccount(), updateAccount(), getAccountHealth(), recalculateHealth()
│   │   ├── contacts.ts          # listContacts(), createContact(), updateContact(), deleteContact()
│   │   └── tasks.ts             # listTasks(), createTask(), updateTask(), deleteTask()
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx     # Sidebar + Topbar layout wrapper
│   │   │   ├── Sidebar.tsx      # Left nav with hamburger collapse
│   │   │   └── Topbar.tsx       # Top bar with user info + logout
│   │   └── shared/
│   │       ├── HealthBadge.tsx  # Green/Yellow/Red pill badge
│   │       ├── ScoreGauge.tsx   # Semicircular 0-100 gauge
│   │       ├── LoadingSpinner.tsx
│   │       └── ErrorMessage.tsx
│   ├── hooks/
│   │   ├── useAccounts.ts       # TanStack Query wrappers for accounts
│   │   ├── useAccountHealth.ts  # TanStack Query wrapper for health endpoint
│   │   ├── useTasks.ts          # TanStack Query wrappers for tasks
│   │   └── useContacts.ts       # TanStack Query wrappers for contacts
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── AccountListPage.tsx
│   │   └── AccountDetailPage.tsx  # Tab container
│   ├── store/
│   │   └── authStore.ts         # Zustand auth store + localStorage persistence
│   ├── types/
│   │   └── api.ts               # TypeScript interfaces for all API responses
│   ├── router.tsx               # Route definitions + ProtectedRoute
│   ├── queryClient.ts           # TanStack Query client config
│   └── main.tsx                 # Entry point
├── src/test/
│   ├── setup.ts                 # Vitest + RTL setup
│   ├── mocks/
│   │   ├── handlers.ts          # MSW request handlers
│   │   └── server.ts            # MSW server setup
│   ├── HealthBadge.test.tsx
│   ├── LoginPage.test.tsx
│   ├── AccountListPage.test.tsx
│   └── client.test.ts
├── .env.local                   # VITE_API_URL=http://localhost:8000
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Task 1: Project Scaffolding

**Files:** Everything at `frontend-internal/` root

- [ ] **Step 1: Scaffold Vite + React + TypeScript project**

Run from `D:\AI Project\My Company`:
```bash
npm create vite@latest frontend-internal -- --template react-ts
cd frontend-internal
npm install
```

- [ ] **Step 2: Install all dependencies**

```bash
cd frontend-internal
npm install axios @tanstack/react-query zustand react-router-dom react-hook-form recharts
npm install @radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-select @radix-ui/react-badge class-variance-authority clsx tailwind-merge lucide-react
npm install -D tailwindcss postcss autoprefixer vitest @vitest/ui @testing-library/react @testing-library/jest-dom @testing-library/user-event msw jsdom
```

- [ ] **Step 3: Initialize Tailwind**

```bash
npx tailwindcss init -p
```

Replace `tailwind.config.ts` with:
```ts
import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
} satisfies Config
```

- [ ] **Step 4: Replace src/index.css with Shadcn/ui base styles**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.3%;
    --radius: 0.5rem;
  }
}

@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground; }
}
```

- [ ] **Step 5: Create .env.local**

Create `frontend-internal/.env.local`:
```
VITE_API_URL=http://localhost:8000
```

- [ ] **Step 6: Update vite.config.ts for tests**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
```

- [ ] **Step 7: Update tsconfig.json for path aliases**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 8: Update package.json scripts**

Add to `scripts` in `package.json`:
```json
"test": "vitest",
"test:ui": "vitest --ui",
"test:run": "vitest run"
```

- [ ] **Step 9: Verify dev server starts**

```bash
cd frontend-internal && npm run dev
```
Expected: Vite dev server at `http://localhost:5173` with default React template page. Stop with Ctrl+C.

- [ ] **Step 10: Commit**

```bash
cd .. && git add frontend-internal/ && git commit -m "chore: scaffold frontend-internal Vite + React + TypeScript + Tailwind"
```

---

## Task 2: TypeScript Types + Auth Store + API Client

**Files:**
- Create: `frontend-internal/src/types/api.ts`
- Create: `frontend-internal/src/store/authStore.ts`
- Create: `frontend-internal/src/api/client.ts`
- Create: `frontend-internal/src/test/setup.ts`

- [ ] **Step 1: Create TypeScript API types**

Create `frontend-internal/src/types/api.ts`:

```ts
export type UserRole = 'admin' | 'csm' | 'ae' | 'customer'
export type AccountTier = 'smb' | 'mid_market' | 'enterprise'
export type ChurnRiskTier = 'green' | 'yellow' | 'red'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'
export type ContactRole = 'champion' | 'economic_buyer' | 'influencer' | 'detractor' | 'end_user'

export interface LoginRequest { email: string; password: string }
export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  role: UserRole
  user_id: number
}

export interface AccountOut {
  id: number
  name: string
  tier: AccountTier
  arr: number | null
  mrr: number | null
  renewal_date: string | null
  csm_id: number | null
  ae_id: number | null
  health_score: number
  churn_risk_tier: ChurnRiskTier
  industry: string | null
  employee_count: number | null
  ticket_trend: number | null
  csm_sentiment: number | null
  created_at: string
  updated_at: string
}

export interface AccountListResponse {
  items: AccountOut[]
  total: number
  page: number
  page_size: number
}

export interface AccountUpdate {
  name?: string
  tier?: AccountTier
  arr?: number | null
  mrr?: number | null
  renewal_date?: string | null
  csm_id?: number | null
  ae_id?: number | null
  industry?: string | null
  employee_count?: number | null
  notes?: string | null
  ticket_trend?: number | null
  csm_sentiment?: number | null
}

export interface HealthScoreOut {
  account_id: number
  health_score: number
  churn_risk_tier: ChurnRiskTier
  rule_score: number | null
  signal_scores: Record<string, number> | null
  ml_probability: number | null
  ml_top_features: string[] | null
  ai_narrative: string | null
  trend_90d: { date: string; score: number }[]
}

export interface RecalculateResponse {
  account_id: number
  final_score: number
  rule_score: number
  churn_risk_tier: ChurnRiskTier
  ml_probability: number | null
  ai_narrative: string | null
}

export interface TaskOut {
  id: number
  account_id: number
  title: string
  description: string | null
  priority: TaskPriority
  due_date: string | null
  owner_id: number | null
  status: TaskStatus
  source: string
  created_at: string
  updated_at: string
}

export interface TaskCreate {
  account_id: number
  title: string
  description?: string
  priority?: TaskPriority
  due_date?: string
  owner_id?: number
}

export interface TaskUpdate {
  title?: string
  description?: string
  priority?: TaskPriority
  due_date?: string | null
  owner_id?: number | null
  status?: TaskStatus
}

export interface ContactOut {
  id: number
  account_id: number
  name: string
  email: string | null
  title: string | null
  role: ContactRole | null
  influence_rating: number | null
  is_primary: boolean
  created_at: string
}

export interface ContactCreate {
  name: string
  email?: string
  title?: string
  role?: ContactRole
  influence_rating?: number
  is_primary?: boolean
}

export interface ContactUpdate {
  name?: string
  email?: string | null
  title?: string | null
  role?: ContactRole | null
  influence_rating?: number | null
  is_primary?: boolean
}
```

- [ ] **Step 2: Create auth store**

Create `frontend-internal/src/store/authStore.ts`:

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserRole } from '@/types/api'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  userId: number | null
  role: UserRole | null
  setAuth: (payload: {
    accessToken: string
    refreshToken: string
    userId: number
    role: UserRole
  }) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      userId: null,
      role: null,
      setAuth: ({ accessToken, refreshToken, userId, role }) =>
        set({ accessToken, refreshToken, userId, role }),
      clearAuth: () =>
        set({ accessToken: null, refreshToken: null, userId: null, role: null }),
    }),
    { name: 'crm-auth' }
  )
)
```

- [ ] **Step 3: Create Axios API client with interceptors**

Create `frontend-internal/src/api/client.ts`:

```ts
import axios, { AxiosError } from 'axios'
import { useAuthStore } from '@/store/authStore'

export const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 15000,
})

let isRefreshing = false
let refreshQueue: ((token: string) => void)[] = []

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

client.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as typeof error.config & { _retry?: boolean }
    if (error.response?.status !== 401 || original?._retry) {
      return Promise.reject(error)
    }
    original._retry = true

    const { refreshToken, setAuth, clearAuth } = useAuthStore.getState()
    if (!refreshToken) {
      clearAuth()
      window.location.href = '/login'
      return Promise.reject(error)
    }

    if (isRefreshing) {
      return new Promise((resolve) => {
        refreshQueue.push((token) => {
          original!.headers!.Authorization = `Bearer ${token}`
          resolve(client(original!))
        })
      })
    }

    isRefreshing = true
    try {
      const res = await axios.post(
        `${import.meta.env.VITE_API_URL}/auth/refresh`,
        { refresh_token: refreshToken }
      )
      const { access_token, refresh_token, role, user_id } = res.data
      setAuth({ accessToken: access_token, refreshToken: refresh_token, role, userId: user_id })
      refreshQueue.forEach((cb) => cb(access_token))
      refreshQueue = []
      original!.headers!.Authorization = `Bearer ${access_token}`
      return client(original!)
    } catch {
      clearAuth()
      window.location.href = '/login'
      return Promise.reject(error)
    } finally {
      isRefreshing = false
    }
  }
)
```

- [ ] **Step 4: Create test setup**

Create `frontend-internal/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './mocks/server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

Create `frontend-internal/src/test/mocks/server.ts`:

```ts
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
```

Create `frontend-internal/src/test/mocks/handlers.ts`:

```ts
import { http, HttpResponse } from 'msw'

const BASE = 'http://localhost:8000'

export const handlers = [
  http.post(`${BASE}/auth/login`, () =>
    HttpResponse.json({
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      token_type: 'bearer',
      role: 'csm',
      user_id: 1,
    })
  ),

  http.get(`${BASE}/accounts`, () =>
    HttpResponse.json({
      items: [
        {
          id: 1, name: 'Acme Corp', tier: 'enterprise',
          arr: 120000, mrr: 10000, renewal_date: '2026-12-01',
          csm_id: 1, ae_id: null, health_score: 72,
          churn_risk_tier: 'green', industry: 'SaaS',
          employee_count: 200, ticket_trend: 4, csm_sentiment: 4,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-05-01T00:00:00Z',
        },
      ],
      total: 1, page: 1, page_size: 25,
    })
  ),

  http.get(`${BASE}/accounts/:id`, ({ params }) =>
    HttpResponse.json({
      id: Number(params.id), name: 'Acme Corp', tier: 'enterprise',
      arr: 120000, mrr: 10000, renewal_date: '2026-12-01',
      csm_id: 1, ae_id: null, health_score: 72,
      churn_risk_tier: 'green', industry: 'SaaS',
      employee_count: 200, ticket_trend: 4, csm_sentiment: 4,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    })
  ),

  http.get(`${BASE}/accounts/:id/health`, ({ params }) =>
    HttpResponse.json({
      account_id: Number(params.id),
      health_score: 72,
      churn_risk_tier: 'green',
      rule_score: 72.5,
      signal_scores: {
        days_since_activity: 100, days_to_renewal: 90,
        open_high_priority_tasks: 100, latest_nps: 60,
        ticket_trend: 80, csm_sentiment: 80,
      },
      ml_probability: null,
      ml_top_features: null,
      ai_narrative: null,
      trend_90d: [],
    })
  ),

  http.get(`${BASE}/tasks`, () => HttpResponse.json([])),
  http.get(`${BASE}/accounts/:id/contacts`, () => HttpResponse.json([])),
]
```

- [ ] **Step 5: Run tests to confirm setup works**

```bash
cd frontend-internal && npm run test:run
```
Expected: 0 tests found, no errors. Setup is clean.

- [ ] **Step 6: Commit**

```bash
cd .. && git add frontend-internal/src/ && git commit -m "feat: add TypeScript types, auth store, Axios client, test setup"
```

---

## Task 3: Auth API + Login Page

**Files:**
- Create: `frontend-internal/src/api/auth.ts`
- Create: `frontend-internal/src/pages/LoginPage.tsx`

- [ ] **Step 1: Write failing LoginPage test**

Create `frontend-internal/src/test/LoginPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import LoginPage from '@/pages/LoginPage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderLogin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><LoginPage /></MemoryRouter>
    </QueryClientProvider>
  )
}

describe('LoginPage', () => {
  it('renders email and password fields', () => {
    renderLogin()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('submits and redirects on success', async () => {
    renderLogin()
    await userEvent.type(screen.getByLabelText(/email/i), 'csm@test.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'))
  })
})
```

Run: `cd frontend-internal && npm run test:run -- LoginPage`
Expected: FAIL (LoginPage not found)

- [ ] **Step 2: Create auth API functions**

Create `frontend-internal/src/api/auth.ts`:

```ts
import { client } from './client'
import type { LoginRequest, TokenResponse } from '@/types/api'

export const login = async (data: LoginRequest): Promise<TokenResponse> => {
  const res = await client.post<TokenResponse>('/auth/login', data)
  return res.data
}

export const logout = async (refreshToken: string): Promise<void> => {
  await client.post('/auth/logout', { refresh_token: refreshToken })
}

export const refresh = async (refreshToken: string): Promise<TokenResponse> => {
  const res = await client.post<TokenResponse>('/auth/refresh', { refresh_token: refreshToken })
  return res.data
}
```

- [ ] **Step 3: Implement LoginPage**

Create `frontend-internal/src/pages/LoginPage.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { login } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'

interface FormData { email: string; password: string }

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<FormData>()

  const onSubmit = async (data: FormData) => {
    setError(null)
    try {
      const res = await login(data)
      setAuth({
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
        userId: res.user_id,
        role: res.role,
      })
      navigate('/')
    } catch {
      setError('Invalid email or password.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-lg shadow p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customer Success CRM</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to your account</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              {...register('email', { required: true })}
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              {...register('password', { required: true })}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-primary text-primary-foreground rounded py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run LoginPage tests**

```bash
cd frontend-internal && npm run test:run -- LoginPage
```
Expected: 2 PASS

- [ ] **Step 5: Commit**

```bash
cd .. && git add frontend-internal/src/api/auth.ts frontend-internal/src/pages/LoginPage.tsx frontend-internal/src/test/LoginPage.test.tsx && git commit -m "feat: add auth API and LoginPage"
```

---

## Task 4: Router + AppShell Layout

**Files:**
- Create: `frontend-internal/src/router.tsx`
- Create: `frontend-internal/src/queryClient.ts`
- Create: `frontend-internal/src/components/layout/Sidebar.tsx`
- Create: `frontend-internal/src/components/layout/Topbar.tsx`
- Create: `frontend-internal/src/components/layout/AppShell.tsx`
- Modify: `frontend-internal/src/main.tsx`

- [ ] **Step 1: Create queryClient**

Create `frontend-internal/src/queryClient.ts`:

```ts
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
```

- [ ] **Step 2: Create Sidebar**

Create `frontend-internal/src/components/layout/Sidebar.tsx`:

```tsx
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Users, CheckSquare, X } from 'lucide-react'

interface Props { open: boolean; onClose: () => void }

const navItems = [
  { to: '/', label: 'Dashboard', Icon: LayoutDashboard, exact: true },
  { to: '/accounts', label: 'Accounts', Icon: Users, exact: false },
  { to: '/tasks', label: 'Tasks', Icon: CheckSquare, exact: false },
]

export default function Sidebar({ open, onClose }: Props) {
  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-20 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`
          fixed top-0 left-0 h-full w-60 bg-white border-r z-30 flex flex-col
          transform transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 md:static md:z-auto
        `}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b">
          <span className="font-bold text-lg text-primary">CS CRM</span>
          <button onClick={onClose} className="md:hidden p-1 rounded hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, label, Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  )
}
```

- [ ] **Step 3: Create Topbar**

Create `frontend-internal/src/components/layout/Topbar.tsx`:

```tsx
import { Menu, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { logout } from '@/api/auth'

interface Props { onMenuClick: () => void }

export default function Topbar({ onMenuClick }: Props) {
  const navigate = useNavigate()
  const { role, refreshToken, clearAuth } = useAuthStore()

  const handleLogout = async () => {
    try { if (refreshToken) await logout(refreshToken) } catch { /* ignore */ }
    clearAuth()
    navigate('/login')
  }

  return (
    <header className="h-16 border-b bg-white flex items-center justify-between px-4 sticky top-0 z-10">
      <button
        onClick={onMenuClick}
        className="md:hidden p-2 rounded hover:bg-gray-100"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500 capitalize">{role}</span>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 text-sm text-gray-600 hover:text-red-600 p-2 rounded hover:bg-gray-100"
          title="Logout"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Create AppShell**

Create `frontend-internal/src/components/layout/AppShell.tsx`:

```tsx
import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-col flex-1 min-w-0 overflow-auto">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 md:p-6 bg-gray-50">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create router with ProtectedRoute**

Create `frontend-internal/src/router.tsx`:

```tsx
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import AppShell from '@/components/layout/AppShell'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import AccountListPage from '@/pages/AccountListPage'
import AccountDetailPage from '@/pages/AccountDetailPage'

function ProtectedRoute() {
  const accessToken = useAuthStore((s) => s.accessToken)
  if (!accessToken) return <Navigate to="/login" replace />
  return <Outlet />
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/accounts', element: <AccountListPage /> },
          { path: '/accounts/:id', element: <AccountDetailPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
```

- [ ] **Step 6: Create placeholder pages (to be replaced in later tasks)**

Create `frontend-internal/src/pages/DashboardPage.tsx`:
```tsx
export default function DashboardPage() {
  return <div className="text-2xl font-bold">Dashboard</div>
}
```

Create `frontend-internal/src/pages/AccountListPage.tsx`:
```tsx
export default function AccountListPage() {
  return <div className="text-2xl font-bold">Accounts</div>
}
```

Create `frontend-internal/src/pages/AccountDetailPage.tsx`:
```tsx
export default function AccountDetailPage() {
  return <div className="text-2xl font-bold">Account Detail</div>
}
```

- [ ] **Step 7: Update main.tsx**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { router } from './router'
import { queryClient } from './queryClient'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
)
```

- [ ] **Step 8: Verify the app renders**

```bash
cd frontend-internal && npm run dev
```

Open `http://localhost:5173` — you should be redirected to `/login`. Enter the admin credentials (`admin@company.com` / `admin123`) and verify you land on the Dashboard placeholder page with the sidebar visible.

- [ ] **Step 9: Commit**

```bash
cd .. && git add frontend-internal/src/ && git commit -m "feat: add router, ProtectedRoute, AppShell with sidebar and topbar"
```

---

## Task 5: Account + Task + Contact API Functions + Query Hooks

**Files:**
- Create: `frontend-internal/src/api/accounts.ts`
- Create: `frontend-internal/src/api/tasks.ts`
- Create: `frontend-internal/src/api/contacts.ts`
- Create: `frontend-internal/src/hooks/useAccounts.ts`
- Create: `frontend-internal/src/hooks/useAccountHealth.ts`
- Create: `frontend-internal/src/hooks/useTasks.ts`
- Create: `frontend-internal/src/hooks/useContacts.ts`

- [ ] **Step 1: Create accounts API functions**

Create `frontend-internal/src/api/accounts.ts`:

```ts
import { client } from './client'
import type {
  AccountListResponse, AccountOut, AccountUpdate,
  HealthScoreOut, RecalculateResponse
} from '@/types/api'

export interface AccountListParams {
  page?: number
  page_size?: number
  csm_id?: number
  risk_tier?: string
}

export const listAccounts = async (params: AccountListParams = {}): Promise<AccountListResponse> => {
  const res = await client.get<AccountListResponse>('/accounts', { params })
  return res.data
}

export const getAccount = async (id: number): Promise<AccountOut> => {
  const res = await client.get<AccountOut>(`/accounts/${id}`)
  return res.data
}

export const updateAccount = async (id: number, data: AccountUpdate): Promise<AccountOut> => {
  const res = await client.patch<AccountOut>(`/accounts/${id}`, data)
  return res.data
}

export const getAccountHealth = async (id: number): Promise<HealthScoreOut> => {
  const res = await client.get<HealthScoreOut>(`/accounts/${id}/health`)
  return res.data
}

export const recalculateHealth = async (id: number, forceNarrative = false): Promise<RecalculateResponse> => {
  const res = await client.post<RecalculateResponse>(`/scoring/recalculate/${id}`, { force_narrative: forceNarrative })
  return res.data
}
```

- [ ] **Step 2: Create tasks API functions**

Create `frontend-internal/src/api/tasks.ts`:

```ts
import { client } from './client'
import type { TaskOut, TaskCreate, TaskUpdate } from '@/types/api'

export interface TaskListParams {
  account_id?: number
  owner_id?: number
  status?: string
}

export const listTasks = async (params: TaskListParams = {}): Promise<TaskOut[]> => {
  const res = await client.get<TaskOut[]>('/tasks', { params })
  return res.data
}

export const createTask = async (data: TaskCreate): Promise<TaskOut> => {
  const res = await client.post<TaskOut>('/tasks', data)
  return res.data
}

export const updateTask = async (id: number, data: TaskUpdate): Promise<TaskOut> => {
  const res = await client.patch<TaskOut>(`/tasks/${id}`, data)
  return res.data
}

export const deleteTask = async (id: number): Promise<void> => {
  await client.delete(`/tasks/${id}`)
}
```

- [ ] **Step 3: Create contacts API functions**

Create `frontend-internal/src/api/contacts.ts`:

```ts
import { client } from './client'
import type { ContactOut, ContactCreate, ContactUpdate } from '@/types/api'

export const listContacts = async (accountId: number): Promise<ContactOut[]> => {
  const res = await client.get<ContactOut[]>(`/accounts/${accountId}/contacts`)
  return res.data
}

export const createContact = async (accountId: number, data: ContactCreate): Promise<ContactOut> => {
  const res = await client.post<ContactOut>(`/accounts/${accountId}/contacts`, data)
  return res.data
}

export const updateContact = async (contactId: number, data: ContactUpdate): Promise<ContactOut> => {
  const res = await client.patch<ContactOut>(`/contacts/${contactId}`, data)
  return res.data
}

export const deleteContact = async (contactId: number): Promise<void> => {
  await client.delete(`/contacts/${contactId}`)
}
```

- [ ] **Step 4: Create TanStack Query hooks**

Create `frontend-internal/src/hooks/useAccounts.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listAccounts, getAccount, updateAccount, type AccountListParams } from '@/api/accounts'
import type { AccountUpdate } from '@/types/api'

export const useAccounts = (params: AccountListParams = {}) =>
  useQuery({
    queryKey: ['accounts', params],
    queryFn: () => listAccounts(params),
  })

export const useAccount = (id: number) =>
  useQuery({
    queryKey: ['accounts', id],
    queryFn: () => getAccount(id),
    enabled: !!id,
  })

export const useUpdateAccount = (id: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AccountUpdate) => updateAccount(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['accounts', id] })
    },
  })
}
```

Create `frontend-internal/src/hooks/useAccountHealth.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAccountHealth, recalculateHealth } from '@/api/accounts'

export const useAccountHealth = (id: number) =>
  useQuery({
    queryKey: ['accounts', id, 'health'],
    queryFn: () => getAccountHealth(id),
    enabled: !!id,
    staleTime: 30_000,
  })

export const useRecalculateHealth = (id: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (forceNarrative: boolean) => recalculateHealth(id, forceNarrative),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts', id, 'health'] })
      qc.invalidateQueries({ queryKey: ['accounts', id] })
    },
  })
}
```

Create `frontend-internal/src/hooks/useTasks.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listTasks, createTask, updateTask, deleteTask, type TaskListParams } from '@/api/tasks'
import type { TaskCreate, TaskUpdate } from '@/types/api'

export const useTasks = (params: TaskListParams = {}) =>
  useQuery({
    queryKey: ['tasks', params],
    queryFn: () => listTasks(params),
    staleTime: 0,
  })

export const useCreateTask = (accountId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TaskCreate) => createTask(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', { account_id: accountId }] }),
  })
}

export const useUpdateTask = (accountId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: TaskUpdate }) => updateTask(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', { account_id: accountId }] }),
  })
}

export const useDeleteTask = (accountId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteTask(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', { account_id: accountId }] }),
  })
}
```

Create `frontend-internal/src/hooks/useContacts.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listContacts, createContact, updateContact, deleteContact } from '@/api/contacts'
import type { ContactCreate, ContactUpdate } from '@/types/api'

export const useContacts = (accountId: number) =>
  useQuery({
    queryKey: ['contacts', accountId],
    queryFn: () => listContacts(accountId),
    enabled: !!accountId,
  })

export const useCreateContact = (accountId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ContactCreate) => createContact(accountId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', accountId] }),
  })
}

export const useUpdateContact = (accountId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ContactUpdate }) => updateContact(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', accountId] }),
  })
}

export const useDeleteContact = (accountId: number) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteContact(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', accountId] }),
  })
}
```

- [ ] **Step 5: Commit**

```bash
cd .. && git add frontend-internal/src/api/ frontend-internal/src/hooks/ && git commit -m "feat: add typed API functions and TanStack Query hooks"
```

---

## Task 6: Shared Components

**Files:**
- Create: `frontend-internal/src/components/shared/HealthBadge.tsx`
- Create: `frontend-internal/src/components/shared/ScoreGauge.tsx`
- Create: `frontend-internal/src/components/shared/LoadingSpinner.tsx`
- Create: `frontend-internal/src/components/shared/ErrorMessage.tsx`
- Create: `frontend-internal/src/test/HealthBadge.test.tsx`

- [ ] **Step 1: Write failing HealthBadge test**

Create `frontend-internal/src/test/HealthBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import HealthBadge from '@/components/shared/HealthBadge'

describe('HealthBadge', () => {
  it('renders green label', () => {
    render(<HealthBadge tier="green" />)
    expect(screen.getByText('Green')).toBeInTheDocument()
  })

  it('renders yellow label', () => {
    render(<HealthBadge tier="yellow" />)
    expect(screen.getByText('Yellow')).toBeInTheDocument()
  })

  it('renders red label', () => {
    render(<HealthBadge tier="red" />)
    expect(screen.getByText('Red')).toBeInTheDocument()
  })

  it('applies green color class', () => {
    const { container } = render(<HealthBadge tier="green" />)
    expect(container.firstChild).toHaveClass('bg-green-100')
  })

  it('applies red color class', () => {
    const { container } = render(<HealthBadge tier="red" />)
    expect(container.firstChild).toHaveClass('bg-red-100')
  })
})
```

Run: `cd frontend-internal && npm run test:run -- HealthBadge`
Expected: FAIL (component not found)

- [ ] **Step 2: Implement HealthBadge**

Create `frontend-internal/src/components/shared/HealthBadge.tsx`:

```tsx
import type { ChurnRiskTier } from '@/types/api'

const config: Record<ChurnRiskTier, { label: string; className: string }> = {
  green: { label: 'Green', className: 'bg-green-100 text-green-800' },
  yellow: { label: 'Yellow', className: 'bg-yellow-100 text-yellow-800' },
  red: { label: 'Red', className: 'bg-red-100 text-red-800' },
}

export default function HealthBadge({ tier }: { tier: ChurnRiskTier }) {
  const { label, className } = config[tier]
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}
```

- [ ] **Step 3: Run HealthBadge tests**

```bash
cd frontend-internal && npm run test:run -- HealthBadge
```
Expected: 5 PASS

- [ ] **Step 4: Implement ScoreGauge**

Create `frontend-internal/src/components/shared/ScoreGauge.tsx`:

```tsx
import { PieChart, Pie, Cell } from 'recharts'

function tierColor(score: number): string {
  if (score >= 70) return '#16a34a'
  if (score >= 40) return '#d97706'
  return '#dc2626'
}

export default function ScoreGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score))
  const data = [{ value: clamped }, { value: 100 - clamped }]
  const color = tierColor(clamped)

  return (
    <div className="flex flex-col items-center">
      <PieChart width={160} height={90}>
        <Pie
          data={data}
          startAngle={180}
          endAngle={0}
          innerRadius={50}
          outerRadius={70}
          dataKey="value"
          strokeWidth={0}
        >
          <Cell fill={color} />
          <Cell fill="#e5e7eb" />
        </Pie>
      </PieChart>
      <div className="text-3xl font-bold -mt-6" style={{ color }}>
        {clamped}
      </div>
      <div className="text-xs text-gray-500 mt-1">Health Score</div>
    </div>
  )
}
```

- [ ] **Step 5: Implement LoadingSpinner and ErrorMessage**

Create `frontend-internal/src/components/shared/LoadingSpinner.tsx`:

```tsx
export default function LoadingSpinner({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <div className="w-8 h-8 border-2 border-gray-200 border-t-primary rounded-full animate-spin mb-3" />
      <p className="text-sm">{message}</p>
    </div>
  )
}
```

Create `frontend-internal/src/components/shared/ErrorMessage.tsx`:

```tsx
import { AlertCircle } from 'lucide-react'

export default function ErrorMessage({
  message = 'Something went wrong.',
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-red-600">
      <AlertCircle size={32} className="mb-2" />
      <p className="text-sm mb-3">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs underline hover:no-underline"
        >
          Try again
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Commit**

```bash
cd .. && git add frontend-internal/src/components/ frontend-internal/src/test/HealthBadge.test.tsx && git commit -m "feat: add shared components (HealthBadge, ScoreGauge, LoadingSpinner, ErrorMessage)"
```

---

## Task 7: DashboardPage

**Files:**
- Replace: `frontend-internal/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Implement DashboardPage**

Replace `frontend-internal/src/pages/DashboardPage.tsx`:

```tsx
import { useAuthStore } from '@/store/authStore'
import { useAccounts } from '@/hooks/useAccounts'
import { useTasks } from '@/hooks/useTasks'
import HealthBadge from '@/components/shared/HealthBadge'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import ErrorMessage from '@/components/shared/ErrorMessage'
import type { ChurnRiskTier } from '@/types/api'

const riskColors: Record<ChurnRiskTier, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
}

function today(): string {
  return new Date().toISOString().split('T')[0]
}

export default function DashboardPage() {
  const userId = useAuthStore((s) => s.userId)

  const atRisk = useAccounts({ page: 1, page_size: 5, risk_tier: 'red' })
  const allAccounts = useAccounts({ page: 1, page_size: 100 })
  const myTasks = useTasks({ owner_id: userId ?? undefined })

  const todayTasks = (myTasks.data ?? []).filter(
    (t) => t.due_date === today() && t.status !== 'completed'
  )

  const counts = {
    green: allAccounts.data?.items.filter((a) => a.churn_risk_tier === 'green').length ?? 0,
    yellow: allAccounts.data?.items.filter((a) => a.churn_risk_tier === 'yellow').length ?? 0,
    red: allAccounts.data?.items.filter((a) => a.churn_risk_tier === 'red').length ?? 0,
  }

  const renewalBuckets = {
    '30 days': (allAccounts.data?.items ?? []).filter((a) => {
      if (!a.renewal_date) return false
      const days = Math.floor((new Date(a.renewal_date).getTime() - Date.now()) / 86400000)
      return days >= 0 && days <= 30
    }),
    '31–60 days': (allAccounts.data?.items ?? []).filter((a) => {
      if (!a.renewal_date) return false
      const days = Math.floor((new Date(a.renewal_date).getTime() - Date.now()) / 86400000)
      return days > 30 && days <= 60
    }),
    '61–90 days': (allAccounts.data?.items ?? []).filter((a) => {
      if (!a.renewal_date) return false
      const days = Math.floor((new Date(a.renewal_date).getTime() - Date.now()) / 86400000)
      return days > 60 && days <= 90
    }),
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Health summary */}
      <div className="grid grid-cols-3 gap-4">
        {(['green', 'yellow', 'red'] as ChurnRiskTier[]).map((tier) => (
          <div key={tier} className="bg-white rounded-lg border p-4 flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${riskColors[tier]}`} />
            <div>
              <div className="text-2xl font-bold">{counts[tier]}</div>
              <div className="text-xs text-gray-500 capitalize">{tier}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* At-risk accounts */}
        <div className="bg-white rounded-lg border p-4">
          <h2 className="font-semibold text-gray-800 mb-3">At-Risk Accounts</h2>
          {atRisk.isLoading && <LoadingSpinner />}
          {atRisk.error && <ErrorMessage onRetry={() => atRisk.refetch()} />}
          {atRisk.data?.items.length === 0 && (
            <p className="text-sm text-gray-400">No at-risk accounts. 🎉</p>
          )}
          <ul className="space-y-2">
            {atRisk.data?.items.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-sm">
                <a href={`/accounts/${a.id}`} className="text-primary hover:underline font-medium">
                  {a.name}
                </a>
                <div className="flex items-center gap-2">
                  <HealthBadge tier={a.churn_risk_tier} />
                  {a.renewal_date && (
                    <span className="text-gray-400 text-xs">
                      renews {a.renewal_date}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Tasks due today */}
        <div className="bg-white rounded-lg border p-4">
          <h2 className="font-semibold text-gray-800 mb-3">My Tasks Due Today</h2>
          {myTasks.isLoading && <LoadingSpinner />}
          {myTasks.error && <ErrorMessage onRetry={() => myTasks.refetch()} />}
          {todayTasks.length === 0 && !myTasks.isLoading && (
            <p className="text-sm text-gray-400">No tasks due today.</p>
          )}
          <ul className="space-y-2">
            {todayTasks.slice(0, 8).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  t.priority === 'urgent' || t.priority === 'high' ? 'bg-red-400' : 'bg-gray-300'
                }`} />
                <span className="truncate">{t.title}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Renewal calendar */}
      <div className="bg-white rounded-lg border p-4">
        <h2 className="font-semibold text-gray-800 mb-3">Upcoming Renewals</h2>
        {allAccounts.isLoading && <LoadingSpinner />}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.entries(renewalBuckets).map(([label, accounts]) => (
            <div key={label}>
              <div className="text-xs font-medium text-gray-500 mb-2">Within {label}</div>
              {accounts.length === 0 && <p className="text-xs text-gray-400">None</p>}
              <ul className="space-y-1">
                {accounts.map((a) => (
                  <li key={a.id} className="text-sm flex justify-between">
                    <a href={`/accounts/${a.id}`} className="text-primary hover:underline truncate">
                      {a.name}
                    </a>
                    <span className="text-gray-400 text-xs ml-2">{a.renewal_date}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify in browser**

```bash
cd frontend-internal && npm run dev
```
Log in and verify the Dashboard shows: health summary cards, at-risk accounts list, tasks due today, renewal buckets.

- [ ] **Step 3: Commit**

```bash
cd .. && git add frontend-internal/src/pages/DashboardPage.tsx && git commit -m "feat: implement DashboardPage with at-risk accounts, tasks, and renewal calendar"
```

---

## Task 8: AccountListPage

**Files:**
- Replace: `frontend-internal/src/pages/AccountListPage.tsx`
- Create: `frontend-internal/src/test/AccountListPage.test.tsx`

- [ ] **Step 1: Write failing AccountListPage test**

Create `frontend-internal/src/test/AccountListPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect } from 'vitest'
import AccountListPage from '@/pages/AccountListPage'

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/accounts']}>
        <Routes>
          <Route path="/accounts" element={<AccountListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('AccountListPage', () => {
  it('shows account name from API', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument())
  })

  it('shows health badge', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Green')).toBeInTheDocument())
  })

  it('shows tier', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('enterprise')).toBeInTheDocument())
  })
})
```

Run: `cd frontend-internal && npm run test:run -- AccountListPage`
Expected: FAIL

- [ ] **Step 2: Implement AccountListPage**

Replace `frontend-internal/src/pages/AccountListPage.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccounts } from '@/hooks/useAccounts'
import HealthBadge from '@/components/shared/HealthBadge'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import ErrorMessage from '@/components/shared/ErrorMessage'
import type { ChurnRiskTier } from '@/types/api'

const RISK_TIERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'red', label: 'Red' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'green', label: 'Green' },
]

export default function AccountListPage() {
  const navigate = useNavigate()
  const [riskTier, setRiskTier] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  const { data, isLoading, error, refetch } = useAccounts({
    page,
    page_size: PAGE_SIZE,
    ...(riskTier ? { risk_tier: riskTier } : {}),
  })

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Risk tier:</label>
          <select
            value={riskTier}
            onChange={(e) => { setRiskTier(e.target.value); setPage(1) }}
            className="text-sm border rounded px-2 py-1"
          >
            {RISK_TIERS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <ErrorMessage onRetry={() => refetch()} />}

      {data && (
        <>
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                <tr>
                  {['Name', 'Tier', 'ARR', 'Health', 'Renewal Date', 'Last Updated'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.items.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => navigate(`/accounts/${a.id}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-primary">{a.name}</td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{a.tier.replace('_', '-')}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {a.arr ? `$${(a.arr / 1000).toFixed(0)}k` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <HealthBadge tier={a.churn_risk_tier as ChurnRiskTier} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">{a.renewal_date ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(a.updated_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>{data.total} accounts</span>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
              >
                Previous
              </button>
              <span className="px-3 py-1">Page {page} of {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Run AccountListPage tests**

```bash
cd frontend-internal && npm run test:run -- AccountListPage
```
Expected: 3 PASS

- [ ] **Step 4: Commit**

```bash
cd .. && git add frontend-internal/src/pages/AccountListPage.tsx frontend-internal/src/test/AccountListPage.test.tsx && git commit -m "feat: implement AccountListPage with filterable table and pagination"
```

---

## Task 9: AccountDetailPage — Shell + Overview Tab

**Files:**
- Replace: `frontend-internal/src/pages/AccountDetailPage.tsx`

- [ ] **Step 1: Implement AccountDetailPage with Overview tab**

Replace `frontend-internal/src/pages/AccountDetailPage.tsx`:

```tsx
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useAccount, useUpdateAccount } from '@/hooks/useAccounts'
import { useAccountHealth } from '@/hooks/useAccountHealth'
import { useTasks, useCreateTask, useUpdateTask } from '@/hooks/useTasks'
import { useContacts, useCreateContact, useUpdateContact, useDeleteContact } from '@/hooks/useContacts'
import { useRecalculateHealth } from '@/hooks/useAccountHealth'
import HealthBadge from '@/components/shared/HealthBadge'
import ScoreGauge from '@/components/shared/ScoreGauge'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import ErrorMessage from '@/components/shared/ErrorMessage'
import type { AccountUpdate, TaskCreate, ContactCreate, ChurnRiskTier } from '@/types/api'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

type Tab = 'overview' | 'health' | 'tasks' | 'contacts'

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>()
  const accountId = Number(id)
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  const { data: account, isLoading, error } = useAccount(accountId)

  if (isLoading) return <LoadingSpinner />
  if (error || !account) return (
    <ErrorMessage
      message="Account not found."
      onRetry={() => navigate('/accounts')}
    />
  )

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'health', label: 'Health' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'contacts', label: 'Contacts' },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => navigate('/accounts')}
            className="text-sm text-gray-500 hover:text-primary mb-1"
          >
            ← Accounts
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{account.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-gray-500 capitalize">{account.tier.replace('_', '-')}</span>
            <HealthBadge tier={account.churn_risk_tier as ChurnRiskTier} />
          </div>
        </div>
      </div>

      {/* Tabs — dropdown on mobile, tabs on desktop */}
      <div>
        <div className="md:hidden">
          <select
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value as Tab)}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            {tabs.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div className="hidden md:flex border-b">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'overview' && <OverviewTab accountId={accountId} />}
        {activeTab === 'health' && <HealthTab accountId={accountId} />}
        {activeTab === 'tasks' && <TasksTab accountId={accountId} />}
        {activeTab === 'contacts' && <ContactsTab accountId={accountId} />}
      </div>
    </div>
  )
}

/* ── Overview Tab ─────────────────────────────────────────── */

function OverviewTab({ accountId }: { accountId: number }) {
  const { data: account, refetch } = useAccount(accountId)
  const updateAccount = useUpdateAccount(accountId)
  const [editing, setEditing] = useState(false)
  const { register, handleSubmit, reset } = useForm<AccountUpdate>()

  if (!account) return null

  const onSubmit = async (data: AccountUpdate) => {
    const cleaned: AccountUpdate = {}
    for (const [k, v] of Object.entries(data)) {
      if (v !== '' && v !== null) (cleaned as Record<string, unknown>)[k] = v
    }
    await updateAccount.mutateAsync(cleaned)
    setEditing(false)
    refetch()
  }

  const onCancel = () => { reset(); setEditing(false) }

  const Field = ({
    label, value, name, type = 'text',
  }: { label: string; value: unknown; name: keyof AccountUpdate; type?: string }) => (
    <div>
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="mt-1">
        {editing ? (
          <input
            type={type}
            defaultValue={String(value ?? '')}
            className="w-full border rounded px-2 py-1 text-sm"
            {...register(name)}
          />
        ) : (
          <span className="text-sm text-gray-900">{String(value ?? '—')}</span>
        )}
      </dd>
    </div>
  )

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex justify-between mb-4">
        <h2 className="font-semibold text-gray-800">Account Details</h2>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-primary hover:underline"
          >
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="text-sm text-gray-500 hover:underline"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit(onSubmit)}
              disabled={updateAccount.isPending}
              className="text-sm bg-primary text-white px-3 py-1 rounded disabled:opacity-50"
            >
              {updateAccount.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
      <form>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name" name="name" value={account.name} />
          <Field label="Industry" name="industry" value={account.industry} />
          <Field label="ARR" name="arr" value={account.arr} type="number" />
          <Field label="MRR" name="mrr" value={account.mrr} type="number" />
          <Field label="Renewal Date" name="renewal_date" value={account.renewal_date} type="date" />
          <Field label="Employee Count" name="employee_count" value={account.employee_count} type="number" />
          <Field label="CSM Sentiment (1–5)" name="csm_sentiment" value={account.csm_sentiment} type="number" />
          <Field label="Ticket Trend (1–5)" name="ticket_trend" value={account.ticket_trend} type="number" />
        </dl>
        {account.notes !== null && (
          <div className="mt-4">
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Notes</dt>
            <dd className="mt-1">
              {editing ? (
                <textarea
                  defaultValue={account.notes ?? ''}
                  className="w-full border rounded px-2 py-1 text-sm h-24"
                  {...register('notes')}
                />
              ) : (
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{account.notes || '—'}</p>
              )}
            </dd>
          </div>
        )}
      </form>
    </div>
  )
}

/* ── Health Tab ───────────────────────────────────────────── */

function HealthTab({ accountId }: { accountId: number }) {
  const { data, isLoading, error, refetch } = useAccountHealth(accountId)
  const recalculate = useRecalculateHealth(accountId)

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage onRetry={() => refetch()} />
  if (!data) return null

  const signalLabels: Record<string, string> = {
    days_since_activity: 'Days Since Activity',
    days_to_renewal: 'Days to Renewal',
    open_high_priority_tasks: 'Open High-Priority Tasks',
    latest_nps: 'Latest NPS',
    ticket_trend: 'Ticket Trend',
    csm_sentiment: 'CSM Sentiment',
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border p-6 flex flex-col sm:flex-row items-center gap-6">
        <ScoreGauge score={data.health_score} />
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Risk Tier</span>
            <HealthBadge tier={data.churn_risk_tier as ChurnRiskTier} />
          </div>
          {data.rule_score !== null && (
            <p className="text-sm text-gray-500">Rule Score: {data.rule_score.toFixed(1)}</p>
          )}
          {data.ml_probability !== null && (
            <p className="text-sm text-gray-500">
              ML Churn Probability: {(data.ml_probability * 100).toFixed(1)}%
            </p>
          )}
          <button
            onClick={() => recalculate.mutate(true)}
            disabled={recalculate.isPending}
            className="mt-2 text-sm bg-primary text-white px-3 py-1 rounded disabled:opacity-50"
          >
            {recalculate.isPending ? 'Recalculating…' : 'Refresh Narrative'}
          </button>
        </div>
      </div>

      {/* Signal breakdown */}
      {data.signal_scores && (
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Signal Breakdown</h3>
          <div className="space-y-3">
            {Object.entries(data.signal_scores).map(([key, score]) => (
              <div key={key}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">{signalLabels[key] ?? key}</span>
                  <span className="font-medium">{score.toFixed(0)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${score}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Narrative */}
      {data.ai_narrative && (
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold text-gray-800 mb-2">AI Analysis</h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{data.ai_narrative}</p>
        </div>
      )}

      {/* 90-day trend */}
      {data.trend_90d.length > 0 && (
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold text-gray-800 mb-4">90-Day Trend</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data.trend_90d}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="score"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

/* ── Tasks Tab ────────────────────────────────────────────── */

function TasksTab({ accountId }: { accountId: number }) {
  const { data: tasks, isLoading, error, refetch } = useTasks({ account_id: accountId })
  const createTask = useCreateTask(accountId)
  const updateTask = useUpdateTask(accountId)
  const [showForm, setShowForm] = useState(false)
  const { register, handleSubmit, reset } = useForm<{ title: string; priority: string; due_date: string }>()

  const onSubmit = async (data: { title: string; priority: string; due_date: string }) => {
    const payload: TaskCreate = {
      account_id: accountId,
      title: data.title,
      priority: (data.priority || 'medium') as TaskCreate['priority'],
      due_date: data.due_date || undefined,
    }
    await createTask.mutateAsync(payload)
    reset()
    setShowForm(false)
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage onRetry={() => refetch()} />

  const open = (tasks ?? []).filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
  const done = (tasks ?? []).filter((t) => t.status === 'completed')

  const priorityColors: Record<string, string> = {
    urgent: 'text-red-600', high: 'text-orange-500',
    medium: 'text-gray-600', low: 'text-gray-400',
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="font-semibold text-gray-800">Tasks ({open.length} open)</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-sm bg-primary text-white px-3 py-1 rounded"
        >
          + Add Task
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="text-sm font-medium">New Task</h3>
          <input
            placeholder="Task title"
            className="w-full border rounded px-3 py-2 text-sm"
            {...register('title', { required: true })}
          />
          <div className="flex gap-2">
            <select className="border rounded px-2 py-1 text-sm" {...register('priority')}>
              {['low', 'medium', 'high', 'urgent'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input type="date" className="border rounded px-2 py-1 text-sm" {...register('due_date')} />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSubmit(onSubmit)}
              disabled={createTask.isPending}
              className="text-sm bg-primary text-white px-3 py-1 rounded disabled:opacity-50"
            >
              {createTask.isPending ? 'Adding…' : 'Add'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm text-gray-500">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border divide-y">
        {open.length === 0 && <p className="p-4 text-sm text-gray-400">No open tasks.</p>}
        {open.map((t) => (
          <div key={t.id} className="p-4 flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5"
              onChange={() => updateTask.mutate({ id: t.id, data: { status: 'completed' } })}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">{t.title}</p>
              <p className={`text-xs mt-0.5 ${priorityColors[t.priority]}`}>
                {t.priority} priority{t.due_date ? ` · due ${t.due_date}` : ''}
              </p>
            </div>
          </div>
        ))}
      </div>

      {done.length > 0 && (
        <details className="bg-white rounded-lg border">
          <summary className="p-4 text-sm text-gray-500 cursor-pointer">
            {done.length} completed task{done.length !== 1 ? 's' : ''}
          </summary>
          <div className="divide-y border-t">
            {done.map((t) => (
              <div key={t.id} className="p-4 flex items-center gap-3">
                <input type="checkbox" checked readOnly className="opacity-50" />
                <p className="text-sm text-gray-400 line-through">{t.title}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

/* ── Contacts Tab ─────────────────────────────────────────── */

function ContactsTab({ accountId }: { accountId: number }) {
  const { data: contacts, isLoading, error, refetch } = useContacts(accountId)
  const createContact = useCreateContact(accountId)
  const deleteContact = useDeleteContact(accountId)
  const [showForm, setShowForm] = useState(false)
  const { register, handleSubmit, reset } = useForm<ContactCreate>()

  const onSubmit = async (data: ContactCreate) => {
    await createContact.mutateAsync(data)
    reset()
    setShowForm(false)
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage onRetry={() => refetch()} />

  const roleBadgeColors: Record<string, string> = {
    champion: 'bg-green-100 text-green-800',
    economic_buyer: 'bg-blue-100 text-blue-800',
    influencer: 'bg-purple-100 text-purple-800',
    detractor: 'bg-red-100 text-red-800',
    end_user: 'bg-gray-100 text-gray-700',
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="font-semibold text-gray-800">Contacts ({contacts?.length ?? 0})</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-sm bg-primary text-white px-3 py-1 rounded"
        >
          + Add Contact
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="text-sm font-medium">New Contact</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input placeholder="Name *" className="border rounded px-3 py-2 text-sm" {...register('name', { required: true })} />
            <input placeholder="Email" type="email" className="border rounded px-3 py-2 text-sm" {...register('email')} />
            <input placeholder="Title" className="border rounded px-3 py-2 text-sm" {...register('title')} />
            <select className="border rounded px-2 py-2 text-sm" {...register('role')}>
              <option value="">Role (optional)</option>
              {['champion', 'economic_buyer', 'influencer', 'detractor', 'end_user'].map((r) => (
                <option key={r} value={r}>{r.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="is_primary" {...register('is_primary')} />
            <label htmlFor="is_primary" className="text-sm text-gray-600">Primary contact</label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSubmit(onSubmit)}
              disabled={createContact.isPending}
              className="text-sm bg-primary text-white px-3 py-1 rounded disabled:opacity-50"
            >
              {createContact.isPending ? 'Adding…' : 'Add Contact'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm text-gray-500">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {contacts?.length === 0 && (
          <p className="text-sm text-gray-400 col-span-full">No contacts yet.</p>
        )}
        {contacts?.map((c) => (
          <div key={c.id} className="bg-white rounded-lg border p-4 space-y-2 relative">
            <button
              onClick={() => {
                if (confirm(`Delete ${c.name}?`)) deleteContact.mutate(c.id)
              }}
              className="absolute top-3 right-3 text-gray-300 hover:text-red-500 text-xs"
            >
              ✕
            </button>
            <div>
              <p className="font-medium text-gray-900 text-sm">{c.name}</p>
              {c.is_primary && (
                <span className="text-xs text-primary">★ Primary</span>
              )}
            </div>
            {c.title && <p className="text-xs text-gray-500">{c.title}</p>}
            {c.email && <p className="text-xs text-gray-500">{c.email}</p>}
            {c.role && (
              <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${roleBadgeColors[c.role] ?? 'bg-gray-100'}`}>
                {c.role.replace('_', ' ')}
              </span>
            )}
            {c.influence_rating && (
              <p className="text-xs text-gray-400">Influence: {c.influence_rating}/5</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify in browser**

```bash
cd frontend-internal && npm run dev
```
Navigate to an account — verify all 4 tabs render: Overview (editable fields), Health (gauge + signals), Tasks (list + add form), Contacts (cards + add form).

- [ ] **Step 3: Commit**

```bash
cd .. && git add frontend-internal/src/pages/AccountDetailPage.tsx && git commit -m "feat: implement AccountDetailPage with Overview, Health, Tasks, and Contacts tabs"
```

---

## Task 10: Tests + Final Verification

**Files:**
- Create: `frontend-internal/src/test/client.test.ts`
- Update: `frontend-internal/src/test/mocks/handlers.ts` (add missing endpoints)

- [ ] **Step 1: Write Axios client interceptor test**

Create `frontend-internal/src/test/client.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      userId: null,
      role: null,
    })
  })

  it('starts with null auth state', () => {
    const state = useAuthStore.getState()
    expect(state.accessToken).toBeNull()
    expect(state.role).toBeNull()
  })

  it('setAuth updates all fields', () => {
    useAuthStore.getState().setAuth({
      accessToken: 'tok-access',
      refreshToken: 'tok-refresh',
      userId: 42,
      role: 'csm',
    })
    const state = useAuthStore.getState()
    expect(state.accessToken).toBe('tok-access')
    expect(state.userId).toBe(42)
    expect(state.role).toBe('csm')
  })

  it('clearAuth resets all fields', () => {
    useAuthStore.getState().setAuth({
      accessToken: 'tok', refreshToken: 'ref', userId: 1, role: 'admin',
    })
    useAuthStore.getState().clearAuth()
    expect(useAuthStore.getState().accessToken).toBeNull()
  })
})
```

- [ ] **Step 2: Run all tests**

```bash
cd frontend-internal && npm run test:run
```
Expected: All tests PASS — HealthBadge (5), LoginPage (2), AccountListPage (3), authStore (3) = 13 total

- [ ] **Step 3: Full manual smoke test**

```bash
cd frontend-internal && npm run dev
```

Test each flow:
- [ ] Visit `http://localhost:5173` → redirected to `/login`
- [ ] Login with `admin@company.com` / `admin123` → lands on Dashboard
- [ ] Dashboard shows health summary cards, at-risk list, tasks, renewal buckets
- [ ] Navigate to Accounts → table with accounts, health badges, pagination
- [ ] Click an account → detail page loads
- [ ] Overview tab: click Edit, change a field, Save → field updates
- [ ] Health tab: score gauge renders, signal bars visible, "Refresh Narrative" button works
- [ ] Tasks tab: add a task, mark it complete (checkbox)
- [ ] Contacts tab: add a contact, delete a contact
- [ ] Logout button → redirected to `/login`
- [ ] Resize browser to mobile width → sidebar collapses to hamburger, tabs become dropdown

- [ ] **Step 4: Build for production**

```bash
cd frontend-internal && npm run build
```
Expected: `dist/` folder created with no TypeScript errors.

- [ ] **Step 5: Final commit**

```bash
cd .. && git add frontend-internal/ && git commit -m "chore: internal CRM frontend Slice 1 complete — Login, Dashboard, Account List, Account Detail"
```

---

## Self-Review

**Spec coverage:**
- [x] Vite 5 + React 18 + TypeScript → Task 1
- [x] Shadcn/ui + Tailwind CSS → Task 1
- [x] React Router v6 + ProtectedRoute → Task 4
- [x] Zustand auth store with localStorage persistence → Task 2
- [x] Axios client with Bearer token injection → Task 2
- [x] 401 → auto-refresh → retry interceptor → Task 2
- [x] LoginPage with form + error display → Task 3
- [x] AppShell (Sidebar + Topbar + hamburger) → Task 4
- [x] Sidebar collapses < 768px → Task 4
- [x] TanStack Query hooks for accounts/tasks/contacts/health → Task 5
- [x] Dashboard: at-risk accounts, tasks due today, renewal calendar, health summary → Task 7
- [x] AccountListPage: table, risk tier filter, pagination → Task 8
- [x] AccountDetailPage: tab container, mobile dropdown → Task 9
- [x] Overview tab: editable fields, PATCH on save → Task 9
- [x] Health tab: ScoreGauge, signal breakdown bars, AI narrative, 90d trend chart → Task 9
- [x] Tasks tab: list, create form, mark complete → Task 9
- [x] Contacts tab: cards, add form, delete → Task 9
- [x] HealthBadge component → Task 6
- [x] ScoreGauge component → Task 6
- [x] Recharts for health trend → Task 9
- [x] MSW mocks for tests → Task 2
- [x] Tests: HealthBadge, LoginPage, AccountListPage, authStore → Tasks 3, 6, 8, 10
- [x] Production build verified → Task 10
- [x] Fully responsive (mobile hamburger, tab dropdown) → Tasks 4, 9
