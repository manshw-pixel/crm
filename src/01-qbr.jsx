/* ------------------------------- QBR cadence ------------------------------- */
const QBR_FREQS = ["None", "Quarterly", "Semi-annual", "Annual"];
const QBR_FREQ_MONTHS = { Quarterly: 3, "Semi-annual": 6, Annual: 12 };
/* null = QBRs not applicable (churned, or no frequency and no date set) */
function qbrStatus(a) {
  if (a.churn) return null;
  const hasFreq = a.qbrFrequency && a.qbrFrequency !== "None";
  if (!hasFreq && !a.nextQbrDate) return null;
  if (!a.nextQbrDate) return { kind: "unscheduled" };
  const d = daysUntil(a.nextQbrDate);
  return d < 0 ? { kind: "overdue", d: -d } : d <= 30 ? { kind: "due", d } : { kind: "scheduled", d };
}

const DEFAULT_WEIGHTS = { usage: 30, sentiment: 20, tickets: 15, recency: 20, nps: 15, value: 0 };
const WEIGHT_LABELS = { usage: "Product usage", sentiment: "Sentiment", tickets: "Support tickets", recency: "Engagement recency", nps: "NPS", value: "Value" };
/* Engagement recency sub-options: one per activity type, each scored from that type's own
   last date against its own window. Ships disabled -- see the rollout note in the spec:
   the blend can only be <= today's any-activity rule, so turning it on moves scores. */
const ACTIVITY_TYPES = ["call", "email", "QBR", "ticket", "note", "renewal", "churn"];
const DEFAULT_RECENCY_MIX = { enabled: false, types: {
  call: { weight: 25, fullDays: 7, zeroDays: 60 }, email: { weight: 20, fullDays: 7, zeroDays: 60 },
  QBR: { weight: 25, fullDays: 90, zeroDays: 180 }, ticket: { weight: 10, fullDays: 7, zeroDays: 60 },
  note: { weight: 10, fullDays: 7, zeroDays: 60 }, renewal: { weight: 10, fullDays: 365, zeroDays: 730 },
  churn: { weight: 0, fullDays: 365, zeroDays: 730 } } };
/* Value: Yes/No per account, blended by sub-weight. Ships at weight 0 (DEFAULT_WEIGHTS.value). */
const VALUE_ITEMS = [["caseStudy", "Case study published"], ["savings", "Savings approved by customer"], ["roi", "ROI approved by customer"]];
const DEFAULT_VALUE_MIX = { caseStudy: 34, savings: 33, roi: 33 };
function mergeSettings(saved) {
  const s = saved || {}, rm = s.recencyMix || {}, types = {};
  ACTIVITY_TYPES.forEach(t => { types[t] = { ...DEFAULT_RECENCY_MIX.types[t], ...((rm.types || {})[t] || {}) }; });
  return { weights: { ...DEFAULT_WEIGHTS, ...(s.weights || {}) },
    recencyMix: { enabled: !!rm.enabled, types }, valueMix: { ...DEFAULT_VALUE_MIX, ...(s.valueMix || {}) } };
}
const INPUT_RANGE = { usage: [0, 100], sentiment: [0, 100], tickets: [0, 50], nps: [-100, 100] };
const DEFAULT_INPUTS = { usage: 70, sentiment: 70, tickets: 0, nps: 0 };
/* keep health inputs numeric and in range — drops blanks/NaN, clamps the rest */
const clampInputs = raw => {
  const out = {};
  Object.keys(INPUT_RANGE).forEach(k => {
    const n = parseFloat(raw?.[k]);
    if (!isNaN(n)) { const [lo, hi] = INPUT_RANGE[k]; out[k] = Math.min(hi, Math.max(lo, n)); }
  });
  if (raw && typeof raw.value === "object" && raw.value) {
    out.value = {};
    VALUE_ITEMS.forEach(([k]) => { out.value[k] = raw.value[k] === true; });
  }
  return out;
};

