# Multi-tenant Orgs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner onboard several client companies into the one OneVio install, each with its own users and fully isolated data, from a platform-admin screen inside the app.

**Architecture:** An `orgs` table, an `org_id` on every profile and data row (composite primary keys so two orgs' random row ids cannot collide), and every RLS policy rewritten to "active user AND same org as `current_org()`", where `current_org()` reads the caller's `profiles.org_id`. Users are attached to an org by an `invites` row that the sign-up trigger matches by email. A `platform_admin` flag plus a `switch_org` RPC lets the owner move their own profile between orgs. The email-alert dispatcher loops over orgs. Existing data becomes the default org.

**Tech Stack:** Postgres/Supabase SQL (RLS, plpgsql, pg_cron), single-file React app `crm.html` (no build-time modules; `node build.mjs` produces `dist/crm.html`), two Node test suites: `tests/health` (Playwright against a mocked Supabase) and `tests/rls` (real local stack via `supabase start`).

**Spec:** `docs/superpowers/specs/2026-09-18-multi-tenant-orgs-design.md`

## Global Constraints

- **`supabase-setup.sql` IS the migration.** This repo has no migrations folder. The file is pasted into the SQL editor and re-run; every schema change is written idempotently (`add column if not exists`, `drop policy if exists`, guarded `do $$` blocks). The `disabled` column at the top of the file is the pattern. Do NOT create a separate migration file.
- **Default org id is the fixed uuid `00000000-0000-0000-0000-000000000001`.** Existing rows and profiles are stamped with it. Tests refer to it as `ORG_A`.
- **Every definer function asserts its own gate on entry.** RLS does not run inside `security definer`. `merge_row`, `replace_all`, `merge_patch`, `append_dedup` stay `security invoker`, no exceptions (see the comment above `merge_row`).
- **Read-back denials as a session that can see the row.** A denied update or delete returns no error through PostgREST. Every "cannot" test asserts by reading back with a session that can see the row, as `tests/rls/policies.test.mjs` does.
- **Never pipe the test runners.** Exit code is the gate: `node tests/rls/run.mjs`, `node tests/health/run.mjs`. Health tests run against `dist/crm.html`; `run.mjs` builds it first, but run `node build.mjs` yourself when a single test is run with `run-one.mjs`.
- **Local RLS runs need the running stack's anon key.** `supabase start`, then export `SUPABASE_ANON_KEY` from `supabase status -o json` (the hardcoded fallback key is stale). Also read `C:\Users\manish.w\.claude\projects\D--AI-Project-My-Company\memory\onevio-test-suite-gotchas.md` before writing any test.
- **Additive only in the client store.** Do not rename existing store fields or reducer actions. New profile fields are `org_id` and `platform_admin`.
- **Commit messages** end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Branch:** all work on a feature branch `feature/multi-tenant-orgs` off `master`; one PR at the end.

---

## File map

| File | Responsibility in this change |
|---|---|
| `supabase-setup.sql` | orgs, invites, org columns, PK swaps, `current_org()`, `is_platform_admin()`, invite-driven `handle_new_user`, per-org guards, org-scoped policies, org-stamping RPCs, platform RPCs, org-prefixed storage policies |
| `email-alerts.sql` | `org_alert_prefs`, org parameter on every builder, `send_alerts` loops orgs |
| `crm.html` | `fetchAll` settings query, `Root` profile fields and no-workspace screen, `CURRENT_ORG`, upload path, `UsersCard` invite call, sidebar org name, `PlatformCard` |
| `tests/rls/fixtures.mjs` | two orgs, five sessions, org-aware seed helpers |
| `tests/rls/pre-multitenant-setup.sql` | frozen copy of today's schema for the migration test |
| `tests/rls/auth.test.mjs` | invite-driven sign-up |
| `tests/rls/orgs.test.mjs` (new) | isolation, org column immutability, platform RPCs, per-org admin guard |
| `tests/rls/migration.test.mjs` (new) | old schema + data, then new file, then assertions |
| `tests/rls/storage.test.mjs`, `merge.test.mjs`, `replace.test.mjs`, `policies.test.mjs`, `emailalerts.test.mjs` | updated for org prefix / composite keys / org parameter |
| `tests/health/harness.mjs` | mock profile carries org fields; `orgs`, `list_orgs`, `create_org`, `switch_org`, `invite_user` mocks |
| `tests/health/orgs.test.mjs` (new) | no-workspace screen, org name in sidebar, PlatformCard visibility and list |
| `TEAM-SETUP.md` | onboarding a client, the two EDIT ME literals |

---

### Task 0: Branch and freeze the pre-change schema

**Files:**
- Create: `tests/rls/pre-multitenant-setup.sql`

**Interfaces:**
- Produces: a byte-for-byte copy of today's `supabase-setup.sql`, used by Task 8's migration test.

- [ ] **Step 1: Create the branch**

```powershell
git checkout -b feature/multi-tenant-orgs
```

- [ ] **Step 2: Freeze the current schema file**

```powershell
Copy-Item supabase-setup.sql tests/rls/pre-multitenant-setup.sql
```

Prepend this comment to the copy (edit the file, first two lines):

```sql
-- FROZEN COPY of supabase-setup.sql as of 2026-09-18, BEFORE multi-tenancy. Used only by
-- tests/rls/migration.test.mjs to prove the live file migrates a single-org database. Never edit.
```

- [ ] **Step 3: Commit**

```powershell
git add tests/rls/pre-multitenant-setup.sql
git commit -m "Freeze pre-multitenant schema for the migration test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: Orgs, invites, org columns, helpers and the invite-driven sign-up trigger

**Files:**
- Modify: `supabase-setup.sql` (tables block lines 7-35; helpers lines 37-49; `handle_new_user` lines 51-68; `guard_admin_count` lines 70-93)
- Modify: `tests/rls/fixtures.mjs` (`bootstrap`, seed helpers, exports)
- Modify: `tests/rls/auth.test.mjs`
- Test: `tests/rls/auth.test.mjs`

**Interfaces:**
- Produces (SQL): `public.orgs(id uuid pk, name text, created_at)`, `public.invites(email, org_id, role, created_by, created_at, accepted_at; pk (email, org_id))`, `profiles.org_id uuid null`, `profiles.platform_admin boolean`, `current_org() returns uuid`, `is_platform_admin() returns boolean`, entity tables with `org_id uuid not null default public.current_org()` and pk `(org_id, id)`, `settings(org_id uuid pk default current_org(), data, updated_at)`, `health_snapshots` pk `(org_id, account_id, day)`.
- Produces (tests): `ORG_A`, `ORG_B`, `sessions.{admin,user,adminB,userB,platform,anon}`, `seedRow(table, id, data, session?)`, `seedAccount(id, data, org = ORG_A)`, `seedTask`, `seedActivity` likewise, `signUpFresh(email, name)`, `sql()`, `roleOf`, `orgOf(id)`.

- [ ] **Step 1: Rewrite the auth tests for invite-driven sign-up**

Replace the body of `tests/rls/auth.test.mjs` so that the "first user becomes admin" cases become these (keep any existing sign-in / wrong-password / anonymous cases that do not depend on the first-user rule):

```js
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, signUpFresh, roleOf, orgOf, ORG_A, ORG_B } from "./fixtures.mjs";

test("a sign-up matching an admin invite lands in that org as admin", async () => {
  await sql(`insert into invites (email, org_id, role) values ('inv-admin@test.local', $1, 'admin')`, [ORG_B]);
  const { id } = await signUpFresh("inv-admin@test.local", "Invited Admin");
  assert(await roleOf(id) === "admin", "invite role 'admin' was not applied");
  assert(await orgOf(id) === ORG_B, "invite org was not applied");
  const [inv] = await sql(`select accepted_at from invites where email = 'inv-admin@test.local'`);
  assert(inv.accepted_at, "the invite was not marked accepted");
});

test("a sign-up matching a user invite lands in that org as user", async () => {
  await sql(`insert into invites (email, org_id, role) values ('inv-user@test.local', $1, 'user')`, [ORG_A]);
  const { id } = await signUpFresh("inv-user@test.local", "Invited User");
  assert(await roleOf(id) === "user", "invite role 'user' was not applied");
  assert(await orgOf(id) === ORG_A, "invite org was not applied");
});

test("a sign-up with no invite gets no org and reads nothing", async () => {
  const { client, id } = await signUpFresh("stranger@test.local", "Stranger");
  assert(await orgOf(id) === null, "an uninvited sign-up was attached to an org");
  assert(await roleOf(id) === "user", "an uninvited sign-up must never be admin");
  const { data, error } = await client.from("accounts").select("id");
  assert(!error, `unexpected error: ${error && error.message}`);
  assert((data || []).length === 0, "an org-less user can read accounts");
});

test("invite email matching is case- and whitespace-insensitive", async () => {
  await sql(`insert into invites (email, org_id, role) values ('mixed@test.local', $1, 'user')`, [ORG_B]);
  const { id } = await signUpFresh("Mixed@Test.local", "Mixed Case");
  assert(await orgOf(id) === ORG_B, "sign-up with different casing did not match the invite");
});

