// Lead role (spec 2026-10-13 PR 3). Every "cannot" is paired with a "can" on the same session.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, invitedFresh, seedRow, ORG_A } from "./fixtures.mjs";

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
  await seedRow("activities", "ld-a-mine", { accountId: "ld-mine", type: "call" });
  await seedRow("opportunities", "ld-o-mine", { accountId: "ld-mine", name: "Opp" });
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
    for (const [tbl, id] of [["contacts", "ld-c-mine"], ["activities", "ld-a-mine"], ["opportunities", "ld-o-mine"], ["tasks", "ld-t-own"]]) {
      const e = await merge(l.client, tbl, id, { name: "x" });   // patch lacks accountId/owner
      assert(!e.error, `lead edit of own ${tbl} ${id} failed: ` + e.error?.message);
    }
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

// ---- health snapshots, finance tables, storage ----
const cleanFin = () => sql(`delete from invoices where account_id like 'ld-%'; delete from po_schedule where po_id in
  (select id from purchase_orders where account_id like 'ld-%'); delete from purchase_orders where account_id like 'ld-%';
  delete from billing_entities where invoice_prefix = 'LD-'; delete from health_snapshots where account_id like 'ld-%'`);
const finWorld = async (l) => {
  await seedRow("accounts", "ld-mine", { name: "Mine", leadId: l.id });
  await seedRow("accounts", "ld-other", { name: "Other" });
  const [adm] = await sql(`select id from profiles where org_id = $1 and role = 'admin' limit 1`, [ORG_A]);
  const [ent] = await sql(`insert into billing_entities (org_id, name, country, currency, invoice_prefix)
    values ($1, 'LD Entity', 'IN', 'INR', 'LD-') returning id`, [ORG_A]);
  const out = {};
  for (const acc of ["ld-mine", "ld-other"]) {
    const [po] = await sql(`insert into purchase_orders (org_id, account_id, account_name, po_number, po_date, po_value, currency,
      years, billing_cycle, billing_start, file_path, status, submitted_by) values ($1, $2, $2, $3, '2026-10-01', 100, 'INR', 1,
      'annual', '2026-01-01', $4, 'approved', $5) returning id`, [ORG_A, acc, "LDPO-" + acc, `${ORG_A}/${acc}/po.pdf`, adm.id]);
    const [si] = await sql(`insert into po_schedule (org_id, po_id, seq, period_start, period_end, amount)
      values ($1, $2, 1, '2026-01-01', '2026-12-31', 100) returning id`, [ORG_A, po.id]);
    const [inv] = await sql(`insert into invoices (org_id, po_id, schedule_id, account_id, account_name, entity_id, number, issue_date,
      due_date, currency, total, pdf_path, created_by) values ($1, $2, $3, $4, $4, $5, $6, '2026-10-01', '2026-10-31', 'INR', 100, $7, $8)
      returning id`, [ORG_A, po.id, si.id, acc, ent.id, "LD-" + acc, `${ORG_A}/ld-inv-${acc}.pdf`, adm.id]);
    out[acc] = { po: po.id, si: si.id, inv: inv.id };
  }
  return out;
};
const colOf = async (client, table, col = "id") => ((await client.from(table).select(col)).data || []).map(r => r[col]);

test("a restricted lead sees health snapshots only for their accounts", async () => {
  const l = await mkLead();
  try {
    await seedRow("accounts", "ld-mine", { name: "Mine", leadId: l.id });
    await seedRow("accounts", "ld-other", { name: "Other" });
    await sql(`insert into health_snapshots (org_id, account_id, score) values ($1, 'ld-mine', 70), ($1, 'ld-other', 40)`, [ORG_A]);
    const seen = (await colOf(l.client, "health_snapshots", "account_id")).filter(i => i.startsWith("ld-")).sort();
    assert(JSON.stringify(seen) === '["ld-mine"]', "lead snapshots: " + JSON.stringify(seen));
    const ctl = (await colOf(sessions.user, "health_snapshots", "account_id")).filter(i => i.startsWith("ld-"));
    assert(ctl.length === 2, "control: a CSM sees both snapshots: " + JSON.stringify(ctl));
  } finally { await cleanFin(); await clean(); }
});

