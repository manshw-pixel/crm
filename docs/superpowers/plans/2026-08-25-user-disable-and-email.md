# User Disable and Email Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin disable a user (revoking access immediately, enforced in RLS) and see/edit any user's email address from Settings → Users.

**Architecture:** A `profiles.disabled` column plus an `is_active()` helper gates every RLS policy, so a disabled user's existing session stops working on its next query rather than at token expiry. Email lives in `auth.users`, unreadable from the browser, so two `security definer` functions (`admin_user_list`, `admin_set_user_email`) provide read and write. All SQL goes in `supabase-setup.sql`; all UI in `UsersCard` in `crm.html`.

**Tech Stack:** Postgres/PL-pgSQL (Supabase), React 18 via in-browser Babel (single-file `crm.html`), Playwright health tests, `tests/rls` suite against real Postgres + GoTrue.

**Spec:** `docs/superpowers/specs/2026-08-25-user-disable-and-email-design.md`

## Global Constraints

- **Every SQL file in this repo is idempotent and re-run whole.** Use `create or replace`, `add column if not exists`, `drop policy if exists` before `create policy`. Never write a migration that only works once.
- **`merge_row` must stay `security invoker`.** There is a load-bearing comment saying so at supabase-setup.sql:145. Do not change it; the tightened policies reach it precisely because it is invoker.
- **Definer functions must assert their own authorisation.** A `security definer` function runs as its owner and bypasses RLS, so `if not public.is_admin() then raise exception` is mandatory inside, never assumed from the caller's policies.
- **UI copy must not say "cannot sign in".** GoTrue still issues a token to a disabled user (spec §3). The truthful phrasing is "has no access" / "access removed".
- **Build before testing.** `tests/health` loads `dist/crm.html`, not the source. Run `node build.mjs` first or you are testing the previous version.
- **RLS assertions must prove the session works first.** Per the anon-key vacuity lesson, a test that asserts "reads nothing" passes trivially against a broken client. Always assert the session CAN read before disabling, then assert it cannot after.
- Run the RLS suite with `cd tests/rls && node run.mjs`; the health suite with `node tests/health/run.mjs`; one health file with `node tests/health/run-one.mjs <file>.test.mjs`.

---

### Task 1: `disabled` column, `is_active()`, and the guard trigger

**Files:**
- Modify: `supabase-setup.sql` (add column after the `profiles` table at :8-13; add `is_active()` beside `is_admin()` at :33-36; extend `guard_admin_count` at :56-69)
- Test: `tests/rls/auth.test.mjs`

**Interfaces:**
- Produces: `public.is_active() returns boolean`; `profiles.disabled boolean not null default false`; the extended `guard_admin_count` trigger refusing the last-admin disable and self-disable.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rls/auth.test.mjs`:

```js
test("disabling the last admin is refused", async () => {
  await resetDb();
  const admin = await signUp("admin@test.dev", "Admin");
  const { error } = await admin.from("profiles").update({ disabled: true }).eq("id", admin.userId);
  assert(error, "expected the last-admin disable to be refused");
  assert(/at least one admin/i.test(error.message), `unexpected message: ${error && error.message}`);
});

test("an admin cannot disable themselves even when another admin exists", async () => {
  await resetDb();
  const a1 = await signUp("a1@test.dev", "A1");
  const a2 = await signUp("a2@test.dev", "A2");
  await a1.from("profiles").update({ role: "admin" }).eq("id", a2.userId);
  const { error } = await a1.from("profiles").update({ disabled: true }).eq("id", a1.userId);
  assert(error, "expected self-disable to be refused");
  assert(/yourself/i.test(error.message), `unexpected message: ${error && error.message}`);
});

