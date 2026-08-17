# RLS and auth tests

Date: 2026-08-17
Status: approved for implementation

## Problem

All 190 tests mock Supabase. `tests/health/harness.mjs` says so explicitly: the mock
"models the app's contract with Supabase, NOT Supabase itself -- RLS, schema types and
network failures still need a real backend."

So the app's access control is the one part of the system nothing verifies. Everything in
`supabase-setup.sql` — seven `enable row level security` statements, thirteen policies,
three `security definer` functions and two triggers — is unexecuted by any test. A policy
could be dropped, a `using (true)` could replace `using (public.is_admin())`, or the
signup trigger could stop assigning roles, and the suite would stay green.

This is the last item holding the app at 8.8 rather than 9, and it is the only remaining
place where the app could be wrong in a way nobody notices until it matters.

## Goals

- Execute the real policies, the real triggers and the real auth path.
- Fail CI if the access-control model changes without the change being deliberate.
- Document the model as it actually is, so "is this what we want?" becomes a separate,
  answerable question.

## Non-goals

- **Changing any policy.** This work pins current behaviour. Three findings are recorded
  at the end for a separate decision; none of them produce a red test here.
- Testing the app's UI against a real backend. That is what the mocked E2E suite does, and
  it does it faster.
- Performance, migrations or backup behaviour.

## Substrate: local Supabase CLI in CI

`supabase start` brings up real Postgres, GoTrue and Storage in Docker. `supabase-setup.sql`
is applied to the empty database, and tests sign up real users and act as them through
`@supabase/supabase-js` with their real session tokens.

This is the only option that exercises **both** halves of what is unverified: the policies
*and* the auth path. pgTAP would test policies precisely but bypass GoTrue entirely,
leaving signup and the first-user-becomes-admin trigger untested. A dedicated hosted
project would match production most closely but shares one mutable database across runs,
needs secrets in CI, and breaks silently if the project is wiped or expires.

```
supabase start                 # postgres + gotrue + storage
psql -f supabase-setup.sql     # the real policies, triggers and functions
node tests/rls/run.mjs         # sign up real users, act as them
```

## The ordering trap, and how the fixtures handle it

`handle_new_user()` assigns `role = 'admin'` when `not exists (select 1 from profiles)`.
**The first signup against a fresh database becomes admin, whichever test runs first.**
A suite that signs users up ad hoc would therefore pass or fail depending on test order.

The fixture handles this explicitly rather than hoping:

1. Reset to a known-empty state (`supabase db reset`, then apply `supabase-setup.sql`).
2. Sign up `admin@test.local` **first**, as a deliberate fixture step, and assert it became
   admin — this is test 1, not a side effect.
3. Sign up `user@test.local` second and assert it became `user`.
4. Every later test reuses those two sessions. Tests that need a throwaway user create one
   with a unique email; it will always be a plain user, which is now a guaranteed property
   rather than an accident.

Tests share one database and must not depend on each other's rows. Each test that writes
uses ids namespaced to itself (`rls-<testname>-<n>`) and cleans up as admin afterwards.

## Layout

```
tests/rls/
  package.json        @supabase/supabase-js (a real dependency here, not a mock)
  fixtures.mjs        start/reset helpers, the two canonical sessions, id namespacing
  run.mjs             entry point; imports ../health/framework.mjs for test/assert
  auth.test.mjs       signup, role assignment, the admin-count guard
  policies.test.mjs   per-table read/write/delete as admin, as user, as anon
  storage.test.mjs    the attachments bucket
```

`framework.mjs` is reused rather than duplicated — the runner is nine lines and already
works. `run.mjs` mirrors `tests/health/run.mjs`, including its exit-code contract.

## Coverage

### Auth and bootstrap
1. The first signup becomes `admin`.
2. The second signup becomes `user`.
3. A profile row is auto-created on signup, named from `raw_user_meta_data.name` when
   present and from the email prefix when not.

### Admin-gated operations — the core of the model
4. A plain user **cannot** delete an account; an admin can.
5. A plain user **cannot** write `settings`; an admin can.
6. A plain user **cannot** change any profile's role.
7. A plain user **cannot** escalate their own role. (Same policy as 6, but this is the
   attack, so it gets its own named test.)