test("profile name falls back to the email prefix when sign-up sends no name", async () => {
  await sql(`insert into invites (email, org_id, role) values ('noname@test.local', $1, 'user')`, [ORG_A]);
  const { id } = await signUpFresh("noname@test.local", null);
  const [row] = await sql(`select name from profiles where id = $1`, [id]);
  assert(row.name === "noname", `expected 'noname', got ${row.name}`);
});
```

- [ ] **Step 2: Rewrite the fixtures for two orgs**

In `tests/rls/fixtures.mjs`:

Add after `PASSWORD`:

```js
// The default org that supabase-setup.sql creates and stamps existing data with. Fixed
// uuid so tests and the backfill can name it without a lookup.
export const ORG_A = "00000000-0000-0000-0000-000000000001";
export const ORG_B = "00000000-0000-0000-0000-000000000002";
```

Change `sessions` to:

```js
export const sessions = { admin: null, user: null, adminB: null, userB: null, platform: null, anon: newClient() };
```

Replace `bootstrap()`:

```js
// Two orgs, two people each, plus a platform admin who starts inside org A. Every user is
// INVITED first: handle_new_user() now attaches a sign-up to an org only through a
// pending invite, so an ad-hoc sign-up here would land with no org and read nothing.
export async function bootstrap() {
  await resetStack();
  await sql(`insert into orgs (id, name) values ($1, 'Org B') on conflict (id) do nothing`, [ORG_B]);
  await sql(`insert into settings (org_id, data) values ($1, '{}') on conflict (org_id) do nothing`, [ORG_B]);
  await sql(`insert into org_alert_prefs (org_id) values ($1) on conflict (org_id) do nothing`, [ORG_B]);
  await sql(`insert into invites (email, org_id, role) values
    ('admin@test.local',    $1, 'admin'),
    ('user@test.local',     $1, 'user'),
    ('adminb@test.local',   $2, 'admin'),
    ('userb@test.local',    $2, 'user'),
    ('platform@test.local', $1, 'admin')`, [ORG_A, ORG_B]);
  const admin    = await signUp("admin@test.local", "Admin User");
  const user     = await signUp("user@test.local", "Plain User");
  const adminB   = await signUp("adminb@test.local", "Admin B");
  const userB    = await signUp("userb@test.local", "Plain B");
  const platform = await signUp("platform@test.local", "Platform Owner");
  // The flag cannot be granted through the API (guard_profile_org, Task 2), only by SQL.
  await sql(`update profiles set platform_admin = true where id = $1`, [platform.id]);
  sessions.admin = admin.client;   sessions.user = user.client;
  sessions.adminB = adminB.client; sessions.userB = userB.client;
  sessions.platform = platform.client;
  sessions.anon = newClient();
  await assertAnonIsAnonymous();
  await purgeAttachments();
  return { adminId: admin.id, userId: user.id, adminBId: adminB.id, userBId: userB.id, platformId: platform.id };
}
```

Note `org_alert_prefs` is created by `email-alerts.sql` (Task 6). Until Task 6 lands, that insert will fail; so in THIS task write it as a guarded statement:

```js
  await sql(`do $$ begin
    if to_regclass('public.org_alert_prefs') is not null then
      insert into org_alert_prefs (org_id) values ('${ORG_B}') on conflict (org_id) do nothing;
    end if; end $$`);
```

Update `purgeAttachments` to purge both org prefixes:

```js
async function purgeAttachments() {
  for (const [session, prefix] of [[sessions.admin, ORG_A], [sessions.adminB, ORG_B]]) {
    const { data, error } = await session.storage.from("attachments").list(`${prefix}/rls`);
    if (error || !data?.length) continue;
    await session.storage.from("attachments").remove(data.map(f => `${prefix}/rls/${f.name}`));
  }
}
```

Add `orgOf` next to `roleOf`, and make `roleOf` read by SQL (the admin session can no longer see org B's profiles):

```js
export async function roleOf(id) {
  const [row] = await sql(`select role from profiles where id = $1`, [id]);
  return row?.role ?? null;
}
export async function orgOf(id) {
  const [row] = await sql(`select org_id from profiles where id = $1`, [id]);
  return row?.org_id ?? null;
}
```

Change `seedRow` to accept a session (default admin of org A) and `stillExists` / `valueOf` to read by SQL so they see every org:

```js
export async function seedRow(table, id, data = { name: "Seeded" }, session = sessions.admin) {
  const { error } = await session.from(table).insert({ id, data });
  if (error) throw new Error(`seedRow(${table}, ${id}) failed: ${error.message}`);
}
export async function stillExists(table, id, org = ORG_A) {
  const rows = await sql(`select id from public.${table} where org_id = $1 and id = $2`, [org, id]);
  return rows.length > 0;
}
export async function valueOf(table, id, org = ORG_A) {
  const [row] = await sql(`select data from public.${table} where org_id = $1 and id = $2`, [org, id]);
  return row?.data ?? null;
}
```

Change the SQL seeders to take an org and use the composite key:

```js
const seedEntity = table => (id, data, org = ORG_A) => sql(
  `insert into public.${table} (org_id, id, data) values ($1, $2, $3)
   on conflict (org_id, id) do update set data = excluded.data`, [org, id, data]);
export const seedAccount  = seedEntity("accounts");
export const seedTask     = seedEntity("tasks");
export const seedActivity = seedEntity("activities");
```

`signUpFresh` stays; the `signUp` helper must tolerate `name = null` as it does today.

- [ ] **Step 3: Run the auth tests to verify they fail**

```powershell
supabase start
$env:SUPABASE_ANON_KEY = (supabase status -o json | ConvertFrom-Json).ANON_KEY
node tests/rls/run.mjs
```

Expected: bootstrap fails with `relation "orgs" does not exist` (exit 2). That is the failing state.

- [ ] **Step 4: Add the tables, helpers and trigger to `supabase-setup.sql`**

Replace the `-- ---------- tables ----------` block through the end of `handle_new_user`'s trigger with the following. Keep the `do $$ ... foreach t` creating the five entity tables, but the create statements must now include org columns for a fresh install, and the block after it migrates an existing install.

```sql
-- ---------- EDIT ME: platform identity ----------
-- The default org receives every row and user that existed before multi-tenancy. Its id
-- is fixed so this file can stamp existing data without a lookup. The platform admin is
-- the one account that can create client orgs and switch between them (Settings ->
-- Platform). Both statements are idempotent: change the literals and re-run.
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
insert into public.orgs (id, name)
values ('00000000-0000-0000-0000-000000000001', 'My Company')   -- EDIT ME: your company name
on conflict (id) do nothing;

-- ---------- tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'CSM',
  role text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz not null default now()
);
alter table public.profiles
  add column if not exists disabled boolean not null default false;
-- org_id is NULL for a sign-up that matched no invite: such a user has a valid session and
-- reads nothing (is_active() requires an org). platform_admin can only be set by SQL or by
-- a platform admin (guard_profile_org below).
alter table public.profiles
  add column if not exists org_id uuid references public.orgs(id),
  add column if not exists platform_admin boolean not null default false;
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null
  and created_at < (select min(created_at) from public.orgs where id <> '00000000-0000-0000-0000-000000000001')
  -- ^ only profiles older than the first client org are legacy rows; a later org-less
  --   sign-up stays org-less on re-run. With no client orgs yet, min() is null and the
  --   comparison is null, so the row is NOT stamped -- hence the second statement:
  ;
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001'
  where org_id is null and not exists (select 1 from public.orgs where id <> '00000000-0000-0000-0000-000000000001');

create table if not exists public.invites (
  email text not null,
  org_id uuid not null references public.orgs(id) on delete cascade,
  role text not null check (role in ('admin','user')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (email, org_id)
);

-- ---------- helper: which org is this request for? ----------
-- The single source of tenancy. Every policy and every org-stamping RPC reads this.
-- Definer so it can read profiles regardless of the profiles policies; stable so the
-- planner evaluates it once per statement.
create or replace function public.current_org()
returns uuid language sql stable security definer set search_path = public as
$$ select org_id from profiles where id = auth.uid() $$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and platform_admin and not disabled) $$;

-- settings: one row per org. Pre-multitenant this was `id int primary key check (id = 1)`.
create table if not exists public.settings (
  org_id uuid primary key default public.current_org() references public.orgs(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'settings' and column_name = 'id') then
    alter table public.settings add column if not exists org_id uuid;
    update public.settings set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
    alter table public.settings drop constraint settings_pkey;
    alter table public.settings drop column id;
    alter table public.settings
      alter column org_id set not null,
      alter column org_id set default public.current_org(),
      add primary key (org_id),
      add constraint settings_org_id_fkey foreign key (org_id) references public.orgs(id) on delete cascade;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['accounts','contacts','activities','tasks','opportunities'] loop
    execute format('create table if not exists public.%I (
      org_id uuid not null default public.current_org() references public.orgs(id) on delete cascade,
      id text not null,
      data jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (org_id, id)
    )', t);
    -- migrate a pre-multitenant table: add + backfill + swap the primary key, once
    execute format('alter table public.%I add column if not exists org_id uuid', t);
    execute format('update public.%I set org_id = %L where org_id is null', t, '00000000-0000-0000-0000-000000000001');
    execute format('alter table public.%I alter column org_id set not null, alter column org_id set default public.current_org()', t);
    if exists (select 1 from pg_constraint
               where conrelid = format('public.%I', t)::regclass and contype = 'p' and array_length(conkey, 1) = 1) then
      execute format('alter table public.%I drop constraint %I, add primary key (org_id, id)', t, t || '_pkey');
    end if;
    if not exists (select 1 from pg_constraint where conrelid = format('public.%I', t)::regclass and conname = t || '_org_id_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (org_id) references public.orgs(id) on delete cascade', t, t || '_org_id_fkey');
    end if;
  end loop;
end $$;
```

Then keep `is_admin()` and `is_active()` but change `is_active()` to require an org:

```sql
create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and not disabled and org_id is not null) $$;
```

Replace `handle_new_user`:

```sql
-- ---------- signup trigger: attach through a pending invite ----------
-- The old rule "first sign-up ever becomes admin" is gone: with several orgs there is no
-- meaningful "first". A sign-up is attached to an org ONLY if a pending invite matches its
-- email; anything else gets a profile with no org, which is_active() rejects everywhere.
-- The browser cannot say "put me in org X": invites are written by invite_user() (org
-- admins, own org only) and create_org() (platform admin), never by the client directly.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  inv invites;
begin
  select * into inv from invites
   where email = lower(trim(new.email)) and accepted_at is null
   order by created_at desc limit 1;
  insert into profiles (id, name, role, org_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(inv.role, 'user'),
    inv.org_id
  ) on conflict (id) do nothing;
  if inv.email is not null then
    update invites set accepted_at = now() where email = inv.email and org_id = inv.org_id;
  end if;
  return new;
