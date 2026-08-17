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
