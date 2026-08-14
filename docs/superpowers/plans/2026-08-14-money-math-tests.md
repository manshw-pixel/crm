# Money-Math Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every ARR figure the app reports — NRR, GRR, cohort retention, churn breakdowns, renewal win rates, forecast accuracy — is covered by a test that asserts an exact number, and the defects that coverage exposes are fixed.

**Architecture:** Two `useMemo` bodies in `crm.html` are lifted to top-level pure functions taking an injectable `now`; the `window.__health` export widens to expose them plus the four money functions that already exist at top level. Six new test files drive those functions through `page.evaluate`, plus form-level tests for the two write paths. No new dependencies, no framework change.

**Tech Stack:** Playwright (bundled Chromium in CI, msedge locally), the custom runner at `tests/health/run.mjs`, assertions from `tests/health/framework.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-14-money-math-tests-design.md`

## Global Constraints

- **Branch:** `test/money-math`, already created off `5ecf01a`, already holds the spec commit (`03396a2`).
- **Baseline: 115 passed, 0 failed.** Run `node tests/health/run.mjs` from `D:\AI Project\My Company`. Every task must end green.
- **Never pipe the suite.** `run.mjs` ends with `process.exit(fail ? 1 : 0)`. `node tests/health/run.mjs | tail -5` or a chained `; git something` reports the last command's exit code instead, which silently voids the CI gate. This is not hypothetical — it made a real 1-failure run look like a pass during PR #12.
- **Run exactly ONE suite at a time.** Concurrent Playwright runs contend for browsers.
- **Register every new test file** in `run.mjs`'s import list (lines 6-22). It discovers nothing by glob. An unimported test file never runs and reports no failure.
- **`arrUSD` is not a raw account field.** It is added by the scoring pass at `crm.html:3082` as `toUSD(a.arr, a.currency, rates)`. `retentionStats` and `cohortData` consume *scored* accounts, so every fixture account states `arrUSD` explicitly. Omitting it yields `undefined` and every sum becomes `NaN`.
- **No hardcoded quarter keys or absolute dates** except where a task injects an explicit `now`. Seed with `rel(days)`.
- **`DEFAULT_RATES` is `{ INR: 0.012, PHP: 0.018 }`** (`crm.html:78`). USD is always 1. An unlisted currency resolves to `0` via `rates?.[cur] ?? 0`.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Do not merge.** Merging to master deploys the live team app; that decision is the user's.

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `crm.html` | Modify (1335, 1377, 3282, 1167) | Two extractions, the widened export, and the leap-day fix |
| `tests/health/money-fixture.mjs` | Create | Shared scored-account builders. Not a test file; never imported by `run.mjs` |
| `tests/health/retention.test.mjs` | Create | `retentionStats` |
| `tests/health/cohort.test.mjs` | Create | `cohortData`, `quarterKey`, `monthsBetween` |
| `tests/health/churn-analysis.test.mjs` | Create | `churnRows` |
| `tests/health/renewal-outcomes.test.mjs` | Create | `renewalOutcomeRows` |
| `tests/health/renewal-write.test.mjs` | Create | `COMPLETE_RENEWAL` reducer + form |
| `tests/health/arr-audit.test.mjs` | Create | `ADJUST_ARR`, `auditChanges`, `withAudit` |
| `tests/health/run.mjs` | Modify (lines 6-22) | Registers each new test file |

---

### Task 1: Extract the row math and widen the export

Pure refactor. No behavior changes, no new tests of its own — the existing 115 are the regression net, and every later task depends on this one.

**Files:**
- Modify: `crm.html:1335` (`ChurnAnalysis`'s `useMemo`), `crm.html:1377` (`RenewalOutcomes`'s `useMemo`), `crm.html:3282` (the `window.__health` export)

**Interfaces:**
- Produces: `churnRows(accounts, rates, dim, now = new Date())` returning `[{ k, n, arr }]`; `renewalOutcomeRows(accounts, rates, snapshots, now = new Date())` returning `[{ key, renewed, renewedN, churned, churnedN, slipped, wr, forecast, current }]`. Both exported on `window.__health` alongside `retentionStats`, `cohortData`, `quarterKey`, `monthsBetween`, `toUSD`. Tasks 2-7 consume these exact names.

- [ ] **Step 1: Lift `ChurnAnalysis`'s row math to a top-level function**

Directly above `function ChurnAnalysis(...)` (currently line 1333, after the `CHURN_DIMS` const), insert:

```js
function churnRows(accounts, rates, dim, now = new Date()) {
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
```

This is the existing body verbatim, with one change: the `const now = new Date();` that was inside the `Quarterly` branch becomes the injected parameter.

- [ ] **Step 2: Point the component at it**

In `ChurnAnalysis`, replace the whole `const rows = useMemo(() => { … }, [accounts, rates, dim]);` block with:

```js
  const rows = useMemo(() => churnRows(accounts, rates, dim), [accounts, rates, dim]);
```

- [ ] **Step 3: Lift `RenewalOutcomes`'s row math**

Directly above `function RenewalOutcomes(...)` (currently line 1376), insert:

```js
function renewalOutcomeRows(accounts, rates, snapshots, now = new Date()) {
  return [4, 3, 2, 1, 0].map(off => {
    const startMonth = Math.floor(now.getMonth() / 3) * 3 - off * 3;
    const start = new Date(now.getFullYear(), startMonth, 1);
    const end = new Date(now.getFullYear(), startMonth + 3, 1);
    const mkey = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
    const startKey = mkey(start), endKey = mkey(end);
    const inQ = d => { const k = String(d).slice(0, 7); return k >= startKey && k < endKey; };
    let renewed = 0, renewedN = 0, churned = 0, churnedN = 0, slipped = 0;
    accounts.forEach(a => {
      (a.renewals || []).forEach(r => { if (r.completedOn && inQ(r.completedOn)) { renewed += toUSD(r.arr || 0, a.currency, rates); renewedN++; } });
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
```

Verbatim except that `const now = new Date();` inside the map body becomes the injected parameter.

- [ ] **Step 4: Point the component at it**

In `RenewalOutcomes`, replace the whole `const rows = useMemo(() => [4, 3, 2, 1, 0].map(off => { … }), [accounts, rates, snapshots]);` with:

```js
  const rows = useMemo(() => renewalOutcomeRows(accounts, rates, snapshots), [accounts, rates, snapshots]);
```

Leave everything below it — `firstForecast`, `anyForecast`, `wrChip`, and the JSX — untouched.

- [ ] **Step 5: Widen the export**

Change line 3282 from:

```js
window.__health = { isoPlus, addMonths, BAND_RANK, healthPlaybookOf, DEFAULT_HEALTH_PLAYBOOK, backfillCandidates, bucketTasks, filterTasks, parseCSV, importAccountsCSV };
```

to:

```js
window.__health = { isoPlus, addMonths, BAND_RANK, healthPlaybookOf, DEFAULT_HEALTH_PLAYBOOK, backfillCandidates, bucketTasks, filterTasks, parseCSV, importAccountsCSV,
  retentionStats, cohortData, churnRows, renewalOutcomeRows, quarterKey, monthsBetween, toUSD };
```

- [ ] **Step 6: Verify nothing regressed**

Run, unpiped:

```bash
node tests/health/run.mjs
```

Expected: **115 passed, 0 failed**. A failure here means the extraction changed behavior — the `dashboard.test.mjs` and `bell.test.mjs` cases render these components.

- [ ] **Step 7: Confirm the functions are actually reachable**

