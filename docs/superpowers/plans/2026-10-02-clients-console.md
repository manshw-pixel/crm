# Super-Admin Client Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The platform admin signs in to a client console, where they can list, add, open, enable and disable client orgs (OneVio included). Disabling a client fully locks out its users.

**Architecture:** One boolean, `orgs.disabled`, is enforced at the single RLS chokepoint. A new `org_enabled()` helper is ANDed into both `is_active()` and `is_admin()`, so every policy and every definer RPC that gates on them inherits the lockout. The platform admin is exempt. The email dispatcher skips disabled orgs. In `crm.html`, `Root` routes a platform admin to a new `ClientConsole` screen unless a session-scoped "in client" flag is set. `PlatformCard` leaves Settings.

**Tech Stack:** Supabase Postgres (plpgsql, RLS), a single-file React app (`crm.html`, Babel in-browser), Playwright health suite (`tests/health`), pg + supabase-js RLS suite (`tests/rls`).

**Spec:** `docs/superpowers/specs/2026-10-02-clients-page-design.md`

## Global Constraints

- All SQL is additive and idempotent: `add column if not exists`, `create or replace`, and `drop function if exists` only where a return type changes. The file must survive a re-run.
- Keep `crm.html` changes additive to existing behaviour. Create-client messages and the `create_org` → `signUpUser` order stay exactly as in today's `PlatformCard`.
- Home org id: `00000000-0000-0000-0000-000000000001` (OneVio). It can be disabled, but only behind the extra warning.
- Session flag key: `onevio.inClient`. Every `sessionStorage` access goes through try/catch, and the fallback is the console.
- Copy, verbatim:
  - Lockout heading: "Your organisation's access is suspended."; sub-line: "Contact your provider to restore it."
  - Disable confirm body: "All N users lose access immediately. Their data is kept and re-enabling restores it."
  - Extra sentence for OneVio: "This is your own company's workspace — OneVio's CSMs and admins will be locked out too. Your super-admin login is not affected."
- RLS tests: every absence assertion is preceded by a positive control on the same session with real data behind it. No test may leave an org disabled (`finally`).
- `tests/rls` cannot run locally (no Docker). It runs in CI on a **draft PR**, never through `workflow_dispatch`. `tests/health` runs locally with `node tests/health/run-one.mjs <file>`, and the full gate is `node tests/health/run.mjs > out.txt 2>&1` (never pipe it).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `clients-page`.
- A new test file must be added to the hardcoded import list in its suite's `run.mjs`.

## Review Focus

1. **A disabled client's ADMIN, not just its users.** `is_admin()` gates settings writes, profile updates, invites, account deletes and four RPCs. If only `is_active()` changes, the admin keeps writing. Pinned in Task 1 (the admin test).
2. **Disabling OneVio while the super admin's profile sits in OneVio.** The super admin must keep reading OneVio's data and keep calling platform RPCs. Pinned in Task 1 (the platform test).
3. **Reload inside a client, and sign-out then sign-in.** A reload must stay inside the client. A fresh sign-in must land on the console. Pinned in Task 4.
4. **Opening the org the super admin is already in.** `switch_org` + reload is pointless here and would flash the screen. Open should just enter. Pinned in Task 4.
5. **The lockout screen must not flash the empty app first.** The org check finishes before `setProfile`. Pinned in Task 3 (it waits for the screen, then asserts no Dashboard).

---

### Task 1: Database lockout: `orgs.disabled`, `org_enabled()`, `set_org_disabled`, `list_orgs.disabled`

**Files:**
- Modify: `supabase-setup.sql` (after the `orgs` table at ~17; after `is_platform_admin` at ~91; `is_admin` ~148; `is_active` ~156; `list_orgs` ~968; grants ~981-990; header comment ~10-12)
- Create: `tests/rls/orgdisable.test.mjs`
- Modify: `tests/rls/run.mjs` (register the file after `./orgs.test.mjs`)

**Interfaces:**
- Produces: column `orgs.disabled boolean not null default false`; `public.org_enabled() returns boolean`; `public.set_org_disabled(p_org_id uuid, p_disabled boolean) returns void` (raises `set_org_disabled: platform admin only` / `set_org_disabled: no such org`); `public.list_orgs()` returning `(id uuid, name text, created_at timestamptz, users int, disabled boolean)`.

- [ ] **Step 1: Write the failing tests** in `tests/rls/orgdisable.test.mjs`

