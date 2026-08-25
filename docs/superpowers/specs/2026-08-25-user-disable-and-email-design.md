# Disabling users, and editing their name and email

Date: 2026-08-25
Status: implemented (PR #39)

## Problem

Settings → Users can add a user, rename one, and change their role. It cannot remove
someone's access, and it never shows their email address. Today the only way to revoke
access is the Supabase dashboard — which the card's own help text admits.

Renaming already works (`saveRename`, crm.html:3409), including propagation to account
`csm` and task `owner` fields. This design does not change it.

## Scope

1. An admin can **disable** a user, and re-enable them.
2. An admin can **see and edit** a user's email address.

Deleting users stays out of scope: disable is the reversible operation, and a delete would
orphan the `csm`/`owner` free-text references that `renameEverywhere` exists to maintain.

## Decisions

Taken during brainstorming; recorded so they are not silently revisited.

- **Disable is a real revocation**, not a bookkeeping flag. Existing sessions must stop
  working, not expire naturally. This is what forces the RLS change below.
- **Email is editable directly in `auth.users`**, accepting that GoTrue's confirmation
  flow is bypassed. The alternative — a confirm-change link — needs the GoTrue admin API
  and therefore a `service_role` secret, which a static bundle has nowhere safe to keep.

## Design

### 1. `profiles.disabled`

```sql
alter table public.profiles
  add column if not exists disabled boolean not null default false;
```

### 2. Enforcement is in the policies

```sql
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and not disabled) $$;
```

Every entity policy in `supabase-setup.sql` changes from `using (true)` to
`using (public.is_active())`, with the same predicate in each `with check`. `is_admin()`
gains `and not disabled`.

**`profiles_select` is the one deliberate exception:**

```sql
using (public.is_active() or id = auth.uid())
```

A disabled user must still be able to read *their own* profile row and nothing else.
Without the `or`, `Root()`'s `.single()` fetch (crm.html:3961) returns no row, errors, and
strands them on "Loading profile…" forever — the opposite of the clean sign-out in §3.
With it, they read one row, see `disabled = true`, and get ejected with a message.
`Root()`'s select must therefore include `disabled` alongside `id,name,role`.

`merge_row` needs no change: it is `security invoker` (deliberately — see the comment above
it in supabase-setup.sql), so the tightened policies apply to it automatically.

The three `attachments_*` storage policies (supabase-setup.sql:467-476) must be gated too.
They are separate from the entity-table loop and easy to miss; leaving them means a
disabled user can still read and upload files, which is access by any reasonable reading.

**`settings_select` and `health_snapshots_select` are gated as well** (added during
implementation, after review found both still `using (true)`). Neither is in the entity
loop, but both hold business data — scoring weights, currency rates, snapshots, segments,
and account health history — and neither has the product-level reason that justifies
`profiles_select`'s exception. The rule is the goal, not the loop: if a policy grants a
`authenticated` user access to business data, it is gated.

**`error_log_insert` is the deliberate exception in the other direction.** It stays
`with check (true)`. It is the most permissive policy in the file by design — a user who
cannot report an error is a user you never hear about — and a disabled user hitting an
error should still be able to report it. The table holds no business data and is
admin-read-only.

This is the whole point of the feature. A disabled user holding a valid JWT gets nothing
back from their next query. Anything weaker means "disabled" is a label the client is
trusted to honour, which it is not.

**This is not an additive change.** It rewrites live security policies, departing from
this repo's additive-only habit. See Rollout.

### 3. What disable does NOT do

GoTrue does not consult `profiles`, so a disabled user can still obtain a token by signing
in. They can do nothing with it, and `Root()` signs them out on sight with "your access has
been removed" — but the token is issued. Refusing issuance needs GoTrue's admin API and a
`service_role` secret.

Do not describe this feature as "cannot sign in" in UI copy. It is "has no access".

### 4. Guards, in the database

Extend the existing `guard_admin_count` trigger, which today watches only `role` and would
happily let an admin disable their way to zero admins:

- Disabling the last non-disabled admin is refused.
- Disabling yourself is refused (also enforced in the UI, but the trigger is the boundary).

### 5. Email: read and write

```sql
create or replace function public.admin_user_list()
returns table(id uuid, name text, role text, disabled boolean, email text)
language sql security definer set search_path = public, auth as $$ ... $$;

create or replace function public.admin_set_user_email(p_id uuid, p_email text)
returns void language plpgsql security definer set search_path = public, auth as $$ ... $$;
```

`admin_user_list()` replaces the card's `select id,name,role,created_at` — the address
lives in `auth.users`, which the browser cannot read, so the definer join is what makes
displaying it possible at all. Same pattern as `alert_recipients()` in email-alerts.sql.

`admin_set_user_email` asserts `is_admin()` itself (a definer function runs as its owner —
it must never rely on the caller's policies), validates format, and rejects an address
already in use. Both are `revoke execute ... from public` then granted to `authenticated`.

### 6. The identities risk

GoTrue stores an email inside `auth.identities.identity_data` as well as in
`auth.users.email`. If updating only `auth.users` leaves the identity stale, the user may
end up unable to sign in with *either* address — the "a typo locks them out" failure,
arriving without a typo.

This is not settled by reading. `tests/rls` runs real GoTrue, so the deciding test is:
change an email, then **actually sign in with the new address and confirm the old one
fails**. If identities need updating too, `admin_set_user_email` updates both. Treat this
test as the feature, not as coverage of it.

**RESOLVED (CI run 32829044090, 2026-08-25).** `admin_set_user_email` updates both
`auth.users.email` and `auth.identities.identity_data->>'email'`, and against real GoTrue
the new address signs in while the old one is refused — `PASS after an email change the new
address signs in and the old one does not`. The dual update stands. Note what this run does
*not* establish: whether updating `auth.users` alone would have sufficed was never tested in
isolation, so do not "simplify" the identities update away on the theory that it is
redundant. It was written to prevent a lockout, and the passing test is evidence the pair
works, not that either half is unnecessary.

### 7. UI

In `UsersCard`, per row: the email beside the name, a `disable` / `enable` action next to
the existing role controls, and the ✎ editor extended to take email as well as name. A
disabled row renders muted with a `disabled` badge. Both destructive-ish actions
(`disable`, changing an email) route through the existing confirm dialog.

Disabled users are excluded from CSM/owner assignment dropdowns and from
`alert_recipients()`, so digests stop being sent to someone who has no access.

## Testing

RLS suite (`tests/rls`, real Postgres + GoTrue) is where this is proven:

- A disabled user reads nothing from every entity table — the assertion that the feature
  works at all. Per the RLS anon-key vacuity lesson (5 "passing" tests that proved nothing), assert on a session known to be valid first,
  so a broken client cannot masquerade as a working policy.
- A disabled admin fails `is_admin()`.
- Disabling the last admin is refused; disabling yourself is refused.
- Re-enabling restores access.
- Email change: new address signs in, old address does not (§6).
- A non-admin calling `admin_set_user_email` is refused.

Health suite: the card renders email, the disable control, and the disabled badge.

## Rollout

`supabase-setup.sql` is re-run in the Supabase SQL editor, as with every other change here.
Because the policy rewrite is not additive, the order matters: the `alter table` adding
`disabled` must run before the policies that reference `is_active()`, or every policy
briefly references a column that does not exist. The file is idempotent and ordered, so a
single top-to-bottom run is correct — but a partial run is not.

Existing users all default to `disabled = false`, so a correct run is a no-op for access.
The failure mode to watch for is the opposite of dangerous: if `is_active()` is wrong,
everyone loses access at once and it is immediately obvious.