```bash
node -e "const h=require('fs').readFileSync('crm.html','utf8'); ['churnRows','renewalOutcomeRows','retentionStats','cohortData','quarterKey','monthsBetween','toUSD'].forEach(n=>{ if(!new RegExp('window.__health[^;]*'+n).test(h)) throw new Error('not exported: '+n); }); console.log('all seven exported')"
```

Expected: `all seven exported`.

- [ ] **Step 8: Commit**

```bash
git add crm.html
git commit -m "refactor: lift churn and renewal-outcome row math out of render

Both were computed inside a useMemo, unreachable from tests. Now top-level
pure functions with an injectable clock, exported on window.__health.
No behavior change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The shared fixture and `retentionStats`

**Files:**
- Create: `tests/health/money-fixture.mjs`, `tests/health/retention.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: `window.__health.retentionStats` from Task 1.
- Produces: `rel(days)`, `RATES`, `scored(o)`, `bookSeed(accounts, settings)` from `money-fixture.mjs`. Tasks 3-7 import all four.

- [ ] **Step 1: Write the fixture**

Create `tests/health/money-fixture.mjs`:

```js
// Fixtures for the money-math suite.
//
// IMPORTANT: `arrUSD` is NOT a stored account field — the scoring pass at crm.html:3082
// adds it as toUSD(a.arr, a.currency, rates) before any analytics function sees it.
// retentionStats and cohortData read a.arrUSD directly, so every fixture account states
// it explicitly. Leaving it off yields undefined and every sum becomes NaN.
import { seedAccount } from "./harness.mjs";

export const DAY = 86400000;

// Relative ISO date. Seeding by offset keeps quarter-bucketing tests from breaking on a
// calendar boundary — see the spec's "central risk" section.
export const rel = days => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

// crm.html:78. USD is always 1; anything unlisted resolves to 0.
export const RATES = { INR: 0.012, PHP: 0.018 };

// A scored account: seedAccount's defaults plus arrUSD, which callers usually set to arr
// (USD) or to arr * rate for a foreign-currency account.
export function scored(o = {}) {
  const a = seedAccount(o);
  return { ...a, arrUSD: o.arrUSD !== undefined ? o.arrUSD : a.arr };
}

// Seed script for launch(). `settings` is the settings ROW payload (rates, snapshots...),
// stored as a single row the way crm.html:289 reads it back.
export function bookSeed(accounts, settings = null) {
  return `window.__seedRows = { accounts: ${JSON.stringify(accounts)}.map(d => ({ id: d.id, data: d })),`
    + ` contacts: [], activities: [], tasks: [], opportunities: [], team: [],`
    + ` settings: ${settings ? `[{ id: "s1", data: ${JSON.stringify(settings)} }]` : "[]"} };`;
}
```

- [ ] **Step 2: Write the failing retention test**

Create `tests/health/retention.test.mjs`. The book below is hand-computed; the comment block is the arithmetic and must stay accurate if anyone edits the fixture:

```js
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { rel, RATES, scored, bookSeed } from "./money-fixture.mjs";

// Hand-computed expectations for BOOK:
//   retARR (non-churned arrUSD)  = 100000 + 120000 + 80000 + 50000 = 350000
//   churnedARR (last 12mo)       = 50000
//   expansion (last 12mo)        = 20000   (B's renewal: 120000 - 100000)
//   contraction (last 12mo)      = 20000   (C's arrEvent: -20000, stored positive)
//   base = retARR + churnedARR - expansion + contraction = 400000
//        (i.e. the ARR this book started the year with)
//   grr = (400000 - 50000 - 20000) / 400000 = 0.825
//   nrr = (400000 - 50000 - 20000 + 20000) / 400000 = 0.875
const BOOK = [
  scored({ id: "a", name: "Steady Co", arr: 100000 }),
  scored({ id: "b", name: "Grew Co", arr: 120000,
    renewals: [{ id: "r1", completedOn: rel(-180), prevArr: 100000, arr: 120000, by: "Priya" }] }),
  scored({ id: "c", name: "Shrank Co", arr: 80000,
    arrEvents: [{ id: "e1", date: rel(-100), delta: -20000, kind: "contraction", source: "adjustment" }] }),
  scored({ id: "d", name: "Lost Co", arr: 50000, arrUSD: 0,
    churn: { date: rel(-60), arr: 50000, reason: "Price" } }),
  // outside the 12-month window: must be ignored entirely
  scored({ id: "e", name: "Old News Co", arr: 50000,
    renewals: [{ id: "r2", completedOn: rel(-400), prevArr: 10000, arr: 50000, by: "Priya" }] }),
];

test("retentionStats computes NRR and GRR from churn, renewals and ARR events", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const s = await page.evaluate(([book, rates]) => window.__health.retentionStats(book, rates), [BOOK, RATES]);
  assert(s.churnedARR === 50000, `churnedARR expected 50000, got ${s.churnedARR}`);
  assert(s.expansion === 20000, `expansion expected 20000, got ${s.expansion}`);
  assert(s.contraction === 20000, `contraction expected 20000, got ${s.contraction}`);
  assert(s.lost === 1, `lost expected 1, got ${s.lost}`);
  assert(Math.abs(s.grr - 0.825) < 1e-9, `grr expected 0.825, got ${s.grr}`);
  assert(Math.abs(s.nrr - 0.875) < 1e-9, `nrr expected 0.875, got ${s.nrr}`);
  await browser.close();
});

test("retentionStats ignores events older than twelve months", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // Old News Co's +40000 renewal sits at rel(-400). If the window leaked, expansion
  // would be 60000 rather than 20000.
  const s = await page.evaluate(([book, rates]) => window.__health.retentionStats(book, rates), [BOOK, RATES]);
  assert(s.expansion === 20000, `the 400-day-old renewal leaked into expansion: ${s.expansion}`);
  await browser.close();
});

test("retentionStats returns null ratios for an empty book rather than NaN", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const s = await page.evaluate(rates => window.__health.retentionStats([], rates), RATES);
  assert(s.grr === null, `grr should be null on an empty book, got ${s.grr}`);
  assert(s.nrr === null, `nrr should be null on an empty book, got ${s.nrr}`);
  assert(s.churnedARR === 0 && s.lost === 0, `empty book should report no loss: ${JSON.stringify(s)}`);
  await browser.close();
});

test("a completed renewal is counted once, from renewals and not also from arrEvents", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // COMPLETE_RENEWAL writes a renewals entry and deliberately no arrEvent (crm.html:392).
  // If that ever changes, every renewal counts twice toward expansion. Pin the invariant.
  const s = await page.evaluate(([book, rates]) => window.__health.retentionStats(book, rates), [BOOK, RATES]);
  assert(s.expansion === 20000, `renewal double-counted into expansion: ${s.expansion}`);
  await browser.close();
});

test("an account in an unrecognized currency contributes zero revenue, silently", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // toUSD falls back to `rates?.[cur] ?? 0`, so an unknown currency zeroes the account
  // instead of failing. Documented here so the behavior is a decision, not a surprise.
  const book = [scored({ id: "x", name: "Zloty Co", arr: 100000, currency: "PLN", arrUSD: 0,
    churn: { date: rel(-30), arr: 100000, reason: "Price" } })];
  const s = await page.evaluate(([b, rates]) => window.__health.retentionStats(b, rates), [book, RATES]);
  assert(s.churnedARR === 0, `unknown currency should convert to 0, got ${s.churnedARR}`);
  assert(s.lost === 1, `the logo should still count as lost, got ${s.lost}`);
  await browser.close();
});

test("a foreign-currency churn converts at the configured rate", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const book = [scored({ id: "y", name: "Rupee Co", arr: 1000000, currency: "INR", arrUSD: 12000,
    churn: { date: rel(-30), arr: 1000000, currency: "INR", reason: "Fit" } })];
  const s = await page.evaluate(([b, rates]) => window.__health.retentionStats(b, rates), [book, RATES]);
  assert(Math.abs(s.churnedARR - 12000) < 1e-6, `1,000,000 INR at 0.012 should be 12000, got ${s.churnedARR}`);
  await browser.close();
});
```

