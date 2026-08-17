# RLS and Auth Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute OneVio's real Row Level Security policies, triggers and auth path in CI, so a change to the access-control model fails the build.

**Architecture:** A second, independent test suite under `tests/rls/`. The Supabase CLI brings up real Postgres + GoTrue + Storage in Docker; `supabase-setup.sql` is applied verbatim; tests sign up real users through GoTrue and act as them via `@supabase/supabase-js` with their real session tokens. It reuses the existing nine-line test framework and exit-code contract, and runs as a parallel CI job that gates deploy alongside the mocked E2E suite.

**Tech Stack:** Node 24 (ESM), Supabase CLI, Docker, `@supabase/supabase-js` v2, `psql`, the existing `tests/health/framework.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-17-rls-auth-tests-design.md`

## Global Constraints

- **Never pipe `run.mjs`.** Its exit code IS the gate; `node run.mjs | tail` reports the last command's status. This has already voided a gate once in this repo.
- **No retry-on-failure in CI.** The existing suite's retry was removed deliberately. A second attempt can only mask a flaky test.
- **Change no policy, no trigger, no table.** `supabase-setup.sql` is read-only in this work. Findings F1–F5 are recorded in the spec for a separate decision.
- **Pin current behaviour.** Where today's model is permissive, the test asserts the permissive behaviour and says so in a comment. The suite must be green on merge.
- Local API URL: `http://127.0.0.1:54321`. Local database URL: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. These are the Supabase CLI's fixed local defaults.
- Test user password everywhere: `test-password-123`.
- Every test's rows use ids namespaced `rls-<area>-<n>` so tests sharing the database cannot collide.

---

## THE CRITICAL MECHANIC — read before writing any assertion

**RLS denies by making rows invisible, not by raising errors.** Getting this wrong produces a suite that passes vacuously and proves nothing. The four cases behave differently:

| Operation denied by RLS | What supabase-js returns |
|---|---|
| `select` | `{ data: [], error: null }` — **no error** |
| `insert` | `{ error: { code: "42501" } }` — a real error |
| `update` | `{ error: null }` and **zero rows changed** — no error |
| `delete` | `{ error: null }` and **the row still exists** — no error |

So an assertion like `assert(error, "should be denied")` is **wrong for select, update and delete**. Denied updates and deletes must be verified by reading the row back **as admin** and confirming it is unchanged or still present.

Every task below follows this rule. Use the `stillExists` and `valueOf` helpers from Task 1 rather than hand-rolling the read-back.

---

## File Structure

```
supabase/config.toml          Task 1 — local stack config; email confirmations OFF
tests/rls/package.json        Task 1 — @supabase/supabase-js as a REAL dependency
tests/rls/fixtures.mjs        Task 1 — stack reset, canonical sessions, read-back helpers
tests/rls/run.mjs             Task 1 — entry point; reuses ../health/framework.mjs
tests/rls/auth.test.mjs       Task 1 (signup/roles) + Task 3 (admin-count guard)
tests/rls/policies.test.mjs   Tasks 2, 4, 5 — admin-gated, flat model, anonymous
tests/rls/storage.test.mjs    Task 6 — the attachments bucket
.github/workflows/pages.yml   Task 7 — the `rls` job; deploy needs [test, rls]
TEAM-SETUP.md                 Task 7 — how to run these locally
```

---

### Task 1: Scaffolding, fixtures, and the signup/role tests

Delivers a runnable `node tests/rls/run.mjs` that stands up a real stack and proves the first-signup-becomes-admin trigger works. Config, dependencies and helpers are folded in here because nothing downstream can be tested without them.

**Files:**
- Create: `supabase/config.toml`
- Create: `tests/rls/package.json`
- Create: `tests/rls/fixtures.mjs`
- Create: `tests/rls/run.mjs`
- Test: `tests/rls/auth.test.mjs`

