// Account pre-hijack guard (security review 2026-10-17, HIGH): a login is attached to an org
// only once its email is confirmed. Before, anyone could sign up with an address they did not
// own and inherit the role when an admin later invited that address.
//
// The local stack auto-confirms sign-ups (supabase/config.toml), so an UNconfirmed login is
// made here straight in auth.users -- the same row GoTrue writes when Confirm email is on --
// and "the owner clicked the link" is the update that sets email_confirmed_at.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, orgOf, roleOf, signUpFresh, ORG_A } from "./fixtures.mjs";

async function unconfirmedLogin(email) {
  const [{ id }] = await sql(
    `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             $1, '{"name":"Unverified"}'::jsonb, now(), now())
     returning id`, [email]);
  return id;
}
const confirm = id => sql(`update auth.users set email_confirmed_at = now() where id = $1`, [id]);
const openInvite = async (email) => (await sql(
  `select org_id, role from invites where email = $1 and accepted_at is null`, [email]))[0] || null;

test("pre-hijack: an unconfirmed sign-up does not claim an open invite until it is confirmed", async () => {
  const { error } = await sessions.admin.rpc("invite_user", { p_email: "ph.newsignup@test.local", p_role: "admin" });
  assert(!error, error && error.message);
  const id = await unconfirmedLogin("ph.newsignup@test.local");
  assert((await orgOf(id)) === null, "an unconfirmed sign-up was attached to the inviting org");
  assert((await openInvite("ph.newsignup@test.local"))?.org_id === ORG_A, "the invite was consumed by an unconfirmed sign-up");

  await confirm(id);
  assert((await orgOf(id)) === ORG_A, "confirming the email did not attach the login");
  assert((await roleOf(id)) === "admin", "the confirmed login did not get the invited role");
  assert((await openInvite("ph.newsignup@test.local")) === null, "the invite is still open after the attach");
});

test("pre-hijack: invite_user does not attach an unconfirmed org-less login; confirming does", async () => {
  const id = await unconfirmedLogin("ph.preregistered@test.local");
  const { data, error } = await sessions.admin.rpc("invite_user", { p_email: "PH.Preregistered@test.local", p_role: "user" });
  assert(!error, error && error.message);
  assert(data === "invited", `expected 'invited' for an unconfirmed login, got ${JSON.stringify(data)}`);
  assert((await orgOf(id)) === null, "invite_user attached an unconfirmed login");
  assert((await openInvite("ph.preregistered@test.local"))?.role === "user", "no open invite was left for the address");

  await confirm(id);
  assert((await orgOf(id)) === ORG_A, "confirming did not attach the login through the invite");
  assert((await roleOf(id)) === "user", "wrong role after confirmation");
});

test("pre-hijack: create_org does not make an unconfirmed login the new org's admin; confirming does", async () => {
  const id = await unconfirmedLogin("ph.owner@test.local");
  const { data: orgId, error } = await sessions.platform.rpc("create_org", { p_name: "Client PH", p_admin_email: "ph.owner@test.local" });
  assert(!error, error && error.message);
  assert((await orgOf(id)) === null, "create_org attached an unconfirmed login as admin");
  assert((await openInvite("ph.owner@test.local"))?.org_id === orgId, "create_org left no open admin invite");

  await confirm(id);
  assert((await orgOf(id)) === orgId, "confirming did not attach the owner to the new org");
  assert((await roleOf(id)) === "admin", "the owner is not the new org's admin after confirming");
});

test("pre-hijack: confirming a disabled login keeps it out and the invite open, without failing the confirmation", async () => {
  const id = await unconfirmedLogin("ph.disabled@test.local");
  await sql(`insert into invites (email, org_id, role) values ('ph.disabled@test.local', $1, 'user')`, [ORG_A]);
  await sql(`update profiles set disabled = true where id = $1`, [id]);
  await confirm(id);   // must not throw: a refused attach never blocks the confirmation
  const [u] = await sql(`select email_confirmed_at from auth.users where id = $1`, [id]);
  assert(u.email_confirmed_at, "the confirmation itself was rolled back");
  assert((await orgOf(id)) === null, "a disabled login was attached on confirmation");
  assert((await openInvite("ph.disabled@test.local")) !== null, "the invite was consumed by a refused attach");
});

test("pre-hijack: confirming a login with no invite leaves it org-less", async () => {
  const id = await unconfirmedLogin("ph.nobody@test.local");
  await confirm(id);
  assert((await orgOf(id)) === null, "an uninvited login was attached on confirmation");
  assert((await roleOf(id)) === "user", "an uninvited login got a role other than user");
});

test("control: a confirmed login is still attached by invite_user straight away", async () => {
  const { id } = await signUpFresh("ph.confirmed@test.local");
  const { data, error } = await sessions.admin.rpc("invite_user", { p_email: "ph.confirmed@test.local", p_role: "user" });
  assert(!error && data === "attached", `expected 'attached', got ${JSON.stringify(data)} ${error && error.message}`);
  assert((await orgOf(id)) === ORG_A, "a confirmed org-less login was not attached");
});
