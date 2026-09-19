// Tenant isolation. Every "cannot see" assertion is paired with a "can see own" control in
// the same test, so a policy that returns nothing to anyone would fail loudly rather than
// pass vacuously (the lesson of the anon-key incident in fixtures.mjs).
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, seedAccount, valueOf, orgOf, signUpFresh, ORG_A, ORG_B } from "./fixtures.mjs";

const TABLES = ["accounts", "contacts", "activities", "tasks", "opportunities"];

test("a user reads only their own org's rows on every entity table", async () => {
  for (const t of TABLES) {
    await sql(`insert into public.${t} (org_id, id, data) values ($1, 'iso-a', '{"name":"A"}'), ($2, 'iso-b', '{"name":"B"}')
               on conflict (org_id, id) do nothing`, [ORG_A, ORG_B]);
    const { data, error } = await sessions.user.from(t).select("id");
    assert(!error, `${t}: ${error && error.message}`);
    const ids = (data || []).map(r => r.id);
    assert(ids.includes("iso-a"), `${t}: own org row missing (vacuous policy?)`);
    assert(!ids.includes("iso-b"), `${t}: LEAK -- org B's row visible to org A's user`);
  }
});

test("settings are per org", async () => {
  await sql(`insert into settings (org_id, data) values ($1, '{"rates":{"INR":1}}'), ($2, '{"rates":{"INR":2}}')
             on conflict (org_id) do update set data = excluded.data`, [ORG_A, ORG_B]);
  const { data, error } = await sessions.userB.from("settings").select("data");
  assert(!error, error && error.message);
  assert(data.length === 1 && data[0].data.rates.INR === 2, `org B user saw ${JSON.stringify(data)}`);
});

test("an insert naming another org is rejected", async () => {
  const { error } = await sessions.user.from("accounts").insert({ org_id: ORG_B, id: "iso-cross", data: { name: "X" } });
  assert(error && error.code === "42501", `expected 42501, got ${error && error.code}: ${error && error.message}`);
  const rows = await sql(`select 1 from accounts where id = 'iso-cross'`);
  assert(rows.length === 0, "a cross-org insert landed");
});

// F18: crm.html's fetchAll backfill (~428) and the bulk path (~3610) send upsert({id, data})
// with NO org_id. That must resolve on the composite key (org_id, id) with org_id taken from
// the column default -- landing in the caller's org, updating on the second call, and never
// touching another org's row of the same id.
test("a client upsert({id, data}) lands in the caller's org against the composite key", async () => {
  await seedAccount("iso-up", { name: "B keeps this" }, ORG_B);
  const first = await sessions.user.from("accounts").upsert({ id: "iso-up", data: { name: "A v1" } });
  assert(!first.error, `first upsert failed: ${first.error && first.error.code}: ${first.error && first.error.message}`);
  const second = await sessions.user.from("accounts").upsert({ id: "iso-up", data: { name: "A v2" } });
  assert(!second.error, `second (conflict) upsert failed: ${second.error && second.error.code}: ${second.error && second.error.message}`);
  assert((await valueOf("accounts", "iso-up", ORG_A))?.name === "A v2", "the upsert did not land (or update) in org A");
  assert((await valueOf("accounts", "iso-up", ORG_B)).name === "B keeps this", "org A's upsert touched org B's row");
});

test("merge_row stamps the caller's org and never touches another org's row", async () => {
  await seedAccount("iso-m", { name: "B original" }, ORG_B);
  const { error } = await sessions.user.rpc("merge_row", { tbl: "accounts", row_id: "iso-m", patch: { name: "A wrote this" }, appends: {} });
  assert(!error, `merge_row errored: ${error && error.message}`);
  assert((await valueOf("accounts", "iso-m", ORG_B)).name === "B original", "org A's merge overwrote org B's row");
  assert((await valueOf("accounts", "iso-m", ORG_A)).name === "A wrote this", "org A's merge did not land in org A");
});