- [ ] **Step 3: Register the file**

In `tests/health/run.mjs`, add after the `import "./csv.test.mjs";` line:

```js
import "./retention.test.mjs";
```

- [ ] **Step 4: Run and read the result carefully**

```bash
node tests/health/run.mjs
```

Expected: **121 passed, 0 failed** — the 6 new tests pass on the first run if `retentionStats` is correct.

**If any assertion fails, STOP and report before changing `crm.html`.** A failure here means the NRR/GRR the app has been reporting is wrong, which is a finding, not a chore. Report the expected and actual numbers and wait for a ruling. Do not adjust the test to match the code — the fixture arithmetic is in the comment block and can be checked by hand.

- [ ] **Step 5: Commit**

```bash
git add tests/health/money-fixture.mjs tests/health/retention.test.mjs tests/health/run.mjs
git commit -m "test: cover retentionStats NRR and GRR

Pins the base reconstruction, the twelve-month window, empty-book nulls,
the renewal/arrEvent double-count invariant, and currency conversion.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `cohortData`

**Files:**
- Create: `tests/health/cohort.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: `window.__health.cohortData`, `quarterKey`, `monthsBetween`; `rel`, `scored`, `bookSeed` from `money-fixture.mjs`.

- [ ] **Step 1: Write the failing tests**

Create `tests/health/cohort.test.mjs`:

```js
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { rel, scored, bookSeed } from "./money-fixture.mjs";

// Cohorts key off startDate. Offsets are chosen to sit well inside a quarter so the
// suite cannot break on a quarter boundary: rel(-400) is ~13 months back, rel(-1500)
// is past the 3-year line where cohorts collapse to a bare year.
const BOOK = [
  scored({ id: "n1", name: "New A", arr: 100000, startDate: rel(-40) }),
  scored({ id: "n2", name: "New B", arr: 200000, startDate: rel(-40) }),
  scored({ id: "o1", name: "Old A", arr: 50000, startDate: rel(-1500) }),
];

test("cohortData groups recent accounts by start quarter and old ones by year", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(book => window.__health.cohortData(book), BOOK);
  const recent = rows.find(r => /^\d{4}-Q[1-4]$/.test(r.key));
  const old = rows.find(r => /^\d{4}$/.test(r.key));
  assert(recent, `expected a YYYY-QN cohort, got keys: ${rows.map(r => r.key).join()}`);
  assert(old, `expected a bare YYYY cohort for the 3+ year-old account, got: ${rows.map(r => r.key).join()}`);
  assert(recent.size === 2, `the two same-quarter accounts should share a cohort, got ${recent.size}`);
  assert(recent.arr === 300000, `cohort ARR expected 300000, got ${recent.arr}`);
  await browser.close();
});

test("cohortData skips accounts with a missing or unparseable startDate", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const book = [
    scored({ id: "g", name: "Good", arr: 10000, startDate: rel(-40) }),
    scored({ id: "n", name: "No Date", arr: 10000, startDate: "" }),
    scored({ id: "b", name: "Bad Date", arr: 10000, startDate: "not-a-date" }),
  ];
  const rows = await page.evaluate(b => window.__health.cohortData(b), book);
  const total = rows.reduce((s, r) => s + r.size, 0);
  assert(total === 1, `only the account with a valid startDate should appear, got ${total}`);
  await browser.close();
});

test("a never-churned account stays retained in every quarter column", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const book = [scored({ id: "s", name: "Survivor", arr: 100000, startDate: rel(-400) })];
  const rows = await page.evaluate(b => window.__health.cohortData(b), book);
  assert(rows[0].cells.every(c => c.pct === 1), `survivor dipped below 100%: ${JSON.stringify(rows[0].cells)}`);
  assert(rows[0].cells.length >= 4, `a 400-day-old cohort should span several quarters, got ${rows[0].cells.length}`);
  await browser.close();
});

test("an account that churns in its first quarter still counts as retained at Q0", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // surv = floor(monthsBetween(start, churn) / 3) = 0, and the filter is `surv >= q`,
  // so Q0 counts it. Everyone is alive at Q0 by definition; Q1 is where it drops out.
  const book = [
    scored({ id: "q", name: "Quick Churn", arr: 100000, startDate: rel(-400),
      churn: { date: rel(-380), arr: 100000, reason: "Fit" }, arrUSD: 100000 }),
    scored({ id: "l", name: "Lasted", arr: 100000, startDate: rel(-400) }),
  ];
  const rows = await page.evaluate(b => window.__health.cohortData(b), book);
  assert(rows[0].cells[0].pct === 1, `Q0 should retain everyone, got ${rows[0].cells[0].pct}`);
  assert(rows[0].cells[1].pct === 0.5, `Q1 should show 1 of 2 retained, got ${rows[0].cells[1].pct}`);
  await browser.close();
});

test("logo retention and ARR retention diverge when a large account churns", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const book = [
    scored({ id: "big", name: "Big", arr: 900000, arrUSD: 900000, startDate: rel(-400),
      churn: { date: rel(-380), arr: 900000, reason: "Price" } }),
    scored({ id: "small", name: "Small", arr: 100000, arrUSD: 100000, startDate: rel(-400) }),
  ];
  const rows = await page.evaluate(b => window.__health.cohortData(b), book);
  assert(rows[0].cells[1].pct === 0.5, `logo retention at Q1 expected 0.5, got ${rows[0].cells[1].pct}`);
  assert(Math.abs(rows[0].cells[1].arrPct - 0.1) < 1e-9, `ARR retention at Q1 expected 0.1, got ${rows[0].cells[1].arrPct}`);
  await browser.close();
});

test("a cohort's columns stop at its own age", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const book = [
    scored({ id: "young", name: "Young", arr: 10000, startDate: rel(-40) }),
    scored({ id: "old", name: "Old", arr: 10000, startDate: rel(-400) }),
  ];
  const rows = await page.evaluate(b => window.__health.cohortData(b), book);
  const young = rows[rows.length - 1], old = rows[0];
  assert(young.cells.length < old.cells.length,
    `the younger cohort should have fewer columns: young ${young.cells.length}, old ${old.cells.length}`);
  await browser.close();
});

test("monthsBetween and quarterKey agree on quarter boundaries", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const r = await page.evaluate(() => ({
    span: window.__health.monthsBetween("2026-01-31", "2026-03-01"),
    q1: window.__health.quarterKey("2026-03-31"),
    q2: window.__health.quarterKey("2026-04-01"),
    q4: window.__health.quarterKey("2026-12-31"),
  }));
  // monthsBetween counts calendar months, not elapsed days: Jan 31 -> Mar 1 is 2.
  assert(r.span === 2, `monthsBetween expected 2, got ${r.span}`);
  assert(r.q1 === "2026-Q1", `2026-03-31 should be Q1, got ${r.q1}`);
  assert(r.q2 === "2026-Q2", `2026-04-01 should be Q2, got ${r.q2}`);
  assert(r.q4 === "2026-Q4", `2026-12-31 should be Q4, got ${r.q4}`);
  await browser.close();
});
```

