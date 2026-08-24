# Internal Email Alerts (Phases 1–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship observable per-CSM email delivery plus the three date-driven alerts (renewals, overdue tasks, Monday MBR/QBR nudge), and start recording daily health baselines so the health-drop alert becomes buildable later.

**Architecture:** Pure SQL *builder* functions return rows and send nothing; a single *dispatcher* renders and posts to Brevo through `pg_net`; a *settle* job resolves each send to `sent`/`failed` by joining `net._http_response`. The app keeps sole ownership of health scoring and upserts a daily per-account score, so SQL only ever compares stored numbers.

**Tech Stack:** PostgreSQL 15 (Supabase), `pg_cron`, `pg_net`, PL/pgSQL, plain-browser React 18 via Babel in `crm.html`, Node test runner with `node-postgres` and `@supabase/supabase-js`, Playwright for app tests.

**Spec:** `docs/superpowers/specs/2026-08-21-email-alerts-design.md`

## Global Constraints

- **Additive only.** No column is removed or renamed; no existing function changes behaviour. Every DDL statement is `if not exists` / `create or replace`, because `supabase-setup.sql` is re-run by hand against live data and by `resetStack()` on every test run.
- **SQL never computes a health score.** It reads `health_snapshots.score`. The JS formula in `crm.html` is the single source of truth.
- **Builders are pure.** They `return table(...)`, perform no writes and make no network calls. Only `send_alerts()` and `settle_alert_sends()` write or call out.
- **A digest with zero rows is not sent.** No "nothing to report" emails.
- **`email_log` stores recipient address, kind and counts only** — never account names, ARR figures or row contents.
- **Every new test must be observed failing before it passes.** Each builder test asserts a specific non-empty result, never merely an absence.
- **Recipient chain:** `account.csm` (free text) → `profiles.name` → `auth.users.email`. Unmatched or empty `csm` routes to admins and is reported, never silently dropped.
- **Churned accounts** are `data->>'contractStatus' = 'Churned'` and are excluded from all three builders.
- **Date fields are ISO `YYYY-MM-DD` strings inside `jsonb`** and must be cast: `(data->>'renewalDate')::date`.
- **Secrets never enter the repo.** `alert_config.api_key` is pasted in the Supabase SQL Editor only.
- Commit after every task. Never use `--no-verify`.

## File Structure

| File | Responsibility |
|---|---|
| `supabase-setup.sql` (modify) | Add `health_snapshots` + `record_health()`. This file — and only this file — is what `resetStack()` applies, so anything the app calls at runtime must live here. |
| `email-alerts.sql` (create) | Everything the scheduler owns: `alert_config` extensions, `email_log`, recipient resolution, three builders, dispatcher, settle job, cron schedules. Separate file because it needs `pg_cron`/`pg_net` and a hand-pasted API key. |
| `crm.html` (modify) | Baseline writer: one `record_health` RPC per session. |
| `tests/rls/fixtures.mjs` (modify) | Apply `email-alerts.sql` after setup; expose a raw-SQL helper and account/task/activity seeders. |
| `tests/rls/emailalerts.test.mjs` (create) | Builders, recipient resolution, dispatcher, settle, idempotency. |
| `tests/rls/run.mjs` (modify) | Register the new test file. |
| `tests/health/health-snapshot.test.mjs` (create) | The app writes one snapshot per account per day. |
| `TEAM-SETUP.md` (modify) | Replace the renewal-alerts section with email-alerts setup. |

## Deviation from the spec (accepted, flagged)

The spec proposed an `api_base` column so tests could point sends at a local endpoint. **This plan does not test through the network.** `pg_net` runs inside the Supabase Docker container, so reaching a Node server on the host needs `host.docker.internal` and is flaky on Windows. Instead the dispatcher calls a one-line seam, `public.alert_post(...)`, which tests `create or replace` with a stub that records the payload and returns a fake request id. Settle-path tests insert directly into `net._http_response`, which `postgres` may write.

`api_base` is still added, because pointing at a different Brevo endpoint is legitimate configuration — it is just not the test mechanism. This is strictly better than the spec: it removes the network from the tests entirely.

---

### Task 1: `health_snapshots` table and `record_health()`

**Files:**
- Modify: `supabase-setup.sql` (append before the storage-policy block at the end)
- Test: `tests/rls/emailalerts.test.mjs` (create)
- Modify: `tests/rls/run.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.health_snapshots(account_id text, day date, score int)`, primary key `(account_id, day)`. Function `public.record_health(p_scores jsonb) returns int` — takes `[{"accountId":"a1","score":72}, …]`, upserts each at `current_date`, returns rows written.

- [ ] **Step 1: Write the failing test**

Create `tests/rls/emailalerts.test.mjs`:

```js
// Email alerts against a REAL Postgres. Builders are pure functions, so they are called
// directly with a superuser connection rather than through PostgREST -- execute is
// revoked from `authenticated`, which is the point.
import { test, assert } from "../health/framework.mjs";
import { sessions } from "./fixtures.mjs";

test("record_health writes one row per account", async () => {
  const { error } = await sessions.admin.rpc("record_health", {
    p_scores: [{ accountId: "h1", score: 72 }, { accountId: "h2", score: 44 }],
  });
  assert(!error, `record_health failed: ${error && error.message}`);
  const { data } = await sessions.admin
    .from("health_snapshots").select("*").in("account_id", ["h1", "h2"]);
  assert((data || []).length === 2, `expected 2 snapshot rows, got ${(data || []).length}`);
  assert(data.find(r => r.account_id === "h1").score === 72, "h1 score was not stored");
});

test("record_health upserts rather than duplicating within a day", async () => {
  await sessions.admin.rpc("record_health", { p_scores: [{ accountId: "h3", score: 50 }] });
  await sessions.admin.rpc("record_health", { p_scores: [{ accountId: "h3", score: 61 }] });
  const { data } = await sessions.admin
    .from("health_snapshots").select("*").eq("account_id", "h3");
  assert((data || []).length === 1, `second write duplicated the row: got ${(data || []).length}`);
  assert(data[0].score === 61, `expected the later score 61, got ${data[0].score}`);
});

test("an anonymous client cannot record health", async () => {
  const { error } = await sessions.anon.rpc("record_health", {
    p_scores: [{ accountId: "h4", score: 10 }],
  });
  assert(!!error, "an anonymous client was allowed to write health snapshots");
  // Prove the row genuinely does not exist -- otherwise the assertion above proves nothing.
  const { data } = await sessions.admin
    .from("health_snapshots").select("*").eq("account_id", "h4");
  assert((data || []).length === 0, "the anonymous write landed anyway");
});
```

Register it in `tests/rls/run.mjs` by adding, after the `errorlog` import:

```js
import "./emailalerts.test.mjs";
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/rls && node run.mjs`
Expected: FAIL — `record_health failed: Could not find the function public.record_health`.

- [ ] **Step 3: Implement**

Append to `supabase-setup.sql`, immediately before the `-- storage` policy block:

```sql
-- ---------- health snapshots ----------
-- A daily per-account score, written by the APP. Health is computed in JavaScript from
-- admin-tunable weights; reimplementing that formula in SQL would create a second source
-- of truth that drifts the moment someone tunes a weight. So SQL never scores anything --
-- it only ever compares two numbers that the app stored.
--
-- Unlike ARR, health has no event ledger and CANNOT be reconstructed backwards. This table
-- only ever knows what it was told, starting the day it ships.
create table if not exists public.health_snapshots (
  account_id text not null,
  day        date not null default current_date,
  score      int  not null check (score between 0 and 100),
  primary key (account_id, day)
);

alter table public.health_snapshots enable row level security;

-- select: any authenticated user. Scores are already visible in the app to everyone.
drop policy if exists health_snapshots_select on public.health_snapshots;
create policy health_snapshots_select on public.health_snapshots
  for select to authenticated using (true);

-- NO insert/update/delete policy, deliberately: record_health() owns every mutation, so a
-- user cannot forge or erase a baseline and thereby suppress a future drop alert.

create or replace function public.record_health(p_scores jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- definer bypasses RLS, so the check the missing insert policy would have performed has
  -- to be made explicitly here instead.
  if auth.uid() is null then
    raise exception 'record_health: sign in required';
  end if;

  insert into health_snapshots (account_id, day, score)
  select e->>'accountId', current_date,
         least(100, greatest(0, (e->>'score')::numeric::int))
  from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) e
  where e->>'accountId' is not null
    and e->>'score' ~ '^-?[0-9]+(\.[0-9]+)?$'
  on conflict (account_id, day) do update set score = excluded.score;

  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.record_health(jsonb) from public, anon;
grant execute on function public.record_health(jsonb) to authenticated;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tests/rls && node run.mjs`
Expected: PASS, three new tests green. Do **not** pipe this command — the exit code is the gate.

- [ ] **Step 5: Commit**

```bash
git add supabase-setup.sql tests/rls/emailalerts.test.mjs tests/rls/run.mjs
git commit -m "feat: health_snapshots table and record_health()"
```

---

### Task 2: The app writes a daily health baseline

**Files:**
- Modify: `crm.html` (near the `scored` memo at ~line 3709)
- Test: `tests/health/health-snapshot.test.mjs` (create)
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: `record_health(p_scores jsonb)` from Task 1; `sb` (the module-scope Supabase client); the `scored` array, whose elements carry `id` and `health`.
- Produces: nothing other tasks call. Fills `health_snapshots` in production.

- [ ] **Step 1: Write the failing test**

Create `tests/health/health-snapshot.test.mjs`, following the seed pattern in `dashboard.test.mjs` exactly — `launch(seed)` with a `window.__seedRows` string, and `seedAccount()` to build well-formed account objects:

```js
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const a1 = seedAccount({ name: "Northwind Co", csm: "Test User" });
const a2 = seedAccount({ name: "Bluepeak Co",  csm: "Test User" });
const seed = `window.__seedRows = { accounts: ${JSON.stringify([a1, a2].map(d => ({ id: d.id, data: d })))}, `
  + `contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("the app records one health snapshot per account, once per session", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForSelector("#root");
  const calls = await page.evaluate(() => window.__recordHealthCalls || []);
  await browser.close();

  assert(calls.length === 1, `expected exactly 1 record_health call, got ${calls.length}`);
  const scores = calls[0];
  assert(scores.length === 2, `expected 2 accounts scored, got ${scores.length}`);
  assert(scores.every(s => typeof s.score === "number" && s.score >= 0 && s.score <= 100),
    "a score was missing or outside the 0-100 range");
  assert(scores.some(s => s.accountId === a1.id), "the first account was not in the snapshot");
});

test("editing an account does not re-send the baseline", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForSelector("#root");
  // Force `scored` to recompute the way a real edit would.
  await page.evaluate(() => window.__store && window.__store.dispatch
    && window.__store.dispatch({ type: "NOOP_REFRESH" }));
  await page.waitForTimeout(200);
  const calls = await page.evaluate(() => window.__recordHealthCalls || []);
  await browser.close();
  assert(calls.length === 1,
    `a re-render sent the baseline again: ${calls.length} calls`);
});
```

If `window.__store` exposes no `dispatch`, drop the second test's `page.evaluate` line and instead assert after a plain `waitForTimeout(300)` — the claim being tested is "once per session", and React's own re-renders during boot are enough to falsify it if the ref guard is missing.

Register it in `tests/health/run.mjs` alongside the other imports.

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/health/run-one.mjs health-snapshot.test.mjs` (the subset runner — it takes the full filename; the whole suite takes ~10 minutes and background runs of it have repeatedly been killed by the harness).
Expected: FAIL — `expected exactly 1 record_health call, got 0`.

- [ ] **Step 3: Implement**

In `crm.html`, immediately after the `const scored = useMemo(...)` block (~line 3709), add:

```jsx
  // Record today's health baseline once per session. This is the ONLY writer of
  // health_snapshots: the scoring formula lives here in JS and must stay the single source
  // of truth, so SQL is given finished numbers rather than the inputs to recompute from.
  //
  // Once per session, not once per render: `scored` re-computes on every account edit, and
  // a write per edit would be hundreds of pointless round trips for a value that is keyed
  // by day anyway. The upsert makes a second write harmless, not merely tolerable.
  const healthRecorded = React.useRef(false);
  React.useEffect(() => {
    if (healthRecorded.current || !user || !scored.length) return;
    healthRecorded.current = true;
    const payload = scored.map(a => ({ accountId: a.id, score: Math.round(a.health) }));
    if (typeof window !== "undefined") {
      // Test seam: the suite asserts on what was sent without a live database.
      window.__recordHealthCalls = (window.__recordHealthCalls || []).concat([payload]);
    }
    // Deliberately NOT writeQueue.enqueue. A baseline is advisory: losing today's row costs
    // one day of drop-detection sensitivity, whereas putting it in the serial write queue
    // would delay real user edits behind it.
    try {
      const p = sb.rpc("record_health", { p_scores: payload });
      // supabase-js REJECTS on network/CORS and RESOLVES { error } otherwise. Swallow both:
      // a failed baseline must never surface as a user-visible error.
      if (p && p.then) p.then(() => {}, () => {});
    } catch (e) { /* same reasoning */ }
  }, [user, scored.length]);
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/health/run-one.mjs health-snapshot.test.mjs`, then the full gate once: `cd tests/health && node run.mjs`
Expected: PASS, and the pre-existing ~264 tests still green.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/health-snapshot.test.mjs tests/health/run.mjs
git commit -m "feat: record a daily per-account health baseline"
```

---

### Task 3: `email-alerts.sql` foundation — config, `email_log`, and test wiring

**Files:**
- Create: `email-alerts.sql`
- Modify: `tests/rls/fixtures.mjs`
- Test: `tests/rls/emailalerts.test.mjs`

**Interfaces:**
- Consumes: `is_admin()` from `supabase-setup.sql`.
- Produces: `alert_config` columns `enabled_kinds text[]`, `health_drop_points int`, `health_drop_window_days int`, `api_base text`. Table `public.email_log`. Fixture exports `sql(text, params) => rows` and `seedAccount(id, data)`, `seedTask(id, data)`, `seedActivity(id, data)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/rls/emailalerts.test.mjs`:

```js
import { sql } from "./fixtures.mjs"; // add to the existing import line