**Interfaces:**
- Consumes: `test`, `assert` from `../health/framework.mjs`.
- Produces, all from `fixtures.mjs`:
  - `resetStack(): Promise<void>` — drops and recreates the schema, applies `supabase-setup.sql`.
  - `sessions: { admin: SupabaseClient, user: SupabaseClient, anon: SupabaseClient }` — populated by `bootstrap()`.
  - `bootstrap(): Promise<{ adminId: string, userId: string }>` — resets, signs up admin then user in that order, fills `sessions`.
  - `signUpFresh(email: string): Promise<{ client: SupabaseClient, id: string }>` — a throwaway plain user.
  - `roleOf(id: string): Promise<string>` — reads `profiles.role` as admin.
  - `stillExists(table: string, id: string): Promise<boolean>` — read-back as admin.
  - `valueOf(table: string, id: string): Promise<object|null>` — read-back as admin; returns the `data` jsonb.
  - `API_URL`, `ANON_KEY`, `PASSWORD` constants.

- [ ] **Step 1: Create the local stack config with email confirmations disabled**

Without this, `signUp` returns a user with no session and every later test fails on a null token.

Create `supabase/config.toml`:

```toml
project_id = "onevio-crm"

[api]
enabled = true
port = 54321
schemas = ["public", "storage"]

[db]
port = 54322

[auth]
enabled = true
site_url = "http://127.0.0.1:3000"
# Tests sign up real users and need a session immediately. With confirmations on,
# signUp returns { session: null } and every assertion downstream fails on a null token.
enable_confirmations = false

[storage]
enabled = true
```

- [ ] **Step 2: Create the package manifest**

Create `tests/rls/package.json`:

```json
{
  "name": "crm-rls-tests",
  "private": true,
  "type": "module",
  "dependencies": { "@supabase/supabase-js": "^2.45.4" }
}
```

Run: `cd tests/rls && npm install`
Expected: a `package-lock.json` is created. Commit it — CI uses `npm ci`.

- [ ] **Step 3: Write the fixtures**

Create `tests/rls/fixtures.mjs`:

```javascript
// Fixtures for the RLS suite. Unlike tests/health, NOTHING here is mocked: this talks to a
// real local Postgres + GoTrue + Storage brought up by `supabase start`, with the real
// supabase-setup.sql applied. See docs/superpowers/specs/2026-08-17-rls-auth-tests-design.md
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const API_URL = process.env.SUPABASE_API_URL || "http://127.0.0.1:54321";
export const DB_URL = process.env.SUPABASE_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const PASSWORD = "test-password-123";

// The CLI's local anon key is fixed and public — it is not a secret and must not be
// treated as one. `supabase status -o json` reports it if this ever changes.
export const ANON_KEY = process.env.SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwiZXhwIjoxOTgzODEyOTk2fQ.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const SETUP_SQL = fileURLToPath(new URL("../../supabase-setup.sql", import.meta.url));

const newClient = () => createClient(API_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const sessions = { admin: null, user: null, anon: newClient() };

// Drop and rebuild from supabase-setup.sql. Dropping auth.users too is what makes the
// first-signup-becomes-admin trigger testable: handle_new_user() checks for an EMPTY
// profiles table, so a stale user from a previous run would silently change the outcome.
export async function resetStack() {
  const sql = `
    drop schema if exists public cascade;
    create schema public;
    grant usage on schema public to postgres, anon, authenticated, service_role;
    delete from auth.users;
    delete from storage.objects where bucket_id = 'attachments';
  `;
  psql(sql);
  execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-f", SETUP_SQL], { stdio: "pipe" });
}

function psql(sql) {
  execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: "pipe" });
}

async function signUp(email, name) {
  const client = newClient();
  const { data, error } = await client.auth.signUp({
    email, password: PASSWORD, options: { data: name ? { name } : {} },
  });
  if (error) throw new Error(`signUp(${email}) failed: ${error.message}`);
  if (!data.session) throw new Error(`signUp(${email}) returned no session — is enable_confirmations still false in supabase/config.toml?`);
  return { client, id: data.user.id };
}

// ORDER MATTERS AND IS ASSERTED, NOT ASSUMED. handle_new_user() makes the first signup
// against an empty profiles table an admin. A suite that signed users up ad hoc would pass
// or fail on test ordering, so the two canonical users are created here, in this order.
export async function bootstrap() {
  await resetStack();
  const admin = await signUp("admin@test.local", "Admin User");
  const user = await signUp("user@test.local", "Plain User");
  sessions.admin = admin.client;
  sessions.user = user.client;
  sessions.anon = newClient();
  return { adminId: admin.id, userId: user.id };
}

let fresh = 0;
export async function signUpFresh(email) {
  return signUp(email || `fresh${++fresh}@test.local`, "Fresh User");
}

export async function roleOf(id) {
  const { data } = await sessions.admin.from("profiles").select("role").eq("id", id).single();
  return data?.role ?? null;
}

// Read-backs run AS ADMIN on purpose. A denied delete or update returns no error, so the
// only way to know it was denied is to look at the row with a session that can see it.
export async function stillExists(table, id) {
  const { data } = await sessions.admin.from(table).select("id").eq("id", id);
  return (data || []).length > 0;
}

export async function valueOf(table, id) {
  const { data } = await sessions.admin.from(table).select("data").eq("id", id).single();
  return data?.data ?? null;
}

// Insert a row as admin for a test to then attack as a plain user.
export async function seedRow(table, id, data = { name: "Seeded" }) {
  const { error } = await sessions.admin.from(table).insert({ id, data });
  if (error) throw new Error(`seedRow(${table}, ${id}) failed: ${error.message}`);
}
```

