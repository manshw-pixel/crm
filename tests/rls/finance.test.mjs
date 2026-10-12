// tests/rls/finance.test.mjs
import assert from "node:assert/strict";
import { test } from "../health/framework.mjs";
import { sessions, sql, ORG_A, invitedFresh } from "./fixtures.mjs";

let entityId, finUser, poId, items = [];
const nextItem = () => items.shift();
const P = (o = {}) => ({ schedule_id: o.schedule_id ?? nextItem(), entity_id: entityId, issue_date: "2026-10-12", due_date: "2026-11-11",
  line_items: [{ description: "Seat", qty: 1, rate: 100, amount: 100 }], subtotal: 100, tax_lines: [], tax_note: null, total: 100,
  sent_to: "ap@acme.test", sent_cc: null, ...o });
const PO = (o = {}) => ({ account_id: "a1", account_name: "Acme", po_number: "PO-" + Math.random().toString(36).slice(2, 8),
  po_date: "2026-10-01", po_value: 800, currency: "INR", years: 2, billing_cycle: "quarterly", billing_start: "2026-01-31",
  file_path: `${ORG_A}/po-test.pdf`, ...o });

test("finance: admin creates a billing entity; plain user cannot", async () => {
  const { data, error } = await sessions.admin.from("billing_entities").insert({ name: "OneVio India", country: "IN", state: "Maharashtra",
    currency: "INR", tax_id: "27ABCDE1234F1Z5", invoice_prefix: "IN-", default_tax_pct: 18 }).select().single();
  assert.ifError(error); entityId = data.id;
  const bad = await sessions.user.from("billing_entities").insert({ name: "x", country: "US", currency: "USD", invoice_prefix: "X-" });
  assert.ok(bad.error, "plain user must not insert entities");
});

test("finance: plain user can READ entities (precondition for the refusals below)", async () => {
  const { data, error } = await sessions.user.from("billing_entities").select("id").eq("id", entityId);
  assert.ifError(error); assert.equal(data.length, 1);
});

test("po: CSM submits; CSM cannot approve or self-approve via update", async () => {
  const me = (await sessions.user.auth.getUser()).data.user.id;
  const { data, error } = await sessions.user.from("purchase_orders").insert({ ...PO(), submitted_by: me }).select().single();
  assert.ifError(error); poId = data.id; assert.equal(data.status, "submitted");
  const r = await sessions.user.rpc("approve_po", { p_id: poId, p_amounts: null, p_confirm_mismatch: false });
  assert.match(r.error?.message || "", /finance access required/);
  const u = await sessions.user.from("purchase_orders").update({ status: "approved" }).eq("id", poId).select("id");
  assert.ok(u.error || (u.data || []).length === 0, "direct status change must be refused");
  const [row] = await sql("select status from purchase_orders where id = $1", [poId]);
  assert.equal(row.status, "submitted");
});

test("po: invoice refused while the PO is only submitted", async () => {
  // schedule rows don't exist yet, so there is nothing to raise: prove it with a random id
  const r = await sessions.admin.rpc("create_invoice", { p: P({ schedule_id: "00000000-0000-0000-0000-0000000000aa" }) });
  assert.match(r.error?.message || "", /schedule item not found/);
});

test("po: amounts must match unless confirmed; approve builds 8 anchored periods", async () => {
  const bad = await sessions.admin.rpc("approve_po", { p_id: poId, p_amounts: [100,100,100,100,100,100,100,50], p_confirm_mismatch: false });
  assert.match(bad.error?.message || "", /do not add up/);
  const short = await sessions.admin.rpc("approve_po", { p_id: poId, p_amounts: [400, 400], p_confirm_mismatch: true });
  assert.match(short.error?.message || "", /expected 8 amounts/);
  const ok = await sessions.admin.rpc("approve_po", { p_id: poId, p_amounts: null, p_confirm_mismatch: false });
  assert.ifError(ok.error); assert.equal(ok.data.status, "approved");
  const rows = await sql("select id, seq, period_start::text ps, period_end::text pe, amount from po_schedule where po_id = $1 order by seq", [poId]);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.slice(0, 3).map(r => r.ps), ["2026-01-31", "2026-04-30", "2026-07-31"]);   // same as lib buildSchedule
  assert.equal(rows[0].pe, "2026-04-29");
  assert.equal(rows.reduce((s, r) => s + Number(r.amount), 0), 800);
  items = rows.map(r => r.id);
});

