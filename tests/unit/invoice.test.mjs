import test from "node:test";
import assert from "node:assert/strict";
import { computeTax, computeTotals, invoiceStatus, summarizeInvoices, buildSchedule, periodLabel, scheduleLineItem, dueItems, defaultEntityFor, canFinance } from "../../src/lib/invoice.js";

const IN = { id: "e-in", country: "IN", state: "Maharashtra", currency: "INR", default_tax_pct: 18, lut_number: "AD270000001" };
const US = { id: "e-us", country: "US", currency: "USD", default_tax_pct: 0 };
const PH = { id: "e-ph", country: "PH", currency: "PHP", default_tax_pct: 12 };

test("India same state: CGST 9 + SGST 9", () => {
  const t = computeTax(IN, { country: "IN", customerState: "Maharashtra" }, 1000);
  assert.deepEqual(t.lines, [{ label: "CGST", pct: 9, amount: 90 }, { label: "SGST", pct: 9, amount: 90 }]);
  assert.equal(t.note, null);
});
test("India state compare ignores case and spaces", () => {
  const t = computeTax(IN, { country: "IN", customerState: " maharashtra " }, 1000);
  assert.equal(t.lines[0].label, "CGST");
});
test("India other state: IGST 18", () => {
  assert.deepEqual(computeTax(IN, { country: "IN", customerState: "Karnataka" }, 1000).lines,
    [{ label: "IGST", pct: 18, amount: 180 }]);
});
test("India missing customer state is treated as inter-state IGST", () => {
  assert.equal(computeTax(IN, { country: "IN" }, 1000).lines[0].label, "IGST");
});
test("India entity to foreign customer: zero-rated with LUT note", () => {
  const t = computeTax(IN, { country: "US" }, 1000);
  assert.deepEqual(t.lines, []);
  assert.match(t.note, /export under LUT AD270000001 without payment of IGST/);
});
test("US default 0 adds no tax line; non-zero adds Sales tax", () => {
  assert.deepEqual(computeTax(US, { country: "US" }, 500).lines, []);
  assert.deepEqual(computeTax({ ...US, default_tax_pct: 7.25 }, { country: "US" }, 100).lines,
    [{ label: "Sales tax", pct: 7.25, amount: 7.25 }]);
});
test("PH VAT 12", () => {
  assert.deepEqual(computeTax(PH, { country: "PH" }, 250).lines, [{ label: "VAT", pct: 12, amount: 30 }]);
});
test("exempt: no tax lines, note from account or default", () => {
  assert.deepEqual(computeTax(IN, { country: "IN", customerState: "Maharashtra", taxExemptNote: "SEZ unit, LUT 123" }, 1000, { exempt: true }),
    { lines: [], note: "SEZ unit, LUT 123" });
  assert.deepEqual(computeTax(PH, { country: "PH" }, 1000, { exempt: true }), { lines: [], note: "Tax exempt" });
  const r = computeTotals([{ description: "x", qty: 1, rate: 100 }], PH, { country: "PH" }, { exempt: true });
  assert.equal(r.total, 100); assert.deepEqual(r.taxLines, []);
});
test("computeTotals is exact in cents (no float drift)", () => {
  const r = computeTotals([{ description: "a", qty: 3, rate: 33.33 }, { description: "b", qty: 1, rate: 0.1 }, { description: "c", qty: 1, rate: 0.2 }], PH, { country: "PH" });
  assert.equal(r.lines[0].amount, 99.99);
  assert.equal(r.subtotal, 100.29);
  assert.equal(r.taxLines[0].amount, 12.03);   // 12% of 100.29 = 12.0348 -> 12.03
  assert.equal(r.total, 112.32);
});
test("computeTotals rounds half-up", () => {
  const r = computeTotals([{ description: "x", qty: 1, rate: 0.125 }], US, { country: "US" });
  assert.equal(r.lines[0].amount, 0.13);
});
test("computeTotals rounds half-up on large and binary-inexact values", () => {
  assert.equal(computeTotals([{ description: "x", qty: 1, rate: 1234567.005 }], US, { country: "US" }).lines[0].amount, 1234567.01);
  assert.equal(computeTotals([{ description: "x", qty: 1, rate: 1.005 }], US, { country: "US" }).lines[0].amount, 1.01);
});
test("computeTotals drops blank lines and coerces strings", () => {
  const r = computeTotals([{ description: "", qty: "", rate: "" }, { description: "Seat", qty: "2", rate: "10" }], US, { country: "US" });
  assert.equal(r.lines.length, 1);
  assert.equal(r.total, 20);
});
test("invoiceStatus derives overdue and unsent", () => {
  assert.equal(invoiceStatus({ status: "pending", sent_at: null, due_date: "2026-01-01" }, "2026-10-12"), "unsent");
  assert.equal(invoiceStatus({ status: "pending", sent_at: "x", due_date: "2026-10-11" }, "2026-10-12"), "overdue");
  assert.equal(invoiceStatus({ status: "pending", sent_at: "x", due_date: "2026-10-12" }, "2026-10-12"), "pending");
  assert.equal(invoiceStatus({ status: "paid", sent_at: "x", due_date: "2020-01-01" }, "2026-10-12"), "paid");
  assert.equal(invoiceStatus({ status: "waived", sent_at: null, due_date: "2020-01-01" }, "2026-10-12"), "waived");
});
test("summarizeInvoices groups by currency and never mixes", () => {
  const s = summarizeInvoices([
    { currency: "INR", total: 100, status: "paid", sent_at: "x", due_date: "2026-12-01" },
    { currency: "INR", total: 50, status: "pending", sent_at: "x", due_date: "2026-01-01" },
    { currency: "USD", total: 10, status: "waived", sent_at: "x", due_date: "2026-01-01" },
    { currency: "USD", total: 99, status: "pending", sent_at: null, due_date: "2026-01-01" }, // unsent: excluded
  ], "2026-10-12");
  assert.deepEqual(s.INR, { paid: 100, pending: 50, waived: 0, overdue: 50, overdueCount: 1 });
  assert.deepEqual(s.USD, { paid: 0, pending: 0, waived: 10, overdue: 0, overdueCount: 0 });
});
test("buildSchedule: 2 years quarterly = 8 even periods", () => {
  const s = buildSchedule({ po_value: 800000, years: 2, billing_cycle: "quarterly", billing_start: "2026-11-01" });
  assert.equal(s.length, 8);
  assert.deepEqual(s[0], { seq: 1, period_start: "2026-11-01", period_end: "2027-01-31", amount: 100000 });
  assert.deepEqual(s[7], { seq: 8, period_start: "2028-08-01", period_end: "2028-10-31", amount: 100000 });
});
test("buildSchedule: remainder lands on the last item, sum is exact", () => {
  const s = buildSchedule({ po_value: 100, years: 1, billing_cycle: "quarterly", billing_start: "2026-01-01" });
  assert.deepEqual(s.map(x => x.amount), [25, 25, 25, 25]);
  const t = buildSchedule({ po_value: 1000, years: 1, billing_cycle: "half_yearly", billing_start: "2026-01-01" });
  assert.deepEqual(t.map(x => x.amount), [500, 500]);
  const u = buildSchedule({ po_value: 100, years: 3, billing_cycle: "annual", billing_start: "2026-01-01" });
  assert.deepEqual(u.map(x => x.amount), [33.33, 33.33, 33.34]);
});
test("buildSchedule: half-yearly and annual period ends", () => {
  const h = buildSchedule({ po_value: 200, years: 1, billing_cycle: "half_yearly", billing_start: "2026-04-01" });
  assert.deepEqual(h.map(x => [x.period_start, x.period_end]), [["2026-04-01", "2026-09-30"], ["2026-10-01", "2027-03-31"]]);
  const a = buildSchedule({ po_value: 200, years: 2, billing_cycle: "annual", billing_start: "2026-04-01" });
  assert.deepEqual(a.map(x => x.period_end), ["2027-03-31", "2028-03-31"]);
});
test("buildSchedule: month-end start clamps (31 Jan quarterly)", () => {
  const s = buildSchedule({ po_value: 400, years: 1, billing_cycle: "quarterly", billing_start: "2026-01-31" });
  assert.deepEqual(s.map(x => x.period_start), ["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"]);
  assert.equal(s[0].period_end, "2026-04-29");
});
test("buildSchedule: rejects bad input with []", () => {
  assert.deepEqual(buildSchedule({ po_value: 0, years: 1, billing_cycle: "annual", billing_start: "2026-01-01" }), []);
  assert.deepEqual(buildSchedule({ po_value: 10, years: 1, billing_cycle: "monthly", billing_start: "2026-01-01" }), []);
  assert.deepEqual(buildSchedule({ po_value: 100, years: 1.5, billing_cycle: "annual", billing_start: "2026-01-01" }), []);
});
test("periodLabel and scheduleLineItem", () => {
  const po = { po_number: "4500123", billing_cycle: "quarterly" };
  assert.equal(periodLabel(po, { seq: 5 }), "Year 2 Q1");
  assert.equal(periodLabel({ billing_cycle: "half_yearly" }, { seq: 2 }), "Year 1 H2");
  assert.equal(periodLabel({ billing_cycle: "annual" }, { seq: 3 }), "Year 3");
  assert.deepEqual(scheduleLineItem(po, { seq: 1, period_start: "2026-11-01", period_end: "2027-01-31", amount: 100000 }),
    { description: "Subscription — Year 1 Q1 (2026-11-01 – 2027-01-31), PO 4500123", qty: 1, rate: 100000 });
});
test("dueItems: un-raised and started only", () => {
  const items = [{ id: 1, invoice_id: null, period_start: "2026-10-12" }, { id: 2, invoice_id: "x", period_start: "2026-01-01" },
    { id: 3, invoice_id: null, period_start: "2026-10-13" }];
  assert.deepEqual(dueItems(items, "2026-10-12").map(i => i.id), [1]);
});
test("defaultEntityFor: explicit id wins, then country, else null", () => {
  const ents = [IN, US, PH];
  assert.equal(defaultEntityFor({ billingEntityId: "e-us", country: "IN" }, ents).id, "e-us");
  assert.equal(defaultEntityFor({ country: "PH" }, ents).id, "e-ph");
  assert.equal(defaultEntityFor({ country: "DE" }, ents), null);
  assert.equal(defaultEntityFor({ billingEntityId: "gone", country: "IN" }, ents).id, "e-in");
});
test("canFinance: finance flag or admin, never disabled", () => {
  assert.equal(canFinance({ role: "user", finance: true }), true);
  assert.equal(canFinance({ role: "admin" }), true);
  assert.equal(canFinance({ role: "user" }), false);
  assert.equal(canFinance({ role: "admin", disabled: true }), false);
  assert.equal(canFinance(null), false);
});
