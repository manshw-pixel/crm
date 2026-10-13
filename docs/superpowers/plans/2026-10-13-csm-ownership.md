# Admin-only CSM Assignment + "CSM since" Implementation Plan (PR 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only admins can change an account's CSM owner (enforced in the UI and by the database); a change records a "CSM since" date and a timeline entry; the header shows "since <date>".

**Architecture:** A pure lib helper strips owner keys (`csm`, `csmSince`, `leadId`) from non-admin account patches and builds the change summary. Every client path that can set `csm` (Edit/New account form, bulk Reassign CSM, CSV import incl. Drive sync) goes through it. A `before insert or update` trigger on `public.accounts` rejects owner-key changes by non-admins, mirroring the existing `guard_account_limit` / `guard_profile_org` patterns. No new tables.

**Tech Stack:** React globals in `src/NN-*.jsx`, pure ES modules in `src/lib`, Postgres (Supabase) in `supabase-setup.sql`, node:test unit tests, Playwright E2E (`tests/health`), RLS harness against a real local Supabase (`tests/rls`, run via `node tests/rls/run.mjs` in CI).

**Spec:** `docs/superpowers/specs/2026-10-13-custom-fields-ownership-leads-design.md` (section "PR 2"). `leadId` is guarded now so PR 3 inherits the guard; no Lead UI in this PR.

## Global Constraints

- Owner keys: exactly `csm`, `csmSince`, `leadId`.
- Admin = `user.role === "admin"` in the client; `public.is_admin()` in SQL.
- Contexts with no `auth.uid()` (SQL editor, cron, service role) pass the trigger — same rule as `guard_profile_org`.
- `merge_row` uses `insert … on conflict do update` for EVERY edit, so BEFORE INSERT fires on edits too: the insert branch must skip ids that already exist (exactly as `guard_account_limit` does).
- Non-admin creating an account: `csm` must be blank or the caller's `profiles.name`; `csmSince` allowed only alongside that; `leadId` must be absent/null.
- Timeline text exactly: `CSM changed from <A> to <B> by <admin name>`; from blank: `CSM set to <B> by <admin name>`.
- "CSM since" defaults to today (`iso(Date.now())`), admin-editable, stored as `YYYY-MM-DD`.
- Lock copy exactly: `Only admins can change this`.
- Error from trigger exactly: `Only an admin can change an account's CSM or Lead`.
- New E2E files need an `import` in `tests/health/run.mjs`; new RLS files need an `import` in `tests/rls/run.mjs` placed BEFORE `migration.test.mjs` (which must stay last).
- Additive: no behaviour change for admins except the new date field and timeline entry.

## Review Focus

1. **A CSM saving an unrelated edit on an account owned by someone else** (form sends the full row incl. unchanged `csm`) must succeed — the trigger's insert branch must not reject an existing id. (Task 2 RLS test "CSM edits ARR on an account owned by another CSM".)
2. **CSV import by a CSM with a `csm` column** must not change CSMs and must not make the write queue fail; new rows get the importer as CSM. (Task 4 E2E.)
3. **Admin changes CSM and back to the original in one form session** — no change, no timeline entry, `csmSince` untouched. (Task 3 E2E.)
4. **Admin edits other fields without touching CSM** — no timeline entry, no `csmSince` write. (Task 3 E2E.)
5. **A CSM opening "Reassign CSM" via bulk select** — the button isn't shown; the dialog cannot be reached. (Task 4 E2E.)

---

### Task 1: Pure helpers `src/lib/ownership.js`

**Files:**
- Create: `src/lib/ownership.js`
- Modify: `src/lib/index.js` (add `export * from "./ownership.js";` after the `custom-fields.js` line)
- Test: `tests/unit/ownership.test.mjs`

