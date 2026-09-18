# Multi-tenant orgs: onboarding clients into one OneVio install

Date: 2026-09-18
Status: approved design, not yet planned

## Problem

OneVio is a single-company CRM. One Supabase project, one `settings` row (id = 1), five
JSON-row entity tables, and row-level security (RLS) that gates every table on "is a
signed-in, non-disabled user". Every user sees every row. The owner now wants to onboard
several client companies into the same install, each with its own logins and data, with
the owner creating each client from inside the app.

## Decisions

Taken during brainstorming; recorded so they are not silently revisited.

1. **Shared project, tenant column.** One Supabase project, one deployed app, an `org_id`
   on every data row, RLS isolates by org. Not separate projects, not a schema per client.
2. **Org lives on the profile.** `profiles.org_id` is the single source of "which org is
   this request for". A helper `current_org()` reads it. Not a JWT claim (needs the
   service-role key and re-issued tokens), not a memberships table (one user, one org is
   the actual requirement).
3. **Onboarding is invite-based.** The owner creates the org and its first admin invite
   from a platform screen. That admin adds their own team through the existing Users
   screen. The sign-up trigger attaches a new user to an org only when a pending invite
   matches their email. Public sign-up with no invite yields a profile with no org, which
   sees nothing. The "first user ever becomes admin" rule is removed.
4. **Platform admin can switch into any org.** A `platform_admin` flag on the profile
   and a `switch_org` RPC that updates the caller's own `org_id`. Inside an org the app
   behaves exactly as that org's admin would see it.
5. **Existing data becomes the first org.** The migration creates a default org and
   stamps every existing row and user with it. Nothing visible changes for current users.
6. **Sending credentials stay global, alert preferences go per org.** One Brevo key and
   sender for the platform; enabled kinds and health-drop thresholds per org.

## Schema

### New tables

```sql
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table invites (
  email text not null,            -- lower(trim(...)) at insert
  org_id uuid not null references orgs(id) on delete cascade,
  role text not null check (role in ('admin','user')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (email, org_id)
);

create table org_alert_prefs (
  org_id uuid primary key references orgs(id) on delete cascade,
  enabled_kinds text[] not null default array['renewals','overdue_tasks','qbr_nudge'],
  health_drop_points int not null default 10,
  health_drop_window_days int not null default 7
);
```

### Changed tables

| Table | Change |
|---|---|
| `profiles` | add `org_id uuid null references orgs(id)`, `platform_admin boolean not null default false` |
| `accounts`, `contacts`, `activities`, `tasks`, `opportunities` | add `org_id uuid not null references orgs(id)`; primary key becomes `(org_id, id)` |
| `settings` | drop the `id = 1` check; add `org_id uuid not null unique references orgs(id)`; `id` becomes a plain serial |
| `health_snapshots` | add `org_id uuid not null`; primary key becomes `(org_id, account_id, day)` |
| `alert_config` | keep `api_key`, `from_email`, `from_name`, `api_base` in row 1; the three preference columns are left in place but ignored (dropping them would break the idempotent re-run of email-alerts.sql) |
| `email_log` | add `org_id uuid null` for filtering only |
| `error_log` | unchanged, global |

Composite keys matter: entity ids are 8-character random strings from `uid()` in the
browser, and the demo seed uses ids like `a1`. Two orgs seeded with the demo would
collide on a global primary key.

### Migration (`supabase-multitenant.sql`, idempotent)

1. Create the three new tables.
2. Insert the default org if `orgs` is empty, name taken from an `-- EDIT ME` literal.
3. Add the columns above as nullable, `update ... set org_id = <default>` where null, then
   set `not null` and swap the primary keys.
4. Move `settings` row 1 onto the default org.
5. Insert an `org_alert_prefs` row for the default org copied from `alert_config` row 1.
6. Set `platform_admin = true` on the profile whose `auth.users.email` equals an
   `-- EDIT ME` literal. Stamp every existing profile with the default org.
7. Replace all policies, functions and triggers listed below.
8. Storage: a one-off `update storage.objects set name = <default>/<name>` for objects
   not already under an org prefix, and a matching rewrite of `attachments[].path` and
   `attachments[].url` inside `accounts.data`.

`supabase-setup.sql` and `email-alerts.sql` are updated so a fresh install produces the
same end state; the migration file exists for the live database.

## Security model

### Helpers

```sql
current_org()        -- select org_id from profiles where id = auth.uid()   (definer, stable)
is_active()          -- unchanged, plus `org_id is not null`
is_admin()           -- unchanged: admin of MY org
is_platform_admin()  -- platform_admin and not disabled
```

### Policies

Every existing `using (public.is_active())` becomes
`using (public.is_active() and org_id = public.current_org())`. Every insert and update
`with check` adds `org_id = public.current_org()`, so a client cannot write into another
org even by naming its id. This applies to the five entity tables, `settings`,
`health_snapshots`, and `storage.objects` (first path segment of `name` must equal
`current_org()::text`).

`profiles`: select stays "active users see profiles", now filtered to the same org, plus
own row. `profiles_update_admin` gains `with check (org_id = current_org())`. A new
trigger `guard_profile_org` rejects any change to `org_id` or `platform_admin` unless the
caller is a platform admin. `guard_admin_count` counts admins **within the row's org**.

