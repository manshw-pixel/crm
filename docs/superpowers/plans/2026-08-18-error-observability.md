# Error Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production failures visible to an admin without a user having to report them — capture crashes, failed writes, failed loads and retries into a Supabase table, and show them in an admin-only panel.

**Architecture:** A single `reportError(level, error, context)` helper is wired to the seven places errors already surface. It calls a `log_error` RPC that upserts on a fingerprint, incrementing an occurrence count inside the statement rather than read-modify-writing it. The reporter is fire-and-forget, self-swallowing, re-entrancy guarded, and deliberately bypasses the write queue — whose own failure it reports.

**Tech Stack:** Single-file React app (`crm.html`, JSX compiled by `build.mjs`), Supabase (PostgREST + Postgres RPC + RLS), plain-`assert` test framework, Playwright E2E (`tests/health/`), real-Postgres RLS suite (`tests/rls/`).

**Spec:** `docs/superpowers/specs/2026-08-18-error-observability-design.md`

## Global Constraints

- **`log_error` MUST be `security invoker`, never `security definer`.** A definer function bypasses every RLS policy `tests/rls/` pins. Five functions in `supabase-setup.sql` are already invoker; match them.
- **`supabase-setup.sql` must stay idempotent and re-runnable** — `tests/rls/fixtures.mjs` applies it verbatim on every reset, so one non-idempotent statement breaks the entire RLS suite. Use `create table if not exists`, `create or replace function`, `drop policy if exists` + `create policy`.
- **Every DELETE needs a WHERE clause.** Supabase rejects an unqualified `delete from t` with "DELETE requires a WHERE clause". This bit the last change in CI. The prune's `where last_seen < …` satisfies it; don't add any bare delete.
- **Register every new test file.** `tests/health/run.mjs` and `tests/rls/run.mjs` import test files explicitly. On the previous change 15 tests sat unregistered and never ran — locally or in CI — while the suite reported a reassuring pass count. After adding a test file, confirm the total case count rises by the number you added.
- **Never pipe a test run.** `node tests/health/run.mjs` and `node tests/rls/run.mjs` exit codes ARE the gate; `| tail` or `; git …` reports the wrong status. The full health suite takes >10 min — run it with `run_in_background: true`.
- **`node tests/health/run-one.mjs <file.test.mjs>` needs the FULL filename**, and `node build.mjs` must run first — the harness reads `dist/crm.html`, not the source.
- **Playwright, not Puppeteer.** `page.evaluate(fn, arg)` takes exactly ONE argument and silently drops the rest. Pass an array and destructure.
- **Any test seed needs a non-empty `profiles`.** With `profiles: []` the app never mounts, `window.__store` is never assigned, and every `waitForFunction` dies on a 30s timeout with no page error. Use `profiles: [{ id: "u1", name: "Test User", role: "admin" }]`.
- **The reporter never routes through `writeQueue`** and never surfaces its own failure to the user.
- **`context` never carries row data** — no patch contents, no account field values. Row ids are fine.
- Branch: `feat/error-observability`, off master `3a3ec80`, spec commit `c8146a0`.

---

### Task 1: `error_log` table, RLS policies, and the `log_error` RPC

**Files:**
- Modify: `supabase-setup.sql` — new section after `replace_all`, before `-- ---------- realtime ----------`
- Create: `tests/rls/errorlog.test.mjs`
- Modify: `tests/rls/run.mjs` — register the new file

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.error_log`; RPC `log_error(fingerprint text, level text, message text, stack text, context jsonb, app_version text, user_agent text) returns void`, called as `sb.rpc("log_error", { fingerprint, level, message, stack, context, app_version, user_agent })`.

- [ ] **Step 1: Write the failing tests**

Create `tests/rls/errorlog.test.mjs`:

```js
// error_log against a REAL Postgres. The access rules and the counting are the
// load-bearing claims here and neither can be proven against a mock.
import { test, assert } from "../health/framework.mjs";
import { sessions } from "./fixtures.mjs";

const report = (who, fingerprint, extra = {}) =>
  sessions[who].rpc("log_error", {
    fingerprint, level: "crash", message: "boom", stack: "at x()",
    context: { view: "Accounts" }, app_version: "test", user_agent: "node",
    ...extra,
  });

const rowsAsAdmin = async fp => {
  const { data } = await sessions.admin.from("error_log").select("*").eq("fingerprint", fp);
  return data || [];
};

test("a plain user can report an error", async () => {
  const { error } = await report("user", "fp-user-1");
  assert(!error, `a plain user's report was rejected: ${error && error.message}`);
  assert((await rowsAsAdmin("fp-user-1")).length === 1, "the row was not written");
});

test("a plain user cannot READ the error log", async () => {
  await report("admin", "fp-read-1");
  const { data, error } = await sessions.user.from("error_log").select("*").eq("fingerprint", "fp-read-1");
  // RLS makes the rows invisible rather than raising, so assert on emptiness AND on the
  // row genuinely existing for an admin -- otherwise this passes when nothing was written.
  assert(!error, `unexpected error shape: ${error && error.message}`);
  assert((data || []).length === 0, "a plain user could read the error log");
  assert((await rowsAsAdmin("fp-read-1")).length === 1,
    "the row does not exist at all — the previous assertion proved nothing");
});