**Interfaces — Produces (globals in the app):**
- `OWNER_KEYS = ["csm", "csmSince", "leadId"]`
- `isAdminUser(user): boolean` — `!!user && user.role === "admin"`
- `stripOwnerKeys(patch, user): object` — returns `patch` unchanged for admins; for anyone else a shallow copy without the owner keys.
- `csmChangeSummary(from, to, by): string|null` — `null` when `(from||"") === (to||"")`; `"CSM set to B by X"` when `from` blank; else `"CSM changed from A to B by X"`.

- [ ] **Step 1: Write the failing test** — `tests/unit/ownership.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNER_KEYS, isAdminUser, stripOwnerKeys, csmChangeSummary } from "../../src/lib/ownership.js";

test("owner keys are exactly csm, csmSince, leadId", () => {
  assert.deepEqual(OWNER_KEYS, ["csm", "csmSince", "leadId"]);
});

test("isAdminUser", () => {
  assert.equal(isAdminUser({ role: "admin" }), true);
  assert.equal(isAdminUser({ role: "user" }), false);
  assert.equal(isAdminUser(null), false);
});

test("stripOwnerKeys keeps everything for admins, drops owner keys for others", () => {
  const p = { arr: 5, csm: "B", csmSince: "2026-10-13", leadId: "x", tier: "Mid" };
  assert.deepEqual(stripOwnerKeys(p, { role: "admin" }), p);
  assert.deepEqual(stripOwnerKeys(p, { role: "user" }), { arr: 5, tier: "Mid" });
  assert.deepEqual(stripOwnerKeys(p, null), { arr: 5, tier: "Mid" });
  assert.equal("csm" in p, true, "must not mutate the input");
});

test("csmChangeSummary", () => {
  assert.equal(csmChangeSummary("Priya", "Priya", "Admin"), null);
  assert.equal(csmChangeSummary("", "", "Admin"), null);
  assert.equal(csmChangeSummary(null, undefined, "Admin"), null);
  assert.equal(csmChangeSummary("", "Ravi", "Admin"), "CSM set to Ravi by Admin");
  assert.equal(csmChangeSummary("Priya", "Ravi", "Admin"), "CSM changed from Priya to Ravi by Admin");
  assert.equal(csmChangeSummary("Priya", "", "Admin"), "CSM changed from Priya to (none) by Admin");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/unit/ownership.test.mjs` → FAIL, module not found.

- [ ] **Step 3: Implement** — `src/lib/ownership.js`

```js
// Who may set an account's owners (spec 2026-10-13, PR 2). Admins only; the database trigger
// guard_account_owner enforces the same rule, this keeps the normal client path from tripping it.
export const OWNER_KEYS = ["csm", "csmSince", "leadId"];
export const isAdminUser = user => !!user && user.role === "admin";

export function stripOwnerKeys(patch, user) {
  if (isAdminUser(user)) return patch;
  const out = { ...patch };
  for (const k of OWNER_KEYS) delete out[k];
  return out;
}

export function csmChangeSummary(from, to, by) {
  const a = from || "", b = to || "";
  if (a === b) return null;
  return a ? `CSM changed from ${a} to ${b || "(none)"} by ${by}` : `CSM set to ${b} by ${by}`;
}
```

Add `export * from "./ownership.js";` to `src/lib/index.js` after the custom-fields line.

- [ ] **Step 4: Run tests** — `node --test tests/unit/ownership.test.mjs`, `npm run test:unit`, `npm run build` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ownership.js src/lib/index.js tests/unit/ownership.test.mjs
git commit -m "Ownership: pure helpers for admin-only CSM/Lead changes"
```

---

### Task 2: Database guard `guard_account_owner`

**Files:**
- Modify: `supabase-setup.sql` — add the function + trigger directly after the `guard_account_limit` trigger block (search for `create trigger guard_account_limit`).
- Test: `tests/rls/ownership.test.mjs` (new), `tests/rls/run.mjs` (import before `migration.test.mjs`)

**Interfaces:** Produces trigger error text `Only an admin can change an account's CSM or Lead`. Consumes `public.is_admin()`, `profiles.name`.