- [ ] **Step 2: Register the file**

Add to `tests/health/run.mjs`:

```js
import "./cohort.test.mjs";
```

- [ ] **Step 3: Run**

```bash
node tests/health/run.mjs
```

Expected: **128 passed, 0 failed**.

If the churn-at-Q0 or the columns-stop-at-age test fails, STOP and report — those encode real retention semantics and the right answer is a judgment call, not a test edit.

- [ ] **Step 4: Commit**

```bash
git add tests/health/cohort.test.mjs tests/health/run.mjs
git commit -m "test: cover cohortData retention

Cohort keying, the three-year year-grouping, survival semantics at Q0,
logo-vs-ARR divergence, and quarter-boundary helpers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `churnRows`

**Files:**
- Create: `tests/health/churn-analysis.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: `window.__health.churnRows(accounts, rates, dim, now)` from Task 1.

- [ ] **Step 1: Write the failing tests**

Create `tests/health/churn-analysis.test.mjs`:

```js
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { rel, RATES, scored, bookSeed } from "./money-fixture.mjs";

const BOOK = [
  scored({ id: "c1", name: "Price One", arr: 100000, arrUSD: 0, csm: "Priya", tier: "Enterprise",
    churn: { date: rel(-30), arr: 100000, reason: "Price" } }),
  scored({ id: "c2", name: "Price Two", arr: 50000, arrUSD: 0, csm: "Marco", tier: "Mid",
    churn: { date: rel(-45), arr: 50000, reason: "Price" } }),
  scored({ id: "c3", name: "Fit One", arr: 200000, arrUSD: 0, csm: "Priya", tier: "Enterprise",
    churn: { date: rel(-60), arr: 200000, reason: "Product fit" } }),
  scored({ id: "a1", name: "Still Here", arr: 300000 }),
];

test("churnRows groups by reason and sorts by ARR lost", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(([b, rates]) => window.__health.churnRows(b, rates, "Reason"), [BOOK, RATES]);
  assert(rows.length === 2, `expected 2 reasons, got ${rows.length}: ${rows.map(r => r.k).join()}`);
  assert(rows[0].k === "Product fit", `largest loss should sort first, got ${rows[0].k}`);
  assert(rows[0].arr === 200000, `Product fit ARR expected 200000, got ${rows[0].arr}`);
  assert(rows[1].k === "Price" && rows[1].n === 2, `Price should hold 2 accounts, got ${JSON.stringify(rows[1])}`);
  assert(rows[1].arr === 150000, `Price ARR expected 150000, got ${rows[1].arr}`);
  await browser.close();
});

test("churnRows groups by CSM and by tier", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const r = await page.evaluate(([b, rates]) => ({
    csm: window.__health.churnRows(b, rates, "CSM"),
    tier: window.__health.churnRows(b, rates, "Tier"),
  }), [BOOK, RATES]);
  const priya = r.csm.find(x => x.k === "Priya");
  assert(priya && priya.n === 2 && priya.arr === 300000, `Priya expected 2 accts / 300000, got ${JSON.stringify(priya)}`);
  const ent = r.tier.find(x => x.k === "Enterprise");
  assert(ent && ent.n === 2 && ent.arr === 300000, `Enterprise expected 2 accts / 300000, got ${JSON.stringify(ent)}`);
  await browser.close();
});

test("churnRows falls back to Other and Unassigned for missing fields", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const book = [scored({ id: "m", name: "Mystery", arr: 10000, arrUSD: 0, csm: "",
    churn: { date: rel(-10), arr: 10000 } })];
  const r = await page.evaluate(([b, rates]) => ({
    reason: window.__health.churnRows(b, rates, "Reason")[0].k,
    csm: window.__health.churnRows(b, rates, "CSM")[0].k,
  }), [book, RATES]);
  assert(r.reason === "Other", `missing reason should read Other, got ${r.reason}`);
  assert(r.csm === "Unassigned", `missing CSM should read Unassigned, got ${r.csm}`);
  await browser.close();
});

test("the Quarterly dim returns exactly eight chronological zero-filled quarters", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // Clock injected: an absolute `now` makes the expected keys exact and keeps this test
  // stable on any calendar day.
  const rows = await page.evaluate(([b, rates]) =>
    window.__health.churnRows(b, rates, "Quarterly", new Date("2026-05-15T12:00:00")), [BOOK, RATES]);
  assert(rows.length === 8, `expected 8 quarters, got ${rows.length}`);
  assert(rows[0].k === "2024-Q3", `oldest quarter expected 2024-Q3, got ${rows[0].k}`);
  assert(rows[7].k === "2026-Q2", `newest quarter expected 2026-Q2, got ${rows[7].k}`);
  const keys = rows.map(r => r.k);
  assert(JSON.stringify(keys) === JSON.stringify([...keys].sort()), `quarters out of order: ${keys.join()}`);
  assert(rows.some(r => r.n === 0 && r.arr === 0), `a quiet quarter should be zero-filled, got ${JSON.stringify(keys)}`);
  await browser.close();
});

test("the Quarterly window rolls back across a year boundary", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // January is where `now.getMonth() - i * 3` goes negative and must borrow from the
  // previous year. Getting this wrong misfiles every quarter in Q1.
  const rows = await page.evaluate(([b, rates]) =>
    window.__health.churnRows(b, rates, "Quarterly", new Date("2026-01-10T12:00:00")), [BOOK, RATES]);
  assert(rows[0].k === "2024-Q2", `oldest quarter expected 2024-Q2, got ${rows[0].k}`);
  assert(rows[7].k === "2026-Q1", `newest quarter expected 2026-Q1, got ${rows[7].k}`);
  await browser.close();
});

test("a churn keeps its own currency, not the account's current one", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // The account bills in USD today; it churned while billing in INR. The historical
  // event's currency is the correct one to convert with.
  const book = [scored({ id: "moved", name: "Moved Currency", arr: 100000, currency: "USD", arrUSD: 0,
    churn: { date: rel(-20), arr: 1000000, currency: "INR", reason: "Price" } })];
  const rows = await page.evaluate(([b, rates]) => window.__health.churnRows(b, rates, "Reason"), [book, RATES]);
  assert(Math.abs(rows[0].arr - 12000) < 1e-6, `1,000,000 INR at 0.012 expected 12000, got ${rows[0].arr}`);
  await browser.close();
});

test("churnRows on a book with no churn returns nothing", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(rates =>
    window.__health.churnRows([{ id: "x", name: "Fine", arr: 1, arrUSD: 1 }], rates, "Reason"), RATES);
  assert(rows.length === 0, `expected no rows, got ${JSON.stringify(rows)}`);
  await browser.close();
});
```

- [ ] **Step 2: Register the file**

Add to `tests/health/run.mjs`:

```js
import "./churn-analysis.test.mjs";
```

- [ ] **Step 3: Run**

```bash
node tests/health/run.mjs
```

Expected: **135 passed, 0 failed**.

- [ ] **Step 4: Commit**

```bash
git add tests/health/churn-analysis.test.mjs tests/health/run.mjs
git commit -m "test: cover churn analysis row math

All four dimensions, fallbacks, the eight-quarter zero-filled window
including the January year-boundary case, and historical currency.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `renewalOutcomeRows`

**Files:**
- Create: `tests/health/renewal-outcomes.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: `window.__health.renewalOutcomeRows(accounts, rates, snapshots, now)` from Task 1.