```js
// Client disable = full lockout. Every absence assertion is preceded by a positive control
// on the same session (see rls-anon-key-vacuity), and every test re-enables in `finally`
// because tests/rls has no per-test reset.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, seedAccount, valueOf, orgOf, ORG_A, ORG_B } from "./fixtures.mjs";

const setDisabled = (org, d) => sql(`update public.orgs set disabled = $2 where id = $1`, [org, d]);
async function whileDisabled(org, fn) {
  await setDisabled(org, true);
  try { await fn(); } finally { await setDisabled(org, false); }
}
const TABLES = ["accounts", "contacts", "activities", "tasks", "opportunities", "settings"];

test("a disabled org's user reads and writes nothing; other orgs are untouched; re-enable restores", async () => {
  await seedAccount("dis-b", { name: "B row" }, ORG_B);
  await seedAccount("dis-a", { name: "A row" }, ORG_A);
  const before = await sessions.userB.from("accounts").select("id").eq("id", "dis-b");
  assert(before.data?.length === 1, `precondition: org B user cannot read its own row (${before.error?.message})`);
  await whileDisabled(ORG_B, async () => {
    for (const t of TABLES) {
      const { data } = await sessions.userB.from(t).select("*");
      assert((data || []).length === 0, `${t}: a disabled org's user still reads rows`);
    }
    const ins = await sessions.userB.from("tasks").insert({ id: "dis-t", data: { title: "x" } });
    assert(ins.error, "a disabled org's user inserted a task");
    const m = await sessions.userB.rpc("merge_row", { tbl: "accounts", row_id: "dis-b", patch: { name: "hacked" }, appends: {} });
    assert(m.error, "merge_row succeeded for a disabled org's user");
    assert((await valueOf("accounts", "dis-b", ORG_B)).name === "B row", "a disabled org's row was changed");
    const h = await sessions.userB.rpc("record_health", { p_scores: [{ accountId: "dis-b", score: 1 }] });
    assert(h.error || h.data === 0, `record_health wrote for a disabled org: ${JSON.stringify(h.data)}`);
    const other = await sessions.user.from("accounts").select("id").eq("id", "dis-a");
    assert(other.data?.length === 1, "disabling org B locked out org A");
  });
  const after = await sessions.userB.from("accounts").select("id").eq("id", "dis-b");
  assert(after.data?.length === 1, "re-enabling did not restore access");
});

test("a disabled org's ADMIN cannot write settings, update profiles, invite or list users", async () => {
  const pre = await sessions.adminB.rpc("admin_user_list");
  assert(!pre.error && pre.data.length >= 1, `precondition: org B admin cannot list users (${pre.error?.message})`);
  await whileDisabled(ORG_B, async () => {
    const list = await sessions.adminB.rpc("admin_user_list");
    assert(list.error || (list.data || []).length === 0, "admin_user_list answered for a disabled org");
    const inv = await sessions.adminB.rpc("invite_user", { p_email: "dis-invite@test.local", p_role: "user" });
    assert(inv.error, "invite_user succeeded for a disabled org");
    await sessions.adminB.from("settings").update({ data: { marker: "dis" } }).eq("org_id", ORG_B);
    const s = await sql(`select data from settings where org_id = $1`, [ORG_B]);
    assert(s[0]?.data?.marker !== "dis", "a disabled org's admin wrote settings");
    await sessions.adminB.from("profiles").update({ name: "Renamed by disabled admin" }).eq("org_id", ORG_B).eq("role", "user");
    const p = await sql(`select 1 from profiles where name = 'Renamed by disabled admin'`);
    assert(p.length === 0, "a disabled org's admin updated a profile");
  });
});

test("the platform admin keeps access inside a disabled org, including a disabled home org", async () => {
  const { platformId } = await sql(`select id as "platformId" from profiles where platform_admin`).then(r => r[0]);
  const home = await orgOf(platformId);
  await seedAccount("dis-pa", { name: "Seen by platform" }, ORG_B);
  try {
    await sql(`update profiles set org_id = $2 where id = $1`, [platformId, ORG_B]);
    await whileDisabled(ORG_B, async () => {
      const r = await sessions.platform.from("accounts").select("id").eq("id", "dis-pa");
      assert(r.data?.length === 1, `platform admin lost access to a disabled org (${r.error?.message})`);
    });
    await sql(`update profiles set org_id = $2 where id = $1`, [platformId, ORG_A]);
    await seedAccount("dis-home", { name: "Home row" }, ORG_A);
    await whileDisabled(ORG_A, async () => {
      const r = await sessions.platform.from("accounts").select("id").eq("id", "dis-home");
      assert(r.data?.length === 1, "disabling the home org locked out the platform admin");
      const l = await sessions.platform.rpc("list_orgs");
      assert(!l.error && l.data.find(o => o.id === ORG_A)?.disabled === true, `list_orgs: ${JSON.stringify(l.data || l.error)}`);
    });
  } finally {
    await sql(`update profiles set org_id = $2 where id = $1`, [platformId, home]);
  }
});