- [ ] **Step 1: Write the failing RLS test** — `tests/rls/ownership.test.mjs`

```js
// Admin-only owner fields on accounts (spec 2026-10-13 PR 2). Every block has a positive control.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, ORG_A, seedRow, valueOf } from "./fixtures.mjs";

const MSG = /Only an admin can change an account's CSM or Lead/;
const merge = (who, row_id, patch) => sessions[who].rpc("merge_row", { tbl: "accounts", row_id, patch, appends: {} });
const drop = id => sql(`delete from public.accounts where org_id = $1 and id = $2`, [ORG_A, id]);

test("a non-admin cannot change csm, csmSince or leadId on an existing account", async () => {
  const id = "own-1";
  try {
    await seedRow("accounts", id, { name: "Own Co", csm: "Admin User" });
    for (const patch of [{ csm: "Plain User" }, { csmSince: "2026-01-01" }, { leadId: "someone" }]) {
      const r = await merge("user", id, patch);
      assert(r.error && MSG.test(r.error.message), `non-admin change ${JSON.stringify(patch)} not blocked: ${JSON.stringify(r)}`);
    }
    assert((await valueOf("accounts", id)).csm === "Admin User", "csm changed despite the block");
    const ok = await merge("admin", id, { csm: "Plain User", csmSince: "2026-10-13" });
    assert(!ok.error, `control: admin change failed: ${ok.error?.message}`);
    assert((await valueOf("accounts", id)).csm === "Plain User", "admin change did not land");
  } finally { await drop(id); }
});

test("CSM edits ARR on an account owned by another CSM, sending the unchanged csm too", async () => {
  const id = "own-2";
  try {
    await seedRow("accounts", id, { name: "Other Co", csm: "Admin User", arr: 1 });
    const r = await merge("user", id, { arr: 2, csm: "Admin User" });
    assert(!r.error, `unrelated edit with unchanged csm was blocked: ${r.error?.message}`);
    assert((await valueOf("accounts", id)).arr === 2, "edit did not land");
  } finally { await drop(id); }
});

test("a non-admin may create an account owned by themselves or nobody, not by someone else", async () => {
  try {
    const bad = await merge("user", "own-3", { name: "Theirs", csm: "Admin User" });
    assert(bad.error && MSG.test(bad.error.message), "created an account owned by someone else");
    const lead = await merge("user", "own-4", { name: "Lead", leadId: "x" });
    assert(lead.error && MSG.test(lead.error.message), "created an account with a leadId");
    const mine = await merge("user", "own-5", { name: "Mine", csm: "Plain User", csmSince: "2026-10-13" });
    assert(!mine.error, `control: self-owned create failed: ${mine.error?.message}`);
    const none = await merge("user", "own-6", { name: "Nobody" });
    assert(!none.error, `control: unowned create failed: ${none.error?.message}`);
  } finally { for (const id of ["own-3", "own-4", "own-5", "own-6"]) await drop(id); }
});

test("operator context (no auth.uid) can change owners", async () => {
  const id = "own-7";
  try {
    await seedRow("accounts", id, { name: "Ops Co", csm: "Admin User" });
    await sql(`update public.accounts set data = data || '{"csm":"Plain User"}' where org_id = $1 and id = $2`, [ORG_A, id]);
    assert((await valueOf("accounts", id)).csm === "Plain User", "operator update blocked");
  } finally { await drop(id); }
});
```

Add `import "./ownership.test.mjs";` in `tests/rls/run.mjs` on the line before `import "./migration.test.mjs";`.

- [ ] **Step 2: Run to verify it fails** — requires the local Supabase stack. Run: `npx supabase start` (if not running) then, with `SUPABASE_ANON_KEY` exported from `npx supabase status -o json` (see `tests/rls/fixtures.mjs` header), `node tests/rls/run.mjs`. Expected: the 3 block assertions FAIL (non-admin changes succeed). If the local stack cannot be started on this machine, say so in the report and rely on CI's `rls` job (it runs `node tests/rls/run.mjs`) — do NOT claim RED/GREEN you didn't see.

