# Team CRM on Supabase — Design Spec

**Date:** 2026-07-04
**Status:** Approved

## Goal

Turn the single-file `crm.html` into a shared team CRM: everyone edits the same accounts, with real logins, while the app remains one static file hostable on GitHub Pages. Zero servers to run — data and auth live in a free Supabase project.

## Architecture

- `crm.html` (React + Tailwind + supabase-js, all via CDN) — static, publishable.
- Two constants at the top of the file: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (anon key is public by design; enforcement is row-level security). If they are still placeholders, the app renders a setup-instructions screen instead of the login.
- Supabase Postgres stores the data; Supabase Auth (email + password) handles login; Supabase Realtime triggers a debounced refetch so open dashboards stay current.

## Schema (jsonb rows — keeps the app's state shape unchanged)

- `accounts`, `contacts`, `activities`, `tasks`, `opportunities`: `id text primary key, data jsonb, updated_at timestamptz`.
- `settings`: single row (`id int primary key check (id = 1)`, `data jsonb`) holding weights + currency rates.
- `profiles`: `id uuid references auth.users, name text, role text check (role in ('admin','user'))`.

## Rules (row-level security, enforced server-side)

- Signed-in users: read everything; insert/update on all five entity tables; delete on contacts/activities/tasks/opportunities.
- Admins only: delete accounts, write `settings`, change roles in `profiles`.
- Triggers: new signup auto-creates a profile (first user becomes admin, others user); max 2 admins; the last admin cannot be demoted.
- `is_admin()` is a `security definer` helper to avoid recursive RLS.

## App changes

- Local mode removed: no localStorage persistence; state hydrates from Supabase after login.
- Write-through dispatch: the existing reducer stays; a wrapper runs the reducer, then persists the affected rows (insert/update/delete/upsert) asynchronously; failures surface as an alert.
- Login screen: email + password with sign-up toggle (name captured at signup); password reset by email; Sign out uses Supabase session.
- Users panel (Settings): lists profiles, promote/demote role (DB enforces the 2-admin cap). Deleting auth users happens in the Supabase dashboard, noted in the UI.
- Sample data / Clear all / Import JSON: admin-only, implemented as bulk delete + insert.
- Everything else (dashboard, health score, currency conversion, filters, CSV/JSON export) unchanged.

## Deliverables

1. `crm.html` — team edition.
2. `supabase-setup.sql` — paste-and-run schema, RLS, triggers.
3. `TEAM-SETUP.md` — the ~10-minute setup: create project → run SQL → paste URL/key → push to GitHub Pages → colleagues sign up → promote co-admin.

## Verification limits

Full end-to-end needs a real Supabase project (user-owned). Automated verification covers: JSX syntax, the setup screen and login screen rendering, and code paths compiling; first live login/CRUD is verified together with the user after they create the project.
