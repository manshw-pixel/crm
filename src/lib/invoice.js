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
