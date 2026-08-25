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
  const { client } = await signUpFresh("noname@test.local", null);
  const { data } = await client.auth.getUser();
  const { data: p } = await sessions.admin.from("profiles").select("name").eq("id", data.user.id).single();
  assert(p && p.name === "noname", `expected name "noname", got ${JSON.stringify(p)}`);
});

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

// guard_admin_count() now also fires on `disabled` (widened from `update of role`), and
// carries a second guard: an admin cannot disable themselves, even with others still active.
test("disabling the last admin is refused", async () => {
  const { data } = await sessions.admin.auth.getUser();
  const { error } = await sessions.admin.from("profiles").update({ disabled: true }).eq("id", data.user.id);
  assert(error, "disabling the only admin should raise");
  // The self-disable guard fires first for the sole admin (they're disabling themselves),
  // so either message is a correct refusal here.
  assert(/yourself|at least one admin/i.test(error.message),
    `expected a refusal, got: ${error.message}`);
});

test("an admin cannot disable themselves even when another admin exists", async () => {
  const second = await signUpFresh("admin2b@test.local");
  const { error: promote } = await sessions.admin.from("profiles").update({ role: "admin" }).eq("id", second.id);
  assert(!promote, `promoting a second admin failed: ${promote && promote.message}`);

  const { data } = await sessions.admin.auth.getUser();
  const { error } = await sessions.admin.from("profiles").update({ disabled: true }).eq("id", data.user.id);
  assert(error, "expected self-disable to be refused");
  assert(/yourself/i.test(error.message), `unexpected message: ${error && error.message}`);
});

test("one of two admins can be disabled by the other", async () => {
  const second = await signUpFresh("admin3@test.local");
  const { error: promote } = await sessions.admin.from("profiles").update({ role: "admin" }).eq("id", second.id);
  assert(!promote, `promoting a second admin failed: ${promote && promote.message}`);

  const { error } = await sessions.admin.from("profiles").update({ disabled: true }).eq("id", second.id);
  assert(!error, `expected the disable to succeed, got: ${error && error.message}`);
});

// admin_user_list() / admin_set_user_email() -- Task 3. profiles has no email column;
// these definer functions are the only path an admin has to auth.users addresses.

test("admin_user_list returns every user with their email", async () => {
  const { error, data } = await sessions.admin.rpc("admin_user_list");
  assert(!error, `admin_user_list failed: ${error && error.message}`);
  const emails = (data || []).map(r => r.email);
  // Proves the definer join actually reaches auth.users -- not just that SOME rows came
  // back. The suite shares state across files, so this asserts membership, not equality.
  assert(emails.includes("admin@test.local"), `admin@test.local missing from ${JSON.stringify(emails)}`);
  assert(emails.includes("user@test.local"), `user@test.local missing from ${JSON.stringify(emails)}`);
});

test("a non-admin cannot call admin_user_list", async () => {
  // The permitting case is proven above by sessions.admin against the same function --
  // this is the positive discrimination the refusal is measured against.
  const { error } = await sessions.user.rpc("admin_user_list");
  assert(error, "expected admin_user_list to refuse a non-admin");
});

test("an admin can change a user's email, and a non-admin cannot", async () => {
  const target = await signUpFresh("email-target1@test.local");
  const newAddr = "email-target1-new@test.local";

  // Non-admin refusal, checked BEFORE the admin succeeds, so a later success can't be
  // mistaken for evidence the refusal was ever real.
  const { error: refused } = await sessions.user.rpc("admin_set_user_email",
    { p_id: target.id, p_email: newAddr });
  assert(refused, "expected admin_set_user_email to refuse a non-admin");

  const { error: ok } = await sessions.admin.rpc("admin_set_user_email",
    { p_id: target.id, p_email: newAddr });
  assert(!ok, `expected the admin's change to succeed, got: ${ok && ok.message}`);
});

test("admin_set_user_email rejects a duplicate address", async () => {
  const a = await signUpFresh("dup-a@test.local");
  const b = await signUpFresh("dup-b@test.local");
  const takenAddr = "dup-a-taken@test.local";

  // Prove the permitting case first: admin CAN move a's address to a fresh one.
  const { error: setup } = await sessions.admin.rpc("admin_set_user_email",
    { p_id: a.id, p_email: takenAddr });
  assert(!setup, `setup rename for a failed: ${setup && setup.message}`);

  const { error } = await sessions.admin.rpc("admin_set_user_email",
    { p_id: b.id, p_email: takenAddr });
  assert(error, "expected a duplicate email to be refused");
  assert(/already in use/i.test(error.message), `unexpected message: ${error.message}`);
});

test("admin_set_user_email rejects a malformed address", async () => {
  const target = await signUpFresh("malformed-target@test.local");
  const { error } = await sessions.admin.rpc("admin_set_user_email",
    { p_id: target.id, p_email: "not-an-email" });
  assert(error, "expected a malformed email to be refused");
});