end $$;
```

Make `guard_admin_count` per org: change the count to

```sql
     and (select count(*) from profiles
            where role = 'admin' and not disabled and id <> old.id and org_id = old.org_id) = 0 then
```

Add, immediately after the `guard_admin_count` trigger:

```sql
-- ---------- org column immutability ----------
-- profiles_update_admin lets an org admin edit rows in their org; this trigger is what
-- stops that admin (or a user editing their own row) from moving anyone to another org
-- or minting a platform admin. SQL-editor and cron contexts have no auth.uid() and are
-- exempt: that is how this file's own backfill and switch_org's owner context run.
create or replace function public.guard_profile_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.org_id is distinct from old.org_id or new.platform_admin is distinct from old.platform_admin)
     and not public.is_platform_admin() then
    raise exception 'Only a platform admin can change a user''s org or platform flag';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile_org on public.profiles;
create trigger guard_profile_org
  before update of org_id, platform_admin on public.profiles
  for each row execute function public.guard_profile_org();
```

Also migrate `health_snapshots` (its block is near line 417): add after its `create table`:

```sql
alter table public.health_snapshots add column if not exists org_id uuid;
update public.health_snapshots set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
do $$
begin
  alter table public.health_snapshots alter column org_id set not null;
  if exists (select 1 from pg_constraint where conrelid = 'public.health_snapshots'::regclass
             and contype = 'p' and array_length(conkey, 1) = 2) then
    alter table public.health_snapshots drop constraint health_snapshots_pkey,
      add primary key (org_id, account_id, day);
  end if;
end $$;
```

and change the fresh-install `create table` to `primary key (org_id, account_id, day)` with `org_id uuid not null` as its first column.

Finally, in the `foreach t in array array['accounts',...,'settings','profiles']` grants loop near line 401, add `'orgs','invites'` so the default grants exist; RLS (Task 2) decides access.

Enable RLS on the new tables right after their creation:

```sql
alter table public.orgs enable row level security;
alter table public.invites enable row level security;
```

(No policies yet; Task 2 adds them. Until then the API sees nothing in them, which is safe.)

- [ ] **Step 5: Run the suite; expect the auth tests green and other files partly red**

```powershell
node tests/rls/run.mjs
```

Expected: bootstrap succeeds; the five auth tests PASS. Policy, merge, replace and storage tests may fail on old assumptions (`settings` with `id: 1`, `rls/` storage prefix); they are fixed in Tasks 2 and 5. Record which fail in the commit message body.

- [ ] **Step 6: Commit**

```powershell
git add supabase-setup.sql tests/rls/fixtures.mjs tests/rls/auth.test.mjs
git commit -m "Add orgs, invites and org columns; attach sign-ups through invites

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Org-scoped policies and org-stamping RPCs

**Files:**
- Modify: `supabase-setup.sql` (policies block lines 95-145; `merge_row`; `replace_all`; `record_health`; `admin_user_list`; `admin_set_user_email`)
- Modify: `tests/rls/policies.test.mjs` (the two `settings` tests), `tests/rls/merge.test.mjs`, `tests/rls/replace.test.mjs`, `tests/rls/emailalerts.test.mjs` (only the `record_health` cases that read `health_snapshots` by account id)
- Create: `tests/rls/orgs.test.mjs`
- Modify: `tests/rls/run.mjs` (import the new file)

**Interfaces:**
- Consumes: `current_org()`, `is_platform_admin()`, `ORG_A/ORG_B`, `sessions.*`, `seedAccount(id, data, org)`.
- Produces: all policies filtered by `org_id = public.current_org()`; `merge_row`, `replace_all`, `record_health` stamp the org; `admin_user_list()` and `admin_set_user_email()` are org-scoped; `orgs_select` policy `using (id = public.current_org() or public.is_platform_admin())`.

- [ ] **Step 1: Write the isolation tests**

Create `tests/rls/orgs.test.mjs`:

```js
// Tenant isolation. Every "cannot see" assertion is paired with a "can see own" control in
// the same test, so a policy that returns nothing to anyone would fail loudly rather than
// pass vacuously (the lesson of the anon-key incident in fixtures.mjs).
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, seedAccount, valueOf, ORG_A, ORG_B } from "./fixtures.mjs";

const TABLES = ["accounts", "contacts", "activities", "tasks", "opportunities"];

test("a user reads only their own org's rows on every entity table", async () => {
  for (const t of TABLES) {
    await sql(`insert into public.${t} (org_id, id, data) values ($1, 'iso-a', '{"name":"A"}'), ($2, 'iso-b', '{"name":"B"}')
               on conflict (org_id, id) do nothing`, [ORG_A, ORG_B]);
    const { data, error } = await sessions.user.from(t).select("id");
    assert(!error, `${t}: ${error && error.message}`);
    const ids = (data || []).map(r => r.id);
    assert(ids.includes("iso-a"), `${t}: own org row missing (vacuous policy?)`);
    assert(!ids.includes("iso-b"), `${t}: LEAK -- org B's row visible to org A's user`);
  }
});

test("settings are per org", async () => {
  await sql(`insert into settings (org_id, data) values ($1, '{"rates":{"INR":1}}'), ($2, '{"rates":{"INR":2}}')
             on conflict (org_id) do update set data = excluded.data`, [ORG_A, ORG_B]);
  const { data } = await sessions.userB.from("settings").select("data");
  assert(data.length === 1 && data[0].data.rates.INR === 2, `org B user saw ${JSON.stringify(data)}`);
});

test("an insert naming another org is rejected", async () => {
  const { error } = await sessions.user.from("accounts").insert({ org_id: ORG_B, id: "iso-cross", data: { name: "X" } });
  assert(error && error.code === "42501", `expected 42501, got ${error && error.code}: ${error && error.message}`);
  const rows = await sql(`select 1 from accounts where id = 'iso-cross'`);
  assert(rows.length === 0, "a cross-org insert landed");
});

test("merge_row stamps the caller's org and never touches another org's row", async () => {
  await seedAccount("iso-m", { name: "B original" }, ORG_B);
  const { error } = await sessions.user.rpc("merge_row", { tbl: "accounts", row_id: "iso-m", patch: { name: "A wrote this" }, appends: {} });
  assert(!error, `merge_row errored: ${error && error.message}`);
  assert((await valueOf("accounts", "iso-m", ORG_B)).name === "B original", "org A's merge overwrote org B's row");
  assert((await valueOf("accounts", "iso-m", ORG_A)).name === "A wrote this", "org A's merge did not land in org A");
});

test("replace_all deletes only the caller's org", async () => {
  await seedAccount("keep-b", { name: "Keep" }, ORG_B);
  const { error } = await sessions.admin.rpc("replace_all", { payload: { accounts: [{ id: "new-a", name: "New" }], settings: {} } });
  assert(!error, `replace_all errored: ${error && error.message}`);
  assert(await valueOf("accounts", "keep-b", ORG_B), "replace_all in org A wiped org B");
  assert(await valueOf("accounts", "new-a", ORG_A), "replace_all did not insert into org A");
});

test("record_health stamps the org and only accepts the caller's accounts", async () => {
  await seedAccount("hs-a", { name: "HA" }, ORG_A);
  await seedAccount("hs-b", { name: "HB" }, ORG_B);
  const { data: n } = await sessions.user.rpc("record_health", { p_scores: [{ accountId: "hs-a", score: 50 }, { accountId: "hs-b", score: 50 }] });
  assert(n === 1, `expected 1 row written, got ${n}`);
  const rows = await sql(`select org_id, account_id from health_snapshots where account_id in ('hs-a','hs-b')`);
  assert(rows.length === 1 && rows[0].org_id === ORG_A && rows[0].account_id === "hs-a", `unexpected rows ${JSON.stringify(rows)}`);
});

test("a user cannot change their own org_id or platform flag", async () => {
  const { data } = await sessions.user.auth.getUser();
  await sessions.user.from("profiles").update({ org_id: ORG_B }).eq("id", data.user.id);
  await sessions.user.from("profiles").update({ platform_admin: true }).eq("id", data.user.id);
  const [row] = await sql(`select org_id, platform_admin from profiles where id = $1`, [data.user.id]);
  assert(row.org_id === ORG_A && row.platform_admin === false, `PRIVILEGE ESCALATION: ${JSON.stringify(row)}`);
});

test("an org admin cannot move a user to another org", async () => {
  const { data } = await sessions.user.auth.getUser();
  const { error } = await sessions.admin.from("profiles").update({ org_id: ORG_B }).eq("id", data.user.id);
  assert(error, "the org guard trigger should raise for an org admin");
  const [row] = await sql(`select org_id from profiles where id = $1`, [data.user.id]);
  assert(row.org_id === ORG_A, "an org admin moved a user across orgs");
});

test("admin_user_list never returns another org's users", async () => {
  const { data, error } = await sessions.admin.rpc("admin_user_list");
  assert(!error, error && error.message);
  const emails = data.map(u => u.email);
  assert(emails.includes("user@test.local"), "own org user missing");
  assert(!emails.includes("userb@test.local"), "LEAK: org B's user listed to org A's admin");
});

test("profiles are visible only within the org", async () => {
  const { data } = await sessions.userB.from("profiles").select("id,name");
  const names = data.map(p => p.name);
  assert(names.includes("Admin B"), "own org profile missing");
  assert(!names.includes("Admin User"), "LEAK: org A profile visible to org B");
});

test("demoting an org's last admin fails even though other orgs have admins", async () => {
  const [{ id }] = await sql(`select id from profiles where org_id = $1 and role = 'admin' and not platform_admin`, [ORG_B]);
  const { error } = await sessions.adminB.from("profiles").update({ role: "user" }).eq("id", id);
  // Self-demotion goes through the trigger, which raises -> PostgREST surfaces an error.
  assert(error && /at least one admin/i.test(error.message), `expected the per-org guard, got ${error && error.message}`);
});

test("orgs: a member sees only their own org; the platform admin sees all", async () => {
  const { data: mine } = await sessions.userB.from("orgs").select("id,name");
  assert(mine.length === 1 && mine[0].id === ORG_B, `org B user saw ${JSON.stringify(mine)}`);
  const { data: all } = await sessions.platform.from("orgs").select("id");
  assert(all.length >= 2, "platform admin should see every org");
});
```