Every test in this file injects `now`, because quarter membership is the whole subject.

- [ ] **Step 1: Write the failing tests**

Create `tests/health/renewal-outcomes.test.mjs`:

```js
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { RATES, scored, bookSeed } from "./money-fixture.mjs";

// now = 2026-05-15 puts us in 2026-Q2, so the five rows are Q2'25 … Q2'26 and the last
// is the current one. Absolute dates are safe here only because the clock is injected.
const NOW = "2026-05-15T12:00:00";

const BOOK = [
  // renewed inside 2026-Q2
  scored({ id: "r", name: "Renewed Co", arr: 120000, renewalDate: "2027-04-10",
    renewals: [{ id: "x1", completedOn: "2026-04-10", from: "2026-04-10", to: "2027-04-10", prevArr: 100000, arr: 120000, by: "Priya" }] }),
  // churned inside 2026-Q2
  scored({ id: "c", name: "Churned Co", arr: 80000, arrUSD: 0,
    churn: { date: "2026-04-20", arr: 80000, reason: "Price" } }),
  // renewal date passed inside 2026-Q2 with no covering renewal: slipped
  scored({ id: "s", name: "Slipped Co", arr: 60000, renewalDate: "2026-04-01" }),
];

const SNAPSHOTS = [{ month: "2026-04", commit90: 100000 }];

test("renewalOutcomeRows returns five quarters, oldest first, current flagged last", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(([b, rates, snaps, now]) =>
    window.__health.renewalOutcomeRows(b, rates, snaps, new Date(now)), [BOOK, RATES, SNAPSHOTS, NOW]);
  assert(rows.length === 5, `expected 5 quarters, got ${rows.length}`);
  assert(rows[0].key === "2025-Q2", `oldest expected 2025-Q2, got ${rows[0].key}`);
  assert(rows[4].key === "2026-Q2", `newest expected 2026-Q2, got ${rows[4].key}`);
  assert(rows[4].current === true, "the newest quarter should be flagged current");
  assert(rows.slice(0, 4).every(r => !r.current), "only the newest quarter may be flagged current");
  await browser.close();
});

test("a renewal lands in the quarter it completed in, not the term it covers", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // Renewed Co completed 2026-04-10 for a term ending 2027-04-10. It belongs to 2026-Q2.
  const rows = await page.evaluate(([b, rates, snaps, now]) =>
    window.__health.renewalOutcomeRows(b, rates, snaps, new Date(now)), [BOOK, RATES, SNAPSHOTS, NOW]);
  const q2 = rows[4];
  assert(q2.renewedN === 1, `expected 1 renewal in 2026-Q2, got ${q2.renewedN}`);
  assert(q2.renewed === 120000, `renewed ARR expected 120000 (the new term), got ${q2.renewed}`);
  await browser.close();
});

test("churn and slippage are counted in the quarter they fall in", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(([b, rates, snaps, now]) =>
    window.__health.renewalOutcomeRows(b, rates, snaps, new Date(now)), [BOOK, RATES, SNAPSHOTS, NOW]);
  const q2 = rows[4];
  assert(q2.churnedN === 1 && q2.churned === 80000, `expected 1 churn / 80000, got ${JSON.stringify(q2)}`);
  assert(q2.slipped === 1, `Slipped Co should count as slipped, got ${q2.slipped}`);
  await browser.close();
});

test("a renewal completed on time clears the slipped flag", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // Same past renewal date as Slipped Co, but with a renewal recorded on or after it.
  const book = [scored({ id: "ok", name: "Handled Co", arr: 60000, renewalDate: "2026-04-01",
    renewals: [{ id: "x2", completedOn: "2026-04-02", prevArr: 60000, arr: 60000, by: "Priya" }] })];
  const rows = await page.evaluate(([b, rates, now]) =>
    window.__health.renewalOutcomeRows(b, rates, [], new Date(now)), [book, RATES, NOW]);
  assert(rows[4].slipped === 0, `a covered renewal must not count as slipped, got ${rows[4].slipped}`);
  await browser.close();
});

test("win rate is renewed over renewed-plus-churned, and null for an empty quarter", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(([b, rates, snaps, now]) =>
    window.__health.renewalOutcomeRows(b, rates, snaps, new Date(now)), [BOOK, RATES, SNAPSHOTS, NOW]);
  // 120000 / (120000 + 80000) = 0.6
  assert(Math.abs(rows[4].wr - 0.6) < 1e-9, `win rate expected 0.6, got ${rows[4].wr}`);
  assert(rows[0].wr === null, `a quarter with no activity should report null, not 0, got ${rows[0].wr}`);
  await browser.close();
});

test("forecast comes from the snapshot for the quarter's first month", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(([b, rates, snaps, now]) =>
    window.__health.renewalOutcomeRows(b, rates, snaps, new Date(now)), [BOOK, RATES, SNAPSHOTS, NOW]);
  assert(rows[4].forecast === 100000, `2026-Q2 forecast expected 100000 from the 2026-04 snapshot, got ${rows[4].forecast}`);
  assert(rows[0].forecast === null, `quarters without a snapshot should report null, got ${rows[0].forecast}`);
  // renewed 120000 vs commit 100000 — the app renders this as a beat
  assert(rows[4].renewed > rows[4].forecast, "120000 renewed should beat a 100000 commit");
  await browser.close();
});

test("a snapshot without commit90 is ignored", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(([b, rates, now]) =>
    window.__health.renewalOutcomeRows(b, rates, [{ month: "2026-04", best: 999 }], new Date(now)), [BOOK, RATES, NOW]);
  assert(rows[4].forecast === null, `a snapshot lacking commit90 should not supply a forecast, got ${rows[4].forecast}`);
  await browser.close();
});

test("the quarter window rolls back across a year boundary", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // In Q1, startMonth goes negative for every earlier quarter and must borrow from the
  // previous year. crm.html relies on new Date(y, -3, 1) normalizing; pin it.
  const rows = await page.evaluate(([b, rates, now]) =>
    window.__health.renewalOutcomeRows(b, rates, [], new Date(now)), [BOOK, RATES, "2026-01-10T12:00:00"]);
  assert(rows[0].key === "2025-Q1", `oldest expected 2025-Q1, got ${rows[0].key}`);
  assert(rows[4].key === "2026-Q1", `newest expected 2026-Q1, got ${rows[4].key}`);
  await browser.close();
});

test("a foreign-currency renewal converts at the configured rate", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const book = [scored({ id: "inr", name: "Rupee Renewal", arr: 1000000, currency: "INR", arrUSD: 12000,
    renewalDate: "2027-04-10",
    renewals: [{ id: "x3", completedOn: "2026-04-10", prevArr: 900000, arr: 1000000, by: "Priya" }] })];
  const rows = await page.evaluate(([b, rates, now]) =>
    window.__health.renewalOutcomeRows(b, rates, [], new Date(now)), [book, RATES, NOW]);
  assert(Math.abs(rows[4].renewed - 12000) < 1e-6, `1,000,000 INR at 0.012 expected 12000, got ${rows[4].renewed}`);
  await browser.close();
});
```

- [ ] **Step 2: Register the file**

Add to `tests/health/run.mjs`:

```js
import "./renewal-outcomes.test.mjs";
```

- [ ] **Step 3: Run**

```bash
node tests/health/run.mjs
```

Expected: **144 passed, 0 failed**.

