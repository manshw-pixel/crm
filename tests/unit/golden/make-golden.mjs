// Records golden outputs for the pure-logic unit tests by running each function inside the
// BUILT app (dist/crm.html) with the clock pinned to NOW and the timezone pinned to UTC.
// Generated once from master (pre-lib-modules); the unit tests then require src/lib to
// reproduce these outputs exactly. Regenerate only on purpose:
//   node build.mjs && node tests/unit/golden/make-golden.mjs
import { chromium } from "../../node_modules/playwright/index.mjs";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildMockedHtml } from "../../health/harness.mjs";

const NOW = "2026-06-15T12:00:00.000Z";
const OUT = fileURLToPath(new URL("./golden.json", import.meta.url));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ timezoneId: "UTC" });
const page = await ctx.newPage();
await page.clock.setFixedTime(new Date(NOW));
await page.goto(buildMockedHtml("window.__seedRows = { accounts: [], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };"));
await page.waitForFunction(() => window.__store && window.__health);

const golden = await page.evaluate(NOW => {
  const g = name => (0, eval)(name);              // resolves global lexical consts too
  const D = s => ({ $date: s });                  // Date marker (JSON-safe); revived below
  const revive = v => v && typeof v === "object" && "$date" in v ? new Date(v.$date)
    : Array.isArray(v) ? v.map(revive) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)])) : v;
  const RATES = { INR: 0.012, PHP: 0.018 };
  const sd = seedData();
  const crafted = [
    { id: "x1", name: "Churned Co", tier: "Mid", arr: 50000, currency: "USD", industry: "Tech", csm: "Priya", startDate: "2024-02-01", renewalDate: "2026-09-01", contractStatus: "Active",
      inputs: { usage: 40, sentiment: 40, tickets: 3, nps: -10 }, history: [], inputsUpdatedAt: "2026-05-01",
      churn: { date: "2026-03-10", reason: "Budget", arr: 50000, currency: "USD", by: "T" } },
    { id: "x2", name: "Rupee Co", tier: "Enterprise", arr: 8000000, currency: "INR", industry: "Retail", csm: "Marco", startDate: "2023-05-01", renewalDate: "2027-04-20", contractStatus: "Active",
      inputs: { usage: 85, sentiment: 80, tickets: 1, nps: 50, value: { caseStudy: true, savings: false, roi: true } }, history: [{ d: "2026-05-01", s: 90 }], inputsUpdatedAt: "2026-06-01",
      arrEvents: [{ date: "2025-11-01", delta: 1000000, kind: "adjust", currency: "INR" }, { date: "2026-02-01", delta: 0, kind: "redenomination", fromCurrency: "USD", toCurrency: "INR", fromArr: 80000, toArr: 6666667 }],
      renewals: [{ completedOn: "2026-04-20", arr: 8000000, prevArr: 7000000, currency: "INR" }], transitionDate: "2026-02-01" },
    { id: "x3", name: "Slipped Co", tier: "SMB", arr: 30000, currency: "USD", industry: "Media", csm: "Sana", startDate: "2025-01-10", renewalDate: "2026-05-10", contractStatus: "Active",
      inputs: { usage: 60, sentiment: 55, tickets: 6, nps: 0 }, history: [], inputsUpdatedAt: "2026-03-01", qbrFrequency: "Quarterly", nextQbrDate: "2026-06-01" },
    { id: "x4", name: "Shrink Co", tier: "Mid", arr: 20000, currency: "USD", industry: "Tech", csm: "Priya", startDate: "2022-07-01", renewalDate: "2026-12-01", contractStatus: "Auto-renew",
      inputs: { usage: 70, sentiment: 70, tickets: 0, nps: 20 }, history: [], inputsUpdatedAt: "2026-06-10", parentId: "x2", accountNo: 77,
      arrEvents: [{ date: "2026-01-15", delta: -5000, kind: "adjust" }], qbrFrequency: "Annual", nextQbrDate: "2026-07-01" },
    { id: "x5", name: "Gone Co", tier: "SMB", arr: 10000, currency: "PHP", industry: "Education", csm: "Marco", startDate: "2024-01-01", renewalDate: "2026-01-01", contractStatus: "Active",
      inputs: { usage: 20, sentiment: 20, tickets: 9, nps: -60 }, history: [], inputsUpdatedAt: "2025-09-01",
      churn: { date: "2025-10-01", reason: "Product fit", arr: 500000, currency: "PHP", by: "T" } },
  ];
  const accounts = [...sd.accounts, ...crafted].map(a => ({ ...a, arrUSD: g("toUSD")(a.arr, a.currency, RATES) }));
  const activities = [...sd.activities,
    { id: "y1", accountId: "x2", type: "QBR", date: "2026-03-01", summary: "q" },
    { id: "y2", accountId: "x2", type: "call", date: "2026-06-10", summary: "c" },
    { id: "y3", accountId: "x3", type: "email", date: "2026-02-01", summary: "e" },
    { id: "y4", accountId: "x4", type: "meeting", date: "2026-06-14", summary: "legacy type" },
    { id: "y5", accountId: "x4", type: "note", date: "2026-07-01", summary: "future-dated" }];
  const base = g("mergeSettings")({});
  const recOn = { ...base, recencyMix: { ...base.recencyMix, enabled: true } };
  const val20 = { ...base, weights: { ...base.weights, value: 20 } };
  const snapshots = [{ month: "2026-04", commit90: 120000 }, { month: "2026-01", commit90: 90000 }];
  const C = [];  // [module, fn, args]
  const add = (m, fn, ...args) => C.push([m, fn, args]);

  // dates
  ["2026-06-25", "2026-06-15", "2026-06-01", "2025-06-15", "2026-06-16T00:00:00Z"].forEach(d => { add("dates", "daysUntil", d); add("dates", "daysSince", d); });
  add("dates", "iso", "2026-06-15T23:59:59Z"); add("dates", "iso", 0);
  add("dates", "addDays", 10); add("dates", "addDays", -400);
  add("dates", "isoMinus", "2026-03-01", 1); add("dates", "isoPlus", "2024-02-28", 1); add("dates", "isoPlus", "2026-12-31", 1);
  [["2026-01-31", 1], ["2024-01-31", 1], ["2026-12-15", 2], ["2026-03-31", -1], ["2026-05-31", 12], ["2026-01-15", -13]].forEach(([d, m]) => add("dates", "addMonths", d, m));
  add("dates", "fmtDate", "2026-06-15"); add("dates", "fmtDate", "2026-01-01");
  // money
  [[100, "USD"], [100, undefined], [1000000, "INR"], [500, "PHP"], [100, "EUR"], [-250, "INR"]].forEach(([n, c]) => add("money", "toUSD", n, c, RATES));
  add("money", "toUSD", 100, "INR", undefined);
  [[0, undefined], [999, undefined], [1499, "USD"], [1500, "USD"], [999999, "USD"], [1000000, "USD"], [2345678, "INR"], [12, "PHP"], [5, "EUR"]].forEach(([n, c]) => add("money", "fmtMoney", n, c));
  // qbr
  accounts.forEach(a => add("qbr", "qbrStatus", a));
  add("qbr", "qbrStatus", { qbrFrequency: "Quarterly" });
  add("qbr", "qbrStatus", { qbrFrequency: "None", nextQbrDate: "2026-06-20" });
  add("qbr", "qbrStatus", { churn: { date: "2026-01-01" }, qbrFrequency: "Annual", nextQbrDate: "2026-06-20" });
  // scoring
  [[0, 7, 60], [7, 7, 60], [33.5, 7, 60], [60, 7, 60], [90, 7, 60], [null, 7, 60], [-5, 7, 60], [7, 7, 7], [8, 7, 7], [3, 10, 5], [120, 90, 180]].forEach(x => add("scoring", "windowScore", ...x));
  add("scoring", "mergeSettings", {}); add("scoring", "mergeSettings", { weights: { usage: 30, sentiment: 20, tickets: 15, recency: 20, nps: 15 } });
  add("scoring", "mergeSettings", { recencyMix: { enabled: true, types: { call: { weight: 5, fullDays: 3, zeroDays: 30 } } }, valueMix: { roi: 80 } });
  [{ usage: "50", sentiment: "x", tickets: 99, nps: -500 }, {}, null, { value: { caseStudy: true, savings: "yes" } }, { value: "yes" }].forEach(r => add("scoring", "clampInputs", r));
  [100, 70, 69, 40, 39, 0].forEach(s => add("scoring", "riskOf", s));
  accounts.forEach(a => {
    add("scoring", "lastActivityDate", a.id, activities);
    add("scoring", "recencyBreakdown", a, activities, recOn.recencyMix);
    [base, recOn, val20].forEach(s => { add("scoring", "scoreComponents", a, activities, s); add("scoring", "healthScore", a, activities, s.weights, s); });
    add("scoring", "healthScore", a, activities, { usage: 30, sentiment: 20, tickets: 15, recency: 20, nps: 15 });
    add("scoring", "flagsFor", a, activities, g("healthScore")(a, activities, base.weights, base));
  });
  add("scoring", "bandImpact", accounts, activities, base, recOn);
  add("scoring", "bandImpact", accounts, activities, base, val20);
  // retention
  add("retention", "retentionStats", accounts, RATES);
  add("retention", "retentionStats", accounts.filter(a => !a.churn), RATES);
  add("retention", "lastCompletedDecember"); add("retention", "lastCompletedDecember", "2026-12-31"); add("retention", "lastCompletedDecember", "2026-12-30");
  accounts.forEach(a => { add("retention", "arrAsOf", a, "2025-12-31", RATES); add("retention", "accountRetention", a, RATES); add("retention", "accountRetention", a, RATES, "2027-02-01"); });
  add("retention", "amBookMovement", accounts, RATES);
  add("retention", "amBookMovement", accounts, RATES, "2027-03-01");
  // analytics
  [["2025-01-15", "2026-06-15"], ["2026-06-01", "2026-06-30"], ["2026-12-01", "2027-01-01"]].forEach(x => add("analytics", "monthsBetween", ...x));
  ["2026-01-01", "2026-03-31", "2026-04-01", "2026-12-31", D("2026-06-15T12:00:00.000Z")].forEach(d => add("analytics", "quarterKey", d));
  add("analytics", "cohortData", accounts);
  g("CHURN_DIMS").forEach(dim => add("analytics", "churnRows", accounts, RATES, dim, D(NOW)));
  add("analytics", "churnRows", accounts, RATES, "Reason");
  add("analytics", "renewalOutcomeRows", accounts, RATES, snapshots, D(NOW));
  add("analytics", "renewalOutcomeRows", accounts, RATES, []);
  // csv
  add("csv", "parseCSV", 'name,arr,notes\r\n"Acme, Inc",100,"he said ""hi"""\r\nBeta,200,\n\nGamma,"300",x\n');
  add("csv", "parseCSV", "");
  [["05-07-2026", "26-08-2026"], ["08-26-2026", "05-07-2026"], ["26-08-2026", "08-26-2026"], ["05-07-2026", "06-08-2026"], ["2026-07-05"], []].forEach(v => add("csv", "csvDateOrder", v));
  [["05-07-2026", "dmy"], ["05-07-2026", "mdy"], ["5/7/26", "dmy"], ["2026-07-05", "dmy"], ["5 Jul 2026", "dmy"], ["31-02-2026", "dmy"], ["soon", "dmy"], ["", "dmy"], ["05.07.2026", undefined]].forEach(x => add("csv", "parseCsvDate", ...x));
  add("csv", "accountsCSVText", accounts.slice(-5).map(a => ({ ...a, score: g("healthScore")(a, activities, base.weights, base), risk: "Yellow" })));
  [{ err: "bad" }, { ok: 2, updated: 1, skipped: 0 }, { ok: 0, updated: 3, skipped: 1, badDate: 2, badDateRows: [3, 4], churnSkipped: ["A"], badTier: 1, badStatus: 2, badValue: 1, dateOrder: "dmy-assumed" }].forEach(r => add("csv", "importSummary", r));
  add("csv", "subNumbers", accounts);

  const run = ([m, fn, args]) => {
    const v = g(fn)(...revive(args));
    // JSON would turn an undefined argument into null, which defeats default parameters;
    // mark it so the unit tests pass exactly what produced the output.
    const enc = args.map(a => a === undefined ? { $undef: 1 } : a);
    return [m, fn, enc, v instanceof Map ? { $map: [...v.entries()] } : v];
  };
  return { now: NOW, tz: "UTC", cases: C.map(run) };
}, NOW);

writeFileSync(OUT, JSON.stringify(golden, null, 1) + "\n");
console.log("wrote", golden.cases.length, "cases to", OUT);
await browser.close();