Add `import "./orgs.test.mjs";` to `tests/rls/run.mjs` after `policies.test.mjs`.

- [ ] **Step 2: Fix the two `settings` cases in `policies.test.mjs`**

```js
test("a plain user cannot write settings", async () => {
  const { error } = await sessions.user.from("settings").upsert({ data: { rates: { INR: 99 } } });
  assert(error, "settings_write should reject a plain user's write");
  assert(error.code === "42501", `expected an RLS violation (42501), got ${error.code}: ${error.message}`);
});

test("an admin can write settings", async () => {
  const { error } = await sessions.admin.from("settings").upsert({ data: { rates: { INR: 0.012 } } });
  assert(!error, `admin settings write failed: ${error && error.message}`);
});
```

In `merge.test.mjs`, `replace.test.mjs` and `emailalerts.test.mjs`, any raw SQL of the form `on conflict (id)` on an entity table becomes `on conflict (org_id, id)`, and any `insert into <entity> (id, data)` becomes `(org_id, id, data)` with `ORG_A`. Any `.from("settings")...eq("id", 1)` drops the `.eq`. `health_snapshots` reads by `account_id` are unchanged (the admin session is in org A).

- [ ] **Step 3: Run to verify the new tests fail**

```powershell
node tests/rls/run.mjs
```

Expected: `orgs.test.mjs` cases FAIL (leaks, or `42501` expectations unmet), because policies are still flat.

- [ ] **Step 4: Rewrite the policies and RPCs in `supabase-setup.sql`**

Replace the policies block (from `-- ---------- row-level security ----------` through the child-table delete loop) with:

```sql
-- ---------- row-level security ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.activities enable row level security;
alter table public.tasks enable row level security;
alter table public.opportunities enable row level security;

-- THE TENANCY BOUNDARY. Every business policy is "active user AND the row's org is my org".
-- The `with check` half is what stops a client naming another org on an insert or update:
-- the column has a default of current_org(), but a default is a convenience, not a guard.

-- profiles: an active user sees their org's profiles; anyone sees their own row (so a
-- disabled or org-less user can be told what happened -- see Root() in crm.html).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using ((public.is_active() and org_id = public.current_org()) or id = auth.uid());
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin() and org_id = public.current_org())
  with check (public.is_admin() and org_id = public.current_org());

-- orgs: members see their own org (the sidebar shows its name); the platform admin sees all.
-- No insert/update/delete from the browser: create_org() is the only writer.
drop policy if exists orgs_select on public.orgs;
create policy orgs_select on public.orgs for select to authenticated
  using (id = public.current_org() or public.is_platform_admin());

-- invites: org admins read their org's invites. Writes go through invite_user()/create_org().
drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites for select to authenticated
  using (public.is_admin() and org_id = public.current_org());

-- settings: read all in org, write admin in org
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated
  using (public.is_active() and org_id = public.current_org());
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all to authenticated
  using (public.is_admin() and org_id = public.current_org())
  with check (public.is_admin() and org_id = public.current_org());

-- entity tables: read/insert/update for active users of the row's org
do $$
declare t text;
begin
  foreach t in array array['accounts','contacts','activities','tasks','opportunities'] loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.is_active() and org_id = public.current_org())', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.is_active() and org_id = public.current_org())', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.is_active() and org_id = public.current_org()) with check (public.is_active() and org_id = public.current_org())', t);
  end loop;
end $$;

-- deletes: accounts admin-only; child tables any active user -- within the org
drop policy if exists accounts_delete on public.accounts;
create policy accounts_delete on public.accounts for delete to authenticated
  using (public.is_admin() and org_id = public.current_org());
do $$
declare t text;
begin
  foreach t in array array['contacts','activities','tasks','opportunities'] loop
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.is_active() and org_id = public.current_org())', t);
  end loop;
end $$;
```

`merge_row`: change the settings branch and the entity upsert to stamp the org:

```sql
  if tbl = 'settings' then
    insert into settings (org_id, data, updated_at)
      values (public.current_org(), public.merge_patch('{}'::jsonb, patch, appends), now())
      on conflict (org_id) do update
        set data = public.merge_patch(settings.data, patch, appends), updated_at = now();
  else
    execute format(
      'insert into public.%1$I (org_id, id, data, updated_at)
         values (public.current_org(), $1, public.merge_patch(''{}''::jsonb, $2, $3), now())
       on conflict (org_id, id) do update
         set data = public.merge_patch(public.%1$I.data, $2, $3), updated_at = now()', tbl)
      using row_id, patch, appends;
  end if;
```

`replace_all`: the delete loop becomes `execute format('delete from public.%I where org_id = public.current_org()', t);`; the insert becomes `insert into public.%I (org_id, id, data, updated_at) select public.current_org(), e ->> ''id'', e, now() from ...`; the settings upsert becomes `insert into settings (org_id, data, updated_at) values (public.current_org(), coalesce(payload -> 'settings', '{}'::jsonb), now()) on conflict (org_id) do update set data = excluded.data, updated_at = now();`.

`record_health`: the insert becomes

```sql
  insert into health_snapshots (org_id, account_id, day, score)
  select public.current_org(), e->>'accountId', current_date,
         least(100, greatest(0, (e->>'score')::numeric::int))
  from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) e
  where e->>'accountId' is not null
    and exists (select 1 from accounts a where a.id = e->>'accountId' and a.org_id = public.current_org())
  on conflict (org_id, account_id, day) do update set score = excluded.score;
```

(keep whatever `on conflict` clause the current function has, adding `org_id` to its target). `health_snapshots_select` gets `and org_id = public.current_org()`.

`admin_user_list`: add `where p.org_id = public.current_org()` before `order by`. `admin_set_user_email`: add, after the admin gate, `if not exists (select 1 from profiles where id = p_id and org_id = public.current_org()) then raise exception 'admin_set_user_email: user is not in your org'; end if;`.

- [ ] **Step 5: Run the whole RLS suite**

```powershell
node tests/rls/run.mjs
```

Expected: everything in `auth`, `policies`, `orgs`, `merge`, `replace`, `errorlog` PASS. `storage` and `emailalerts` may still fail (Tasks 5 and 6). No test in `orgs.test.mjs` may be skipped or weakened to get here.

- [ ] **Step 6: Commit**

```powershell
git add supabase-setup.sql tests/rls
git commit -m "Scope every policy and write RPC to the caller's org

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Platform RPCs: create_org, invite_user, switch_org, list_orgs

**Files:**
- Modify: `supabase-setup.sql` (new block after `admin_set_user_email`)
- Modify: `tests/rls/orgs.test.mjs`

**Interfaces:**
- Produces: `create_org(p_name text, p_admin_email text) returns uuid`, `invite_user(p_email text, p_role text) returns void`, `switch_org(p_org_id uuid) returns void`, `list_orgs() returns table(id uuid, name text, created_at timestamptz, users int)`. All four: `revoke from public, anon; grant to authenticated`.

- [ ] **Step 1: Append the RPC tests to `tests/rls/orgs.test.mjs`**

```js
test("invite_user: an org admin invites into their own org only", async () => {
  const { error } = await sessions.admin.rpc("invite_user", { p_email: "  New.Person@Test.local ", p_role: "user" });
  assert(!error, error && error.message);
  const [inv] = await sql(`select org_id, role, email from invites where email = 'new.person@test.local'`);
  assert(inv && inv.org_id === ORG_A && inv.role === "user", `invite row wrong: ${JSON.stringify(inv)}`);
});

test("invite_user: a plain user cannot invite", async () => {
  const { error } = await sessions.user.rpc("invite_user", { p_email: "nope@test.local", p_role: "admin" });
  assert(error && /admin only/i.test(error.message), `expected admin-only refusal, got ${error && error.message}`);
});

test("invite_user: re-inviting the same email replaces the role and re-opens the invite", async () => {
  await sessions.admin.rpc("invite_user", { p_email: "twice@test.local", p_role: "user" });
  await sql(`update invites set accepted_at = now() where email = 'twice@test.local'`);
  const { error } = await sessions.admin.rpc("invite_user", { p_email: "twice@test.local", p_role: "admin" });
  assert(!error, error && error.message);
  const [inv] = await sql(`select role, accepted_at from invites where email = 'twice@test.local' and org_id = $1`, [ORG_A]);
  assert(inv.role === "admin" && inv.accepted_at === null, `expected re-opened admin invite, got ${JSON.stringify(inv)}`);
});

test("create_org: platform admin creates an org with settings, prefs and an admin invite", async () => {
  const { data: orgId, error } = await sessions.platform.rpc("create_org", { p_name: "Client C", p_admin_email: "Owner@ClientC.com" });
  assert(!error, error && error.message);
  const [org] = await sql(`select name from orgs where id = $1`, [orgId]);
  assert(org && org.name === "Client C", "org row missing");
  assert((await sql(`select 1 from settings where org_id = $1`, [orgId])).length === 1, "settings row missing");
  const [inv] = await sql(`select role from invites where org_id = $1 and email = 'owner@clientc.com'`, [orgId]);
  assert(inv && inv.role === "admin", "admin invite missing");
  const prefs = await sql(`select 1 from org_alert_prefs where org_id = $1`, [orgId]);
  assert(prefs.length === 1, "org_alert_prefs row missing (create_org must seed it)");
});