- [ ] **Step 4: Write the runner**

Create `tests/rls/run.mjs`:

```javascript
// Entry point for the RLS suite. Mirrors tests/health/run.mjs, including its exit-code
// contract: NEVER pipe this — the exit code IS the gate.
import { CASES } from "../health/framework.mjs";
import { bootstrap } from "./fixtures.mjs";

import "./auth.test.mjs";

try {
  await bootstrap();
} catch (e) {
  console.error("\nCould not reach the local Supabase stack.");
  console.error("Is Docker running, and have you run `supabase start`?\n");
  console.error(e.message);
  process.exit(2);
}

let pass = 0, fail = 0;
for (const c of CASES) {
  try { await c.fn(); console.log("PASS", c.name); pass++; }
  catch (e) { console.error("FAIL", c.name, "\n  ", e.message); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 5: Write the failing auth tests**

Create `tests/rls/auth.test.mjs`:

```javascript
// The signup path and role assignment — handle_new_user() in supabase-setup.sql.
import { test, assert } from "../health/framework.mjs";
import { sessions, roleOf, signUpFresh } from "./fixtures.mjs";

test("the first signup becomes an admin", async () => {
  const { data } = await sessions.admin.auth.getUser();
  const role = await roleOf(data.user.id);
  assert(role === "admin", `first signup should be admin, got ${role}`);
});

test("the second signup becomes a plain user", async () => {
  const { data } = await sessions.user.auth.getUser();
  const role = await roleOf(data.user.id);
  assert(role === "user", `second signup should be user, got ${role}`);
});

test("a profile is auto-created and named from signup metadata", async () => {
  const { data } = await sessions.admin.auth.getUser();
  const { data: p } = await sessions.admin.from("profiles").select("name").eq("id", data.user.id).single();
  assert(p && p.name === "Admin User", `expected name "Admin User", got ${JSON.stringify(p)}`);
});

test("a profile with no name metadata is named from the email prefix", async () => {
  const { client } = await signUpFresh("noname@test.local");
  const { data } = await client.auth.getUser();
  const { data: p } = await sessions.admin.from("profiles").select("name").eq("id", data.user.id).single();
  assert(p && p.name === "noname", `expected name "noname", got ${JSON.stringify(p)}`);
});
```

Note: `signUpFresh("noname@test.local")` passes a name, so change the fixture call for this one case — see Step 6.

- [ ] **Step 6: Fix the no-name case in fixtures**

The fourth test needs a signup with **no** `name` in metadata. Edit `tests/rls/fixtures.mjs`, replacing the `signUpFresh` export:

```javascript
let fresh = 0;
// `name: null` signs up with NO name metadata, so handle_new_user() falls back to the
// email prefix — which is the branch the fourth auth test exercises.
export async function signUpFresh(email, name = "Fresh User") {
  return signUp(email || `fresh${++fresh}@test.local`, name);
}
```

And in `auth.test.mjs`, call it as `signUpFresh("noname@test.local", null)`.

- [ ] **Step 7: Start the stack and run the tests**

```bash
supabase start
cd tests/rls && npm ci && cd ../..
node tests/rls/run.mjs
```

Expected: `4 passed, 0 failed`. If it exits 2 with the Docker message, Docker is not running.

To confirm the tests are real rather than vacuous, temporarily change `handle_new_user` in `supabase-setup.sql` to always insert `'user'`, rerun, and confirm test 1 FAILS. Revert immediately — `supabase-setup.sql` is read-only in this work.

- [ ] **Step 8: Commit**

```bash
git add supabase/config.toml tests/rls/package.json tests/rls/package-lock.json tests/rls/fixtures.mjs tests/rls/run.mjs tests/rls/auth.test.mjs
git commit -m "test: stand up the RLS suite against a real local Supabase stack

