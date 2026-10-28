/* Finance-folder files: classify a CSV by its header and plan each row. Pure -- no store access,
 * no file access. The caller does the inserts / RPC calls and the PDF lookup. */
import { parseCsvDate, csvDateOrder, parseCsvNumber } from "./csv.js";

const norm = s => String(s == null ? "" : s).toLowerCase().replace(/[^a-z]/g, "");
const PO_REQUIRED = ["ponumber", "podate", "povalue", "currency", "years", "billingcycle", "billingstart", "pofile"];
const LABEL = { ponumber: "po_number", podate: "po_date", povalue: "po_value", billingcycle: "billing_cycle",
  billingstart: "billing_start", pofile: "po_file", invoicenumber: "invoice_number" };
const label = k => LABEL[k] || k;
const CURRENCIES = ["INR", "USD", "PHP"];
const CYCLES = ["quarterly", "half_yearly", "annual"];
const MIXED_DATES = "dates mix DD-MM-YYYY and MM-DD-YYYY — use one format (YYYY-MM-DD is safest)";

export function financeFileKind(headerRow) {
  const h = (headerRow || []).map(norm);
  if (h.includes("ponumber")) return "po";
  if (h.includes("invoicenumber")) return "payment";
  if (h.includes("billingcompleteddate")) return "billing";
  return null;
}

export function normBillingCycle(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase().replace(/[\s-]+/g, "_");
  return CYCLES.includes(s) ? s : null;
}

function reader(rows) {
  const header = rows[0].map(norm);
  return { header, col: (r, key) => { const i = header.indexOf(key); return i >= 0 ? String(r[i] == null ? "" : r[i]).trim() : ""; } };
}
const blank = r => !r.some(c => String(c == null ? "" : c).trim());

export function planPORows(rows, accounts) {
  if (!rows || rows.length < 2) return { err: "no data rows", items: [] };
  const { header, col } = reader(rows);
  const missing = PO_REQUIRED.filter(k => !header.includes(k));
  if (!header.includes("accountno") && !header.includes("name")) missing.unshift("account_no or name");
  if (missing.length) return { err: "missing columns: " + missing.map(label).join(", "), items: [] };
  const data = rows.slice(1).map((r, i) => ({ r, row: i + 2 })).filter(x => !blank(x.r));
  const order = csvDateOrder(data.flatMap(({ r }) => [col(r, "podate"), col(r, "billingstart")]));
  if (!order) return { err: MIXED_DATES, items: [] };
  const byNo = new Map((accounts || []).filter(a => a.accountNo).map(a => [String(a.accountNo).trim().toLowerCase(), a]));
  const byName = new Map();
  for (const a of accounts || []) { const k = String(a.name).trim().toLowerCase(); byName.set(k, byName.has(k) ? "dup" : a); }
  const items = data.map(({ r, row }) => {
    const no = col(r, "accountno"), nm = col(r, "name");
    const refuse = reason => ({ row, ok: false, reason });
    const byNameHit = !(no && byNo.get(no.toLowerCase())) && nm ? byName.get(nm.toLowerCase()) : null;
    if (byNameHit === "dup") return refuse(`ambiguous account name "${nm}" — add accountNo`);
    const acct = (no && byNo.get(no.toLowerCase())) || byNameHit || null;
    if (!acct) return refuse(`unknown account "${no || nm}"`);
    const po_number = col(r, "ponumber");
    if (!po_number) return refuse("po_number required");
    const po_date = parseCsvDate(col(r, "podate"), order);
    if (!po_date) return refuse("po_date required or unreadable");
    const po_value = parseCsvNumber(col(r, "povalue"));
    if (po_value === "" || po_value === null || !(po_value > 0)) return refuse("po_value must be a number above 0");
    const currency = col(r, "currency").toUpperCase();
    if (!CURRENCIES.includes(currency)) return refuse("currency must be INR, USD or PHP");
    const yt = col(r, "years");
    const years = /^\d+$/.test(yt) ? Number(yt) : NaN;
    if (!(years >= 1 && years <= 10)) return refuse("years must be a whole number 1-10");
    const billing_cycle = normBillingCycle(col(r, "billingcycle"));
    if (!billing_cycle) return refuse("billing_cycle must be quarterly, half_yearly or annual");
    const billing_start = parseCsvDate(col(r, "billingstart"), order);
    if (!billing_start) return refuse("billing_start required or unreadable");
    const poFile = col(r, "pofile");
    if (!poFile) return refuse("po_file required");
    return { row, ok: true, account: { id: acct.id, name: acct.name },
      v: { po_number, po_date, po_value, currency, years, billing_cycle, billing_start }, poFile };
  });
  return { items };
}

export function planPaymentRows(rows, invoices) {
  if (!rows || rows.length < 2) return { err: "no data rows", items: [] };
  const { header, col } = reader(rows);
  const missing = ["invoicenumber", "status"].filter(k => !header.includes(k));
  if (missing.length) return { err: "missing columns: " + missing.map(label).join(", "), items: [] };
  const data = rows.slice(1).map((r, i) => ({ r, row: i + 2 })).filter(x => !blank(x.r));
  const order = csvDateOrder(data.map(({ r }) => col(r, "paiddate")));
  if (!order) return { err: MIXED_DATES, items: [] };
  const byNo = new Map();
  for (const i of invoices || []) { const k = String(i.number).trim().toLowerCase(); byNo.set(k, byNo.has(k) ? "dup" : i); }
  const items = data.map(({ r, row }) => {
    const refuse = reason => ({ row, ok: false, reason });
    const num = col(r, "invoicenumber");
    const inv = byNo.get(num.toLowerCase());
    if (inv === "dup") return refuse(`ambiguous invoice number ${num}`);
    if (!inv) return refuse(`unknown invoice ${num}`);
    const raw = col(r, "status");
    const status = raw.toLowerCase();
    if (status !== "paid" && status !== "waived") return refuse(`bad status "${raw}"`);
    if (inv.status === status) return refuse(`already ${status}`);
    if (status === "paid") {
      const paidDate = parseCsvDate(col(r, "paiddate"), order);
      if (!paidDate) return refuse("paid date required");
      return { row, ok: true, invoiceId: inv.id, status, paidDate, ref: col(r, "paymentref") || null, reason: null };
    }
    const reason = col(r, "reason");
    if (!reason) return refuse("waive reason required");
    return { row, ok: true, invoiceId: inv.id, status, paidDate: null, ref: null, reason };
  });
  return { items };
}
