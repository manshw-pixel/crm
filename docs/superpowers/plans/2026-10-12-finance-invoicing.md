# Finance Invoicing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CSMs submit purchase orders; Finance approves them, which creates a billing schedule, then raises each period's invoice, emails it as a PDF, and marks it paid or waived. A Finance page, account Purchase orders and Invoices tabs, and a Dashboard card show the state per currency.

**Architecture:** Pure invoice math (tax, totals, status, summaries) lives in a new `src/lib/invoice.js` ES module with node:test unit tests. Persistence is a new `finance.sql`: tables, RLS, and SECURITY DEFINER RPCs for numbering, status changes and sending. Sending reuses the existing Brevo seam (`alert_config` key + `alert_post` via pg_net), so there is **no Edge Function**. The browser renders the PDF with a vendored jsPDF, stores it in a private `invoices` Storage bucket, and passes it base64 to `send_invoice`. The UI is three new `src/NN-*.jsx` files plus small additive edits to Settings, the account page, the Dashboard and the sidebar.

**Tech Stack:** React (browser globals, Babel-in-page via `build.mjs`), Supabase Postgres + RLS + Storage, pg_net → Brevo SMTP API, jsPDF 2.5.1 (vendored UMD), node:test, Playwright health harness (`tests/health`), RLS suite (`tests/rls`, CI only: needs Docker).

**Spec:** `docs/superpowers/specs/2026-10-12-finance-invoicing-design.md`

## Deviations from the spec (fit the codebase; flag to the user at handoff)

1. **No Edge Function.** The repo has none. Every email goes out via `alert_post` (pg_net) in SQL. `send_invoice(p_id uuid, p_pdf_base64 text)` sends the attachment inline as base64. Re-send downloads the stored PDF and calls the same RPC.
2. **Account billing fields live in `accounts.data` JSON** (camelCase: `billingEntityId`, `billingEmail`, `billingAddress`, `customerTaxId`, `customerState`, `country`), like every other account field. There are no new columns.
3. **The Finance toggle sits on the user row only, not on the invite form.** Admins switch it on after the user exists. This avoids changing `invites`, `invite_user` and `handle_new_user`.
4. **The sender address** lives in a per-org `billing_settings` row (default `support@onevio.in`). The Brevo key stays platform-wide in `alert_config`.

## Global Constraints

- All changes additive. Existing features, CSV columns and stored data are untouched (see memory: OneVio CRM workflow).
- Statuses are exactly `pending`, `paid`, `waived`. Overdue is derived (`pending` and `due_date < today`) and never stored.
- Never sum across currencies. Every total is grouped by `INR | USD | PHP`.
- Entity countries: `IN | US | PH`. Default tax: IN same-state CGST 9% + SGST 9%; IN inter-state IGST 18%; IN → foreign customer 0% with the LUT note; US `default_tax_pct` (0); PH VAT 12%.
- Sender: one address per org, default `support@onevio.in`.
- Permissions: create, send, mark paid and waive require `profiles.finance = true` OR `role = 'admin'`, and an active user. View and PDF download are open to any active org member. Billing-entity and sender edits are admin only.
- Every SECURITY DEFINER function asserts `is_active()`, the org and the finance/admin check itself (definer functions bypass RLS: see memory onevio-user-disable).
- Revokes target `public` only, then grant to `authenticated` (pattern at `supabase-setup.sql:1151-1156`).
- New SQL that runs in the RLS harness must not create extensions. Functions that touch `net.*` are `language plpgsql`.
- Rounding: 2 decimals, half-up, on each line amount, each tax line and the total, done in integer minor units.
- CSV export goes through the existing formula-injection guard in `src/lib/csv.js`.
- New lib code must not reference `window`, `document`, `React`, `sb` (build guard). Its names must not be redeclared at column 0 in any `src/*.jsx` file.
- A new `tests/health/*.test.mjs` or `tests/rls/*.test.mjs` file must be added to that suite's `run.mjs` import list or it never runs.

## Review Focus

1. **Float money:** line `qty 3 × rate 33.33`, or tax on `0.1 + 0.2`, must give exact cents. Pinned in Task 1 (`computeTotals` integer-cents test).
2. **Two Finance users clicking Send at once** must get distinct numbers with no duplicate. Pinned in Task 2 (sequential-number RLS test plus the unique constraint test).
3. **An account with no billing entity or billing email** must block the form with a clear message, not throw or send to nobody. Pinned in Task 6 (health test `blocks without billing email`).
4. **A non-finance user calling the RPCs directly** (bypassing hidden buttons) must be refused. A user whose finance flag was revoked mid-session must lose access on the next call. Pinned in Task 2 and Task 3 (RLS tests).
5. **A long PO hitting a month-end start** (31 Jan, quarterly) must give the same periods in the JS preview and in SQL `approve_po`, or the CSM is shown one schedule and Finance invoices another. Pinned in Task 1 (`month-end start clamps`) and Task 2 (`approve builds 8 anchored periods` asserts the same dates).
6. **Free text in the email** (account name with `<script>`) must be HTML-escaped in the Brevo body. Pinned in Task 3 (recorder asserts `&lt;script&gt;`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/invoice.js` (create) | Pure: `computeTax`, `computeTotals`, `invoiceStatus`, `summarizeInvoices`, `buildSchedule`, `periodLabel`, `scheduleLineItem`, `dueItems`, `defaultEntityFor`, `canFinance` |
| `src/lib/index.js` (modify) | Re-export `invoice.js` |
| `tests/unit/invoice.test.mjs` (create) | Unit tests for the above |
| `finance.sql` (create) | Schema, RLS, buckets, RPCs `approve_po`, `reject_po`, `cancel_po`, `notify_po_decision`, `create_invoice`, `set_invoice_status`, `attach_invoice_pdf`, `send_invoice` |
| `tests/rls/fixtures.mjs` (modify) | Apply `finance.sql` after `touchpoints.sql` |
| `tests/rls/finance.test.mjs` (create) | RLS and RPC tests; register in `tests/rls/run.mjs` before `migration.test.mjs` |
| `vendor/jspdf.umd.min.js` (create) | Vendored jsPDF 2.5.1 |
| `build.mjs` (modify) | Inline jsPDF with the other vendor JS |
| `src/14-purchase-orders.jsx` (create) | `usePurchaseOrders`, `AccountPurchaseOrders`, `POForm`, `POReview`, `POQueue` |
| `src/14-invoices.jsx` (create) | `useInvoices`, `InvoiceTable`, `MarkPaidDialog`, `WaiveDialog`, `downloadInvoice`, `resendInvoice` |
| `src/27-invoice-form.jsx` (create) | `renderInvoicePdf`, `InvoiceForm` (modal), send flow |
| `src/28-finance-page.jsx` (create) | `FinancePage`, `FinanceSummary`, `DueToRaise`, `FinanceCard` (Dashboard) |
| `src/24-settings.jsx`, `src/25-auth-admin.jsx` (modify) | Billing entities and sender section; Finance toggle on users |
| `src/13-forms.jsx` / `src/21-account-detail.jsx` (modify) | Billing fields on the account form; Invoices tab |
| `src/26-app.jsx` (modify) | `"Finance"` view, `user.finance` in the profile select |
| `src/16-dashboard.jsx` (modify) | Render `<FinanceCard>` |
| `tests/health/finance.test.mjs` (create) | E2E; register in `tests/health/run.mjs` |
| `docs/runbooks/finance-setup.md` (create) | Operator steps: run `finance.sql`, add entities, verify sender |

---

### Task 1: Pure invoice logic (`src/lib/invoice.js`)

**Files:**
- Create: `src/lib/invoice.js`, `tests/unit/invoice.test.mjs`
- Modify: `src/lib/index.js` (add `export * from "./invoice.js";`)

**Interfaces:**
- Produces:
  - `computeTax(entity, account, subtotal, opts?: {exempt?: boolean}) → { lines: [{label, pct, amount}], note: string|null }`
  - `computeTotals(lineItems, entity, account, opts?: {exempt?: boolean}) → { lines: [{description, qty, rate, amount}], subtotal, taxLines, taxNote, total }`
  - `invoiceStatus(inv, todayISO) → "paid"|"waived"|"overdue"|"pending"|"unsent"`
  - `summarizeInvoices(invoices, todayISO) → { [currency]: { paid, pending, waived, overdue, overdueCount } }`
  - `buildSchedule({po_value, years, billing_cycle, billing_start}) → [{seq, period_start, period_end, amount}]` (`[]` on bad input)`n  - `periodLabel(po, item) → "Year 2 Q1" | "Year 1 H2" | "Year 3"``n  - `scheduleLineItem(po, item) → {description, qty: 1, rate}``n  - `dueItems(items, todayISO) → items` (un-raised, `period_start <= today`)
  - `defaultEntityFor(account, entities) → entity|null`
  - `canFinance(user) → boolean`
  - Entity shape (snake_case, as stored in SQL): `{id, country, state, currency, default_tax_pct, lut_number, ...}`. Account shape: app camelCase (`country`, `customerState`, `billingEntityId`, `licenses`, `arr`, `currency`).

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/invoice.test.mjs
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/unit/invoice.test.mjs`
Expected: FAIL, `Cannot find module ... src/lib/invoice.js`

- [ ] **Step 3: Implement**

```js
// src/lib/invoice.js
// Pure invoice math. Money is computed in integer minor units (cents/paise/centavos) so
// 0.1 + 0.2 never drifts; values are converted back to 2-decimal numbers at the edge.
const toCents = n => Math.round((Number(n) || 0) * 100 + Number.EPSILON * 100);
const fromCents = c => c / 100;
const pctOf = (cents, pct) => Math.round(cents * Number(pct) / 100 + 1e-9);
const norm = s => String(s || "").trim().toLowerCase();

export function computeTax(entity, account, subtotal, opts = {}) {
  const base = toCents(subtotal);
  if (opts.exempt) return { lines: [], note: String((account && account.taxExemptNote) || "").trim() || "Tax exempt" };
  const line = (label, pct) => ({ label, pct, amount: fromCents(pctOf(base, pct)) });
  const cust = (account && account.country) || entity.country;
  if (entity.country === "IN") {
    if (cust !== "IN") return { lines: [], note: `Supply meant for export under LUT ${entity.lut_number || "—"} without payment of IGST` };
    const rate = Number(entity.default_tax_pct ?? 18);
    if (norm(account.customerState) && norm(account.customerState) === norm(entity.state))
      return { lines: [line("CGST", rate / 2), line("SGST", rate / 2)], note: null };
    return { lines: [line("IGST", rate)], note: null };
  }
  const pct = Number(entity.default_tax_pct || 0);
  if (!pct) return { lines: [], note: null };
  return { lines: [line(entity.country === "PH" ? "VAT" : "Sales tax", pct)], note: null };
}

export function computeTotals(lineItems, entity, account, opts = {}) {
  const lines = (lineItems || [])
    .filter(l => String(l.description || "").trim() || Number(l.rate))
    .map(l => {
      const qty = Number(l.qty) || 0, rate = Number(l.rate) || 0;
      return { description: String(l.description || "").trim(), qty, rate, amount: fromCents(toCents(qty * rate)) };
    });
  const subC = lines.reduce((s, l) => s + toCents(l.amount), 0);
  const tax = computeTax(entity, account, fromCents(subC), opts);
  const taxC = tax.lines.reduce((s, t) => s + toCents(t.amount), 0);
  return { lines, subtotal: fromCents(subC), taxLines: tax.lines, taxNote: tax.note, total: fromCents(subC + taxC) };
}

// Dates are ISO yyyy-mm-dd strings compared TEXTUALLY (UTC-vs-local bit this app twice).
export function invoiceStatus(inv, todayISO) {
  if (inv.status === "paid" || inv.status === "waived") return inv.status;
  if (!inv.sent_at) return "unsent";
  return String(inv.due_date) < todayISO ? "overdue" : "pending";
}

export function summarizeInvoices(invoices, todayISO) {
  const out = {};
  for (const inv of invoices || []) {
    const st = invoiceStatus(inv, todayISO);
    if (st === "unsent") continue;
    const c = (out[inv.currency] ||= { paid: 0, pending: 0, waived: 0, overdue: 0, overdueCount: 0 });
    const amt = toCents(inv.total);
    if (st === "paid") c.paid += amt;
    else if (st === "waived") c.waived += amt;
    else { c.pending += amt; if (st === "overdue") { c.overdue += amt; c.overdueCount++; } }
  }
  for (const c of Object.values(out)) for (const k of ["paid", "pending", "waived", "overdue"]) c[k] = fromCents(c[k]);
  return out;
}

// ---- purchase-order schedules. Dates are yyyy-mm-dd strings; month math is done on
// numbers in UTC, never on local Date objects.
const CYCLE_MONTHS = { quarterly: 3, half_yearly: 6, annual: 12 };
const pad = n => String(n).padStart(2, "0");
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m is 1-based
function addMonths(iso, k, anchorDay) {
  const [y, m] = iso.split("-").map(Number);
  const t = y * 12 + (m - 1) + k, ny = Math.floor(t / 12), nm = t % 12 + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(anchorDay, daysIn(ny, nm)))}`;
}
const dayBefore = iso => new Date(Date.parse(iso + "T00:00:00Z") - 864e5).toISOString().slice(0, 10);

// Every period is anchored on the ORIGINAL start day, so 31 Jan -> 30 Apr -> 31 Jul (not 30 Jul).
export function buildSchedule(po) {
  const step = CYCLE_MONTHS[po.billing_cycle], years = Number(po.years) || 0, total = toCents(po.po_value);
  if (!step || years < 1 || total <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(po.billing_start || "")) return [];
  const n = years * 12 / step, each = Math.floor(total / n), anchor = Number(po.billing_start.slice(8));
  return Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    period_start: addMonths(po.billing_start, i * step, anchor),
    period_end: dayBefore(addMonths(po.billing_start, (i + 1) * step, anchor)),
    amount: fromCents(i === n - 1 ? total - each * (n - 1) : each),
  }));
}

export function periodLabel(po, item) {
  const per = 12 / CYCLE_MONTHS[po.billing_cycle], year = Math.ceil(item.seq / per), k = (item.seq - 1) % per + 1;
  return po.billing_cycle === "annual" ? `Year ${year}` : `Year ${year} ${po.billing_cycle === "quarterly" ? "Q" : "H"}${k}`;
}

export function scheduleLineItem(po, item) {
  return { description: `Subscription — ${periodLabel(po, item)} (${item.period_start} – ${item.period_end}), PO ${po.po_number}`,
    qty: 1, rate: Number(item.amount) };
}

export const dueItems = (items, todayISO) => (items || []).filter(i => !i.invoice_id && String(i.period_start) <= todayISO);

export function defaultEntityFor(account, entities) {
  const list = entities || [];
  return list.find(e => e.id === account.billingEntityId) || list.find(e => e.country === account.country) || null;
}

export function canFinance(user) {
  return !!user && !user.disabled && (user.role === "admin" || user.finance === true);
}
```