Signs up real users through GoTrue and asserts handle_new_user's role
assignment. The two canonical sessions are created in a deliberate order
because the first signup against an empty profiles table becomes admin."
```

---

### Task 2: Admin-gated operations

The core of the model: what separates an admin from a plain user.

**Files:**
- Create: `tests/rls/policies.test.mjs`
- Modify: `tests/rls/run.mjs` (add the import)

**Interfaces:**
- Consumes: `sessions`, `seedRow`, `stillExists`, `roleOf` from `./fixtures.mjs`.
- Produces: nothing later tasks depend on; Tasks 4 and 5 append to the same file.

- [ ] **Step 1: Write the failing tests**

Create `tests/rls/policies.test.mjs`:

```javascript
// Admin-gated operations. REMEMBER: a denied delete or update returns NO error — the row
// simply does not change. Every denial is verified by reading back as admin.
import { test, assert } from "../health/framework.mjs";
import { sessions, seedRow, stillExists, valueOf, roleOf } from "./fixtures.mjs";

test("a plain user cannot delete an account", async () => {
  await seedRow("accounts", "rls-del-1");
  const { error } = await sessions.user.from("accounts").delete().eq("id", "rls-del-1");
  // No error is expected: RLS makes the row invisible to the delete rather than raising.
  assert(!error, `unexpected error shape: ${error && error.message}`);
  assert(await stillExists("accounts", "rls-del-1"),
    "the account was deleted — accounts_delete should be admin-only");
});

test("an admin can delete an account", async () => {
  await seedRow("accounts", "rls-del-2");
  const { error } = await sessions.admin.from("accounts").delete().eq("id", "rls-del-2");
  assert(!error, `admin delete errored: ${error && error.message}`);
  assert(!(await stillExists("accounts", "rls-del-2")), "the admin's delete did not take effect");
});

test("a plain user cannot write settings", async () => {
  const { error } = await sessions.user.from("settings").insert({ id: "rls-set-1", data: { rates: { INR: 99 } } });
  assert(error, "settings_write should reject a plain user's insert");
  assert(error.code === "42501", `expected an RLS violation (42501), got ${error.code}: ${error.message}`);
});

test("an admin can write settings", async () => {
  const { error } = await sessions.admin.from("settings").insert({ id: "rls-set-2", data: { rates: { INR: 0.012 } } });
  assert(!error, `admin settings write failed: ${error && error.message}`);
});

test("a plain user cannot change another user's role", async () => {
  const { data } = await sessions.admin.auth.getUser();
  const adminId = data.user.id;
  const { error } = await sessions.user.from("profiles").update({ role: "user" }).eq("id", adminId);
  assert(!error, `unexpected error shape: ${error && error.message}`);
  assert(await roleOf(adminId) === "admin", "a plain user demoted the admin");
});