test("create_org: an org admin cannot create orgs", async () => {
  const { error } = await sessions.admin.rpc("create_org", { p_name: "Rogue", p_admin_email: "r@r.com" });
  assert(error && /platform admin/i.test(error.message), `expected platform-admin refusal, got ${error && error.message}`);
});

test("switch_org: platform admin moves into org B and sees its rows; an org admin cannot", async () => {
  await seedAccount("sw-b", { name: "Switch B" }, ORG_B);
  const { error: denied } = await sessions.admin.rpc("switch_org", { p_org_id: ORG_B });
  assert(denied && /platform admin/i.test(denied.message), "an org admin switched orgs");
  const { error } = await sessions.platform.rpc("switch_org", { p_org_id: ORG_B });
  assert(!error, error && error.message);
  const { data } = await sessions.platform.from("accounts").select("id").eq("id", "sw-b");
  assert(data.length === 1, "platform admin does not see org B after switching");
  await sessions.platform.rpc("switch_org", { p_org_id: ORG_A });   // restore for later tests
});

test("switch_org: refuses an unknown org", async () => {
  const { error } = await sessions.platform.rpc("switch_org", { p_org_id: "00000000-0000-0000-0000-00000000dead" });
  assert(error, "switching to a non-existent org should fail");
});

test("list_orgs: platform admin gets every org with a user count; others are refused", async () => {
  const { data, error } = await sessions.platform.rpc("list_orgs");
  assert(!error, error && error.message);
  const a = data.find(o => o.id === ORG_A), b = data.find(o => o.id === ORG_B);
  assert(a && b, "both orgs listed");
  assert(b.users >= 2, `org B should count its two users, got ${b && b.users}`);
  const { error: denied } = await sessions.admin.rpc("list_orgs");
  assert(denied, "an org admin listed all orgs");
});
```

- [ ] **Step 2: Run to verify they fail**

```powershell
node tests/rls/run.mjs
```

Expected: the new cases FAIL with `function public.invite_user(...) does not exist` and similar.

- [ ] **Step 3: Add the RPCs to `supabase-setup.sql`** (after `admin_set_user_email`'s grants)

```sql
-- ---------- onboarding: invites and orgs ----------
-- Both writers of `invites`. handle_new_user() trusts an invite row absolutely, so who may
-- create one IS the tenancy boundary at sign-up time.
create or replace function public.invite_user(p_email text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare addr text := lower(trim(p_email));
begin
  if not public.is_admin() then
    raise exception 'invite_user: admin only';
  end if;
  if p_role not in ('admin','user') then
    raise exception 'invite_user: role must be admin or user';
  end if;
  if addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invite_user: % is not a valid email address', p_email;
  end if;
  insert into invites (email, org_id, role, created_by)
  values (addr, public.current_org(), p_role, auth.uid())
  on conflict (email, org_id) do update
    set role = excluded.role, created_by = excluded.created_by, created_at = now(), accepted_at = null;
end $$;

create or replace function public.create_org(p_name text, p_admin_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  addr text := lower(trim(p_admin_email));
begin
  if not public.is_platform_admin() then
    raise exception 'create_org: platform admin only';
  end if;
  if length(trim(p_name)) = 0 then
    raise exception 'create_org: name is required';
  end if;
  if addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'create_org: % is not a valid email address', p_admin_email;
  end if;
  insert into orgs (name) values (trim(p_name)) returning id into new_id;
  insert into settings (org_id, data) values (new_id, '{}'::jsonb);
  -- org_alert_prefs lives in email-alerts.sql, which may not be installed on a fresh stack.
  if to_regclass('public.org_alert_prefs') is not null then
    execute 'insert into org_alert_prefs (org_id) values ($1) on conflict (org_id) do nothing' using new_id;
  end if;
  insert into invites (email, org_id, role, created_by) values (addr, new_id, 'admin', auth.uid());
  return new_id;
end $$;

create or replace function public.switch_org(p_org_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'switch_org: platform admin only';
  end if;
  if not exists (select 1 from orgs where id = p_org_id) then
    raise exception 'switch_org: no such org';
  end if;
  update profiles set org_id = p_org_id where id = auth.uid();
end $$;

create or replace function public.list_orgs()
returns table(id uuid, name text, created_at timestamptz, users int)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'list_orgs: platform admin only';
  end if;
  return query
    select o.id, o.name, o.created_at,
           (select count(*)::int from profiles p where p.org_id = o.id and not p.disabled)
    from orgs o order by o.created_at;
end $$;

revoke execute on function public.invite_user(text, text) from public, anon;
revoke execute on function public.create_org(text, text) from public, anon;
revoke execute on function public.switch_org(uuid) from public, anon;
revoke execute on function public.list_orgs() from public, anon;
grant execute on function public.invite_user(text, text) to authenticated;
grant execute on function public.create_org(text, text) to authenticated;
grant execute on function public.switch_org(uuid) to authenticated;
grant execute on function public.list_orgs() to authenticated;
```

Note on `switch_org`: the `guard_profile_org` trigger sees `auth.uid()` set and `is_platform_admin()` true for the caller, so the update passes. If the test shows the trigger raising, the cause is `is_platform_admin()` reading a stale row; do not exempt definer functions from the trigger.

- [ ] **Step 4: Run the suite; expect green through `orgs.test.mjs`**

```powershell
node tests/rls/run.mjs
```

- [ ] **Step 5: Commit**

```powershell
git add supabase-setup.sql tests/rls/orgs.test.mjs
git commit -m "Add create_org, invite_user, switch_org and list_orgs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Org-prefixed storage policies

**Files:**
- Modify: `supabase-setup.sql` (storage policies near line 575-590)
- Modify: `tests/rls/storage.test.mjs`

**Interfaces:**
- Produces: storage policies requiring `(storage.foldername(name))[1] = public.current_org()::text` on select, insert and delete for bucket `attachments`. Client upload path (Task 7) is `${orgId}/${accountId}/${ts}-${file}`.

- [ ] **Step 1: Update the storage tests**

Every path `rls/...` in `tests/rls/storage.test.mjs` becomes `${ORG_A}/rls/...` (import `ORG_A`, `ORG_B` from fixtures). Change the test titled "any authenticated user CAN delete another user's attachment (documents finding F2)" to keep its behaviour within the org (both sessions are org A). Add:

```js
test("a user cannot upload under another org's prefix", async () => {
  const { error } = await sessions.user.storage.from("attachments").upload(`${ORG_B}/rls/cross.txt`, body(), { upsert: true });
  assert(error, "upload into org B's prefix should be refused");
});

test("a user cannot list or delete another org's files", async () => {
  await sessions.adminB.storage.from("attachments").upload(`${ORG_B}/rls/b-only.txt`, body(), { upsert: true });
  const { data } = await sessions.user.storage.from("attachments").list(`${ORG_B}/rls`);
  assert(!(data || []).some(f => f.name === "b-only.txt"), "LEAK: org A listed org B's file");
  await sessions.user.storage.from("attachments").remove([`${ORG_B}/rls/b-only.txt`]);
  const { data: still } = await sessions.adminB.storage.from("attachments").list(`${ORG_B}/rls`);
  assert((still || []).some(f => f.name === "b-only.txt"), "org A deleted org B's file");
});

test("a legacy path with no org prefix is invisible to everyone through the API", async () => {
  const { error } = await sessions.user.storage.from("attachments").upload("rls/legacy.txt", body(), { upsert: true });
  assert(error, "an upload outside the org prefix should be refused");
});
```

- [ ] **Step 2: Run to verify failure**

```powershell
node tests/rls/run.mjs
```

Expected: the three new storage cases FAIL (uploads succeed today).

- [ ] **Step 3: Rewrite the storage policies**

```sql
-- Org-prefixed: every object lives under <org_id>/<account_id>/<file>. The first path
-- segment must be the caller's org on read, upload and delete. The bucket stays PUBLIC,
-- as before: a bare GET on a URL someone already holds never touches these policies.
-- Pre-multitenant objects (no org prefix) are re-pathed by the migration block below.
drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and public.is_active()
         and (storage.foldername(name))[1] = public.current_org()::text);
drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and public.is_active()
              and (storage.foldername(name))[1] = public.current_org()::text);
drop policy if exists attachments_delete on storage.objects;
create policy attachments_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and public.is_active()
         and (storage.foldername(name))[1] = public.current_org()::text);

-- One-off re-path of legacy objects into the default org, and the matching rewrite of the
-- path/url stored in accounts.data->'attachments'. Idempotent: an object already under a
-- uuid prefix is skipped. Runs as the SQL-editor superuser, which the storage trigger that
-- blocks DELETE does not object to for UPDATE.
update storage.objects
   set name = '00000000-0000-0000-0000-000000000001/' || name
 where bucket_id = 'attachments'
   and (storage.foldername(name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
update public.accounts
   set data = jsonb_set(data, '{attachments}', (
     select jsonb_agg(
       case when (a ->> 'path') !~ '^[0-9a-f]{8}-' then
         a || jsonb_build_object(
           'path', '00000000-0000-0000-0000-000000000001/' || (a ->> 'path'),
           'url',  replace(a ->> 'url', '/attachments/' || (a ->> 'path'),
                           '/attachments/00000000-0000-0000-0000-000000000001/' || (a ->> 'path')))
       else a end)
     from jsonb_array_elements(data -> 'attachments') a))
 where jsonb_typeof(data -> 'attachments') = 'array'
   and exists (select 1 from jsonb_array_elements(data -> 'attachments') a where (a ->> 'path') !~ '^[0-9a-f]{8}-');
```

Check the attachment object shape in `crm.html` `uploadFiles` (`{ name, url, path }`) and the key under which they are stored on the account (grep `attachments` in crm.html around line 1100-1130) and use that key in the `jsonb_set` path if it is not `attachments`.

- [ ] **Step 4: Run the suite; storage green**

```powershell
node tests/rls/run.mjs
```

- [ ] **Step 5: Commit**

```powershell
git add supabase-setup.sql tests/rls/storage.test.mjs
git commit -m "Prefix attachments by org and scope storage policies

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Email alerts per org

**Files:**
- Modify: `email-alerts.sql` (config block lines 25-60; `alert_recipients`; `unrouted_csms`; `alert_renewals`; `alert_overdue_tasks`; `alert_qbr_nudge`; `send_alerts`)
- Modify: `tests/rls/emailalerts.test.mjs`

**Interfaces:**
- Produces: `org_alert_prefs(org_id pk, enabled_kinds text[], health_drop_points int, health_drop_window_days int)`; `alert_recipients(p_org uuid)`, `unrouted_csms(p_org uuid)`, `alert_renewals(p_org uuid, p_csm text, p_include_unowned boolean)`, `alert_overdue_tasks(p_org uuid, ...)`, `alert_qbr_nudge(p_org uuid, ...)`; `send_alerts(p_kind text)` unchanged signature, loops orgs; `email_log.org_id`.

- [ ] **Step 1: Update the existing alert tests and add the two-org cases**

Every direct call in `emailalerts.test.mjs` to `alert_recipients()`, `unrouted_csms()`, `alert_renewals(...)`, `alert_overdue_tasks(...)`, `alert_qbr_nudge(...)` gains `'${ORG_A}'::uuid` as the first argument. Add:

```js
test("alert builders see only the org they are asked about", async () => {
  const due = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  await seedAccount("ren-a", { name: "Renew A", csm: "Admin User", renewalDate: due, contractStatus: "Active" }, ORG_A);
  await seedAccount("ren-b", { name: "Renew B", csm: "Admin B",    renewalDate: due, contractStatus: "Active" }, ORG_B);
  const a = await sql(`select account_id from alert_renewals($1, 'Admin User', true)`, [ORG_A]);
  const b = await sql(`select account_id from alert_renewals($1, 'Admin B', true)`, [ORG_B]);
  assert(a.some(r => r.account_id === "ren-a") && !a.some(r => r.account_id === "ren-b"), `org A builder returned ${JSON.stringify(a)}`);
  assert(b.some(r => r.account_id === "ren-b") && !b.some(r => r.account_id === "ren-a"), `org B builder returned ${JSON.stringify(b)}`);
});

test("alert_recipients is per org", async () => {
  const a = await sql(`select email from alert_recipients($1)`, [ORG_A]);
  const b = await sql(`select email from alert_recipients($1)`, [ORG_B]);
  assert(a.some(r => r.email === "user@test.local") && !a.some(r => r.email === "userb@test.local"), "org A recipients leak");
  assert(b.some(r => r.email === "userb@test.local") && !b.some(r => r.email === "user@test.local"), "org B recipients leak");
});

test("send_alerts logs one row per recipient per org and honours per-org enabled_kinds", async () => {
  await sql(`update alert_config set api_key = 'test-key', from_email = 'noreply@onevio.test' where id = 1`);
  await sql(`update org_alert_prefs set enabled_kinds = array['overdue_tasks'] where org_id = $1`, [ORG_B]);
  await sql(`delete from email_log where kind = 'renewals'`);
  const [{ send_alerts: result }] = await sql(`select send_alerts('renewals')`);
  const rows = await sql(`select recipient, org_id from email_log where kind = 'renewals' and day = current_date`);
  assert(rows.some(r => r.org_id === ORG_A), `org A got no renewals digest: ${result}`);
  assert(!rows.some(r => r.org_id === ORG_B), "org B has renewals disabled but was mailed");
  await sql(`update org_alert_prefs set enabled_kinds = array['renewals','overdue_tasks','qbr_nudge'] where org_id = $1`, [ORG_B]);
});
```

Check how the existing file stubs `alert_post` (pg_net is absent locally) and reuse that stub in the third test so `send_alerts` does not fail on the HTTP call; if the file already replaces `alert_post` with a recording stub, keep using it.

- [ ] **Step 2: Run to verify failure**

```powershell
node tests/rls/run.mjs
```

Expected: FAIL with `function alert_renewals(uuid, text, boolean) does not exist` and similar.

- [ ] **Step 3: Change `email-alerts.sql`**

After the `alert_config` block add:

```sql
-- ---------- per-org preferences ----------
-- The Brevo key and sender above are PLATFORM config: one sender mails on every client's
-- behalf. What each org may choose is which digests it gets and the health-drop sensitivity.
-- The three matching columns still on alert_config are legacy and no longer read.
create table if not exists public.org_alert_prefs (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  enabled_kinds text[] not null default array['renewals','overdue_tasks','qbr_nudge'],
  health_drop_points int not null default 10,
  health_drop_window_days int not null default 7
);
alter table public.org_alert_prefs enable row level security;
drop policy if exists org_alert_prefs_select on public.org_alert_prefs;
create policy org_alert_prefs_select on public.org_alert_prefs for select to authenticated
  using (public.is_active() and org_id = public.current_org());
drop policy if exists org_alert_prefs_update on public.org_alert_prefs;
create policy org_alert_prefs_update on public.org_alert_prefs for update to authenticated
  using (public.is_admin() and org_id = public.current_org())
  with check (public.is_admin() and org_id = public.current_org());
-- one row per existing org, copying the legacy values from alert_config row 1 the first time
insert into public.org_alert_prefs (org_id, enabled_kinds, health_drop_points, health_drop_window_days)
select o.id, c.enabled_kinds, c.health_drop_points, c.health_drop_window_days
  from public.orgs o cross join public.alert_config c
 where c.id = 1
on conflict (org_id) do nothing;

alter table public.email_log add column if not exists org_id uuid;
```

Add `p_org uuid` as the FIRST parameter of `alert_recipients`, `unrouted_csms`, `alert_renewals`, `alert_overdue_tasks`, `alert_qbr_nudge`. In each body add `and p.org_id = p_org` to every `profiles p` predicate and `and a.org_id = p_org` to every `accounts a` predicate (tasks and activities joins likewise: `t.org_id = p_org`, `act.org_id = p_org`). Because Postgres overloads by signature, `drop function if exists public.alert_recipients();` (and the four others with their old signatures) must precede each new `create or replace`, and the `revoke execute` lines must name the new signatures.

`send_alerts`: keep the config guard and the kind check; remove the `enabled_kinds` check against `cfg`; then wrap the recipient loop:

```sql
  for o in select p.org_id, p.enabled_kinds from org_alert_prefs p loop
    continue when not (p_kind = any(o.enabled_kinds));

    select string_agg(format('<li>%s — %s account(s)</li>', html_escape(csm), accounts), '')
      into unrouted from unrouted_csms(o.org_id);

    for r in select * from alert_recipients(o.org_id) loop
      ... existing body, with alert_renewals(o.org_id, r.person, r.admin) etc. ...
      insert into email_log (kind, recipient, row_count, org_id) values (p_kind, r.email, n_rows, o.org_id);
      ...
    end loop;
  end loop;
```

Declare `o record;`. The return text stays `format('%s: %s recipient(s) mailed', ...)` summed across orgs.

- [ ] **Step 4: Run the suite; alerts green**

```powershell
node tests/rls/run.mjs
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```powershell
git add email-alerts.sql tests/rls/emailalerts.test.mjs tests/rls/fixtures.mjs
git commit -m "Send alert digests per org with per-org preferences

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Migration test: a single-org database survives the new file

**Files:**
- Create: `tests/rls/migration.test.mjs`
- Modify: `tests/rls/run.mjs`

**Interfaces:**
- Consumes: `tests/rls/pre-multitenant-setup.sql` (Task 0), `resetStack`-style SQL from fixtures.

- [ ] **Step 1: Write the test**

```js
// Proves supabase-setup.sql migrates a database created by the PRE-multitenant file: rows,
// users and settings all land in the default org and nothing is lost. Runs LAST in run.mjs
// and rebuilds the stack itself, so it must not share fixtures state with earlier files.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, assert } from "../health/framework.mjs";
import { sql, bootstrap, ORG_A } from "./fixtures.mjs";

const OLD = readFileSync(fileURLToPath(new URL("./pre-multitenant-setup.sql", import.meta.url)), "utf8");
const NEW = readFileSync(fileURLToPath(new URL("../../supabase-setup.sql", import.meta.url)), "utf8");
const ALERTS = readFileSync(fileURLToPath(new URL("../../email-alerts.sql", import.meta.url)), "utf8");

test("migration: pre-multitenant data lands in the default org intact", async () => {
  await sql(`drop schema if exists public cascade; create schema public;
    grant usage, create on schema public to postgres, anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
    delete from auth.users;`);
  await sql(OLD);
  await sql(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
             values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                     'legacy@test.local', '', now(), '{"name":"Legacy Admin"}', now(), now())`);
  await sql(`insert into accounts (id, data) values ('old-1', '{"name":"Old One"}'), ('old-2', '{"name":"Old Two"}')`);
  await sql(`insert into tasks (id, data) values ('t-1', '{"title":"Old task"}')`);
  await sql(`insert into settings (id, data) values (1, '{"rates":{"INR":0.5}}')`);
  await sql(`insert into health_snapshots (account_id, day, score) values ('old-1', current_date, 70)`);

  await sql(NEW);
  await sql(ALERTS);

  const accts = await sql(`select org_id, id from accounts order by id`);
  assert(accts.length === 2 && accts.every(r => r.org_id === ORG_A), `accounts not stamped: ${JSON.stringify(accts)}`);
  const [task] = await sql(`select org_id from tasks where id = 't-1'`);
  assert(task.org_id === ORG_A, "task not stamped");
  const [settings] = await sql(`select org_id, data from settings`);
  assert(settings.org_id === ORG_A && settings.data.rates.INR === 0.5, `settings lost: ${JSON.stringify(settings)}`);
  const [hs] = await sql(`select org_id from health_snapshots where account_id = 'old-1'`);
  assert(hs.org_id === ORG_A, "health snapshot not stamped");
  const [prof] = await sql(`select org_id, role, platform_admin from profiles where id = '11111111-1111-1111-1111-111111111111'`);
  assert(prof.org_id === ORG_A && prof.role === "admin", `legacy admin lost: ${JSON.stringify(prof)}`);
  const pk = await sql(`select array_length(conkey, 1) as n from pg_constraint where conrelid = 'public.accounts'::regclass and contype = 'p'`);
  assert(pk[0].n === 2, "accounts primary key was not swapped to (org_id, id)");
  const prefs = await sql(`select 1 from org_alert_prefs where org_id = $1`, [ORG_A]);
  assert(prefs.length === 1, "default org has no alert prefs after migration");

  // second run is a no-op
  await sql(NEW);
  const again = await sql(`select count(*)::int as n from accounts`);
  assert(again[0].n === 2, "re-running the file changed row counts");

  await bootstrap();   // leave the stack in the normal fixture state
});
```

Note: the legacy `auth.users` insert fires the OLD `handle_new_user`, which makes the first profile an admin. That is the point: the migration must keep that role.

- [ ] **Step 2: Add `import "./migration.test.mjs";` as the LAST import in `tests/rls/run.mjs`**

- [ ] **Step 3: Run the suite**

```powershell
node tests/rls/run.mjs
```

Expected: PASS. If the profiles backfill stamps nothing, re-read the two `update public.profiles` statements in Task 1 Step 4: with no client org yet, the second statement is the one that applies.

- [ ] **Step 4: Commit**

```powershell
git add tests/rls/migration.test.mjs tests/rls/run.mjs
git commit -m "Prove the setup file migrates a single-org database

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Client: org-aware load, profile, uploads, invites, sidebar

**Files:**
- Modify: `crm.html` (`fetchAll` ~line 414; `uploadFiles` ~line 1060; `UsersCard.addUser` ~line 3656; sidebar footer ~line 4126; `Root` ~line 4203)
- Modify: `tests/health/harness.mjs` (MOCK profile and `orgs` table, rpc branches)
- Create: `tests/health/orgs.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Produces: module-level `let CURRENT_ORG = null;` set in `Root` when the profile loads; `Root` fetches `id,name,role,disabled,org_id,platform_admin`; `App` receives `user` with those fields; sidebar shows `user.orgName` when `user.platform_admin`.
- Consumes: `invite_user`, `orgs_select`.

- [ ] **Step 1: Extend the health mock**

In `tests/health/harness.mjs` MOCK:
- default profile becomes `{ id: "u1", name: "Test User", role: "admin", org_id: "org-a", platform_admin: false }`;
- `fromImpl`: add `t === "orgs" ? orgsApi()` where

```js
  const orgsApi = () => ({
    select: () => {
      const rows = window.__seedRows?.orgs || [{ id: "org-a", name: "Acme Corp" }];
      const p = Promise.resolve({ data: rows, error: null });
      p.eq = (_c, val) => ({ single: async () => ({ data: rows.find(r => r.id === val) || null, error: null }) });
      return p;
    },
  });
```

- `rpc`: add

```js
      if (fn === "list_orgs") return Promise.resolve({ data: window.__seedOrgs || [], error: null });
      if (fn === "create_org") return Promise.resolve({ data: "org-new", error: null });
      if (fn === "switch_org" || fn === "invite_user") return Promise.resolve({ data: null, error: null });
```

Also add `orgs: []` handling: `seedRows.orgs` optional. Keep `__rpcCalls` recording (already there).

- [ ] **Step 2: Write the health tests**

Create `tests/health/orgs.test.mjs`:

```js
import { test, assert } from "./framework.mjs";
import { launch, rootText } from "./harness.mjs";

const empty = `window.__seedRows = { accounts: [], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("a signed-in user with no org sees the no-workspace screen, not the app", async () => {
  const { page, browser } = await launch(`${empty} window.__seedProfile = { id: "u1", name: "Nobody", role: "user", org_id: null, platform_admin: false };`);
  const txt = await rootText(page);
  assert(/not attached to a workspace/i.test(txt), "no-workspace message missing");
  assert(!/Dashboard/.test(txt), "the app rendered for an org-less user");
  assert(await page.$("text=Sign out"), "sign-out button missing");
  await browser.close();
});

test("a platform admin sees the current org name in the sidebar; a normal user does not", async () => {
  const seedOrgs = `window.__seedRows.orgs = [{ id: "org-a", name: "Acme Corp" }];`;
  const { page, browser } = await launch(`${empty} ${seedOrgs} window.__seedProfile = { id: "u1", name: "Owner", role: "admin", org_id: "org-a", platform_admin: true };`);
  await page.waitForSelector("[data-current-org]");
  assert((await page.textContent("[data-current-org]")).includes("Acme Corp"), "org name not shown for platform admin");
  await browser.close();
  const plain = await launch(`${empty} ${seedOrgs} window.__seedProfile = { id: "u1", name: "Plain", role: "user", org_id: "org-a", platform_admin: false };`);
  await plain.page.waitForSelector("#root");
  assert(!(await plain.page.$("[data-current-org]")), "org name badge shown to a normal user");
  await plain.browser.close();
});

test("adding a user invites them before signing them up", async () => {
  const { page, browser } = await launch(`${empty} window.__seedUsers = [{ id: "u1", name: "Test User", role: "admin", disabled: false, email: "t@t.io" }];`);
  await page.click('button[title="Settings"]');
  await page.fill('input[placeholder="Name"]', "New Person");
  await page.fill('input[placeholder="Email"]', "new@example.com");
  await page.fill('input[placeholder="Temporary password"]', "secret12");
  await page.click("text=Add user");
  await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "invite_user"));
  const calls = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "invite_user"));
  assert(calls[0].args.p_email === "new@example.com" && calls[0].args.p_role === "user", `invite args ${JSON.stringify(calls[0].args)}`);
  await browser.close();
});
```

Check the actual placeholders on the add-user inputs in `UsersCard` (grep `placeholder=` near line 3700) and the Settings nav title, and use those exact strings. The real `supabase.createClient(...).auth.signUp` in the mocked page will reject (no network); the test only asserts the invite call, which happens first.

Add `import "./orgs.test.mjs";` to `tests/health/run.mjs`.

- [ ] **Step 3: Run to verify failure**

```powershell
node build.mjs; node tests/health/run-one.mjs orgs
```

(Check `run-one.mjs` for its argument form; it may take the file name.) Expected: all three FAIL.

- [ ] **Step 4: Change `crm.html`**

a. Near `const uid = ...` at the top of the app script add:

```js
// The signed-in user's org, set by Root() once the profile loads. Only uploadFiles needs it
// on the client: every other org decision is made by RLS and the org-stamping RPCs.
let CURRENT_ORG = null;
```

b. `fetchAll`: `sb.from("settings").select("data").eq("id", 1)` becomes `sb.from("settings").select("data")`.

c. `uploadFiles`: `const path = \`${CURRENT_ORG}/${accountId}/${Date.now()}-...\`` and, before the loop, `if (!CURRENT_ORG) throw new Error("No workspace: cannot upload");`.

d. `UsersCard.addUser`: before creating the throwaway client:

```js
      // The invite is what attaches the sign-up to THIS org (handle_new_user matches it
      // by email). Sign-up without it would create an org-less user who sees nothing.
      const { error: invErr } = await sb.rpc("invite_user", { p_email: v.email.trim(), p_role: v.role });
      if (invErr) throw invErr;
```

and delete the `if (v.role === "admin" && data.user) { ... update role ... }` block: the invite carries the role.

e. `Root`: select `"id,name,role,disabled,org_id,platform_admin"`; in the `.then`, `CURRENT_ORG = data.org_id;` before `setProfile(data)`. After the disabled gate add:

```jsx
  // Sign-ups that matched no invite land here. RLS already returns them nothing; this
  // says why instead of rendering an empty app.
  if (!profile.org_id) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-slate-600">
      <p className="font-semibold text-slate-900">Your account is not attached to a workspace yet.</p>
      <p>Ask your administrator to invite {profile.name ? "you" : "this email"}.</p>
      <button className="nm-btn px-3 py-1.5 text-xs font-semibold" onClick={() => sb.auth.signOut()}>Sign out</button>
    </div>
  );
```

f. Sidebar footer (inside `App`, the `{!collapsed && <>...</>}` block): add an org badge for platform admins. Add near the top of `App`:

```js
  const [orgName, setOrgName] = useState("");
  useEffect(() => {
    if (!user.platform_admin || !user.org_id) return;
    sb.from("orgs").select("name").eq("id", user.org_id).single().then(({ data }) => data && setOrgName(data.name));
  }, [user.org_id, user.platform_admin]);
```

and in the footer, before the name line:

```jsx
            {user.platform_admin && <div data-current-org className="mb-1 truncate rounded bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-700" title="You are viewing this workspace as platform admin">{orgName || "…"}</div>}
```

- [ ] **Step 5: Build and run the health suite**

```powershell
node tests/health/run.mjs
```

Expected: all PASS including the three new cases. If an existing test breaks on the profile shape, extend its seed profile rather than weakening the assertion.

- [ ] **Step 6: Commit**

```powershell
git add crm.html tests/health
git commit -m "Make the client org-aware: invites, org-prefixed uploads, no-workspace screen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Client: Platform card (create client, switch org)

**Files:**
- Modify: `crm.html` (new `PlatformCard` component next to `UsersCard`; render in `Settings` before `<UsersCard>`)
- Modify: `tests/health/orgs.test.mjs`

**Interfaces:**
- Consumes: `list_orgs`, `create_org`, `switch_org`, the throwaway sign-up pattern from `UsersCard.addUser`, `authRedirect()`.

- [ ] **Step 1: Add the tests**

Append to `tests/health/orgs.test.mjs`:

```js
const seedPlatform = `${empty}
  window.__seedRows.orgs = [{ id: "org-a", name: "Acme Corp" }];
  window.__seedOrgs = [{ id: "org-a", name: "Acme Corp", created_at: "2026-01-01", users: 3 }, { id: "org-b", name: "Beta Ltd", created_at: "2026-02-01", users: 1 }];
  window.__seedProfile = { id: "u1", name: "Owner", role: "admin", org_id: "org-a", platform_admin: true };`;

test("the Platform card lists orgs for a platform admin and is absent for an org admin", async () => {
  const { page, browser } = await launch(seedPlatform);
  await page.click('button[title="Settings"]');
  await page.waitForSelector("[data-platform-card]");
  const txt = await page.textContent("[data-platform-card]");
  assert(/Acme Corp/.test(txt) && /Beta Ltd/.test(txt), "orgs not listed");
  assert(/3 user/.test(txt), "user count missing");
  await browser.close();
  const admin = await launch(`${empty} window.__seedProfile = { id: "u1", name: "Admin", role: "admin", org_id: "org-a", platform_admin: false };`);
  await admin.page.click('button[title="Settings"]');
  assert(!(await admin.page.$("[data-platform-card]")), "Platform card rendered for a non-platform admin");
  await admin.browser.close();
});

test("New client calls create_org with the name and admin email", async () => {
  const { page, browser } = await launch(seedPlatform);
  await page.click('button[title="Settings"]');
  await page.fill('[data-platform-card] input[placeholder="Client name"]', "Gamma Inc");
  await page.fill('[data-platform-card] input[placeholder="Admin name"]', "Gina");
  await page.fill('[data-platform-card] input[placeholder="Admin email"]', "gina@gamma.com");
  await page.fill('[data-platform-card] input[placeholder="Temporary password"]', "secret12");
  await page.click("[data-platform-card] >> text=Create client");
  await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "create_org"));
  const [call] = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "create_org"));
  assert(call.args.p_name === "Gamma Inc" && call.args.p_admin_email === "gina@gamma.com", JSON.stringify(call.args));
  await browser.close();
});