test("merge_row into settings writes only the caller's org row", async () => {
  await sql(`insert into settings (org_id, data) values ($1, '{"rates":{"INR":2}}')
             on conflict (org_id) do update set data = excluded.data`, [ORG_B]);
  const { error } = await sessions.admin.rpc("merge_row", { tbl: "settings", row_id: "1", patch: { marker: "a" }, appends: {} });
  assert(!error, `merge_row(settings) errored: ${error && error.message}`);
  const rows = await sql(`select org_id, data from settings where org_id in ($1, $2)`, [ORG_A, ORG_B]);
  const a = rows.find(r => r.org_id === ORG_A), b = rows.find(r => r.org_id === ORG_B);
  assert(a && a.data.marker === "a", `org A's settings did not get the patch: ${JSON.stringify(a)}`);
  assert(b && b.data.marker === undefined && b.data.rates.INR === 2, `org A's merge touched org B's settings: ${JSON.stringify(b)}`);
});

test("replace_all deletes only the caller's org", async () => {
  await seedAccount("keep-b", { name: "Keep" }, ORG_B);
  const { error } = await sessions.admin.rpc("replace_all", { payload: { accounts: [{ id: "new-a", name: "New" }], settings: {} } });
  assert(!error, `replace_all errored: ${error && error.message}`);
  assert(await valueOf("accounts", "keep-b", ORG_B), "replace_all in org A wiped org B");
  assert(await valueOf("accounts", "new-a", ORG_A), "replace_all did not insert into org A");
});

test("record_health stamps the org and only accepts the caller's accounts", async () => {
  await seedAccount("hs-a", { name: "HA" }, ORG_A);
  await seedAccount("hs-b", { name: "HB" }, ORG_B);
  const { data: n, error } = await sessions.user.rpc("record_health", { p_scores: [{ accountId: "hs-a", score: 50 }, { accountId: "hs-b", score: 50 }] });
  assert(!error, `record_health errored: ${error && error.message}`);
  assert(n === 1, `expected 1 row written, got ${n}`);
  const rows = await sql(`select org_id, account_id from health_snapshots where account_id in ('hs-a','hs-b')`);
  assert(rows.length === 1 && rows[0].org_id === ORG_A && rows[0].account_id === "hs-a", `unexpected rows ${JSON.stringify(rows)}`);
});

// F11: health_snapshots cross-org read, with an own-org control.
test("health_snapshots are visible only within the org", async () => {
  await sql(`insert into health_snapshots (org_id, account_id, day, score) values
               ($1, 'hs-iso', current_date, 11), ($2, 'hs-iso', current_date, 22)
             on conflict (org_id, account_id, day) do update set score = excluded.score`, [ORG_A, ORG_B]);
  const { data, error } = await sessions.userB.from("health_snapshots").select("score").eq("account_id", "hs-iso");
  assert(!error, error && error.message);
  assert(data.length === 1 && data[0].score === 22, `org B user saw ${JSON.stringify(data)} (expected only its own 22)`);
});

// F11: invites cross-org read, with an own-org control. The bootstrap invites persist
// (accepted_at set), so each org's admin has rows of its own to see.
test("invites are visible only to the org's own admin", async () => {
  const { data, error } = await sessions.adminB.from("invites").select("email");
  assert(!error, error && error.message);
  const emails = data.map(i => i.email);
  assert(emails.includes("adminb@test.local"), `own org invite missing: ${JSON.stringify(emails)}`);
  assert(!emails.includes("admin@test.local"), "LEAK: org A's invites visible to org B's admin");
  const plain = await sessions.userB.from("invites").select("email");
  assert(!plain.error && plain.data.length === 0, `a plain user read invites: ${JSON.stringify(plain.data)}`);
});

