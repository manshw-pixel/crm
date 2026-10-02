// Client disable = full lockout. Every absence assertion is preceded by a positive control
// on the same session (see rls-anon-key-vacuity), and every test re-enables in `finally`
// because tests/rls has no per-test reset.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, seedAccount, valueOf, orgOf, ORG_A, ORG_B } from "./fixtures.mjs";

const setDisabled = (org, d) => sql(`update public.orgs set disabled = $2 where id = $1`, [org, d]);
async function whileDisabled(org, fn) {
  await setDisabled(org, true);
  try { await fn(); } finally { await setDisabled(org, false); }
}
const TABLES = ["accounts", "contacts", "activities", "tasks", "opportunities", "settings"];

test("a disabled org's user reads and writes nothing; other orgs are untouched; re-enable restores", async () => {
  await seedAccount("dis-b", { name: "B row" }, ORG_B);
  await seedAccount("dis-a", { name: "A row" }, ORG_A);
  const before = await sessions.userB.from("accounts").select("id").eq("id", "dis-b");
  assert(before.data?.length === 1, `precondition: org B user cannot read its own row (${before.error?.message})`);
  await whileDisabled(ORG_B, async () => {
    for (const t of TABLES) {
      const { data } = await sessions.userB.from(t).select("*");
      assert((data || []).length === 0, `${t}: a disabled org's user still reads rows`);
    }
    const ins = await sessions.userB.from("tasks").insert({ id: "dis-t", data: { title: "x" } });
    assert(ins.error, "a disabled org's user inserted a task");
    const m = await sessions.userB.rpc("merge_row", { tbl: "accounts", row_id: "dis-b", patch: { name: "hacked" }, appends: {} });
    assert(m.error, "merge_row succeeded for a disabled org's user");
    assert((await valueOf("accounts", "dis-b", ORG_B)).name === "B row", "a disabled org's row was changed");
    const h = await sessions.userB.rpc("record_health", { p_scores: [{ accountId: "dis-b", score: 1 }] });
    assert(h.error || h.data === 0, `record_health wrote for a disabled org: ${JSON.stringify(h.data)}`);
    const other = await sessions.user.from("accounts").select("id").eq("id", "dis-a");
    assert(other.data?.length === 1, "disabling org B locked out org A");
  });
  const after = await sessions.userB.from("accounts").select("id").eq("id", "dis-b");
  assert(after.data?.length === 1, "re-enabling did not restore access");
});

test("a disabled org's ADMIN cannot write settings, update profiles, invite or list users", async () => {
  const pre = await sessions.adminB.rpc("admin_user_list");
  assert(!pre.error && pre.data.length >= 1, `precondition: org B admin cannot list users (${pre.error?.message})`);
  await whileDisabled(ORG_B, async () => {
    const list = await sessions.adminB.rpc("admin_user_list");
    assert(list.error || (list.data || []).length === 0, "admin_user_list answered for a disabled org");
    const inv = await sessions.adminB.rpc("invite_user", { p_email: "dis-invite@test.local", p_role: "user" });
    assert(inv.error, "invite_user succeeded for a disabled org");
    await sessions.adminB.from("settings").update({ data: { marker: "dis" } }).eq("org_id", ORG_B);
    const s = await sql(`select data from settings where org_id = $1`, [ORG_B]);
    assert(s[0]?.data?.marker !== "dis", "a disabled org's admin wrote settings");
    await sessions.adminB.from("profiles").update({ name: "Renamed by disabled admin" }).eq("org_id", ORG_B).eq("role", "user");
    const p = await sql(`select 1 from profiles where name = 'Renamed by disabled admin'`);
    assert(p.length === 0, "a disabled org's admin updated a profile");
  });
});

test("the platform admin keeps access inside a disabled org, including a disabled home org", async () => {
  const { platformId } = await sql(`select id as "platformId" from profiles where platform_admin`).then(r => r[0]);
  const home = await orgOf(platformId);
  await seedAccount("dis-pa", { name: "Seen by platform" }, ORG_B);
  try {
    await sql(`update profiles set org_id = $2 where id = $1`, [platformId, ORG_B]);
    await whileDisabled(ORG_B, async () => {
      const r = await sessions.platform.from("accounts").select("id").eq("id", "dis-pa");
      assert(r.data?.length === 1, `platform admin lost access to a disabled org (${r.error?.message})`);
    });
    await sql(`update profiles set org_id = $2 where id = $1`, [platformId, ORG_A]);
    await seedAccount("dis-home", { name: "Home row" }, ORG_A);
    await whileDisabled(ORG_A, async () => {
      const r = await sessions.platform.from("accounts").select("id").eq("id", "dis-home");
      assert(r.data?.length === 1, "disabling the home org locked out the platform admin");
      const l = await sessions.platform.rpc("list_orgs");
      assert(!l.error && l.data.find(o => o.id === ORG_A)?.disabled === true, `list_orgs: ${JSON.stringify(l.data || l.error)}`);
    });
  } finally {
    await sql(`update profiles set org_id = $2 where id = $1`, [platformId, home]);
  }
});

test("set_org_disabled works for the platform admin only, and a locked-out user can read the flag", async () => {
  const refused = await sessions.adminB.rpc("set_org_disabled", { p_org_id: ORG_B, p_disabled: true });
  assert(refused.error && /platform admin only/.test(refused.error.message), `org admin not refused: ${JSON.stringify(refused)}`);
  assert((await sql(`select disabled from orgs where id = $1`, [ORG_B]))[0].disabled === false, "the refused call changed the flag");
  try {
    const ok = await sessions.platform.rpc("set_org_disabled", { p_org_id: ORG_B, p_disabled: true });
    assert(!ok.error, `platform admin refused: ${ok.error?.message}`);
    const flag = await sessions.userB.from("orgs").select("disabled").eq("id", ORG_B).single();
    assert(flag.data?.disabled === true, `locked-out user cannot read their org flag: ${JSON.stringify(flag)}`);
    const back = await sessions.platform.rpc("set_org_disabled", { p_org_id: ORG_B, p_disabled: false });
    assert(!back.error, back.error?.message);
    assert((await sql(`select disabled from orgs where id = $1`, [ORG_B]))[0].disabled === false, "re-enable did not land");
    const none = await sessions.platform.rpc("set_org_disabled", { p_org_id: "00000000-0000-0000-0000-0000000000ff", p_disabled: true });
    assert(none.error && /no such org/.test(none.error.message), "unknown org not refused");
  } finally { await setDisabled(ORG_B, false); }
});

test("the email dispatcher's org list skips a disabled org", async () => {
  const pre = await sql(`select org_id from public.alert_orgs()`);
  assert(pre.some(r => r.org_id === ORG_B), "precondition: org B has no alert prefs, so this test proves nothing");
  await whileDisabled(ORG_B, async () => {
    const rows = await sql(`select org_id from public.alert_orgs()`);
    assert(!rows.some(r => r.org_id === ORG_B), "alert_orgs still returns a disabled org");
    assert(rows.some(r => r.org_id === ORG_A), "alert_orgs dropped an enabled org");
  });
});
