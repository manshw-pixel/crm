// Client limits. Every block assertion has a positive control on the same session, and
// every test restores the org's limits in `finally` (tests/rls has no per-test reset).
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, ORG_B } from "./fixtures.mjs";

const USERS_MSG = /Your plan allows \d+ users — contact OneVio to raise it\./;
const setLimits = (org, u, a) => sql(`update public.orgs set max_users = $2, max_accounts = $3 where id = $1`, [org, u, a]);
const seats = async org => (await sql(`select public.org_seat_count($1) as n`, [org]))[0].n;
const addPending = (email, org) => sql(
  `insert into public.invites (email, org_id, role) values ($1, $2, 'user') on conflict do nothing`, [email, org]);
const dropInvites = () => sql(`delete from public.invites where email like 'lim-%@example.com'`);

// Fill org B's open seats with pending invites so seats == lim (lim >= 2).
async function atSeatLimit(org) {
  let n = await seats(org);
  for (let i = 0; n < 2; i++, n++) await addPending(`lim-fill${i}@example.com`, org);
  await setLimits(org, n, null);
  return n;
}

test("invite_user is blocked at max_users and allowed one below", async () => {
  try {
    const lim = await atSeatLimit(ORG_B);
    const blocked = await sessions.adminB.rpc("invite_user", { p_email: "lim-new@example.com", p_role: "user" });
    assert(blocked.error && USERS_MSG.test(blocked.error.message), `invite at the limit was not blocked: ${JSON.stringify(blocked)}`);
    assert(blocked.error.message.includes(`allows ${lim} users`), `wrong limit in message: ${blocked.error.message}`);
    await setLimits(ORG_B, lim + 1, null);
    const ok = await sessions.adminB.rpc("invite_user", { p_email: "lim-new@example.com", p_role: "user" });
    assert(!ok.error && ok.data === "invited", `control: invite below the limit failed: ${ok.error?.message}`);
  } finally { await setLimits(ORG_B, null, null); await dropInvites(); }
});

test("re-sending an already-pending invite at the limit still works", async () => {
  try {
    await addPending("lim-again@example.com", ORG_B);
    await atSeatLimit(ORG_B);
    const r = await sessions.adminB.rpc("invite_user", { p_email: "lim-again@example.com", p_role: "user" });
    assert(!r.error, `re-invite of a pending address was blocked: ${r.error?.message}`);
  } finally { await setLimits(ORG_B, null, null); await dropInvites(); }
});

test("disabled users and the platform admin do not use a seat", async () => {
  const before = await seats(ORG_B);
  const target = (await sql(`select id from profiles where org_id = $1 and role = 'user' and not disabled limit 1`, [ORG_B]))[0];
  assert(target, "precondition: org B has no enabled plain user");
  const plat = (await sql(`select id, org_id from profiles where platform_admin limit 1`))[0];
  assert(plat, "precondition: no platform admin");
  try {
    await sql(`update profiles set disabled = true where id = $1`, [target.id]);
    assert(await seats(ORG_B) === before - 1, "a disabled user still counts as a seat");
    await sql(`update profiles set org_id = $2 where id = $1`, [plat.id, ORG_B]);
    assert(await seats(ORG_B) === before - 1, "the platform admin counts as a seat in a client they switched into");
  } finally {
    await sql(`update profiles set org_id = $2 where id = $1`, [plat.id, plat.org_id]);
    await sql(`update profiles set disabled = false where id = $1`, [target.id]);
  }
});

test("re-enabling a user is blocked at max_users and allowed below", async () => {
  const target = (await sql(`select id from profiles where org_id = $1 and role = 'user' and not disabled limit 1`, [ORG_B]))[0];
  try {
    await sql(`update profiles set disabled = true where id = $1`, [target.id]);
    const lim = await atSeatLimit(ORG_B);
    const blocked = await sessions.adminB.from("profiles").update({ disabled: false }).eq("id", target.id).select("id");
    const still = (await sql(`select disabled from profiles where id = $1`, [target.id]))[0].disabled;
    assert(blocked.error && USERS_MSG.test(blocked.error.message), `re-enable at the limit not refused: ${JSON.stringify(blocked)}`);
    assert(still === true, "the user was re-enabled past the limit");
    await setLimits(ORG_B, lim + 1, null);
    const ok = await sessions.adminB.from("profiles").update({ disabled: false }).eq("id", target.id).select("id");
    assert(!ok.error && ok.data?.length === 1, `control: re-enable below the limit failed: ${ok.error?.message}`);
  } finally {
    await setLimits(ORG_B, null, null); await dropInvites();
    await sql(`update profiles set disabled = false where id = $1`, [target.id]);
  }
});

test("limits below the minimums are rejected by the table", async () => {
  let e1, e2;
  try { await setLimits(ORG_B, 1, null); } catch (e) { e1 = e; }
  try { await setLimits(ORG_B, null, 4); } catch (e) { e2 = e; }
  await setLimits(ORG_B, null, null);
  assert(e1 && /orgs_max_users_min/.test(e1.message), `max_users = 1 accepted (${e1?.message})`);
  assert(e2 && /orgs_max_accounts_min/.test(e2.message), `max_accounts = 4 accepted (${e2?.message})`);
  await setLimits(ORG_B, 2, 5); // control: the minimums themselves are valid
  await setLimits(ORG_B, null, null);
});