test("set_org_disabled works for the platform admin only, and a locked-out user can read the flag", async () => {
  const refused = await sessions.adminB.rpc("set_org_disabled", { p_org_id: ORG_B, p_disabled: true });
  assert(refused.error && /platform admin only/.test(refused.error.message), `org admin not refused: ${JSON.stringify(refused)}`);
  assert((await sql(`select disabled from orgs where id = $1`, [ORG_B]))[0].disabled === false, "the refused call changed the flag");
  try {
    const ok = await sessions.platform.rpc("set_org_disabled", { p_org_id: ORG_B, p_disabled: true });
    assert(!ok.error, `platform admin refused: ${ok.error?.message}`);
    const flag = await sessions.userB.from("orgs").select("disabled").eq("id", ORG_B).single();
    assert(flag.data?.disabled === true, `locked-out user cannot read their org flag: ${JSON.stringify(flag)}`);
    const back = await sessions.platform.rpc("set_org_disabled", { p_org_id: ORG_B, p_disabled: false });
    assert(!back.error, back.error?.message);
    assert((await sql(`select disabled from orgs where id = $1`, [ORG_B]))[0].disabled === false, "re-enable did not land");
    const none = await sessions.platform.rpc("set_org_disabled", { p_org_id: "00000000-0000-0000-0000-0000000000ff", p_disabled: true });
    assert(none.error && /no such org/.test(none.error.message), "unknown org not refused");
  } finally { await setDisabled(ORG_B, false); }
});
```

Register it in `tests/rls/run.mjs` right after `import "./orgs.test.mjs";`:

```js
import "./orgdisable.test.mjs";
```

- [ ] **Step 2: Implement the SQL** in `supabase-setup.sql`

After the `orgs` create table / `enable row level security` (~line 18), add:

```sql
-- Client disable (Clients console). A full, reversible lockout: org_enabled() below is
-- ANDed into is_active() AND is_admin(), so every policy and every definer RPC that gates
-- on either inherits it. Data is kept; re-enabling restores access.
alter table public.orgs add column if not exists disabled boolean not null default false;
```

After `is_platform_admin()` (~line 91), add:

```sql
-- True when the caller's org is not disabled, or the caller is the platform admin (who must
-- be able to open a disabled client, and must survive their own home org being disabled).
create or replace function public.org_enabled()
returns boolean language sql stable security definer set search_path = public as
$$ select public.is_platform_admin()
       or exists (select 1 from profiles p join orgs o on o.id = p.org_id
                  where p.id = auth.uid() and not o.disabled) $$;
```

Replace the bodies of `is_admin()` and `is_active()`:

```sql
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and not disabled)
          and public.org_enabled() $$;
```

```sql
create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and not disabled and org_id is not null)
          and public.org_enabled() $$;