test("an admin can read the error log", async () => {
  await report("admin", "fp-read-2");
  const { data, error } = await sessions.admin.from("error_log").select("*").eq("fingerprint", "fp-read-2");
  assert(!error, `admin read failed: ${error && error.message}`);
  assert((data || []).length === 1, "the admin saw no rows");
});

test("an anonymous client can neither report nor read", async () => {
  const { error: insErr } = await report("anon", "fp-anon-1");
  assert(insErr, "an anonymous client was allowed to report an error");
  const { data } = await sessions.anon.from("error_log").select("*").limit(1);
  assert((data || []).length === 0, "an anonymous client could read the error log");
});

test("reporting the same fingerprint twice yields ONE row with count 2", async () => {
  await report("admin", "fp-count-1");
  await report("admin", "fp-count-1");
  const rows = await rowsAsAdmin("fp-count-1");
  assert(rows.length === 1, `expected one row, got ${rows.length}`);
  assert(rows[0].count === 2, `expected count 2, got ${rows[0].count}`);
});

test("N concurrent reports of one fingerprint all count", async () => {
  // The regression test for the read-modify-write race this design exists to avoid.
  // Reporting runs when the app is already unhealthy and concurrent failures are
  // CORRELATED -- one flaky network breaks every open tab at once -- so this is the
  // realistic case, not an exotic one.
  const N = 20;
  const results = await Promise.all(
    Array.from({ length: N }, () => report("admin", "fp-race-1")));
  const failed = results.filter(r => r.error);
  assert(!failed.length, `${failed.length} of ${N} reports errored: ${failed[0] && failed[0].error.message}`);
  const rows = await rowsAsAdmin("fp-race-1");
  assert(rows.length === 1, `expected one row, got ${rows.length}`);
  assert(rows[0].count === N,
    `${N - rows[0].count} of ${N} concurrent reports were LOST — the count is read-modify-write, not atomic. Got ${rows[0].count}`);
});

test("log_error stamps user_id from auth.uid(), ignoring the client", async () => {
  const { data: me } = await sessions.user.auth.getUser();
  await report("user", "fp-uid-1");
  const rows = await rowsAsAdmin("fp-uid-1");
  assert(rows[0].user_id === me.user.id,
    `expected the caller's own id, got ${rows[0].user_id}`);
});

test("a plain user cannot update or delete a row to erase their own errors", async () => {
  await report("user", "fp-tamper-1");
  const { error: upErr } = await sessions.user.from("error_log")
    .update({ count: 0, message: "nothing to see" }).eq("fingerprint", "fp-tamper-1");
  const { error: delErr } = await sessions.user.from("error_log")
    .delete().eq("fingerprint", "fp-tamper-1");
  // A denied update/delete raises nothing and affects zero rows, so read back as admin.
  assert(!upErr, `unexpected error shape: ${upErr && upErr.message}`);
  assert(!delErr, `unexpected error shape: ${delErr && delErr.message}`);
  const rows = await rowsAsAdmin("fp-tamper-1");
  assert(rows.length === 1, "the row was deleted — there must be no delete policy");
  assert(rows[0].message === "boom", "the row was edited — there must be no update policy");
});
```

Register it: add `import "./errorlog.test.mjs";` to `tests/rls/run.mjs` with the other imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/rls/run.mjs`
Expected: the 8 new cases FAIL with `Could not find the function public.log_error`. The existing 38 still pass.

**Docker is unavailable on this machine, so you cannot run this locally.** That is expected — CI runs it. Verify instead that the file parses (`node --check`), that the cases register, and re-read the SQL carefully, then say plainly in your report what remains unverified.

- [ ] **Step 3: Implement the table, policies and RPC**

Insert into `supabase-setup.sql` immediately before `-- ---------- realtime ----------`:

```sql
-- ---------- error log ----------
-- The app had no error reporting at all: ViewBoundary console.errored into a console
-- nobody watches, dbError raised a toast that scrolls away, and the write queue's give-up
-- path told only the user whose save had just failed.
create table if not exists public.error_log (
  -- The fingerprint IS the identity: the same bug collapses to one row whether it fires
  -- once or ten thousand times, so "is this getting worse?" is answered by reading `count`
  -- rather than by counting rows.
  fingerprint text primary key,
  level       text not null check (level in ('crash','write_failed','load_failed','retry')),
  message     text not null,
  stack       text,
  -- Context only: the view, table, action and error code. NEVER row data -- this app's
  -- subject matter is customer revenue, and copying it into a second table with different
  -- access rules would be a privacy regression dressed up as an improvement.
  context     jsonb not null default '{}'::jsonb,
  user_id     uuid,
  app_version text,
  user_agent  text,
  count       int not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

alter table public.error_log enable row level security;

-- insert: ANY authenticated user. Errors happen to non-admins, and a user who cannot
-- report is a user you never hear about. This is deliberately the most permissive policy
-- in the file: a signed-in user can write rows an admin reads. Accepted knowingly --
-- restricting it would blind the log to exactly the people worth hearing from, and
-- fingerprint collapsing turns a flood into one row with a high count rather than many rows.
drop policy if exists error_log_insert on public.error_log;
create policy error_log_insert on public.error_log for insert to authenticated with check (true);

-- select: admins only. Error messages quote application data.
drop policy if exists error_log_select on public.error_log;
create policy error_log_select on public.error_log for select to authenticated using (public.is_admin());

-- NO update and NO delete policy, deliberately. log_error owns every mutation, so nobody
-- can edit or delete a record -- including its count -- to erase their own errors.

-- Records one occurrence. The count is incremented INSIDE the statement rather than by a
-- client read-then-write, which would be the same lost update merge_row was rewritten to
-- remove. Reporting is the worst place to reintroduce it: it runs when the app is already
-- unhealthy, and concurrent failures are correlated, not independent -- one flaky network
-- breaks every open tab at once.
-- security invoker, as with every function above: a definer function would bypass the
-- policies this file defines, including the admin-only select.
create or replace function public.log_error(
  fingerprint text, level text, message text, stack text,
  context jsonb, app_version text, user_agent text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  insert into error_log (fingerprint, level, message, stack, context, user_id, app_version, user_agent)
  values (fingerprint, level, message, stack, coalesce(context, '{}'::jsonb),
          auth.uid(), app_version, user_agent)
  on conflict (fingerprint) do update set
    count = error_log.count + 1,
    last_seen = now(),
    -- keep the most recent occurrence's detail
    message = excluded.message,
    stack = excluded.stack,
    context = excluded.context;

  -- Retention, run here rather than on a schedule: this project has no scheduler, and the
  -- work is trivial. The WHERE is not optional -- Supabase rejects an unqualified DELETE.
  delete from error_log where last_seen < now() - interval '30 days';
end $$;
```

Note `user_id` is taken from `auth.uid()` inside the function and is NOT a parameter, so a client cannot attribute an error to someone else.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/rls/run.mjs` — expect 46 passed, 0 failed. (Not runnable locally; CI is the gate.)

- [ ] **Step 5: Commit**

```bash
git add supabase-setup.sql tests/rls/errorlog.test.mjs tests/rls/run.mjs
git commit -m "feat: add the error_log table and the log_error RPC"
```

---

### Task 2: `APP_VERSION` and the `reportError` helper

**Files:**
- Modify: `crm.html` — add `APP_VERSION` near the top constants; add `reportError` immediately after `dbError` (~line 275); add both to the `window.__health` export
- Modify: `build.mjs` — substitute the real version at build time
- Create: `tests/health/reporterror.test.mjs`
- Modify: `tests/health/run.mjs` — register the new file
- Modify: `tests/health/harness.mjs` — the mocks must record `log_error` calls and support failure injection

**Interfaces:**
- Consumes: the `log_error` RPC shape from Task 1.
- Produces:
  - `reportError(level, error, context)` — fire-and-forget, returns nothing, never throws
  - `fingerprintOf(level, message, where)` -> stable string
  - `APP_VERSION` — string, `"dev"` in source, the short commit SHA in a build
  - `window.__health.reportError` and `window.__health.fingerprintOf` for tests

- [ ] **Step 1: Write the failing tests**

First extend `tests/health/harness.mjs`. Both mocks' `rpc` already record into `window.__rpcCalls`; add failure injection specific to reporting so a failing reporter can be tested without failing every write:

```js
// inside the mocked rpc, before the existing merge handling:
if (fn === "log_error" && window.__logErrorFails) {
  return Promise.reject(new Error("mock log_error rejection"));
}
```

Make sure the plain `MOCK` also records `window.__rpcCalls` for `log_error`, since crash tests use `launch()` rather than `launchPersistent`.

Create `tests/health/reporterror.test.mjs`:

```js
import { test, assert } from "./framework.mjs";
import { launch } from "./harness.mjs";

const SEED = `window.__seedRows = { accounts: [], contacts: [], activities: [], tasks: [],
  opportunities: [], team: [], settings: [],
  profiles: [{ id: "u1", name: "Test User", role: "admin" }] };`;

let page, browser;
const boot = async () => { if (!page) ({ page, browser } = await launch(SEED)); };
const logCalls = () => page.evaluate(() =>
  (window.__rpcCalls || []).filter(c => c.fn === "log_error").map(c => c.args));

test("reportError sends one log_error with the level and message", async () => {
  await boot();
  await page.evaluate(() => {
    window.__rpcCalls = [];
    window.__health.reportError("crash", new Error("kaboom"), { view: "Accounts" });
  });
  await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "log_error"));
  const [args] = await logCalls();
  assert(args.level === "crash", `level was ${args.level}`);
  assert(/kaboom/.test(args.message), `message was ${args.message}`);
  assert(args.context.view === "Accounts", `context was ${JSON.stringify(args.context)}`);
  assert(typeof args.fingerprint === "string" && args.fingerprint.length > 0,
    "no fingerprint was sent");
});