test("a restricted lead sees POs, schedules and invoices only for their accounts; finance lead sees both", async () => {
  const l = await mkLead();
  try {
    const w = await finWorld(l);
    const all = new Set([...Object.values(w["ld-mine"]), ...Object.values(w["ld-other"])]);
    const pick = async (client, t) => (await colOf(client, t)).filter(i => all.has(i)).sort();
    for (const [t, k] of [["purchase_orders", "po"], ["po_schedule", "si"], ["invoices", "inv"]]) {
      const got = await pick(l.client, t);
      assert(JSON.stringify(got) === JSON.stringify([w["ld-mine"][k]]), `lead ${t}: ` + JSON.stringify(got));
    }
    // plain insert: a restricted lead cannot submit a PO for an account they do not own; can for their own
    const base = { account_name: "x", po_date: "2026-10-01", po_value: 10, currency: "INR", years: 1, billing_cycle: "annual",
      billing_start: "2026-01-01", status: "submitted", submitted_by: l.id };
    const bad = await l.client.from("purchase_orders").insert({ ...base, account_id: "ld-other", po_number: "LDX-1", file_path: `${ORG_A}/ld-other/x.pdf` });
    assert(bad.error, "lead submitted a PO for an account they do not own");
    const ok = await l.client.from("purchase_orders").insert({ ...base, account_id: "ld-mine", po_number: "LDX-2", file_path: `${ORG_A}/ld-mine/x.pdf` });
    assert(!ok.error, "control: lead PO on own account failed: " + ok.error?.message);
    await sql(`update profiles set finance = true where id = $1`, [l.id]);
    for (const t of ["purchase_orders", "po_schedule", "invoices"]) {
      const got = await pick(l.client, t);
      assert(got.length === 2, `finance lead ${t}: ` + JSON.stringify(got));
    }
  } finally { await sql(`update profiles set finance = false where id = $1`, [lead.id]); await cleanFin(); await clean(); }
});

test("restricted lead storage: attachments and invoice PDFs scoped to own accounts", async () => {
  const l = await mkLead();
  const txt = () => new Blob(["x"], { type: "text/plain" });
  const pdf = () => new Blob(["%PDF-1.4"], { type: "application/pdf" });
  const att = [`${ORG_A}/ld-mine/a.txt`, `${ORG_A}/ld-other/b.txt`];
  const invp = [`${ORG_A}/ld-inv-ld-mine.pdf`, `${ORG_A}/ld-inv-ld-other.pdf`];
  try {
    await finWorld(l);
    for (const p of att) { const r = await sessions.admin.storage.from("attachments").upload(p, txt(), { upsert: true }); assert(!r.error, "seed upload: " + r.error?.message); }
    for (const p of invp) { const r = await sessions.admin.storage.from("invoices").upload(p, pdf(), { upsert: true }); assert(!r.error, "seed invoice: " + r.error?.message); }
    const ls = async (pre) => { const { data, error } = await l.client.storage.from("attachments").list(pre); assert(!error, "list: " + error?.message); return (data || []).map(f => f.name); };
    assert((await ls(`${ORG_A}/ld-mine`)).includes("a.txt"), "control: lead must list own account's attachment");
    const other = await ls(`${ORG_A}/ld-other`);
    assert(other.length === 0, "lead listed another account's attachments: " + JSON.stringify(other));
    const up = await l.client.storage.from("attachments").upload(`${ORG_A}/ld-other/c.txt`, txt());
    assert(up.error, "lead uploaded into another account's folder");
    const dl = await l.client.storage.from("invoices").download(invp[0]);
    assert(!dl.error, "control: lead download of own invoice PDF failed: " + dl.error?.message);
    const dl2 = await l.client.storage.from("invoices").download(invp[1]);
    assert(dl2.error, "lead downloaded another account's invoice PDF");
  } finally {
    await sessions.admin.storage.from("attachments").remove([...att, `${ORG_A}/ld-other/c.txt`]);
    await sessions.admin.storage.from("invoices").remove(invp);
    await cleanFin(); await clean();
  }
});

test("finance RPCs refuse a restricted lead (no finance flag)", async () => {
  const l = await mkLead();
  try {
    const w = await finWorld(l);
    const o = w["ld-other"];
    for (const [fn, args] of [["approve_po", { p_id: o.po, p_amounts: null, p_confirm_mismatch: false }],
        ["reject_po", { p_id: o.po, p_reason: "x" }], ["cancel_po", { p_id: o.po }],
        ["create_invoice", { p: { schedule_id: o.si } }],
        ["set_invoice_status", { p_id: o.inv, p_status: "waived", p_paid_date: null, p_ref: null, p_reason: "x" }],
        ["attach_invoice_pdf", { p_id: o.inv, p_path: `${ORG_A}/z.pdf` }],
        ["send_invoice", { p_id: o.inv, p_pdf_base64: "eA==" }]]) {
      const r = await l.client.rpc(fn, args);
      assert(/finance access required/.test(r.error?.message || ""), `${fn} not refused: ` + JSON.stringify(r.error));
    }
    const ok = await sessions.admin.rpc("set_invoice_status", { p_id: o.inv, p_status: "pending", p_paid_date: null, p_ref: null, p_reason: null });
    assert(!ok.error, "control: admin set_invoice_status failed: " + ok.error?.message);
  } finally { await cleanFin(); await clean(); }
});