```

Replace `list_orgs` (its return type changes) and add `set_org_disabled` after it:

```sql
drop function if exists public.list_orgs();
create or replace function public.list_orgs()
returns table(id uuid, name text, created_at timestamptz, users int, disabled boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'list_orgs: platform admin only';
  end if;
  return query
    select o.id, o.name, o.created_at,
           (select count(*)::int from profiles p where p.org_id = o.id and not p.disabled),
           o.disabled
    from orgs o order by o.created_at;
end $$;

-- Any org may be disabled, OneVio included: org_enabled() exempts the platform admin, so
-- this cannot lock its caller out.
create or replace function public.set_org_disabled(p_org_id uuid, p_disabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'set_org_disabled: platform admin only';
  end if;
  update orgs set disabled = p_disabled where id = p_org_id;
  if not found then
    raise exception 'set_org_disabled: no such org';
  end if;
end $$;
```

In the grants block (~981), add next to the `list_orgs` lines, and re-grant `list_orgs` because the drop removed its grant:

```sql
revoke execute on function public.set_org_disabled(uuid, boolean) from public, anon;
grant execute on function public.set_org_disabled(uuid, boolean) to authenticated;
```

Confirm `grant execute on function public.list_orgs() to authenticated;` exists after the revoke. Add it if it doesn't. Update the header comment at ~10-11 from "(Settings -> Platform)" to "(the Clients console a platform admin lands on)".

- [ ] **Step 3: Audit the remaining definer functions.** Confirm each verdict below by reading the function. Put any mismatch in the task report.
  - `current_org`, `valid_email`, `merge_patch`, `append_dedup`: no data access or no gate needed.
  - `merge_row`, `replace_all`: invoker, so the policies apply.
  - `record_health`: gates on `is_active()`.
  - `admin_user_list`, `admin_set_user_email`, `invite_user`: gate on `is_admin()`.
  - `log_error`: deliberately ungated, already documented.
  - `create_org`, `switch_org`, `list_orgs`, `set_org_disabled`: platform admin only.
  - `attach_orgless_login`: revoked from the API.
  - `handle_new_user`, `guard_*`: triggers. A sign-up into a disabled org is attached, but `is_active()` locks it out.
  - Email-alert functions: Task 2.
  - `renewal-alerts.sql`: superseded and unscheduled by `email-alerts-schedule.sql`, so no change.

- [ ] **Step 4: Run.** `tests/rls` needs Docker, which this machine lacks. Push the branch, open a **draft PR** (`gh pr create --draft --base master --body-file pr-clients.md`), and read the `rls` job. Expected: the 4 new tests PASS and the existing tests still pass. If you have a Docker machine: `node tests/rls/run.mjs > rls-out.txt 2>&1`.

- [ ] **Step 5: Prove the tests bite.** Temporarily drop `and public.org_enabled()` from `is_admin()` only. The admin test must FAIL (run in CI or locally). Restore the line. Note the result in the task report.

- [ ] **Step 6: Commit**

```bash
git add supabase-setup.sql tests/rls/orgdisable.test.mjs tests/rls/run.mjs
git commit -m "Lock out every user of a disabled client org"
```

---

### Task 2: Email alerts skip disabled orgs

**Files:**
- Modify: `email-alerts.sql` (add `alert_orgs()` near `alert_recipients` ~140; the dispatcher loop at ~376)
- Modify: `tests/rls/orgdisable.test.mjs` (append a test)

**Interfaces:**
- Consumes: `orgs.disabled` (Task 1).
- Produces: `public.alert_orgs() returns table(org_id uuid, enabled_kinds text[])`. Revoked from public, so only the dispatcher calls it.

- [ ] **Step 1: Write the failing test** (append to `tests/rls/orgdisable.test.mjs`)

```js
test("the email dispatcher's org list skips a disabled org", async () => {
  const pre = await sql(`select org_id from public.alert_orgs()`);
  assert(pre.some(r => r.org_id === ORG_B), "precondition: org B has no alert prefs, so this test proves nothing");
  await whileDisabled(ORG_B, async () => {
    const rows = await sql(`select org_id from public.alert_orgs()`);
    assert(!rows.some(r => r.org_id === ORG_B), "alert_orgs still returns a disabled org");
    assert(rows.some(r => r.org_id === ORG_A), "alert_orgs dropped an enabled org");
  });
});
```

- [ ] **Step 2: Implement.** In `email-alerts.sql`, after `alert_recipients`'s revoke (~168), add:

```sql
-- The orgs the dispatcher serves: those with prefs, minus any disabled client (a disabled
-- client's users are locked out of the app, so they get no email either).
create or replace function public.alert_orgs()
returns table(org_id uuid, enabled_kinds text[])
language sql stable security definer set search_path = public as $$
  select p.org_id, p.enabled_kinds
  from org_alert_prefs p join orgs o on o.id = p.org_id
  where not o.disabled
  order by p.org_id;
$$;
revoke execute on function public.alert_orgs() from public;
```

Change the dispatcher loop line (~376) from

```sql
  for o in select p.org_id, p.enabled_kinds from org_alert_prefs p order by p.org_id loop
```

to

```sql
  for o in select * from alert_orgs() loop
```

- [ ] **Step 3: Run.** Use the CI draft PR from Task 1 (push the new commit). Expected: the new test PASSes and every existing `emailalerts` test still passes.

- [ ] **Step 4: Commit**

```bash
git add email-alerts.sql tests/rls/orgdisable.test.mjs
git commit -m "Send no alert email to a disabled client"
```

---

### Task 3: Suspended screen for a disabled client's users

**Files:**
- Modify: `crm.html` `Root()` (~4302-4354: the profile effect at ~4313-4320, plus a new screen after the `!profile.org_id` block)
- Create: `tests/health/client-console.test.mjs`
- Modify: `tests/health/run.mjs` (register the file)

**Interfaces:**
- Consumes: the `orgs` row's `disabled` flag, readable through the existing `orgs_select` policy. The harness `orgsApi` already answers `select().eq().single()` from `window.__seedRows.orgs`.
- Produces: `Root` state `orgDisabled: boolean`; the screen carries `data-org-suspended`.

- [ ] **Step 1: Write the failing test** in `tests/health/client-console.test.mjs`

```js
import { test, assert } from "./framework.mjs";
import { launch, rootText } from "./harness.mjs";

const empty = `window.__seedRows = { accounts: [], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("a user of a disabled client sees the suspended screen, not the app", async () => {
  const { page, browser } = await launch(`${empty}
    window.__seedRows.orgs = [{ id: "org-a", name: "Acme Corp", disabled: true }];
    window.__seedProfile = { id: "u1", name: "Csm", role: "user", org_id: "org-a", platform_admin: false };`);
  await page.waitForSelector("[data-org-suspended]", { timeout: 15000 });
  const txt = await rootText(page);
  assert(txt.includes("Your organisation's access is suspended."), "suspended heading missing");
  assert(txt.includes("Contact your provider to restore it."), "suspended sub-line missing");
  assert(!/Dashboard/.test(txt), "the app rendered for a disabled client's user");
  await browser.close();
});

test("a user of an enabled client gets the app (control for the suspended test)", async () => {
  const { page, browser } = await launch(`${empty}
    window.__seedRows.orgs = [{ id: "org-a", name: "Acme Corp", disabled: false }];
    window.__seedProfile = { id: "u1", name: "Csm", role: "user", org_id: "org-a", platform_admin: false };`);
  await page.waitForSelector("aside >> text=Csm", { timeout: 15000 });
  assert(!(await page.$("[data-org-suspended]")), "suspended screen shown for an enabled client");
  await browser.close();
});
```

Add `import "./client-console.test.mjs";` to `tests/health/run.mjs` next to `./orgs.test.mjs`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/health/run-one.mjs client-console.test.mjs`
Expected: the first test FAILs (it times out waiting for `[data-org-suspended]`), and the control PASSes.

- [ ] **Step 3: Implement.** In `Root()`, add the state next to the others: `const [orgDisabled, setOrgDisabled] = useState(false);`. Replace the `.then(...)` of the profile effect with:

```js
      .then(async ({ data, error }) => {
        if (error) return window.__toast?.({ text: "Could not load your profile: " + error.message, tone: "error" }) ?? alert("Could not load your profile: " + error.message);
        // A disabled client's users are already locked out by RLS (org_enabled()). Resolve
        // the flag BEFORE setProfile so the suspended screen never flashes an empty app.
        // orgs_select does not depend on is_active(), so this read still works for them.
        let suspended = false;
        if (data.org_id && !data.platform_admin) {
          const { data: o } = await sb.from("orgs").select("disabled").eq("id", data.org_id).single();
          suspended = !!o?.disabled;
        }
        CURRENT_ORG = data.org_id; setOrgDisabled(suspended); setProfile(data);
      });
```

Keep the existing comment block above it about `alert`. After the `if (!profile.org_id) return (...)` block, add:

```js
  if (orgDisabled) return (
    <div data-org-suspended className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-slate-600">
      <p className="font-semibold text-slate-900">Your organisation's access is suspended.</p>
      <p>Contact your provider to restore it.</p>
      <button className="nm-btn px-3 py-1.5 text-xs font-semibold" onClick={() => sb.auth.signOut()}>Sign out</button>
    </div>
  );
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node tests/health/run-one.mjs client-console.test.mjs` and `node tests/health/run-one.mjs orgs.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/client-console.test.mjs tests/health/run.mjs
git commit -m "Show a suspended screen to users of a disabled client"
```

---

### Task 4: Client console on sign-in; Platform card out of Settings

**Files:**
- Modify: `crm.html`:
  - replace `PlatformCard` (~3608-3669) with `ClientConsole`;
  - remove `{user.platform_admin && <PlatformCard me={user} />}` (~3462);
  - in `App` (~3969), add the `onBackToClients` prop and a back link in the amber banner (~4226);
  - in `Root`, add routing and the sign-out flag clear.
- Modify: `tests/health/harness.mjs` (~82, the `set_org_disabled` mock)
- Modify: `tests/health/orgs.test.mjs` (the sidebar test plus the "Task 8: the Platform card" section)
- Modify: `tests/health/client-console.test.mjs` (append console tests)

**Interfaces:**
- Consumes: `list_orgs` rows `{id, name, created_at, users, disabled}` and `set_org_disabled({p_org_id, p_disabled})` (Task 1); `switch_org`, `create_org`, `signUpUser`, `signUpMessage`, `Card`, `Input`, `Btn`, `ConfirmDialog({title, body, confirmLabel, onConfirm, onClose})` (existing).
- Produces: `ClientConsole({ me, onEnter })`; `App({ user, onBackToClients })`; module helpers `inClientGet(): boolean` and `inClientSet(on: boolean): void`; constant `HOME_ORG`. Data hooks: `data-client-console`, `data-org-row={id}`, `data-org-disabled={id}`, `data-org-toggle={id}`, `data-open-org={id}`, `data-new-client`, `data-back-to-clients`.

- [ ] **Step 1: Add the harness mock.** In `tests/health/harness.mjs` after the `list_orgs` line (~82):

```js
      if (fn === "set_org_disabled") {
        const o = (window.__seedOrgs || []).find(x => x.id === args.p_org_id);
        if (o) o.disabled = args.p_disabled;
        return Promise.resolve({ data: null, error: null });
      }
```

- [ ] **Step 2: Write the failing tests.** Append to `tests/health/client-console.test.mjs`:

```js
const HOME = "00000000-0000-0000-0000-000000000001";
const seedConsole = (extra = "") => `${empty}
  window.__seedRows.orgs = [{ id: "${HOME}", name: "OneVio" }];
  window.__seedOrgs = [
    { id: "${HOME}", name: "OneVio", created_at: "2025-01-01", users: 12, disabled: false },
    { id: "org-b", name: "Beta Ltd", created_at: "2026-02-01", users: 1, disabled: false },
    { id: "org-c", name: "Gone Inc", created_at: "2026-03-01", users: 4, disabled: true }];
  window.__seedProfile = { id: "u1", name: "Owner", role: "admin", org_id: "${HOME}", platform_admin: true };
  ${extra}`;

test("a platform admin lands on the console, not the CRM; an org admin lands on the CRM", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.waitForSelector("[data-client-console] >> text=Beta Ltd", { timeout: 15000 });
  const txt = await page.textContent("[data-client-console]");
  assert(/OneVio/.test(txt) && /Gone Inc/.test(txt), "orgs not all listed");
  assert(/12 users/.test(txt) && /1 user\b/.test(txt), "user counts missing");
  assert(await page.$('[data-org-disabled="org-c"]'), "disabled badge missing");
  assert(!(await page.$('[data-org-disabled="org-b"]')), "enabled org badged as disabled");
  assert(!(await page.$('button[title="Settings"]')), "CRM nav rendered on the console");
  await browser.close();
  const admin = await launch(`${empty} window.__seedProfile = { id: "u1", name: "Admin", role: "admin", org_id: "org-a", platform_admin: false };`);
  await admin.page.waitForSelector('button[title="Settings"]', { timeout: 15000 });
  assert(!(await admin.page.$("[data-client-console]")), "console shown to an org admin");
  await admin.browser.close();
});

test("Settings no longer carries the platform card", async () => {
  const { page, browser } = await launch(seedConsole(`try { sessionStorage.setItem("onevio.inClient", "1"); } catch {}`));
  await page.click('button[title="Settings"]', { timeout: 15000 });
  await page.waitForSelector("text=Add user", { timeout: 15000 });
  assert(!(await page.$("[data-platform-card]")) && !(await page.$("[data-client-console]")), "clients UI still in Settings");
  await browser.close();
});

test("Open on another org sets the flag, calls switch_org and reloads", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.waitForSelector('[data-open-org="org-c"]', { timeout: 15000 });
  await page.evaluate(() => { window.__reloads = 0; window.__reload = () => window.__reloads++; });
  await page.click('[data-open-org="org-c"]');   // a disabled client can still be opened
  await page.waitForFunction(() => window.__reloads === 1);
  const [call] = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "switch_org"));
  assert(call.args.p_org_id === "org-c", JSON.stringify(call.args));
  assert(await page.evaluate(() => sessionStorage.getItem("onevio.inClient")) === "1", "in-client flag not set");
  await browser.close();
});