test("reportError NEVER throws, even when the RPC rejects", async () => {
  await boot();
  // The reporter runs when the app is already broken. If it can throw, it converts a
  // handled error into an unhandled one -- strictly worse than not reporting at all.
  const threw = await page.evaluate(() => {
    window.__logErrorFails = true;
    try { window.__health.reportError("crash", new Error("x"), {}); return false; }
    catch (e) { return true; }
    finally { window.__logErrorFails = false; }
  });
  assert(!threw, "reportError threw — it must swallow its own failure");
});

test("a rejected report surfaces nothing to the user", async () => {
  await boot();
  await page.evaluate(async () => {
    window.__logErrorFails = true;
    window.__toastCount = 0;
    const realToast = window.__toast;
    window.__toast = (...a) => { window.__toastCount++; return realToast && realToast(...a); };
    window.__health.reportError("crash", new Error("y"), {});
    await new Promise(r => setTimeout(r, 300));
    window.__logErrorFails = false;
  });
  const toasts = await page.evaluate(() => window.__toastCount);
  assert(toasts === 0, `the failed report raised ${toasts} toast(s) — a meta-error must stay silent`);
});

test("identical errors are throttled into one call", async () => {
  await boot();
  await page.evaluate(async () => {
    window.__rpcCalls = [];
    for (let i = 0; i < 25; i++) window.__health.reportError("retry", new Error("same"), { table: "accounts" });
    await new Promise(r => setTimeout(r, 200));
  });
  const calls = await logCalls();
  assert(calls.length === 1,
    `expected the burst to coalesce into 1 call, got ${calls.length} — Postgres dedupes anyway, but a tight failure loop must not emit a request per occurrence`);
});

test("different errors are NOT throttled together", async () => {
  await boot();
  await page.evaluate(async () => {
    window.__rpcCalls = [];
    window.__health.reportError("crash", new Error("first"), {});
    window.__health.reportError("crash", new Error("second"), {});
    await new Promise(r => setTimeout(r, 200));
  });
  const calls = await logCalls();
  assert(calls.length === 2, `distinct errors must each report, got ${calls.length}`);
});

test("the fingerprint is stable for the same error and differs across errors", async () => {
  await boot();
  const [a, b, c] = await page.evaluate(() => [
    window.__health.fingerprintOf("crash", "boom", "Accounts"),
    window.__health.fingerprintOf("crash", "boom", "Accounts"),
    window.__health.fingerprintOf("crash", "boom", "Tasks"),
  ]);
  assert(a === b, "the same error produced two fingerprints — rows would never collapse");
  assert(a !== c, "different views produced the same fingerprint — distinct bugs would merge");
});

test("reportError does NOT enqueue onto the write queue", async () => {
  await boot();
  // The queue's own failure is one of the things reportError reports. Routing reports
  // through the queue would mean a failing queue reports its failure by enqueuing another
  // operation onto the failing queue.
  const pendingAfter = await page.evaluate(async () => {
    window.__health.reportError("write_failed", new Error("z"), { table: "accounts" });
    await new Promise(r => setTimeout(r, 100));
    return window.__health.writeQueue.queueState().pending;
  });
  assert(pendingAfter === 0, `the report was enqueued (pending=${pendingAfter})`);
  if (browser) await browser.close();
});
```

Register it: add `import "./reporterror.test.mjs";` to `tests/health/run.mjs`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node build.mjs && node tests/health/run-one.mjs reporterror.test.mjs`
Expected: FAIL — `window.__health.reportError is not a function`.

- [ ] **Step 3: Implement `APP_VERSION`, `fingerprintOf` and `reportError`**

In `crm.html`, near the other top-level constants (beside `SUPABASE_URL`), add:

```js
// build.mjs replaces this exact literal with the short commit SHA. Kept as a plain literal
// rather than a placeholder token so the source stays runnable un-built.
const APP_VERSION = "dev";
```

Immediately after `dbError`, add:

```js
/* ------------------------------ error reporting ------------------------------
   Everything below runs when the app is ALREADY broken, so every branch here is written
   to fail quietly rather than to be clever. */

// Collapse volatile substrings so the same bug fingerprints identically across
// occurrences: ids, uuids, numbers and quoted values differ per instance and would
// otherwise produce a new row every time, defeating the whole point of the count.
const fingerprintOf = (level, message, where) => {
  const norm = String(message || "")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "<uuid>")
    .replace(/\d+/g, "<n>")
    .replace(/'[^']*'/g, "'<v>'")
    .slice(0, 200);
  return `${level}|${where || "-"}|${norm}`;
};

const REPORT_THROTTLE_MS = 10000;
const reportedAt = new Map();
let reporting = false;

function reportError(level, error, context) {
  try {
    // Re-entrancy guard: an error raised INSIDE reporting must not report itself.
    if (reporting) return;
    const message = String((error && error.message) || error || "unknown");
    const where = (context && (context.view || context.table)) || null;
    const fingerprint = fingerprintOf(level, message, where);

    // Postgres dedupes by fingerprint anyway; this stops a tight failure loop emitting a
    // request per occurrence to get there. `retry` is a captured level and a flaky
    // connection produces those in bursts.
    const now = Date.now();
    const last = reportedAt.get(fingerprint);
    if (last && now - last < REPORT_THROTTLE_MS) return;
    reportedAt.set(fingerprint, now);

    reporting = true;
    try {
      // Deliberately NOT writeQueue.enqueue: the queue's failure is one of the things
      // reported here, and a failing queue must not report by using the failing queue.
      const p = sb.rpc("log_error", {
        fingerprint, level, message,
        stack: (error && error.stack) ? String(error.stack).slice(0, 4000) : null,
        context: context || {},
        app_version: APP_VERSION,
        user_agent: navigator.userAgent,
      });
      // Swallow both shapes: supabase-js REJECTS on network/CORS and RESOLVES { error }
      // otherwise. There is nowhere better to send a failure to report a failure.
      if (p && p.then) p.then(() => {}, () => {});
    } finally {
      reporting = false;
    }
  } catch (e) {
    // Never let reporting convert a handled error into an unhandled one.
  }
}
```

Add `reportError` and `fingerprintOf` to the `window.__health` export.

In `build.mjs`, after the source is read and before it is written, substitute the version:

```js
// Stamp the build so an error report says which build produced it. Targeted string
// replace on a known literal rather than a head rewrite -- an earlier build regenerated
// <head> from a template and silently ate every edit made to it.
const sha = execSync("git rev-parse --short HEAD").toString().trim();
html = html.replace('const APP_VERSION = "dev";', `const APP_VERSION = "${sha}";`);
```

Import `execSync` from `node:child_process` at the top of `build.mjs` if it is not already imported.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node build.mjs && node tests/health/run-one.mjs reporterror.test.mjs` — expect 7 passed.
Then confirm the build stamped a version: `grep -c 'const APP_VERSION = "dev"' dist/crm.html` must print `0`.

- [ ] **Step 5: Commit**

```bash
git add crm.html build.mjs tests/health/reporterror.test.mjs tests/health/run.mjs tests/health/harness.mjs
git commit -m "feat: add reportError with fingerprinting, throttling and a version stamp"
```

---

### Task 3: Wire the seven capture sites

**Files:**
- Modify: `crm.html` — `ViewBoundary.componentDidCatch` (~3275), `dbError` (~268), the write queue's give-up and retry branches (~295-330), `refetch`'s catch (~3326), and a new effect installing the two global hooks
- Create: `tests/health/capture.test.mjs`
- Modify: `tests/health/run.mjs` — register it

**Interfaces:**
- Consumes: `reportError(level, error, context)` from Task 2.
- Produces: no new exports. `window.onerror` and `unhandledrejection` listeners installed once at mount.

- [ ] **Step 1: Write the failing tests**

Create `tests/health/capture.test.mjs`:

```js
import { test, assert } from "./framework.mjs";
import { launchPersistent, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "c1", name: "Capture Co", arr: 100 });
const seed = `window.__seedRows = { accounts: [{ id: "c1", data: ${JSON.stringify(A)} }],
  contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [],
  profiles: [{ id: "u1", name: "Test User", role: "admin" }] };`;

const logCalls = page => page.evaluate(() =>
  (window.__rpcCalls || []).filter(c => c.fn === "log_error").map(c => c.args));

test("a permanently failing write reports write_failed", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcFailures = 99; window.__rpcCalls = []; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "c1", patch: { arr: 555 }, by: "T" }));
  await page.waitForFunction(
    () => (window.__rpcCalls || []).some(c => c.fn === "log_error"), { timeout: 30000 });
  const calls = await logCalls(page);
  assert(calls.some(a => a.level === "write_failed"),
    `expected a write_failed report, got ${JSON.stringify(calls.map(c => c.level))}`);
  await browser.close();
});

test("a transient failure that later succeeds reports retry", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcFailures = 1; window.__rpcCalls = []; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "c1", patch: { arr: 666 }, by: "T" }));
  await page.waitForFunction(
    () => window.__health.writeQueue.queueState().status === "saved", { timeout: 15000 });
  const calls = await logCalls(page);
  assert(calls.some(a => a.level === "retry"),
    `expected a retry report, got ${JSON.stringify(calls.map(c => c.level))}`);
  await browser.close();
});

test("an uncaught error is reported as a crash", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcCalls = []; });
  await page.evaluate(() => {
    // Throw asynchronously so it reaches window.onerror rather than this evaluate call.
    setTimeout(() => { throw new Error("uncaught boom"); }, 0);
  });
  await page.waitForFunction(
    () => (window.__rpcCalls || []).some(c => c.fn === "log_error" && c.args.level === "crash"),
    { timeout: 10000 });
  const calls = await logCalls(page);
  assert(calls.some(a => /uncaught boom/.test(a.message)),
    `the thrown message was not reported: ${JSON.stringify(calls.map(c => c.message))}`);
  await browser.close();
});