// F23: invites_insert -- an org admin may invite into their own org only.
test("an org admin can insert an invite into their own org, not another", async () => {
  const own = await sessions.admin.from("invites").insert({ email: "inv-own@test.local", org_id: ORG_A, role: "user" });
  assert(!own.error, `own-org invite failed: ${own.error && own.error.message}`);
  const cross = await sessions.admin.from("invites").insert({ email: "inv-cross@test.local", org_id: ORG_B, role: "user" });
  assert(cross.error && cross.error.code === "42501", `expected 42501, got ${cross.error && cross.error.code}`);
  const plain = await sessions.user.from("invites").insert({ email: "inv-plain@test.local", org_id: ORG_A, role: "admin" });
  assert(plain.error && plain.error.code === "42501", `a plain user's invite: expected 42501, got ${plain.error && plain.error.code}`);
  // Only this test's three addresses: auth.test.mjs owns other inv-* invites (one in org B).
  const rows = await sql(`select email, org_id from invites
                          where email in ('inv-own@test.local', 'inv-cross@test.local', 'inv-plain@test.local')`);
  assert(rows.length === 1 && rows[0].email === "inv-own@test.local" && rows[0].org_id === ORG_A,
    `unexpected invites ${JSON.stringify(rows)}`);
});

test("a user cannot change their own org_id or platform flag", async () => {
  const { data } = await sessions.user.auth.getUser();
  await sessions.user.from("profiles").update({ org_id: ORG_B }).eq("id", data.user.id);
  await sessions.user.from("profiles").update({ platform_admin: true }).eq("id", data.user.id);
  const [row] = await sql(`select org_id, platform_admin from profiles where id = $1`, [data.user.id]);
  assert(row.org_id === ORG_A && row.platform_admin === false, `PRIVILEGE ESCALATION: ${JSON.stringify(row)}`);
});

test("an org admin cannot move a user to another org", async () => {
  const { data } = await sessions.user.auth.getUser();
  const { error } = await sessions.admin.from("profiles").update({ org_id: ORG_B }).eq("id", data.user.id);
  assert(error, "the org guard trigger should raise for an org admin");
  const [row] = await sql(`select org_id from profiles where id = $1`, [data.user.id]);
  assert(row.org_id === ORG_A, "an org admin moved a user across orgs");
});

test("admin_user_list never returns another org's users", async () => {
  const { data, error } = await sessions.admin.rpc("admin_user_list");
  assert(!error, error && error.message);
  const emails = data.map(u => u.email);
  assert(emails.includes("user@test.local"), "own org user missing");
  assert(!emails.includes("userb@test.local"), "LEAK: org B's user listed to org A's admin");
});

test("admin_set_user_email refuses a user in another org", async () => {
  const [{ id }] = await sql(`select id from auth.users where email = 'userb@test.local'`);
  const { error } = await sessions.admin.rpc("admin_set_user_email", { p_id: id, p_email: "hijacked@test.local" });
  assert(error && /not in your org/.test(error.message), `expected the org gate, got ${error && error.message}`);
  const [row] = await sql(`select email from auth.users where id = $1`, [id]);
  assert(row.email === "userb@test.local", `org A's admin rewrote org B's login: ${row.email}`);
});

test("profiles are visible only within the org", async () => {
  const { data } = await sessions.userB.from("profiles").select("id,name");
  const names = data.map(p => p.name);
  assert(names.includes("Admin B"), "own org profile missing");
  assert(!names.includes("Admin User"), "LEAK: org A profile visible to org B");
});