test("email_log is admin-readable and closed to plain users", async () => {
  await sql(`insert into email_log (kind, recipient, row_count, status)
             values ('renewals', 'someone@test.local', 3, 'queued')`);
  const asAdmin = await sessions.admin.from("email_log").select("*");
  assert((asAdmin.data || []).length >= 1, "an admin could not read email_log");
  const asUser = await sessions.user.from("email_log").select("*");
  assert((asUser.data || []).length === 0, "a plain user could read email_log");
});

test("email_log refuses a second send of the same kind to the same person today", async () => {
  await sql(`insert into email_log (kind, recipient, row_count) values ('dupe', 'd@test.local', 1)`);
  let threw = false;
  try {
    await sql(`insert into email_log (kind, recipient, row_count) values ('dupe', 'd@test.local', 1)`);
  } catch (e) { threw = true; }
  assert(threw, "the uniqueness constraint did not prevent a duplicate send");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/rls && node run.mjs`
Expected: FAIL — `relation "email_log" does not exist`.

- [ ] **Step 3: Implement**

Create `email-alerts.sql`:

```sql
-- ============================================================
-- OneVio — internal email alerts
-- Per-CSM digests: renewals, overdue tasks, and a Monday MBR/QBR nudge.
-- Supersedes renewal-alerts.sql (unschedule that job -- see the end of this file).
--
-- BEFORE RUNNING:
--   1. Create a free account at https://www.brevo.com
--   2. Brevo -> Senders & Domains -> Senders -> verify the FROM address
--   3. Brevo -> SMTP & API -> API Keys -> generate a key
--   4. Paste the key and sender into the two EDIT ME lines below
--   5. Run this whole file in the Supabase SQL Editor -- NOT in the repo copy,
--      so the real key is never committed.
--
-- Safe to re-run (idempotent).
-- See docs/superpowers/specs/2026-08-21-email-alerts-design.md
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- config ----------
-- RLS on with NO policies: app users can never read the API key.
create table if not exists public.alert_config (
  id int primary key check (id = 1),
  api_key text not null,
  from_email text not null,
  from_name text not null default 'OneVio'
);
alter table public.alert_config enable row level security;

alter table public.alert_config
  add column if not exists enabled_kinds text[] not null
    default array['renewals','overdue_tasks','qbr_nudge'],
  add column if not exists health_drop_points int not null default 10,
  add column if not exists health_drop_window_days int not null default 7,
  add column if not exists api_base text not null
    default 'https://api.brevo.com/v3/smtp/email';

insert into public.alert_config (id, api_key, from_email, from_name)
values (1,
  'PASTE_YOUR_BREVO_API_KEY',   -- EDIT ME
  'you@example.com',            -- EDIT ME (verified Brevo sender)
  'OneVio')
on conflict (id) do nothing;    -- do NOT clobber a key already pasted in production

-- ---------- send log ----------
-- Mirrors error_log's policy shape. Stores WHO was mailed and HOW MANY rows -- never
-- account names, ARR figures or row contents. This app's subject matter is customer
-- revenue and copying it into a table with different access rules would be a privacy
-- regression dressed up as an audit trail.
create table if not exists public.email_log (
  id          bigserial primary key,
  kind        text not null,
  recipient   text not null,
  day         date not null default current_date,
  row_count   int  not null,
  request_id  bigint,
  status      text not null default 'queued'
              check (status in ('queued','sent','failed','unknown')),
  http_status int,
  response    text,
  created_at  timestamptz not null default now(),
  settled_at  timestamptz,
  -- Idempotency: a cron double-fire or a manual re-run cannot double-send.
  unique (kind, recipient, day)
);

alter table public.email_log enable row level security;

drop policy if exists email_log_select on public.email_log;
create policy email_log_select on public.email_log
  for select to authenticated using (public.is_admin());

-- NO insert/update/delete policy: the dispatcher (security definer) owns every write.
```

Then wire the file into the test harness. In `tests/rls/fixtures.mjs`, add the constant beside `SETUP_SQL`:

```js
const ALERTS_SQL = fileURLToPath(new URL("../../email-alerts.sql", import.meta.url));
```

and inside `resetStack()`, immediately after `await client.query(readFileSync(SETUP_SQL, "utf8"));`:

```js
    // The alert layer lives in its own file because it needs pg_cron/pg_net and a
    // hand-pasted API key. It still has to be applied here, or every builder test would
    // fail with "function does not exist" and look like a bug in the test rather than a
    // missing file.
    await client.query(readFileSync(ALERTS_SQL, "utf8"));
```

Add these exports at the end of `fixtures.mjs`:

```js
// Raw SQL as the `postgres` superuser. Builders are revoked from `authenticated` on
// purpose, so PostgREST cannot reach them and the suite must not try.
export async function sql(text, params = []) {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const { rows } = await client.query(text, params);
    return rows;
  } finally {
    await client.end();
  }
}

// Seed a JSONB row directly. seedRow() goes through PostgREST as admin; these go through
// SQL so a test can seed rows a policy would refuse, and so dates land unambiguously.
export const seedAccount  = (id, data) => sql(`insert into accounts    (id, data) values ($1, $2)
                                               on conflict (id) do update set data = excluded.data`, [id, data]);
export const seedTask     = (id, data) => sql(`insert into tasks       (id, data) values ($1, $2)
                                               on conflict (id) do update set data = excluded.data`, [id, data]);
export const seedActivity = (id, data) => sql(`insert into activities  (id, data) values ($1, $2)
                                               on conflict (id) do update set data = excluded.data`, [id, data]);
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tests/rls && node run.mjs`
Expected: PASS. If it fails with `extension "pg_cron" is not available`, the local stack is older than the feature — record that and continue; `pg_net` is the one the tests actually exercise.

- [ ] **Step 5: Commit**

```bash
git add email-alerts.sql tests/rls/fixtures.mjs tests/rls/emailalerts.test.mjs
git commit -m "feat: email-alerts config table and email_log"
```

---

### Task 4: Recipient resolution and unrouted-CSM reporting

**Files:**
- Modify: `email-alerts.sql`
- Test: `tests/rls/emailalerts.test.mjs`

**Interfaces:**
- Consumes: `profiles`, `auth.users`, `accounts`.
- Produces: `public.alert_recipients() returns table(profile_id uuid, person text, email text, admin boolean)` and `public.unrouted_csms() returns table(csm text, accounts int)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/rls/emailalerts.test.mjs`:

```js
test("alert_recipients resolves each profile to an email address", async () => {
  const rows = await sql(`select * from alert_recipients() order by email`);
  assert(rows.length >= 2, `expected the two bootstrap users, got ${rows.length}`);
  const admin = rows.find(r => r.email === "admin@test.local");
  assert(!!admin, "admin@test.local was not resolved");
  assert(admin.person === "Admin User", `expected name "Admin User", got "${admin.person}"`);
  assert(admin.admin === true, "the admin was not flagged as an admin");
});

test("unrouted_csms reports a csm value that matches no profile", async () => {
  await seedAccount("u-1", { name: "Orphan Co", csm: "Nobody At All", contractStatus: "Active" });
  await seedAccount("u-2", { name: "Also Orphan", csm: "Nobody At All", contractStatus: "Active" });
  const rows = await sql(`select * from unrouted_csms()`);
  const hit = rows.find(r => r.csm === "Nobody At All");
  assert(!!hit, "an unmatched csm was silently dropped instead of reported");
  assert(Number(hit.accounts) === 2, `expected 2 orphaned accounts, got ${hit.accounts}`);
});

test("unrouted_csms ignores accounts whose csm DOES match a profile", async () => {
  await seedAccount("u-3", { name: "Owned Co", csm: "Admin User", contractStatus: "Active" });
  const rows = await sql(`select * from unrouted_csms()`);
  assert(!rows.find(r => r.csm === "Admin User"),
    "a correctly-owned account was reported as unrouted");
});
```

Add `seedAccount` to the existing import from `./fixtures.mjs`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/rls && node run.mjs`
Expected: FAIL — `function alert_recipients() does not exist`.

- [ ] **Step 3: Implement**

Append to `email-alerts.sql`:

```sql
-- ---------- recipients ----------
-- profiles has no email column; addresses live in auth.users, which the browser cannot
-- read. Definer rights are what make this join possible at all.
create or replace function public.alert_recipients()
returns table(profile_id uuid, person text, email text, admin boolean)
language sql security definer set search_path = public, auth as $$
  select p.id, p.name, u.email::text, (p.role = 'admin')
  from profiles p
  join auth.users u on u.id = p.id
  where u.email is not null;
$$;

-- Accounts whose `csm` matches no profile name, or is blank. account.csm is FREE TEXT
-- matched by string equality against profiles.name, so a rename or a typo silently
-- produces a book that emails nobody. Returning them makes that visible: the dispatcher
-- puts them in the admin digest and fingerprints them into error_log.
create or replace function public.unrouted_csms()
returns table(csm text, accounts int)
language sql security definer set search_path = public as $$
  select coalesce(nullif(trim(a.data->>'csm'), ''), '(unassigned)') as csm,
         count(*)::int
  from accounts a
  where coalesce(a.data->>'contractStatus', '') <> 'Churned'
    and not exists (
      select 1 from profiles p
      where p.name = trim(a.data->>'csm')
    )
  group by 1;
$$;

revoke execute on function public.alert_recipients() from public, anon, authenticated;
revoke execute on function public.unrouted_csms()   from public, anon, authenticated;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tests/rls && node run.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add email-alerts.sql tests/rls/emailalerts.test.mjs
git commit -m "feat: resolve CSM names to recipients and report unrouted books"
```

---

### Task 5: Builder — renewals approaching

**Files:**
- Modify: `email-alerts.sql`
- Test: `tests/rls/emailalerts.test.mjs`

**Interfaces:**
- Consumes: `accounts`.
- Produces: `public.alert_renewals(p_csm text, p_include_unowned boolean default false) returns table(account_id text, account_name text, renewal_date date, days_left int)`, ordered soonest first.

- [ ] **Step 1: Write the failing test**

```js
test("alert_renewals returns only this CSM's accounts renewing within 30 days", async () => {
  await seedAccount("r-1", { name: "Soon Co",  csm: "Admin User", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) });
  await seedAccount("r-2", { name: "Later Co", csm: "Admin User", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) });
  await seedAccount("r-3", { name: "Theirs",   csm: "Plain User", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) });

  const rows = await sql(`select * from alert_renewals('Admin User')`);
  const ids = rows.map(r => r.account_id);
  assert(ids.includes("r-1"), "the renewal due in 5 days was missing");
  assert(!ids.includes("r-2"), "a renewal 90 days out was included");
  assert(!ids.includes("r-3"), "another CSM's account leaked into this book");
  assert(rows.find(r => r.account_id === "r-1").days_left === 5,
    "days_left was not computed correctly");
});

test("alert_renewals excludes churned accounts", async () => {
  await seedAccount("r-4", { name: "Gone Co", csm: "Admin User", contractStatus: "Churned",
                             renewalDate: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) });
  const rows = await sql(`select * from alert_renewals('Admin User')`);
  assert(!rows.map(r => r.account_id).includes("r-4"), "a churned account was included");
  // The window itself still works -- otherwise the assertion above passes vacuously.
  assert(rows.length > 0, "the builder returned nothing at all, so nothing was proven");
});

test("alert_renewals adds unowned accounts only when asked", async () => {
  await seedAccount("r-5", { name: "Nobody's", csm: "", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) });
  const without = await sql(`select * from alert_renewals('Admin User', false)`);
  const with_   = await sql(`select * from alert_renewals('Admin User', true)`);
  assert(!without.map(r => r.account_id).includes("r-5"), "an unowned account leaked in by default");
  assert(with_.map(r => r.account_id).includes("r-5"), "an unowned account was not picked up for admins");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/rls && node run.mjs`
Expected: FAIL — `function alert_renewals(unknown) does not exist`.

- [ ] **Step 3: Implement**

Append to `email-alerts.sql`:

```sql
-- ---------- builders ----------
-- Builders are PURE: they return rows, write nothing and call nothing over the network.
-- That is what lets the suite prove the logic without sending a single email.

create or replace function public.alert_renewals(
  p_csm text, p_include_unowned boolean default false)
returns table(account_id text, account_name text, renewal_date date, days_left int)
language sql security definer set search_path = public as $$
  select a.id,
         a.data->>'name',
         (a.data->>'renewalDate')::date,
         ((a.data->>'renewalDate')::date - current_date)::int
  from accounts a
  where coalesce(a.data->>'contractStatus', '') <> 'Churned'
    and nullif(a.data->>'renewalDate', '') is not null
    and (a.data->>'renewalDate')::date between current_date and current_date + 30
    and ( trim(a.data->>'csm') = p_csm
          or (p_include_unowned and not exists (
                select 1 from profiles p where p.name = trim(a.data->>'csm'))) )
  order by 3 asc;
$$;

revoke execute on function public.alert_renewals(text, boolean) from public, anon, authenticated;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tests/rls && node run.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add email-alerts.sql tests/rls/emailalerts.test.mjs
git commit -m "feat: renewals-approaching alert builder"
```

---

### Task 6: Builder — overdue tasks

**Files:**
- Modify: `email-alerts.sql`
- Test: `tests/rls/emailalerts.test.mjs`

**Interfaces:**
- Consumes: `tasks`, `accounts`.
- Produces: `public.alert_overdue_tasks(p_csm text, p_include_unowned boolean default false) returns table(task_id text, title text, due_date date, days_overdue int, account_id text, account_name text)`, oldest first.

- [ ] **Step 1: Write the failing test**

```js
test("alert_overdue_tasks routes through the account's CSM and skips Done", async () => {
  await seedAccount("t-acct", { name: "Task Co", csm: "Admin User", contractStatus: "Active" });
  const past = new Date(Date.now() - 4 * 864e5).toISOString().slice(0, 10);
  const future = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
  await seedTask("t-1", { accountId: "t-acct", title: "Chase renewal", due: past,   status: "Open" });
  await seedTask("t-2", { accountId: "t-acct", title: "Already done",  due: past,   status: "Done" });
  await seedTask("t-3", { accountId: "t-acct", title: "Not yet due",   due: future, status: "Open" });

  const rows = await sql(`select * from alert_overdue_tasks('Admin User')`);
  const ids = rows.map(r => r.task_id);
  assert(ids.includes("t-1"), "the overdue task was missing");
  assert(!ids.includes("t-2"), "a Done task was reported as overdue");
  assert(!ids.includes("t-3"), "a task due in the future was reported as overdue");
  const hit = rows.find(r => r.task_id === "t-1");
  assert(hit.days_overdue === 4, `expected 4 days overdue, got ${hit.days_overdue}`);
  assert(hit.account_name === "Task Co", "the task was not joined to its account");
});

test("alert_overdue_tasks does not leak another CSM's tasks", async () => {
  await seedAccount("t-other", { name: "Their Co", csm: "Plain User", contractStatus: "Active" });
  await seedTask("t-4", { accountId: "t-other", title: "Theirs",
                          due: new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 10),
                          status: "Open" });
  const rows = await sql(`select * from alert_overdue_tasks('Admin User')`);
  assert(!rows.map(r => r.task_id).includes("t-4"), "another CSM's overdue task leaked in");
  assert(rows.length > 0, "the builder returned nothing at all, so nothing was proven");
});
```

Add `seedTask` to the fixtures import.

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/rls && node run.mjs`
Expected: FAIL — `function alert_overdue_tasks(unknown) does not exist`.

- [ ] **Step 3: Implement**

```sql
-- Tasks carry no assignee of their own, so ownership is inherited from the account.
create or replace function public.alert_overdue_tasks(
  p_csm text, p_include_unowned boolean default false)
returns table(task_id text, title text, due_date date, days_overdue int,
              account_id text, account_name text)
language sql security definer set search_path = public as $$
  select t.id,
         t.data->>'title',
         (t.data->>'due')::date,
         (current_date - (t.data->>'due')::date)::int,
         a.id,
         a.data->>'name'
  from tasks t
  join accounts a on a.id = t.data->>'accountId'
  where coalesce(t.data->>'status', '') <> 'Done'
    and nullif(t.data->>'due', '') is not null
    and (t.data->>'due')::date < current_date
    and coalesce(a.data->>'contractStatus', '') <> 'Churned'
    and ( trim(a.data->>'csm') = p_csm
          or (p_include_unowned and not exists (
                select 1 from profiles p where p.name = trim(a.data->>'csm'))) )
  order by 3 asc;
$$;

revoke execute on function public.alert_overdue_tasks(text, boolean) from public, anon, authenticated;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tests/rls && node run.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add email-alerts.sql tests/rls/emailalerts.test.mjs
git commit -m "feat: overdue-tasks alert builder"
```

---

### Task 7: Builder — Monday MBR/QBR nudge

**Files:**
- Modify: `email-alerts.sql`
- Test: `tests/rls/emailalerts.test.mjs`

**Interfaces:**
- Consumes: `accounts`, `activities`.
- Produces: `public.alert_qbr_nudge(p_csm text, p_include_unowned boolean default false) returns table(account_id text, account_name text, next_qbr date, days_left int, section text)` where `section` is `'due'` or `'unlogged'`.

- [ ] **Step 1: Write the failing test**

```js
const iso = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

test("alert_qbr_nudge lists QBRs due within 14 days or already past", async () => {
  await seedAccount("q-1", { name: "Due Soon", csm: "Admin User", contractStatus: "Active",
                             qbrFrequency: "Quarterly", nextQbrDate: iso(10) });
  await seedAccount("q-2", { name: "Far Off",  csm: "Admin User", contractStatus: "Active",
                             qbrFrequency: "Quarterly", nextQbrDate: iso(60) });
  const rows = await sql(`select * from alert_qbr_nudge('Admin User') where section = 'due'`);
  const ids = rows.map(r => r.account_id);
  assert(ids.includes("q-1"), "a QBR due in 10 days was not listed");
  assert(!ids.includes("q-2"), "a QBR 60 days out was listed");
});

test("alert_qbr_nudge flags a past QBR with no QBR activity logged near it", async () => {
  await seedAccount("q-3", { name: "Unlogged Co", csm: "Admin User", contractStatus: "Active",
                             qbrFrequency: "Quarterly", nextQbrDate: iso(-20) });
  const rows = await sql(`select * from alert_qbr_nudge('Admin User') where section = 'unlogged'`);
  assert(rows.map(r => r.account_id).includes("q-3"),
    "a past QBR with no activity was not flagged as possibly unlogged");
});

test("alert_qbr_nudge does NOT flag a past QBR that was logged within 14 days of it", async () => {
  await seedAccount("q-4", { name: "Logged Co", csm: "Admin User", contractStatus: "Active",
                             qbrFrequency: "Quarterly", nextQbrDate: iso(-20) });
  await seedActivity("act-1", { accountId: "q-4", type: "QBR", date: iso(-18),
                                summary: "Q3 review held" });
  const rows = await sql(`select * from alert_qbr_nudge('Admin User') where section = 'unlogged'`);
  assert(!rows.map(r => r.account_id).includes("q-4"),
    "an account with a logged QBR was wrongly accused of not logging it");
  // Prove the section is populated at all, or the assertion above is vacuous.
  assert(rows.length > 0, "the unlogged section was empty, so nothing was proven");
});

test("alert_qbr_nudge ignores accounts with qbrFrequency None", async () => {
  await seedAccount("q-5", { name: "No QBRs", csm: "Admin User", contractStatus: "Active",
                             qbrFrequency: "None", nextQbrDate: "" });
  const rows = await sql(`select * from alert_qbr_nudge('Admin User')`);
  assert(!rows.map(r => r.account_id).includes("q-5"),
    "an account with no QBR cadence was nudged");
});
```

Add `seedActivity` to the fixtures import.

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/rls && node run.mjs`
Expected: FAIL — `function alert_qbr_nudge(unknown) does not exist`.

- [ ] **Step 3: Implement**

```sql
-- Two sections in one email. The 'unlogged' half is an INFERENCE, not a fact: a past QBR
-- date with no QBR activity near it usually means the meeting happened and was never
-- written down, but it can equally mean the meeting slipped. The rendered email must say
-- so in those words -- phrased as an accusation it will be resented, and rightly.
create or replace function public.alert_qbr_nudge(
  p_csm text, p_include_unowned boolean default false)
returns table(account_id text, account_name text, next_qbr date, days_left int, section text)
language sql security definer set search_path = public as $$
  with mine as (
    select a.id, a.data->>'name' as nm, (a.data->>'nextQbrDate')::date as nq
    from accounts a
    where coalesce(a.data->>'contractStatus', '') <> 'Churned'
      and coalesce(a.data->>'qbrFrequency', 'None') <> 'None'
      and nullif(a.data->>'nextQbrDate', '') is not null
      and ( trim(a.data->>'csm') = p_csm
            or (p_include_unowned and not exists (
                  select 1 from profiles p where p.name = trim(a.data->>'csm'))) )
  )
  select id, nm, nq, (nq - current_date)::int, 'due'
  from mine
  where nq <= current_date + 14
  union all
  select m.id, m.nm, m.nq, (m.nq - current_date)::int, 'unlogged'
  from mine m
  where m.nq < current_date
    and not exists (
      select 1 from activities v
      where v.data->>'accountId' = m.id
        and v.data->>'type' = 'QBR'
        and nullif(v.data->>'date', '') is not null
        and (v.data->>'date')::date between m.nq - 14 and m.nq + 14
    )
  order by 3 asc;
$$;

revoke execute on function public.alert_qbr_nudge(text, boolean) from public, anon, authenticated;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tests/rls && node run.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add email-alerts.sql tests/rls/emailalerts.test.mjs
git commit -m "feat: Monday MBR/QBR nudge builder"
```

---

### Task 8: Dispatcher with an observable send

**Files:**
- Modify: `email-alerts.sql`
- Test: `tests/rls/emailalerts.test.mjs`

**Interfaces:**
- Consumes: all three builders, `alert_recipients()`, `unrouted_csms()`, `alert_config`.
- Produces: `public.alert_post(p_url text, p_headers jsonb, p_body jsonb) returns bigint` (the network seam) and `public.send_alerts(p_kind text) returns text`.

- [ ] **Step 1: Write the failing test**

```js
// Replace the network seam with a stub. pg_net runs inside the Supabase container, so a
// real HTTP round trip would need host.docker.internal and is flaky on Windows; swapping
// this one function removes the network from the suite entirely.
const stubSend = () => sql(`
  create table if not exists public.test_sent (
    id bigserial primary key, url text, body jsonb, at timestamptz default now());
  create or replace function public.alert_post(p_url text, p_headers jsonb, p_body jsonb)
  returns bigint language plpgsql as $$
  declare n bigint;
  begin
    insert into test_sent (url, body) values (p_url, p_body) returning id into n;
    return n;
  end $$;`);

test("send_alerts mails each CSM their own book and logs the send", async () => {
  await stubSend();
  await sql(`update alert_config set api_key = 'test-key' where id = 1`);
  await sql(`delete from email_log`);
  await sql(`delete from test_sent`);
  await seedAccount("s-1", { name: "Send Co", csm: "Admin User", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10) });

  const [{ send_alerts: result }] = await sql(`select send_alerts('renewals')`);
  assert(/1 recipient/.test(result), `unexpected dispatcher result: ${result}`);

  const logged = await sql(`select * from email_log where kind = 'renewals'`);
  assert(logged.length === 1, `expected 1 email_log row, got ${logged.length}`);
  assert(logged[0].recipient === "admin@test.local", `mailed the wrong person: ${logged[0].recipient}`);
  assert(logged[0].status === "queued", `expected status queued, got ${logged[0].status}`);
  assert(logged[0].request_id !== null, "the pg_net request id was discarded");

  const sent = await sql(`select * from test_sent`);
  assert(sent.length === 1, `expected 1 outbound post, got ${sent.length}`);
  assert(JSON.stringify(sent[0].body).includes("Send Co"), "the account was not in the email body");
});

test("send_alerts sends nothing when a book has no rows", async () => {
  await stubSend();
  await sql(`delete from email_log`);
  await sql(`delete from test_sent`);
  await sql(`delete from accounts`);
  const [{ send_alerts: result }] = await sql(`select send_alerts('renewals')`);
  const sent = await sql(`select * from test_sent`);
  assert(sent.length === 0, `an empty digest was sent anyway: ${result}`);
});

test("send_alerts will not double-send the same kind to the same person today", async () => {
  await stubSend();
  await sql(`delete from email_log`);
  await sql(`delete from test_sent`);
  await seedAccount("s-2", { name: "Once Co", csm: "Admin User", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10) });
  await sql(`select send_alerts('renewals')`);
  await sql(`select send_alerts('renewals')`);
  const sent = await sql(`select * from test_sent`);
  assert(sent.length === 1, `the second run re-sent the digest: ${sent.length} posts`);
});

test("send_alerts refuses to run when the API key is still the placeholder", async () => {
  await sql(`update alert_config set api_key = 'PASTE_YOUR_BREVO_API_KEY' where id = 1`);
  const [{ send_alerts: result }] = await sql(`select send_alerts('renewals')`);
  assert(/not set/i.test(result), `expected a "not set" refusal, got: ${result}`);
  await sql(`update alert_config set api_key = 'test-key' where id = 1`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/rls && node run.mjs`
Expected: FAIL — `function send_alerts(unknown) does not exist`.

- [ ] **Step 3: Implement**

```sql
-- ---------- the network seam ----------
-- The ONLY place this system talks to the outside world. It exists as its own function so
-- the test suite can `create or replace` it with a recorder: pg_net lives inside the
-- Supabase container and reaching a host process from there is platform-specific and
-- flaky, whereas swapping one function is neither.
--
-- It returns the pg_net request id. renewal-alerts.sql called net.http_post through
-- `perform` and THREW THAT ID AWAY, then reported success -- which is why a revoked key,
-- an unverified sender and a blown quota were all indistinguishable from a delivered
-- email. Never discard this value.
create or replace function public.alert_post(p_url text, p_headers jsonb, p_body jsonb)
returns bigint language sql as $$
  select net.http_post(url := p_url, headers := p_headers, body := p_body);
$$;

create or replace function public.send_alerts(p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare
  cfg        alert_config;
  r          record;
  rows_html  text;
  n_rows     int;
  n_sent     int := 0;
  req        bigint;
  subject    text;
  unrouted   text;
begin
  select * into cfg from alert_config where id = 1;
  if cfg is null or cfg.api_key like 'PASTE%' then
    return 'alert_config not set — edit email-alerts.sql and run it again';
  end if;
  if not (p_kind = any(cfg.enabled_kinds)) then
    return format('%s is disabled in alert_config.enabled_kinds', p_kind);
  end if;

  -- Unmatched CSM names, rendered into the admin digest so the failure is visible to a
  -- human rather than only to whoever thinks to read a table.
  select string_agg(format('<li>%s — %s account(s)</li>', csm, accounts), '')
    into unrouted from unrouted_csms();

  for r in select * from alert_recipients() loop
    if p_kind = 'renewals' then
      select count(*), string_agg(format(
        '<tr><td style="padding:6px 12px;border-bottom:1px solid #eee"><b>%s</b></td>'
        || '<td style="padding:6px 12px;border-bottom:1px solid #eee">%s</td>'
        || '<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;color:%s"><b>%s day(s)</b></td></tr>',
        account_name, to_char(renewal_date, 'DD Mon YYYY'),
        case when days_left <= 7 then '#e11d48' else '#d97706' end, days_left), '')
        into n_rows, rows_html
        from alert_renewals(r.person, r.admin);
      subject := format('[OneVio] %s renewal(s) due within 30 days', n_rows);

    elsif p_kind = 'overdue_tasks' then
      select count(*), string_agg(format(
        '<tr><td style="padding:6px 12px;border-bottom:1px solid #eee"><b>%s</b></td>'
        || '<td style="padding:6px 12px;border-bottom:1px solid #eee">%s</td>'
        || '<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;color:#e11d48"><b>%s day(s)</b></td></tr>',
        account_name, title, days_overdue), '')
        into n_rows, rows_html
        from alert_overdue_tasks(r.person, r.admin);
      subject := format('[OneVio] %s overdue task(s)', n_rows);

    elsif p_kind = 'qbr_nudge' then
      select count(*), string_agg(format(
        '<tr><td style="padding:6px 12px;border-bottom:1px solid #eee"><b>%s</b></td>'
        || '<td style="padding:6px 12px;border-bottom:1px solid #eee">%s</td>'
        || '<td style="padding:6px 12px;border-bottom:1px solid #eee">%s</td></tr>',
        account_name, to_char(next_qbr, 'DD Mon YYYY'),
        case when section = 'due' then 'due to be scheduled'
             else 'may have happened without being logged' end), '')
        into n_rows, rows_html
        from alert_qbr_nudge(r.person, r.admin);
      subject := format('[OneVio] %s account(s) need a review scheduled or logged', n_rows);

    else
      return format('unknown alert kind: %s', p_kind);
    end if;

    -- A digest with nothing in it is not sent. This is what keeps a daily email from
    -- becoming something people filter to a folder.
    continue when coalesce(n_rows, 0) = 0;

    -- Idempotency: the unique (kind, recipient, day) constraint means a cron double-fire
    -- or a manual re-run takes this branch and sends nothing. Claim the slot BEFORE
    -- posting, so a crash between the two cannot produce a second email.
    begin
      insert into email_log (kind, recipient, row_count) values (p_kind, r.email, n_rows);
    exception when unique_violation then
      continue;
    end;

    req := alert_post(
      cfg.api_base,
      jsonb_build_object('api-key', cfg.api_key, 'content-type', 'application/json'),
      jsonb_build_object(
        'sender', jsonb_build_object('email', cfg.from_email, 'name', cfg.from_name),
        'to', jsonb_build_array(jsonb_build_object('email', r.email, 'name', r.person)),
        'subject', subject,
        'htmlContent',
          '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:620px">'
          || format('<h2 style="color:#4f46e5">%s</h2>', subject)
          || '<table style="border-collapse:collapse;width:100%">' || rows_html || '</table>'
          || case when p_kind = 'qbr_nudge' then
               '<p style="color:#64748b;font-size:12px;margin-top:12px">Rows marked '
               || '&ldquo;may have happened without being logged&rdquo; are a guess, not a '
               || 'record: the review date has passed and no QBR activity was logged near '
               || 'it. If the meeting did not happen, reschedule it instead.</p>'
             else '' end
          || case when r.admin and unrouted is not null then
               '<p style="color:#b45309;font-size:12px;margin-top:16px"><b>Accounts nobody '
               || 'is receiving alerts for</b> — the CSM name on these matches no user:</p>'
               || format('<ul style="color:#b45309;font-size:12px">%s</ul>', unrouted)
             else '' end
          || '<p style="color:#94a3b8;font-size:12px;margin-top:16px">Sent by OneVio. '
          || 'Open the CRM for details and quick actions.</p></div>'
      ));

    update email_log set request_id = req
     where kind = p_kind and recipient = r.email and day = current_date;
    n_sent := n_sent + 1;
  end loop;

  return format('%s: %s recipient(s) mailed', p_kind, n_sent);
end $$;

revoke execute on function public.alert_post(text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.send_alerts(text) from public, anon, authenticated;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tests/rls && node run.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add email-alerts.sql tests/rls/emailalerts.test.mjs
git commit -m "feat: per-CSM alert dispatcher with an observable send"
```

---

### Task 9: Settle job — turn `queued` into `sent` or `failed`

**Files:**
- Modify: `email-alerts.sql`
- Test: `tests/rls/emailalerts.test.mjs`

**Interfaces:**
- Consumes: `email_log`, `net._http_response`.
- Produces: `public.settle_alert_sends() returns text`.

- [ ] **Step 1: Write the failing test**

```js
test("settle_alert_sends marks a 201 response as sent", async () => {
  await sql(`delete from email_log`);
  await sql(`insert into email_log (kind, recipient, row_count, request_id)
             values ('renewals', 'ok@test.local', 2, 900001)`);
  await sql(`insert into net._http_response (id, status_code, content, created)
             values (900001, 201, '{"messageId":"x"}', now())
             on conflict (id) do update set status_code = 201`);
  await sql(`select settle_alert_sends()`);
  const [row] = await sql(`select * from email_log where request_id = 900001`);
  assert(row.status === "sent", `expected sent, got ${row.status}`);
  assert(row.http_status === 201, `expected http_status 201, got ${row.http_status}`);
  assert(row.settled_at !== null, "settled_at was not stamped");
});

test("settle_alert_sends marks a 401 response as failed and records the body", async () => {
  await sql(`insert into email_log (kind, recipient, row_count, request_id)
             values ('renewals', 'bad@test.local', 2, 900002)`);
  await sql(`insert into net._http_response (id, status_code, content, created)
             values (900002, 401, '{"message":"Key not found"}', now())
             on conflict (id) do update set status_code = 401`);
  await sql(`select settle_alert_sends()`);
  const [row] = await sql(`select * from email_log where request_id = 900002`);
  assert(row.status === "failed", `a 401 was not recorded as failed, got ${row.status}`);
  assert(/Key not found/.test(row.response || ""), "Brevo's rejection body was not kept");
});

test("settle_alert_sends gives up on a send that never got a response", async () => {
  await sql(`insert into email_log (kind, recipient, row_count, request_id, created_at)
             values ('renewals', 'lost@test.local', 1, 900003, now() - interval '2 hours')`);
  await sql(`select settle_alert_sends()`);
  const [row] = await sql(`select * from email_log where request_id = 900003`);
  assert(row.status === "unknown", `a stale queued row stayed ${row.status} forever`);
});

test("settle_alert_sends leaves a recent unanswered send alone", async () => {
  await sql(`insert into email_log (kind, recipient, row_count, request_id)
             values ('renewals', 'fresh@test.local', 1, 900004)`);
  await sql(`select settle_alert_sends()`);
  const [row] = await sql(`select * from email_log where request_id = 900004`);
  assert(row.status === "queued", `a send from seconds ago was prematurely settled to ${row.status}`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/rls && node run.mjs`
Expected: FAIL — `function settle_alert_sends() does not exist`.

- [ ] **Step 3: Implement**

```sql
-- pg_net is ASYNCHRONOUS: http_post returns immediately with an id and the response lands
-- in net._http_response later. Without this job every row would sit at 'queued' forever
-- and a bounced or rejected send would be indistinguishable from a delivered one.
create or replace function public.settle_alert_sends()
returns text language plpgsql security definer set search_path = public, net as $$
declare n_settled int; n_unknown int;
begin
  update email_log e
     set status      = case when r.status_code between 200 and 299 then 'sent' else 'failed' end,
         http_status = r.status_code,
         response    = left(coalesce(r.content, ''), 2000),
         settled_at  = now()
    from net._http_response r
   where r.id = e.request_id
     and e.status = 'queued';
  get diagnostics n_settled = row_count;

  -- A response that never arrives must not leave the row lying about its own state.
  -- 'unknown' is honest; 'queued' after an hour is a lie.
  update email_log
     set status = 'unknown', settled_at = now()
   where status = 'queued'
     and created_at < now() - interval '1 hour';
  get diagnostics n_unknown = row_count;

  -- Failures reach a human through the panel that already exists, rather than through a
  -- new surface nobody would think to open.
  if exists (select 1 from email_log where status = 'failed' and settled_at > now() - interval '1 day') then
    perform log_error_system(
      'email-send-failed',
      'write_failed',
      format('%s alert email(s) failed to send in the last day',
             (select count(*) from email_log where status = 'failed' and settled_at > now() - interval '1 day')),
      jsonb_build_object('table', 'email_log'));
  end if;

  return format('%s settled, %s abandoned', n_settled, n_unknown);
end $$;

-- log_error requires auth.uid(), which a cron job does not have. This is the scheduler's
-- way in: same table, same fingerprint collapsing, no signed-in user.
create or replace function public.log_error_system(
  p_fingerprint text, p_level text, p_message text, p_context jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into error_log (fingerprint, level, message, context, app_version, user_agent)
  values (p_fingerprint, p_level, p_message, coalesce(p_context, '{}'::jsonb), 'cron', 'pg_cron')
  on conflict (fingerprint) do update set
    count = error_log.count + 1, last_seen = now(),
    level = excluded.level, message = excluded.message, context = excluded.context;
end $$;

revoke execute on function public.settle_alert_sends() from public, anon, authenticated;
revoke execute on function public.log_error_system(text, text, text, jsonb) from public, anon, authenticated;
```

Note the ordering: `log_error_system` is referenced by `settle_alert_sends` but PL/pgSQL resolves function calls at run time, so defining it after is fine. Keep both in this order to match the narrative.

- [ ] **Step 4: Run to verify it passes**

Run: `cd tests/rls && node run.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add email-alerts.sql tests/rls/emailalerts.test.mjs
git commit -m "feat: settle queued sends into sent/failed and report failures"
```

---

### Task 10: Schedules, documentation, and the stale comment

**Files:**
- Modify: `email-alerts.sql` (append)
- Modify: `supabase-setup.sql` (`log_error` retention comment)
- Modify: `TEAM-SETUP.md`

**Interfaces:**
- Consumes: `send_alerts()`, `settle_alert_sends()`.
- Produces: cron jobs `onevio-alerts-daily`, `onevio-alerts-monday`, `onevio-alerts-settle`.

- [ ] **Step 1: Append the schedules**

```sql
-- ---------- schedule ----------
-- 03:30 UTC = 09:00 IST. Times are UTC; edit to taste and re-run this file.
select cron.unschedule('crm-renewal-alerts')
  where exists (select 1 from cron.job where jobname = 'crm-renewal-alerts');

select cron.unschedule(j) from unnest(array[
  'onevio-alerts-daily','onevio-alerts-monday','onevio-alerts-settle']) j
 where exists (select 1 from cron.job where jobname = j);

select cron.schedule('onevio-alerts-daily', '30 3 * * *', $$
  select public.send_alerts('renewals');
  select public.send_alerts('overdue_tasks');
$$);

select cron.schedule('onevio-alerts-monday', '35 3 * * 1', $$
  select public.send_alerts('qbr_nudge');
$$);

-- Runs on the :10 of every hour. pg_net answers in seconds, but an hourly sweep also
-- catches the rows that never got an answer at all.
select cron.schedule('onevio-alerts-settle', '10 * * * *', $$
  select public.settle_alert_sends();
$$);

-- Fire once now to check the wiring. The result text says what happened.
select public.send_alerts('renewals');
```

- [ ] **Step 2: Correct the stale `log_error` comment**

In `supabase-setup.sql`, find the retention comment on `log_error` beginning "Retention, run here rather than on a schedule: this project has no scheduler, and" and replace that clause with:

```
  -- Retention, run inline rather than on a schedule. email-alerts.sql now installs
  -- pg_cron, so "this project has no scheduler" is no longer true -- but the inline sweep
  -- is kept deliberately: it runs exactly when rows are added, needs no second moving
  -- part, and works on a stack where the alert layer was never installed.
```

- [ ] **Step 3: Update `TEAM-SETUP.md`**

Replace the whole "## Optional: daily renewal email alerts" section with:

```markdown
## Optional: email alerts

Each person gets a digest covering **their own accounts only**: renewals due within 30
days and overdue tasks (daily at 09:00 IST), plus a Monday nudge for reviews that need
scheduling or look like they happened without being logged. Nothing is sent when there is
nothing to report.

1. Create a free account at [brevo.com](https://www.brevo.com) (300 emails/day free).
2. Brevo → **Senders & Domains → Senders** → add and verify the address alerts come **from**.
3. Brevo → **SMTP & API → API Keys** → **Generate a new API key** → copy it.
4. Open `email-alerts.sql`, paste the key and sender into the two `EDIT ME` lines —
   **do this in the Supabase SQL Editor, not in the repo copy** (never commit the real key).
5. Run the whole script in the Supabase **SQL Editor**. The last line fires a test
   immediately and its result text says what happened.

This **replaces** `renewal-alerts.sql`, which mailed the whole team one shared digest. The
script unschedules that job for you; the old file is kept only for reference.

**Checking whether mail is actually going out.** Settings → the error panel shows a
`email-send-failed` entry if any send failed in the last day. Admins can also read the
`email_log` table directly: `status` is `sent`, `failed`, `queued` or `unknown`, and
`response` carries Brevo's own words when a send was rejected.

**Accounts nobody is alerted about.** Alerts are routed by matching an account's CSM name
to a user's name. If they do not match — a typo, a renamed user, an unassigned account —
those accounts are listed in a highlighted block at the bottom of every admin's digest.
Fix them by correcting the CSM field on the account.

To change send times, edit the cron expressions at the end of the script (they are UTC)
and re-run it. To stop all alerts:
`select cron.unschedule(j) from unnest(array['onevio-alerts-daily','onevio-alerts-monday','onevio-alerts-settle']) j;`
```

- [ ] **Step 4: Verify the whole suite**

Run: `cd tests/rls && node run.mjs`
Then: `cd tests/health && node run.mjs`
Expected: both PASS. Do not pipe either command — the exit code is the gate, and
`grep -c "^FAIL"` exits 1 on zero matches, which makes a clean run look failed.

- [ ] **Step 5: Commit**

```bash
git add email-alerts.sql supabase-setup.sql TEAM-SETUP.md
git commit -m "feat: schedule alert jobs and document setup"
```

---

## Self-review notes

**Spec coverage.** Phases 1–3 of the spec map as: plumbing → Tasks 3, 8, 9; the three
date-driven alerts → Tasks 5, 6, 7; baseline writer → Tasks 1, 2; recipient resolution and
miss reporting → Task 4; the `log_error` comment correction and `renewal-alerts.sql`
retirement → Task 10. Phases 4 (health-drop alert) and 5 (weekly summary) are deliberately
out of scope and get their own plan once baselines have accumulated.

**Deliberately not covered.** `pg_cron` firing at the scheduled minute is untested, as the
spec states — verified once by hand via the trailing `select`. `health_drop_points` and
`health_drop_window_days` are created in Task 3 but unused until phase 4; they are added
now so the config table is not altered twice.

**One addition beyond the spec.** `log_error_system()` — cron has no `auth.uid()`, so the
existing `log_error` raises for a scheduled caller. Without it the spec's "failures flow
into `error_log`" requirement cannot hold. Same table, same fingerprint collapsing.