test("an unhandled promise rejection is reported as a crash", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcCalls = []; });
  await page.evaluate(() => { Promise.reject(new Error("rejected boom")); });
  await page.waitForFunction(
    () => (window.__rpcCalls || []).some(c => c.fn === "log_error" && c.args.level === "crash"),
    { timeout: 10000 });
  const calls = await logCalls(page);
  assert(calls.some(a => /rejected boom/.test(a.message)),
    `the rejection was not reported: ${JSON.stringify(calls.map(c => c.message))}`);
  await browser.close();
});

test("no report carries row data in its context", async () => {
  // The whole point of the "context, never row data" boundary. A regression here copies
  // customer revenue into a table with different access rules.
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcFailures = 99; window.__rpcCalls = []; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "c1", patch: { arr: 987654 }, by: "T" }));
  await page.waitForFunction(
    () => (window.__rpcCalls || []).some(c => c.fn === "log_error"), { timeout: 30000 });
  const calls = await logCalls(page);
  const blob = JSON.stringify(calls.map(c => c.context));
  assert(!/987654/.test(blob), `the failed patch's VALUES leaked into context: ${blob}`);
  assert(!/Capture Co/.test(blob), `an account name leaked into context: ${blob}`);
  await browser.close();
});
```

Register it: add `import "./capture.test.mjs";` to `tests/health/run.mjs`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node build.mjs && node tests/health/run-one.mjs capture.test.mjs`
Expected: FAIL — nothing calls `log_error` yet.

- [ ] **Step 3: Wire the call sites**

`ViewBoundary.componentDidCatch` — keep the console line, add the report:

```js
  componentDidCatch(error, info) {
    console.error("View crashed:", this.props.view, error, info);
    reportError("crash", error, { view: this.props.view });
  }
```

`dbError` — add one line before the toast:

```js
const dbError = (where, error) => {
  console.error(where, error);
  reportError("write_failed", error, { table: where, code: error && error.code });
  const text = `Save failed (${where}): ${error.message}\nYour last change may not be shared — reload to resync.`;
  if (window.__toast) window.__toast({ text, tone: "error" }); else alert(text);
};
```

Note `dbError` is already called on the queue's give-up path, so that site is covered by this one change — do not add a second report there or every give-up reports twice.

The queue's retry branch — report the transient failure before sleeping:

```js
      if (op.attempts < BACKOFF_MS.length) {
        reportError("retry", error, { table: op.table, rowId: op.rowId, attempt: op.attempts });
        await new Promise(r => setTimeout(r, BACKOFF_MS[op.attempts++]));
        continue;
      }
```

`refetch`'s catch:

```js
    .catch(e => {
      console.error(e);
      reportError("load_failed", e, { where: "fetchAll" });
      toast({ text: "Could not load shared data: " + e.message, tone: "error" });
    }), []);
```

The two global hooks — add an effect beside the other window-level effects in the root component:

```js
  useEffect(() => { // errors that never reach a React boundary
    const onErr = e => reportError("crash", e.error || e.message, { where: "window.onerror" });
    const onRej = e => reportError("crash", e.reason, { where: "unhandledrejection" });
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);
```

**Do not put row values into any `context`.** Table names, row ids, action types, attempt numbers and error codes are fine; `patch`, `appends` and account fields are not.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node build.mjs && node tests/health/run-one.mjs capture.test.mjs` — expect 5 passed.
Then the FULL suite, `run_in_background: true`, unpiped: `node tests/health/run.mjs`. Report the real counts. This is not optional — a previous change to `harness.mjs` broke unrelated tests and only the full suite caught it.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/capture.test.mjs tests/health/run.mjs
git commit -m "feat: report crashes, failed writes, failed loads and retries"
```

---

### Task 4: The admin error panel

**Files:**
- Modify: `crm.html` — add an `ErrorLogCard` component next to `UsersCard` (~3089) and render it in the Settings grid beside `<UsersCard me={user} />` (~3001)
- Create: `tests/health/errorpanel.test.mjs`
- Modify: `tests/health/run.mjs` — register it

**Interfaces:**
- Consumes: the `error_log` table from Task 1.
- Produces: a `[data-errorlog]` container; each row carries `[data-errorlog-row]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/health/errorpanel.test.mjs`:

```js
import { test, assert } from "./framework.mjs";
import { launch } from "./harness.mjs";

const ROWS = [
  { fingerprint: "fp1", level: "crash", message: "Cannot read x", stack: "at A()",
    context: { view: "Accounts" }, count: 12, last_seen: "2026-08-18T10:00:00Z" },
  { fingerprint: "fp2", level: "write_failed", message: "timeout", stack: null,
    context: { table: "accounts" }, count: 3, last_seen: "2026-08-18T09:00:00Z" },
];

const seedFor = (role, rows) => `window.__seedRows = { accounts: [], contacts: [],
  activities: [], tasks: [], opportunities: [], team: [], settings: [],
  profiles: [{ id: "u1", name: "Test User", role: ${JSON.stringify(role)} }],
  error_log: ${JSON.stringify(rows)} };`;

test("an admin sees the error panel with counts", async () => {
  const { page, browser } = await launch(seedFor("admin", ROWS));
  await page.waitForFunction(() => window.__store);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForSelector("[data-errorlog]", { timeout: 10000 });
  const text = await page.textContent("[data-errorlog]");
  assert(/Cannot read x/.test(text), `the message is missing: ${text}`);
  assert(/12/.test(text), `the occurrence count is missing: ${text}`);
  await browser.close();
});

test("the panel lists the most recent error first", async () => {
  const { page, browser } = await launch(seedFor("admin", ROWS));
  await page.waitForFunction(() => window.__store);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForSelector("[data-errorlog-row]", { timeout: 10000 });
  const first = await page.evaluate(() =>
    document.querySelector("[data-errorlog-row]").textContent);
  assert(/Cannot read x/.test(first),
    `expected the newest error first, got: ${first}`);
  await browser.close();
});

test("a plain user has no Settings view, so no error panel", async () => {
  // Settings is removed from VIEWS entirely for non-admins (crm.html:3297), so the panel
  // is unreachable rather than merely hidden. Assert BOTH: that the nav button is gone and
  // that the panel is nowhere in the document -- checking only the second would pass just
  // because the user is parked on a different view.
  const { page, browser } = await launch(seedFor("user", ROWS));
  await page.waitForFunction(() => window.__store);
  const settingsBtn = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Settings"));
  assert(!settingsBtn, "a plain user was offered the Settings view");
  const present = await page.evaluate(() => !!document.querySelector("[data-errorlog]"));
  assert(!present, "the error panel rendered for a non-admin");
  await browser.close();
});

test("an empty log shows a neutral message, not an error state", async () => {
  const { page, browser } = await launch(seedFor("admin", []));
  await page.waitForFunction(() => window.__store);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForSelector("[data-errorlog]", { timeout: 10000 });
  const text = await page.textContent("[data-errorlog]");
  assert(/no errors/i.test(text), `expected a neutral empty state, got: ${text}`);
  await browser.close();
});
```

Both mocks in `tests/health/harness.mjs` must serve `error_log`. The card chains
`select(...).order(...).limit(...)`, which the existing table api does not support, so add a
dedicated api modelled on the `profilesApi()` already in both mocks:

```js
  const errorLogApi = () => ({
    select: () => {
      const rows = window.__seedRows?.error_log || [];
      const p = Promise.resolve({ data: rows, error: null });
      // The card chains .order(...).limit(...), so each link must return a thenable that
      // also carries the next link -- the same shape profilesApi() uses for .order().
      p.order = () => { const q = Promise.resolve({ data: rows, error: null }); q.limit = () => Promise.resolve({ data: rows, error: null }); return q; };
      p.limit = () => Promise.resolve({ data: rows, error: null });
      return p;
    },
  });
```

Then route it in both mocks' `from`, e.g. `from: t => t === "profiles" ? profilesApi() : t === "error_log" ? errorLogApi() : api(t)`. Mirror the same change in the plain `MOCK`'s `fromImpl`.

Register it: add `import "./errorpanel.test.mjs";` to `tests/health/run.mjs`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node build.mjs && node tests/health/run-one.mjs errorpanel.test.mjs`
Expected: FAIL — no `[data-errorlog]` element.

- [ ] **Step 3: Implement the card**

Model it on `UsersCard` (`crm.html:3089`), which already does load-on-mount with local state and an error string:

```jsx
const LEVEL_STYLE = {
  crash: "bg-rose-50 text-rose-700",
  write_failed: "bg-amber-50 text-amber-700",
  load_failed: "bg-amber-50 text-amber-700",
  retry: "bg-slate-100 text-slate-600",
};

function ErrorLogCard() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  useEffect(() => {
    sb.from("error_log").select("*").order("last_seen", { ascending: false }).limit(50)
      .then(({ data, error }) => error ? setErr(error.message) : setRows(data || []));
  }, []);
  return (
    <Card title="Error log">
      <div data-errorlog>
        {err && <p className="text-xs text-rose-600">{err}</p>}
        {!err && !rows.length && <p className="text-xs text-slate-500">No errors recorded. Nothing has failed in the last 30 days.</p>}
        {rows.map(r => (
          <div key={r.fingerprint} data-errorlog-row className="nm-inset mb-2 p-2">
            <div className="flex items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${LEVEL_STYLE[r.level] || "bg-slate-100 text-slate-700"}`}>{r.level}</span>
              <span className="flex-1 truncate text-xs text-slate-700">{r.message}</span>
              <span className="text-[11px] font-mono text-slate-500">×{r.count}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
              <span>{new Date(r.last_seen).toLocaleString()}</span>
              {r.context && r.context.view && <span>· {r.context.view}</span>}
              {r.context && r.context.table && <span>· {r.context.table}</span>}
              {r.stack && <button className="ml-auto underline" onClick={() => setOpen(open === r.fingerprint ? null : r.fingerprint)}>
                {open === r.fingerprint ? "hide" : "stack"}</button>}
            </div>
            {open === r.fingerprint && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] text-slate-500">{r.stack}</pre>}
          </div>
        ))}
      </div>
    </Card>
  );
}
```

Render it in the Settings grid, admin-only, beside `<UsersCard me={user} />`:

```jsx
      {user.role === "admin" && <ErrorLogCard />}