test("demoting an org's last admin fails even though other orgs have admins", async () => {
  const [{ id }] = await sql(`select p.id from profiles p join auth.users u on u.id = p.id where u.email = 'adminb@test.local'`);
  // auth.test.mjs signs up inv-admin@test.local as a SECOND org B admin; with it active the
  // demotion below is legitimately allowed (and did demote adminB in CI, cascading into the
  // errorlog tests). Make adminB org B's only admin first -- by SQL, where the guard still
  // holds because adminB remains.
  await sql(`update profiles set role = 'user' where org_id = $1 and role = 'admin' and id <> $2`, [ORG_B, id]);
  const [{ n }] = await sql(`select count(*)::int as n from profiles where org_id = $1 and role = 'admin' and not disabled`, [ORG_B]);
  assert(n === 1, `setup: org B should have exactly one admin, has ${n}`);
  const [{ na }] = await sql(`select count(*)::int as na from profiles where org_id = $1 and role = 'admin' and not disabled`, [ORG_A]);
  assert(na >= 1, "setup: org A must have an admin for the per-org claim to mean anything");
  const { error } = await sessions.adminB.from("profiles").update({ role: "user" }).eq("id", id);
  const [{ role }] = await sql(`select role from profiles where id = $1`, [id]);
  // Never leave the shared adminB session demoted: later files depend on it.
  if (role !== "admin") await sql(`update profiles set role = 'admin' where id = $1`, [id]);
  // Self-demotion goes through the trigger, which raises -> PostgREST surfaces an error.
  assert(error && /at least one admin/i.test(error.message), `expected the per-org guard, got ${error && error.message}`);
  assert(role === "admin", "org B's last admin was demoted");
});

test("orgs: a member sees only their own org; the platform admin sees all", async () => {
  const { data: mine } = await sessions.userB.from("orgs").select("id,name");
  assert(mine.length === 1 && mine[0].id === ORG_B, `org B user saw ${JSON.stringify(mine)}`);
  const { data: all } = await sessions.platform.from("orgs").select("id");
  assert(all.length >= 2, "platform admin should see every org");
});

// ---------- Task 3: platform RPCs ----------
// All four are security definer, so RLS does not apply inside them. Each test below proves a
// refusal came from the function's own gate, and reads the result back by SQL.

// sessions.platform must end every test in ORG_A as a plain user (bootstrap's placement);
// later files count org membership. SQL has no auth.uid(), so guard_profile_org allows this.
async function restorePlatform() {
  await sql(`update profiles set org_id = $1, role = 'user'
             where id = (select id from auth.users where email = 'platform@test.local')`, [ORG_A]);
}

test("invite_user: an org admin invites into their own org only", async () => {
  const { error } = await sessions.admin.rpc("invite_user", { p_email: "  New.Person@Test.local ", p_role: "user" });
  assert(!error, error && error.message);
  const [inv] = await sql(`select org_id, role, email from invites where email = 'new.person@test.local'`);
  assert(inv && inv.org_id === ORG_A && inv.role === "user", `invite row wrong: ${JSON.stringify(inv)}`);
});

test("invite_user: a plain user cannot invite", async () => {
  const { error } = await sessions.user.rpc("invite_user", { p_email: "nope@test.local", p_role: "admin" });
  assert(error && /admin only/i.test(error.message), `expected admin-only refusal, got ${error && error.message}`);
  const rows = await sql(`select 1 from invites where email = 'nope@test.local'`);
  assert(rows.length === 0, "a plain user's invite landed");
});

test("invite_user: an org B admin's invite lands in org B, never org A", async () => {
  const { error } = await sessions.adminB.rpc("invite_user", { p_email: "fromb@test.local", p_role: "admin" });
  assert(!error, error && error.message);
  const rows = await sql(`select org_id from invites where email = 'fromb@test.local'`);
  assert(rows.length === 1 && rows[0].org_id === ORG_B, `org B admin's invite landed wrong: ${JSON.stringify(rows)}`);
});

test("invite_user: anonymous callers are refused", async () => {
  const { error } = await sessions.anon.rpc("invite_user", { p_email: "anon@test.local", p_role: "admin" });
  assert(error, "anon called invite_user");
  const rows = await sql(`select 1 from invites where email = 'anon@test.local'`);
  assert(rows.length === 0, "an anonymous invite landed");
});