test("Open on the current org enters the CRM without switch_org; ← Clients returns to the console", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.click(`[data-open-org="${HOME}"]`, { timeout: 15000 });
  await page.waitForSelector('button[title="Settings"]', { timeout: 15000 });
  assert(!(await page.evaluate(() => (window.__rpcCalls || []).some(c => c.fn === "switch_org"))), "switch_org called for the current org");
  await page.click("[data-back-to-clients]");
  await page.waitForSelector("[data-client-console]", { timeout: 15000 });
  assert(await page.evaluate(() => sessionStorage.getItem("onevio.inClient")) === null, "flag not cleared on back");
  await browser.close();
});

test("a reload inside a client stays inside it", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.click(`[data-open-org="${HOME}"]`, { timeout: 15000 });
  await page.waitForSelector('button[title="Settings"]', { timeout: 15000 });
  await page.reload();
  await page.waitForSelector('button[title="Settings"]', { timeout: 15000 });
  assert(!(await page.$("[data-client-console]")), "reload dropped back to the console");
  await browser.close();
});

test("Disable confirms, calls set_org_disabled and shows the badge; Enable clears it", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.click('[data-org-toggle="org-b"]', { timeout: 15000 });
  await page.waitForSelector("text=All 1 users lose access immediately", { timeout: 15000 });
  assert(!(await page.$("text=This is your own company's workspace")), "OneVio warning shown for another client");
  await page.click('[role="dialog"] >> text=Disable');
  await page.waitForSelector('[data-org-disabled="org-b"]', { timeout: 15000 });
  const [call] = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "set_org_disabled"));
  assert(call.args.p_org_id === "org-b" && call.args.p_disabled === true, JSON.stringify(call.args));
  await page.click('[data-org-toggle="org-b"]');   // Enable: no confirm
  await page.waitForFunction(() => !document.querySelector('[data-org-disabled="org-b"]'));
  await browser.close();
});

