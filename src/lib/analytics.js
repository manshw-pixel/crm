import { iso, daysUntil } from "./dates.js";
import { toUSD } from "./money.js";

export const monthsBetween = (a, b) => (new Date(b).getFullYear() - new Date(a).getFullYear()) * 12 + (new Date(b).getMonth() - new Date(a).getMonth());
export const quarterKey = d => { // ISO strings parsed textually (timezone-safe); Dates read in local time
  const [y, m] = typeof d === "string" ? d.split("-").map(Number) : [d.getFullYear(), d.getMonth() + 1];
  return y + "-Q" + (Math.ceil(m / 3));
};
export function cohortData(accounts) {
  const now = iso(Date.now());
  const threeYrsAgo = new Date(); threeYrsAgo.setFullYear(threeYrsAgo.getFullYear() - 3);
  const rows = new Map(); // key -> { key, start (earliest startDate), accts: [] }
  accounts.forEach(a => {
    if (!a.startDate || isNaN(new Date(a.startDate))) return;
    const d = new Date(a.startDate);
    const key = d < threeYrsAgo ? String(d.getFullYear()) : `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    if (!rows.has(key)) rows.set(key, { key, start: a.startDate, accts: [] });
    const r = rows.get(key);
    if (a.startDate < r.start) r.start = a.startDate;
    // quarters survived: Infinity if never churned
    r.accts.push({ arr: a.arrUSD || 0, surv: a.churn && a.churn.date ? Math.max(0, Math.floor(monthsBetween(a.startDate, a.churn.date) / 3)) : Infinity });
  });
  return [...rows.values()].sort((x, y) => x.start.localeCompare(y.start)).map(r => {
    const size = r.accts.length, arr = r.accts.reduce((s, x) => s + x.arr, 0);
    const maxQ = Math.floor(monthsBetween(r.start, now) / 3);
    const cells = [];
    for (let q = 0; q <= maxQ; q++) {
      const alive = r.accts.filter(x => x.surv >= q);
      cells.push({ q, pct: size ? alive.length / size : 0, arrPct: arr ? alive.reduce((s, x) => s + x.arr, 0) / arr : 0 });
    }
    return { key: r.key, size, arr, cells };
  });
}
export const CHURN_DIMS = ["Reason", "CSM", "Tier", "Quarterly"];
export function churnRows(accounts, rates, dim, now = new Date()) {
  const m = new Map();
  accounts.filter(a => a.churn).forEach(a => {
    const lost = toUSD(a.churn.arr || 0, a.churn.currency || a.currency, rates);
    const k = dim === "Reason" ? (a.churn.reason || "Other")
      : dim === "CSM" ? (a.csm || "Unassigned")
      : dim === "Tier" ? (a.tier || "—")
      : quarterKey(a.churn.date);
    const r = m.get(k) || { k, n: 0, arr: 0 };
    r.n++; r.arr += lost; m.set(k, r);
  });
  if (dim !== "Quarterly") return [...m.values()].sort((x, y) => y.arr - x.arr);
  // Quarterly: last 8 quarters, chronological, zero-filled
  const keys = [];
  for (let i = 7; i >= 0; i--) keys.push(quarterKey(new Date(now.getFullYear(), now.getMonth() - i * 3, 1)));
  return keys.map(k => m.get(k) || { k, n: 0, arr: 0 });
}
export function renewalOutcomeRows(accounts, rates, snapshots, now = new Date()) {
  return [4, 3, 2, 1, 0].map(off => {
    const startMonth = Math.floor(now.getMonth() / 3) * 3 - off * 3;
    const start = new Date(now.getFullYear(), startMonth, 1);
    const end = new Date(now.getFullYear(), startMonth + 3, 1);
    const mkey = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
    const startKey = mkey(start), endKey = mkey(end);
    const inQ = d => { const k = String(d).slice(0, 7); return k >= startKey && k < endKey; };
    let renewed = 0, renewedN = 0, churned = 0, churnedN = 0, slipped = 0;
    accounts.forEach(a => {
      (a.renewals || []).forEach(r => { if (r.completedOn && inQ(r.completedOn)) { renewed += toUSD(r.arr || 0, r.currency || a.currency, rates); renewedN++; } });
      if (a.churn && inQ(a.churn.date)) { churned += toUSD(a.churn.arr || 0, a.churn.currency || a.currency, rates); churnedN++; }
      if (!a.churn && inQ(a.renewalDate) && daysUntil(a.renewalDate) < 0
          && !(a.renewals || []).some(r => r.completedOn && r.completedOn >= a.renewalDate)) slipped++;
    });
    const snap = (snapshots || []).find(s => s.month === startKey && s.commit90 !== undefined);
    const wr = renewed + churned > 0 ? renewed / (renewed + churned) : null;
    return { key: quarterKey(start), renewed, renewedN, churned, churnedN, slipped, wr,
      forecast: snap ? snap.commit90 : null, current: off === 0 };
  });
}