test("invite_user: rejects a bad role and a malformed address", async () => {
  const { error: r } = await sessions.admin.rpc("invite_user", { p_email: "badrole@test.local", p_role: "owner" });
  assert(r && /role must be/i.test(r.message), `expected role refusal, got ${r && r.message}`);
  const { error: e } = await sessions.admin.rpc("invite_user", { p_email: "not an email", p_role: "user" });
  assert(e && /not a valid email/i.test(e.message), `expected email refusal, got ${e && e.message}`);
  const rows = await sql(`select 1 from invites where email in ('badrole@test.local', 'not an email')`);
  assert(rows.length === 0, "a rejected invite landed");
});

test("invite_user: re-inviting the same email replaces the role and re-opens the invite", async () => {
  await sessions.admin.rpc("invite_user", { p_email: "twice@test.local", p_role: "user" });
  await sql(`update invites set accepted_at = now() where email = 'twice@test.local'`);
  const { error } = await sessions.admin.rpc("invite_user", { p_email: "twice@test.local", p_role: "admin" });
  assert(!error, error && error.message);
  const [inv] = await sql(`select role, accepted_at from invites where email = 'twice@test.local' and org_id = $1`, [ORG_A]);
  assert(inv.role === "admin" && inv.accepted_at === null, `expected re-opened admin invite, got ${JSON.stringify(inv)}`);
});

// F2: the org_alert_prefs assertion moved to Task 5, which creates that table.
test("create_org: platform admin creates an org with settings and an admin invite", async () => {
  const { data: orgId, error } = await sessions.platform.rpc("create_org", { p_name: "Client C", p_admin_email: "Owner@ClientC.com" });
  assert(!error, error && error.message);
  const [org] = await sql(`select name from orgs where id = $1`, [orgId]);
  assert(org && org.name === "Client C", "org row missing");
  assert((await sql(`select 1 from settings where org_id = $1`, [orgId])).length === 1, "settings row missing");
  const [inv] = await sql(`select role from invites where org_id = $1 and email = 'owner@clientc.com'`, [orgId]);
  assert(inv && inv.role === "admin", "admin invite missing");
});

test("create_org: an org admin, a plain user and anon cannot create orgs", async () => {
  const { error: a } = await sessions.admin.rpc("create_org", { p_name: "Rogue A", p_admin_email: "r@r.com" });
  assert(a && /platform admin/i.test(a.message), `expected platform-admin refusal, got ${a && a.message}`);
  const { error: b } = await sessions.adminB.rpc("create_org", { p_name: "Rogue B", p_admin_email: "r@r.com" });
  assert(b && /platform admin/i.test(b.message), `expected platform-admin refusal, got ${b && b.message}`);
  const { error: u } = await sessions.user.rpc("create_org", { p_name: "Rogue U", p_admin_email: "r@r.com" });
  assert(u && /platform admin/i.test(u.message), `expected platform-admin refusal, got ${u && u.message}`);
  const { error: n } = await sessions.anon.rpc("create_org", { p_name: "Rogue N", p_admin_email: "r@r.com" });
  assert(n, "anon called create_org");
  const rows = await sql(`select 1 from orgs where name like 'Rogue%'`);
  assert(rows.length === 0, "a refused create_org still created an org");
});

test("create_org: rejects a malformed admin address", async () => {
  const { error } = await sessions.platform.rpc("create_org", { p_name: "Bad Mail Co", p_admin_email: "nope" });
  assert(error && /not a valid email/i.test(error.message), `expected email refusal, got ${error && error.message}`);
  assert((await sql(`select 1 from orgs where name = 'Bad Mail Co'`)).length === 0, "org created despite a bad address");
});

