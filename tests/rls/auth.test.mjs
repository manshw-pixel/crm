// The signup path and role assignment -- handle_new_user() in supabase-setup.sql. A sign-up
// joins an org ONLY through a pending invite; there is no "first user becomes admin" rule.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, signUpFresh, roleOf, orgOf, seedAccount, invitedFresh, newClient, PASSWORD, ORG_A, ORG_B } from "./fixtures.mjs";

// invitedFresh: guard_admin_count counts admins per org, so an org-less "second admin"
// would not be a second admin of anything.
test("a sign-up matching an admin invite lands in that org as admin", async () => {
  await sql(`insert into invites (email, org_id, role) values ('inv-admin@test.local', $1, 'admin')`, [ORG_B]);
  const { id } = await signUpFresh("inv-admin@test.local", "Invited Admin");
  assert(await roleOf(id) === "admin", "invite role 'admin' was not applied");
  assert(await orgOf(id) === ORG_B, "invite org was not applied");
  const [inv] = await sql(`select accepted_at from invites where email = 'inv-admin@test.local'`);
  assert(inv.accepted_at, "the invite was not marked accepted");
});

test("a sign-up matching a user invite lands in that org as user", async () => {
  await sql(`insert into invites (email, org_id, role) values ('inv-user@test.local', $1, 'user')`, [ORG_A]);
  const { id } = await signUpFresh("inv-user@test.local", "Invited User");
  assert(await roleOf(id) === "user", "invite role 'user' was not applied");
  assert(await orgOf(id) === ORG_A, "invite org was not applied");
});

test("a sign-up with no invite gets no org and reads nothing", async () => {
  // Real data behind the absence: an org-A account the control session CAN read.
  await seedAccount("vis-a", { name: "A" }, ORG_A);
  const { data: control, error: cErr } = await sessions.user.from("accounts").select("id").eq("id", "vis-a");
  assert(!cErr && (control || []).length === 1, `control: org A's user cannot see vis-a (${cErr && cErr.message})`);

  const { client, id } = await signUpFresh("stranger@test.local", "Stranger");
  assert(await orgOf(id) === null, "an uninvited sign-up was attached to an org");
  assert(await roleOf(id) === "user", "an uninvited sign-up must never be admin");
  const { data, error } = await client.from("accounts").select("id");
  assert(!error, `unexpected error: ${error && error.message}`);
  assert((data || []).length === 0, "an org-less user can read accounts");
});

// GoTrue lowercases the address itself, so a sign-up through the API cannot tell whether
// the trigger's lower() works. Insert into auth.users directly with a mixed-case address,
// which is exactly what fires handle_new_user(), so the trigger's own matching is tested.
test("invite email matching is case-insensitive", async () => {
  await sql(`insert into invites (email, org_id, role) values ('mixed@test.local', $1, 'user')`, [ORG_B]);
  const [u] = await sql(`insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
            'MiXed@Test.Local', '{}'::jsonb) returning id`);
  assert(await orgOf(u.id) === ORG_B, "a mixed-case address did not match its lowercase invite");
});

test("profile name falls back to the email prefix when sign-up sends no name", async () => {
  await sql(`insert into invites (email, org_id, role) values ('noname@test.local', $1, 'user')`, [ORG_A]);
  const { id } = await signUpFresh("noname@test.local", null);
  const [row] = await sql(`select name from profiles where id = $1`, [id]);
  assert(row.name === "noname", `expected 'noname', got ${row.name}`);
});

test("a profile is auto-created and named from signup metadata", async () => {
  const { data } = await sessions.admin.auth.getUser();
  const { data: p } = await sessions.admin.from("profiles").select("name").eq("id", data.user.id).single();
  assert(p && p.name === "Admin User", `expected name "Admin User", got ${JSON.stringify(p)}`);
});

// guard_profile_org(): profiles_update_admin lets an org admin update their OWN row, so RLS
// alone does not stop them minting themselves a platform admin. The trigger must.
test("an org admin cannot make themselves a platform admin", async () => {
  const { data } = await sessions.admin.auth.getUser();
  const { error } = await sessions.admin.from("profiles").update({ platform_admin: true }).eq("id", data.user.id);
  assert(error, "setting own platform_admin should raise");
  assert(/platform admin/i.test(error.message), `expected the guard's message, got: ${error.message}`);
  const [row] = await sql(`select platform_admin from profiles where id = $1`, [data.user.id]);
  assert(row.platform_admin === false, "platform_admin was set despite the guard");
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
  const second = await invitedFresh("admin2@test.local");
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
  const second = await invitedFresh("admin2b@test.local");
  const { error: promote } = await sessions.admin.from("profiles").update({ role: "admin" }).eq("id", second.id);
  assert(!promote, `promoting a second admin failed: ${promote && promote.message}`);

  const { data } = await sessions.admin.auth.getUser();
  const { error } = await sessions.admin.from("profiles").update({ disabled: true }).eq("id", data.user.id);
  assert(error, "expected self-disable to be refused");
  assert(/yourself/i.test(error.message), `unexpected message: ${error && error.message}`);
});

test("one of two admins can be disabled by the other", async () => {
  const second = await invitedFresh("admin3@test.local");
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

// Task 3's other tests above only check that the RPC call itself returns without error --
// none of them attempt to sign in. That leaves an open question spec §6 flags explicitly:
// admin_set_user_email() updates BOTH auth.users.email and
// auth.identities.identity_data->>'email' on the theory that GoTrue's password sign-in
// reads the identity, not just the user row, and that touching only one would leave the
// user unable to authenticate with EITHER address. This test is the only place that
// theory gets checked against a real GoTrue instance rather than assumed correct because
// the SQL update didn't error.
//
// A throwaway account is used (not sessions.admin/sessions.user) because those two are
// shared by every other file in the suite and this test permanently changes its account's
// address; a fresh account isolates the blast radius to itself.
test("after an email change the new address signs in and the old one does not", async () => {
  const target = await signUpFresh("gotrue-move-src@test.local");
  const newAddr = "gotrue-move-dst@test.local";

  const { error: rpcErr } = await sessions.admin.rpc("admin_set_user_email",
    { p_id: target.id, p_email: newAddr });
  assert(!rpcErr, `admin_set_user_email failed outright: ${rpcErr && rpcErr.message}`);

  // Outcome 2 in the task brief: the identity update didn't take, so GoTrue still checks
  // password sign-in against the old identity_data and rejects the new address.
  const good = await newClient().auth.signInWithPassword({ email: newAddr, password: PASSWORD });
  assert(!good.error && good.data.session,
    "FAILURE MODE: new address rejected -- admin_set_user_email did not make the new "
    + `address usable for sign-in (auth.identities likely still holds the old email). `
    + `Sign-in error: ${good.error && good.error.message}`);

  // Outcome 3 in the task brief: auth.users.email moved but the stale identity_data still
  // matches, so GoTrue happily signs the old address back in.
  const bad = await newClient().auth.signInWithPassword({ email: "gotrue-move-src@test.local", password: PASSWORD });
  assert(bad.error,
    "FAILURE MODE: old address still signs in -- admin_set_user_email left "
    + "auth.identities pointing at the old email even though auth.users.email moved. "
    + `Sign-in for the old address unexpectedly succeeded (session: ${!!bad.data?.session}).`);
});