Then add `export * from "./invoice.js";` to `src/lib/index.js`.

- [ ] **Step 4: Run tests and build**

Run: `node --test tests/unit/invoice.test.mjs` → all PASS. Then `npm run test:unit` → PASS. Then `npm run build` → succeeds (the duplicate-name and browser-global guards pass).
If `computeTotals is exact in cents` fails on `12.03`, check that `pctOf` rounds the cents product, not the decimal.

- [ ] **Step 5: Commit**

```bash
git add src/lib/invoice.js src/lib/index.js tests/unit/invoice.test.mjs
git commit -m "Invoice lib: tax, totals, status, summaries, PO schedules (pure, unit-tested)"
```

---

### Task 2: Schema, RLS, numbering and status RPCs (`finance.sql`)

**Files:**
- Create: `finance.sql`, `tests/rls/finance.test.mjs`
- Modify: `tests/rls/fixtures.mjs` (`resetStack`: read and apply `finance.sql` right after `TOUCH_SQL`), `tests/rls/run.mjs` (import `./finance.test.mjs` before `./migration.test.mjs`). Check `tests/rls/migration.test.mjs`: if it re-applies the SQL file list itself, add `finance.sql` there too.

**Interfaces:**
- Consumes: `public.is_active()`, `public.is_admin()`, `public.current_org()`, `public.org_enabled()` (`supabase-setup.sql`).
- Produces (SQL):
  - `profiles.finance boolean not null default false`
  - `public.is_finance() returns boolean`: active and (finance or admin role)
  - tables `billing_entities`, `invoices`, `billing_settings` (columns below)
  - `public.create_invoice(p jsonb) returns invoices`. Keys: `schedule_id, entity_id, issue_date, due_date, line_items, subtotal, tax_lines, tax_note, total, sent_to, sent_cc`. Account and PO come from the schedule item, and currency comes from the entity (it must equal the PO currency).`n  - tables `purchase_orders`, `po_schedule`; `po_schedule_rows(po)`; `approve_po(p_id uuid, p_amounts numeric[], p_confirm_mismatch boolean) returns purchase_orders`; `reject_po(p_id uuid, p_reason text) returns purchase_orders`; `cancel_po(p_id uuid) returns int` (un-raised items removed)
  - `public.set_invoice_status(p_id uuid, p_status text, p_paid_date date, p_ref text, p_reason text) returns invoices`
  - `public.attach_invoice_pdf(p_id uuid, p_path text) returns void`
  - `public.admin_user_list()` now also returns `finance boolean`
  - private bucket `invoices`, object path `<org_id>/<invoice_id>.pdf`

- [ ] **Step 1: Write the failing RLS tests**

Use the real fixture API: `sessions.admin`, `sessions.user`, `sessions.adminB`, `sql(text, params)`, `signUpFresh(email)`. Read `tests/rls/fixtures.mjs` and copy how `limits.test.mjs` imports `test` from `../health/framework.mjs`. Use unique emails `fin-*@test.local`. Never mutate the shared sessions' names or emails.

```js
// tests/rls/finance.test.mjs
import assert from "node:assert/strict";
import { test } from "../health/framework.mjs";
import { sessions, sql, ORG_A } from "./fixtures.mjs";

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
  const u = await sessions.user.from("purchase_orders").update({ po_value: 1 }).eq("id", poId).select("id");
  assert.equal((u.data || []).length, 0);
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

test("finance: user cannot grant themselves the flag", async () => {
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

test("po: cancel removes only un-raised items and keeps invoices", async () => {
  const before = await sql("select count(*)::int n from invoices where po_id = $1", [poId]);
  const r = await sessions.admin.rpc("cancel_po", { p_id: poId });
  assert.ifError(r.error);
  const left = await sql("select count(*)::int n, count(invoice_id)::int raised from po_schedule where po_id = $1", [poId]);
  assert.equal(left[0].n, left[0].raised, "only raised items remain");
  assert.equal(r.data, 8 - left[0].raised);
  assert.equal((await sql("select count(*)::int n from invoices where po_id = $1", [poId]))[0].n, before[0].n);
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
```

- [ ] **Step 2: Verify failure**

The RLS suite needs Docker (not on this machine). Push the branch and open a **draft PR** to master to trigger CI job `rls`. Never use `workflow_dispatch`: it deploys the branch. Expected: the finance tests FAIL (`relation "billing_entities" does not exist`) and every other test still passes.

- [ ] **Step 3: Write `finance.sql`**

```sql
-- finance.sql -- invoicing. Run AFTER supabase-setup.sql, email-alerts.sql, touchpoints.sql.
-- Re-runnable. Creates no extensions (the RLS harness applies this file).
-- See docs/superpowers/specs/2026-10-12-finance-invoicing-design.md

alter table public.profiles add column if not exists finance boolean not null default false;

-- Only an org admin may change the flag. profiles_update_admin already limits updates to
-- admins; this trigger makes the rule explicit for the finance column too.
create or replace function public.guard_profile_finance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.finance is distinct from old.finance and not public.is_admin() then
    raise exception 'Only an admin can change finance access';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile_finance on public.profiles;
create trigger guard_profile_finance before update of finance on public.profiles
  for each row execute function public.guard_profile_finance();

create or replace function public.is_finance()
returns boolean language sql stable security definer set search_path = public as
$$ select public.is_active() and exists (select 1 from profiles where id = auth.uid()
          and not disabled and (finance or role = 'admin')) $$;

create table if not exists public.billing_entities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org() references public.orgs(id) on delete cascade,
  name text not null,
  country text not null check (country in ('IN','US','PH')),
  address text not null default '',
  state text not null default '',
  tax_id text not null default '',
  tax_id_label text not null default '',
  currency text not null check (currency in ('INR','USD','PHP')),
  bank_details text not null default '',
  logo_path text,
  invoice_prefix text not null,
  next_number int not null default 1 check (next_number > 0),
  default_tax_pct numeric(5,2) not null default 0 check (default_tax_pct between 0 and 100),
  lut_number text,
  created_at timestamptz not null default now()
);
alter table public.billing_entities enable row level security;
drop policy if exists billing_entities_select on public.billing_entities;
create policy billing_entities_select on public.billing_entities for select to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org()));
drop policy if exists billing_entities_write on public.billing_entities;
create policy billing_entities_write on public.billing_entities for all to authenticated
  using ((select public.is_admin()) and org_id = (select public.current_org()))
  with check ((select public.is_admin()) and org_id = (select public.current_org()));

create table if not exists public.billing_settings (
  org_id uuid primary key default public.current_org() references public.orgs(id) on delete cascade,
  sender_email text not null default 'support@onevio.in',
  sender_name text not null default 'OneVio Billing'
);
alter table public.billing_settings enable row level security;
drop policy if exists billing_settings_select on public.billing_settings;
create policy billing_settings_select on public.billing_settings for select to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org()));
drop policy if exists billing_settings_write on public.billing_settings;
create policy billing_settings_write on public.billing_settings for all to authenticated
  using ((select public.is_admin()) and org_id = (select public.current_org()))
  with check ((select public.is_admin()) and org_id = (select public.current_org()));
insert into public.billing_settings (org_id) select id from public.orgs on conflict (org_id) do nothing;

-- ---------- purchase orders ----------
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org() references public.orgs(id) on delete cascade,
  account_id text not null,
  account_name text not null,
  po_number text not null check (trim(po_number) <> ''),
  po_date date not null,
  po_value numeric(14,2) not null check (po_value > 0),
  currency text not null check (currency in ('INR','USD','PHP')),
  years int not null check (years between 1 and 10),
  billing_cycle text not null check (billing_cycle in ('quarterly','half_yearly','annual')),
  billing_start date not null,
  file_path text not null,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','cancelled')),
  submitted_by uuid not null default auth.uid(),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid, reviewed_at timestamptz, reject_reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists purchase_orders_live_number
  on public.purchase_orders (org_id, account_id, lower(trim(po_number))) where status <> 'cancelled';
alter table public.purchase_orders enable row level security;
drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org()));
drop policy if exists purchase_orders_insert on public.purchase_orders;
create policy purchase_orders_insert on public.purchase_orders for insert to authenticated
  with check ((select public.is_active()) and org_id = (select public.current_org()) and status = 'submitted'
              and submitted_by = auth.uid() and reviewed_by is null);
-- Edit / resubmit: only while submitted or rejected, and the row must come out as 'submitted'
-- with the review fields cleared. Approve/reject/cancel are the definer RPCs below.
drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update on public.purchase_orders for update to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org()) and status in ('submitted','rejected'))
  with check ((select public.is_active()) and org_id = (select public.current_org()) and status = 'submitted'
              and reviewed_by is null and reject_reason is null);

create table if not exists public.po_schedule (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  seq int not null,
  period_start date not null,
  period_end date not null,
  amount numeric(14,2) not null check (amount > 0),
  invoice_id uuid unique,
  unique (po_id, seq)
);
alter table public.po_schedule enable row level security;
drop policy if exists po_schedule_select on public.po_schedule;
create policy po_schedule_select on public.po_schedule for select to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org()));
-- no write policy: approve_po / cancel_po / create_invoice are the only writers.

