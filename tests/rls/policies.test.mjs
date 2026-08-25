// Admin-gated operations. REMEMBER: a denied delete or update returns NO error — the row
// simply does not change. Every denial is verified by reading back as admin.
import { test, assert } from "../health/framework.mjs";
import { sessions, seedRow, stillExists, valueOf, roleOf, signUpFresh } from "./fixtures.mjs";

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

// settings.id is `int primary key check (id = 1)` — a single-row table. Both tests below
// therefore target id 1, not a namespaced string id. They still cannot collide: the plain
// user's insert is denied, so no row exists when the admin's insert runs.
test("a plain user cannot write settings", async () => {
  const { error } = await sessions.user.from("settings").insert({ id: 1, data: { rates: { INR: 99 } } });
  assert(error, "settings_write should reject a plain user's insert");
  assert(error.code === "42501", `expected an RLS violation (42501), got ${error.code}: ${error.message}`);
});

test("an admin can write settings", async () => {
  const { error } = await sessions.admin.from("settings").insert({ id: 1, data: { rates: { INR: 0.012 } } });
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

// --- is_active() gating: disabling a user revokes a LIVE session --------------------
// No re-login happens in any of these tests — the victim's client keeps the same token
// throughout. That is the point: is_active() is re-evaluated on every request, so the
// same JWT that worked a moment ago matches zero rows the instant `disabled` flips.
// Each test signs up its own fresh user rather than touching sessions.admin/sessions.user,
// since there is no per-test reset and those two are shared by every other test in the
// suite (including tests that run after this file).

test("a disabled user reads nothing from the business tables", async () => {
  const victim = await signUpFresh("disable-victim1@test.local");
  await seedRow("accounts", "rls-disable-1");

  // Prove the session WORKS before disabling. Without this the assertion below passes
  // just as happily against a broken client, proving nothing.
  const before = await victim.client.from("accounts").select("id").eq("id", "rls-disable-1");
  assert(!before.error && before.data.length === 1,
    `victim should read the seeded account before being disabled, got ${JSON.stringify(before)}`);

  const { error: disableErr } = await sessions.admin.from("profiles").update({ disabled: true }).eq("id", victim.id);
  assert(!disableErr, `disabling the victim failed: ${disableErr && disableErr.message}`);

  const after = await victim.client.from("accounts").select("id").eq("id", "rls-disable-1");
  assert(!after.error && after.data.length === 0,
    `disabled user should read 0 rows, got ${JSON.stringify(after)}`);
});

test("a disabled user cannot insert", async () => {
  const victim = await signUpFresh("disable-victim2@test.local");
  const pre = await victim.client.from("accounts").insert({ id: "rls-disable-pre", data: { name: "Pre" } });
  assert(!pre.error, `victim should insert before being disabled, got: ${pre.error && pre.error.message}`);

  await sessions.admin.from("profiles").update({ disabled: true }).eq("id", victim.id);

  const { error } = await victim.client.from("accounts").insert({ id: "rls-disable-post", data: { name: "Post" } });
  assert(error, "disabled user should not be able to insert");
  assert(!(await stillExists("accounts", "rls-disable-post")), "the disabled user's insert took effect");
});

test("a disabled user can still read their OWN profile, and no other", async () => {
  const victim = await signUpFresh("disable-victim3@test.local");
  await sessions.admin.from("profiles").update({ disabled: true }).eq("id", victim.id);

  // Root() needs this row to tell the user they have been disabled. Deny it and they
  // hang on "Loading profile…" instead.
  const own = await victim.client.from("profiles").select("id,disabled").eq("id", victim.id).single();
  assert(!own.error && own.data.disabled === true,
    `disabled user must read their own profile, got ${JSON.stringify(own)}`);

  const all = await victim.client.from("profiles").select("id");
  assert(!all.error && all.data.length === 1,
    `disabled user should see only their own profile, got ${JSON.stringify(all)}`);
});

test("a disabled admin loses admin powers", async () => {
  const second = await signUpFresh("disable-admin1@test.local");
  const { error: promote } = await sessions.admin.from("profiles").update({ role: "admin" }).eq("id", second.id);
  assert(!promote, `promoting a second admin failed: ${promote && promote.message}`);

  // Prove the promotion actually stuck, and that second.client can delete WHILE active,
  // before disabling. Without this, a promotion that silently failed to take effect would
  // still make the assertion below pass -- a non-admin's delete is denied either way.
  await seedRow("accounts", "rls-disable-admin-before");
  const before = await second.client.from("accounts").delete().eq("id", "rls-disable-admin-before");
  assert(!before.error, `promoted admin should delete before being disabled, got: ${before.error && before.error.message}`);
  assert(!(await stillExists("accounts", "rls-disable-admin-before")),
    "the promoted admin's delete while active did not take effect");

  await seedRow("accounts", "rls-disable-admin");
  const { error: disableErr } = await sessions.admin.from("profiles").update({ disabled: true }).eq("id", second.id);
  assert(!disableErr, `disabling the second admin failed: ${disableErr && disableErr.message}`);

  // accounts_delete is admin-only; a disabled admin must not pass is_admin().
  await second.client.from("accounts").delete().eq("id", "rls-disable-admin");
  assert(await stillExists("accounts", "rls-disable-admin"),
    "a disabled admin should not have been able to delete the account");
});

test("re-enabling a user restores access", async () => {
  const victim = await signUpFresh("disable-admin2@test.local");
  await seedRow("accounts", "rls-disable-reenable");
  await sessions.admin.from("profiles").update({ disabled: true }).eq("id", victim.id);
  const { error: reEnableErr } = await sessions.admin.from("profiles").update({ disabled: false }).eq("id", victim.id);
  assert(!reEnableErr, `re-enabling the victim failed: ${reEnableErr && reEnableErr.message}`);

  const { data, error } = await victim.client.from("accounts").select("id").eq("id", "rls-disable-reenable");
  assert(!error && data.length === 1, `re-enabled user should read again, got ${JSON.stringify({ data, error })}`);
});

// settings_select and health_snapshots_select were gated on is_active() late and had no
// test -- prove active-CAN-read first, then disable and assert it cannot. An
// absence-only assertion proves nothing (see rls-anon-key-vacuity in the project memory).

test("a disabled user cannot read settings", async () => {
  const victim = await signUpFresh("disable-victim-settings@test.local");
  // upsert, not insert: an earlier test in this file ("an admin can write settings")
  // already created row id=1, and a plain insert against that existing row would fail
  // with a duplicate-key error the original version of this test never checked --
  // the read below would then pass only because that OTHER test happened to run first,
  // not because this seed worked. Upsert makes the seed self-sufficient regardless of
  // test order, and the error is checked so a real seeding failure is not silently hidden.
  const seed = await sessions.admin.from("settings").upsert({ id: 1, data: { rates: { INR: 0.012 } } });
  assert(!seed.error, `seeding settings failed: ${seed.error && seed.error.message}`);

  const before = await victim.client.from("settings").select("id");
  assert(!before.error && before.data.length === 1,
    `victim should read settings before being disabled, got ${JSON.stringify(before)}`);

  await sessions.admin.from("profiles").update({ disabled: true }).eq("id", victim.id);

  const after = await victim.client.from("settings").select("id");
  assert(!after.error && after.data.length === 0,
    `disabled user should read 0 settings rows, got ${JSON.stringify(after)}`);
});

test("a disabled user cannot read health_snapshots", async () => {
  const victim = await signUpFresh("disable-victim-health@test.local");
  await seedRow("accounts", "rls-disable-health-acct");
  // health_snapshots has NO insert policy -- see supabase-setup.sql: every write funnels
  // through record_health(), a SECURITY DEFINER function. A raw admin insert against the
  // table is denied by RLS and returns no error via PostgREST, which is exactly how the
  // first version of this test passed while seeding nothing (CI caught it: "before" read
  // back 0 rows). Seed it the only way the table can actually be written -- call
  // record_health() as the still-active victim.
  const seed = await victim.client.rpc("record_health", { p_scores: [{ accountId: "rls-disable-health-acct", score: 80 }] });
  assert(!seed.error, `seeding health_snapshots via record_health failed: ${seed.error && seed.error.message}`);

  const before = await victim.client.from("health_snapshots").select("account_id").eq("account_id", "rls-disable-health-acct");
  assert(!before.error && before.data.length === 1,
    `victim should read health_snapshots before being disabled, got ${JSON.stringify(before)}`);

  await sessions.admin.from("profiles").update({ disabled: true }).eq("id", victim.id);

  const after = await victim.client.from("health_snapshots").select("account_id").eq("account_id", "rls-disable-health-acct");
  assert(!after.error && after.data.length === 0,
    `disabled user should read 0 health_snapshots rows, got ${JSON.stringify(after)}`);
});

// record_health() is SECURITY DEFINER and bypasses RLS entirely, so gating
// health_snapshots_select above does nothing to stop a disabled user calling this RPC
// directly -- this is the assertion whose absence hid that bug (see final-fix-report).
test("record_health is refused for a disabled user", async () => {
  const victim = await signUpFresh("disable-victim-record@test.local");
  await seedRow("accounts", "rls-disable-record-acct");

  const before = await victim.client.rpc("record_health", { p_scores: [{ accountId: "rls-disable-record-acct", score: 55 }] });
  assert(!before.error, `victim should call record_health before being disabled, got: ${before.error && before.error.message}`);

  await sessions.admin.from("profiles").update({ disabled: true }).eq("id", victim.id);

  const { error } = await victim.client.rpc("record_health", { p_scores: [{ accountId: "rls-disable-record-acct", score: 99 }] });
  assert(error, "a disabled user should not be able to call record_health");

  const row = await sessions.admin.from("health_snapshots").select("score").eq("account_id", "rls-disable-record-acct").single();
  assert(!row.error && row.data.score === 55,
    `a disabled user's record_health call must not have taken effect, got ${JSON.stringify(row)}`);
});
