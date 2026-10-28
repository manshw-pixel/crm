import { test } from "node:test";
import assert from "node:assert/strict";
import { financeFileKind, normBillingCycle, planPORows, planPaymentRows } from "../../src/lib/finance-import.js";

const PO_H = ["accountNo", "name", "po_number", "po_date", "po_value", "currency", "years", "billing_cycle", "billing_start", "po_file"];
const ACCTS = [{ id: "a1", name: "Acme", accountNo: "ACC-1" }, { id: "a2", name: "Beta Corp", accountNo: "" }];
const po = (...rows) => planPORows([PO_H, ...rows], ACCTS);
const good = ["ACC-1", "", "PO-7", "15-11-2026", "1,20,000", "inr", "3", "Annual", "01-12-2026", "po7.pdf"];
const with_ = (i, v) => good.map((c, k) => (k === i ? v : c));

test("financeFileKind", () => {
  assert.equal(financeFileKind(["accountNo", "PO Number", "x"]), "po");
  assert.equal(financeFileKind(["Invoice_Number", "status"]), "payment");
  assert.equal(financeFileKind(["accountNo", "name", "billingCompletedDate"]), "billing");
  assert.equal(financeFileKind(["foo"]), null);
});

test("normBillingCycle", () => {
  for (const v of ["Half-yearly", "half yearly", "HALF_YEARLY"]) assert.equal(normBillingCycle(v), "half_yearly");
  assert.equal(normBillingCycle("Annual"), "annual");
  assert.equal(normBillingCycle("monthly"), null);
});

test("planPORows happy row", () => {
  const r = po(good).items[0];
  assert.equal(r.ok, true);
  assert.deepEqual(r.account, { id: "a1", name: "Acme" });
  assert.equal(r.v.po_value, 120000);
  assert.equal(r.v.currency, "INR");
  assert.equal(r.v.years, 3);
  assert.equal(r.v.billing_cycle, "annual");
  assert.equal(r.v.po_date, "2026-11-15");
  assert.equal(r.v.billing_start, "2026-12-01");
  assert.equal(r.poFile, "po7.pdf");
});

test("planPORows matches by name when accountNo is blank", () => {
  const row = good.map((c, k) => (k === 0 ? "" : k === 1 ? "beta corp" : c));
  assert.equal(po(row).items[0].account.id, "a2");
});

test("planPORows refusals", () => {
  const why = row => po(row).items[0];
  assert.match(why(with_(5, "EUR")).reason, /currency/);
  assert.match(why(with_(6, "11")).reason, /years/);
  assert.match(why(with_(4, "0")).reason, /po_value/);
  assert.match(why(with_(9, "")).reason, /po_file/);
  assert.equal(why(with_(0, "ACC-9")).reason, 'unknown account "ACC-9"');
  assert.equal(why(with_(0, "ACC-9")).ok, false);
});

test("planPORows missing column", () => {
  const h = PO_H.filter(c => c !== "billing_start");
  assert.deepEqual(planPORows([h, good.slice(0, 8)], ACCTS), { err: "missing columns: billing_start", items: [] });
});

const INV = [{ id: "i1", number: "INV-0001", status: "pending" }, { id: "i2", number: "INV-0002", status: "paid" },
  { id: "i3", number: "INV-0003", status: "waived" }];
const PAY_H = ["invoice_number", "status", "paid_date", "payment_ref", "reason"];
const pay = (...rows) => planPaymentRows([PAY_H, ...rows], INV).items;

test("planPaymentRows", () => {
  assert.deepEqual(pay(["INV-0001", "Paid", "30-10-2026", "UTR123", ""])[0],
    { row: 2, ok: true, invoiceId: "i1", status: "paid", paidDate: "2026-10-30", ref: "UTR123", reason: null });
  const w = pay(["INV-0001", "waived", "", "", "goodwill"])[0];
  assert.equal(w.ok, true); assert.equal(w.status, "waived"); assert.equal(w.reason, "goodwill");
  assert.equal(pay(["INV-9", "paid", "30-10-2026", "", ""])[0].reason, "unknown invoice INV-9");
  assert.equal(pay(["INV-0002", "paid", "30-10-2026", "", ""])[0].reason, "already paid");
  assert.equal(pay(["INV-0003", "waived", "", "", "x"])[0].reason, "already waived");
  assert.equal(pay(["INV-0001", "waived", "", "", ""])[0].reason, "waive reason required");
  assert.equal(pay(["INV-0001", "paid", "", "", ""])[0].reason, "paid date required");
  assert.equal(pay(["INV-0001", "refund", "", "", ""])[0].reason, 'bad status "refund"');
});

test("planPaymentRows refuses an invoice number shared by two invoices", () => {
  const dup = [{ id: "i1", number: "INV-0001", status: "pending" }, { id: "i9", number: "inv-0001", status: "pending" }];
  const r = planPaymentRows([PAY_H, ["INV-0001", "paid", "30-10-2026", "", ""]], dup).items[0];
  assert.equal(r.ok, false);
  assert.equal(r.reason, "ambiguous invoice number INV-0001");
});

test("planPORows refuses an ambiguous account name but accountNo still resolves it", () => {
  const dupAccts = [{ id: "a1", name: "Acme", accountNo: "ACC-1" }, { id: "a3", name: "ACME", accountNo: "ACC-3" }];
  const byName = good.map((c, k) => (k === 0 ? "" : k === 1 ? "acme" : c));
  const r = planPORows([PO_H, byName], dupAccts).items[0];
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'ambiguous account name "acme" — add accountNo');
  const byNo = good.map((c, k) => (k === 1 ? "acme" : c));
  assert.equal(planPORows([PO_H, byNo], dupAccts).items[0].account.id, "a1");
});

import { poTemplateCSV, paymentTemplateCSV } from "../../src/lib/finance-import.js";
import { parseCSV } from "../../src/lib/csv.js";

test("poTemplateCSV exact text and kind", () => {
  assert.equal(poTemplateCSV(), "accountNo,name,po_number,po_date,po_value,currency,years,billing_cycle,billing_start,po_file\nACC-1,Example Co (delete this row),PO-001,2026-11-01,100000,INR,1,annual,2026-11-01,PO-001.pdf");
  assert.equal(financeFileKind(parseCSV(poTemplateCSV())[0]), "po");
});

test("paymentTemplateCSV exact text and kind", () => {
  assert.equal(paymentTemplateCSV(), "invoice_number,status,paid_date,payment_ref,reason\nINV-0001,paid,2026-11-01,UTR123,");
  assert.equal(financeFileKind(parseCSV(paymentTemplateCSV())[0]), "payment");
});