The slipped-flag and year-boundary cases are the likeliest to expose a real defect. If either fails, STOP and report the exact rows returned; do not edit the expectation.

- [ ] **Step 4: Commit**

```bash
git add tests/health/renewal-outcomes.test.mjs tests/health/run.mjs
git commit -m "test: cover renewal outcomes by quarter

Quarter membership, slippage in both directions, win rate nulls, forecast
matching from snapshots, and the January year-boundary roll-back.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `COMPLETE_RENEWAL`, and the leap-day fix

**Files:**
- Create: `tests/health/renewal-write.test.mjs`
- Modify: `tests/health/run.mjs`, `crm.html:1167`

**Interfaces:**
- Consumes: `window.__store` (the app store, already exposed and used by `csv.test.mjs`), `window.__health.addMonths`.

- [ ] **Step 1: Write the reducer tests**

Create `tests/health/renewal-write.test.mjs`:

```js
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { scored, bookSeed } from "./money-fixture.mjs";

const A = scored({ id: "a1", name: "Alpha Corp", arr: 100000, renewalDate: "2027-01-01",
  billingCompleted: true, billingCompletedDate: "2026-02-01", renewalStage: "In negotiation" });
const seed = bookSeed([A]);

// Mirrors what CompleteRenewalForm dispatches (crm.html:1173).
const complete = (page, { newDate, newArr }) => page.evaluate(([d, arr]) => {
  const a = window.__store.getState().accounts.find(x => x.id === "a1");
  window.__store.dispatch({ type: "COMPLETE_RENEWAL", id: "a1", newDate: d, newArr: arr,
    entry: { id: "e1", completedOn: "2026-08-14", from: a.renewalDate, to: d, prevArr: a.arr, arr, by: "Tester",
      billingCompleted: !!a.billingCompleted, billingCompletedDate: a.billingCompletedDate || null } });
  const u = window.__store.getState().accounts.find(x => x.id === "a1");
  return { renewalDate: u.renewalDate, arr: u.arr, contractStatus: u.contractStatus,
    billingCompleted: u.billingCompleted, billingCompletedDate: u.billingCompletedDate,
    renewalStage: u.renewalStage, renewals: u.renewals, audit: u.audit || [] };
}, [newDate, newArr]);

test("COMPLETE_RENEWAL moves the date, updates ARR and records the renewal", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  const u = await complete(page, { newDate: "2028-01-01", newArr: 120000 });
  assert(u.renewalDate === "2028-01-01", `renewalDate expected 2028-01-01, got ${u.renewalDate}`);
  assert(u.arr === 120000, `arr expected 120000, got ${u.arr}`);
  assert(u.contractStatus === "Active", `contractStatus expected Active, got ${u.contractStatus}`);
  assert(u.renewals.length === 1, `expected 1 renewals entry, got ${u.renewals.length}`);
  assert(u.renewals[0].prevArr === 100000 && u.renewals[0].arr === 120000,
    `renewals entry should carry both ARR values, got ${JSON.stringify(u.renewals[0])}`);
  await browser.close();
});

test("COMPLETE_RENEWAL resets billing and the renewal stage for the new term", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  const u = await complete(page, { newDate: "2028-01-01", newArr: 120000 });
  assert(u.billingCompleted === false, `billingCompleted should reset to false, got ${u.billingCompleted}`);
  assert(u.billingCompletedDate === null, `billingCompletedDate should clear, got ${u.billingCompletedDate}`);
  assert(u.renewalStage === "Not started", `renewalStage should reset, got ${u.renewalStage}`);
  await browser.close();
});

test("COMPLETE_RENEWAL stores the renewal entry verbatim, losing no fields", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  // The reducer must append action.entry whole. The account's live billing flags reset
  // for the new term, so the entry is the ONLY record of what was true for the term that
  // just ended — a reducer that rebuilt it field-by-field would silently drop history.
  const r = await page.evaluate(() => {
    const entry = { id: "e9", completedOn: "2026-08-14", from: "2027-01-01", to: "2028-01-01",
      prevArr: 100000, arr: 120000, by: "Tester", billingCompleted: true, billingCompletedDate: "2026-02-01" };
    window.__store.dispatch({ type: "COMPLETE_RENEWAL", id: "a1", newDate: "2028-01-01", newArr: 120000, entry });
    const stored = window.__store.getState().accounts.find(x => x.id === "a1").renewals[0];
    return { stored, same: JSON.stringify(stored) === JSON.stringify(entry) };
  });
  assert(r.same, `the entry should be stored unchanged, got ${JSON.stringify(r.stored)}`);
  await browser.close();
});

test("COMPLETE_RENEWAL writes audit entries only for fields that changed", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  const u = await complete(page, { newDate: "2028-01-01", newArr: 120000 });
  const fields = u.audit.map(e => e.field).sort();
  assert(JSON.stringify(fields) === JSON.stringify(["arr", "renewalDate"]),
    `expected arr and renewalDate audit entries, got ${JSON.stringify(fields)}`);
  const arrEntry = u.audit.find(e => e.field === "arr");
  assert(arrEntry.from === 100000 && arrEntry.to === 120000,
    `arr audit should record 100000 -> 120000, got ${JSON.stringify(arrEntry)}`);
  assert(arrEntry.source === "renewal", `audit source expected renewal, got ${arrEntry.source}`);
  await browser.close();
});

test("a flat renewal writes no ARR audit entry", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  const u = await complete(page, { newDate: "2028-01-01", newArr: 100000 });
  assert(!u.audit.some(e => e.field === "arr"),
    `unchanged ARR should not be audited, got ${JSON.stringify(u.audit)}`);
  assert(u.audit.some(e => e.field === "renewalDate"), "the date change should still be audited");
  await browser.close();
});

test("COMPLETE_RENEWAL writes no arrEvent, so retention counts the renewal once", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  const events = await page.evaluate(() => {
    window.__store.dispatch({ type: "COMPLETE_RENEWAL", id: "a1", newDate: "2028-01-01", newArr: 120000,
      entry: { id: "e2", completedOn: "2026-08-14", from: "2027-01-01", to: "2028-01-01", prevArr: 100000, arr: 120000, by: "Tester" } });
    return window.__store.getState().accounts.find(x => x.id === "a1").arrEvents || [];
  });
  // retentionStats sums renewals AND arrEvents. If a renewal also wrote an arrEvent,
  // every renewal would count twice toward expansion.
  assert(events.length === 0, `COMPLETE_RENEWAL must not write arrEvents, got ${JSON.stringify(events)}`);
  await browser.close();
});
```

- [ ] **Step 2: Register and run**

Add `import "./renewal-write.test.mjs";` to `tests/health/run.mjs`, then:

```bash
node tests/health/run.mjs
```

Expected: **150 passed, 0 failed**. Report and stop if any fail.

- [ ] **Step 3: Commit the reducer tests**

```bash
git add tests/health/renewal-write.test.mjs tests/health/run.mjs
git commit -m "test: cover the COMPLETE_RENEWAL reducer

Date and ARR updates, billing/stage reset, audit entries only for changed
fields, and the no-arrEvent invariant that keeps retention from double-counting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Write the failing test for the leap-day defect**

This must be the form-level test, and it must be written before the fix — it is the only
assertion that actually fails against today's code. Append to
`tests/health/renewal-write.test.mjs`:

```js
test("the renewal form's date field is prefilled one year out, not 365 days out", async () => {
  const { page, browser } = await launch(bookSeed([
    scored({ id: "a1", name: "Alpha Corp", arr: 100000, renewalDate: "2027-03-01" })]));
  await page.waitForFunction(() => window.__store);
  // Renewing a 2027-03-01 contract must prefill 2028-03-01. Adding 365 days lands on
  // 2028-02-29, a day early, because the span crosses leap day.
  await page.click('text=Alpha Corp');
  await page.click('text=Mark renewed');
  const v = await page.inputValue('input[type="date"]');
  assert(v === "2028-03-01", `the prefilled renewal date should be 2028-03-01, got ${v}`);
  await browser.close();
});
```

If those selectors don't match the rendered UI, find the real ones with `page.locator(...)`
rather than weakening the assertion — the prefilled value is the whole point of the test.

- [ ] **Step 5: Run it and confirm it FAILS**

```bash
node tests/health/run.mjs
```

Expected: **150 passed, 1 failed**, with the failure reading
`the prefilled renewal date should be 2028-03-01, got 2028-02-29`.

That exact message is the defect reproduced. If the test passes instead, the form is
already correct and the premise is wrong — stop and report rather than editing anything.

- [ ] **Step 6: Apply the fix**

In `crm.html:1167`, change:

```js
  const [newDate, setNewDate] = useState(() => iso(new Date(acct.renewalDate).getTime() + 365 * DAY));
```

to:

```js
  // addMonths clamps month-ends and is leap-safe; +365*DAY lands a day early whenever the
  // span crosses a leap day (a 2027-03-01 renewal defaulted to 2028-02-29).
  const [newDate, setNewDate] = useState(() => addMonths(acct.renewalDate, 12));
```

- [ ] **Step 7: Pin the helper's leap-year behavior directly**

The form now delegates to `addMonths`. Add a unit-level assertion so a future change to
that helper can't silently reintroduce the defect. Append:

```js
test("addMonths keeps the calendar day when the year it spans contains a leap day", async () => {
  const { page, browser } = await launch(bookSeed([
    scored({ id: "a1", name: "Alpha Corp", arr: 100000, renewalDate: "2027-03-01" })]));
  await page.waitForFunction(() => window.__health);
  const d = await page.evaluate(() => window.__health.addMonths("2027-03-01", 12));
  assert(d === "2028-03-01", `expected 2028-03-01, got ${d}`);
  await browser.close();
});
```

- [ ] **Step 8: Run**

```bash
node tests/health/run.mjs
```

Expected: **152 passed, 0 failed** — the Step 4 test now passes, and the Step 7 test is new.

- [ ] **Step 9: Commit the fix**

```bash
git add crm.html tests/health/renewal-write.test.mjs
git commit -m "fix: renewal date defaults to one year on, not 365 days

Renewing a 2027-03-01 contract prefilled 2028-02-29 — a day early — because
the 365-day span crosses leap day. Uses addMonths, which already clamps
month-ends and has tests from the QBR fix.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `ADJUST_ARR` and the audit trail

**Files:**
- Create: `tests/health/arr-audit.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: `window.__store`.

- [ ] **Step 1: Write the failing tests**

Create `tests/health/arr-audit.test.mjs`:

```js
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { scored, bookSeed } from "./money-fixture.mjs";

const seed = bookSeed([scored({ id: "a1", name: "Alpha Corp", arr: 100000 })]);

// Mirrors what AdjustArrForm dispatches (crm.html:1215).
const adjust = (page, { newArr, reason = "Discount", source = "adjustment" }) =>
  page.evaluate(([arr, rsn, src]) => {
    const a = window.__store.getState().accounts.find(x => x.id === "a1");
    const delta = arr - a.arr;
    window.__store.dispatch({ type: "ADJUST_ARR", id: "a1", newArr: arr,
      entry: { id: "ev1", date: "2026-08-14", delta, kind: delta > 0 ? "expansion" : "contraction",
        source: src, reason: rsn, note: "", by: "Tester" } });
    const u = window.__store.getState().accounts.find(x => x.id === "a1");
    return { arr: u.arr, arrEvents: u.arrEvents || [], audit: u.audit || [] };
  }, [newArr, reason, source]);

test("ADJUST_ARR books an increase as expansion", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  const u = await adjust(page, { newArr: 130000, reason: "Mid-term upsell" });
  assert(u.arr === 130000, `arr expected 130000, got ${u.arr}`);
  assert(u.arrEvents.length === 1, `expected 1 arrEvent, got ${u.arrEvents.length}`);
  assert(u.arrEvents[0].delta === 30000, `delta expected 30000, got ${u.arrEvents[0].delta}`);
  assert(u.arrEvents[0].kind === "expansion", `kind expected expansion, got ${u.arrEvents[0].kind}`);
  await browser.close();
});

test("ADJUST_ARR books a decrease as contraction with a negative delta", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  const u = await adjust(page, { newArr: 70000, reason: "Seat reduction" });
  assert(u.arrEvents[0].delta === -30000, `delta expected -30000, got ${u.arrEvents[0].delta}`);
  assert(u.arrEvents[0].kind === "contraction", `kind expected contraction, got ${u.arrEvents[0].kind}`);
  assert(u.arrEvents[0].reason === "Seat reduction", `reason should be carried, got ${u.arrEvents[0].reason}`);
  await browser.close();
});

test("ADJUST_ARR writes an audit entry recording the ARR move", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  const u = await adjust(page, { newArr: 130000 });
  const e = u.audit.find(x => x.field === "arr");
  assert(e, `expected an arr audit entry, got ${JSON.stringify(u.audit)}`);
  assert(e.from === 100000 && e.to === 130000, `audit should record 100000 -> 130000, got ${JSON.stringify(e)}`);
  assert(e.source === "adjustment", `source expected adjustment, got ${e.source}`);
  await browser.close();
});

test("an ARR change sourced from an opportunity is audited as such", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  // crm.html:2396 dispatches ADJUST_ARR when an opportunity is won; the audit source
  // must distinguish that from a manual adjustment.
  const u = await adjust(page, { newArr: 150000, source: "opportunity" });
  const e = u.audit.find(x => x.field === "arr");
  assert(e.source === "opportunity", `source expected opportunity, got ${e.source}`);
  await browser.close();
});

test("successive adjustments append rather than replace", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  await adjust(page, { newArr: 130000 });
  const u = await adjust(page, { newArr: 110000 });
  assert(u.arr === 110000, `arr expected 110000, got ${u.arr}`);
  assert(u.arrEvents.length === 2, `expected 2 arrEvents, got ${u.arrEvents.length}`);
  assert(u.arrEvents[1].delta === -20000, `second delta expected -20000, got ${u.arrEvents[1].delta}`);
  assert(u.audit.filter(e => e.field === "arr").length === 2,
    `expected 2 arr audit entries, got ${u.audit.filter(e => e.field === "arr").length}`);
  await browser.close();
});

test("editing ARR through EDIT_ACCOUNT derives an arrEvent with the right kind", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  // auditChanges (crm.html:386) turns a plain ARR edit into an arrEvent so it still
  // reaches NRR/GRR. Without it, edits would silently bypass retention.
  const u = await page.evaluate(() => {
    window.__store.dispatch({ type: "EDIT_ACCOUNT", id: "a1", patch: { arr: 140000 }, by: "Tester", source: "edit" });
    const a = window.__store.getState().accounts.find(x => x.id === "a1");
    return { arrEvents: a.arrEvents || [], audit: a.audit || [] };
  });
  assert(u.arrEvents.length === 1, `expected a derived arrEvent, got ${JSON.stringify(u.arrEvents)}`);
  assert(u.arrEvents[0].delta === 40000, `delta expected 40000, got ${u.arrEvents[0].delta}`);
  assert(u.arrEvents[0].kind === "expansion", `kind expected expansion, got ${u.arrEvents[0].kind}`);
  assert(u.arrEvents[0].source === "edit", `source expected edit, got ${u.arrEvents[0].source}`);
  await browser.close();
});

test("a CSV-sourced ARR edit is tagged import, not edit", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  const u = await page.evaluate(() => {
    window.__store.dispatch({ type: "EDIT_ACCOUNT", id: "a1", patch: { arr: 90000 }, by: "Tester", source: "csv import" });
    return window.__store.getState().accounts.find(x => x.id === "a1").arrEvents || [];
  });
  assert(u[0].source === "import", `source expected import, got ${u[0].source}`);
  assert(u[0].kind === "contraction", `kind expected contraction, got ${u[0].kind}`);
  await browser.close();
});
```