test("disabling OneVio shows the extra warning", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.click(`[data-org-toggle="${HOME}"]`, { timeout: 15000 });
  await page.waitForSelector("text=This is your own company's workspace", { timeout: 15000 });
  assert(await page.$("text=Your super-admin login is not affected."), "reassurance sentence missing");
  await browser.close();
});

test("+ New client reveals the create form and creates through create_org", async () => {
  const { page, browser } = await launch(seedConsole());
  await page.click("[data-new-client]", { timeout: 15000 });
  await page.evaluate(() => { window.supabase.createClient = () => ({ auth: { signUp: async () => ({ data: { user: { identities: [{}], email_confirmed_at: null }, session: null }, error: null }) } }); });
  await page.fill('[data-client-console] input[placeholder="Client name"]', "Gamma Inc");
  await page.fill('[data-client-console] input[placeholder="Admin name"]', "Gina");
  await page.fill('[data-client-console] input[placeholder="Admin email"]', "gina@gamma.com");
  await page.fill('[data-client-console] input[placeholder="Temporary password"]', "secret12");
  await page.click("[data-client-console] >> text=Create client");
  await page.waitForSelector("[data-client-console] >> text=Gamma Inc created", { timeout: 15000 });
  await browser.close();
});
```

Check `ConfirmDialog`'s markup (`crm.html:2346`) for its root role or selector. If it isn't `role="dialog"`, change the `'[role="dialog"] >> text=Disable'` selector to whatever scopes to its confirm button. Don't add a role just for the test.

- [ ] **Step 3: Update `tests/health/orgs.test.mjs`.**
  - In "a platform admin sees the current org name in the sidebar", append `try { sessionStorage.setItem("onevio.inClient", "1"); } catch {}` to the platform admin's seed string, so it renders the CRM.
  - Delete the section from `// ---------- Task 8: the Platform card ----------` to the end of the file. Its four behaviours (listing, create/sign-up, create_org refusal, switch) are now covered in `client-console.test.mjs`.
  - Before deleting, move the two create-path tests over and retarget them: "New client with an existing org-less login reports it was added" and "create_org's refusal is shown and no sign-up is attempted". Change `[data-platform-card]` → `[data-client-console]`, use `seedConsole()`, and click `[data-new-client]` before filling the form.