- [ ] **Step 3: Implement** — insert into `supabase-setup.sql` after the `guard_account_limit` trigger:

```sql
-- ---------- admin-only account owners (spec 2026-10-13 PR 2) ----------
-- csm / csmSince / leadId change only by an admin. BEFORE INSERT also fires for merge_row's
-- `insert ... on conflict do update`, i.e. for every edit: an existing id is an edit and is
-- judged by the UPDATE branch, so a CSM saving ARR with the unchanged csm is never refused.
create or replace function public.guard_account_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare me text;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from accounts where org_id = new.org_id and id = new.id) then return new; end if;
    select name into me from profiles where id = auth.uid();
    if coalesce(new.data->>'leadId', '') <> ''
       or (coalesce(new.data->>'csm', '') <> '' and new.data->>'csm' is distinct from me)
       or (coalesce(new.data->>'csmSince', '') <> '' and new.data->>'csm' is distinct from me) then
      raise exception 'Only an admin can change an account''s CSM or Lead';
    end if;
    return new;
  end if;
  if (new.data->'csm') is distinct from (old.data->'csm')
     or (new.data->'csmSince') is distinct from (old.data->'csmSince')
     or (new.data->'leadId') is distinct from (old.data->'leadId') then
    raise exception 'Only an admin can change an account''s CSM or Lead';
  end if;
  return new;
end $$;
drop trigger if exists guard_account_owner on public.accounts;
create trigger guard_account_owner
  before insert or update on public.accounts
  for each row execute function public.guard_account_owner();
```

- [ ] **Step 4: Run** `node tests/rls/run.mjs` → all PASS (including the existing merge/policies suites, which must not regress; existing tests seed accounts as admin). Also run `npm run build` (unchanged, sanity).

- [ ] **Step 5: Commit**

```bash
git add supabase-setup.sql tests/rls/ownership.test.mjs tests/rls/run.mjs
git commit -m "DB: only admins can change an account's CSM or Lead"
```

---

### Task 3: Edit/New account form lock, "CSM since", timeline entry, header

**Files:**
- Modify: `src/13-forms.jsx` — `AccountForm` (CSM field, new CSM since field, submit)
- Modify: `src/21-account-detail.jsx` — CSM stat tile sub-line
- Test: `tests/health/csm-ownership.test.mjs` (new), `tests/health/run.mjs` (import)

**Interfaces:** Consumes `isAdminUser`, `stripOwnerKeys`, `csmChangeSummary` (Task 1). DOM hooks: `[data-csm-select]` on the CSM `<select>`, `[data-csm-lock]` on the lock note, `[data-csm-since]` on the date input, `[data-csm-since-label]` on the header sub-line.

Behaviour:
- Non-admin: CSM select is `disabled`; under it `<div data-csm-lock>🔒 Only admins can change this</div>`. New account by non-admin: `v.csm` initialised to `user.name` (select still disabled).
- Admin: when `v.csm !== (existing ? existing.csm || "" : "")` and `v.csm` non-blank, show `<F label="CSM since"><Input type="date" data-csm-since …/></F>` defaulting to `iso(Date.now())`.
- Submit: `clean.csmSince` = that date when CSM changed (admin), else `csmSince` is not in the patch. Then `patch = stripOwnerKeys(clean, user)`. For an edit where `csmChangeSummary(existing.csm, clean.csm, user.name)` is non-null and the user is admin, also dispatch `ADD_ACTIVITY` `{ id: uid(), accountId: existing.id, type: "note", date: iso(Date.now()), summary }`. For a new account by an admin with a CSM, set `csmSince` (no activity).
- Header (`21-account-detail.jsx` CSM `Stat`): `sub={a.csmSince ? <span data-csm-since-label>since {fmtDate(a.csmSince)}</span> : null}`.