`invites`: select and insert for org admins in their own org; `org_id` must equal
`current_org()`. No update or delete from the browser; `handle_new_user` marks
acceptance as definer.

`orgs`: select for platform admins, plus a `my_org_name()` helper so the header can show
the org name without opening the table to everyone.

`org_alert_prefs`: select for active users of that org, update for org admins.

`alert_config` keeps RLS on with no policies.

### RPCs

| Function | Who | Does |
|---|---|---|
| `merge_row`, `replace_all` | unchanged callers, security invoker | stamp `current_org()` on every row and the settings upsert; `replace_all` deletes `where org_id = current_org()` only |
| `record_health` | unchanged | stamps org; the "account exists" check is org-scoped |
| `admin_user_list`, `admin_set_user_email` | org admin | filtered to `current_org()` |
| `invite_user(p_email, p_role)` | org admin | inserts an invite for the caller's org |
| `create_org(p_name, p_admin_email)` | platform admin | creates the org, its `org_alert_prefs` row, an empty `settings` row, and an admin invite |
| `switch_org(p_org_id)` | platform admin | sets the caller's own `profiles.org_id` |
| `list_orgs()` | platform admin | orgs with user count and created_at |
| `alert_recipients(p_org)`, `unrouted_csms(p_org)` | internal, definer | org-filtered |

Every definer function asserts its own gate on entry, as the existing ones do; RLS does
not apply inside them.

### Sign-up trigger

`handle_new_user` looks up `invites where email = lower(new.email) and accepted_at is
null`, ordered by `created_at desc`, limit 1. Found: profile gets that org and role, the
invite is marked accepted. Not found: profile is created with `org_id null, role 'user'`.
The Users screen keeps calling the public sign-up endpoint with a throwaway client, but
now calls `invite_user` first.

## Email alerts

The four cron jobs and their schedule are unchanged. `send_alerts()` iterates
`select id from orgs` and runs today's body once per org: preferences from
`org_alert_prefs`, recipients and accounts filtered by that org, one admin digest per org
to that org's admins. `email_log` rows carry the org. A platform admin receives mail only
for the org their profile currently points at, under the same rules as any user there.

## Storage

Upload path becomes `${orgId}/${accountId}/${timestamp}-${name}`. The client learns its
org id from the profile fetch it already does at start-up. Read and insert policies on
`storage.objects` require the first path segment to equal `current_org()::text`. The
bucket stays public, the existing accepted trade-off; this change does not widen it.

## UI

- **Load and writes.** The load call drops `.eq("id", 1)` on `settings`. Nothing else
  changes: RLS returns only the current org's rows and the RPCs stamp the org.
- **Users screen.** `addUser` calls `invite_user` before sign-up. The list is org-scoped
  by `admin_user_list`. Help text updated.
- **Platform screen.** Rendered in Settings only when `platform_admin` is true. A list of
  orgs with user counts and a "Switch into" button each; a "New client" form with org
  name, first admin name, email and temporary password. Submit calls `create_org`, then
  the same throwaway sign-up used by the Users screen, so the admin exists immediately.
  Switching calls `switch_org`, then reloads the store.
- **Header.** When the signed-in user is a platform admin, the header shows the current
  org name from `my_org_name()`.
- **No-workspace screen.** A signed-in user whose profile has `org_id null` sees "Your
  account is not attached to a workspace yet. Ask your administrator." and a sign-out
  button, in place of "Loading profile…".
- **Alert preferences.** The existing alert-settings controls read and write
  `org_alert_prefs`.

## Testing

**tests/rls** (real local stack). Fixtures seed a platform admin by SQL, two orgs, and one
admin and one user per org. New tests:

- user A reads zero of org B's rows on all five entity tables, `settings`,
  `health_snapshots`, `org_alert_prefs`, `invites` and storage;
- insert or `merge_row` with a foreign `org_id` is rejected or lands in A's org only;
- a user cannot change their own `org_id` or `platform_admin`; an org admin cannot either;
- platform admin calls `switch_org` and then reads B's rows, and `replace_all` after a
  switch touches only B;
- sign-up with a pending invite lands in that org with that role and marks the invite
  accepted; sign-up without one has `org_id null` and reads nothing;
- per-org last-admin guard: demoting org B's only admin fails while org A has admins;
- `admin_user_list` never returns another org's users.

**tests/rls/emailalerts**: two orgs with renewals due, each org's recipients receive only
their own rows; each org's admin digest counts only that org.

**tests/health** (mocked): platform screen renders only for a platform admin and calls
`create_org` then sign-up; `addUser` calls `invite_user` before sign-up; no-workspace
screen for a null org; header shows the org name for a platform admin.

**Migration test** in tests/rls: apply the pre-change schema, seed rows and settings row
1, run the migration, assert every row and profile is on the default org, the settings
row survives, and the app's load query returns the same data as before.

## Rollout

1. Merge and deploy the app.
2. Run `supabase-multitenant.sql` in the SQL editor with the two `EDIT ME` literals filled.
3. Re-run `email-alerts.sql` (idempotent) to install the per-org `send_alerts`.
4. Sign in, confirm the header shows the default org, create the first client.

## Out of scope

Users in more than one org, per-org branding, per-org sending credentials, self-serve
sign-up, deleting an org.