function lastActivityDate(accountId, activities) {
  const a = activities.filter(x => x.accountId === accountId).sort((x, y) => y.date.localeCompare(x.date));
  return a.length ? a[0].date : null;
}
// Score 0-100 from days since the last activity: 100 within the full window, falling
// linearly to 0 at the zero day; a future date counts as 0 days, and no activity scores 0.
const windowScore = (ds, full, zero) => {
  if (ds === null || ds === undefined) return 0;
  const d = Math.max(0, ds);
  if (d <= full) return 100;
  if (zero <= full || d >= zero) return 0;
  return Math.round(100 * (1 - (d - full) / (zero - full)));
};
function recencyBreakdown(acct, activities, recencyMix) {
  const mix = recencyMix || DEFAULT_RECENCY_MIX;
  return ACTIVITY_TYPES.map(type => {
    const c = { ...DEFAULT_RECENCY_MIX.types[type], ...((mix.types || {})[type] || {}) };
    const last = activities.filter(x => x.accountId === acct.id && x.type === type).map(x => x.date).sort().pop() || null;
    return { type, weight: +c.weight || 0, score: windowScore(last ? daysSince(last) : null, +c.fullDays || 0, +c.zeroDays || 0), lastDate: last };
  });
}
function scoreComponents(acct, activities, settings) {
  const la = lastActivityDate(acct.id, activities);
  const ds = la ? daysSince(la) : 999;
  const inp = { ...DEFAULT_INPUTS, ...clampInputs(acct.inputs) }; // tolerate missing/bad stored inputs
  const legacyRecency = ds <= 7 ? 100 : ds >= 60 ? 0 : Math.round(100 * (1 - (ds - 7) / 53));
  const rm = settings && settings.recencyMix;
  let recency = legacyRecency;
  if (rm && rm.enabled) {
    const parts = recencyBreakdown(acct, activities, rm).filter(p => p.weight > 0);
    const tw = parts.reduce((s, p) => s + p.weight, 0);
    if (tw > 0) recency = Math.round(parts.reduce((s, p) => s + p.weight * p.score, 0) / tw);
  }
  const vm = { ...DEFAULT_VALUE_MIX, ...((settings && settings.valueMix) || {}) };
  const vw = VALUE_ITEMS.reduce((s, [k]) => s + (+vm[k] || 0), 0);
  const ans = inp.value || {};
  const value = vw > 0 ? Math.round(VALUE_ITEMS.reduce((s, [k]) => s + (+vm[k] || 0) * (ans[k] === true ? 100 : 0), 0) / vw) : 0;
  return {
    usage: inp.usage,
    sentiment: inp.sentiment,
    tickets: 100 - Math.min(inp.tickets * 10, 100),
    recency,
    nps: Math.round((inp.nps + 100) / 2),
    value,
  };
}
function healthScore(acct, activities, weights, settings) {
  const c = scoreComponents(acct, activities, settings);
  const tw = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  return Math.round(Object.keys(weights).reduce((s, k) => s + (weights[k] / tw) * (c[k] ?? 0), 0));
}
/* How many (non-churned) accounts would drop a band if `to` settings replaced `from`.
   Uses healthScore itself, so the preview cannot disagree with what saving does. */
function bandImpact(accounts, activities, from, to) {
  const out = { down: 0, toYellow: 0, toRed: 0 };
  accounts.filter(a => !a.churn).forEach(a => {
    const b0 = riskOf(healthScore(a, activities, from.weights, from)), b1 = riskOf(healthScore(a, activities, to.weights, to));
    if (BAND_RANK[b1] > BAND_RANK[b0]) { out.down++; if (b1 === "Yellow") out.toYellow++; else out.toRed++; }
  });
  return out;
}
const riskOf = s => (s >= 70 ? "Green" : s >= 40 ? "Yellow" : "Red");
const RISK_STYLE = {
  Green: "bg-emerald-100 text-emerald-700 border-emerald-300",
  Yellow: "bg-amber-100 text-amber-700 border-amber-300",
  Red: "bg-rose-100 text-rose-700 border-rose-300",
};
const RISK_HEX = { Green: "#10b981", Yellow: "#f59e0b", Red: "#f43f5e" };

function flagsFor(acct, activities, score) {
  if (acct.churn) return [];
  const f = [];
  const la = lastActivityDate(acct.id, activities);
  if ((!la || daysSince(la) >= 30) && daysSince(acct.startDate) >= 30) f.push("No activity 30d+");
  const dr = daysUntil(acct.renewalDate);
  if (dr >= 0 && dr < 60) f.push(`Renewal in ${dr}d`);
  const old = (acct.history || []).filter(h => daysSince(h.d) >= 25);
  if (old.length && old[old.length - 1].s - score >= 10) f.push(`Health ↓${old[old.length - 1].s - score}`);
  const iu = daysSince(acct.inputsUpdatedAt || acct.startDate);
  if (iu >= 45) f.push(`Inputs stale ${iu}d`);
  return f;
}