- [ ] **Step 1: Write failing E2E** — `tests/health/csm-ownership.test.mjs`

```js
// Admin-only CSM assignment, CSM since, timeline entry (spec 2026-10-13 PR 2).
import { launch, seedAccount } from "./harness.mjs";
import { test, assert } from "./framework.mjs";

const seed = (accounts, role) => `window.__seedRows = { accounts: ${JSON.stringify(accounts)}.map(d => ({ id: d.id, data: d })),`
  + ` contacts: [], activities: [], tasks: [], opportunities: [], settings: [],`
  + ` team: [{ id: "u1", data: { id: "u1", name: "Test User" } }, { id: "u2", data: { id: "u2", name: "Ravi" } }],`
  + ` profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "${role}" }] };`;
const acct = (page, id) => page.evaluate(i => window.__store.getState().accounts.find(a => a.id === i), id);
const acts = (page, id) => page.evaluate(i => window.__store.getState().activities.filter(x => x.accountId === i).map(x => x.summary), id);
const openEdit = async (page, name) => {
  await page.click('button[title="Accounts"]');
  await page.getByText(name).first().click();
  await page.waitForSelector("[data-header-card]");
  await page.click("text=✎ Edit account");
  await page.waitForSelector("[data-csm-select]");
};

test("a CSM sees the CSM owner locked", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "a1", name: "Acme", csm: "Ravi" })], "user"));
  try {
    await openEdit(page, "Acme");
    assert(await page.locator("[data-csm-select]").isDisabled(), "CSM select editable for a non-admin");
    assert(/Only admins can change this/.test(await page.textContent("[data-csm-lock]")), "lock note missing");
  } finally { await browser.close(); }
});

test("admin changes CSM: csmSince saved, timeline entry added, header shows since", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "a1", name: "Acme", csm: "Test User" })], "admin"));
  try {
    await openEdit(page, "Acme");
    assert(await page.locator("[data-csm-select]").isEnabled(), "CSM select locked for an admin");
    assert(await page.locator("[data-csm-since]").count() === 0, "CSM since shown before any change");
    await page.selectOption("[data-csm-select]", "Ravi");
    await page.fill("[data-csm-since]", "2026-10-01");
    await page.click("text=Save changes");
    const a = await acct(page, "a1");
    assert(a.csm === "Ravi" && a.csmSince === "2026-10-01", "saved: " + JSON.stringify({ csm: a.csm, csmSince: a.csmSince }));
    assert((await acts(page, "a1")).includes("CSM changed from Test User to Ravi by Test User"), "timeline: " + JSON.stringify(await acts(page, "a1")));
    assert(/since Oct 1, 2026/.test(await page.textContent("[data-csm-since-label]")), "header since label");
  } finally { await browser.close(); }
});

test("admin edits other fields, or changes CSM and back: no csmSince, no timeline entry", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "a1", name: "Acme", csm: "Test User" })], "admin"));
  try {
    await openEdit(page, "Acme");
    await page.selectOption("[data-csm-select]", "Ravi");
    await page.selectOption("[data-csm-select]", "Test User");
    await page.fill('label:has-text("ARR") input', "999");
    await page.click("text=Save changes");
    const a = await acct(page, "a1");
    assert(a.arr === 999 && a.csm === "Test User" && !a.csmSince, "unexpected: " + JSON.stringify({ arr: a.arr, csm: a.csm, csmSince: a.csmSince }));
    assert(!(await acts(page, "a1")).some(s => /^CSM /.test(s)), "timeline entry written without a change");
  } finally { await browser.close(); }
});

test("a CSM's new account is owned by them", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "a1", name: "Acme" })], "user"));
  try {
    await page.click('button[title="Accounts"]');
    await page.click("text=+ New account");
    await page.waitForSelector("[data-csm-select]");
    await page.fill('label:has-text("Name") input', "Brand New");
    await page.click("text=Create account");
    const made = await page.evaluate(() => window.__store.getState().accounts.find(a => a.name === "Brand New"));
    assert(made && made.csm === "Test User", "new account csm: " + (made && made.csm));
  } finally { await browser.close(); }
});
```