- [ ] **Step 4: Run to verify the failures**

Run: `node tests/health/run-one.mjs client-console.test.mjs`
Expected: the new console tests FAIL (no `[data-client-console]`), and Task 3's two tests still PASS.

- [ ] **Step 5: Implement in `crm.html`.**

Module level, next to `IS_RECOVERY` or just above `function Root()`:

```js
// The platform admin's home org (OneVio). Disabling it is allowed, behind an extra warning.
const HOME_ORG = "00000000-0000-0000-0000-000000000001";
// Console routing for the platform admin. Session-scoped on purpose: every new sign-in
// starts at the console. Storage can throw (private mode, blocked site data); the fallback
// is the console, which is safe.
const IN_CLIENT_KEY = "onevio.inClient";
const inClientGet = () => { try { return sessionStorage.getItem(IN_CLIENT_KEY) === "1"; } catch { return false; } };
const inClientSet = on => { try { on ? sessionStorage.setItem(IN_CLIENT_KEY, "1") : sessionStorage.removeItem(IN_CLIENT_KEY); } catch {} };
```

Replace `function PlatformCard({ me }) { ... }` with:

```js
function ClientConsole({ me, onEnter }) {
  const [orgs, setOrgs] = useState([]);
  const [v, setV] = useState({ name: "", adminName: "", email: "", pass: "" });
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [confirmOrg, setConfirmOrg] = useState(null); // the org pending disable
  const load = () => sb.rpc("list_orgs").then(({ data, error }) => error ? setErr(error.message) : setOrgs(data || []));
  useEffect(() => { load(); }, []);
  const createClient = async e => {
    e.preventDefault(); setErr(""); setMsg("");
    if (!v.name.trim() || !v.adminName.trim() || !v.email.trim()) return setErr("Client name, admin name and admin email are required.");
    if (v.pass.length < 6) return setErr("Temporary password must be at least 6 characters.");
    setBusy(true);
    try {
      // create_org refuses a duplicate name, an address with an open invite and a login in
      // another workspace; its message goes to the user as-is. It attaches an org-less login.
      const { error } = await sb.rpc("create_org", { p_name: v.name.trim(), p_admin_email: v.email.trim() });
      if (error) throw error;
      // Otherwise it left an admin invite, which handle_new_user applies to this sign-up.
      // 'exists' can then only mean the org-less login create_org already attached.
      const { status } = await signUpUser({ email: v.email, pass: v.pass, name: v.adminName });
      setMsg(`${v.name.trim()} created. ` + (status === "exists"
        ? `Existing login added to it as admin: ${v.adminName.trim()} signs in with their current password.`
        : signUpMessage(v.adminName.trim(), "admin", status)));
      setV({ name: "", adminName: "", email: "", pass: "" });
    } catch (ex) { setErr(ex.message); }
    load();
    setBusy(false);
  };
  const open = async o => {
    setErr(""); setMsg("");
    // Already in this org: no switch, no reload -- just enter.
    if (o.id === me.org_id) { inClientSet(true); return onEnter(); }
    inClientSet(true);
    const { error } = await sb.rpc("switch_org", { p_org_id: o.id });
    if (error) { inClientSet(false); return setErr(error.message); }
    // window.__reload is a test seam: the health suite counts the reload instead of taking it.
    (window.__reload || (() => location.reload()))();
  };
  const applyDisabled = async (o, disabled) => {
    setErr(""); setMsg("");
    const { error } = await sb.rpc("set_org_disabled", { p_org_id: o.id, p_disabled: disabled });
    if (error) setErr(error.message);
    else { setMsg(`${o.name} ${disabled ? "disabled — its users have lost access" : "re-enabled"}.`); load(); }
  };
  return (
    <div data-client-console className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-900">OneVio Platform</h1>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{me.name}</span>
            <button className="nm-btn px-3 py-1.5 text-xs font-semibold" onClick={() => sb.auth.signOut()}>Sign out</button>
          </div>
        </div>
        <Card title={`Clients (${orgs.length})`}>
          {orgs.map(o => (
            <div key={o.id} data-org-row={o.id} className="flex items-center gap-3 border-b border-slate-100 py-2 text-sm last:border-0">
              <span className="flex-1">
                <div className="font-medium">{o.name}</div>
                <div className="text-xs text-slate-500">{o.users} user{o.users === 1 ? "" : "s"} · since {String(o.created_at).slice(0, 10)}</div>
              </span>
              {o.disabled
                ? <span data-org-disabled={o.id} className="rounded bg-rose-50 px-1.5 py-0.5 text-xs font-semibold text-rose-700">Disabled</span>
                : <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">Enabled</span>}
              <button data-org-toggle={o.id} className="text-xs font-bold text-slate-600 hover:underline"
                onClick={() => o.disabled ? applyDisabled(o, false) : setConfirmOrg(o)}>{o.disabled ? "Enable" : "Disable"}</button>
              <button data-open-org={o.id} className="text-xs font-bold text-indigo-600 hover:underline" onClick={() => open(o)}>Open</button>
            </div>
          ))}
          <div className="mt-3">
            {!showNew && <Btn data-new-client onClick={() => setShowNew(true)}>+ New client</Btn>}
            {showNew && <form onSubmit={createClient} className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Client name" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} />
              <Input placeholder="Admin name" value={v.adminName} onChange={e => setV({ ...v, adminName: e.target.value })} />
              <Input type="email" placeholder="Admin email" value={v.email} onChange={e => setV({ ...v, email: e.target.value })} />
              <Input type="password" placeholder="Temporary password" value={v.pass} onChange={e => setV({ ...v, pass: e.target.value })} />
              <div className="sm:col-span-2"><Btn kind="primary" type="submit" disabled={busy}>{busy ? "…" : "Create client"}</Btn></div>
            </form>}
          </div>
          {err && <div className="mt-2 text-xs text-rose-600">{err}</div>}
          {msg && <div className="mt-2 text-xs text-emerald-700">{msg}</div>}
          <p className="mt-2 text-xs text-slate-500">Each client is a separate workspace: its users see only its accounts. Open a client to work as its admin; use ← Clients to come back.</p>
        </Card>
      </div>
      {confirmOrg && <ConfirmDialog
        title={`Disable ${confirmOrg.name}?`}
        body={`All ${confirmOrg.users} users lose access immediately. Their data is kept and re-enabling restores it.`
          + (confirmOrg.id === HOME_ORG ? " This is your own company's workspace — OneVio's CSMs and admins will be locked out too. Your super-admin login is not affected." : "")}
        confirmLabel="Disable"
        onConfirm={async () => { await applyDisabled(confirmOrg, true); setConfirmOrg(null); }}
        onClose={() => setConfirmOrg(null)} />}
    </div>
  );
}
```

