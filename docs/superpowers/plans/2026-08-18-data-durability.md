# Data Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three write-path defects that let OneVio lose or silently revert a user's work — silent failed writes (D1), concurrent editors clobbering each other (D2), and a non-atomic `replaceAllRemote` that empties the database before writing (D3).

**Architecture:** The patch is computed generically in `persist()` by diffing `prev` against `next` — no form changes — and applied server-side by a new `merge_row` RPC that shallow-merges scalars and concatenates append-only arrays with dedupe. `persist` then stops calling Supabase directly and enqueues operations onto a serial-per-row worker with backoff, a visible sync indicator, and refetch-based rollback. `replaceAllRemote` becomes one `replace_all` RPC whose function body is a single transaction.

**Tech Stack:** Single-file React app (`crm.html`, JSX compiled by `build.mjs`), Supabase (PostgREST + Postgres RPC), plain-`assert` test framework, Puppeteer E2E (`tests/health/`), real-Postgres RLS suite (`tests/rls/`).

**Spec:** `docs/superpowers/specs/2026-08-17-data-durability-design.md`

## Global Constraints

- **Both new SQL functions MUST be `security invoker`.** A `security definer` function bypasses every RLS policy `tests/rls/` pins, converting a durability fix into privilege escalation. This is the single most important constraint in the design.
- **Additive-only in `crm.html`.** Existing call sites must not change shape; the ~15 forms are not to be touched.
- **`supabase-setup.sql` must stay idempotent and re-runnable** — `tests/rls/fixtures.mjs` applies it verbatim on every reset, so a non-idempotent statement breaks the entire RLS suite.
- **Never pipe a test run.** `node tests/health/run.mjs` and `node tests/rls/run.mjs` exit codes ARE the gate; `| tail` or `; git ...` reports the wrong status. Run the full health suite with `run_in_background: true` — it takes >10 min.
- **Dedupe keys:** `arrEvents` by element `id`; `history` by whole-element equality (entries are `{ d, s }`, no id).
- Branch: `fix/data-durability`, currently at `adcf213` (rebased onto master `cb7fe70`).
- Spec phase 1 (the RLS suite) is **complete and merged** as PR #21. The tasks below are spec phases 2–4.

---

### Task 1: `diffRow` — the pure patch computation

The load-bearing piece. Written first, tested densest. Pure and synchronous, no Supabase.

**Files:**
- Modify: `crm.html` — add `diffRow` immediately before `function persist` (~line 302); add `diffRow` to the `window.__health` export at line 3443
- Test: `tests/health/diffrow.test.mjs` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `diffRow(prevItem, nextItem) -> { patch, appends, sets }` where
  - `patch` — object of scalar/nested-object fields whose values differ (`{}` if none)
  - `appends` — object of `arrayField -> newTrailingItems[]` (`{}` if none)
  - `sets` — object of `arrayField -> wholeArray`, for arrays reordered or with items removed/edited (`{}` if none)
  - `diffRow(undefined, next)` returns `{ patch: next, appends: {}, sets: {} }` — a brand-new row is a whole write

- [ ] **Step 1: Write the failing tests**

Create `tests/health/diffrow.test.mjs`:

```js
import { test, assert } from "./framework.mjs";
import { launch } from "./harness.mjs";

// diffRow is the one function in this change that can CORRUPT data rather than merely fail
// to save it: if it ever calls a replacement an append, the arrEvents audit trail grows
// duplicate entries -- a new way to damage the trail three PRs went into getting right.
// Hence the density here.
let page, browser;
const boot = async () => { if (!page) ({ page, browser } = await launch("")); };
const diff = (prev, next) => page.evaluate((p, n) => window.__health.diffRow(p, n), prev, next);

test("diffRow reports only the scalar fields that changed", async () => {
  await boot();
  const r = await diff({ id: "a1", name: "Acme", arr: 100, csm: "Priya" },
                       { id: "a1", name: "Acme", arr: 200, csm: "Priya" });
  assert(JSON.stringify(r.patch) === '{"arr":200}', `patch was ${JSON.stringify(r.patch)}`);
  assert(JSON.stringify(r.appends) === "{}", "nothing should have been appended");
  assert(JSON.stringify(r.sets) === "{}", "nothing should have been set wholesale");
});

test("diffRow returns an empty diff when nothing changed", async () => {
  await boot();
  const row = { id: "a1", name: "Acme", arr: 100, inputs: { usage: 3 }, arrEvents: [{ id: "e1" }] };
  const r = await diff(row, JSON.parse(JSON.stringify(row)));
  assert(JSON.stringify(r) === '{"patch":{},"appends":{},"sets":{}}',
    `expected an empty diff, got ${JSON.stringify(r)}`);
});

test("diffRow sends a changed nested object whole, not field by field", async () => {
  await boot();
  // jsonb `||` is a SHALLOW merge, so a partial nested object would DROP its sibling keys
  // server-side. `inputs` must travel complete.
  const r = await diff({ id: "a1", inputs: { usage: 3, tickets: 1 } },
                       { id: "a1", inputs: { usage: 9, tickets: 1 } });
  assert(JSON.stringify(r.patch) === '{"inputs":{"usage":9,"tickets":1}}',
    `patch was ${JSON.stringify(r.patch)}`);
});

test("diffRow classifies a trailing addition as an append", async () => {
  await boot();
  const r = await diff({ id: "a1", arrEvents: [{ id: "e1", delta: 10 }] },
                       { id: "a1", arrEvents: [{ id: "e1", delta: 10 }, { id: "e2", delta: 20 }] });
  assert(JSON.stringify(r.appends) === '{"arrEvents":[{"id":"e2","delta":20}]}',
    `appends was ${JSON.stringify(r.appends)}`);
  assert(JSON.stringify(r.patch) === "{}", "an append must not also travel as a patch");
});

test("diffRow appends multiple trailing items in order", async () => {
  await boot();
  const r = await diff({ id: "a1", history: [{ d: "2026-08-01", s: 70 }] },
                       { id: "a1", history: [{ d: "2026-08-01", s: 70 },
                                             { d: "2026-08-02", s: 71 },
                                             { d: "2026-08-03", s: 72 }] });
  assert(r.appends.history.length === 2, `expected 2 appends, got ${JSON.stringify(r.appends.history)}`);
  assert(r.appends.history[0].d === "2026-08-02" && r.appends.history[1].d === "2026-08-03",
    "append order was not preserved");
});

test("diffRow falls back to a whole-array set when an item was REMOVED", async () => {
  await boot();
  const r = await diff({ id: "a1", docs: [{ id: "d1" }, { id: "d2" }] },
                       { id: "a1", docs: [{ id: "d1" }] });
  assert(JSON.stringify(r.appends) === "{}", "a removal is not an append");
  assert(JSON.stringify(r.sets) === '{"docs":[{"id":"d1"}]}', `sets was ${JSON.stringify(r.sets)}`);
});

test("diffRow falls back to a whole-array set when items were REORDERED", async () => {
  await boot();
  const r = await diff({ id: "a1", docs: [{ id: "d1" }, { id: "d2" }] },
                       { id: "a1", docs: [{ id: "d2" }, { id: "d1" }] });
  assert(JSON.stringify(r.appends) === "{}", "a reorder is not an append");
  assert(r.sets.docs.length === 2 && r.sets.docs[0].id === "d2", `sets was ${JSON.stringify(r.sets)}`);
});

test("diffRow falls back to a whole-array set when an EXISTING item was edited", async () => {
  await boot();
  // EDIT_DOCUMENT mutates an element in place. The prefix no longer matches, so this must
  // NOT be read as "unchanged, plus nothing".
  const r = await diff({ id: "a1", docs: [{ id: "d1", name: "old" }] },
                       { id: "a1", docs: [{ id: "d1", name: "new" }] });
  assert(JSON.stringify(r.appends) === "{}", "an in-place edit is not an append");
  assert(JSON.stringify(r.sets) === '{"docs":[{"id":"d1","name":"new"}]}',
    `sets was ${JSON.stringify(r.sets)}`);
});

test("diffRow handles an array that did not exist before", async () => {
  await boot();
  const r = await diff({ id: "a1" }, { id: "a1", arrEvents: [{ id: "e1" }] });
  assert(JSON.stringify(r.appends) === '{"arrEvents":[{"id":"e1"}]}',
    `appends was ${JSON.stringify(r.appends)}`);
});

test("diffRow treats an absent prev row as a whole write", async () => {
  await boot();
  const r = await diff(undefined, { id: "a1", name: "Acme", arrEvents: [{ id: "e1" }] });
  assert(r.patch.name === "Acme" && r.patch.arrEvents.length === 1, `patch was ${JSON.stringify(r.patch)}`);
  assert(JSON.stringify(r.appends) === "{}", "a new row has nothing to append onto");
});

test("diffRow reports a field cleared to undefined as an explicit null", async () => {
  await boot();
  // `delete a._orphaned` and a cleared parentId must actually REMOVE the value server-side.
  // An undefined vanishes from the JSON payload and leaves the old value in place.
  const r = await diff({ id: "a1", parentId: "p1" }, { id: "a1", parentId: undefined });
  assert(r.patch.parentId === null, `expected an explicit null, got ${JSON.stringify(r.patch)}`);
  if (browser) await browser.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/health/run-one.mjs diffrow`
Expected: FAIL — `window.__health.diffRow is not a function`

- [ ] **Step 3: Implement `diffRow`**

Insert in `crm.html` immediately before the `/* write-through: mirror a just-reduced action into Supabase */` comment:

```js
/* Compute what actually changed between two versions of one row.
   This exists so that NO form has to diff: dispatch already holds prev and next, and this
   is the one place that sees both. It therefore also covers the appends the reducer makes
   internally -- arrEvents (crm.html:404,410,432) never passes through a form at all, so a
   form-level diff would have missed the entire audit trail. */
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function diffRow(prev, next) {
  if (!prev) return { patch: { ...next }, appends: {}, sets: {} };
  const patch = {}, appends = {}, sets = {};
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const a = prev[k], b = next[k];
    if (sameJSON(a, b)) continue;
    if (Array.isArray(b)) {
      const base = Array.isArray(a) ? a : [];
      // An append is next == prev + trailing items, and NOTHING else. A reorder, a removal
      // or an in-place edit all break the prefix and fall through to a whole-array set --
      // misreading any of them as an append would duplicate audit entries.
      const isAppend = b.length > base.length && base.every((x, i) => sameJSON(x, b[i]));
      if (isAppend) appends[k] = b.slice(base.length); else sets[k] = b;
    } else {
      // undefined would be dropped from the JSON payload entirely, leaving the old value
      // server-side. A cleared field has to travel as an explicit null.
      patch[k] = b === undefined ? null : b;
    }
  }
  return { patch, appends, sets };
}
```

Then add `diffRow` to the `window.__health` object literal at line 3443.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/health/run-one.mjs diffrow`
Expected: PASS, all 11 cases.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/diffrow.test.mjs
git commit -m "feat: compute row patches generically with diffRow"
```

---

### Task 2: `merge_row` — the server-side merge

**Files:**
- Modify: `supabase-setup.sql` — new section immediately before `-- ---------- realtime ----------`
- Test: `tests/rls/merge.test.mjs` (create); register in `tests/rls/run.mjs`

**Interfaces:**
- Consumes: nothing from Task 1 (SQL only).
- Produces: `merge_row(tbl text, row_id text, patch jsonb, appends jsonb) returns void`, called as `sb.rpc("merge_row", { tbl, row_id, patch, appends })`. Inserts the row if absent, merges if present, sets `updated_at = now()`. Helper `append_dedup(base jsonb, incoming jsonb, field text) returns jsonb`.

- [ ] **Step 1: Write the failing tests**

Create `tests/rls/merge.test.mjs`:

```js
// merge_row against a REAL Postgres. These are the concurrency claims from the spec; they
// cannot be proven against the mocked store, because what is under test is precisely what
// the SERVER does when two clients write one row.
import { test, assert } from "../health/framework.mjs";
import { sessions, seedRow, valueOf } from "./fixtures.mjs";

const merge = (who, tbl, row_id, patch = {}, appends = {}) =>
  sessions[who].rpc("merge_row", { tbl, row_id, patch, appends });

test("two clients patching DIFFERENT fields of one account both survive", async () => {
  await seedRow("accounts", "m-1", { id: "m-1", name: "Acme", arr: 100, csm: "Priya" });
  const a = await merge("admin", "accounts", "m-1", { arr: 500 });
  const b = await merge("user", "accounts", "m-1", { csm: "Dana" });
  assert(!a.error, `admin merge failed: ${a.error && a.error.message}`);
  assert(!b.error, `user merge failed: ${b.error && b.error.message}`);
  const v = await valueOf("accounts", "m-1");
  assert(v.arr === 500, `the ARR edit was reverted: arr=${v.arr}`);
  assert(v.csm === "Dana", `the CSM edit was reverted: csm=${v.csm}`);
  assert(v.name === "Acme", "an untouched field was lost");
});

test("two clients appending an arrEvent both land, neither duplicated", async () => {
  await seedRow("accounts", "m-2", { id: "m-2", name: "Acme", arrEvents: [{ id: "e0", delta: 1 }] });
  await merge("admin", "accounts", "m-2", {}, { arrEvents: [{ id: "e1", delta: 10 }] });
  await merge("user", "accounts", "m-2", {}, { arrEvents: [{ id: "e2", delta: 20 }] });
  const ids = (await valueOf("accounts", "m-2")).arrEvents.map(e => e.id).sort();
  assert(ids.join() === "e0,e1,e2", `expected e0,e1,e2 — got ${ids.join()}`);
});

test("a REPLAYED append does not duplicate the entry", async () => {
  // This is what makes the retry in Task 5 safe: the worker cannot know whether a timed-out
  // request landed, so applying it twice must be identical to applying it once.
  await seedRow("accounts", "m-3", { id: "m-3", arrEvents: [] });
  const op = { arrEvents: [{ id: "e9", delta: 99 }] };
  await merge("admin", "accounts", "m-3", {}, op);
  await merge("admin", "accounts", "m-3", {}, op);
  const evs = (await valueOf("accounts", "m-3")).arrEvents;
  assert(evs.length === 1, `the replay duplicated the entry: ${JSON.stringify(evs)}`);
});

test("history dedupes by whole-element equality", async () => {
  // history entries are { d, s } with no id (crm.html:488), so identity IS the value.
  await seedRow("accounts", "m-4", { id: "m-4", history: [{ d: "2026-08-01", s: 70 }] });
  await merge("admin", "accounts", "m-4", {}, {
    history: [{ d: "2026-08-01", s: 70 }, { d: "2026-08-02", s: 80 }],
  });
  const h = (await valueOf("accounts", "m-4")).history;
  assert(h.length === 2, `expected 2 entries, got ${JSON.stringify(h)}`);
  assert(h[1].s === 80, "the new snapshot is missing");
});

test("merge_row inserts the row when it does not exist yet", async () => {
  const { error } = await merge("user", "accounts", "m-5", { id: "m-5", name: "Fresh" });
  assert(!error, `insert-through-merge failed: ${error && error.message}`);
  assert((await valueOf("accounts", "m-5")).name === "Fresh", "the row was not created");
});

test("merge_row does NOT let a plain user write settings", async () => {
  // The whole point of `security invoker`: the RPC must remain subject to settings_write,
  // which is admin-only. A definer function would sail straight past it.
  const { error } = await merge("user", "settings", "1", { rates: { INR: 99 } });
  assert(error, "a plain user's merge into settings was allowed — is merge_row security definer?");
  assert(error.code === "42501" || /permission|denied|policy/i.test(error.message),
    `expected an RLS denial, got ${error.code}: ${error.message}`);
});

test("merge_row cannot be pointed at an arbitrary table", async () => {
  const { error } = await merge("user", "profiles", "x", { role: "admin" });
  assert(error, "merge_row accepted a table outside the allow-list — role escalation is reachable");
});

test("merge_row rejects a table name crafted for SQL injection", async () => {
  const { error } = await merge("admin", 'accounts"; drop table public.accounts; --', "x", { a: 1 });
  assert(error, "the crafted table name was accepted");
  const { error: alive } = await sessions.admin.from("accounts").select("id").limit(1);
  assert(!alive || alive.code !== "PGRST205",
    "the accounts table is gone — the identifier was interpolated unsafely");
});
```