test("po: rejected needs a reason; CSM can edit and resubmit a rejected PO", async () => {
  const me = (await sessions.user.auth.getUser()).data.user.id;
  const { data } = await sessions.user.from("purchase_orders").insert({ ...PO(), submitted_by: me }).select().single();
  const r0 = await sessions.admin.rpc("reject_po", { p_id: data.id, p_reason: " " });
  assert.match(r0.error?.message || "", /reject reason required/);
  const r1 = await sessions.admin.rpc("reject_po", { p_id: data.id, p_reason: "Wrong value" });
  assert.ifError(r1.error); assert.equal(r1.data.status, "rejected");
  const re = await sessions.user.from("purchase_orders").update({ po_value: 900, status: "submitted", reviewed_by: null, reject_reason: null })
    .eq("id", data.id).select("status, po_value").single();
  assert.ifError(re.error); assert.equal(re.data.status, "submitted"); assert.equal(Number(re.data.po_value), 900);
});

test("po: approved PO is locked against CSM edits", async () => {
  const u = await sessions.user.from("purchase_orders").update({ po_value: 1, status: "submitted" }).eq("id", poId).select("id");
  assert.equal((u.data || []).length, 0);
  const [row] = await sql("select po_value, status from purchase_orders where id = $1", [poId]);
  assert.equal(Number(row.po_value), 800); assert.equal(row.status, "approved");
});

test("po: another CSM cannot edit or take over someone else's submitted PO", async () => {
  const owner = (await sessions.user.auth.getUser()).data.user.id;
  const { data } = await sessions.user.from("purchase_orders").insert({ ...PO(), submitted_by: owner }).select().single();
  const other = await invitedFresh("fin-other-csm@test.local");
  const otherId = (await other.client.auth.getUser()).data.user.id;
  await other.client.from("purchase_orders").update({ po_value: 1 }).eq("id", data.id);
  await other.client.from("purchase_orders").update({ submitted_by: otherId }).eq("id", data.id);
  const [row] = await sql("select po_value, submitted_by from purchase_orders where id = $1", [data.id]);
  assert.equal(Number(row.po_value), Number(data.po_value));
  assert.equal(row.submitted_by, owner);
});

test("finance: plain user without the flag cannot create_invoice", async () => {
  const { error } = await sessions.user.rpc("create_invoice", { p: P() });
  assert.match(error?.message || "", /finance access required/);
});

test("finance: admin toggles finance on; user can then create, numbers are sequential", async () => {
  const me = (await sessions.user.auth.getUser()).data.user.id; finUser = me;
  const up = await sessions.admin.from("profiles").update({ finance: true }).eq("id", me).select("finance").single();
  assert.ifError(up.error); assert.equal(up.data.finance, true);
  const a = await sessions.user.rpc("create_invoice", { p: P() });
  const b = await sessions.user.rpc("create_invoice", { p: P() });
  assert.ifError(a.error); assert.ifError(b.error);
  assert.equal(a.data.number, "IN-0001"); assert.equal(b.data.number, "IN-0002");
  assert.equal(a.data.currency, "INR"); assert.equal(a.data.status, "pending"); assert.equal(a.data.sent_at, null);
});

// guard_profile_finance is defence-in-depth: no non-admin update path reaches it, so only RLS is observable here.
test("finance: plain user cannot grant themselves the flag (RLS)", async () => {
  const me = (await sessions.user.auth.getUser()).data.user.id;
  await sessions.admin.from("profiles").update({ finance: false }).eq("id", me);
  const { data } = await sessions.user.from("profiles").update({ finance: true }).eq("id", me).select("finance");
  assert.equal((data || []).length, 0, "update must match no rows");
  const [row] = await sql("select finance from profiles where id = $1", [me]);
  assert.equal(row.finance, false);
});

test("finance: revoked flag takes effect on the live session", async () => {
  const { error } = await sessions.user.rpc("create_invoice", { p: P() });
  assert.match(error?.message || "", /finance access required/);
});

test("finance: the same schedule item cannot be raised twice", async () => {
  const [used] = await sql("select id from po_schedule where po_id = $1 and invoice_id is not null order by seq limit 1", [poId]);
  const r = await sessions.admin.rpc("create_invoice", { p: P({ schedule_id: used.id }) });
  assert.match(r.error?.message || "", /already invoiced/);
});