- [ ] **Step 2: Register the file**

Add `import "./arr-audit.test.mjs";` to `tests/health/run.mjs`.

- [ ] **Step 3: Run**

```bash
node tests/health/run.mjs
```

Expected: **159 passed, 0 failed**.

- [ ] **Step 4: Verify the zero-delta guard at the form level**

`AdjustArrForm` returns early when the delta is zero (`crm.html:1213`), so no action is
dispatched at all. Append:

The guard lives in the form, so it must be tested through the form. A test that recomputes
`delta` itself and then declines to dispatch proves nothing — it asserts the test's own
arithmetic and can never fail.

```js
test("submitting the adjust form without changing ARR writes nothing", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  await page.click('text=Alpha Corp');
  await page.click('text=Adjust ARR');
  const before = await page.evaluate(() =>
    JSON.stringify(window.__store.getState().accounts.find(x => x.id === "a1")));
  // Submit with the ARR field untouched. The button reads "No change" at zero delta.
  await page.click('text=No change');
  const after = await page.evaluate(() =>
    JSON.stringify(window.__store.getState().accounts.find(x => x.id === "a1")));
  assert(before === after, "a zero-delta submit must leave the account untouched");
  await browser.close();
});
```

If those selectors don't match the rendered UI, find the real ones with `page.locator(...)`.
Do not fall back to dispatching the action directly — the form's early return at
`crm.html:1213` is the behavior under test, and the reducer has no such guard.

Run again. Expected: **160 passed, 0 failed**.

- [ ] **Step 5: Commit**

```bash
git add tests/health/arr-audit.test.mjs tests/health/run.mjs
git commit -m "test: cover ADJUST_ARR and the ARR audit trail

Expansion and contraction booking, audit sources for adjustments, won
opportunities, plain edits and CSV imports, and the zero-delta no-op.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Verify on both browsers and open the PR

**Files:**
- Create: `pr-body.md` (untracked scratch at the repo root; do not commit it)

- [ ] **Step 1: Run the full suite on the local path**

```bash
node tests/health/run.mjs
```

Expected: **160 passed, 0 failed**, exit 0.

- [ ] **Step 2: Run it the way CI will**

PowerShell:

```powershell
$env:CRM_TEST_CHANNEL = ""; node tests/health/run.mjs; Remove-Item Env:\CRM_TEST_CHANNEL
```

Expected: **160 passed, 0 failed**. A test that passes on msedge and fails on Chromium
must be reported, not adjusted.

- [ ] **Step 3: Confirm every new file is registered**

```bash
node -e "const r=require('fs').readFileSync('tests/health/run.mjs','utf8'); ['retention','cohort','churn-analysis','renewal-outcomes','renewal-write','arr-audit'].forEach(n=>{ if(!r.includes('./'+n+'.test.mjs')) throw new Error('not registered: '+n); }); console.log('all six registered')"
```

Expected: `all six registered`. An unregistered file would leave the count short and
silently cover nothing.

- [ ] **Step 4: Confirm no hardcoded dates leaked into clock-free tests**

```bash
grep -nE '"20[0-9]{2}-(Q[1-4]|[0-9]{2})' tests/health/retention.test.mjs tests/health/cohort.test.mjs
```

Expected: no output. `retention.test.mjs` and `cohort.test.mjs` take no injected clock, so
they must seed only via `rel()`. (`churn-analysis`, `renewal-outcomes` and `renewal-write`
legitimately contain absolute dates — they inject `now` or assert on fixed input strings.)

- [ ] **Step 5: Push**

```bash
git push -u origin test/money-math
```

- [ ] **Step 6: Confirm CI is green**

```bash
gh pr create --title "Test the money math, and fix the renewal date default" --body-file pr-body.md
gh run list --branch test/money-math --limit 1
gh run watch <run-id>
```

The `test` job must conclude `success` and `deploy` must show `skipped` (correct on a PR —
deploys only run on push to master).

- [ ] **Step 7: Write the PR body**

Write `pr-body.md` before creating the PR in Step 6, covering:

- The problem: 115 tests, none asserting a money figure; every board-deck number unverified.
- What is now covered, by surface, with the test count.
- **Behavior changes, each with the old and new number.** At minimum the renewal-date
  default (a 2027-03-01 renewal prefilled `2028-02-29`, now `2028-03-01`). Add an entry for
  every other fix made along the way.
- The two `crm.html` extractions and why (the row math was unreachable from tests).
- Anything found and deliberately *not* fixed — in particular the `retentionStats:1240`
  historical-currency question, which the spec flags for a judgment call.
- The CI run URL.

- [ ] **Step 8: Stop and report**

Report the PR URL, the final test count, and every behavior change. **Do not merge** —
merging deploys the live team app, and that decision is the user's.

---

## Self-Review Notes

**Spec coverage:** Spec §Architecture changes 1-2 (extractions) → Task 1 Steps 1-4; §3
(widened export) → Task 1 Step 5. §Coverage `retentionStats` → Task 2; `cohortData` →
Task 3; `churnRows` → Task 4; `renewalOutcomeRows` → Task 5; `COMPLETE_RENEWAL` → Task 6;
`ADJUST_ARR` + audit → Task 7. §Central risk (clock) → the injected-`now` tests in Tasks 4
and 5, `rel()` seeding everywhere else, and the Task 8 Step 4 grep that enforces it.
§Registering the files → a register step in every task plus the Task 8 Step 3 check.
§Known defects → Task 6 Steps 4-6 (leap day, confirmed); the two suspected defects are
covered by Task 2's `base` pinning and by the Task 8 Step 7 PR-body requirement to report
the currency question rather than fix it blind. §Success criteria 1-6 → Task 8 Steps 1-4, 7.

**Placeholder scan:** none. Every test file is given in full, every expected count is a
number, and every expected value is hand-computed in a comment where it isn't obvious. The
one judgment call left open — historical currency at `retentionStats:1240` — is explicitly
routed to a report rather than left as a vague instruction.

**Type consistency:** `churnRows(accounts, rates, dim, now)` and
`renewalOutcomeRows(accounts, rates, snapshots, now)` are spelled identically in Task 1's
definitions, Task 1's export, and every call in Tasks 4-5. `rel`, `RATES`, `scored`,
`bookSeed` are defined once in Task 2 Step 1 and imported with those exact names in Tasks
3-7. Test counts chain: 115 → 121 → 128 → 135 → 144 → 150 → 152 → 160.

**Out of scope, per the spec:** the opportunity pipeline, documents, integrations, the
snapshot writer, and all of gap 3 (`confirm`/`alert`, error boundary, `aria-live`).
