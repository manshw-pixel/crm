# Custom fields, admin-only ownership, and the Lead role — design

Date: 2026-10-13. Status: approved in conversation; ships as three PRs in the order below.

## Goal

1. Admins define extra account fields in Settings; they appear in Edit account for every account.
2. Only admins can assign an account's CSM owner (and Lead). A change records the date it took effect.
3. A new **lead** role: a Lead sees only the accounts where they are the assigned Lead.

## Decisions (from the user)

- Lead visibility is a **restriction**, enforced by the database, not a default view.
- **Finance access overrides** the Lead restriction: a Lead with `finance = true` sees all accounts.
- CSMs (`user` role) are unchanged: they still see every account in the org.
- On their accounts a Lead can do what a CSM can: log activity, add tasks, update health, edit details. A Lead cannot change CSM or Lead, create accounts, delete accounts, or open Settings.
- Custom field types: text, number, date, dropdown (admin-defined options), yes/no. No required flag.
- Custom fields show in Edit account, on the account page, and in CSV export. List columns are out of scope.
- CSM change records a "CSM since" date (defaults to today, admin-editable) and a timeline activity.

## PR 1 — Custom fields

**Definitions** live in the org `settings.data.customFields`: an ordered array of
`{ id, label, type: "text"|"number"|"date"|"select"|"bool", options?: string[], archived?: bool }`.
`id` is generated once (`cf_xxxx`) and never reused, so renaming a label keeps values attached.

**Values** live on the account: `account.data.custom = { [fieldId]: value }`. Writes go through the existing
`EDIT_ACCOUNT` / `merge_row` path, patching `custom` as a whole object (built from the current value plus the edit)
so one field's save cannot drop another's.

**Settings → Account fields** (admin only, new card in `24-settings.jsx`):
- Built-in fields listed read-only with a lock icon (Name, Tier, ARR, Currency, Industry, CSM owner, Lead, Start date, Renewal date, Contract status, Modules, Licenses, …).
- Custom fields below: add, rename, change type, edit dropdown options, move up/down, delete.
- Delete sets `archived: true` (hidden everywhere, values kept). An "Archived (n)" disclosure lets admins restore.
- Changing a field's type keeps stored values; values that don't fit the new type render as plain text and are blank in the editor.

**Edit account** (`13-forms.jsx`): a "Custom fields" section after the built-ins, one input per non-archived field
(text input, number input, date input, select with a blank option, checkbox). Hidden when there are no fields.

**Account page**: a compact "Details" row in the header card (same `Meta` style as Tier/Industry), showing only fields with a value.

**CSV export** (`17-csv.jsx`): one column per non-archived field, header = label. Import ignores these columns (out of scope).

Pure helpers in `src/lib/custom-fields.js` (normalize definitions, coerce/format a value per type, build the patch) with node unit tests.

## PR 2 — Admin-only CSM / Lead assignment and "CSM since"

**UI**: in Edit account, CSM owner (and Lead, once PR 3 lands) is disabled for non-admins, with a lock and
"Only admins can change this". When a non-admin creates an account, CSM is fixed to themselves.

Admins see a **CSM since** date input next to CSM owner, shown once the CSM value differs from the saved one;
defaults to today. Saving writes `csm`, `csmSince`, and appends an activity
"CSM changed from A to B by Admin" (from blank: "CSM set to B by Admin").
Header CSM tile sub-line: "since Oct 13, 2026" when `csmSince` is set.

**Database guard** (new trigger in `supabase-setup.sql`, `before insert or update on accounts`):
- Update by a non-admin where `data->>'csm'`, `data->>'csmSince'` or `data->>'leadId'` changes → raise.
- Insert by a non-admin: `csm` must be blank or the caller's profile name; `leadId` must be absent → else raise.
- Contexts with no `auth.uid()` (SQL editor, cron, service role) pass, matching the platform-admin guard's rule.
The client also strips these keys from non-admin patches so the normal path never trips the guard.

## PR 3 — Lead role

**Role**: `profiles.role` and `invites.role` check constraints widen to `('admin','user','lead')`; `invite_user` and the
admin user list accept and show it. Lead badge colour distinct from admin.

**Assignment**: accounts get `data.leadId` (profile id, not name). Edit account has a **Lead** select (admins only)
listing active profiles with role `lead`. Header shows "Lead: Name" in the facts row.

**Visibility predicate** — one SQL function so every policy says the same thing:

```sql
public.can_see_account(p_org uuid, p_account_id text) returns boolean
-- true when: caller is active in p_org AND (role <> 'lead' OR finance OR the account's data->>'leadId' = auth.uid()::text)
```

(`security definer`, `stable`; reads profiles + accounts so policies on child tables don't recurse through RLS.)

**Policies** (select, update, insert, delete) gain `and public.can_see_account(org_id, <account id>)`:
- `accounts` (id = `id`), `contacts` / `activities` / `tasks` / `opportunities` (`data->>'accountId'`),
- `health_snapshots`, `purchase_orders`, `po_schedule` (via PO's account), `invoices` (`account_id`),
- storage objects for account attachments, invoices and PO files (path → account).
Rows with no account (e.g. a task with no accountId) stay visible to a Lead only if they own it (`data->>'owner'` = their name); otherwise hidden.

**Back doors to close** (each gets a test):
- Every `security definer` function that returns account data (finance RPCs, touchpoints inbox, email-alert digests,
  renewal alerts) must apply `can_see_account` for lead callers or be admin/finance-only.
- Realtime: postgres_changes respects RLS for INSERT/UPDATE; DELETE payloads carry only the key — confirm no data leaks (known issue from multi-tenant work).
- Email alerts address the CSM by name; a Lead receives alerts only for their accounts.

**App**: Leads don't get Settings (already admin-only), get no "+ New account" button and no Delete. Dashboards, Renewals, Tasks
need no change — they compute from what the store holds, which RLS has already narrowed. "My book / All" is hidden for Leads.

## Testing

- Unit: custom-field helpers (coercion, patch merge, archive/restore), CSM-change activity text.
- E2E (Playwright harness): Settings add/rename/archive/restore; Edit account renders and saves each type; CSV export columns;
  CSM select locked for a user and open for an admin; CSM since + timeline entry; Lead sees only assigned accounts; Lead with finance sees all.
- RLS harness (real local Supabase, per `rls-anon-key-vacuity` lessons — assert presence, not just absence):
  non-admin CSM change rejected; Lead can't select/update another account or its children/invoices/files; lead+finance can;
  definer RPCs return nothing extra to a Lead.

## Rollout

Each PR adds SQL to `supabase-setup.sql` / `finance.sql`; after merge the user re-runs the changed SQL in Supabase
(idempotent, as in previous PRs). PR 1 needs no SQL. PR 3 is inert until an admin creates a Lead user.

## Out of scope

Custom-field list columns and filters, CSV import of custom fields, required fields, per-field permissions,
multiple Leads per account, CSM history list beyond timeline entries, restricting CSMs.
