// Lead role (spec 2026-10-13 PR 3). Every "cannot" is paired with a "can" on the same session.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, invitedFresh, seedRow } from "./fixtures.mjs";

let lead = null;   // { client, id } — a restricted lead in org A
const mkLead = async () => {
  if (lead) return lead;
  lead = await invitedFresh("lead1@test.local");
  await sql(`update profiles set role = 'lead', name = 'Lead One' where id = $1`, [lead.id]);
  return lead;
};
const ids = async (client, table) => ((await client.from(table).select("id")).data || []).map(r => r.id).sort();
const merge = (client, tbl, row_id, patch) => client.rpc("merge_row", { tbl, row_id, patch, appends: {} });
const clean = () => sql(`delete from public.accounts where id like 'ld-%'; delete from public.contacts where id like 'ld-%';
  delete from public.tasks where id like 'ld-%'; delete from public.activities where id like 'ld-%'; delete from public.opportunities where id like 'ld-%'`);

async function world(l) {
  await seedRow("accounts", "ld-mine", { name: "Mine", leadId: l.id });
  await seedRow("accounts", "ld-other", { name: "Other" });
  await seedRow("contacts", "ld-c-mine", { accountId: "ld-mine", name: "A" });
  await seedRow("contacts", "ld-c-other", { accountId: "ld-other", name: "B" });
  await seedRow("tasks", "ld-t-own", { title: "no account, mine", owner: "Lead One" });
  await seedRow("tasks", "ld-t-else", { title: "no account, theirs", owner: "Admin User" });
}

test("a restricted lead sees only their accounts and those accounts' children", async () => {
  const l = await mkLead();
  try {
    await world(l);
    const acc = (await ids(l.client, "accounts")).filter(i => i.startsWith("ld-"));
    assert(JSON.stringify(acc) === '["ld-mine"]', "lead accounts: " + JSON.stringify(acc));
    const con = (await ids(l.client, "contacts")).filter(i => i.startsWith("ld-"));
    assert(JSON.stringify(con) === '["ld-c-mine"]', "lead contacts: " + JSON.stringify(con));
    const tk = (await ids(l.client, "tasks")).filter(i => i.startsWith("ld-"));
    assert(JSON.stringify(tk) === '["ld-t-own"]', "lead tasks: " + JSON.stringify(tk));
    const userSees = (await ids(sessions.user, "accounts")).filter(i => i.startsWith("ld-"));
    assert(userSees.length === 2, "control: a CSM must still see every account: " + JSON.stringify(userSees));
  } finally { await clean(); }
});

test("lead edits own account; cannot edit, create or re-point others", async () => {
  const l = await mkLead();
  try {
    await world(l);
    const ok = await merge(l.client, "accounts", "ld-mine", { arr: 5 });
    assert(!ok.error, "lead edit of own account failed: " + ok.error?.message);
    const other = await merge(l.client, "accounts", "ld-other", { arr: 5 });
    assert(other.error, "lead edited an account they cannot see");
    const created = await merge(l.client, "accounts", "ld-new", { name: "New" });
    assert(created.error && /Leads cannot create accounts/.test(created.error.message), "lead created an account: " + JSON.stringify(created));
    const child = await merge(l.client, "contacts", "ld-c-new", { accountId: "ld-other", name: "X" });
    assert(child.error && /only add records to your own accounts/.test(child.error.message), "lead attached a contact to an invisible account: " + JSON.stringify(child));
    const repoint = await merge(l.client, "contacts", "ld-c-mine", { accountId: "ld-other" });
    assert(repoint.error, "lead re-pointed own contact to an invisible account");
    const childOk = await merge(l.client, "contacts", "ld-c-new2", { accountId: "ld-mine", name: "Y" });
    assert(!childOk.error, "control: lead adding a contact to own account failed: " + childOk.error?.message);
  } finally { await clean(); }
});

test("a lead with finance access sees every account", async () => {
  const l = await mkLead();
  try {
    await world(l);
    await sql(`update profiles set finance = true where id = $1`, [l.id]);
    const acc = (await ids(l.client, "accounts")).filter(i => i.startsWith("ld-"));
    assert(acc.length === 2, "finance lead accounts: " + JSON.stringify(acc));
  } finally { await sql(`update profiles set finance = false where id = $1`, [lead.id]); await clean(); }
});

test("invite_user accepts the lead role", async () => {
  const r = await sessions.admin.rpc("invite_user", { p_email: "lead-invite@test.local", p_role: "lead" });
  try { assert(!r.error, "invite as lead failed: " + r.error?.message); }
  finally { await sql(`delete from invites where email = 'lead-invite@test.local'`); }
});
