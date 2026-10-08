# Client Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The platform admin sets per-client limits (max users ≥2 or Unlimited, max accounts ≥5 or Unlimited) on the Clients console, and Supabase hard-blocks anything that would exceed them.

**Architecture:** Two nullable columns on `orgs` (null = Unlimited) with check constraints. Enforcement lives in SQL: `invite_user()` and a profiles re-enable trigger check a seat count; a `before insert` trigger on `accounts` checks the account count; `replace_all()` pre-checks its payload. Both counts lock the org row first, so concurrent writers serialise. The app pre-checks too (add-account form, CSV import), so users get a clean message instead of a rolled-back optimistic write. The console gets limit fields and a usage display.

**Tech Stack:** Postgres/Supabase SQL (`supabase-setup.sql`), React-in-JSX modules (`src/NN-*.jsx`, joined by `build.mjs`), pure ES modules in `src/lib` with `node:test`, Playwright health suite (`tests/health`), RLS suite against a local Supabase (`tests/rls`).

**Spec:** `docs/superpowers/specs/2026-10-08-client-limits-design.md`

## Global Constraints

- Work on a new branch `client-limits` from `origin/master`, in a worktree at `D:/AI Project/crm-client-limits`. Run `npm ci` inside the worktree. **Never junction or symlink `node_modules`** (this has wiped the main checkout's node_modules twice).
- SQL changes are additive and re-runnable: `add column if not exists`, `create or replace`, guarded `add constraint`. The user re-runs the whole `supabase-setup.sql` after merge.
- `null` means Unlimited. Minimums: `max_users >= 2`, `max_accounts >= 5`.
- Block messages, verbatim (used by SQL and the app): `Your plan allows N users — contact OneVio to raise it.` and `Your plan allows N accounts — contact OneVio to raise it.` (em dash U+2014).
- Seat count = profiles in the org with `not disabled and not platform_admin`, plus invites in the org with `accepted_at is null`.
- Account count = all rows in `accounts` for the org (churned included).
- Lowering a limit below usage is allowed. Nothing is deleted or disabled.
- Only the platform admin (`is_platform_admin()`) can set limits.
- `npm run build` must run before the health suite (it loads `dist/crm.html`).
- Every RLS absence/block assertion has a positive control on the same session (see memory "RLS anon-key vacuity"). Tests restore any limit they set in `finally`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Upsert of an existing account at the limit.** A `BEFORE INSERT` trigger fires on `insert ... on conflict do update`, which `merge_row` uses for EVERY edit. If the trigger doesn't skip existing ids, every edit is blocked once a client is at its limit. Pinned in Task 2.
2. **Re-sending an invite to an already-pending address at the limit.** This must still work (it doesn't add a seat). Pinned in Task 1.
3. **The platform admin switching into a client.** `switch_org` sets their `profiles.org_id`; they must not use up a client's seat. Pinned in Task 1.
4. **A CSV import that mixes updates and new rows.** Only the new rows count against room left, and a refused import writes nothing (not even the updates). Pinned in Task 5.
5. **An over-limit client restoring a backup via `replace_all`.** It fails with the plan message before anything is deleted, not with a half-replaced database. Pinned in Task 2.

---

### Task 1: Limit columns + seat enforcement (SQL)

**Files:**
- Modify: `supabase-setup.sql` — the orgs block (~line 22), the onboarding section (~line 839 onward: new helpers before `invite_user`, edits inside `invite_user`)
- Create: `tests/rls/limits.test.mjs`
- Modify: `tests/rls/run.mjs` (import the new file before `migration.test.mjs`)

**Interfaces:**
- Produces: `orgs.max_users int null`, `orgs.max_accounts int null`; constraints `orgs_max_users_min`, `orgs_max_accounts_min`; `public.org_seat_count(p_org uuid) returns int`; `public.assert_seat_available(p_org uuid) returns void` (raises the users message). Both are revoked from public/anon/authenticated.

- [ ] **Step 1: Write the failing RLS tests** in `tests/rls/limits.test.mjs`:

```js
// Client limits. Every block assertion has a positive control on the same session, and
// every test restores the org's limits in `finally` (tests/rls has no per-test reset).
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, ORG_B } from "./fixtures.mjs";

const USERS_MSG = /Your plan allows \d+ users — contact OneVio to raise it\./;
const setLimits = (org, u, a) => sql(`update public.orgs set max_users = $2, max_accounts = $3 where id = $1`, [org, u, a]);
const seats = async org => (await sql(`select public.org_seat_count($1) as n`, [org]))[0].n;
const addPending = (email, org) => sql(
  `insert into public.invites (email, org_id, role) values ($1, $2, 'user') on conflict do nothing`, [email, org]);
const dropInvites = () => sql(`delete from public.invites where email like 'lim-%@example.com'`);

// Fill org B's open seats with pending invites so seats == lim (lim >= 2).
async function atSeatLimit(org) {
  let n = await seats(org);
  for (let i = 0; n < 2; i++, n++) await addPending(`lim-fill${i}@example.com`, org);
  await setLimits(org, n, null);
  return n;
}

test("invite_user is blocked at max_users and allowed one below", async () => {
  try {
    const lim = await atSeatLimit(ORG_B);
    const blocked = await sessions.adminB.rpc("invite_user", { p_email: "lim-new@example.com", p_role: "user" });
    assert(blocked.error && USERS_MSG.test(blocked.error.message), `invite at the limit was not blocked: ${JSON.stringify(blocked)}`);
    assert(blocked.error.message.includes(`allows ${lim} users`), `wrong limit in message: ${blocked.error.message}`);
    await setLimits(ORG_B, lim + 1, null);
    const ok = await sessions.adminB.rpc("invite_user", { p_email: "lim-new@example.com", p_role: "user" });
    assert(!ok.error && ok.data === "invited", `control: invite below the limit failed: ${ok.error?.message}`);
  } finally { await setLimits(ORG_B, null, null); await dropInvites(); }
});

test("re-sending an already-pending invite at the limit still works", async () => {
  try {
    await addPending("lim-again@example.com", ORG_B);
    await atSeatLimit(ORG_B);
    const r = await sessions.adminB.rpc("invite_user", { p_email: "lim-again@example.com", p_role: "user" });
    assert(!r.error, `re-invite of a pending address was blocked: ${r.error?.message}`);
  } finally { await setLimits(ORG_B, null, null); await dropInvites(); }
});

test("disabled users and the platform admin do not use a seat", async () => {
  const before = await seats(ORG_B);
  const target = (await sql(`select id from profiles where org_id = $1 and role = 'user' and not disabled limit 1`, [ORG_B]))[0];
  assert(target, "precondition: org B has no enabled plain user");
  const plat = (await sql(`select id, org_id from profiles where platform_admin limit 1`))[0];
  assert(plat, "precondition: no platform admin");
  try {
    await sql(`update profiles set disabled = true where id = $1`, [target.id]);
    assert(await seats(ORG_B) === before - 1, "a disabled user still counts as a seat");
    await sql(`update profiles set org_id = $2 where id = $1`, [plat.id, ORG_B]);
    assert(await seats(ORG_B) === before - 1, "the platform admin counts as a seat in a client they switched into");
  } finally {
    await sql(`update profiles set org_id = $2 where id = $1`, [plat.id, plat.org_id]);
    await sql(`update profiles set disabled = false where id = $1`, [target.id]);
  }
});

test("re-enabling a user is blocked at max_users and allowed below", async () => {
  const target = (await sql(`select id from profiles where org_id = $1 and role = 'user' and not disabled limit 1`, [ORG_B]))[0];
  try {
    await sql(`update profiles set disabled = true where id = $1`, [target.id]);
    const lim = await atSeatLimit(ORG_B);
    const blocked = await sessions.adminB.from("profiles").update({ disabled: false }).eq("id", target.id).select("id");
    const still = (await sql(`select disabled from profiles where id = $1`, [target.id]))[0].disabled;
    assert(blocked.error && USERS_MSG.test(blocked.error.message), `re-enable at the limit not refused: ${JSON.stringify(blocked)}`);
    assert(still === true, "the user was re-enabled past the limit");
    await setLimits(ORG_B, lim + 1, null);
    const ok = await sessions.adminB.from("profiles").update({ disabled: false }).eq("id", target.id).select("id");
    assert(!ok.error && ok.data?.length === 1, `control: re-enable below the limit failed: ${ok.error?.message}`);
  } finally {
    await setLimits(ORG_B, null, null); await dropInvites();
    await sql(`update profiles set disabled = false where id = $1`, [target.id]);
  }
});

test("limits below the minimums are rejected by the table", async () => {
  let e1, e2;
  try { await setLimits(ORG_B, 1, null); } catch (e) { e1 = e; }
  try { await setLimits(ORG_B, null, 4); } catch (e) { e2 = e; }
  await setLimits(ORG_B, null, null);
  assert(e1 && /orgs_max_users_min/.test(e1.message), `max_users = 1 accepted (${e1?.message})`);
  assert(e2 && /orgs_max_accounts_min/.test(e2.message), `max_accounts = 4 accepted (${e2?.message})`);
  await setLimits(ORG_B, 2, 5); // control: the minimums themselves are valid
  await setLimits(ORG_B, null, null);
});
```

Add `import "./limits.test.mjs";` to `tests/rls/run.mjs` directly above the `migration.test.mjs` import.

- [ ] **Step 2: Run the tests and confirm they fail**

Run (local Supabase must be up; export `SUPABASE_ANON_KEY` from `npx supabase status -o json`): `node tests/rls/run.mjs`
Expected: the five new tests FAIL (no `max_users` column, no `org_seat_count`). The existing tests still pass.

- [ ] **Step 3: Add the columns.** In `supabase-setup.sql`, directly after `alter table public.orgs add column if not exists disabled ...` (~line 22):

```sql
-- Client limits, set by the platform admin on the Clients console. null = Unlimited.
-- The minimums live in the table, so no writer (RPC, SQL editor) can store a smaller value.
alter table public.orgs add column if not exists max_users int;
alter table public.orgs add column if not exists max_accounts int;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orgs_max_users_min') then
    alter table public.orgs add constraint orgs_max_users_min check (max_users is null or max_users >= 2);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orgs_max_accounts_min') then
    alter table public.orgs add constraint orgs_max_accounts_min check (max_accounts is null or max_accounts >= 5);
  end if;
end $$;
```

- [ ] **Step 4: Add the seat helpers and the re-enable trigger.** In the onboarding section, directly after the `revoke execute on function public.attach_orgless_login(...)` line:

```sql
-- ---------- client limits: seats ----------
-- A seat is an enabled member or an open invite. The platform admin never uses one: switch_org
-- puts their profile inside whichever client they open.
create or replace function public.org_seat_count(p_org uuid)
returns int language sql stable security definer set search_path = public as
$$ select (select count(*) from profiles where org_id = p_org and not disabled and not platform_admin)::int
        + (select count(*) from invites where org_id = p_org and accepted_at is null)::int $$;

-- Locks the org row first, so two concurrent invites cannot both see the last free seat.
create or replace function public.assert_seat_available(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lim int;
begin
  select max_users into lim from orgs where id = p_org for update;
  if lim is not null and public.org_seat_count(p_org) >= lim then
    raise exception 'Your plan allows % users — contact OneVio to raise it.', lim;
  end if;
end $$;
revoke execute on function public.org_seat_count(uuid) from public, anon, authenticated;
revoke execute on function public.assert_seat_available(uuid) from public, anon, authenticated;

-- Re-enabling a disabled user takes a seat back, so it is held to the same limit. The row
-- being enabled is still disabled while this runs, so it is not in the count yet.
create or replace function public.guard_seat_on_enable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.disabled and not new.disabled and new.org_id is not null and not new.platform_admin then
    perform public.assert_seat_available(new.org_id);
  end if;
  return new;
end $$;
drop trigger if exists guard_seat_on_enable on public.profiles;
create trigger guard_seat_on_enable
  before update of disabled on public.profiles
  for each row execute function public.guard_seat_on_enable();
```

- [ ] **Step 5: Gate `invite_user`.** Inside `invite_user`, in the `if found then` branch, insert directly before `perform public.attach_orgless_login('invite_user', ...)`:

```sql
    perform public.assert_seat_available(public.current_org());
```

And directly before the final `insert into invites (email, org_id, role, created_by)` (the `'invited'` path), insert:

```sql
  -- Re-sending an open invite to the same address takes no new seat.
  if not exists (select 1 from invites where lower(email) = addr and org_id = public.current_org()
                 and accepted_at is null) then
    perform public.assert_seat_available(public.current_org());
  end if;
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `node tests/rls/run.mjs`
Expected: all tests PASS, including the 5 new ones. (CI can flake on the Supabase CLI install rate limit. That's infra, so rerun it.)

- [ ] **Step 7: Commit**

```bash
git add supabase-setup.sql tests/rls/limits.test.mjs tests/rls/run.mjs
git commit -m "Add client user limits enforced in invite_user and on re-enable"
```

---

### Task 2: Account limit enforcement (SQL)

**Files:**
- Modify: `supabase-setup.sql` — new trigger after Task 1's helpers; `replace_all` (~line 448)
- Modify: `tests/rls/limits.test.mjs`

**Interfaces:**
- Consumes: `orgs.max_accounts` (Task 1).
- Produces: trigger `guard_account_limit` on `public.accounts`; `replace_all` raises the accounts message when `payload.accounts` length > `max_accounts`.

- [ ] **Step 1: Append the failing tests** to `tests/rls/limits.test.mjs`:

```js
const ACCTS_MSG = /Your plan allows \d+ accounts — contact OneVio to raise it\./;
const acctCount = async org => (await sql(`select count(*)::int as n from accounts where org_id = $1`, [org]))[0].n;
const dropLimAccounts = () => sql(`delete from accounts where id like 'lim-%'`);

// Fill org B to exactly lim accounts (lim >= 5) BEFORE setting the limit (the trigger would block the fill).
async function atAccountLimit(org) {
  let n = await acctCount(org);
  for (let i = 0; n < 5; i++, n++)
    await sql(`insert into accounts (org_id, id, data) values ($1, $2, '{"name":"lim fill"}')`, [org, `lim-fill${i}`]);
  await setLimits(org, null, n);
  return n;
}

test("a new account is blocked at max_accounts; editing an existing one is not; one below is allowed", async () => {
  try {
    const lim = await atAccountLimit(ORG_B);
    const existing = (await sql(`select id from accounts where org_id = $1 limit 1`, [ORG_B]))[0].id;
    const edit = await sessions.userB.rpc("merge_row", { tbl: "accounts", row_id: existing, patch: { limTouch: 1 }, appends: {} });
    assert(!edit.error, `editing an existing account at the limit was blocked: ${edit.error?.message}`);
    const blocked = await sessions.userB.rpc("merge_row", { tbl: "accounts", row_id: "lim-new", patch: { name: "New" }, appends: {} });
    assert(blocked.error && ACCTS_MSG.test(blocked.error.message), `new account at the limit not blocked: ${JSON.stringify(blocked)}`);
    assert(await acctCount(ORG_B) === lim, "an account was written past the limit");
    await setLimits(ORG_B, null, lim + 1);
    const ok = await sessions.userB.rpc("merge_row", { tbl: "accounts", row_id: "lim-new", patch: { name: "New" }, appends: {} });
    assert(!ok.error, `control: new account below the limit failed: ${ok.error?.message}`);
  } finally { await setLimits(ORG_B, null, null); await dropLimAccounts(); }
});

test("Unlimited never blocks, and lowering a limit below usage keeps every account", async () => {
  try {
    const lim = await atAccountLimit(ORG_B);
    await setLimits(ORG_B, null, null);
    const ok = await sessions.userB.rpc("merge_row", { tbl: "accounts", row_id: "lim-unl", patch: { name: "U" }, appends: {} });
    assert(!ok.error, `Unlimited blocked an insert: ${ok.error?.message}`);
    await setLimits(ORG_B, null, 5); // below usage (lim + 1 >= 6)
    assert(await acctCount(ORG_B) === lim + 1, "lowering the limit removed accounts");
  } finally { await setLimits(ORG_B, null, null); await dropLimAccounts(); }
});

test("replace_all over the account limit fails before deleting anything", async () => {
  try {
    const lim = await atAccountLimit(ORG_B);
    const before = await acctCount(ORG_B);
    const payload = { accounts: Array.from({ length: lim + 1 }, (_, i) => ({ id: `lim-r${i}`, name: `R${i}` })),
      contacts: [], activities: [], tasks: [], opportunities: [], settings: {} };
    const r = await sessions.adminB.rpc("replace_all", { payload });
    assert(r.error && r.error.message.includes(`allows ${lim} accounts`), `over-limit replace_all not refused: ${JSON.stringify(r)}`);
    assert(await acctCount(ORG_B) === before, "replace_all changed accounts despite refusing");
  } finally { await setLimits(ORG_B, null, null); await dropLimAccounts(); }
});
```

- [ ] **Step 2: Run and confirm the three new tests fail**

Run: `node tests/rls/run.mjs`
Expected: these 3 FAIL (no trigger, so inserts go through).

- [ ] **Step 3: Add the trigger.** Directly after Task 1's `guard_seat_on_enable` trigger:

```sql
-- ---------- client limits: accounts ----------
-- BEFORE INSERT also fires for `insert ... on conflict do update`, which merge_row uses for
-- EVERY account edit. An id that already exists is an edit, not a new account: let it through,
-- or every save is refused once a client reaches its limit.
create or replace function public.guard_account_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim int;
begin
  select max_accounts into lim from orgs where id = new.org_id for update;
  if lim is null then return new; end if;
  if exists (select 1 from accounts where org_id = new.org_id and id = new.id) then return new; end if;
  if (select count(*) from accounts where org_id = new.org_id) >= lim then
    raise exception 'Your plan allows % accounts — contact OneVio to raise it.', lim;
  end if;
  return new;
end $$;
drop trigger if exists guard_account_limit on public.accounts;
create trigger guard_account_limit
  before insert on public.accounts
  for each row execute function public.guard_account_limit();
```

- [ ] **Step 4: Pre-check `replace_all`.** Add `lim int;` to its `declare` block. Directly after its `if payload is null then ... end if;` block, insert:

```sql
  -- Refuse an over-limit restore BEFORE the deletes, with the plan message, rather than letting
  -- the account trigger fail it part-way (it would roll back, but with a less useful error).
  select max_accounts into lim from orgs where id = public.current_org();
  if lim is not null and jsonb_array_length(coalesce(payload -> 'accounts', '[]'::jsonb)) > lim then
    raise exception 'Your plan allows % accounts — contact OneVio to raise it.', lim;
  end if;
```

- [ ] **Step 5: Run and confirm all pass**

Run: `node tests/rls/run.mjs`
Expected: all PASS, including `replace.test.mjs` and `merge.test.mjs` (limits are null there, so they're unaffected).

- [ ] **Step 6: Commit**

```bash
git add supabase-setup.sql tests/rls/limits.test.mjs
git commit -m "Enforce the client account limit on insert and in replace_all"
```

---

### Task 3: Platform-admin RPCs (SQL)

**Files:**
- Modify: `supabase-setup.sql` — `create_org`, `list_orgs`, new `set_org_limits`, the revoke/grant block (~line 1013)
- Modify: `tests/rls/limits.test.mjs`

**Interfaces:**
- Consumes: `org_seat_count` (Task 1).
- Produces:
  - `create_org(p_name text, p_admin_email text, p_max_users int default null, p_max_accounts int default null) returns uuid`
  - `set_org_limits(p_org_id uuid, p_max_users int, p_max_accounts int) returns void`
  - `list_orgs()` returns `(id uuid, name text, created_at timestamptz, users int, disabled boolean, seats int, accounts int, max_users int, max_accounts int)`. `users` keeps its existing meaning (the disable dialog uses it).
  - Errors: `set_org_limits: platform admin only`, `set_org_limits: max users must be at least 2`, `set_org_limits: max accounts must be at least 5`, `set_org_limits: no such org`; the same with the `create_org:` prefix.

- [ ] **Step 1: Append the failing tests:**

```js
test("set_org_limits: platform admin only, minimums enforced, values stored", async () => {
  try {
    const denied = await sessions.adminB.rpc("set_org_limits", { p_org_id: ORG_B, p_max_users: 3, p_max_accounts: 7 });
    assert(denied.error && /platform admin only/.test(denied.error.message), `org admin set limits: ${JSON.stringify(denied)}`);
    const low = await sessions.platform.rpc("set_org_limits", { p_org_id: ORG_B, p_max_users: 1, p_max_accounts: null });
    assert(low.error && /at least 2/.test(low.error.message), `max users 1 accepted: ${JSON.stringify(low)}`);
    const lowA = await sessions.platform.rpc("set_org_limits", { p_org_id: ORG_B, p_max_users: null, p_max_accounts: 4 });
    assert(lowA.error && /at least 5/.test(lowA.error.message), `max accounts 4 accepted: ${JSON.stringify(lowA)}`);
    const ok = await sessions.platform.rpc("set_org_limits", { p_org_id: ORG_B, p_max_users: 3, p_max_accounts: 7 });
    assert(!ok.error, `control: platform admin could not set limits: ${ok.error?.message}`);
    const row = (await sql(`select max_users, max_accounts from orgs where id = $1`, [ORG_B]))[0];
    assert(row.max_users === 3 && row.max_accounts === 7, `stored ${JSON.stringify(row)}`);
  } finally { await setLimits(ORG_B, null, null); }
});

test("list_orgs reports seats, accounts and limits", async () => {
  try {
    await setLimits(ORG_B, 9, 50);
    const { data, error } = await sessions.platform.rpc("list_orgs");
    assert(!error, error?.message);
    const b = data.find(o => o.id === ORG_B);
    assert(b.max_users === 9 && b.max_accounts === 50, `limits missing: ${JSON.stringify(b)}`);
    assert(b.seats === await seats(ORG_B), `seats ${b.seats} != org_seat_count`);
    assert(b.accounts === await acctCount(ORG_B), `accounts ${b.accounts} wrong`);
  } finally { await setLimits(ORG_B, null, null); }
});

test("create_org stores limits, and still works without them", async () => {
  const names = ["Lim Co One", "Lim Co Two"];
  try {
    const a = await sessions.platform.rpc("create_org", { p_name: names[0], p_admin_email: "lim-c1@example.com", p_max_users: 4, p_max_accounts: 20 });
    assert(!a.error, a.error?.message);
    const ra = (await sql(`select max_users, max_accounts from orgs where id = $1`, [a.data]))[0];
    assert(ra.max_users === 4 && ra.max_accounts === 20, `stored ${JSON.stringify(ra)}`);
    const b = await sessions.platform.rpc("create_org", { p_name: names[1], p_admin_email: "lim-c2@example.com" });
    assert(!b.error, `create_org without limits failed: ${b.error?.message}`);
    const rb = (await sql(`select max_users, max_accounts from orgs where id = $1`, [b.data]))[0];
    assert(rb.max_users === null && rb.max_accounts === null, `defaults not Unlimited: ${JSON.stringify(rb)}`);
    const bad = await sessions.platform.rpc("create_org", { p_name: "Lim Bad", p_admin_email: "lim-c3@example.com", p_max_users: 1 });
    assert(bad.error && /at least 2/.test(bad.error.message), `create_org accepted max users 1: ${JSON.stringify(bad)}`);
  } finally {
    await sql(`delete from orgs where name = any($1)`, [[...names, "Lim Bad"]]);
    await dropInvites();
  }
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `node tests/rls/run.mjs`
Expected: the 3 new tests FAIL (unknown function / missing columns).

- [ ] **Step 3: Replace `create_org`.** Directly above `create or replace function public.create_org(`, add `drop function if exists public.create_org(text, text);`. Change the signature to:

```sql
create or replace function public.create_org(p_name text, p_admin_email text,
                                             p_max_users int default null, p_max_accounts int default null)
```

After the `valid_email` check, add:

```sql
  if p_max_users is not null and p_max_users < 2 then
    raise exception 'create_org: max users must be at least 2';
  end if;
  if p_max_accounts is not null and p_max_accounts < 5 then
    raise exception 'create_org: max accounts must be at least 5';
  end if;
```

Change the insert to `insert into orgs (name, max_users, max_accounts) values (trim(p_name), p_max_users, p_max_accounts) returning id into new_id;`.

- [ ] **Step 4: Extend `list_orgs`** (it is already preceded by `drop function if exists public.list_orgs();`):

```sql
create or replace function public.list_orgs()
returns table(id uuid, name text, created_at timestamptz, users int, disabled boolean,
              seats int, accounts int, max_users int, max_accounts int)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'list_orgs: platform admin only';
  end if;
  return query
    select o.id, o.name, o.created_at,
           (select count(*)::int from profiles p where p.org_id = o.id and not p.disabled),
           o.disabled,
           public.org_seat_count(o.id),
           (select count(*)::int from accounts a where a.org_id = o.id),
           o.max_users, o.max_accounts
    from orgs o order by o.created_at;
end $$;
```

- [ ] **Step 5: Add `set_org_limits`** directly after `set_org_disabled`:

```sql
-- A limit below current usage is allowed: nothing is removed, the client just cannot add more.
create or replace function public.set_org_limits(p_org_id uuid, p_max_users int, p_max_accounts int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'set_org_limits: platform admin only';
  end if;
  if p_max_users is not null and p_max_users < 2 then
    raise exception 'set_org_limits: max users must be at least 2';
  end if;
  if p_max_accounts is not null and p_max_accounts < 5 then
    raise exception 'set_org_limits: max accounts must be at least 5';
  end if;
  update orgs set max_users = p_max_users, max_accounts = p_max_accounts where id = p_org_id;
  if not found then
    raise exception 'set_org_limits: no such org';
  end if;
end $$;
```

- [ ] **Step 6: Update revoke/grant.** Replace both `create_org(text, text)` lines with `create_org(text, text, int, int)`, and add:

```sql
revoke execute on function public.set_org_limits(uuid, int, int) from public, anon;
grant execute on function public.set_org_limits(uuid, int, int) to authenticated;
```

Run `grep -rn "create_org(text, text)" supabase-setup.sql tests/` and update any remaining reference.

- [ ] **Step 7: Run and confirm all pass**

Run: `node tests/rls/run.mjs`
Expected: all PASS, including `orgs.test.mjs` and `migration.test.mjs` (which re-applies the setup over an old schema, proving it's re-runnable).

- [ ] **Step 8: Commit**

```bash
git add supabase-setup.sql tests/rls/limits.test.mjs
git commit -m "Add set_org_limits, limits on create_org and usage in list_orgs"
```

---

### Task 4: Pure limit helpers (lib)

**Files:**
- Create: `src/lib/limits.js`
- Modify: `src/lib/index.js` (add `export * from "./limits.js";`)
- Create: `tests/unit/limits.test.mjs`

**Interfaces:**
- Produces (globals in the app via build.mjs):
  - `LIMIT_MIN` = `{ users: 2, accounts: 5 }`
  - `limitMessage(kind: "users"|"accounts", limit: number) -> string` (verbatim Global Constraints text)
  - `roomLeft(limit: number|null, used: number) -> number` (Infinity when limit is null; never negative)
  - `isOverLimit(used: number, limit: number|null) -> boolean` (strictly greater)
  - `usageLabel(used: number, limit: number|null) -> string` (`"7 / 10"`, `"42 / ∞"`)
  - `parseLimit(unlimited: boolean, raw: string, min: number) -> { value: number|null, error: string|null }`

- [ ] **Step 1: Write the failing unit tests** in `tests/unit/limits.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMIT_MIN, limitMessage, roomLeft, isOverLimit, usageLabel, parseLimit } from "../../src/lib/limits.js";

test("limitMessage matches the server text", () => {
  assert.equal(limitMessage("users", 10), "Your plan allows 10 users — contact OneVio to raise it.");
  assert.equal(limitMessage("accounts", 5), "Your plan allows 5 accounts — contact OneVio to raise it.");
});
test("roomLeft", () => {
  assert.equal(roomLeft(null, 999), Infinity);
  assert.equal(roomLeft(10, 7), 3);
  assert.equal(roomLeft(5, 8), 0); // over limit never goes negative
});
test("isOverLimit is strict and Unlimited is never over", () => {
  assert.equal(isOverLimit(5, 5), false);
  assert.equal(isOverLimit(6, 5), true);
  assert.equal(isOverLimit(1e6, null), false);
});
test("usageLabel", () => {
  assert.equal(usageLabel(7, 10), "7 / 10");
  assert.equal(usageLabel(42, null), "42 / ∞");
});
test("parseLimit", () => {
  assert.deepEqual(parseLimit(true, "1", LIMIT_MIN.users), { value: null, error: null });
  assert.deepEqual(parseLimit(false, "2", LIMIT_MIN.users), { value: 2, error: null });
  assert.deepEqual(parseLimit(false, " 12 ", LIMIT_MIN.accounts), { value: 12, error: null });
  assert.equal(parseLimit(false, "1", LIMIT_MIN.users).error, "Must be at least 2.");
  assert.equal(parseLimit(false, "4", LIMIT_MIN.accounts).error, "Must be at least 5.");
  assert.equal(parseLimit(false, "", 2).error, "Enter a whole number, or tick Unlimited.");
  assert.equal(parseLimit(false, "2.5", 2).error, "Enter a whole number, or tick Unlimited.");
  assert.equal(parseLimit(false, "abc", 2).error, "Enter a whole number, or tick Unlimited.");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/unit/limits.test.mjs`
Expected: FAIL (cannot find module `src/lib/limits.js`).

- [ ] **Step 3: Implement** `src/lib/limits.js`:

```js
// Client limits (spec 2026-10-08). The server enforces them; these helpers let the app say
// the same thing before a write, and render usage on the Clients console. null = Unlimited.
export const LIMIT_MIN = { users: 2, accounts: 5 };

export const limitMessage = (kind, limit) =>
  `Your plan allows ${limit} ${kind} — contact OneVio to raise it.`;

export const roomLeft = (limit, used) => (limit == null ? Infinity : Math.max(0, limit - used));

export const isOverLimit = (used, limit) => limit != null && used > limit;

export const usageLabel = (used, limit) => `${used} / ${limit == null ? "∞" : limit}`;

export function parseLimit(unlimited, raw, min) {
  if (unlimited) return { value: null, error: null };
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return { value: null, error: "Enter a whole number, or tick Unlimited." };
  const n = Number(s);
  if (n < min) return { value: null, error: `Must be at least ${min}.` };
  return { value: n, error: null };
}
```

Add `export * from "./limits.js";` to `src/lib/index.js`.

- [ ] **Step 4: Run and confirm pass, plus the build's purity guard**

Run: `node --test tests/unit/limits.test.mjs && npm run test:unit && npm run build`
Expected: all PASS; the build succeeds (the guard rejects lib code that touches browser globals).

- [ ] **Step 5: Commit**

```bash
git add src/lib/limits.js src/lib/index.js tests/unit/limits.test.mjs
git commit -m "Add pure client-limit helpers"
```

---

### Task 5: App-side account limit (form + CSV import)

**Files:**
- Modify: `src/00-core-config.jsx` (add the `ORG_LIMITS` holder)
- Modify: `src/26-app.jsx:~116-120` (load `max_accounts` for every user)
- Modify: `src/13-forms.jsx:~245-262` (block a new account at the limit)
- Modify: `src/17-csv.jsx` (`importAccountsCSV`: collect then dispatch; refuse the whole import if new rows exceed room)
- Create: `tests/health/account-limit.test.mjs`; register it the same way the other `*.test.mjs` files are picked up by `tests/health/run.mjs` (check whether it globs or imports explicitly)

**Interfaces:**
- Consumes: `roomLeft`, `limitMessage` (Task 4); `orgs.max_accounts` readable by members via `orgs_select` (Task 1).
- Produces: global `ORG_LIMITS` = `{ maxAccounts: number|null }`, set once the org row loads.

- [ ] **Step 1: Write the failing health tests.** Read `tests/health/csv-import-safety.test.mjs` and `tests/health/harness.mjs` first, and reuse their exact helpers for seeding accounts, opening the account form and uploading a CSV (file input, `setInputFiles`). The mocked `orgs` API returns `window.__seedRows.orgs`, so seed `max_accounts` there. Tests to write (each asserts both the visible message and the absence of a write):

```js
import { test, assert } from "./framework.mjs";
import { launch, rootText } from "./harness.mjs";

const MSG = "Your plan allows 5 accounts — contact OneVio to raise it.";
const accts = n => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `a${i}`, data: { id: `a${i}`, name: `Acct ${i}`, tier: "Mid", arr: 0 } })));
const seed = (n, max) => `window.__seedRows = { accounts: ${accts(n)}, contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [],
  orgs: [{ id: "org-a", name: "Acme Corp", max_accounts: ${max === null ? "null" : max} }] };
  window.__seedProfile = { id: "u1", name: "Admin", role: "admin", org_id: "org-a", platform_admin: false };`;
const newAcctWrites = page => page.evaluate(() => (window.__rpcCalls || [])
  .filter(c => c.fn === "merge_row" && c.args.tbl === "accounts" && !/^a\d+$/.test(c.args.row_id)).length);

test("add-account form is refused at the limit", async () => {
  const { page, browser } = await launch(seed(5, 5));
  // open the New account form, fill Name "Over", submit -- use the same selectors as the existing account-form tests
  // ...
  await page.waitForSelector("[data-limit-error]", { timeout: 15000 });
  assert((await page.textContent("[data-limit-error]")).includes(MSG), "limit message missing");
  assert(await newAcctWrites(page) === 0, "a new account was written past the limit");
  await browser.close();
});

test("control: add-account works one below the limit", async () => {
  const { page, browser } = await launch(seed(4, 5));
  // same steps as above
  // ...
  assert(!(await page.$("[data-limit-error]")), "limit error shown below the limit");
  assert(await newAcctWrites(page) === 1, "the new account was not written");
  await browser.close();
});

test("CSV import whose new rows exceed room is refused whole -- updates included", async () => {
  // seed(4, 5): room for 1. CSV: one row matching "Acct 0" with a changed ARR, plus two new names.
  // Expect: import message contains MSG and "adds 2 new accounts; there is room for 1. Nothing was imported."
  // Expect: zero merge_row calls for accounts at all (Acct 0's update was NOT applied).
});

test("control: CSV import that fits is applied, updates and adds together", async () => {
  // seed(4, 5): CSV with "Acct 0" changed + one new name -> both applied (1 update, 1 add).
});

test("Unlimited (max_accounts null) never blocks the form", async () => {
  // seed(50, null): add one -> written.
});
```

The `// ...` lines are where the existing selectors go. Copy them from the account-form and CSV tests named above, then fill all five tests in before running. No test may stay a stub.

- [ ] **Step 2: Build and run; confirm failure**

Run: `npm run build && node tests/health/run-one.mjs tests/health/account-limit.test.mjs` (check `run-one.mjs` for its exact argument form)
Expected: the blocking tests FAIL (no `[data-limit-error]`, the write happens). The controls may pass.

- [ ] **Step 3: Add the holder** to `src/00-core-config.jsx`, next to the other app-wide config:

```js
// Client limits for the signed-in user's org, loaded by App from the orgs row. null = Unlimited.
// The server enforces them; this only lets the UI refuse before an optimistic write.
const ORG_LIMITS = { maxAccounts: null };
```

- [ ] **Step 4: Load it** in `App` (`src/26-app.jsx`), next to the existing orgs effect:

```js
  useEffect(() => {
    if (!user.org_id) return;
    sb.from("orgs").select("max_accounts").eq("id", user.org_id).single()
      .then(({ data }) => { ORG_LIMITS.maxAccounts = data?.max_accounts ?? null; });
  }, [user.org_id]);
```

- [ ] **Step 5: Gate the form** (`src/13-forms.jsx`). Add `const [limitErr, setLimitErr] = useState("");` beside the existing state. In `onSubmit`, replace the `else dispatch({ type: "ADD_ACCOUNT", ...})` branch with:

```js
      else {
        // `accounts` is every account in the org (churned included), which is what the server counts.
        if (roomLeft(ORG_LIMITS.maxAccounts, accounts.length) < 1) return setLimitErr(limitMessage("accounts", ORG_LIMITS.maxAccounts));
        dispatch({ type: "ADD_ACCOUNT", item: { ...clean, id: uid(), inputs: { ...DEFAULT_INPUTS }, history: [], inputsUpdatedAt: iso(Date.now()) } });
      }
```

Render `{limitErr && <div data-limit-error className="col-span-2 text-xs text-rose-600 md:col-span-4">{limitErr}</div>}` as the form's last child. Check that `accounts` in this component is the full list (not a filtered view) by tracing its prop from the caller. If it's filtered, pass the full list in.

- [ ] **Step 6: Make the CSV import all-or-nothing on the limit** (`src/17-csv.jsx`, `importAccountsCSV`). Inside the row loop, push every action into a local `const ops = [];` instead of calling `dispatch` directly (`ops.push({ type: "EDIT_ACCOUNT", ... })`, likewise for `UPDATE_INPUTS` and `ADD_ACCOUNT`). Keep the `byName`/`byNo` updates and counters exactly as they are. After the loop, before `done(...)`:

```js
    const adds = ops.filter(o => o.type === "ADD_ACCOUNT").length;
    const room = roomLeft(ORG_LIMITS.maxAccounts, accounts.length);
    if (adds > room)
      return done({ ok: 0, updated: 0, skipped: 0, badTier: 0, badStatus: 0,
        err: `${limitMessage("accounts", ORG_LIMITS.maxAccounts)} This file adds ${adds} new accounts; there is room for ${room}. Nothing was imported.` });
    ops.forEach(dispatch);
```

The `err` object shape must match the existing early return at line ~25 (copy its keys). Check that `done({ err })` is rendered by both callers (`20-account-list.jsx` `setImportMsg`, `18-drive-sync.jsx`).

- [ ] **Step 7: Build and run the new tests plus the CSV/form suites**

Run: `npm run build && node tests/health/run-one.mjs tests/health/account-limit.test.mjs`, then the same for `csv.test.mjs`, `csv-import-safety.test.mjs`, `csv-dates.test.mjs`, `health-mix-csv.test.mjs`
Expected: all PASS. Collecting ops doesn't change any existing CSV result.

- [ ] **Step 8: Commit**

```bash
git add src/00-core-config.jsx src/26-app.jsx src/13-forms.jsx src/17-csv.jsx tests/health/account-limit.test.mjs tests/health/run.mjs
git commit -m "Refuse new accounts in the app when a client is at its account limit"
```

---

### Task 6: Clients console — set, show and edit limits

**Files:**
- Modify: `src/25-auth-admin.jsx` (`ClientConsole`, ~lines 118-216; the `UsersCard` invite error already shows `ex.message`, so the server's users message reaches the admin without changes)
- Modify: `tests/health/harness.mjs` (console rpc mock: `set_org_limits` resolves `{ data: null, error: null }`, and `create_org` accepts the new args, if the mock doesn't already default to success; check the `rpc:` mock at ~line 80)
- Modify: `tests/health/client-console.test.mjs`

**Interfaces:**
- Consumes: `create_org` (4 args), `set_org_limits`, `list_orgs` fields `seats`, `accounts`, `max_users`, `max_accounts` (Task 3); `parseLimit`, `usageLabel`, `isOverLimit`, `LIMIT_MIN` (Task 4).

- [ ] **Step 1: Write the failing tests** (append to `tests/health/client-console.test.mjs`; reuse its `seedConsole`, adding the new fields to `__seedOrgs` rows through the `extra` script or a variant):

```js
const seedLimits = () => seedConsole(`window.__seedOrgs = [
  { id: "${HOME}", name: "OneVio", created_at: "2025-01-01", users: 12, disabled: false, seats: 12, accounts: 40, max_users: null, max_accounts: null },
  { id: "org-b", name: "Beta Ltd", created_at: "2026-02-01", users: 8, disabled: false, seats: 8, accounts: 3, max_users: 5, max_accounts: 10 }];`);

test("console shows usage against limits, amber when over", async () => {
  const { page, browser } = await launch(seedLimits());
  await page.waitForSelector("[data-org-usage='org-b']", { timeout: 15000 });
  const b = await page.textContent("[data-org-usage='org-b']");
  assert(b.includes("8 / 5 users") && b.includes("3 / 10 accounts"), `org-b usage: ${b}`);
  assert(await page.$("[data-org-usage='org-b'] [data-over-limit='users']"), "over-limit users not flagged");
  assert(!(await page.$("[data-org-usage='org-b'] [data-over-limit='accounts']")), "accounts flagged though under");
  const h = await page.textContent(`[data-org-usage='${HOME}']`);
  assert(h.includes("12 / ∞ users") && h.includes("40 / ∞ accounts"), `home usage: ${h}`);
  await browser.close();
});

test("create client sends limits; Unlimited sends null; below-minimum is refused in the form", async () => {
  const { page, browser } = await launch(seedLimits());
  await page.click("[data-new-client]");
  await page.fill("input[placeholder='Client name']", "Gamma");
  await page.fill("input[placeholder='Admin name']", "Gail");
  await page.fill("input[placeholder='Admin email']", "gail@gamma.test");
  await page.fill("input[placeholder='Temporary password']", "secret1");
  await page.uncheck("[data-limit-unlimited='users']");
  await page.fill("[data-limit-input='users']", "1");
  await page.click("text=Create client");
  assert((await rootText(page)).includes("Must be at least 2."), "below-minimum users not refused");
  assert(!(await page.evaluate(() => (window.__rpcCalls || []).some(c => c.fn === "create_org"))), "create_org called with an invalid limit");
  await page.fill("[data-limit-input='users']", "6");
  await page.click("text=Create client");
  await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "create_org"));
  const [call] = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "create_org"));
  assert(call.args.p_max_users === 6 && call.args.p_max_accounts === null, `args: ${JSON.stringify(call.args)}`);
  await browser.close();
});

test("Edit limits calls set_org_limits with the new values", async () => {
  const { page, browser } = await launch(seedLimits());
  await page.click("[data-edit-limits='org-b']");
  await page.fill("[data-limit-input='accounts']", "25");
  await page.check("[data-limit-unlimited='users']");
  await page.click("[data-save-limits]");
  await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "set_org_limits"));
  const [call] = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "set_org_limits"));
  assert(call.args.p_org_id === "org-b" && call.args.p_max_users === null && call.args.p_max_accounts === 25, JSON.stringify(call.args));
  await browser.close();
});
```

- [ ] **Step 2: Build and run; confirm failure**

Run: `npm run build && node tests/health/run-one.mjs tests/health/client-console.test.mjs`
Expected: the 3 new tests FAIL; the existing console tests PASS.

- [ ] **Step 3: Add a `LimitField` component** directly above `ClientConsole` in `src/25-auth-admin.jsx`:

```jsx
// One limit: a number box plus an "Unlimited" tick. value = { unlimited: bool, raw: string }.
function LimitField({ kind, label, value, onChange, error }) {
  return (
    <div className="text-xs text-slate-600">
      <div className="mb-1 font-semibold">{label}</div>
      <div className="flex items-center gap-2">
        <Input data-limit-input={kind} type="number" min={LIMIT_MIN[kind]} disabled={value.unlimited}
          placeholder={`min ${LIMIT_MIN[kind]}`} value={value.raw}
          onChange={e => onChange({ ...value, raw: e.target.value })} />
        <label className="flex items-center gap-1 whitespace-nowrap">
          <input data-limit-unlimited={kind} type="checkbox" checked={value.unlimited}
            onChange={e => onChange({ ...value, unlimited: e.target.checked })} /> Unlimited
        </label>
      </div>
      {error && <div className="mt-1 text-rose-600">{error}</div>}
    </div>
  );
}
```

If `Input` doesn't forward `data-*`/`disabled` props, check its definition in `src/10-ui-atoms.jsx` and use a plain `<input className=...>` matching its classes instead.

- [ ] **Step 4: Wire the create form.** In `ClientConsole`:

```js
  const UNL = { unlimited: true, raw: "" };
  const [lim, setLim] = useState({ users: UNL, accounts: UNL });
  const [limErr, setLimErr] = useState({});
  const readLimits = l => {
    const u = parseLimit(l.users.unlimited, l.users.raw, LIMIT_MIN.users);
    const a = parseLimit(l.accounts.unlimited, l.accounts.raw, LIMIT_MIN.accounts);
    setLimErr({ users: u.error, accounts: a.error });
    return u.error || a.error ? null : { p_max_users: u.value, p_max_accounts: a.value };
  };
```

In `createClient`, after the password check: `const limits = readLimits(lim); if (!limits) return;`. Change the rpc to `sb.rpc("create_org", { p_name: v.name.trim(), p_admin_email: v.email.trim(), ...limits })`. On success, also `setLim({ users: UNL, accounts: UNL })`. Inside the form, before the submit button's div, add:

```jsx
              <LimitField kind="users" label="Max users" value={lim.users} error={limErr.users}
                onChange={x => setLim({ ...lim, users: x })} />
              <LimitField kind="accounts" label="Max accounts" value={lim.accounts} error={limErr.accounts}
                onChange={x => setLim({ ...lim, accounts: x })} />
```

- [ ] **Step 5: Show usage and add Edit limits.** Replace the row's sub-line `<div className="text-xs text-slate-500">…</div>` with:

```jsx
                <div data-org-usage={o.id} className="text-xs text-slate-500">
                  <span data-over-limit={isOverLimit(o.seats, o.max_users) ? "users" : undefined}
                    className={isOverLimit(o.seats, o.max_users) ? "font-semibold text-amber-600" : ""}>
                    {usageLabel(o.seats, o.max_users)} users</span>
                  {" · "}
                  <span data-over-limit={isOverLimit(o.accounts, o.max_accounts) ? "accounts" : undefined}
                    className={isOverLimit(o.accounts, o.max_accounts) ? "font-semibold text-amber-600" : ""}>
                    {usageLabel(o.accounts, o.max_accounts)} accounts</span>
                  {" · since "}{String(o.created_at).slice(0, 10)}
                </div>
```

Add state `const [editOrg, setEditOrg] = useState(null);` and an edit button beside the toggle:

```jsx
              <button data-edit-limits={o.id} className="text-xs font-bold text-slate-600 hover:underline"
                onClick={() => { setLimErr({}); setEditOrg(o); setLim({
                  users: o.max_users == null ? UNL : { unlimited: false, raw: String(o.max_users) },
                  accounts: o.max_accounts == null ? UNL : { unlimited: false, raw: String(o.max_accounts) } }); }}>Edit limits</button>
```

Render the edit panel inside the row's map, right after the row's `div` (wrap the row and panel in a `React.Fragment` keyed by `o.id`, and move `key` onto it):

```jsx
            {editOrg && editOrg.id === o.id && (
              <div className="grid gap-2 border-b border-slate-100 py-2 sm:grid-cols-2">
                <LimitField kind="users" label="Max users" value={lim.users} error={limErr.users}
                  onChange={x => setLim({ ...lim, users: x })} />
                <LimitField kind="accounts" label="Max accounts" value={lim.accounts} error={limErr.accounts}
                  onChange={x => setLim({ ...lim, accounts: x })} />
                <div className="flex gap-2 sm:col-span-2">
                  <Btn kind="primary" data-save-limits onClick={saveLimits}>Save limits</Btn>
                  <Btn onClick={() => setEditOrg(null)}>Cancel</Btn>
                </div>
                <p className="text-xs text-slate-500 sm:col-span-2">A limit below current usage removes nothing — the client just can't add more.</p>
              </div>
            )}
```

With:

```js
  const saveLimits = async () => {
    setErr(""); setMsg("");
    const limits = readLimits(lim); if (!limits) return;
    const { error } = await sb.rpc("set_org_limits", { p_org_id: editOrg.id, ...limits });
    if (error) return setErr(error.message);
    setMsg(`${editOrg.name} limits saved.`); setEditOrg(null); setLim({ users: UNL, accounts: UNL }); load();
  };
```

Edit and create share `lim`/`limErr`. Opening Edit while the New-client form is open would mix their values, so call `setShowNew(false)` in the Edit button's onClick, and `setEditOrg(null)` in the `+ New client` onClick.

- [ ] **Step 6: Mock the new rpc** in `tests/health/harness.mjs` if its rpc mock doesn't already resolve unknown functions successfully: `if (fn === "set_org_limits") return Promise.resolve({ data: null, error: null });` next to the `list_orgs` line.

- [ ] **Step 7: Build and run the console, dark-mode and mobile tests**

Run: `npm run build && node tests/health/run-one.mjs tests/health/client-console.test.mjs`, then the same for `dark-mode.test.mjs` and `mobile.test.mjs`
Expected: all PASS. Amber text uses Tailwind palette classes, which the PR #66 dark-mode CSS variables already remap. If the dark-mode test checks for raw colours, follow its existing pattern.

- [ ] **Step 8: Commit**

```bash
git add src/25-auth-admin.jsx tests/health/harness.mjs tests/health/client-console.test.mjs
git commit -m "Set, show and edit client limits on the Clients console"
```

---

### Task 7: Docs + full verification

**Files:**
- Modify: `TEAM-SETUP.md` (the platform-admin / Clients console section; find it with `grep -n "Clients" TEAM-SETUP.md`)

- [ ] **Step 1: Document** under the Clients console section:

```markdown
### Client limits
Each client can have a **Max users** (minimum 2) and a **Max accounts** (minimum 5); leave
"Unlimited" ticked for no cap. Set them when creating the client, or later with **Edit limits**.
- Users = enabled members + open invites (your own platform-admin login never counts).
- Accounts = every account in the client, churned included.
- At the limit, invites, re-enabling a user, adding an account and CSV imports that add
  accounts are refused with "Your plan allows N … — contact OneVio to raise it."
- Lowering a limit below current usage removes nothing; the row shows in amber and the
  client cannot add more until under the limit.
After deploying, re-run `supabase-setup.sql` in the Supabase SQL editor.
```

- [ ] **Step 2: Run every suite**

Run: `npm run test:unit && npm run build && node tests/health/run.mjs && node tests/rls/run.mjs`
Expected: all PASS. Report the exact pass counts. Never pipe `run.mjs` (its exit code is the gate).

- [ ] **Step 3: Commit, push, open the PR**

```bash
git add TEAM-SETUP.md
git commit -m "Document client limits"
git push -u origin client-limits
gh pr create --base master --title "Client limits: max users and max accounts per client" --body-file <scratchpad>/pr-limits.md
```

The PR body lists what shipped, the five Review Focus items and how each is pinned, and a **post-merge step: re-run `supabase-setup.sql`**. End it with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The user merges with `! gh pr merge <n> --squash` (auto mode blocks merges).