### The admin-count guard
8. Demoting the last remaining admin raises `At least one admin must remain`.
9. Demoting one of two admins succeeds.

### The flat model — pinned as-is
10. Any authenticated user can select every account, contact, activity, task and
    opportunity.
11. Any authenticated user can insert and update those rows.
12. Any authenticated user **can** delete contacts, activities, tasks and opportunities.
    *This documents current behaviour — see finding F1.*

### Anonymous access — the highest-value assertion here
13. An unauthenticated client (anon key, no session) can read **nothing** from any table.
    Every policy is `to authenticated`, so this should already hold; it is exactly the kind
    of thing that breaks silently when someone adds a convenience policy.
14. An unauthenticated client cannot write anything.

### Storage
15. An authenticated user can read from and insert into `attachments`.
16. An authenticated user **can** delete any object in `attachments`, including one another
    user uploaded. *Documents current behaviour — see finding F2.*
17. An unauthenticated client can do none of the above.

## CI

A new `rls` job in `pages.yml`, running in parallel with `test`. `deploy` gains it as a
second `needs`, so the access-control model is gated exactly as the app's behaviour is.

```yaml
  rls:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
      - uses: supabase/setup-cli@v1
      - run: supabase start
      - run: npm ci
        working-directory: tests/rls
      - run: node tests/rls/run.mjs      # never pipe: the exit code IS the gate
  deploy:
    needs: [test, rls]
```

Expected cost is 1-2 minutes of container startup on top of the existing ~2 minute run,
in parallel, so wall-clock CI time should barely move. GitHub runners have Docker
preinstalled; no self-hosted runner is needed.

Local runs need Docker and the Supabase CLI. `TEAM-SETUP.md` gets a short section saying
so, and `run.mjs` should fail with a clear "is Docker running?" message rather than a stack
trace when it cannot reach the local stack.

## Falsification

The standard applied to the deploy gate and the offline test: a gate that has not been
seen red has not been tested. Before merging, prove each of these turns the suite red:

- Change `accounts_delete` to `using (true)` — test 4 must fail.
- Change `settings_write` to `using (true)` — test 5 must fail.
- Drop `alter table public.accounts enable row level security` — tests 13 and 14 must fail.
- Remove the `guard_admin_count` trigger — test 8 must fail.
- Change `handle_new_user` to always assign `'user'` — test 1 must fail.

## Findings for a separate decision

These are recorded, not fixed. They may all be intentional for a small internal team; the
point is that they should be chosen rather than inherited.

**F1 — any user can delete child rows.** `accounts_delete` is admin-gated, but the loop at
`supabase-setup.sql:117` grants delete on contacts, activities, tasks and opportunities to
every authenticated user. A user cannot delete an account but can delete all of its
contacts and history. If account deletion is admin-only because deletion is dangerous, the
same argument applies here.

**F2 — any user can delete any attachment.** `attachments_delete` checks only
`bucket_id = 'attachments'`, so any authenticated user can delete any uploaded file,
including files attached to accounts they never touch. There is also no ownership check on
insert. Scoping deletion to the uploader (`owner = auth.uid()`) or to admins would be a
one-line policy change.

**F3 — the first-admin assignment races.** `handle_new_user` reads `not exists (select 1
from profiles)` and inserts, with no lock. Two signups landing together can both see an
empty table and both become admin. The window is small and the blast radius is "one extra
admin on day one", but it is a real race. `guard_admin_count` does not help — it only
prevents removing the last admin.

**F4 — every user can read every profile.** `profiles_select using (true)` exposes all
names and roles to any authenticated user. Almost certainly fine for an internal CRM;
noted so it is a decision.

## Risks

| Risk | Mitigation |
|---|---|
| Docker/CLI startup flakes make CI noisy | No retry (per the standing rule) — if `supabase start` proves flaky, fix the setup rather than paper over it. Measure over the first week before adding anything. |
| Tests interfere through shared state | Namespaced ids per test, cleanup as admin, and the two canonical sessions created once in a deliberate order. |
| The suite drifts from production because it tests local containers | It tests `supabase-setup.sql`, which IS the source of truth for the hosted project. Drift means the hosted project was changed by hand — worth stating in TEAM-SETUP.md that schema changes go through the file. |
| CI time grows | The `rls` job runs in parallel with `test`, not after it. |