Check that `Btn` forwards unknown props (`data-new-client`) to its `<button>`. If it doesn't, wrap the button in `<span data-new-client>` and have the test click `[data-new-client] button`.

Settings (~3462): delete the line `{user.platform_admin && <PlatformCard me={user} />}`.

`App` (~3969): change the signature to `function App({ user, onBackToClients })`. Change the banner at ~4226 so the platform badge reads:

```js
{user.platform_admin && <div data-current-org className="mb-1 flex items-center gap-1 truncate rounded bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-700" title="You are viewing this workspace as platform admin">
  <button data-back-to-clients className="hover:underline" onClick={onBackToClients}>← Clients</button>
  <span className="truncate">· {orgName || "…"}</span>
</div>}
```

(The existing sidebar test reads `textContent` of `[data-current-org]` with `includes("Acme Corp")`, so that still passes.)

`Root`:
- state: `const [inClient, setInClient] = useState(inClientGet);`
- auth listener: `sb.auth.onAuthStateChange((e, s) => { if (e === "SIGNED_OUT") { inClientSet(false); setInClient(false); } setSession(s); })`
- after the `orgDisabled` block from Task 3 and before the final `return`:

```js
  // The platform admin works from the client console and enters a client explicitly.
  if (profile.platform_admin && !inClient) return <ToastProvider><ClientConsole me={profile} onEnter={() => setInClient(true)} /></ToastProvider>;
```

- the final return passes the prop: `<App user={profile} onBackToClients={() => { inClientSet(false); setInClient(false); }} />`

- [ ] **Step 6: Run to verify they pass**

Run: `node tests/health/run-one.mjs client-console.test.mjs` then `node tests/health/run-one.mjs orgs.test.mjs` then `node tests/health/run-one.mjs settings.test.mjs`
Expected: all PASS. Then run the full gate: `node tests/health/run.mjs > health-out.txt 2>&1` and read the tail. Expected: 0 failed. If you see `waitForSelector` timeouts across many unrelated files, that's an unpkg flake, so re-run before debugging.

- [ ] **Step 7: Prove the console tests bite.** Temporarily change `!inClient` to `false` in the Root routing line. The "lands on the console" test must FAIL. Restore it.

- [ ] **Step 8: Commit**

```bash
git add crm.html tests/health/harness.mjs tests/health/orgs.test.mjs tests/health/client-console.test.mjs
git commit -m "Land the platform admin on a client console with enable/disable"
```

---

### Task 5: Docs and PR

**Files:**
- Modify: `TEAM-SETUP.md` (any mention of Settings → Platform; add a short "Disabling a client" note)

- [ ] **Step 1:** Run `grep -n "Platform" TEAM-SETUP.md`. Reword each Settings → Platform reference to "the Clients console (where the platform admin lands after sign-in)". Add one paragraph: disabling a client locks out all its users immediately and keeps their data; Enable restores access; disabling OneVio locks out OneVio's own staff but not the platform admin; the database change requires re-running `supabase-setup.sql` **and then** `email-alerts.sql`.
- [ ] **Step 2:** Commit, push, and mark the draft PR ready once both CI jobs are green: `gh pr ready`. The PR body goes in `pr-clients.md` via `--body-file` and ends with the Claude Code attribution line.

```bash
git add TEAM-SETUP.md
git commit -m "Document the Clients console and client disable"
```