test("switch_org: platform admin moves into org B and sees its rows; others cannot", async () => {
  await seedAccount("sw-b", { name: "Switch B" }, ORG_B);
  try {
    const { error: denied } = await sessions.admin.rpc("switch_org", { p_org_id: ORG_B });
    assert(denied && /platform admin/i.test(denied.message), "an org admin switched orgs");
    const { error: deniedB } = await sessions.adminB.rpc("switch_org", { p_org_id: ORG_A });
    assert(deniedB && /platform admin/i.test(deniedB.message), "org B's admin switched orgs");
    const { error: deniedU } = await sessions.user.rpc("switch_org", { p_org_id: ORG_B });
    assert(deniedU && /platform admin/i.test(deniedU.message), "a plain user switched orgs");
    const { error: deniedN } = await sessions.anon.rpc("switch_org", { p_org_id: ORG_B });
    assert(deniedN, "anon called switch_org");
    const moved = await sql(`select u.email, p.org_id from profiles p join auth.users u on u.id = p.id
                             where u.email in ('admin@test.local', 'adminb@test.local', 'user@test.local')`);
    const home = { "admin@test.local": ORG_A, "user@test.local": ORG_A, "adminb@test.local": ORG_B };
    assert(moved.length === 3, `setup: expected 3 bootstrap profiles, got ${moved.length}`);
    for (const m of moved) assert(m.org_id === home[m.email], `${m.email} was moved to ${m.org_id}`);

    const { error } = await sessions.platform.rpc("switch_org", { p_org_id: ORG_B });
    assert(!error, error && error.message);
    const { data } = await sessions.platform.from("accounts").select("id").eq("id", "sw-b");
    assert(data.length === 1, "platform admin does not see org B after switching");
    const { error: back } = await sessions.platform.rpc("switch_org", { p_org_id: ORG_A });
    assert(!back, back && back.message);
    const [p] = await sql(`select p.org_id from profiles p join auth.users u on u.id = p.id where u.email = 'platform@test.local'`);
    assert(p.org_id === ORG_A, "switching back to org A did not land");
  } finally {
    await restorePlatform();
  }
});

test("switch_org: refuses an unknown org", async () => {
  const { error } = await sessions.platform.rpc("switch_org", { p_org_id: "00000000-0000-0000-0000-00000000dead" });
  assert(error && /no such org/i.test(error.message), `expected no-such-org, got ${error && error.message}`);
  const [p] = await sql(`select p.org_id from profiles p join auth.users u on u.id = p.id where u.email = 'platform@test.local'`);
  assert(p.org_id === ORG_A, "a refused switch still moved the platform admin");
});

// F11: after a switch, replace_all empties and refills only the org switched into. replace_all
// is admin-gated and the platform admin is invited as a plain user (F1), so it is made an org
// B admin by SQL for this test only; restorePlatform puts it back as an org A user.
test("replace_all after switch_org touches only the new org's rows", async () => {
  await seedAccount("rs-keep-a", { name: "Keep A" }, ORG_A);
  await seedAccount("rs-old-b", { name: "Old B" }, ORG_B);
  const [{ data: settingsB }] = await sql(`select data from settings where org_id = $1`, [ORG_B]);
  try {
    const { error: sw } = await sessions.platform.rpc("switch_org", { p_org_id: ORG_B });
    assert(!sw, sw && sw.message);
    await sql(`update profiles set role = 'admin'
               where id = (select id from auth.users where email = 'platform@test.local')`);
    const { error } = await sessions.platform.rpc("replace_all",
      { payload: { accounts: [{ id: "rs-new-b", name: "New B" }], settings: settingsB } });
    assert(!error, `replace_all errored: ${error && error.message}`);
    const a = await sql(`select id from accounts where org_id = $1 and id = 'rs-keep-a'`, [ORG_A]);
    assert(a.length === 1, "replace_all in org B wiped org A's row");
    const b = (await sql(`select id from accounts where org_id = $1`, [ORG_B])).map(r => r.id);
    assert(b.includes("rs-new-b"), "replace_all did not insert into org B");
    assert(!b.includes("rs-old-b"), "replace_all did not replace org B's rows");
    const newA = await sql(`select 1 from accounts where org_id = $1 and id = 'rs-new-b'`, [ORG_A]);
    assert(newA.length === 0, "replace_all wrote into org A");
  } finally {
    await restorePlatform();
  }
});