-- SQL mirror of src/lib/invoice.js buildSchedule (anchor day kept, remainder on last).
-- The RLS tests pin both to the same fixtures; change them together.
create or replace function public.po_schedule_rows(p purchase_orders)
returns table(seq int, period_start date, period_end date, amount numeric)
language sql immutable as $$
  with k as (select case p.billing_cycle when 'quarterly' then 3 when 'half_yearly' then 6 else 12 end as step),
       n as (select p.years * 12 / step as cnt, step from k),
       c as (select (p.po_value * 100)::bigint as total, cnt, step from n)
  select i::int,
         (p.billing_start + make_interval(months => (i - 1) * step))::date,
         ((p.billing_start + make_interval(months => i * step))::date - 1),
         (case when i = cnt then total - (total / cnt) * (cnt - 1) else total / cnt end)::numeric / 100
    from c, generate_series(1, cnt) i
$$;
-- NOTE: Postgres `date + interval 'n months'` clamps from the ORIGINAL date each time, which
-- matches the JS anchor-day rule (31 Jan + 3 months = 30 Apr, + 6 months = 31 Jul).

create or replace function public.approve_po(p_id uuid, p_amounts numeric[], p_confirm_mismatch boolean default false)
returns public.purchase_orders language plpgsql security definer set search_path = public as $$
declare po purchase_orders; cnt int;
begin
  if not public.is_finance() then raise exception 'finance access required'; end if;
  select * into po from purchase_orders where id = p_id and org_id = public.current_org() for update;
  if po is null then raise exception 'purchase order not found'; end if;
  if po.status <> 'submitted' then raise exception 'only a submitted PO can be approved'; end if;
  select count(*) into cnt from po_schedule_rows(po);
  if p_amounts is not null then
    if coalesce(array_length(p_amounts, 1), 0) <> cnt then raise exception 'expected % amounts', cnt; end if;
    if exists (select 1 from unnest(p_amounts) a where a is null or a <= 0) then raise exception 'every amount must be above 0'; end if;
    if (select sum(a) from unnest(p_amounts) a) <> po.po_value and not p_confirm_mismatch then
      raise exception 'amounts do not add up to the PO value';
    end if;
  end if;
  insert into po_schedule (org_id, po_id, seq, period_start, period_end, amount)
  select po.org_id, po.id, r.seq, r.period_start, r.period_end, coalesce(p_amounts[r.seq], r.amount)
    from po_schedule_rows(po) r;
  update purchase_orders set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = null
   where id = po.id returning * into po;
  return po;
end $$;

create or replace function public.reject_po(p_id uuid, p_reason text)
returns public.purchase_orders language plpgsql security definer set search_path = public as $$
declare po purchase_orders;
begin
  if not public.is_finance() then raise exception 'finance access required'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reject reason required'; end if;
  update purchase_orders set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = trim(p_reason)
   where id = p_id and org_id = public.current_org() and status = 'submitted' returning * into po;
  if po is null then raise exception 'only a submitted PO can be rejected'; end if;
  return po;
end $$;

create or replace function public.cancel_po(p_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare po purchase_orders; removed int;
begin
  if not public.is_finance() then raise exception 'finance access required'; end if;
  update purchase_orders set status = 'cancelled', reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id and org_id = public.current_org() and status in ('submitted','approved') returning * into po;
  if po is null then raise exception 'PO not found or not cancellable'; end if;
  delete from po_schedule where po_id = po.id and invoice_id is null;
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke execute on function public.approve_po(uuid, numeric[], boolean) from public;
revoke execute on function public.reject_po(uuid, text) from public;
revoke execute on function public.cancel_po(uuid) from public;
revoke execute on function public.po_schedule_rows(purchase_orders) from public;
grant execute on function public.approve_po(uuid, numeric[], boolean) to authenticated;
grant execute on function public.reject_po(uuid, text) to authenticated;
grant execute on function public.cancel_po(uuid) to authenticated;
grant execute on function public.po_schedule_rows(purchase_orders) to authenticated;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org() references public.orgs(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id),
  schedule_id uuid not null unique references public.po_schedule(id),
  account_id text not null,
  account_name text not null,
  entity_id uuid not null references public.billing_entities(id),
  number text not null,
  issue_date date not null,
  due_date date not null,
  currency text not null,
  line_items jsonb not null default '[]',
  subtotal numeric(14,2) not null default 0,
  tax_lines jsonb not null default '[]',
  tax_note text,
  tax_exempt boolean not null default false,
  total numeric(14,2) not null,
  status text not null default 'pending' check (status in ('pending','paid','waived')),
  paid_date date,
  payment_ref text,
  waive_reason text,
  status_by uuid,
  status_at timestamptz,
  pdf_path text,
  sent_to text,
  sent_cc text,
  sent_at timestamptz,
  sent_by uuid,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint invoices_entity_number_key unique (entity_id, number),
  constraint invoices_paid_has_date check (status <> 'paid' or paid_date is not null),
  constraint invoices_waived_has_reason check (status <> 'waived' or coalesce(trim(waive_reason), '') <> '')
);
create index if not exists invoices_org_account on public.invoices (org_id, account_id);
alter table public.invoices enable row level security;
-- SELECT only. Every write goes through the definer RPCs below, so there is NO insert,
-- update or delete policy: amounts can never be edited after creation.
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org()));

create or replace function public.create_invoice(p jsonb)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare e billing_entities; n int; inv invoices; si po_schedule; po purchase_orders;
begin
  if not public.is_finance() then raise exception 'finance access required'; end if;
  -- An invoice exists only for an un-raised period of an APPROVED PO. Row-locking the
  -- schedule item makes a double click / two finance users unable to raise it twice.
  select * into si from po_schedule where id = (p->>'schedule_id')::uuid and org_id = public.current_org() for update;
  if si is null then raise exception 'schedule item not found'; end if;
  if si.invoice_id is not null then raise exception 'this period is already invoiced'; end if;
  select * into po from purchase_orders where id = si.po_id;
  if po.status <> 'approved' then raise exception 'PO is not approved'; end if;
  select * into e from billing_entities
   where id = (p->>'entity_id')::uuid and org_id = public.current_org() for update;
  if e is null then raise exception 'billing entity not found'; end if;
  if coalesce(trim(p->>'sent_to'), '') = '' then raise exception 'billing email required'; end if;
  if coalesce((p->>'total')::numeric, 0) <= 0 then raise exception 'total must be above 0'; end if;
  n := e.next_number;
  update billing_entities set next_number = n + 1 where id = e.id;
  if e.currency <> po.currency then raise exception 'entity currency % does not match PO currency %', e.currency, po.currency; end if;
  insert into invoices (org_id, po_id, schedule_id, account_id, account_name, entity_id, number, issue_date, due_date, currency,
                        line_items, subtotal, tax_lines, tax_note, tax_exempt, total, sent_to, sent_cc)
  values (e.org_id, po.id, si.id, po.account_id, po.account_name, e.id, e.invoice_prefix || lpad(n::text, 4, '0'),
          (p->>'issue_date')::date, (p->>'due_date')::date, e.currency,
          coalesce(p->'line_items', '[]'), coalesce((p->>'subtotal')::numeric, 0), coalesce(p->'tax_lines', '[]'),
          p->>'tax_note', coalesce((p->>'tax_exempt')::boolean, false), (p->>'total')::numeric, trim(p->>'sent_to'), nullif(trim(coalesce(p->>'sent_cc', '')), ''))
  returning * into inv;
  update po_schedule set invoice_id = inv.id where id = si.id;
  return inv;
end $$;

create or replace function public.set_invoice_status(p_id uuid, p_status text, p_paid_date date, p_ref text, p_reason text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  if not public.is_finance() then raise exception 'finance access required'; end if;
  if p_status not in ('pending','paid','waived') then raise exception 'bad status'; end if;
  if p_status = 'paid' and p_paid_date is null then raise exception 'paid date required'; end if;
  if p_status = 'waived' and coalesce(trim(p_reason), '') = '' then raise exception 'waive reason required'; end if;
  update invoices set status = p_status,
         paid_date    = case when p_status = 'paid' then p_paid_date end,
         payment_ref  = case when p_status = 'paid' then nullif(trim(coalesce(p_ref, '')), '') end,
         waive_reason = case when p_status = 'waived' then trim(p_reason) end,
         status_by = auth.uid(), status_at = now()
   where id = p_id and org_id = public.current_org()
   returning * into inv;
  if inv is null then raise exception 'invoice not found'; end if;
  return inv;
end $$;

create or replace function public.attach_invoice_pdf(p_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_finance() then raise exception 'finance access required'; end if;
  if split_part(p_path, '/', 1) <> public.current_org()::text then raise exception 'bad path'; end if;
  update invoices set pdf_path = p_path where id = p_id and org_id = public.current_org();
end $$;

revoke execute on function public.create_invoice(jsonb) from public;
revoke execute on function public.set_invoice_status(uuid, text, date, text, text) from public;
revoke execute on function public.attach_invoice_pdf(uuid, text) from public;
revoke execute on function public.is_finance() from public;
grant execute on function public.create_invoice(jsonb) to authenticated;
grant execute on function public.set_invoice_status(uuid, text, date, text, text) to authenticated;
grant execute on function public.attach_invoice_pdf(uuid, text) to authenticated;
grant execute on function public.is_finance() to authenticated;

-- admin_user_list v2: adds `finance`. The return type changes, so drop first.
-- Body copied from supabase-setup.sql with the one extra column.
-- NOTE: supabase-setup.sql re-creates the v1 signature on re-run. finance.sql must always
-- be run after it (the runbook says so). Also update supabase-setup.sql's definition
-- to v2 so the two can never disagree: add `p.finance` there with
-- `coalesce` guarded by the column existing, OR move the column add into supabase-setup.sql.
-- DECISION: move `alter table profiles add column if not exists finance` and
-- admin_user_list v2 into supabase-setup.sql itself (additive), and keep only the rest here.
```

**Important follow-through on the NOTE:** put the `profiles.finance` column add and the v2 `admin_user_list` in `supabase-setup.sql`. Put the column add directly after the `disabled` column (line ~51), and change `admin_user_list` in place: `drop function if exists public.admin_user_list();` then recreate it returning `(id uuid, name text, role text, disabled boolean, email text, finance boolean)` and selecting `p.finance`. Remove the `alter table ... finance` line from `finance.sql` (it becomes a no-op either way). Keep `guard_profile_finance` and `is_finance` in `finance.sql`.

Storage (append to `finance.sql`):

```sql
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false) on conflict (id) do nothing;
drop policy if exists invoices_read on storage.objects;
create policy invoices_read on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and (select public.is_active())
         and (storage.foldername(name))[1] = (select public.current_org())::text);
drop policy if exists invoices_insert on storage.objects;
create policy invoices_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and (select public.is_finance())
         and (storage.foldername(name))[1] = (select public.current_org())::text);
```

PO files, in a private bucket that any active member can read and upload to:

```sql
insert into storage.buckets (id, name, public) values ('purchase-orders', 'purchase-orders', false) on conflict (id) do nothing;
drop policy if exists po_files_read on storage.objects;
create policy po_files_read on storage.objects for select to authenticated
  using (bucket_id = 'purchase-orders' and (select public.is_active())
         and (storage.foldername(name))[1] = (select public.current_org())::text);
drop policy if exists po_files_insert on storage.objects;
create policy po_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'purchase-orders' and (select public.is_active())
         and (storage.foldername(name))[1] = (select public.current_org())::text);
