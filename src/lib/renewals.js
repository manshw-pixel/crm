// Renewal window bucketing for the Renewals page window cards.
// Day difference is whole UTC days between date-only ISO strings (no timezone drift).
// Past-due (d < 0) and missing/non-ISO dates get null (no bucket).

export const RENEWAL_WINDOWS = [
  { key: "0-30", label: "0–30 days" },
  { key: "31-60", label: "31–60 days" },
  { key: "61-90", label: "61–90 days" },
  { key: "90+", label: "90+ days" },
];

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const utcDay = (s) => {
  const m = typeof s === "string" ? ISO.exec(s) : null;
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
};

export function renewalWindowOf(renewalDate, today) {
  const r = utcDay(renewalDate), t = utcDay(today);
  if (r === null || t === null) return null;
  const d = Math.round((r - t) / 86400000);
  if (d < 0) return null;
  if (d <= 30) return "0-30";
  if (d <= 60) return "31-60";
  if (d <= 90) return "61-90";
  return "90+";
}

export function renewalWindows(accounts, today) {
  const out = RENEWAL_WINDOWS.map(w => ({ ...w, arrUSD: 0, count: 0 }));
  for (const a of accounts || []) {
    const k = renewalWindowOf(a && a.renewalDate, today);
    const row = k && out.find(w => w.key === k);
    if (!row) continue;
    row.arrUSD += Number(a.arrUSD) || 0;
    row.count += 1;
  }
  return out;
}
