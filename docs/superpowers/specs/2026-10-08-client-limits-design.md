# Client limits (max users / max accounts) — design

Date: 2026-10-08

## Goal
On the Clients console, the platform admin sets per-client thresholds:
- **Max users** — minimum 2, or Unlimited.
- **Max accounts** — minimum 5, or Unlimited.

Limits are a hard block enforced in Supabase, not only in the UI.

## Decisions (agreed with user)
- Reaching a limit is a **hard block**: the action is refused with
  `Your plan allows N users — contact OneVio to raise it.` (or `N accounts`).
- A limit may be set **below current usage**. Nothing is deleted or disabled; the client
  simply cannot add more until under the limit. The console shows usage in amber (e.g. `8 / 5`).
- Existing clients get `null` limits (Unlimited).
- Only the platform admin can set or change limits.

## Data
`orgs` gains:
- `max_users int null check (max_users is null or max_users >= 2)`
- `max_accounts int null check (max_accounts is null or max_accounts >= 5)`

`null` = Unlimited. Added via `alter table ... add column if not exists` (additive-only).

## Counting rules
- **Users:** profiles in the org with `not disabled`, plus pending (unaccepted) invites for the org.
- **Accounts:** all rows in `accounts` for the org, churned included.

## Enforcement
- `invite_user()`: after locking the org row (`select ... from orgs where id = ... for update`),
  count users; if `max_users` is not null and count >= max_users, raise the user-limit message.
- Re-enabling a disabled user (profiles `disabled` true→false) applies the same check in the
  existing profiles before-update trigger path.
- `create_org()` creates the org's first admin; the minimum of 2 guarantees it always fits.
- `accounts` gets a `before insert` trigger: lock the org row, count accounts; if
  `max_accounts` is not null and count >= max_accounts, raise the account-limit message.
  The org-row lock serialises concurrent inserts so they cannot both slip under the limit.
- **CSV import:** before writing, the app compares rows-to-add with room left
  (`max_accounts - current`) and refuses the whole import with the same message if it does not
  fit. The trigger remains the backstop.

## RPCs
- `create_org(p_name, p_admin_email, p_max_users int default null, p_max_accounts int default null)`.
  The old 2-arg signature is dropped/replaced so callers keep working through defaults.
- `set_org_limits(p_org uuid, p_max_users int, p_max_accounts int)` — platform admin only
  (`is_platform_admin()`), security definer; check constraints reject values below the minimums.
- `list_orgs()` additionally returns `max_users`, `max_accounts`, `user_count`, `account_count`.

## UI (Client console)
- **Create Client form:** "Max users" and "Max accounts" number inputs, each with an
  "Unlimited" checkbox (checked by default). Client-side validation: ≥2 and ≥5.
- **Client row:** `7 / 10 users · 42 / ∞ accounts`; a figure is amber when usage exceeds its limit.
  An "Edit limits" action opens the same two fields and calls `set_org_limits`.
- **Inside the CRM:** a blocked invite / account create / import shows the server message as a toast.

## Testing
- RLS/SQL tests (tests/rls): invite blocked at the limit (pending invites counted); disabled users
  not counted; re-enable blocked at the limit; account insert blocked at the limit; Unlimited never
  blocks; values below the minimums rejected; non-platform-admin cannot call `set_org_limits`;
  lowering below usage succeeds and leaves data intact. Each block test has a positive control
  (one below the limit succeeds).
- E2E tests: console create form sets limits; Edit limits updates them; over-limit renders amber;
  CSV import over the limit is refused with nothing written.

## Out of scope
Billing/plans, per-role limits, and email notifications about limits.