```

**Test-order rule for `finance.test.mjs`:** there is no per-test reset, so keep the `po: cancel …` test as the **last** test in the file. Task 3 appends its send tests *above* it, and they consume `items` through `P()`. Then add RLS tests for storage to `finance.test.mjs` (also above the cancel test), copying the upload/download mechanics from `tests/rls/storage.test.mjs`:
- admin uploads `<ORG_A>/t.pdf` → ok;
- plain user (flag off) upload → error;
- plain user download of `<ORG_A>/t.pdf` → ok (CSMs can download);
- adminB download → error.

- [ ] **Step 4: Run in CI**

Push to the draft PR. Wait for the run to finish before pushing again (a new push cancels the running one). Expected: `rls` is all PASS, including every `finance:` test. Then prove the tests bite: temporarily delete the `is_finance()` check from `create_invoice`, push, confirm `plain user without the flag cannot create_invoice` FAILS, restore and push again.

- [ ] **Step 5: Commit**

```bash
git add finance.sql supabase-setup.sql tests/rls/finance.test.mjs tests/rls/fixtures.mjs tests/rls/run.mjs
git commit -m "Finance schema: entities, invoices, RLS, numbering and status RPCs"
```

---

### Task 3: `send_invoice` RPC via the Brevo seam

**Files:**
- Modify: `finance.sql` (append), `tests/rls/finance.test.mjs` (append)

**Interfaces:**
- Consumes: `alert_config` (row 1: `api_key`, `api_base`), `public.alert_post(url, headers, body) returns bigint`, `public.html_escape(text)` (all in `email-alerts.sql`), plus `billing_settings` and `invoices`.
- Produces: `public.send_invoice(p_id uuid, p_pdf_base64 text) returns invoices`. It sets `sent_at` and `sent_by` on success and raises `'email not configured'` when the key or sender is a placeholder.

- [ ] **Step 1: Write failing tests**

Read how `tests/rls/emailalerts.test.mjs` swaps `alert_post` for a recorder (it `create or replace`s it via `sql(...)` and records into a table). Copy that exact recorder setup. If the recorder is created per test, recreate it here. Then:

```js
test("finance: send_invoice posts one Brevo email with the PDF attached and escapes text", async () => {
  // recorder setup copied from emailalerts.test.mjs; it must exist before this point
  await sql("update alert_config set api_key = 'k-test', from_email = 'ops@test.local' where id = 1");
  const me = (await sessions.user.auth.getUser()).data.user.id;
  await sessions.admin.from("profiles").update({ finance: true }).eq("id", me);
  const c = await sessions.user.rpc("create_invoice", { p: P({ account_name: "<script>x</script> Co" }) });
  assert.ifError(c.error);
  const before = (await sql("select count(*)::int n from <recorder table>"))[0].n;
  const s = await sessions.user.rpc("send_invoice", { p_id: c.data.id, p_pdf_base64: "JVBERi0xLjQK" });
  assert.ifError(s.error);
  assert.ok(s.data.sent_at, "sent_at set");
  const rows = await sql("select body from <recorder table> order by 1 desc limit 1");
  assert.equal((await sql("select count(*)::int n from <recorder table>"))[0].n, before + 1);
  const body = rows[0].body;
  assert.equal(body.sender.email, "support@onevio.in");
  assert.deepEqual(body.to, [{ email: "ap@acme.test" }]);
  assert.equal(body.attachment[0].content, "JVBERi0xLjQK");
  assert.equal(body.attachment[0].name, `${c.data.number.replace(/[^A-Za-z0-9-]/g, "_")}.pdf`);
  assert.match(body.htmlContent, /&lt;script&gt;/);
  assert.doesNotMatch(body.htmlContent, /<script>/);
});