test("one of two admins can be disabled by the other", async () => {
  await resetDb();
  const a1 = await signUp("a1@test.dev", "A1");
  const a2 = await signUp("a2@test.dev", "A2");
  await a1.from("profiles").update({ role: "admin" }).eq("id", a2.userId);
  const { error } = await a1.from("profiles").update({ disabled: true }).eq("id", a2.userId);
  assert(!error, `expected the disable to succeed, got: ${error && error.message}`);
});
```

Read the top of `tests/rls/auth.test.mjs` first and match its existing helper names exactly (`resetDb`, `signUp`, and how it exposes `userId`). The names above follow the file's existing style; if they differ, use the file's.

- [ ] **Step 2: Run to verify they fail**

Run: `cd tests/rls && node run.mjs`
Expected: the three new tests FAIL — the first two because no error is raised (the column does not exist yet, so PostgREST rejects the unknown column with a different message; either way the `/at least one admin/i` and `/yourself/i` assertions do not match).

- [ ] **Step 3: Add the column and `is_active()`**

In `supabase-setup.sql`, immediately after the `create table if not exists public.profiles (...)` block:

```sql
-- Disabling is the reversible alternative to deleting a user: a delete would orphan the
-- free-text `csm` / `owner` references that renameEverywhere() exists to keep in sync.
alter table public.profiles
  add column if not exists disabled boolean not null default false;
```

Beside `is_admin()`:

```sql
-- ---------- helper: is the current user active (not disabled)? ----------
-- Gates every policy below. This is what makes disabling take effect on a LIVE session:
-- the user keeps a valid JWT, but their next query matches no rows. Anything enforced only
-- in the client would be a label the browser is trusted to honour, which it is not.
create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and not disabled) $$;
```

- [ ] **Step 4: Extend the guard trigger**

Replace the body of `guard_admin_count` (keep the name and the trigger definition; widen the trigger to fire on `disabled` too):

```sql
create or replace function public.guard_admin_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.disabled and not old.disabled and new.id = auth.uid() then
    raise exception 'You cannot disable yourself';
  end if;
  -- One predicate for both routes to zero admins: demotion (role change) and disabling.
  -- The original guard watched only role, so an admin could disable their way to an app
  -- nobody can administer -- the same failure it was written to prevent.
  if tg_op = 'UPDATE'
     and old.role = 'admin' and not old.disabled
     and (new.role <> 'admin' or new.disabled)
     and (select count(*) from profiles
            where role = 'admin' and not disabled and id <> old.id) = 0 then
    raise exception 'At least one admin must remain';
  end if;
  return new;
end $$;

drop trigger if exists guard_admin_count on public.profiles;
create trigger guard_admin_count
  before insert or update of role, disabled on public.profiles
  for each row execute function public.guard_admin_count();
```

Note `update of role, disabled` — the original listed only `role`, so a `disabled` update would not have fired the trigger at all.

- [ ] **Step 5: Run to verify they pass**

Run: `cd tests/rls && node run.mjs`
Expected: all three new tests PASS, and the pre-existing "demoting the last admin is refused" / "one of two admins can be demoted" still PASS (the rewritten predicate must not regress them).

- [ ] **Step 6: Commit**

```bash
git add supabase-setup.sql tests/rls/auth.test.mjs
git commit -m "Add profiles.disabled with a guard against disabling the last admin"
```

---

### Task 2: Gate every policy on `is_active()`

**Files:**
- Modify: `supabase-setup.sql` (`is_admin()` at :33-36; `profiles_select` at :80-82; entity loop at :94-107; delete policies at :109-119; storage policies at :467-476)
- Test: `tests/rls/policies.test.mjs`

**Interfaces:**
- Consumes: `public.is_active()` from Task 1.
- Produces: all entity and storage policies gated; `profiles_select` gated with a self-read exception.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rls/policies.test.mjs`:

```js
test("a disabled user reads nothing from the business tables", async () => {
  await resetDb();
  const admin = await signUp("admin@test.dev", "Admin");
  const victim = await signUp("victim@test.dev", "Victim");
  await admin.from("accounts").insert({ id: "a1", data: { name: "Acme" } });

  // Prove the session WORKS before disabling. Without this the assertion below passes
  // just as happily against a broken client, proving nothing.
  const before = await victim.from("accounts").select("id");
  assert(!before.error && before.data.length === 1,
    `victim should read 1 account before being disabled, got ${JSON.stringify(before)}`);

  await admin.from("profiles").update({ disabled: true }).eq("id", victim.userId);

  // Same client, same token — no re-login. This is the live-session revocation.
  const after = await victim.from("accounts").select("id");
  assert(!after.error && after.data.length === 0,
    `disabled user should read 0 accounts, got ${JSON.stringify(after)}`);
});

test("a disabled user cannot insert", async () => {
  await resetDb();
  const admin = await signUp("admin@test.dev", "Admin");
  const victim = await signUp("victim@test.dev", "Victim");
  const ok = await victim.from("accounts").insert({ id: "pre", data: { name: "Pre" } });
  assert(!ok.error, `victim should insert before being disabled, got: ${ok.error && ok.error.message}`);

  await admin.from("profiles").update({ disabled: true }).eq("id", victim.userId);
  const { error } = await victim.from("accounts").insert({ id: "post", data: { name: "Post" } });
  assert(error, "disabled user should not be able to insert");
});

test("a disabled user can still read their OWN profile, and no other", async () => {
  await resetDb();
  const admin = await signUp("admin@test.dev", "Admin");
  const victim = await signUp("victim@test.dev", "Victim");
  await admin.from("profiles").update({ disabled: true }).eq("id", victim.userId);

  // Root() needs this row to tell the user they have been disabled. Deny it and they
  // hang on "Loading profile…" instead.
  const own = await victim.from("profiles").select("id,disabled").eq("id", victim.userId).single();
  assert(!own.error && own.data.disabled === true,
    `disabled user must read their own profile, got ${JSON.stringify(own)}`);

  const all = await victim.from("profiles").select("id");
  assert(!all.error && all.data.length === 1,
    `disabled user should see only their own profile, got ${JSON.stringify(all)}`);
});

test("a disabled admin loses admin powers", async () => {
  await resetDb();
  const a1 = await signUp("a1@test.dev", "A1");
  const a2 = await signUp("a2@test.dev", "A2");
  await a1.from("profiles").update({ role: "admin" }).eq("id", a2.userId);
  await a1.from("accounts").insert({ id: "a1", data: { name: "Acme" } });
  await a1.from("profiles").update({ disabled: true }).eq("id", a2.userId);

  // accounts_delete is admin-only; a disabled admin must not pass is_admin().
  await a2.from("accounts").delete().eq("id", "a1");
  const { data } = await a1.from("accounts").select("id").eq("id", "a1");
  assert(data.length === 1, "a disabled admin should not have been able to delete the account");
});

test("re-enabling a user restores access", async () => {
  await resetDb();
  const admin = await signUp("admin@test.dev", "Admin");
  const victim = await signUp("victim@test.dev", "Victim");
  await admin.from("accounts").insert({ id: "a1", data: { name: "Acme" } });
  await admin.from("profiles").update({ disabled: true }).eq("id", victim.userId);
  await admin.from("profiles").update({ disabled: false }).eq("id", victim.userId);
  const { data, error } = await victim.from("accounts").select("id");
  assert(!error && data.length === 1, `re-enabled user should read again, got ${JSON.stringify({ data, error })}`);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd tests/rls && node run.mjs`
Expected: the first, second, fourth and fifth FAIL (policies are still `using (true)`, so a disabled user reads and writes everything). The third may already pass — `profiles_select` is `using (true)` today — but it is the regression guard for Step 3 and must keep passing afterwards.

- [ ] **Step 3: Gate the policies**

`is_admin()` — add the disabled check:

```sql
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and not disabled) $$;
```

`profiles_select` — the one deliberate exception:

```sql
-- A disabled user must still read their OWN row (and only it), so Root() can tell them
-- their access was removed. Gate it flatly and their profile fetch errors instead, leaving
-- them stuck on "Loading profile…" — the opposite of a clean sign-out.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.is_active() or id = auth.uid());
```

The entity loop — replace `true` with `public.is_active()` in all three policies:

```sql
foreach t in array array['accounts','contacts','activities','tasks','opportunities'] loop
  execute format('drop policy if exists %1$s_select on public.%1$I', t);
  execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.is_active())', t);
  execute format('drop policy if exists %1$s_insert on public.%1$I', t);
  execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.is_active())', t);
  execute format('drop policy if exists %1$s_update on public.%1$I', t);
  execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.is_active()) with check (public.is_active())', t);
end loop;
```

The child-table delete loop, same substitution:

```sql
execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.is_active())', t);
```

`accounts_delete` already uses `is_admin()`, which now includes the disabled check — no edit needed there.

Storage (supabase-setup.sql:467-476) — easy to miss, since it sits apart from the loops:

```sql
drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects
  for select to authenticated using (bucket_id = 'attachments' and public.is_active());
drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'attachments' and public.is_active());
drop policy if exists attachments_delete on storage.objects;
create policy attachments_delete on storage.objects
  for delete to authenticated using (bucket_id = 'attachments' and public.is_active());
```

- [ ] **Step 4: Run the whole RLS suite**

Run: `cd tests/rls && node run.mjs`
Expected: all five new tests PASS **and every pre-existing test still passes** — especially "any authenticated user can read every business table" and "an anonymous client can read nothing". This step rewrites live security policy; a regression here is the serious failure mode, not the new tests.

- [ ] **Step 5: Commit**

```bash
git add supabase-setup.sql tests/rls/policies.test.mjs
git commit -m "Gate every RLS and storage policy on is_active() so disabling revokes a live session"
```

---

### Task 3: `admin_user_list()` and `admin_set_user_email()`

**Files:**
- Modify: `supabase-setup.sql` (append after the existing helper functions, before the storage section)
- Test: `tests/rls/auth.test.mjs`

**Interfaces:**
- Consumes: `public.is_admin()` (Task 2 version, disabled-aware).
- Produces: `public.admin_user_list() returns table(id uuid, name text, role text, disabled boolean, email text)`; `public.admin_set_user_email(p_id uuid, p_email text) returns void`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rls/auth.test.mjs`:

```js
test("admin_user_list returns every user with their email", async () => {
  await resetDb();
  const admin = await signUp("admin@test.dev", "Admin");
  await signUp("plain@test.dev", "Plain");
  const { data, error } = await admin.rpc("admin_user_list");
  assert(!error, `admin_user_list failed: ${error && error.message}`);
  const emails = (data || []).map(r => r.email).sort();
  assert(emails.join(",") === "admin@test.dev,plain@test.dev",
    `unexpected emails: ${JSON.stringify(emails)}`);
});

test("a non-admin cannot call admin_user_list", async () => {
  await resetDb();
  await signUp("admin@test.dev", "Admin");
  const plain = await signUp("plain@test.dev", "Plain");
  const { error } = await plain.rpc("admin_user_list");
  assert(error, "expected admin_user_list to refuse a non-admin");
});

test("a non-admin cannot change anyone's email", async () => {
  await resetDb();
  await signUp("admin@test.dev", "Admin");
  const plain = await signUp("plain@test.dev", "Plain");
  const { error } = await plain.rpc("admin_set_user_email",
    { p_id: plain.userId, p_email: "hacked@test.dev" });
  assert(error, "expected admin_set_user_email to refuse a non-admin");
});

test("admin_set_user_email rejects a duplicate address", async () => {
  await resetDb();
  const admin = await signUp("admin@test.dev", "Admin");
  const plain = await signUp("plain@test.dev", "Plain");
  const { error } = await admin.rpc("admin_set_user_email",
    { p_id: plain.userId, p_email: "admin@test.dev" });
  assert(error, "expected a duplicate email to be refused");
  assert(/already in use/i.test(error.message), `unexpected message: ${error.message}`);
});