test("a plain user cannot escalate their own role", async () => {
  const { data } = await sessions.user.auth.getUser();
  const userId = data.user.id;
  const { error } = await sessions.user.from("profiles").update({ role: "admin" }).eq("id", userId);
  assert(!error, `unexpected error shape: ${error && error.message}`);
  assert(await roleOf(userId) === "user", "PRIVILEGE ESCALATION: a plain user made themselves admin");
});
```

- [ ] **Step 2: Register the file**

In `tests/rls/run.mjs`, below `import "./auth.test.mjs";` add:

```javascript
import "./policies.test.mjs";
```

- [ ] **Step 3: Run and verify they pass**

Run: `node tests/rls/run.mjs`
Expected: `10 passed, 0 failed`.

- [ ] **Step 4: Falsify — prove the tests can fail**

Temporarily edit `supabase-setup.sql:111`, changing `accounts_delete` to `using (true)`, then:

```bash
node tests/rls/run.mjs
```

Expected: `a plain user cannot delete an account` FAILS. **Revert the change** and rerun to confirm green.

- [ ] **Step 5: Commit**

```bash
git add tests/rls/policies.test.mjs tests/rls/run.mjs
git commit -m "test: cover the admin-gated operations

Account deletion, settings writes and role changes. Denials are verified by
reading back as admin, since RLS denies an update or delete by changing
nothing rather than by raising an error."
```

---

### Task 3: The admin-count guard

`guard_admin_count()` must prevent the last admin being demoted.

**Files:**
- Modify: `tests/rls/auth.test.mjs`

**Interfaces:**
- Consumes: `sessions`, `roleOf`, `signUpFresh` from `./fixtures.mjs`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rls/auth.test.mjs`:

```javascript
// guard_admin_count(): any number of admins, but never zero.
test("demoting the last admin is refused", async () => {
  const { data } = await sessions.admin.auth.getUser();
  const { error } = await sessions.admin.from("profiles").update({ role: "user" }).eq("id", data.user.id);
  assert(error, "demoting the only admin should raise");
  assert(/at least one admin/i.test(error.message),
    `expected the guard's message, got: ${error.message}`);
  assert(await roleOf(data.user.id) === "admin", "the admin was demoted despite the guard");
});

test("one of two admins can be demoted", async () => {
  const second = await signUpFresh("admin2@test.local");
  const { error: promote } = await sessions.admin.from("profiles").update({ role: "admin" }).eq("id", second.id);
  assert(!promote, `promoting a second admin failed: ${promote && promote.message}`);
  assert(await roleOf(second.id) === "admin", "the promotion did not take effect");

  const { error: demote } = await sessions.admin.from("profiles").update({ role: "user" }).eq("id", second.id);
  assert(!demote, `demoting one of two admins should be allowed, got: ${demote && demote.message}`);
  assert(await roleOf(second.id) === "user", "the demotion did not take effect");
});
```

- [ ] **Step 2: Run and verify**

Run: `node tests/rls/run.mjs`
Expected: `12 passed, 0 failed`.

- [ ] **Step 3: Falsify**

Temporarily comment out the `create trigger guard_admin_count` statement in `supabase-setup.sql`, rerun, and confirm `demoting the last admin is refused` FAILS. **Revert.**

- [ ] **Step 4: Commit**

```bash
git add tests/rls/auth.test.mjs
git commit -m "test: cover the never-zero-admins guard"
```

---

### Task 4: The flat model, pinned as-is

Documents what every authenticated user can do. These tests assert **permissive** behaviour on purpose — see findings F1 and F4 in the spec.

**Files:**
- Modify: `tests/rls/policies.test.mjs`

- [ ] **Step 1: Write the tests**

Append to `tests/rls/policies.test.mjs`:

```javascript
// --- the flat model -----------------------------------------------------------------
// The policies below are DELIBERATELY permissive: every authenticated user can read and
// write every business row. These tests pin that as it is today so a change is visible.
// Whether it is the RIGHT model is a separate question — see findings F1 and F4 in
// docs/superpowers/specs/2026-08-17-rls-auth-tests-design.md

const BUSINESS_TABLES = ["accounts", "contacts", "activities", "tasks", "opportunities"];

test("any authenticated user can read every business table", async () => {
  for (const t of BUSINESS_TABLES) {
    await seedRow(t, `rls-read-${t}`);
    const { data, error } = await sessions.user.from(t).select("id").eq("id", `rls-read-${t}`);
    assert(!error, `${t}: read errored: ${error && error.message}`);
    assert((data || []).length === 1, `${t}: a plain user should see the row, got ${JSON.stringify(data)}`);
  }
});

