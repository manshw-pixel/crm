// Tenant isolation. Every "cannot see" assertion is paired with a "can see own" control in
// the same test, so a policy that returns nothing to anyone would fail loudly rather than
// pass vacuously (the lesson of the anon-key incident in fixtures.mjs).
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, seedAccount, valueOf, ORG_A, ORG_B } from "./fixtures.mjs";

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