test("finance: entity currency must match the PO currency", async () => {
  const us = await sessions.admin.from("billing_entities").insert({ name: "OneVio US", country: "US", currency: "USD", invoice_prefix: "US-" }).select().single();
  const r = await sessions.admin.rpc("create_invoice", { p: P({ entity_id: us.data.id, schedule_id: items[0] }) });
  assert.match(r.error?.message || "", /does not match PO currency/);
});

test("finance storage: admin uploads an invoice PDF; flagless user cannot; user can download; other org cannot", async () => {
  const body = () => new Blob(["%PDF-1.4"], { type: "application/pdf" });
  const path = `${ORG_A}/t.pdf`;
  const up = await sessions.admin.storage.from("invoices").upload(path, body(), { upsert: true });
  assert.ifError(up.error);
  const bad = await sessions.user.storage.from("invoices").upload(`${ORG_A}/u.pdf`, body());
  assert.ok(bad.error, "user without the flag must not upload invoices");
  const dl = await sessions.user.storage.from("invoices").download(path);
  assert.ifError(dl.error);
  const other = await sessions.adminB.storage.from("invoices").download(path);
  assert.ok(other.error, "another org must not read the invoice");
});


test("finance: mark paid needs a date; waive needs a reason; plain user refused", async () => {
  const [inv] = await sql("select id from invoices where number = 'IN-0001' and entity_id = $1", [entityId]);
  const r1 = await sessions.admin.rpc("set_invoice_status", { p_id: inv.id, p_status: "paid", p_paid_date: null, p_ref: null, p_reason: null });
  assert.match(r1.error?.message || "", /paid date required/);
  const r2 = await sessions.admin.rpc("set_invoice_status", { p_id: inv.id, p_status: "waived", p_paid_date: null, p_ref: null, p_reason: "  " });
  assert.match(r2.error?.message || "", /waive reason required/);
  const r3 = await sessions.user.rpc("set_invoice_status", { p_id: inv.id, p_status: "paid", p_paid_date: "2026-10-12", p_ref: "UTR1", p_reason: null });
  assert.match(r3.error?.message || "", /finance access required/);
  const ok = await sessions.admin.rpc("set_invoice_status", { p_id: inv.id, p_status: "paid", p_paid_date: "2026-10-12", p_ref: "UTR1", p_reason: null });
  assert.ifError(ok.error); assert.equal(ok.data.status, "paid"); assert.equal(ok.data.payment_ref, "UTR1");
  const back = await sessions.admin.rpc("set_invoice_status", { p_id: inv.id, p_status: "pending", p_paid_date: null, p_ref: null, p_reason: null });
  assert.ifError(back.error); assert.equal(back.data.paid_date, null);
});

test("finance: amounts are immutable via direct update", async () => {
  const { data } = await sessions.admin.from("invoices").update({ total: 1 }).eq("number", "IN-0002").select("id");
  assert.equal((data || []).length, 0);
  const [row] = await sql("select total from invoices where number = 'IN-0002' and entity_id = $1", [entityId]);
  assert.equal(Number(row.total), 100);
});

test("finance: plain user reads invoices; other org sees none", async () => {
  const mine = await sessions.user.from("invoices").select("id").eq("entity_id", entityId);
  assert.ifError(mine.error); assert.ok(mine.data.length >= 2);
  const other = await sessions.adminB.from("invoices").select("id").eq("entity_id", entityId);
  assert.equal(other.data.length, 0);
});

test("finance: admin_user_list returns the finance column", async () => {
  const { data, error } = await sessions.admin.rpc("admin_user_list");
  assert.ifError(error); assert.ok("finance" in data[0]);
});

test("po: cancel removes only un-raised items and keeps invoices", async () => {
  const before = await sql("select count(*)::int n from invoices where po_id = $1", [poId]);
  const r = await sessions.admin.rpc("cancel_po", { p_id: poId });
  assert.ifError(r.error);
  const left = await sql("select count(*)::int n, count(invoice_id)::int raised from po_schedule where po_id = $1", [poId]);
  assert.equal(left[0].n, left[0].raised, "only raised items remain");
  assert.equal(r.data, 8 - left[0].raised);
  assert.equal((await sql("select count(*)::int n from invoices where po_id = $1", [poId]))[0].n, before[0].n);
});