test("any authenticated user can insert and update business rows", async () => {
  const { error: ins } = await sessions.user.from("accounts").insert({ id: "rls-ins-1", data: { name: "By user" } });
  assert(!ins, `insert as plain user failed: ${ins && ins.message}`);

  const { error: upd } = await sessions.user.from("accounts").update({ data: { name: "Edited" } }).eq("id", "rls-ins-1");
  assert(!upd, `update as plain user failed: ${upd && upd.message}`);
  const after = await valueOf("accounts", "rls-ins-1");
  assert(after && after.name === "Edited", `the update did not take effect, got ${JSON.stringify(after)}`);
});

// DOCUMENTS CURRENT BEHAVIOUR — see finding F1. A plain user cannot delete an ACCOUNT but
// can delete all of its children. If this test starts failing because the policies were
// tightened, that is a fix, not a regression: update the test deliberately.
test("a plain user CAN delete child rows (documents finding F1)", async () => {
  for (const t of ["contacts", "activities", "tasks", "opportunities"]) {
    await seedRow(t, `rls-childdel-${t}`);
    const { error } = await sessions.user.from(t).delete().eq("id", `rls-childdel-${t}`);
    assert(!error, `${t}: delete errored: ${error && error.message}`);
    assert(!(await stillExists(t, `rls-childdel-${t}`)),
      `${t}: today's policy allows a plain user to delete child rows; this test pins that`);
  }
});

// DOCUMENTS CURRENT BEHAVIOUR — see finding F4.
test("every authenticated user can read every profile (documents finding F4)", async () => {
  const { data, error } = await sessions.user.from("profiles").select("id, name, role");
  assert(!error, `profile read errored: ${error && error.message}`);
  assert((data || []).length >= 2, `a plain user should see all profiles, got ${(data || []).length}`);
  assert(data.some(p => p.role === "admin"), "a plain user can see who the admins are");
});
```

- [ ] **Step 2: Run and verify**

Run: `node tests/rls/run.mjs`
Expected: `16 passed, 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add tests/rls/policies.test.mjs
git commit -m "test: pin the flat access model as it stands today

Every authenticated user can read and write every business row, and can
delete child rows even though account deletion is admin-gated. Asserted as-is
so a change is visible; whether it is the right model is spec finding F1."
```

---

### Task 5: Anonymous access

The highest-value assertion in the suite. Every policy is `to authenticated`, so this should already hold — which is exactly why it would break silently.

**Files:**
- Modify: `tests/rls/policies.test.mjs`

- [ ] **Step 1: Write the tests**

Append to `tests/rls/policies.test.mjs`:

```javascript
// --- anonymous access ---------------------------------------------------------------
// Every policy is `to authenticated`. Nothing should be reachable without a session.
// A denied SELECT returns an empty array and NO error, so assert on the DATA.

test("an anonymous client can read nothing", async () => {
  await seedRow("accounts", "rls-anon-1");
  for (const t of ["accounts", "contacts", "activities", "tasks", "opportunities", "profiles", "settings"]) {
    const { data } = await sessions.anon.from(t).select("id");
    assert((data || []).length === 0,
      `${t}: an anonymous client read ${(data || []).length} row(s) — it must read none`);
  }
});

test("an anonymous client cannot insert", async () => {
  const { error } = await sessions.anon.from("accounts").insert({ id: "rls-anon-ins", data: { name: "nope" } });
  assert(error, "an anonymous insert must be rejected");
  assert(!(await stillExists("accounts", "rls-anon-ins")), "an anonymous client created a row");
});

test("an anonymous client cannot update or delete", async () => {
  await seedRow("accounts", "rls-anon-2", { name: "Original" });
  await sessions.anon.from("accounts").update({ data: { name: "Hacked" } }).eq("id", "rls-anon-2");
  const after = await valueOf("accounts", "rls-anon-2");
  assert(after && after.name === "Original", `an anonymous client changed a row: ${JSON.stringify(after)}`);

  await sessions.anon.from("accounts").delete().eq("id", "rls-anon-2");
  assert(await stillExists("accounts", "rls-anon-2"), "an anonymous client deleted a row");
});
```

- [ ] **Step 2: Run and verify**

Run: `node tests/rls/run.mjs`
Expected: `19 passed, 0 failed`.

- [ ] **Step 3: Falsify**

Temporarily add `create policy oops on public.accounts for select to anon using (true);` to `supabase-setup.sql`, rerun, and confirm `an anonymous client can read nothing` FAILS. **Revert.**

- [ ] **Step 4: Commit**

```bash
git add tests/rls/policies.test.mjs
git commit -m "test: assert an anonymous client can reach nothing