test("list_orgs: platform admin gets every org with a user count; others are refused", async () => {
  const { data, error } = await sessions.platform.rpc("list_orgs");
  assert(!error, error && error.message);
  const a = data.find(o => o.id === ORG_A), b = data.find(o => o.id === ORG_B);
  assert(a && b, "both orgs listed");
  assert(b.users >= 2, `org B should count its two users, got ${b && b.users}`);
  const { error: denied } = await sessions.admin.rpc("list_orgs");
  assert(denied && /platform admin/i.test(denied.message), "an org admin listed all orgs");
  const { error: deniedB } = await sessions.adminB.rpc("list_orgs");
  assert(deniedB && /platform admin/i.test(deniedB.message), "org B's admin listed all orgs");
  const { error: deniedU } = await sessions.user.rpc("list_orgs");
  assert(deniedU && /platform admin/i.test(deniedU.message), "a plain user listed all orgs");
  const { error: deniedN } = await sessions.anon.rpc("list_orgs");
  assert(deniedN, "anon listed all orgs");
});

// ---------- Task 3 fix round 1: one open invite per address (I1), idempotent create_org (I2) ----------
test("invite_user: another org's admin cannot take over an address with an open invite", async () => {
  const { error: seed } = await sessions.admin.rpc("invite_user", { p_email: "held-a@test.local", p_role: "user" });
  assert(!seed, seed && seed.message);
  const before = await sql(`select org_id, role, created_at::text as c from invites where email = 'held-a@test.local'`);
  const { error } = await sessions.adminB.rpc("invite_user", { p_email: "Held-A@test.local", p_role: "admin" });
  assert(error && /open invite/i.test(error.message), `expected open-invite refusal, got ${error && error.message}`);
  const { error: c } = await sessions.adminB.rpc("invite_user", { p_email: "owner@clientc.com", p_role: "admin" });
  assert(c && /open invite/i.test(c.message), `Client C's owner invite was not protected: ${c && c.message}`);
  const after = await sql(`select org_id, role, created_at::text as c from invites where email = 'held-a@test.local'`);
  assert(JSON.stringify(after) === JSON.stringify(before) && after.length === 1 && after[0].org_id === ORG_A,
    `org A's invite changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  const owner = await sql(`select o.name from invites i join orgs o on o.id = i.org_id where i.email = 'owner@clientc.com'`);
  assert(owner.length === 1 && owner[0].name === "Client C", `Client C's invite changed: ${JSON.stringify(owner)}`);
  // A same-org re-invite may still change the role.
  const { error: same } = await sessions.admin.rpc("invite_user", { p_email: "held-a@test.local", p_role: "admin" });
  assert(!same, same && same.message);
  const [r] = await sql(`select role from invites where email = 'held-a@test.local' and org_id = $1`, [ORG_A]);
  assert(r.role === "admin", "same-org re-invite did not update the role");
});

test("invites_insert: an org B admin cannot insert a second open invite for a held address", async () => {
  const { error } = await sessions.adminB.from("invites").insert({ email: "held-a@test.local", org_id: ORG_B, role: "admin" });
  assert(error, "a direct insert created a second open invite");
  const rows = await sql(`select org_id from invites where lower(email) = 'held-a@test.local'`);
  assert(rows.length === 1 && rows[0].org_id === ORG_A, `invites now ${JSON.stringify(rows)}`);
});

test("create_org: a retry with the same name errors and makes one org; the owner signs up into it", async () => {
  const args = { p_name: "Client D", p_admin_email: "owner@clientd.com" };
  const { data: orgId, error } = await sessions.platform.rpc("create_org", args);
  assert(!error, error && error.message);
  const { error: again } = await sessions.platform.rpc("create_org", args);
  assert(again && /already exists/i.test(again.message), `expected duplicate refusal, got ${again && again.message}`);
  const { error: cased } = await sessions.platform.rpc("create_org", { p_name: " client d ", p_admin_email: "other@clientd.com" });
  assert(cased && /already exists/i.test(cased.message), `expected case-insensitive refusal, got ${cased && cased.message}`);
  const { error: held } = await sessions.platform.rpc("create_org", { p_name: "Client D2", p_admin_email: "owner@clientd.com" });
  assert(held && /open invite/i.test(held.message), `expected open-invite refusal, got ${held && held.message}`);
  const orgs = await sql(`select id from orgs where lower(name) in ('client d', 'client d2')`);
  assert(orgs.length === 1 && orgs[0].id === orgId, `expected exactly one Client D org, got ${JSON.stringify(orgs)}`);
  const invs = await sql(`select org_id from invites where email in ('owner@clientd.com', 'other@clientd.com')`);
  assert(invs.length === 1 && invs[0].org_id === orgId, `invites ${JSON.stringify(invs)}`);
  const { id } = await signUpFresh("owner@clientd.com", "Owner D");
  assert(await orgOf(id) === orgId, "the owner did not land in the org create_org made");
  const [p] = await sql(`select role from profiles where id = $1`, [id]);
  assert(p.role === "admin", `owner should be admin, got ${p.role}`);
});

// I1: handle_new_user() fires only for a NEW login, so invite_user must attach an address
// that already has an org-less login, or the admin's "add user" silently does nothing.
test("invite_user: an existing org-less login is attached to the caller's org and reads its data", async () => {
  const { client, id } = await signUpFresh("orgless.existing@test.local");
  await seedAccount("attach-a", { name: "A sees this" }, ORG_A);
  const { data: before } = await client.from("accounts").select("id").eq("id", "attach-a");
  assert(before.length === 0, "an org-less login read org A data before being attached");
  const { data, error } = await sessions.admin.rpc("invite_user", { p_email: "Orgless.Existing@test.local", p_role: "user" });
  assert(!error, error && error.message);
  assert(data === "attached", `expected 'attached', got ${JSON.stringify(data)}`);
  assert((await orgOf(id)) === ORG_A, "profile was not attached to org A");
  const [inv] = await sql(`select accepted_at from invites where email = 'orgless.existing@test.local' and org_id = $1`, [ORG_A]);
  assert(inv && inv.accepted_at, "attach left an OPEN invite behind");
  const { data: after, error: e2 } = await client.from("accounts").select("id").eq("id", "attach-a");
  assert(!e2 && after.length === 1, `attached user cannot read org A data: ${JSON.stringify(after)} ${e2 && e2.message}`);
});

test("invite_user: a login already in another org is refused and leaves no invite", async () => {
  const { id } = await signUpFresh("taken.elsewhere@test.local");
  await sql(`update profiles set org_id = $1 where id = $2`, [ORG_B, id]);
  const { data, error } = await sessions.admin.rpc("invite_user", { p_email: "taken.elsewhere@test.local", p_role: "admin" });
  assert(error && /belongs to another workspace/i.test(error.message), `expected refusal, got ${error && error.message} / ${data}`);
  assert((await orgOf(id)) === ORG_B, "the other org's user was moved");
  const rows = await sql(`select 1 from invites where email = 'taken.elsewhere@test.local'`);
  assert(rows.length === 0, "a refused invite left a row behind");
});

test("invite_user: a brand-new address still gets an open invite and returns 'invited'", async () => {
  const { data, error } = await sessions.admin.rpc("invite_user", { p_email: "brand.new@test.local", p_role: "user" });
  assert(!error && data === "invited", `got ${JSON.stringify(data)} ${error && error.message}`);
  const [inv] = await sql(`select accepted_at from invites where email = 'brand.new@test.local'`);
  assert(inv && inv.accepted_at === null, "no open invite for a new address");
});

test("guard_profile_org: a client still cannot set its own org_id, even an org-less one", async () => {
  const { client, id } = await signUpFresh("selfattach@test.local");
  await client.from("profiles").update({ org_id: ORG_A }).eq("id", id);
  assert((await orgOf(id)) === null, "an org-less user attached themselves");
});