```

Gating in the UI is a convenience, not the security boundary — `error_log_select` is admin-only in RLS, so a non-admin who reached the component would see nothing anyway.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node build.mjs && node tests/health/run-one.mjs errorpanel.test.mjs` — expect 4 passed.
Then the FULL suite in the background, unpiped, and report the counts.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/errorpanel.test.mjs tests/health/run.mjs tests/health/harness.mjs
git commit -m "feat: show recent errors in an admin-only Settings panel"
```

---

### Task 5: Registration audit, docs, falsification sweep, PR

No new behaviour. This is the gate that proves the tests would catch a regression.

**Files:**
- Modify: `TEAM-SETUP.md`, `docs/superpowers/specs/2026-08-18-error-observability-design.md` (status line)
- Create: `pr-observability.md` (untracked scratch)

- [ ] **Step 1: Audit that every new test file actually runs**

```bash
grep -c "^import \"\./" tests/health/run.mjs
grep -c "^import \"\./" tests/rls/run.mjs
```

Confirm `reporterror`, `capture`, `errorpanel` appear in `tests/health/run.mjs` and `errorlog` in `tests/rls/run.mjs`, each exactly once. Then run both suites and check the totals rose by the number of cases added (health +16, rls +8). **A file that exists but is not imported is a test that never runs** — that happened on the previous change and 15 tests sat inert while the suite reported a pass.

- [ ] **Step 2: Run both suites clean**

```bash
node tests/health/run.mjs
node tests/rls/run.mjs
```
(health in the background, never piped). Record exact counts for the PR body.

- [ ] **Step 3: Falsify five mutations**

Push each as a throwaway branch with a draft PR **in parallel** — per-ref concurrency cancels sequential pushes to one branch. Read results with `gh run view --json conclusion`, never `gh run watch | tail`.

1. Make `log_error` `security definer` → the plain-user-cannot-read test must go red.
2. Change the conflict clause to `count = 1` (a read-modify-write stand-in) → the N-concurrent-reports test must go red.
3. Remove the `error_log_select` admin predicate (`using (true)`) → the plain-user-cannot-read test must go red.
4. Remove the client throttle in `reportError` → the burst-coalescing test must go red.
5. Make `reportError` rethrow instead of swallowing → the never-throws test must go red.

Any mutation that leaves the suite green is a test that proves nothing — fix the test, not the mutation. A sweep that goes 5-for-5 red is less informative than one that finds a hole; if one stays green, say so in the PR body and close it with a new case. Close and delete all five branches afterwards.

- [ ] **Step 4: Update the docs**

Add to `TEAM-SETUP.md` under the setup steps:

```markdown
**Re-run `supabase-setup.sql` after pulling this change.** It adds the `error_log` table
and the `log_error` function. Until you do, the app still works but records nothing, and
the Settings error panel shows a permissions error.
```

Flip the spec's `**Status:**` line to `implemented — see docs/superpowers/plans/2026-08-18-error-observability.md`.

- [ ] **Step 5: Commit and open the PR**

```bash
git add TEAM-SETUP.md docs/superpowers/specs/2026-08-18-error-observability-design.md
git commit -m "docs: note the required supabase-setup.sql re-run"
git push -u origin feat/error-observability
gh pr create --title "Error observability: capture failures into an admin-visible log" --body-file pr-observability.md
```

The PR body must state both suites' counts, the five mutations and which test went red for each, and the required `supabase-setup.sql` re-run.

- [ ] **Step 6: Confirm CI is green**

```bash
gh pr view --json statusCheckRollup
```
Expected: `test` SUCCESS, `rls` SUCCESS, `deploy` SKIPPED. Do not merge — the merge decision is the user's.

---

## Notes for the executor

- **The RLS suite needs a real stack.** Docker is unavailable on this machine; push and let the ubuntu runner run the `rls` job. Do that by default for anything needing real Postgres.
- **`supabase-setup.sql` changes again**, so `git diff` against master will not be empty. `tests/rls/` pins the new behaviour; never relax an existing assertion to make a new function fit.
- **Do not run two implementers against `crm.html` at once.** Tasks 2, 3 and 4 all edit it. On the previous plan two concurrent agents contaminated a commit.
- **The reporter is the one piece that must not fail loudly.** If a test forces you to choose between reporting an error and staying silent when reporting breaks, stay silent — a meta-error shown to a user is strictly worse than a missing log line.