Every policy is `to authenticated`, so this passes today — which is precisely
why it needs a test. A convenience policy added later would otherwise open the
book to the internet silently."
```

---

### Task 6: Storage

**Files:**
- Create: `tests/rls/storage.test.mjs`
- Modify: `tests/rls/run.mjs` (add the import)

**Interfaces:**
- Consumes: `sessions`, `API_URL` from `./fixtures.mjs`.

- [ ] **Step 1: Write the tests**

Create `tests/rls/storage.test.mjs`:

```javascript
// The attachments bucket. NOTE the bucket is created with `public = true`, so objects are
// readable by URL with NO auth at all — deliberate per the comment in supabase-setup.sql,
// and pinned below rather than asserted away. See finding F5 in the spec.
import { test, assert } from "../health/framework.mjs";
import { sessions, API_URL } from "./fixtures.mjs";

const body = () => new Blob(["hello"], { type: "text/plain" });

test("an authenticated user can upload to attachments", async () => {
  const { error } = await sessions.user.storage.from("attachments").upload("rls/user-upload.txt", body(), { upsert: true });
  assert(!error, `upload failed: ${error && error.message}`);
});

test("an authenticated user can list attachments", async () => {
  const { data, error } = await sessions.user.storage.from("attachments").list("rls");
  assert(!error, `list failed: ${error && error.message}`);
  assert((data || []).some(f => f.name === "user-upload.txt"), `expected the uploaded file, got ${JSON.stringify(data)}`);
});

// DOCUMENTS CURRENT BEHAVIOUR — see finding F2. attachments_delete checks only the bucket
// id, so any authenticated user can delete anyone's file.
test("any authenticated user CAN delete another user's attachment (documents finding F2)", async () => {
  await sessions.admin.storage.from("attachments").upload("rls/admin-upload.txt", body(), { upsert: true });
  const { error } = await sessions.user.storage.from("attachments").remove(["rls/admin-upload.txt"]);
  assert(!error, `remove errored: ${error && error.message}`);
  const { data } = await sessions.admin.storage.from("attachments").list("rls");
  assert(!(data || []).some(f => f.name === "admin-upload.txt"),
    "today's policy lets any user delete any file; this test pins that");
});

test("an anonymous client cannot upload", async () => {
  const { error } = await sessions.anon.storage.from("attachments").upload("rls/anon.txt", body());
  assert(error, "an anonymous upload must be rejected");
});

test("an anonymous client cannot delete", async () => {
  await sessions.user.storage.from("attachments").upload("rls/keepme.txt", body(), { upsert: true });
  await sessions.anon.storage.from("attachments").remove(["rls/keepme.txt"]);
  const { data } = await sessions.admin.storage.from("attachments").list("rls");
  assert((data || []).some(f => f.name === "keepme.txt"), "an anonymous client deleted a file");
});

// DOCUMENTS CURRENT BEHAVIOUR — see finding F5. The bucket is PUBLIC: uploaded customer
// documents are readable by anyone holding the URL, with no session.
test("anyone with the URL can read an attachment (documents finding F5)", async () => {
  await sessions.user.storage.from("attachments").upload("rls/public.txt", body(), { upsert: true });
  const res = await fetch(`${API_URL}/storage/v1/object/public/attachments/rls/public.txt`);
  assert(res.status === 200, `the bucket is public, so an unauthenticated fetch should succeed, got ${res.status}`);
  assert((await res.text()) === "hello", "the public URL should return the file contents");
});
```

- [ ] **Step 2: Register the file**

In `tests/rls/run.mjs`, add:

```javascript
import "./storage.test.mjs";
```

- [ ] **Step 3: Run and verify**

Run: `node tests/rls/run.mjs`
Expected: `25 passed, 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add tests/rls/storage.test.mjs tests/rls/run.mjs
git commit -m "test: cover the attachments bucket