test("finance: send_invoice refuses placeholder config and a plain user", async () => {
  const [inv] = await sql("select id from invoices where sent_at is null limit 1");
  await sql("update alert_config set api_key = 'PASTE_YOUR_BREVO_API_KEY' where id = 1");
  const r = await sessions.admin.rpc("send_invoice", { p_id: inv.id, p_pdf_base64: "eA==" });
  assert.match(r.error?.message || "", /email not configured/);
  await sql("update alert_config set api_key = 'k-test' where id = 1");
  const me = (await sessions.user.auth.getUser()).data.user.id;
  await sessions.admin.from("profiles").update({ finance: false }).eq("id", me);
  const r2 = await sessions.user.rpc("send_invoice", { p_id: inv.id, p_pdf_base64: "eA==" });
  assert.match(r2.error?.message || "", /finance access required/);
  // leave config as emailalerts tests expect: restore whatever that file's later tests assume
});
```

Replace `<recorder table>` with the real table name from `emailalerts.test.mjs` before committing. Restore `alert_config` to the values the later test files expect. Because there is no per-test reset, read what `emailalerts.test.mjs` sets and leave it the same.

- [ ] **Step 2: Verify failure in CI** (draft PR push). Expected: `function send_invoice does not exist`.

- [ ] **Step 3: Implement (append to `finance.sql`)**

```sql
-- language plpgsql (alert_post may call pg_net; see email-alerts.sql's seam comment).
create or replace function public.send_invoice(p_id uuid, p_pdf_base64 text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare cfg alert_config; bs billing_settings; inv invoices; e billing_entities; po purchase_orders; req bigint;
begin
  if not public.is_finance() then raise exception 'finance access required'; end if;
  select * into cfg from alert_config where id = 1;
  select * into bs from billing_settings where org_id = public.current_org();
  if cfg is null or cfg.api_key like 'PASTE%' or bs is null or coalesce(bs.sender_email, '') = '' then
    raise exception 'email not configured: set the Brevo key (alert_config) and the billing sender (Settings → Billing)';
  end if;
  select * into inv from invoices where id = p_id and org_id = public.current_org();
  if inv is null then raise exception 'invoice not found'; end if;
  if inv.status = 'waived' then raise exception 'invoice is waived'; end if;
  if coalesce(p_pdf_base64, '') = '' then raise exception 'pdf required'; end if;
  select * into e from billing_entities where id = inv.entity_id;
  select * into po from purchase_orders where id = inv.po_id;
  req := public.alert_post(cfg.api_base,
    jsonb_build_object('api-key', cfg.api_key, 'content-type', 'application/json', 'accept', 'application/json'),
    jsonb_strip_nulls(jsonb_build_object(
      'sender', jsonb_build_object('email', bs.sender_email, 'name', bs.sender_name),
      'to', jsonb_build_array(jsonb_build_object('email', inv.sent_to)),
      'cc', case when inv.sent_cc is not null then jsonb_build_array(jsonb_build_object('email', inv.sent_cc)) end,
      'subject', format('Invoice %s (PO %s) from %s', inv.number, po.po_number, e.name),
      'htmlContent', format('<p>Dear %s,</p><p>Please find attached invoice <b>%s</b> against PO <b>%s</b> for %s %s, due on %s.</p><p>Regards,<br>%s</p>',
         html_escape(inv.account_name), html_escape(inv.number), html_escape(po.po_number), inv.currency, to_char(inv.total, 'FM999,999,999,990.00'),
         to_char(inv.due_date, 'DD Mon YYYY'), html_escape(e.name)),
      'attachment', jsonb_build_array(jsonb_build_object(
         'name', regexp_replace(inv.number, '[^A-Za-z0-9-]', '_', 'g') || '.pdf', 'content', p_pdf_base64)))));
  if req is null then raise exception 'send failed: no request id'; end if;
  update invoices set sent_at = now(), sent_by = auth.uid() where id = inv.id returning * into inv;
  return inv;
end $$;
revoke execute on function public.send_invoice(uuid, text) from public;
grant execute on function public.send_invoice(uuid, text) to authenticated;
```

**PO decision emails.** In `finance.sql`, define `notify_po_decision` **above** `approve_po` (Task 2's block; `alert_config`, `alert_post` and `html_escape` already exist because `email-alerts.sql` runs first). Edit `approve_po` and `reject_po` to call `perform public.notify_po_decision(po);` right before `return po;`. Do not redefine them a second time.

```sql
-- Best effort: a missing Brevo config or an unknown submitter address must NOT block the
-- approval itself, so this swallows its own errors into error_log, the same way
-- send_alerts guards per recipient. Uses log_error_system if present (email-alerts.sql).
create or replace function public.notify_po_decision(po purchase_orders)
returns void language plpgsql security definer set search_path = public, auth as $$
declare cfg alert_config; bs billing_settings; addr text;
begin
  select * into cfg from alert_config where id = 1;
  select * into bs from billing_settings where org_id = po.org_id;
  select email into addr from auth.users where id = po.submitted_by;
  if cfg is null or cfg.api_key like 'PASTE%' or bs is null or addr is null then return; end if;
  perform public.alert_post(cfg.api_base,
    jsonb_build_object('api-key', cfg.api_key, 'content-type', 'application/json', 'accept', 'application/json'),
    jsonb_build_object('sender', jsonb_build_object('email', bs.sender_email, 'name', bs.sender_name),
      'to', jsonb_build_array(jsonb_build_object('email', addr)),
      'subject', format('[OneVio] PO %s for %s was %s', po.po_number, po.account_name, po.status),
      'htmlContent', format('<p>PO <b>%s</b> for <b>%s</b> (%s %s) was <b>%s</b>.</p>%s',
         html_escape(po.po_number), html_escape(po.account_name), po.currency, to_char(po.po_value, 'FM999,999,999,990.00'), po.status,
         case when po.status = 'rejected' then format('<p>Reason: %s</p><p>Edit the PO on the account and resubmit.</p>', html_escape(po.reject_reason)) else '' end)));
exception when others then
  begin perform public.log_error_system('notify_po_decision', sqlerrm); exception when others then null; end;
end $$;
revoke execute on function public.notify_po_decision(purchase_orders) from public;
```

Check the real name and signature of the system error logger in `email-alerts.sql` (grep `log_error_system`) and match it.

Tests (append to `finance.test.mjs` above the cancel test, using the same recorder): reject a fresh PO with the reason `<b>bad</b>` → one recorded post to the submitter's email, subject containing `was rejected`, and `htmlContent` containing `&lt;b&gt;bad&lt;/b&gt;`. With `alert_config.api_key` set to the placeholder, `reject_po` **still succeeds** and records no post.

Note: pg_net is asynchronous. A Brevo-side rejection (bad sender, quota) is not visible here, exactly as with alerts. The runbook tells the operator to check `net._http_response` after the first live send.

- [ ] **Step 4: CI green**, then prove the escape test bites: replace `html_escape(inv.account_name)` with `inv.account_name`, push, watch that test fail, then restore.

- [ ] **Step 5: Commit**

```bash
git add finance.sql tests/rls/finance.test.mjs
git commit -m "send_invoice: email the PDF through the Brevo seam"
```

---

### Task 4: Settings: Finance toggle on users, Billing entities and sender

**Files:**
- Modify: `src/25-auth-admin.jsx` (user rows, around lines 445-465), `src/24-settings.jsx` (nav list line ~188 and sections around line 261)
- Modify: `src/26-app.jsx:526` profile select → add `finance`. Also `src/06-write-queue.jsx:25` `profiles` select → add `finance` so `st.team` carries it.
- Test: `tests/health/finance.test.mjs` (create; register in `tests/health/run.mjs`)

**Interfaces:**
- Consumes: `admin_user_list` (now has `finance`), table `billing_entities`, `billing_settings`, `canFinance` (lib).
- Produces: `BillingSettingsCard` component (in `src/24-settings.jsx`), `data-*` hooks: `data-finance-toggle` on each user row (`aria-pressed`), `data-billing-entity-row`, `data-billing-entity-form`, `data-billing-sender`.

- [ ] **Step 1: Read the harness first**

Read `tests/health/harness.mjs`, `framework.mjs` and one existing Settings test (`settings.test.mjs`) to learn the in-memory Supabase mock: how `from()`, `rpc()` and `storage` are stubbed and how a test overrides them. If the mock has no generic `rpc(name)` routing or no `from("billing_entities")`, extend it in `harness.mjs` with a table map (additive). Mock RPCs needed later: `admin_user_list`, `create_invoice` (must also set the schedule item's `invoice_id`, like SQL), `send_invoice`, `set_invoice_status`, `attach_invoice_pdf`, `approve_po` (builds rows with lib `buildSchedule`), `reject_po`, `cancel_po`. Mock tables: `billing_entities`, `billing_settings`, `invoices`, `purchase_orders`, `po_schedule`. Mock storage: buckets `invoices` and `purchase-orders` (`upload`, `download`, `createSignedUrl`). Record every rpc call on `window.__rpcCalls` so tests can assert on them.

- [ ] **Step 2: Failing health tests**

```js
// tests/health/finance.test.mjs  (structure per framework.mjs; adapt the page-open helper name)
test("finance settings: admin toggles finance access on a user", async () => {
  const page = await openApp({ user: { role: "admin" }, users: [{ id: "u2", name: "Priya", role: "user", finance: false, email: "p@x.test" }] });
  await gotoSettings(page);
  const btn = page.locator('[data-user-id="u2"] [data-finance-toggle]');
  assert.equal(await btn.getAttribute("aria-pressed"), "false");
  await btn.click();
  await page.waitForFunction(() => window.__mockDb.profiles.find(p => p.id === "u2")?.finance === true);
  assert.equal(await btn.getAttribute("aria-pressed"), "true");
});
test("finance settings: admin adds a billing entity", async () => {
  const page = await openApp({ user: { role: "admin" } });
  await gotoSettings(page);
  const f = page.locator("[data-billing-entity-form]");
  await f.locator('[name="name"]').fill("OneVio PH Inc");
  await f.locator('[name="country"]').selectOption("PH");
  await f.locator('[name="invoice_prefix"]').fill("PH-");
  await f.locator('button[type="submit"]').click();
  await page.waitForSelector('[data-billing-entity-row]:has-text("OneVio PH Inc")');
  const e = await page.evaluate(() => window.__mockDb.billing_entities.at(-1));
  assert.equal(e.currency, "PHP");          // currency defaults from country
  assert.equal(Number(e.default_tax_pct), 12);
});
```

Add a `data-user-id={u.id}` attribute on each user row div if none exists.

- [ ] **Step 3: Implement**

In `src/25-auth-admin.jsx`, next to the role badge:

```jsx
<button data-finance-toggle aria-pressed={u.finance ? "true" : "false"} title="Finance access: create, send and mark invoices"
  className={`rounded px-1.5 py-0.5 text-xs font-semibold ${u.finance ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
  onClick={() => setFinance(u, !u.finance)}>{u.finance ? "finance ✓" : "finance"}</button>
```

with

```jsx
const setFinance = async (u, finance) => {
  setErr(""); setMsg("");
  const { error } = await sb.from("profiles").update({ finance }).eq("id", u.id);
  if (error) setErr(error.message); else load();
};
```

In `src/24-settings.jsx`, add a `["Billing", "set-billing"]` nav entry (admin only, like Error log) and a section `<div id="set-billing"><BillingSettingsCard /></div>`. `BillingSettingsCard`:
- loads `billing_entities` (ordered by `created_at`) and `billing_settings` (single row);
- lists each entity as `data-billing-entity-row` with name, country, currency, prefix and next number, plus an edit button that fills the form;
- the form (`data-billing-entity-form`) has fields `name`, `country` (select IN/US/PH), `address`, `state` (shown when IN), `tax_id`, `tax_id_label`, `currency`, `bank_details` (textarea), `invoice_prefix`, `default_tax_pct`, `lut_number` (IN only). Changing `country` sets `currency` and `default_tax_pct` to `{IN:["INR",18],US:["USD",0],PH:["PHP",12]}` unless the user already edited them. Submit runs `insert` or `update` and reloads, surfacing `error.message` in the same rose box style as Users;
- the sender row (`data-billing-sender`) has an email input and a Save button that updates `billing_settings`.

Use the existing `Card`, `Input`, `Select`, `Btn` atoms. `Card` does not forward `data-*`, so put the attribute on an inner div.

- [ ] **Step 4: Run** `npm run build`, then `node tests/health/run-one.mjs finance` (check `run-one.mjs` usage) → PASS. Then the full suite: `node tests/health/run.mjs > %TEMP%\health.log 2>&1` → 0 failures (never pipe).

- [ ] **Step 5: Commit** `git commit -m "Settings: finance access toggle, billing entities and sender"`

---

### Task 5: Account billing fields and the Invoices tab

**Files:**
- Create: `src/14-invoices.jsx`
- Modify: the account form in `src/13-forms.jsx` (find the account form component: search `AccountForm`), `src/21-account-detail.jsx` (tab list)
- Test: `tests/health/finance.test.mjs` (append)

**Interfaces:**
- Consumes: `invoiceStatus`, `canFinance` (lib); tables `invoices`, `billing_entities`; RPC `set_invoice_status`; storage bucket `invoices`.
- Produces (globals in `src/14-invoices.jsx`):
  - `useInvoices(filter?: {accountId?: string}) → { invoices, entities, reload, loading, error }`
  - `InvoiceTable({ invoices, entities, user, onChanged, showAccount, openAccount })`: rows `data-invoice-row={inv.number}`, checkbox `data-paid-checkbox`, status pill `data-invoice-status`
  - `MarkPaidDialog({ inv, onDone, onClose })`, `WaiveDialog({ inv, onDone, onClose })`
  - `downloadInvoice(inv)` (signed URL via `sb.storage.from("invoices").createSignedUrl(path, 60)`, then opens it)
  - `resendInvoice(inv) → Promise<invoice>` (downloads the blob, base64-encodes it, calls `send_invoice`)
  - `blobToBase64(blob) → Promise<string>` (shared with Task 6)
  - `todayISO()`: use the existing date helper from `src/lib/dates.js` if one exists (grep `today`). Otherwise define a local `const invToday = () => new Date().toISOString().slice(0, 10)`. Do not redeclare a lib name.

- [ ] **Step 1: Failing health tests**

```js
test("account invoices tab: lists history; CSM sees no Paid checkbox but can download", async () => {
  const page = await openApp({ user: { role: "user", finance: false }, invoices: [
    { id: "i1", account_id: "a1", number: "IN-0001", currency: "INR", total: 1180, status: "pending", sent_at: "2026-10-01T00:00:00Z", due_date: "2026-10-05", issue_date: "2026-10-01", pdf_path: "org/i1.pdf", entity_id: "e1" },
    { id: "i2", account_id: "a1", number: "IN-0002", currency: "INR", total: 500, status: "paid", paid_date: "2026-10-02", sent_at: "x", due_date: "2026-11-01", issue_date: "2026-10-01", pdf_path: "org/i2.pdf", entity_id: "e1" },
    { id: "i3", account_id: "a2", number: "IN-0003", currency: "INR", total: 9, status: "pending", sent_at: "x", due_date: "2026-11-01", issue_date: "2026-10-01", entity_id: "e1" }] });
  await openAccountTab(page, "a1", "Invoices");
  assert.equal(await page.locator("[data-invoice-row]").count(), 2);         // a2's invoice excluded
  assert.equal(await page.locator('[data-invoice-row="IN-0001"] [data-invoice-status]').innerText(), "Overdue");
  assert.equal(await page.locator("[data-paid-checkbox]").count(), 0);
  assert.equal(await page.locator('[data-invoice-row="IN-0001"] [data-download]').count(), 1);
});
test("finance user marks paid with date and reference; uncheck reverts after confirm", async () => {
  const page = await openApp({ user: { role: "user", finance: true }, invoices: [/* IN-0001 pending, as above */] });
  await openAccountTab(page, "a1", "Invoices");
  await page.locator('[data-invoice-row="IN-0001"] [data-paid-checkbox]').check();
  await page.locator("[data-paid-ref]").fill("UTR-77");
  await page.locator("[data-paid-confirm]").click();
  await page.waitForFunction(() => window.__rpcCalls.some(c => c.name === "set_invoice_status" && c.args.p_status === "paid" && c.args.p_ref === "UTR-77" && c.args.p_paid_date));
  await page.waitForSelector('[data-invoice-row="IN-0001"] [data-invoice-status]:has-text("Paid")');
});
test("waive requires a reason", async () => {
  // open waive dialog on IN-0001, click confirm with empty reason -> button disabled / no rpc; fill reason -> rpc with p_reason
});
```

Write out the waive test body in full: assert `[data-waive-confirm]` is disabled while the reason is blank, then fill `"Goodwill credit"`, click, and assert the RPC call carries `p_reason: "Goodwill credit"`. Assert the account form test separately: edit account a1, set `[name="billingEmail"]` to `ap@acme.test` and `[name="country"]` to `IN`, save, and check that `window.__store.getState().accounts.find(a=>a.id==="a1").billingEmail === "ap@acme.test"`. Wait 50ms inside `evaluate` before reading the store (memory: store-read timing).

- [ ] **Step 2: Run** → FAIL (no Invoices tab).

- [ ] **Step 3: Implement**

Account form: add a collapsible "Billing" fieldset with `country` (select: blank/IN/US/PH), `billingEntityId` (select from `billing_entities`, blank meaning "Auto from country"), `billingEmail`, `billingAddress` (textarea), `customerTaxId`, `customerState` (only when the country is IN), `taxExempt` (checkbox "Tax exempt") and `taxExemptNote` (shown when exempt). Save through the existing account-save path, so the fields land in `accounts.data`. Blank values are stored as `""`, never deleted. Do not add these fields to the CSV import/export columns (out of scope; keeps the CSV contract unchanged).

`src/14-invoices.jsx` core:

```jsx
function useInvoices(filter) {
  const [state, setState] = useState({ invoices: [], entities: [], loading: true, error: "" });
  const accountId = filter && filter.accountId;
  const reload = React.useCallback(async () => {
    let q = sb.from("invoices").select("*").order("issue_date", { ascending: false }).order("number", { ascending: false });
    if (accountId) q = q.eq("account_id", accountId);
    const [inv, ent] = await Promise.all([q, sb.from("billing_entities").select("*")]);
    setState({ invoices: inv.data || [], entities: ent.data || [], loading: false, error: (inv.error || ent.error)?.message || "" });
  }, [accountId]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

const STATUS_PILL = { paid: ["Paid", "bg-emerald-50 text-emerald-700"], waived: ["Waived", "bg-slate-100 text-slate-600"],
  overdue: ["Overdue", "bg-rose-50 text-rose-700"], pending: ["Pending", "bg-amber-50 text-amber-700"], unsent: ["Unsent", "bg-indigo-50 text-indigo-700"] };

function InvoiceTable({ invoices, entities, user, onChanged, showAccount, openAccount }) {
  const fin = canFinance(user);
  const [paying, setPaying] = useState(null), [waiving, setWaiving] = useState(null), [reverting, setReverting] = useState(null);
  const today = invToday();
  if (!invoices.length) return <div className="p-4 text-sm text-slate-500" data-invoices-empty>No invoices yet.</div>;
  return <div className="overflow-x-auto"><table className="w-full text-sm">
    <thead><tr className="text-left text-xs text-slate-500">
      {fin && <th className="p-2">Paid</th>}<th className="p-2">Number</th>{showAccount && <th className="p-2">Account</th>}
      <th className="p-2">Issued</th><th className="p-2">Due</th><th className="p-2 text-right">Amount</th><th className="p-2">Status</th><th className="p-2"></th></tr></thead>
    <tbody>{invoices.map(inv => {
      const st = invoiceStatus(inv, today), [label, cls] = STATUS_PILL[st];
      return <tr key={inv.id} data-invoice-row={inv.number} className="border-t border-slate-100">
        {fin && <td className="p-2"><input type="checkbox" data-paid-checkbox aria-label={`Paid ${inv.number}`}
          checked={inv.status === "paid"} disabled={inv.status === "waived" || !inv.sent_at}
          onChange={e => e.target.checked ? setPaying(inv) : setReverting(inv)} /></td>}
        <td className="p-2 font-medium">{inv.number}</td>
        {showAccount && <td className="p-2"><button className="text-indigo-600 hover:underline" onClick={() => openAccount(inv.account_id)}>{inv.account_name}</button></td>}
        <td className="p-2 tabular-nums">{inv.issue_date}</td><td className="p-2 tabular-nums">{inv.due_date}</td>
        <td className="p-2 text-right tabular-nums">{inv.currency} {Number(inv.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
        <td className="p-2"><span data-invoice-status className={`rounded px-1.5 py-0.5 text-xs font-semibold ${cls}`} title={inv.waive_reason || inv.payment_ref || ""}>{label}</span></td>
        <td className="p-2 whitespace-nowrap text-xs">
          {inv.pdf_path && <button data-download className="text-indigo-600 hover:underline" onClick={() => downloadInvoice(inv)}>PDF</button>}
          {fin && inv.status === "pending" && inv.pdf_path && <button data-resend className="ml-2 text-indigo-600 hover:underline"
            onClick={async () => { try { await resendInvoice(inv); toast(`${inv.number} sent`); onChanged(); } catch (e) { toast(e.message, "error"); } }}>
            {inv.sent_at ? "Re-send" : "Retry send"}</button>}
          {fin && inv.status === "pending" && <button data-waive className="ml-2 text-rose-500 hover:underline" onClick={() => setWaiving(inv)}>Waive</button>}
        </td></tr>; })}</tbody></table>
    {paying && <MarkPaidDialog inv={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); onChanged(); }} />}
    {waiving && <WaiveDialog inv={waiving} onClose={() => setWaiving(null)} onDone={() => { setWaiving(null); onChanged(); }} />}
    {reverting && <ConfirmDialog title={`Mark ${reverting.number} as not paid?`} body="It goes back to Pending and the payment date and reference are cleared."
      confirmLabel="Mark unpaid" onCancel={() => setReverting(null)}
      onConfirm={async () => { await setStatus(reverting, "pending"); setReverting(null); onChanged(); }} />}
  </div>;
}

async function setStatus(inv, status, extra = {}) {
  const { error } = await sb.rpc("set_invoice_status", { p_id: inv.id, p_status: status,
    p_paid_date: extra.paidDate || null, p_ref: extra.ref || null, p_reason: extra.reason || null });
  if (error) { toast(error.message, "error"); throw error; }
}
```

Before using them, check the real names and props of the toast helper (`src/11-toasts.jsx`) and `ConfirmDialog` (prop names: `onCancel` vs `onClose`). `MarkPaidDialog` has a date input (default today) with `data-paid-date`, a reference input `data-paid-ref`, and a confirm button `data-paid-confirm` that calls `setStatus(inv, "paid", {paidDate, ref})`. `WaiveDialog` has a reason textarea `data-waive-reason` and a `data-waive-confirm` button that is disabled while `!reason.trim()`. Discarding an unsent invoice uses the same dialog: a pending invoice with no `sent_at` shows the Waive action labelled "Discard" with the reason prefilled as "Discarded before sending".

```jsx
function blobToBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
}
async function downloadInvoice(inv) {
  const { data, error } = await sb.storage.from("invoices").createSignedUrl(inv.pdf_path, 60);
  if (error) return toast(error.message, "error");
  window.open(data.signedUrl, "_blank", "noopener");
}
async function resendInvoice(inv) {
  const { data, error } = await sb.storage.from("invoices").download(inv.pdf_path);
  if (error) throw error;
  const r = await sb.rpc("send_invoice", { p_id: inv.id, p_pdf_base64: await blobToBase64(data) });
  if (r.error) throw r.error;
  return r.data;
}
```

Account detail: add an `Invoices` tab, following the existing tab mechanism in `21-account-detail.jsx`. Its body is:

```jsx
function AccountInvoices({ account, user }) {
  const { invoices, entities, reload } = useInvoices({ accountId: account.id });
  return <InvoiceTable invoices={invoices} entities={entities} user={user} onChanged={reload} />;
}
```

There is deliberately **no** "New invoice" button. Invoices are raised only from a PO schedule item (Tasks 5B and 6).

- [ ] **Step 4: Run** the build, `run-one finance`, then the full suite → PASS.
- [ ] **Step 5: Commit** `git commit -m "Account billing fields and Invoices tab"`

---

### Task 5B: Purchase orders: account tab, submit/resubmit, and the approval queue

**Files:**
- Create: `src/14-purchase-orders.jsx`
- Modify: `src/21-account-detail.jsx` (add a "Purchase orders" tab next to Invoices)
- Test: `tests/health/finance.test.mjs` (append). The harness mock from Task 4 needs the `purchase_orders` and `po_schedule` tables, RPCs `approve_po`, `reject_po` and `cancel_po`, and the `purchase-orders` storage bucket. The mock `approve_po` must build rows with the **lib** `buildSchedule`, so mock and real stay consistent.

**Interfaces:**
- Consumes: `buildSchedule`, `periodLabel`, `canFinance`, `invoiceStatus` (lib); `useInvoices` (Task 5).
- Produces (globals):
  - `usePurchaseOrders(filter?: {accountId?, status?}) → { pos, schedule, reload, error }` (`schedule` = all `po_schedule` rows for the loaded POs)
  - `AccountPurchaseOrders({ account, user })`: list plus a `data-po-submit` button. Rows are `data-po-row={po_number}` with `data-po-status` and `data-po-invoiced` ("2 of 8 raised").
  - `POForm({ account, existing?, onClose, onSaved })`: fields `data-po-file`, `[name=po_number|po_date|po_value|currency|years|billing_cycle|billing_start]`, a `data-po-preview` schedule table, and `data-po-submit-confirm`
  - `POReview({ po, user, onClose, onDone })`: `data-po-view-file`, `data-po-amount` inputs, `data-po-amount-total`, a `data-po-mismatch` warning with a confirm checkbox `data-po-mismatch-ok`, `data-po-approve`, `data-po-reject-reason`, `data-po-reject`
  - `POQueue({ user, openAccount })`: submitted POs, used by the Finance page (Task 7)

- [ ] **Step 1: Failing health tests**

```js
test("po: CSM submits a PO with a file; preview shows 8 quarterly periods", async () => {
  const page = await openApp({ user: { role: "user", finance: false } });
  await openAccountTab(page, "a1", "Purchase orders");
  await page.click("[data-po-submit]");
  await page.setInputFiles("[data-po-file]", { name: "po.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await page.fill('[name="po_number"]', "4500123");
  await page.fill('[name="po_value"]', "800000");
  await page.fill('[name="years"]', "2");
  await page.selectOption('[name="billing_cycle"]', "quarterly");
  await page.fill('[name="billing_start"]', "2026-11-01");
  assert.equal(await page.locator("[data-po-preview] tr[data-period]").count(), 8);
  await page.click("[data-po-submit-confirm]");
  await page.waitForSelector('[data-po-row="4500123"] [data-po-status]:has-text("Awaiting approval")');
  const po = await page.evaluate(() => window.__mockDb.purchase_orders.at(-1));
  assert.match(po.file_path, /^[^/]+\/a1\/.+\.pdf$/);   // <org>/<account>/<uuid>.pdf
  assert.equal(await page.locator("[data-po-approve]").count(), 0);   // CSM never sees approve
});
test("po: submit blocked without file, number or a valid schedule", async () => {
  // open form, fill nothing -> [data-po-submit-confirm] disabled; fill all but file -> still disabled;
  // years 0 -> disabled and [data-po-preview] shows "Enter value, years, cycle and start date"
});
test("po: finance edits amounts, mismatch needs confirmation, approve creates schedule", async () => {
  // seed a submitted PO (800000, 2y quarterly). Finance user opens Finance page queue -> [data-po-review]
  // change the first [data-po-amount] to 150000 -> [data-po-mismatch] visible, [data-po-approve] disabled
  // tick [data-po-mismatch-ok] -> enabled; click -> rpc approve_po with p_amounts[0] === 150000 and p_confirm_mismatch true
  // the PO row now shows "Approved" and "0 of 8 raised"
});
test("po: reject requires a reason; CSM sees the reason and can resubmit", async () => {
  // finance rejects with "Wrong value" -> rpc reject_po; as CSM the row shows "Rejected — Wrong value" and an Edit button;
  // Edit -> POForm prefilled -> change value -> submit -> update sent with status 'submitted', reviewed_by null, reject_reason null
});
```

Write the three outlined tests in full, in the same style as the first.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

`POForm` upload and save:

```jsx
async function savePO({ account, existing, file, v }) {
  let file_path = existing?.file_path;
  if (file) {
    if (file.size > 10 * 1024 * 1024) throw new Error("PO file is over 10 MB.");
    const org = (await sb.rpc("current_org")).data;   // if no such RPC is exposed, read org_id from the user's profile instead
    file_path = `${org}/${account.id}/${crypto.randomUUID()}.${(file.name.split(".").pop() || "pdf").toLowerCase()}`;
    const up = await sb.storage.from("purchase-orders").upload(file_path, file, { contentType: file.type || "application/pdf" });
    if (up.error) throw up.error;
  }
  const row = { account_id: account.id, account_name: account.name, po_number: v.po_number.trim(), po_date: v.po_date,
    po_value: Number(v.po_value), currency: v.currency, years: Number(v.years), billing_cycle: v.billing_cycle,
    billing_start: v.billing_start, file_path, status: "submitted", reviewed_by: null, reject_reason: null };
  const q = existing ? sb.from("purchase_orders").update(row).eq("id", existing.id) : sb.from("purchase_orders").insert(row);
  const { data, error } = await q.select().single();
  if (error) throw new Error(/purchase_orders_live_number/.test(error.message) ? `PO ${row.po_number} already exists on this account.` : error.message);
  return data;
}
```

Check how the app learns the user's `org_id`: `26-app.jsx:526` selects it into the profile, so pass `user.org_id` down instead of the RPC call if it is on `user`. Defaults: `po_date` and `billing_start` = today, `currency` = the account's currency if it is INR/USD/PHP, `years` = 1, cycle `annual`. The preview is `buildSchedule(v)` rendered as `tr[data-period]` rows (label from `periodLabel`, dates, amount). The submit button is disabled unless there is a file (or `existing`), a trimmed PO number and a non-empty preview.

`POReview`: the amounts state starts from `buildSchedule(po)` amounts. `total` is the integer-cents sum. `mismatch = total !== po_value`. Approve calls `sb.rpc("approve_po", { p_id, p_amounts: edited ? amounts : null, p_confirm_mismatch: mismatchOk })`. Reject calls `reject_po` with the reason (button disabled while the reason is blank). The file link uses `sb.storage.from("purchase-orders").createSignedUrl(po.file_path, 60)`. Finance users also see **Cancel PO** on approved POs (ConfirmDialog: "Removes N un-raised periods. Invoices already raised are kept." where N = un-raised count) → `cancel_po`.

Status pill labels: submitted → "Awaiting approval", approved → "Approved", rejected → "Rejected — <reason>", cancelled → "Cancelled".

- [ ] **Step 4: Run** the build, `run-one finance`, then the full suite → PASS.
- [ ] **Step 5: Commit** `git commit -m "Purchase orders: submit, review, approve/reject, cancel"`

---

### Task 6: PDF rendering, Raise-invoice form and the send flow

**Files:**
- Create: `vendor/jspdf.umd.min.js`, `src/27-invoice-form.jsx`
- Modify: `build.mjs` (append to `vendorJs` list, line ~142), `crm.html`. The dev shell must load jsPDF wherever it loads React today: grep `react.production` in `crm.html` and the health harness, and mirror it.
- Test: `tests/health/finance.test.mjs` (append)

**Interfaces:**
- Consumes: `computeTotals`, `scheduleLineItem`, `defaultEntityFor`, `canFinance` (lib); `blobToBase64`, `useInvoices` (Task 5); a `po` row and a `po_schedule` item (Task 5B); RPCs `create_invoice`, `attach_invoice_pdf`, `send_invoice`; `window.jspdf.jsPDF`.
- Produces: `renderInvoicePdf({ inv, entity, account, po }) → Blob`, `InvoiceForm({ po, item, account, entities, user, onClose, onSent })` (opened only from a Due-to-raise item). Hooks: `data-invoice-form`, `data-line-desc|qty|rate`, `data-add-line`, `data-inv-total`, `data-inv-send`, `data-inv-block` (blocking message).

- [ ] **Step 1: Vendor jsPDF**

```bash
npm view jspdf@2.5.1 dist.tarball
curl -L -o %TEMP%\jspdf.tgz <that url>
tar -xzf %TEMP%\jspdf.tgz -C %TEMP%   # extracts package/
copy %TEMP%\package\dist\jspdf.umd.min.js vendor\jspdf.umd.min.js
```

Add `"vendor/jspdf.umd.min.js"` to `vendorJs` in `build.mjs`. Run `npm run build` and confirm the size line grows by roughly 350 KB. In a browser console on `dist/crm.html`, `typeof window.jspdf.jsPDF === "function"`.

- [ ] **Step 2: Failing health tests**

```js
// Fixture: APPROVED_PO = { id: "po1", account_id: "a1", account_name: "Acme", po_number: "4500123", currency: "INR", po_value: 480000,
//   years: 1, billing_cycle: "quarterly", billing_start: "2026-10-01", status: "approved" }
// ITEMS = buildSchedule(APPROVED_PO) mapped to { id: `s${seq}`, po_id: "po1", org_id, invoice_id: null, ...row }
// The clock is pinned to 2026-10-12, so only s1 (2026-10-01) is due.
test("raise invoice: Apply tax defaults off for a tax-exempt account and can be toggled", async () => {
  const page = await openApp({ user: { role: "user", finance: true }, entities: [IN_ENTITY], pos: [APPROVED_PO], schedule: ITEMS,
    accountPatch: { a1: { country: "IN", customerState: "Karnataka", billingEmail: "ap@acme.test", taxExempt: true, taxExemptNote: "SEZ unit" } } });
  await openFinance(page);
  await page.click('[data-due-item="s1"] [data-raise]');
  assert.equal(await page.isChecked("[data-apply-tax]"), false);
  assert.match(await page.innerText("[data-inv-total]"), /120,000\.00/);
  assert.match(await page.innerText("[data-invoice-form]"), /SEZ unit/);
  await page.check("[data-apply-tax]");
  assert.match(await page.innerText("[data-inv-total]"), /141,600\.00/);
  await page.uncheck("[data-apply-tax]");
  await page.click("[data-inv-send]");
  await page.waitForFunction(() => window.__rpcCalls.some(c => c.name === "create_invoice" && c.args.p.tax_exempt === true && c.args.p.tax_lines.length === 0));
});
test("raise invoice: blocks without billing email", async () => {
  const page = await openApp({ user: { role: "user", finance: true }, entities: [IN_ENTITY], pos: [APPROVED_PO], schedule: ITEMS,
    accountPatch: { a1: { country: "IN", billingEmail: "" } } });
  await openFinance(page);
  await page.click('[data-due-item="s1"] [data-raise]');
  await page.waitForSelector("[data-inv-block]:has-text('billing email')");
  assert.equal(await page.locator("[data-inv-send]").isDisabled(), true);
});
test("raise invoice: only started periods are due; prefills from the PO item, computes GST, sends", async () => {
  const page = await openApp({ user: { role: "user", finance: true }, entities: [IN_ENTITY /* state Maharashtra, prefix IN- */],
    pos: [APPROVED_PO], schedule: ITEMS,
    accountPatch: { a1: { country: "IN", customerState: "Karnataka", billingEmail: "ap@acme.test", currency: "INR" } } });
  await openFinance(page);
  assert.equal(await page.locator("[data-due-item]").count(), 1);
  await page.click('[data-due-item="s1"] [data-raise]');
  assert.match(await page.inputValue("[data-line-desc]"), /Year 1 Q1 \(2026-10-01 – 2026-12-31\), PO 4500123/);
  assert.equal(await page.inputValue("[data-line-rate]"), "120000");
  assert.match(await page.innerText("[data-invoice-form]"), /IGST 18%/);
  assert.match(await page.innerText("[data-inv-total]"), /141,600\.00/);   // 120000 + 18%
  // after send (below), assert create_invoice args carry schedule_id "s1" and the due list is empty
  await page.click("[data-inv-send]");
  await page.waitForFunction(() => ["create_invoice", "attach_invoice_pdf", "send_invoice"].every(n => window.__rpcCalls.some(c => c.name === n)));
  const order = await page.evaluate(() => window.__rpcCalls.map(c => c.name).filter(n => /invoice/.test(n)));
  assert.deepEqual(order.slice(-3), ["create_invoice", "attach_invoice_pdf", "send_invoice"]);
  const send = await page.evaluate(() => window.__rpcCalls.find(c => c.name === "send_invoice").args);
  assert.ok(atob(send.p_pdf_base64).startsWith("%PDF"), "a real PDF was attached");
  await page.waitForSelector('[data-invoice-row="IN-0001"]');
});
test("new invoice: send failure leaves an Unsent invoice with Retry", async () => {
  // mock send_invoice to return { error: { message: "Brevo down" } }
  // after clicking send: toast shows "Brevo down", the form stays open with a message, list shows
  // [data-invoice-row="IN-0001"] [data-invoice-status] = "Unsent" and a [data-resend] "Retry send" button
});
```

Write the third test in full, using the harness's mock-override mechanism found in Task 4 Step 1.

- [ ] **Step 3: Implement `src/27-invoice-form.jsx`**

```jsx
function renderInvoicePdf({ inv, entity, account, po }) {
  const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
  const money = n => `${inv.currency} ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  let y = 50;
  doc.setFont("helvetica", "bold").setFontSize(16).text(entity.name, 40, y);
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(doc.splitTextToSize(entity.address || "", 260), 40, (y += 16));
  if (entity.tax_id) doc.text(`${entity.tax_id_label || "Tax ID"}: ${entity.tax_id}`, 40, (y += 30));
  doc.setFont("helvetica", "bold").setFontSize(20).text("INVOICE", 555, 50, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(10)
    .text([`No. ${inv.number}`, `Date ${inv.issue_date}`, `Due ${inv.due_date}`, `PO ${po.po_number}`], 555, 70, { align: "right" });
  y = 150;
  doc.setFont("helvetica", "bold").text("Bill to", 40, y);
  doc.setFont("helvetica", "normal").text(doc.splitTextToSize(
    [inv.account_name, account.billingAddress || "", account.customerTaxId ? `Tax ID: ${account.customerTaxId}` : ""].filter(Boolean).join("\n"), 300), 40, (y += 14));
  y = 230;
  doc.setFont("helvetica", "bold").text("Description", 40, y).text("Qty", 360, y, { align: "right" })
    .text("Rate", 450, y, { align: "right" }).text("Amount", 555, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  for (const l of inv.line_items) {
    const desc = doc.splitTextToSize(l.description, 290);
    y += 18; if (y > 720) { doc.addPage(); y = 60; }
    doc.text(desc, 40, y).text(String(l.qty), 360, y, { align: "right" })
      .text(money(l.rate), 450, y, { align: "right" }).text(money(l.amount), 555, y, { align: "right" });
    y += (desc.length - 1) * 12;
  }
  y += 24;
  const row = (label, val, bold) => { doc.setFont("helvetica", bold ? "bold" : "normal").text(label, 450, y, { align: "right" }).text(val, 555, y, { align: "right" }); y += 16; };
  row("Subtotal", money(inv.subtotal));
  for (const t of inv.tax_lines) row(`${t.label} ${t.pct}%`, money(t.amount));
  row("Total", money(inv.total), true);
  if (inv.tax_note) { y += 10; doc.setFontSize(9).text(doc.splitTextToSize(inv.tax_note, 515), 40, y); y += 20; }
  if (entity.bank_details) { doc.setFontSize(9).setFont("helvetica", "bold").text("Payment details", 40, (y += 10));
    doc.setFont("helvetica", "normal").text(doc.splitTextToSize(entity.bank_details, 515), 40, (y += 12)); }
  return doc.output("blob");
}

function InvoiceForm({ po, item, account, entities, user, onClose, onSent }) {
  const [entityId, setEntityId] = useState(() => defaultEntityFor(account, entities)?.id || "");
  const entity = entities.find(e => e.id === entityId) || null;
  const today = invToday();
  const plus30 = new Date(Date.parse(today + "T00:00:00Z") + 30 * 864e5).toISOString().slice(0, 10);
  const [f, setF] = useState({ issue_date: today, due_date: plus30, sent_to: account.billingEmail || "",
    sent_cc: (user.team || []).find?.(t => t.name === account.csm)?.email || "", lines: [scheduleLineItem(po, item)] });
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const [applyTax, setApplyTax] = useState(!account.taxExempt);   // checkbox data-apply-tax
  const totals = entity ? computeTotals(f.lines, entity, account, { exempt: !applyTax }) : null;
  const block = !canFinance(user) ? "You need finance access to create invoices."
    : !entity ? "No billing entity for this account. Set Billing entity or Country on the account, or add an entity in Settings → Billing."
    : entity.currency !== po.currency ? `This PO is in ${po.currency} but ${entity.name} bills in ${entity.currency}. Pick a ${po.currency} entity.``n    : !f.sent_to.trim() ? "This account has no billing email. Add one on the account's Billing section or type it here."
    : !totals.lines.length || totals.total <= 0 ? "Add at least one line with an amount above 0."
    : f.due_date < f.issue_date ? "Due date is before the issue date." : "";
  const setLine = (i, k, v) => setF({ ...f, lines: f.lines.map((l, j) => j === i ? { ...l, [k]: v } : l) });
  const fmt = n => `${entity?.currency || ""} ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const send = async () => {
    setBusy(true); setMsg("");
    try {
      const c = await sb.rpc("create_invoice", { p: { schedule_id: item.id, entity_id: entity.id,
        issue_date: f.issue_date, due_date: f.due_date, line_items: totals.lines, subtotal: totals.subtotal,
        tax_lines: totals.taxLines, tax_note: totals.taxNote, tax_exempt: !applyTax, total: totals.total, sent_to: f.sent_to.trim(), sent_cc: f.sent_cc.trim() || null } });
      if (c.error) throw c.error;
      const inv = c.data;
      const blob = renderInvoicePdf({ inv, entity, account, po });
      const path = `${inv.org_id}/${inv.id}.pdf`;
      const up = await sb.storage.from("invoices").upload(path, blob, { contentType: "application/pdf", upsert: true });
      if (up.error) throw new Error(`${inv.number} was created but the PDF upload failed: ${up.error.message}. Use Retry send in the list.`);
      const at = await sb.rpc("attach_invoice_pdf", { p_id: inv.id, p_path: path });
      if (at.error) throw at.error;
      const s = await sb.rpc("send_invoice", { p_id: inv.id, p_pdf_base64: await blobToBase64(blob) });
      if (s.error) throw new Error(`${inv.number} was saved but not sent: ${s.error.message}. It shows as Unsent; use Retry send.`);
      toast(`${inv.number} sent to ${f.sent_to}`);
      onSent(s.data);
    } catch (e) { setMsg(e.message); toast(e.message, "error"); onSent && e.message.includes("Retry") && onSent(null); }
    finally { setBusy(false); }
  };
  // render: modal (reuse the app's existing modal/dialog wrapper; grep "aria-modal") containing
  //  entity Select (options from entities) | issue/due date Inputs | To / CC Inputs
  //  line rows: Input data-line-desc / data-line-qty / data-line-rate + amount + remove (×); Btn data-add-line
  //  totals block: Subtotal, each taxLine as `${label} ${pct}%`, data-inv-total with fmt(total), taxNote in small text
  //  {block && <div data-inv-block className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{block}</div>}
  //  {msg && <div className="rounded bg-rose-50 px-2 py-1 text-xs text-rose-600">{msg}</div>}
  //  Btn data-inv-send kind="primary" disabled={!!block || busy} onClick={send}  -> "Sending…" / "Send invoice"
  //  Btn onClick={onClose} -> "Cancel"
}
```

Write the JSX for that render block in full when implementing. The comment lists every element, and each `data-*` hook is required by the tests. On a failure after create, the form calls `onSent(null)` so the parent reloads and shows the Unsent row. The parent must keep the modal open when given `null`: change `AccountInvoices`' `onSent` to `inv => { reload(); if (inv) setCreating(false); }`. For the CC address, check how `st.team` exposes email. If profiles carry no email, leave CC blank (admins can type it). Don't add a query.

- [ ] **Step 4: Run** the build, `run-one finance`, then the full suite → PASS. Manually open `dist/crm.html` against the mock (`tests/make-demo.mjs`, if it serves that purpose) and download one generated PDF to eyeball the layout.
- [ ] **Step 5: Commit** `git commit -m "Invoice form, PDF rendering and send flow"`

---

### Task 7: Finance page in the sidebar

**Files:**
- Create: `src/28-finance-page.jsx`
- Modify: `src/26-app.jsx` (`VIEWS` line 85 → `["Dashboard", "Tasks", "Accounts", "Renewals", "Finance", "Settings"]`, a render line beside the others ~line 492, and the command palette `go` already handles views)
- Test: `tests/health/finance.test.mjs` (append)

**Interfaces:**
- Consumes: `useInvoices`, `InvoiceTable`, `InvoiceForm`, `usePurchaseOrders`, `POQueue` (Task 5B), `summarizeInvoices`, `dueItems`, `periodLabel`, `canFinance`; `scored` accounts (for the account picker); CSV helper from `src/lib/csv.js` / `src/17-csv.jsx` (grep the export function used by the account list).
- Produces: `FinancePage({ accounts, user, openAccount })`, `FinanceSummary({ invoices })`, `DueToRaise({ pos, schedule, accounts, entities, user, onRaised })`. Hooks: `data-finance-page`, `data-fin-summary-<CUR>-<paid|pending|waived|overdue>`, `data-fin-filter-status`, `data-fin-filter-entity`, `data-fin-search`, `data-fin-export`, `data-po-queue` (from `POQueue`), `data-due-item={schedule.id}` with `data-raise`, `data-upcoming-toggle`. **No** `data-fin-new`: there is no free-standing invoice.

- [ ] **Step 1: Failing tests**

```js
test("finance page: summary per currency, filters, read-only for CSM", async () => {
  const page = await openApp({ user: { role: "user", finance: false }, invoices: MIXED /* 2 INR (1 paid 100, 1 overdue 50), 1 USD waived 10 */ });
  await page.click('nav >> text=Finance');
  await page.waitForSelector("[data-finance-page]");
  assert.match(await page.innerText("[data-fin-summary-INR-paid]"), /100\.00/);
  assert.match(await page.innerText("[data-fin-summary-INR-overdue]"), /50\.00/);
  assert.match(await page.innerText("[data-fin-summary-USD-waived]"), /10\.00/);
  assert.equal(await page.locator("[data-raise]").count(), 0);          // CSM: read-only, no Raise buttons
  assert.equal(await page.locator("[data-po-queue] [data-po-review]").count(), 0);
  await page.selectOption("[data-fin-filter-status]", "overdue");
  assert.equal(await page.locator("[data-invoice-row]").count(), 1);
});
test("finance page: CSV export neutralises formula cells", async () => {
  // invoice with account_name "=HYPERLINK(...)"; click [data-fin-export]; capture download; assert cell starts with "'="
});
```

Write the CSV test body in full, copying the download-capture idiom from `tests/health/csv-import-safety.test.mjs` or `csv.test.mjs`.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```jsx
function FinanceSummary({ invoices }) {
  const s = summarizeInvoices(invoices, invToday());
  const curs = Object.keys(s).sort();
  if (!curs.length) return null;
  const cell = (cur, k, label, cls) => <div className="nm-inset p-3"><div className="text-xs text-slate-500">{label}</div>
    <div data-fin-summary={`${cur}-${k}`} {...{ [`data-fin-summary-${cur}-${k}`]: "" }} className={`text-lg font-semibold tabular-nums ${cls}`}>
      {cur} {s[cur][k].toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
    {k === "overdue" && <div className="text-xs text-slate-500">{s[cur].overdueCount} invoice(s)</div>}</div>;
  return <div className="space-y-2">{curs.map(cur => <div key={cur} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {cell(cur, "paid", "Paid", "text-emerald-700")}{cell(cur, "pending", "Pending", "text-amber-700")}
    {cell(cur, "overdue", "Overdue", "text-rose-700")}{cell(cur, "waived", "Waived", "text-slate-600")}</div>)}</div>;
}

function FinancePage({ accounts, user, openAccount }) {
  const { invoices, entities, reload, error } = useInvoices();
  const [q, setQ] = useState(""), [status, setStatus] = useState("all"), [ent, setEnt] = useState("all");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const { pos, schedule, reload: reloadPOs } = usePurchaseOrders();
  const [raising, setRaising] = useState(null);   // { po, item, account }
  const today = invToday();
  const rows = invoices.filter(i => (status === "all" || invoiceStatus(i, today) === status)
    && (ent === "all" || i.entity_id === ent) && (!from || i.issue_date >= from) && (!to || i.issue_date <= to)
    && (!q || `${i.number} ${i.account_name}`.toLowerCase().includes(q.toLowerCase())));
  // render inside data-finance-page:
  //  header "Finance"
  //  canFinance(user) && <POQueue user={user} openAccount={openAccount} />   (section "POs awaiting approval"; hidden when empty)
  //  <DueToRaise ...>: rows for dueItems(schedule, today) joined to their APPROVED po and account:
  //     account, PO number, periodLabel, period dates, amount; canFinance -> Btn data-raise -> setRaising({po, item, account})
  //     data-upcoming-toggle reveals un-raised future items greyed out (no Raise button)
  //  {error && rose box}
  //  <FinanceSummary invoices={rows.filter(i => status === "all" ? true : true)} />   // summary follows entity+date filters only:
  //     pass invoices.filter(entity & date filters) -- NOT the status/search filter
  //  filter bar: Input data-fin-search, Select data-fin-filter-status [all,pending,overdue,paid,waived,unsent],
  //     Select data-fin-filter-entity [all + entities], date inputs from/to, Btn data-fin-export
  //  <InvoiceTable invoices={rows} entities={entities} user={user} onChanged={reload} showAccount openAccount={openAccount} />
  //  raising && <InvoiceForm {...raising} entities={entities} user={user} onClose={() => setRaising(null)}
  //            onSent={inv => { reload(); reloadPOs(); if (inv) setRaising(null); }} />
}
```

Write the render in full. Export columns: Number, Account, Entity, Currency, Issue date, Due date, Subtotal, Tax, Total, Status (derived), Paid date, Payment ref, Waive reason. Every cell goes through the existing injection guard. If the table can reach 500+ rows, wrap it in the existing virtualized list pattern (memory: list virtualization, runtime row-height rule). Otherwise a plain table is fine for v1; note it in the PR.

In `src/26-app.jsx`, the `views` filter keeps `Finance` visible to every active user (read-only for non-finance users). The render line:

```jsx
{view === "Finance" && <FinancePage accounts={scored} user={user} openAccount={openAccount} />}
```

`user` must carry `finance`: confirm Task 4's profile-select change reaches the `user` object (`26-app.jsx:526`). Add a sidebar icon if each view has one (grep where `VIEWS` maps to icons).

- [ ] **Step 4: Run** the build, `run-one finance`, and the full suite. Also run the existing `smoke`, `a11y`, `mobile` and `dark-mode` tests (the sidebar changed). The page must not scroll horizontally at 375px: the table sits in `overflow-x-auto`.
- [ ] **Step 5: Commit** `git commit -m "Finance page: all invoices, per-currency summary, filters, CSV"`

---

### Task 8: Dashboard finance card

**Files:**
- Modify: `src/16-dashboard.jsx` (render beside the License deployment card), `src/28-finance-page.jsx` (add `FinanceCard`). The Dashboard needs a way to switch view: check whether `Dashboard` receives a `setView`/`go` prop. If not, pass `goFinance={() => setView("Finance")}` from `26-app.jsx`.
- Test: `tests/health/finance.test.mjs` (append)

**Interfaces:**
- Consumes: `useInvoices`, `summarizeInvoices`, the existing donut/chart component in `src/09-charts.jsx` (grep `Donut`), `Card`.
- Produces: `FinanceCard({ goFinance, user })`. Hooks: `data-finance-card`, `data-fin-card-<CUR>`, `data-fin-card-link`, `data-fin-card-pos` ("N POs awaiting approval"), `data-fin-card-due` ("N invoices due to raise"). Both counts come from `usePurchaseOrders()` + `dueItems`. The card also renders (with just the counts) when there are no invoices yet but there are POs.

- [ ] **Step 1: Failing test**

```js
test("dashboard finance card: this quarter per currency, link opens Finance", async () => {
  const page = await openApp({ user: { role: "user" }, clock: "2026-10-12", invoices: [
    { ...base, number: "A", currency: "INR", total: 100, status: "paid", issue_date: "2026-10-01" },
    { ...base, number: "B", currency: "INR", total: 40, status: "pending", issue_date: "2026-10-02", due_date: "2026-10-03" },
    { ...base, number: "C", currency: "INR", total: 999, status: "paid", issue_date: "2026-06-30" }] }); // last quarter: excluded
  const card = page.locator("[data-finance-card]");
  assert.match(await card.locator("[data-fin-card-INR]").innerText(), /Paid\s*INR 100\.00/);
  assert.match(await card.locator("[data-fin-card-INR]").innerText(), /1 overdue/);
  await card.locator("[data-fin-card-link]").click();
  await page.waitForSelector("[data-finance-page]");
});
test("dashboard finance card shows PO and due counts", async () => {
  const page = await openApp({ user: { role: "user", finance: true }, clock: "2026-10-12", invoices: [],
    pos: [{ ...APPROVED_PO }, { ...APPROVED_PO, id: "po2", po_number: "X2", status: "submitted" }], schedule: ITEMS });
  assert.match(await page.innerText("[data-fin-card-pos]"), /1 PO/);
  assert.match(await page.innerText("[data-fin-card-due]"), /1 invoice/);
});
test("dashboard finance card is absent when there are no invoices and no POs", async () => {
  const page = await openApp({ user: { role: "user" }, invoices: [], pos: [] });
  assert.equal(await page.locator("[data-finance-card]").count(), 0);
});
```

Check how existing dashboard tests pin the clock (`mock.timers` or a `clock` option in the harness) and use the same.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

The quarter is computed from `invToday()`: `q = Math.floor((month-1)/3)`, `start = yyyy-(q*3+1)-01`, compared textually against `issue_date`. Filter, call `summarizeInvoices`, and render one row per currency: Paid, Pending and Waived amounts, then `N overdue`. Above the rows sits a donut of Paid/Pending/Waived for the currency with the most invoices, using the existing chart component and theme CSS variables (it must work in dark mode). The link button `data-fin-card-link` reads "Open Finance →". Return `null` when there are no invoices this quarter **and** no submitted POs or due items. Load the dataviz guidance from the existing chart file conventions; don't add a chart library.

- [ ] **Step 4: Run** the build, the finance tests, then `dashboard`, `dashboard-polish`, `dark-mode` and the full suite → PASS.
- [ ] **Step 5: Commit** `git commit -m "Dashboard finance card"`

---

### Task 9: Runbook, docs, whole-branch verification and PR

**Files:**
- Create: `docs/runbooks/finance-setup.md`
- Modify: `docs/qa/test-catalogue.md`, if it exists. Match the real test names exactly (memory: a docs agent once invented names).

- [ ] **Step 1: Runbook content**

```markdown
# Finance invoicing — operator setup
1. Supabase SQL Editor: run `supabase-setup.sql` (adds profiles.finance + admin_user_list v2), then `finance.sql`.
   Order matters: finance.sql needs email-alerts.sql's alert_config / alert_post / html_escape, which are already live.
2. In Brevo, confirm `support@onevio.in` is a verified sender (it is the default in billing_settings).
3. Supabase SQL: confirm `select id from storage.buckets where id in ('invoices','purchase-orders')` returns 2 rows.
4. In the app: Settings → Billing → add the three entities (India, US, Philippines) with prefix, tax ID, bank details;
   India: state + LUT number.
5. Settings → Users → switch on "finance" for the finance team.
6. Dry run: submit a test PO on an internal account → approve it → raise period 1 → send to an internal address. Then in SQL:
   `select status_code, content from net._http_response order by id desc limit 1;` — expect 201.
7. Later, to switch sender: Settings → Billing → sender = billing@onevio.in (verify it in Brevo first).
```

- [ ] **Step 2: Full local verification**

Run each with `> file 2>&1` (never piped): `npm run test:unit`, `npm run build`, `node tests/health/run.mjs`, `npm run test:worker`. All PASS. Read the counts and compare them with the last known baseline (memory: health 426, unit 436 at PR #68). The new counts must be higher, never lower.

- [ ] **Step 3: Push, open the PR** (from draft to ready) with `gh pr create --body-file`. Wait for CI `rls` + `test` to finish green without pushing mid-run.
- [ ] **Step 4: Request a whole-branch review** (superpowers:requesting-code-review). Fix findings and re-run CI.
- [ ] **Step 5: Commit** the docs. The user merges, and merging deploys. Remind them to run step 1 of the runbook in production right after the merge, because the UI calls RPCs that don't exist until then.