test("Switch into calls switch_org with that org", async () => {
  const { page, browser } = await launch(seedPlatform);
  await page.click('button[title="Settings"]');
  await page.evaluate(() => { window.__reloads = 0; window.__reload = () => window.__reloads++; });
  await page.click('[data-platform-card] button[data-switch-org="org-b"]');
  await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "switch_org"));
  const [call] = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "switch_org"));
  assert(call.args.p_org_id === "org-b", JSON.stringify(call.args));
  await browser.close();
});
```

- [ ] **Step 2: Run to verify failure**

```powershell
node build.mjs; node tests/health/run-one.mjs orgs
```

- [ ] **Step 3: Implement `PlatformCard`**

Add before `function UsersCard`:

```jsx
/* Platform admin only: the list of client orgs, a "new client" form and "switch into".
   Switching is a full reload on purpose: the store, realtime channels and every memo in
   App are built for one org; re-deriving them in place is more code than it is worth. */
function PlatformCard({ me }) {
  const [orgs, setOrgs] = useState([]);
  const [v, setV] = useState({ name: "", adminName: "", email: "", pass: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const load = () => sb.rpc("list_orgs").then(({ data, error }) => error ? setErr(error.message) : setOrgs(data || []));
  useEffect(() => { load(); }, []);
  const createClient = async e => {
    e.preventDefault(); setErr(""); setMsg("");
    if (!v.name.trim() || !v.adminName.trim() || !v.email.trim()) return setErr("Client name, admin name and admin email are required.");
    if (v.pass.length < 6) return setErr("Temporary password must be at least 6 characters.");
    setBusy(true);
    try {
      const { error } = await sb.rpc("create_org", { p_name: v.name.trim(), p_admin_email: v.email.trim() });
      if (error) throw error;
      // Same throwaway-client sign-up as UsersCard: creating the admin must not replace
      // our own session. create_org left an admin invite, so handle_new_user attaches
      // this sign-up to the new org.
      const tmp = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: e2 } = await tmp.auth.signUp({ email: v.email.trim(), password: v.pass, options: { data: { name: v.adminName.trim() }, emailRedirectTo: authRedirect() } });
      if (e2) throw e2;
      setMsg(`${v.name.trim()} created. ${v.adminName.trim()} is its admin — share the email and temporary password with them.`);
      setV({ name: "", adminName: "", email: "", pass: "" });
      load();
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };
  const switchTo = async o => {
    setErr("");
    const { error } = await sb.rpc("switch_org", { p_org_id: o.id });
    if (error) return setErr(error.message);
    (window.__reload || (() => location.reload()))();
  };
  return (
    <Card title={`Platform · clients (${orgs.length})`}>
      <div data-platform-card>
        {orgs.map(o => (
          <div key={o.id} className="flex items-center gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0">
            <span className="flex-1">
              <div>{o.name}{o.id === me.org_id && <span className="text-xs text-slate-500"> (current)</span>}</div>
              <div className="text-xs text-slate-500">{o.users} user{o.users === 1 ? "" : "s"} · since {String(o.created_at).slice(0, 10)}</div>
            </span>
            {o.id !== me.org_id && <button data-switch-org={o.id} className="text-xs font-bold text-indigo-600 hover:underline" onClick={() => switchTo(o)}>Switch into</button>}
          </div>
        ))}
        <form onSubmit={createClient} className="mt-3 grid gap-2 sm:grid-cols-2">
          <Input placeholder="Client name" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} />
          <Input placeholder="Admin name" value={v.adminName} onChange={e => setV({ ...v, adminName: e.target.value })} />
          <Input type="email" placeholder="Admin email" value={v.email} onChange={e => setV({ ...v, email: e.target.value })} />
          <Input type="password" placeholder="Temporary password" value={v.pass} onChange={e => setV({ ...v, pass: e.target.value })} />
          <div className="sm:col-span-2"><Btn kind="primary" type="submit" disabled={busy}>{busy ? "…" : "Create client"}</Btn></div>
        </form>
        {err && <div className="mt-2 text-xs text-rose-600">{err}</div>}
        {msg && <div className="mt-2 text-xs text-emerald-700">{msg}</div>}
        <p className="mt-2 text-xs text-slate-500">Each client is a separate workspace: its users see only its accounts. Switch into a client to work as its admin; switch back here when done.</p>
      </div>
    </Card>
  );
}
```

Check `Btn` accepts `type` and `disabled` (grep `function Btn`); if not, use a plain `<button className="nm-btn ...">`. In `Settings`, before `<UsersCard me={user} />` add `{user.platform_admin && <PlatformCard me={user} />}`.

- [ ] **Step 4: Run the full health suite**

```powershell
node tests/health/run.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add crm.html tests/health/orgs.test.mjs
git commit -m "Add the Platform card: create clients and switch between orgs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Docs, spec status, PR

**Files:**
- Modify: `TEAM-SETUP.md`
- Modify: `docs/superpowers/specs/2026-09-18-multi-tenant-orgs-design.md` (Status line)

- [ ] **Step 1: Document onboarding in `TEAM-SETUP.md`**

Add a section:

```markdown
## Clients (multi-tenant)

OneVio hosts several client companies in one install. Each client is an **org**; users belong to exactly one org and see only its data.

**First-time upgrade of an existing install**
1. Open `supabase-setup.sql`, set the two `EDIT ME` lines at the top: your company name (the default org, which receives all existing data) and, further down in the platform-admin block, nothing else is needed.
2. Run `supabase-setup.sql`, then `email-alerts.sql`, in the SQL editor. Both are safe to re-run.
3. Make yourself platform admin (one time, SQL editor):
   `update public.profiles set platform_admin = true where id = (select id from auth.users where email = 'you@yourcompany.com');`

**Onboarding a client**
Settings → Platform → fill in client name, the admin's name, email and a temporary password → Create client. Share the credentials. That admin adds their own team from Settings → Users. Switch into a client from the same card to see what they see; the amber badge in the sidebar shows which org you are in.

**Alert preferences per client** are rows in `public.org_alert_prefs` (which digests, health-drop sensitivity); edit them in the SQL editor for now.
```

Remove any sentence in `TEAM-SETUP.md` that says the first sign-up becomes admin.

- [ ] **Step 2: Set the spec status** to `Status: implemented (PR pending)`.

- [ ] **Step 3: Run both suites one final time and record the counts**

```powershell
node build.mjs
node tests/health/run.mjs
node tests/rls/run.mjs
```

Both must exit 0.

- [ ] **Step 4: Commit and open the PR**

```powershell
git add TEAM-SETUP.md docs/superpowers/specs/2026-09-18-multi-tenant-orgs-design.md
git commit -m "Document client onboarding and the platform admin

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feature/multi-tenant-orgs
```

Write the PR body to `pr-multitenant.md` (the repo's existing pattern for `gh pr create --body-file`, see `pr-rls.md`), covering: what changes for existing users (nothing visible), the rollout steps from the spec, and the two EDIT ME literals. End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Then:

```powershell
gh pr create --title "Host several client orgs in one install" --body-file pr-multitenant.md
```

Then use `superpowers:finishing-a-development-branch`.

---

## Self-review notes

- **Spec coverage.** Schema (T1), policies and RPCs (T2, T3), storage (T4), alerts (T5), migration test (T6), client load/profile/invite/uploads/sidebar (T7), platform card (T8), docs and rollout (T9). Spec items amended after planning: `settings` keyed by `org_id` alone (no serial id); the sidebar reads `orgs` under an `orgs_select` policy instead of a `my_org_name()` RPC; the migration lives inside `supabase-setup.sql` (the repo's convention) rather than a separate file; there is no alert-preferences UI today, so per-org prefs are SQL-edited for now. The spec has been updated to match.
- **Order dependency.** Task 1's fixtures reference `org_alert_prefs`, which Task 5 creates, hence the guarded `do $$` insert. Task 3's `create_org` guards the same way.
- **Health-suite limits.** The mocked suite cannot exercise the real sign-up; the invite → org attachment is proven in `tests/rls/auth.test.mjs`.