Register it: in `tests/rls/run.mjs`, add `import "./merge.test.mjs";` after the `policies` import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/rls/run.mjs` (needs a real stack — in CI this is the `rls` job)
Expected: the 8 new cases FAIL with `Could not find the function public.merge_row`; the existing 25 still pass.

- [ ] **Step 3: Implement `merge_row`**

Insert into `supabase-setup.sql` immediately before `-- ---------- realtime ----------`:

```sql
-- ---------- durable writes: field-level merge ----------
-- Replaces the whole-blob upsert, under which two people editing different fields of one
-- account silently reverted each other with no error raised (D2 in the durability spec).
--
-- SECURITY INVOKER IS LOAD-BEARING AND MUST NOT BE CHANGED. This function is a general
-- "write anything into any row" primitive; as `security definer` it would run as its owner
-- and bypass every policy above -- settings_write and the admin gate included -- turning a
-- durability fix into privilege escalation. Invoker means the caller's own policies still
-- apply, so the guarantees tests/rls pins continue to hold through the RPC.
create or replace function public.merge_row(tbl text, row_id text, patch jsonb, appends jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  k text;
  existing jsonb;
  merged jsonb;
begin
  -- Allow-list, not interpolation: `tbl` arrives from the browser. Anything else is a
  -- reachable path to profiles (role escalation) or to crafted SQL.
  if tbl not in ('accounts','contacts','activities','tasks','opportunities','settings') then
    raise exception 'merge_row: table % is not writable through this function', tbl;
  end if;

  if tbl = 'settings' then
    select data into existing from settings where id = 1;
  else
    execute format('select data from public.%I where id = $1', tbl) into existing using row_id;
  end if;

  -- `||` is a SHALLOW merge, which is exactly the field-level semantics wanted here: only
  -- the keys present in `patch` move. diffRow sends nested objects whole for this reason.
  merged := coalesce(existing, '{}'::jsonb) || coalesce(patch, '{}'::jsonb);

  for k in select jsonb_object_keys(coalesce(appends, '{}'::jsonb)) loop
    merged := jsonb_set(merged, array[k],
      public.append_dedup(coalesce(merged -> k, '[]'::jsonb), appends -> k, k));
  end loop;

  if tbl = 'settings' then
    insert into settings (id, data, updated_at) values (1, merged, now())
      on conflict (id) do update set data = excluded.data, updated_at = now();
  else
    execute format(
      'insert into public.%I (id, data, updated_at) values ($1, $2, now())
       on conflict (id) do update set data = excluded.data, updated_at = now()', tbl)
      using row_id, merged;
  end if;
end $$;

-- Concatenate `incoming` onto `base`, skipping entries already present. Dedupe is what
-- makes a RETRIED write safe to replay: the queue cannot know whether a timed-out request
-- landed, so applying it twice must equal applying it once.
--   arrEvents -> by element id (every entry has one; this is the audit record that matters)
--   everything else -> by whole-element equality
-- Accepted trade-off, from the spec: two genuinely distinct `history` snapshots with the
-- same day and score collapse into one. That is a sparkline point, not an audit record.
create or replace function public.append_dedup(base jsonb, incoming jsonb, field text)
returns jsonb language plpgsql immutable security invoker set search_path = public as $$
declare
  item jsonb;
  acc jsonb := coalesce(base, '[]'::jsonb);
begin
  for item in select * from jsonb_array_elements(coalesce(incoming, '[]'::jsonb)) loop
    if field = 'arrEvents' and item ? 'id' then
      if not exists (select 1 from jsonb_array_elements(acc) e where e ->> 'id' = item ->> 'id') then
        acc := acc || jsonb_build_array(item);
      end if;
    elsif not exists (select 1 from jsonb_array_elements(acc) e where e = item) then
      acc := acc || jsonb_build_array(item);
    end if;
  end loop;
  return acc;
end $$;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/rls/run.mjs`
Expected: 33 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add supabase-setup.sql tests/rls/merge.test.mjs tests/rls/run.mjs
git commit -m "feat: merge rows server-side instead of upserting whole blobs"
```

---

### Task 3: Route `persist` through `merge_row`

Closes D2 end to end. Writes are still fire-and-forget here — the queue is Task 5.

**Files:**
- Modify: `crm.html:304` (`persist`'s `up` helper), the settings case at the end of `persist`'s switch, and `crm.html:3199` (the `dispatch` callback)
- Test: `tests/health/persistence.test.mjs` (extend), `tests/health/harness.mjs` (mock an `rpc` method)

**Interfaces:**
- Consumes: `diffRow(prev, next)` from Task 1; the `merge_row` RPC from Task 2.
- Produces: `persist(action, next, prev)` — a third parameter. Delete paths are unchanged.

- [ ] **Step 1: Write the failing tests**

First extend the mocked client in `tests/health/harness.mjs` — inside the factory that already provides `from`, add:

```js
rpc: (fn, args) => {
  (window.__rpcCalls = window.__rpcCalls || []).push({ fn, args });
  // Apply the merge locally so a reload sees it, mirroring merge_row's semantics.
  window.__applyMerge && window.__applyMerge(args);
  return Promise.resolve({ error: null });
},
```

Then append to `tests/health/persistence.test.mjs`:

```js
test("an account edit writes only the changed field, not the whole blob", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 3);
  await page.evaluate(() => { window.__rpcCalls = []; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "p1", patch: { arr: 4242 }, by: "Test User" }));
  await page.waitForFunction(() => (window.__rpcCalls || []).length > 0);
  const call = await page.evaluate(() => window.__rpcCalls[0]);
  assert(call.fn === "merge_row", `expected a merge_row rpc, got ${call.fn}`);
  assert(call.args.tbl === "accounts" && call.args.row_id === "p1",
    `wrong target: ${JSON.stringify(call.args)}`);
  assert(call.args.patch.arr === 4242, `the ARR change is missing: ${JSON.stringify(call.args.patch)}`);
  assert(call.args.patch.name === undefined,
    "the whole blob was sent — unchanged fields must not travel, or concurrent editors keep clobbering");
  await browser.close();
});

test("the audit entry the reducer appends travels as an append, not a whole array", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 3);
  await page.evaluate(() => { window.__rpcCalls = []; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "p1", patch: { arr: 777 }, by: "Test User" }));
  await page.waitForFunction(() => (window.__rpcCalls || []).length > 0);
  const args = await page.evaluate(() => window.__rpcCalls[0].args);
  assert(args.appends && args.appends.audit, `no audit append was sent: ${JSON.stringify(args.appends)}`);
  assert(args.appends.audit.length === 1,
    `expected exactly the new audit entry, got ${args.appends.audit.length}`);
  await browser.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/health/run-one.mjs persistence`
Expected: FAIL — `expected a merge_row rpc, got undefined` (nothing calls `rpc` yet).

- [ ] **Step 3: Rewrite `up` and thread `prev` through**

In `crm.html`, replace `persist`'s signature and its `up` helper:

```js
function persist(action, next, prev) {
  const prevOf = (t, id) => ((prev && prev[t]) || []).find(x => x.id === id);
  // Write the DIFF, not the blob. Two people editing different fields of one account used
  // to revert each other with no error raised (D2); merge_row applies only what moved.
  const up = (t, item) => {
    const { patch, appends, sets } = diffRow(prevOf(t, item.id), item);
    const full = { ...patch, ...sets };
    if (!Object.keys(full).length && !Object.keys(appends).length) return;
    return sb.rpc("merge_row", { tbl: t, row_id: item.id, patch: full, appends })
      .then(({ error }) => error && dbError(t, error));
  };
```

Replace the settings case at the end of the switch:

```js
    case "SET_WEIGHTS": case "SET_RATES": case "SET_INTEGRATIONS": case "SET_SNAPSHOTS":
    case "SET_PLAYBOOK": case "SET_HEALTH_PLAYBOOK": case "SET_SEGMENTS": {
      const { patch, appends, sets } = diffRow(prev && prev.settings, next.settings);
      return sb.rpc("merge_row",
        { tbl: "settings", row_id: "1", patch: { ...patch, ...sets }, appends })
        .then(({ error }) => error && dbError("settings", error));
    }
```

Leave every `.delete()` path exactly as it is — a delete is not a merge.

At `crm.html:3199`, pass `prev`:

```js
    if (action.type !== "REPLACE") persist(action, next, prev);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/health/run-one.mjs persistence`, then the whole suite:
`node tests/health/run.mjs` (`run_in_background: true`, never piped).
Expected: persistence green; full suite 0 failed.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/persistence.test.mjs tests/health/harness.mjs
git commit -m "fix: persist field-level patches so concurrent edits stop clobbering"
```

---

### Task 4: `replace_all` — the atomic bulk replace

Spec phase 4, deliberately pulled ahead of the queue: it is the smallest change and closes the largest blast radius. Today an import failure leaves the whole team with an empty database and no backup.

**Files:**
- Modify: `supabase-setup.sql` (after `append_dedup`), `crm.html:371` (`replaceAllRemote`)
- Test: `tests/rls/replace.test.mjs` (create); register in `tests/rls/run.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `replace_all(payload jsonb) returns void`, called as `sb.rpc("replace_all", { payload })`. `payload` is `{ accounts: [...], contacts: [...], activities: [...], tasks: [...], opportunities: [...], settings: {...} }` — arrays of the item objects themselves, each carrying its own `id`.

- [ ] **Step 1: Write the failing tests**

Create `tests/rls/replace.test.mjs`:

```js
import { test, assert } from "../health/framework.mjs";
import { sessions, seedRow, stillExists } from "./fixtures.mjs";

const payload = extra => ({
  accounts: [{ id: "r-new", name: "Imported" }],
  contacts: [], activities: [], tasks: [], opportunities: [],
  settings: { rates: { INR: 0.012 } }, ...extra,
});

test("replace_all swaps the whole dataset for an admin", async () => {
  await seedRow("accounts", "r-old", { id: "r-old", name: "Old" });
  const { error } = await sessions.admin.rpc("replace_all", { payload: payload() });
  assert(!error, `admin replace_all failed: ${error && error.message}`);
  assert(!(await stillExists("accounts", "r-old")), "the old row survived the replace");
  assert(await stillExists("accounts", "r-new"), "the new row was not inserted");
});

test("A FAILING replace_all leaves every original row in place", async () => {
  // THE D3 REGRESSION TEST. The old replaceAllRemote deleted all five tables in a loop and
  // only then inserted, so a failure anywhere in between emptied the team's database with
  // no backup. The failure here is induced by a malformed payload -- a row with no id in
  // the SECOND table, so the deletes have already run by the time it blows up.
  await seedRow("accounts", "r-keep", { id: "r-keep", name: "Must survive" });
  await seedRow("contacts", "r-keep-c", { id: "r-keep-c", name: "Must survive too" });
  const { error } = await sessions.admin.rpc("replace_all", {
    payload: payload({ contacts: [{ nope: "this row has no id" }] }),
  });
  assert(error, "a malformed payload was accepted — the replace is not validating rows");
  assert(await stillExists("accounts", "r-keep"),
    "THE DATABASE WAS EMPTIED — replace_all is not atomic");
  assert(await stillExists("contacts", "r-keep-c"),
    "THE DATABASE WAS EMPTIED — replace_all is not atomic");
  assert(!(await stillExists("accounts", "r-new")), "a partial insert was committed");
});

test("a plain user cannot replace_all", async () => {
  await seedRow("accounts", "r-guard", { id: "r-guard", name: "Guarded" });
  const { error } = await sessions.user.rpc("replace_all", { payload: payload() });
  assert(error, "a plain user's replace_all was allowed — it must stay admin-gated");
  assert(await stillExists("accounts", "r-guard"), "the plain user's replace took effect anyway");
});
```

Register it: add `import "./replace.test.mjs";` to `tests/rls/run.mjs`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/rls/run.mjs`
Expected: the 3 new cases FAIL with `Could not find the function public.replace_all`.

- [ ] **Step 3: Implement `replace_all` and switch the client over**

Append to `supabase-setup.sql` after `append_dedup`:

```sql
-- ---------- durable writes: atomic bulk replace ----------
-- A function body is ONE transaction, so the deletes and the inserts commit together or not
-- at all. The old client-side version deleted five tables in a loop and then inserted; any
-- failure in between -- a dropped connection, one bad row in an imported file -- left the
-- whole team with an empty database and no backup (D3). The import path was the worst,
-- because it validated only `s.accounts && s.settings` before destroying live data.
-- security invoker, as above: the admin gate is accounts_delete / settings_write, and it
-- must keep applying to the caller.
create or replace function public.replace_all(payload jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  t text;
  items jsonb;
begin
  foreach t in array array['accounts','contacts','activities','tasks','opportunities'] loop
    execute format('delete from public.%I', t);
  end loop;

  foreach t in array array['accounts','contacts','activities','tasks','opportunities'] loop
    items := coalesce(payload -> t, '[]'::jsonb);
    -- Reject a row with no id explicitly: `id text primary key` would raise on the null
    -- anyway, but naming the table makes the failure legible in the toast.
    if exists (select 1 from jsonb_array_elements(items) e where e ->> 'id' is null) then
      raise exception 'replace_all: every % row needs an id', t;
    end if;
    execute format(
      'insert into public.%I (id, data, updated_at)
       select e ->> ''id'', e, now() from jsonb_array_elements($1) e', t) using items;
  end loop;

  insert into settings (id, data, updated_at)
    values (1, coalesce(payload -> 'settings', '{}'::jsonb), now())
    on conflict (id) do update set data = excluded.data, updated_at = now();
end $$;
```

Replace `replaceAllRemote` in `crm.html` (line 371) entirely:

```js
/* bulk replace (sample data / clear / JSON import) — admin only, RLS enforced.
   One RPC, therefore one transaction: the deletes and inserts commit together or not at
   all. This previously deleted all five tables client-side and only then inserted, so any
   failure in between emptied the team's database with no backup. */
async function replaceAllRemote(state) {
  const payload = { settings: state.settings };
  for (const t of ENTITY_TABLES) payload[t] = state[t] || [];
  const { error } = await sb.rpc("replace_all", { payload });
  if (error) throw error;
}
```

The three call sites (via `bulkReplace` at `crm.html:2857` — sample, clear, import) need no change: the signature and the throw-on-failure contract are identical.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/rls/run.mjs` → expect 36 passed, 0 failed.
Then `node tests/health/run.mjs` (background, unpiped) → the import/sample/clear E2E paths must stay green.

- [ ] **Step 5: Commit**

```bash
git add supabase-setup.sql crm.html tests/rls/replace.test.mjs tests/rls/run.mjs
git commit -m "fix: replace all data in one transaction instead of emptying tables first"
```

---

### Task 5: The write queue — retry, rollback, serial per row

Closes D1.

**Files:**
- Modify: `crm.html` — add the queue immediately after `dbError` (~line 275); `persist`'s `up` enqueues instead of calling `sb`; add `writeQueue` to the `window.__health` export
- Test: `tests/health/writequeue.test.mjs` (create), `tests/health/harness.mjs` (fault injection)

**Interfaces:**
- Consumes: `diffRow` (Task 1), the `merge_row` call shape (Task 3).
- Produces:
  - `writeQueue.enqueue(op)` where `op` is `{ table, rowId, patch, appends }`
  - `writeQueue.queueState()` -> `{ status: "saving" | "saved" | "error", pending: number }`
  - `writeQueue.drain()` — runs the worker; exposed for tests
  - `window.__onQueueChange` — a callback the header subscribes to (Task 6)
  - `window.__refetch` — read by the queue for rollback; set in Task 6
  - `window.__health.writeQueue`

- [ ] **Step 1: Write the failing tests**

Extend the harness mock's `rpc` from Task 3 to honour fault injection — `window.__rpcFailures` (reject the next N calls), `window.__rpcDelay` (ms), and to stamp `started`/`ended` on each recorded call. Also count `window.__refetches` in the mocked `select`.

Create `tests/health/writequeue.test.mjs`:

```js
import { test, assert } from "./framework.mjs";
import { launchPersistent, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "q1", name: "Queue Co", arr: 100 });
const seed = `window.__seedRows = { accounts: [{ id: "q1", data: ${JSON.stringify(A)} }],
  contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [], profiles: [] };`;

test("a transient failure is retried and then succeeds", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcFailures = 1; window.__rpcCalls = []; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "q1", patch: { arr: 200 }, by: "T" }));
  await page.waitForFunction(
    () => window.__health.writeQueue.queueState().status === "saved", { timeout: 15000 });
  const n = await page.evaluate(() => window.__rpcCalls.length);
  assert(n === 2, `expected one failure plus one retry, got ${n} calls`);
  await browser.close();
});

test("a permanent failure ends in the error status and rolls back by refetching", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcFailures = 99; window.__refetches = 0; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "q1", patch: { arr: 900 }, by: "T" }));
  await page.waitForFunction(
    () => window.__health.writeQueue.queueState().status === "error", { timeout: 30000 });
  const st = await page.evaluate(() => ({
    arr: window.__store.getState().accounts[0].arr, refetches: window.__refetches }));
  assert(st.refetches > 0,
    "no refetch was issued — the local change was left diverged from the server");
  assert(st.arr === 100, `the failed edit was not rolled back: arr=${st.arr}`);
  await browser.close();
});

test("two edits to the same row are sent in order, never concurrently", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcCalls = []; window.__rpcDelay = 120; });
  await page.evaluate(() => {
    window.__store.dispatch({ type: "EDIT_ACCOUNT", id: "q1", patch: { arr: 300 }, by: "T" });
    window.__store.dispatch({ type: "EDIT_ACCOUNT", id: "q1", patch: { arr: 400 }, by: "T" });
  });
  await page.waitForFunction(
    () => window.__health.writeQueue.queueState().status === "saved", { timeout: 15000 });
  const calls = await page.evaluate(() => window.__rpcCalls.map(
    c => ({ arr: c.args.patch.arr, started: c.started, ended: c.ended })));
  assert(calls.length === 2, `expected 2 calls, got ${calls.length}`);
  assert(calls[0].arr === 300 && calls[1].arr === 400,
    `out of order: ${JSON.stringify(calls.map(c => c.arr))}`);
  assert(calls[1].started >= calls[0].ended,
    "the second write overlapped the first — same-row writes must be serial or the older value can win");
  await browser.close();
});

test("the status is 'saving' while work is pending and 'saved' once it drains", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcDelay = 300; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "q1", patch: { arr: 500 }, by: "T" }));
  const mid = await page.evaluate(() => window.__health.writeQueue.queueState());
  assert(mid.status === "saving" && mid.pending > 0, `expected saving, got ${JSON.stringify(mid)}`);
  await page.waitForFunction(
    () => window.__health.writeQueue.queueState().status === "saved", { timeout: 15000 });
  await browser.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/health/run-one.mjs writequeue`
Expected: FAIL — `window.__health.writeQueue is undefined`.

- [ ] **Step 3: Implement the queue**

Insert in `crm.html` after `dbError`:

```js
/* ------------------------------ write queue ------------------------------
   persist() used to be fire-and-forget: a failed write showed one toast and stopped, local
   state kept the change, and the user carried on editing a view the server never received
   (D1). Operations now go through this queue, which retries with backoff and -- if it
   finally gives up -- rolls the local state back by REFETCHING. Rollback by refetch rather
   than by inverting the reducer is deliberate: a refetch is unconditionally correct, while
   an undo-patch has to be right about what it is undoing, and would be a second chance to
   corrupt the same data. */
const BACKOFF_MS = [500, 2000, 8000];
const writeQueue = (() => {
  const pending = [];
  let running = false, status = "saved";
  const state = () => ({ status, pending: pending.length });
  const notify = () => window.__onQueueChange && window.__onQueueChange(state());
  const set = s => { status = s; notify(); };

  async function run() {
    if (running) return;
    running = true;
    // Strictly serial. Two edits to one account MUST NOT be in flight together, or they can
    // land out of order and the older value wins.
    while (pending.length) {
      const op = pending[0];
      const { error } = await sb.rpc("merge_row",
        { tbl: op.table, row_id: op.rowId, patch: op.patch, appends: op.appends });
      if (!error) { pending.shift(); continue; }
      if (op.attempts < BACKOFF_MS.length) {
        await new Promise(r => setTimeout(r, BACKOFF_MS[op.attempts++]));
        continue;
      }
      // Given up. Drop everything queued -- the refetch below is about to invalidate all of
      // it -- and resync from the server.
      pending.length = 0;
      running = false;
      set("error");
      dbError(op.table, error);
      if (window.__refetch) window.__refetch();
      return;
    }
    running = false;
    set("saved");
  }

  return {
    enqueue(op) { pending.push({ ...op, attempts: 0 }); set("saving"); run(); },
    queueState: state,
    drain: run,
  };
})();
```

In `persist`, `up` now enqueues instead of calling `sb` directly:

```js
  const up = (t, item) => {
    const { patch, appends, sets } = diffRow(prevOf(t, item.id), item);
    const full = { ...patch, ...sets };
    if (!Object.keys(full).length && !Object.keys(appends).length) return;
    writeQueue.enqueue({ table: t, rowId: item.id, patch: full, appends });
  };
```

Apply the same change to the settings case (enqueue `{ table: "settings", rowId: "1", ... }`). Add `writeQueue` to the `window.__health` export.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/health/run-one.mjs writequeue`, then the full suite in the background.
Expected: writequeue green; full suite 0 failed.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/writequeue.test.mjs tests/health/harness.mjs
git commit -m "feat: queue writes with retry and refetch rollback"
```

---

### Task 6: Sync indicator and the deferred refetch

**Files:**
- Modify: `crm.html` — a new `SyncStatus` component rendered in the header row; the `refetch` callback (~`crm.html:3206`); the realtime effect at `crm.html:3211`
- Test: `tests/health/syncstatus.test.mjs` (create), `tests/health/harness.mjs` (`window.__fireRealtime`)

**Interfaces:**
- Consumes: `writeQueue.queueState()` and `window.__onQueueChange` (Task 5).
- Produces: a `[data-sync-status]` element whose `data-sync-status` is `saving | saved | error`; `window.__refetch` set from the `refetch` callback so the queue can trigger rollback.

- [ ] **Step 1: Write the failing tests**

Add `window.__fireRealtime` to the harness mock's `channel(...).on(...)` so a teammate's change can be simulated (it should invoke the registered handler).

Create `tests/health/syncstatus.test.mjs`:

```js
import { test, assert } from "./framework.mjs";
import { launchPersistent, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "s1", name: "Sync Co", arr: 100 });
const seed = `window.__seedRows = { accounts: [{ id: "s1", data: ${JSON.stringify(A)} }],
  contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [], profiles: [] };`;

test("the header shows a saving indicator that settles to saved", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcDelay = 300; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "s1", patch: { arr: 200 }, by: "T" }));
  await page.waitForFunction(
    () => document.querySelector("[data-sync-status]")?.dataset.syncStatus === "saving");
  await page.waitForFunction(
    () => document.querySelector("[data-sync-status]")?.dataset.syncStatus === "saved",
    { timeout: 15000 });
  await browser.close();
});

test("the error status PERSISTS on screen rather than scrolling away like a toast", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcFailures = 99; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "s1", patch: { arr: 300 }, by: "T" }));
  await page.waitForFunction(
    () => document.querySelector("[data-sync-status]")?.dataset.syncStatus === "error",
    { timeout: 30000 });
  await new Promise(r => setTimeout(r, 6000)); // outlive the toast dismissal window
  const still = await page.evaluate(
    () => document.querySelector("[data-sync-status]")?.dataset.syncStatus);
  assert(still === "error",
    `the error indicator disappeared (now ${still}) — it must stay until the user resolves it`);
  await browser.close();
});

test("a teammate's realtime change does NOT refetch while writes are still queued", async () => {
  // Otherwise the user watches their own edit vanish and then reappear: the refetch
  // overwrites local state with a server view that does not contain the queued write yet.
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcDelay = 1500; window.__refetches = 0; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "s1", patch: { arr: 400 }, by: "T" }));
  await page.evaluate(() => window.__fireRealtime && window.__fireRealtime());
  await new Promise(r => setTimeout(r, 1000)); // past the 800ms debounce, still mid-write
  const during = await page.evaluate(() => window.__refetches);
  assert(during === 0, `a refetch fired with ${during} writes still queued`);
  await page.waitForFunction(
    () => window.__health.writeQueue.queueState().status === "saved", { timeout: 15000 });
  await page.waitForFunction(() => window.__refetches > 0, { timeout: 5000 });
  await browser.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/health/run-one.mjs syncstatus`
Expected: FAIL — no `[data-sync-status]` element exists.

- [ ] **Step 3: Implement the indicator and the deferral**

Add a component in `crm.html` near the other small header pieces:

```jsx
function SyncStatus() {
  const [s, setS] = useState(() => writeQueue.queueState());
  useEffect(() => { window.__onQueueChange = setS; return () => { window.__onQueueChange = null; }; }, []);
  if (s.status === "saved") return <span data-sync-status="saved" className="text-xs text-slate-400">Saved</span>;
  if (s.status === "saving") return <span data-sync-status="saving" className="text-xs text-slate-500">Saving…</span>;
  // Deliberately persistent. A toast scrolls away; an unsaved change must not. This is also
  // the first honest answer to the observability gap -- an error state that STAYS on screen.
  return <span data-sync-status="error" className="nm-inset px-2 py-1 text-xs font-medium text-rose-700"
    title="Your last change could not be saved and was rolled back. Check your connection and try again.">
    Not saved</span>;
}
```

Render `<SyncStatus />` in the header row, next to the existing user/bell controls.

Expose the refetch and defer it while the queue is busy — replace the realtime effect at `crm.html:3211`:

```js
  useEffect(() => { window.__refetch = refetch; }, [refetch]);
  useEffect(() => { // live updates from teammates: debounce, then refetch everything (data is small)
    let timer = null;
    const fire = () => {
      // Defer while our own writes are in flight. A refetch mid-queue replaces local state
      // with a server view that does not contain them yet, so the user's edit visibly
      // vanishes and then comes back.
      if (writeQueue.queueState().pending > 0) { timer = setTimeout(fire, 300); return; }
      refetch();
    };
    const ch = sb.channel("crm-live").on("postgres_changes", { event: "*", schema: "public" },
      () => { clearTimeout(timer); timer = setTimeout(fire, 800); }).subscribe();
    return () => { clearTimeout(timer); sb.removeChannel(ch); };
  }, [refetch]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/health/run-one.mjs syncstatus`, then the full health suite in the background, then `node tests/rls/run.mjs`.
Expected: all green, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/syncstatus.test.mjs tests/health/harness.mjs
git commit -m "feat: show sync status and hold refetches while writes are queued"
```

---

### Task 7: Falsification sweep, docs, and the PR

No new behaviour. This is the gate that proves the tests would actually catch a regression — the sweep is what caught the vacuous anonymous tests on PR #21.

**Files:**
- Modify: `TEAM-SETUP.md`, `docs/superpowers/specs/2026-08-17-data-durability-design.md` (status line)
- Create: `pr-durability.md` (PR body; untracked scratch)

- [ ] **Step 1: Run both suites clean**

```bash
node tests/rls/run.mjs
node tests/health/run.mjs
```
(health suite in the background, never piped). Record the exact counts for the PR body.

- [ ] **Step 2: Falsify five mutations**

Push each as a throwaway branch with a draft PR **in parallel** — per-ref concurrency cancels sequential pushes to one branch, so parallel refs take ~4 min against ~20. Read results with `gh run view --json conclusion`, never `gh run watch | tail` (the pipe reports exit 0 on a failed run).

1. Make `merge_row` `security definer` → the settings-denial and profiles-denial tests must go red.
2. Delete the `arrEvents` id-dedupe branch in `append_dedup` → the replay test must go red.
3. Make `diffRow` treat any longer array as an append (drop the prefix check) → the reorder, in-place-edit and removal cases must go red.
4. Remove the `raise exception` id guard from `replace_all` → the D3 regression test must go red.
5. Remove the `pending > 0` deferral in the realtime effect → the deferred-refetch test must go red.

Any mutation that leaves the suite green is a test that proves nothing — fix the test, not the mutation. Close and delete all five branches afterwards.

- [ ] **Step 3: Update the docs**

Add to `TEAM-SETUP.md` under the setup steps:

```markdown
**Re-run `supabase-setup.sql` after pulling this change.** It adds three functions —
`merge_row`, `append_dedup` and `replace_all` — that the app now depends on for every
write. Until you do, saves fail with "Could not find the function public.merge_row".
```

Flip the spec's `**Status:**` line to `implemented — see docs/superpowers/plans/2026-08-18-data-durability.md`.

- [ ] **Step 4: Commit and open the PR**

```bash
git add TEAM-SETUP.md docs/superpowers/specs/2026-08-17-data-durability-design.md
git commit -m "docs: note the required supabase-setup.sql re-run"
git push -u origin fix/data-durability
gh pr create --title "Data durability: field-level merges, a write queue, and an atomic replace" --body-file pr-durability.md
```

The PR body must attest to the sweep: all five mutations, which tests went red for each, and both suites' final counts.

- [ ] **Step 5: Confirm CI is green before requesting a merge decision**

```bash
gh pr view --json statusCheckRollup
```
Expected: `test` SUCCESS, `rls` SUCCESS, `deploy` SKIPPED. Do not merge — the merge decision is the user's.

---

## Notes for the executor

- **`git diff supabase-setup.sql` is no longer expected to be empty.** That was the invariant on PR #21; here the file changes by design, and `tests/rls/` pins the new behaviour. Never relax an existing RLS assertion to make a new function fit — that is the exact failure mode the spec's risk section names.
- **The RLS suite needs a real stack.** Local Docker is unavailable on this machine; push the branch and let the ubuntu runner execute the `rls` job. Do that by default for anything needing real Postgres.
- **Export the anon key** if you ever do run it locally — the hardcoded fallback in `fixtures.mjs` is stale, and `assertAnonIsAnonymous()` aborts the run rather than let the anonymous tests pass vacuously.
- The full health suite takes >10 minutes and blows the foreground Bash cap. Always `run_in_background: true`.
- **A `merge_row` that writes `data` wholesale would pass Task 3's tests and still clobber.** The tests that actually pin the merge live in `tests/rls/merge.test.mjs`, against real Postgres — do not treat the mocked E2E cases as coverage of the merge semantics.
