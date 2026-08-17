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