test("admin_set_user_email rejects a malformed address", async () => {
  await resetDb();
  const admin = await signUp("admin@test.dev", "Admin");
  const plain = await signUp("plain@test.dev", "Plain");
  const { error } = await admin.rpc("admin_set_user_email",
    { p_id: plain.userId, p_email: "not-an-email" });
  assert(error, "expected a malformed email to be refused");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd tests/rls && node run.mjs`
Expected: all five FAIL with a PostgREST "function does not exist" error.

- [ ] **Step 3: Write the functions**

```sql
-- ---------- admin user management ----------
-- profiles has no email column; addresses live in auth.users, which the browser cannot
-- read. Definer rights are what make this join possible at all -- the same reason
-- alert_recipients() in email-alerts.sql is a definer function.
create or replace function public.admin_user_list()
returns table(id uuid, name text, role text, disabled boolean, email text)
language plpgsql security definer set search_path = public, auth as $$
begin
  -- A definer function runs as its owner and bypasses RLS, so it must assert its own
  -- authorisation. Relying on the caller's policies here would expose every address.
  if not public.is_admin() then
    raise exception 'admin_user_list: admin only';
  end if;
  return query
    select p.id, p.name, p.role, p.disabled, u.email::text
    from profiles p join auth.users u on u.id = p.id
    order by p.created_at;
end $$;

create or replace function public.admin_set_user_email(p_id uuid, p_email text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  addr text := lower(trim(p_email));
begin
  if not public.is_admin() then
    raise exception 'admin_set_user_email: admin only';
  end if;
  if addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'admin_set_user_email: % is not a valid email address', p_email;
  end if;
  if exists (select 1 from auth.users where lower(email) = addr and id <> p_id) then
    raise exception 'admin_set_user_email: % is already in use', addr;
  end if;
  if not exists (select 1 from profiles where id = p_id) then
    raise exception 'admin_set_user_email: no such user';
  end if;

  update auth.users
     set email = addr,
         -- Bypassing GoTrue's confirm-change flow is a deliberate decision (spec §6).
         -- Leaving a pending change behind would let a stale confirmation link later
         -- overwrite the address an admin just set.
         email_change = '',
         email_change_token_new = '',
         email_change_token_current = '',
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = p_id;

  -- GoTrue ALSO keeps the address inside auth.identities.identity_data, and resolves
  -- some sign-in paths through it. Updating only auth.users can leave the identity
  -- stale, which is how a user ends up unable to log in with EITHER address. Task 4
  -- proves which behaviour is real; keep both in step regardless.
  update auth.identities
     set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(addr)),
         updated_at = now()
   where user_id = p_id and provider = 'email';
end $$;

revoke execute on function public.admin_user_list() from public;
revoke execute on function public.admin_set_user_email(uuid, text) from public;
grant execute on function public.admin_user_list() to authenticated;
grant execute on function public.admin_set_user_email(uuid, text) to authenticated;
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd tests/rls && node run.mjs`
Expected: all five new tests PASS, whole suite green.

- [ ] **Step 5: Commit**

```bash
git add supabase-setup.sql tests/rls/auth.test.mjs
git commit -m "Add admin_user_list and admin_set_user_email definer functions"
```

---

### Task 4: Prove the email change actually works against real GoTrue

**Files:**
- Test: `tests/rls/auth.test.mjs`
- Modify (only if the test demands it): `supabase-setup.sql`

**Interfaces:**
- Consumes: `public.admin_set_user_email` from Task 3.

This task exists because spec §6 records an unresolved risk. It is the deciding test, not coverage of a settled question. **Do not skip it if Task 3's tests pass — those tests never attempt a login.**

- [ ] **Step 1: Write the test**

```js
test("after an email change the new address signs in and the old one does not", async () => {
  await resetDb();
  const admin = await signUp("admin@test.dev", "Admin");
  const plain = await signUp("plain@test.dev", "Plain");

  const { error: rpcErr } = await admin.rpc("admin_set_user_email",
    { p_id: plain.userId, p_email: "moved@test.dev" });
  assert(!rpcErr, `email change failed: ${rpcErr && rpcErr.message}`);

  const fresh = newClient();
  const good = await fresh.auth.signInWithPassword({ email: "moved@test.dev", password: PASSWORD });
  assert(!good.error && good.data.session,
    `new address must sign in, got: ${good.error && good.error.message}`);

  const stale = newClient();
  const bad = await stale.auth.signInWithPassword({ email: "plain@test.dev", password: PASSWORD });
  assert(bad.error, "old address must no longer sign in");
});
```

Import `newClient` and `PASSWORD` from `./fixtures.mjs` — check how the file's existing tests obtain a client and follow that; `newClient` may not currently be exported, in which case export it.

- [ ] **Step 2: Run it**

Run: `cd tests/rls && node run.mjs`
Expected: **unknown — this is the experiment.** Three outcomes, each with a different response:

1. **Passes.** The `auth.identities` update in Task 3 was correct and necessary. Leave it; the comment already explains why.
2. **Fails on the new address not signing in.** Investigate what GoTrue actually reads. Query `auth.identities` for the user and compare `identity_data->>'email'` to `auth.users.email`. Fix `admin_set_user_email` until this test passes.
3. **Fails on the old address still signing in.** The identity was not updated. Same investigation.

Do not weaken the test to make it pass. If the address cannot be changed safely from SQL, stop and report — spec §6 anticipated this, and the honest outcome is to fall back to read-only email display rather than ship a function that locks people out of their accounts.

- [ ] **Step 3: Commit**

```bash
git add tests/rls/auth.test.mjs supabase-setup.sql
git commit -m "Prove an admin email change works against real GoTrue sign-in"
```

---

### Task 5: UsersCard — show email, disable/enable, edit both fields

**Files:**
- Modify: `crm.html` (`UsersCard` at :3382-3479; `Root` at :3949-3975)
- Test: `tests/health/settings.test.mjs`

**Interfaces:**
- Consumes: `admin_user_list()`, `admin_set_user_email()` from Task 3; `profiles.disabled` from Task 1.

- [ ] **Step 1: Write the failing test**

Append to `tests/health/settings.test.mjs`, following the seeding style already in that file. The health harness mocks Supabase, so `admin_user_list` must be added to the mock's `rpc` handler in `tests/health/harness.mjs` — return `window.__seedUsers || []`.

```js
test("Users card shows each user's email and a disable control", async () => {
  const { page, browser } = await launch(
    `window.__seedUsers = [
       { id: "u1", name: "Test User", role: "admin", disabled: false, email: "admin@test.dev" },
       { id: "u2", name: "Priya", role: "user", disabled: false, email: "priya@test.dev" }
     ];`);
  await page.click('text=Settings');
  const txt = await rootText(page);
  assert(/priya@test\.dev/.test(txt), "user email should be listed");
  assert(/disable/i.test(txt), "disable control missing");
  await browser.close();
});

test("a disabled user is marked as such and offers re-enable", async () => {
  const { page, browser } = await launch(
    `window.__seedUsers = [
       { id: "u1", name: "Test User", role: "admin", disabled: false, email: "admin@test.dev" },
       { id: "u2", name: "Priya", role: "user", disabled: true, email: "priya@test.dev" }
     ];`);
  await page.click('text=Settings');
  const txt = await rootText(page);
  assert(/disabled/i.test(txt), "disabled badge missing");
  assert(/enable/i.test(txt), "re-enable control missing");
  await browser.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node build.mjs && node tests/health/run-one.mjs settings.test.mjs`
Expected: FAIL — no email is rendered and no disable control exists.

- [ ] **Step 3: Switch the card to `admin_user_list` and add the controls**

In `UsersCard`, replace `load`:

```js
const load = () => sb.rpc("admin_user_list").then(({ data, error }) =>
  error ? setErr(error.message) : setUsers(data || []));
```

Add the disable toggle. Note the copy: "access removed", never "cannot sign in" — GoTrue still issues a token (spec §3):

`ConfirmDialog` (crm.html:2185) is a **rendered component**, not an awaitable helper — its
props are `{title, body, confirmLabel, tone, typedWord, onConfirm, onClose}`. Follow the
existing `confirmDoc` pattern at crm.html:1169: hold the pending subject in state and render
the dialog conditionally. Re-enabling needs no confirmation.

```js
const [confirmDisable, setConfirmDisable] = useState(null); // the user pending disable

const applyDisabled = async (u, disabled) => {
  setErr(""); setMsg("");
  const { error } = await sb.from("profiles").update({ disabled }).eq("id", u.id);
  if (error) setErr(error.message);
  else { setMsg(`${u.name} ${disabled ? "disabled — their access is revoked" : "re-enabled"}.`); load(); }
};
```

and inside the returned JSX, alongside the existing cards:

```jsx
{confirmDisable && <ConfirmDialog
  title={`Disable ${confirmDisable.name}?`}
  body="They lose access to every account, task and file immediately — even if they are signed in right now. You can re-enable them at any time."
  confirmLabel="Disable"
  onConfirm={async () => { await applyDisabled(confirmDisable, true); setConfirmDisable(null); }}
  onClose={() => setConfirmDisable(null)} />}
```

The `disable` button calls `setConfirmDisable(u)`; the `enable` button calls
`applyDisabled(u, false)` directly.

Extend the ✎ editor to carry an email. `setEditing({ id, name, email })`, add a second `Input` bound to `editing.email`, and in `saveRename` after the name update:

```js
if (editing.email.trim().toLowerCase() !== (u.email || "").toLowerCase()) {
  const { error } = await sb.rpc("admin_set_user_email",
    { p_id: u.id, p_email: editing.email.trim() });
  if (error) throw error;
}
```

Render per row: the email under the name in `text-xs text-slate-500`; a `disabled` badge when `u.disabled`; and a `disable`/`enable` button beside the existing role controls, hidden for `u.id === me.id` (the trigger refuses it anyway — this just avoids offering a button that always errors). Give a disabled row a muted style (`opacity-60`).

Update the card's footer help text: it currently says removal is only possible via the Supabase dashboard, which is no longer the whole truth.

- [ ] **Step 4: Run to verify they pass**

Run: `node build.mjs && node tests/health/run-one.mjs settings.test.mjs`
Expected: both new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/settings.test.mjs tests/health/harness.mjs
git commit -m "Users card: show email, edit it, and disable or re-enable a user"
```

---

### Task 6: Eject a disabled user, and drop them from assignment lists

**Files:**
- Modify: `crm.html` (`Root` at :3949-3975; CSM/owner option lists; `email-alerts.sql` `alert_recipients()`)
- Test: `tests/health/settings.test.mjs`

**Interfaces:**
- Consumes: `profiles.disabled`, and the `profiles_select` self-read exception from Task 2.

- [ ] **Step 1: Write the failing test**

```js
test("a disabled user is ejected instead of seeing the app", async () => {
  const { page, browser } = await launch(
    `window.__seedProfile = { id: "u1", name: "Test User", role: "user", disabled: true };`);
  const txt = await rootText(page);
  assert(/access/i.test(txt) && /removed/i.test(txt),
    `expected an access-removed message, got: ${txt.slice(0, 200)}`);
  assert(!/Dashboard/.test(txt), "a disabled user must not reach the app shell");
  await browser.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node build.mjs && node tests/health/run-one.mjs settings.test.mjs`
Expected: FAIL — the app renders normally for a disabled profile.

- [ ] **Step 3: Eject them in `Root`**

Add `disabled` to the profile select — without it the check below reads `undefined` and never fires:

```js
sb.from("profiles").select("id,name,role,disabled").eq("id", session.user.id).single()
```

And before the `App` render:

```js
// The RLS policies are the real boundary -- a disabled user's queries already return
// nothing. This is the humane surface on top: say what happened instead of rendering an
// app with no data in it. Deliberately NOT worded "cannot sign in": GoTrue still issues
// them a token (see the design doc, §3); what they have lost is access.
if (profile.disabled) return (
  <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-slate-600">
    <p className="font-semibold text-slate-900">Your access has been removed.</p>
    <p>Ask an administrator to re-enable your account.</p>
    <button className="nm-btn px-3 py-1.5 text-xs font-semibold" onClick={() => sb.auth.signOut()}>Sign out</button>
  </div>
);
```

- [ ] **Step 4: Drop disabled users from assignment lists and digests**

`st.team` is not a separate table — it is the `profiles` rows, loaded as the 7th query in
`fetchAll` (crm.html:407). So add `disabled` there:

```js
sb.from("profiles").select("id,name,role,disabled"),
```

Then filter the option lists at the two places that build them:

- crm.html:1231 (`owners`, task owner) → `...team.filter(u => !u.disabled).map(u => u.name)`
- crm.html:1297 (`csmOptions`, account CSM) → same

Both lines already fold the *currently assigned* name into the set separately
(`acct.csm`, `existing.owner`), so an account already assigned to a now-disabled CSM keeps
displaying that name instead of silently blanking. Preserve that — filter only the
team-derived part of each list, never the stored value.

Leave crm.html:2210 (`names`) alone unless the test shows otherwise; check what it feeds
before changing it.

In `email-alerts.sql`, add to `alert_recipients()`:

```sql
where u.email is not null and not p.disabled
```

- [ ] **Step 5: Run the full suites**

Run: `node build.mjs && node tests/health/run.mjs` then `cd tests/rls && node run.mjs`
Expected: both green.

- [ ] **Step 6: Commit**

```bash
git add crm.html email-alerts.sql tests/health/settings.test.mjs
git commit -m "Eject disabled users from the app and from assignment lists and digests"
```

---

### Task 7: Documentation and rollout note

**Files:**
- Modify: `TEAM-SETUP.md`
- Modify: `docs/superpowers/specs/2026-08-25-user-disable-and-email-design.md` (status line)

- [ ] **Step 1: Document the rollout**

Add to `TEAM-SETUP.md`, in the style of the existing sections: re-run `supabase-setup.sql` whole, top to bottom, in the Supabase SQL editor. State plainly that this run **rewrites live RLS policies** rather than only adding to them, that a partial run leaves policies referencing a column that does not exist, and that the visible failure mode is everyone losing access at once — which is obvious and reversible by completing the run.

Also record the §3 limitation for whoever operates this: a disabled user can still obtain a token; what they lose is access. If a hard sign-in block is ever required, that needs GoTrue's admin API.

- [ ] **Step 2: Flip the spec status**

Change `Status: approved, not yet implemented` to `Status: implemented` with the PR number once merged.

- [ ] **Step 3: Commit**

```bash
git add TEAM-SETUP.md docs/superpowers/specs/2026-08-25-user-disable-and-email-design.md
git commit -m "Document the disable rollout and its one limitation"
```

---

## Verification before opening the PR

- [ ] `node build.mjs` — clean
- [ ] `node tests/health/run.mjs` — all pass (271 before this work; expect 275+)
- [ ] `cd tests/rls && node run.mjs` — all pass, including every pre-existing policy test
- [ ] Task 4's sign-in test genuinely ran and passed — the email feature is unproven without it
- [ ] No UI copy anywhere claims a disabled user "cannot sign in"