(Before writing: open `tests/health/harness.mjs` to confirm how `team` rows are seeded and what `user.name` resolves to for the `profiles` row; adjust the `team` seed shape to match what other tests use (e.g. grep `team: [{` in tests/health) — the select's options come from `team`. Confirm the "+ New account" button text in `src/20-account-list.jsx`.)

Add `import "./csm-ownership.test.mjs";` to `tests/health/run.mjs`.

- [ ] **Step 2: Run to verify failure** — `npm run build && node tests/health/run-one.mjs csm-ownership.test.mjs` → FAIL (`[data-csm-select]` missing).

- [ ] **Step 3: Implement** in `src/13-forms.jsx` `AccountForm`:
  - `const admin = isAdminUser(user);`
  - New-account initial state: `csm: admin ? "" : (user ? user.name : "")`.
  - `const [csmSince, setCsmSince] = useState(iso(Date.now()));`
  - `const csmChanged = admin && v.csm && v.csm !== (existing ? existing.csm || "" : "");`
  - Replace the CSM field with:

```jsx
      <F label="CSM owner"><select data-csm-select value={v.csm} disabled={!admin} onChange={e => set("csm", e.target.value)}
          className="nm-inset w-full border-0 px-3 py-1.5 text-sm text-slate-800 outline-none disabled:opacity-60">
          {csmOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {!admin && <div data-csm-lock className="mt-0.5 text-[11px] text-slate-500">🔒 Only admins can change this</div>}
      </F>
      {csmChanged && <F label="CSM since"><Input type="date" data-csm-since value={csmSince} onChange={e => setCsmSince(e.target.value)} /></F>}
```

  (Ensure `csmOptions` includes `user.name` for a non-admin creating an account so the disabled select shows it.)
  - In submit, after `clean` is built (and after the custom-fields line):

```jsx
      if (csmChanged) clean.csmSince = csmSince || iso(Date.now());
      const summary = admin && existing ? csmChangeSummary(existing.csm, clean.csm, user.name) : null;
      const safe = stripOwnerKeys(clean, user);
```

  then use `safe` instead of `clean` in both the `EDIT_ACCOUNT` patch and the `ADD_ACCOUNT` item — EXCEPT a non-admin's new account keeps `csm: user.name` (strip removes it, so re-add: `{ ...safe, csm: user.name }` for the ADD path when not admin). After the `EDIT_ACCOUNT` dispatch: `if (summary) dispatch({ type: "ADD_ACTIVITY", item: { id: uid(), accountId: existing.id, type: "note", date: iso(Date.now()), summary } });`
  - In `src/21-account-detail.jsx` CSM `Stat`: add `sub={a.csmSince ? <span data-csm-since-label>since {fmtDate(a.csmSince)}</span> : null}`.

- [ ] **Step 4: Run** — `npm run build && node tests/health/run-one.mjs csm-ownership.test.mjs` → PASS; regressions: `run-one.mjs custom-fields.test.mjs`, `licenses.test.mjs`, `transition-date.test.mjs`, `page-polish.test.mjs`, `second-pass.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/13-forms.jsx src/21-account-detail.jsx tests/health/csm-ownership.test.mjs tests/health/run.mjs
git commit -m "Account form: CSM owner admin-only, CSM since date and timeline entry"
```

---

### Task 4: Bulk Reassign CSM admin-only; CSV import respects ownership

**Files:**
- Modify: `src/20-account-list.jsx:266` (Reassign CSM bulk button)
- Modify: `src/17-csv.jsx` — `importAccountsCSV` (existing-row patch and new-row item)
- Test: `tests/health/csm-ownership.test.mjs` (append)

**Interfaces:** Consumes `isAdminUser`, `stripOwnerKeys`. `importAccountsCSV(file, accounts, dispatch, done, user)` signature unchanged.

- [ ] **Step 1: Append failing tests** to `tests/health/csm-ownership.test.mjs`:

```js
test("bulk Reassign CSM is admin-only", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "a1", name: "Acme" })], "user"));
  try {
    await page.click('button[title="Accounts"]');
    await page.locator("[data-account-row] input[type=checkbox]").first().check();
    assert(await page.getByRole("button", { name: "Reassign CSM" }).count() === 0, "CSM sees Reassign CSM");
  } finally { await browser.close(); }
  const adm = await launch(seed([seedAccount({ id: "a1", name: "Acme" })], "admin"));
  try {
    await adm.page.click('button[title="Accounts"]');
    await adm.page.locator("[data-account-row] input[type=checkbox]").first().check();
    assert(await adm.page.getByRole("button", { name: "Reassign CSM" }).count() === 1, "control: admin lost Reassign CSM");
  } finally { await adm.browser.close(); }
});

test("CSV import by a CSM ignores the csm column and owns new rows", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "a1", name: "Acme", csm: "Ravi" })], "user"));
  try {
    await page.click('button[title="Accounts"]');
    const csv = "name,csm,industry\nAcme,Test User,Retail\nFresh Co,Ravi,Tech\n";
    await page.setInputFiles('input[type=file][accept*="csv"]', { name: "a.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.waitForFunction(() => window.__store.getState().accounts.some(a => a.name === "Fresh Co"));
    const s = await page.evaluate(() => window.__store.getState().accounts.map(a => ({ name: a.name, csm: a.csm, industry: a.industry })));
    const acme = s.find(a => a.name === "Acme"), fresh = s.find(a => a.name === "Fresh Co");
    assert(acme.csm === "Ravi" && acme.industry === "Retail", "existing row: " + JSON.stringify(acme));
    assert(fresh.csm === "Test User", "new row: " + JSON.stringify(fresh));
  } finally { await browser.close(); }
});
```

(Check the import `<input type=file>` selector in `src/20-account-list.jsx:198` and the checkbox selector used by `tests/health/bulk.test.mjs`; match them.)

- [ ] **Step 2: Run to verify failure** — `npm run build && node tests/health/run-one.mjs csm-ownership.test.mjs` → the 2 new cases FAIL.

- [ ] **Step 3: Implement**
  - `src/20-account-list.jsx`: render the Reassign CSM bulk button only when `isAdminUser(user)` (check the component's prop name for the signed-in user; thread `user` from `26-app.jsx` if absent).
  - `src/17-csv.jsx`: existing row → `patch: stripOwnerKeys(vals, user)`; new row → after building `item`, `if (!isAdminUser(user)) item.csm = user ? user.name : "";` and delete `item.csmSince`/`item.leadId` for non-admins.

- [ ] **Step 4: Run** — `run-one.mjs csm-ownership.test.mjs`, `bulk.test.mjs`, `csv.test.mjs`, `csv-import-safety.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/20-account-list.jsx src/17-csv.jsx tests/health/csm-ownership.test.mjs
git commit -m "Bulk reassign admin-only; CSV import cannot change CSM for non-admins"
```

---

### Task 5: Verification and PR

- [ ] `npm run test:unit` → pass.
- [ ] `node tests/health/run.mjs` (no pipe) → 0 failed; a failure in an untouched file: rerun alone; flake → note it, real → fix.
- [ ] RLS: if the local stack runs, `node tests/rls/run.mjs` → 0 failed; otherwise rely on CI's `rls` job and say so.
- [ ] Push, open PR "Admin-only CSM assignment + CSM since". Body: UI lock, DB trigger, CSM since + timeline, bulk/CSV paths, **"After merge: re-run supabase-setup.sql in the Supabase SQL editor (idempotent)"**. End with the Claude Code attribution line.