Includes two tests that pin uncomfortable current behaviour: any authenticated
user can delete anyone's file, and the bucket is public so uploads are readable
by URL without a session. Findings F2 and F5."
```

---

### Task 7: CI, documentation, and full falsification

**Files:**
- Modify: `.github/workflows/pages.yml`
- Modify: `TEAM-SETUP.md`

- [ ] **Step 1: Add the `rls` job**

In `.github/workflows/pages.yml`, add a job after `test`:

```yaml
  rls:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: tests/rls/package-lock.json
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      # brings up real postgres + gotrue + storage; supabase-setup.sql is applied by the
      # suite's own fixtures, so the policies under test are the ones in the repo
      - run: supabase start
      - run: npm ci
        working-directory: tests/rls
      # NEVER pipe this — run.mjs's exit code IS the gate. No retry: a second attempt
      # could only mask a flaky test.
      - run: node tests/rls/run.mjs
```

- [ ] **Step 2: Gate deploy on it**

In the same file, change the `deploy` job's `needs`:

```yaml
  deploy:
    needs: [test, rls]
```

- [ ] **Step 3: Document how to run it locally**

Add to `TEAM-SETUP.md`, after the "Building locally" section:

```markdown
### Running the security tests

`tests/rls/` checks the database's access rules — who can delete an account, who can
change a role, what a logged-out visitor can reach. They run against a real Supabase stack
in Docker, not a mock, so they need Docker running and the Supabase CLI installed.

```sh
supabase start           # real postgres + auth + storage, locally
cd tests/rls && npm ci
node tests/rls/run.mjs
```

These tests **pin the rules as they are today**. If one starts failing, the access model
changed — decide whether that was intended before making the test agree with the code.
Schema changes belong in `supabase-setup.sql`, which is what both the tests and the hosted
project are built from.
```

- [ ] **Step 4: Run both suites locally**

```bash
node tests/health/run.mjs   # expect 190 passed, 0 failed
node tests/rls/run.mjs      # expect 25 passed, 0 failed
```

Neither may be piped.

- [ ] **Step 5: Full falsification sweep**

Run each of these one at a time, confirm the named test fails, then revert before the next:

| Change to `supabase-setup.sql` | Must fail |
|---|---|
| `accounts_delete` → `using (true)` | a plain user cannot delete an account |
| `settings_write` → `using (true)` | a plain user cannot write settings |
| drop `alter table public.accounts enable row level security` | an anonymous client can read nothing |
| remove the `guard_admin_count` trigger | demoting the last admin is refused |
| `handle_new_user` always inserts `'user'` | the first signup becomes an admin |

Confirm `git diff supabase-setup.sql` is empty afterwards.

- [ ] **Step 6: Commit and open the PR**

```bash
git add .github/workflows/pages.yml TEAM-SETUP.md
git commit -m "ci: gate deploy on the RLS suite

Runs in parallel with the E2E job, so wall-clock CI time barely moves. deploy
now needs both."
git push -u origin test/rls-auth
```

Write the PR body to a scratch file first (PowerShell mangles inline quoting, so
`--body-file` is required in this repo), then:

```bash
gh pr create --title "RLS and auth tests" --body-file pr-rls.md --base master
```

The PR body must state: the test counts for both suites (190 and 25), that the
falsification sweep was performed with every change reverted and `git diff
supabase-setup.sql` confirmed empty, and that findings F1–F5 are documented but
deliberately unfixed.

---

## Notes for the executor

- **Do not "fix" a permissive policy you find offensive.** Four tests deliberately assert permissive behaviour and say so in their names. Changing a policy is out of scope; the findings are recorded in the spec for the user to rule on.
- **If a test passes on the first run, be suspicious.** Re-read THE CRITICAL MECHANIC above. A denied select, update or delete returns no error, so an assertion on `error` alone passes whether or not the policy works. Every denial in this plan is verified by reading the row back as admin — keep it that way.
- **`supabase start` is slow the first time** (image pulls, several minutes). It is fast afterwards. Do not add a retry to CI if it is merely slow.
