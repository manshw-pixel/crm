# Account-wise NRR/GRR and Prior-Year-Close Movement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show NRR, GRR and movement against the prior-year close for each account, on the Accounts list and in the account detail view.

**Architecture:** Two pure functions carry all the logic. `arrAsOf` reconstructs an account's ARR at a past date by replaying `arrEvents`, `renewals` and `churn` backwards from today. `accountRetention` wraps it and delegates NRR/GRR to the existing `retentionStats`, called with a single-account array so there is exactly one retention formula in the codebase. Presentation is three sortable columns on the list and a block in the detail view.

**Tech Stack:** Single-file React app (`crm.html`, Babel-in-browser, Tailwind). Tests are Playwright-driven Node scripts in `tests/health/`.

**Spec:** `docs/superpowers/specs/2026-08-19-account-retention-design.md`

## Global Constraints

- **No new dependencies.** The shipped build makes zero third-party network requests. Adding a library gives back a property that took real work to obtain.
- **`supabase-setup.sql` is untouched.** This feature is computation over data already stored.
- **Additive only.** Do not refactor `AccountList` or `AccountDetail` beyond what these changes require.
- **FX: today's rates on both sides.** Baseline and current ARR both convert at current rates via the existing `toUSD`. Never introduce a historical rate table.
- **Redenominations are never revenue movement.** `arrEvents` with `kind === "redenomination"` are skipped, matching `retentionStats` (crm.html:1458).
- **Baseline is the last completed December**, computed from `now` — never a hardcoded 2025.
- **New test files MUST be registered in `tests/health/run.mjs`** — it uses a hardcoded import list, not a glob. An unregistered file never runs and reports no failure.
- **Run the suite as `node tests/health/run.mjs > out.txt 2>&1`** — never piped. Piping replaces the exit code, and that exit code is the CI deploy gate.
- **`arrUSD` is not a stored field.** The scoring pass adds it. Fixtures must set it explicitly or every sum silently becomes `NaN`.
- **`window.__store.getState()` returns the LAST COMMITTED RENDER's state.** After dispatching, `await new Promise(r => setTimeout(r, 50))` inside the same `page.evaluate` before reading. The idiom is in `bulk.test.mjs`.

---

## File Structure

| File | Responsibility |
|---|---|
| `crm.html` (~line 1471, after `retentionStats`) | `lastCompletedDecember`, `arrAsOf`, `accountRetention` — pure functions, added as a block after the existing retention code |
| `crm.html:3789` (`window.__health` export) | Export the three new functions so tests can call them directly |
| `crm.html:2310` (`AccountList`) | Three sortable columns: NRR %, GRR %, movement badge |
| `crm.html:2576` (`AccountDetail`) | Retention block: baseline → today, Δ$, Δ%, ratio |
| `tests/health/account-retention.test.mjs` (new) | Unit tests for the three functions, using `money-fixture.mjs` |
| `tests/health/retention-ui.test.mjs` (new) | Browser tests for the columns, sorting, `new` badge, detail block |
| `tests/health/run.mjs` | Register both new test files |

---

### Task 1: `lastCompletedDecember` and `arrAsOf`

**Files:**
- Modify: `crm.html` — insert after `retentionStats` ends (line ~1471), before the `/* ---- cohort retention ---- */` comment
- Modify: `crm.html:3789` — add `lastCompletedDecember, arrAsOf` to the `window.__health` export
- Test: `tests/health/account-retention.test.mjs` (create)
- Modify: `tests/health/run.mjs` — add `import "./account-retention.test.mjs";`

**Interfaces:**
- Consumes: existing `toUSD(amount, currency, rates)` and `DAY` from `crm.html`
- Produces:
  - `lastCompletedDecember(now) -> string` — ISO date of the last completed 31 December. For any date in 2026 returns `"2025-12-31"`.
  - `arrAsOf(account, isoDate, rates) -> number` — the account's ARR in USD as at `isoDate`.

- [ ] **Step 1: Write the failing tests**

Create `tests/health/account-retention.test.mjs`:

```javascript
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { rel, RATES, scored, bookSeed } from "./money-fixture.mjs";

// A fixed "now" is not available to these functions, so tests pass `now` explicitly
// where the signature allows and use `rel()` offsets otherwise.
const DEC = "2025-12-31";

const call = async (fn, args) => {
  const { page, browser } = await launch(bookSeed([scored({ id: "seed", name: "Seed Co", arr: 1000 })]));
  await page.waitForFunction(() => window.__health);
  const out = await page.evaluate(([f, a]) => window.__health[f](...a), [fn, args]);
  await browser.close();
  return out;
};

test("lastCompletedDecember returns the prior 31 December for a mid-year date", async () => {
  const d = await call("lastCompletedDecember", ["2026-08-19"]);
  assert(d === "2025-12-31", `expected 2025-12-31, got ${d}`);
});

test("lastCompletedDecember in January still points at the December just gone", async () => {
  const d = await call("lastCompletedDecember", ["2027-01-05"]);
  assert(d === "2026-12-31", `expected 2026-12-31, got ${d}`);
});

test("lastCompletedDecember on 31 December treats that December as complete", async () => {
  const d = await call("lastCompletedDecember", ["2026-12-31"]);
  assert(d === "2026-12-31", `expected 2026-12-31, got ${d}`);
});

test("arrAsOf on an account with no history returns today's ARR", async () => {
  const a = scored({ id: "flat", name: "Flat Co", arr: 100000 });
  const v = await call("arrAsOf", [a, DEC, RATES]);
  assert(v === 100000, `expected 100000, got ${v}`);
});

test("arrAsOf undoes an ARR event dated after the baseline", async () => {
  // today 120000, +20000 event in 2026 => baseline was 100000
  const a = scored({ id: "grew", name: "Grew Co", arr: 120000,
    arrEvents: [{ id: "e1", date: "2026-03-01", delta: 20000, kind: "expansion", source: "adjustment" }] });
  const v = await call("arrAsOf", [a, DEC, RATES]);
  assert(v === 100000, `expected 100000, got ${v}`);
});

test("arrAsOf ignores an ARR event dated before the baseline", async () => {
  const a = scored({ id: "old", name: "Old Co", arr: 120000,
    arrEvents: [{ id: "e1", date: "2025-06-01", delta: 20000, kind: "expansion", source: "adjustment" }] });
  const v = await call("arrAsOf", [a, DEC, RATES]);
  assert(v === 120000, `expected 120000 (event predates baseline), got ${v}`);
});

test("arrAsOf undoes a renewal completed after the baseline", async () => {
  const a = scored({ id: "ren", name: "Renewed Co", arr: 150000,
    renewals: [{ id: "r1", completedOn: "2026-02-01", prevArr: 100000, arr: 150000, by: "Priya" }] });
  const v = await call("arrAsOf", [a, DEC, RATES]);
  assert(v === 100000, `expected 100000, got ${v}`);
});

test("arrAsOf SKIPS a redenomination — a currency restatement is not revenue movement", async () => {
  const a = scored({ id: "redenom", name: "Redenom Co", arr: 108000,
    arrEvents: [{ id: "e1", date: "2026-04-01", delta: 8000, kind: "redenomination", source: "adjustment" }] });
  const v = await call("arrAsOf", [a, DEC, RATES]);
  assert(v === 108000, `a redenomination must not read as growth: got ${v}`);
});

test("arrAsOf on an account churned after the baseline returns its pre-churn ARR", async () => {
  const a = scored({ id: "lost", name: "Lost Co", arr: 50000, arrUSD: 0,
    churn: { date: "2026-05-01", arr: 50000, reason: "Price" } });
  const v = await call("arrAsOf", [a, DEC, RATES]);
  assert(v === 50000, `expected the pre-churn 50000, got ${v}`);
});
```

- [ ] **Step 2: Register the test file and run it to verify it fails**

Add to `tests/health/run.mjs` (alongside the other imports):

```javascript
import "./account-retention.test.mjs";
```

Run: `node tests/health/run.mjs > out.txt 2>&1` then read `out.txt`.
Expected: the new tests FAIL — `window.__health.lastCompletedDecember is not a function`.

- [ ] **Step 3: Implement both functions**

Insert into `crm.html` immediately after `retentionStats` closes (line ~1471):

```javascript
/* ------------------------- point-in-time ARR ------------------------- */
// The last 31 December that has actually finished. December itself counts as complete
// on the 31st. Rolling by design: this reads Dec'25 through 2026 and Dec'26 from 2027,
// so the comparison never silently decays into an irrelevant baseline.
function lastCompletedDecember(now = iso(Date.now())) {
  const [y, m, d] = String(now).slice(0, 10).split("-").map(Number);
  const year = (m === 12 && d === 31) ? y : y - 1;
  return `${year}-12-31`;
}

// An account's ARR (USD) as at `isoDate`, reconstructed by undoing every movement dated
// after it. There is no stored per-account history -- snapshots are aggregate-only -- so
// this replays the ledger rather than reading a value.
//
// Both sides convert at TODAY's rates, deliberately: the delta should show revenue
// movement, not FX drift. An EUR account whose local ARR never moved must read as flat.
function arrAsOf(account, isoDate, rates) {
  const cut = String(isoDate).slice(0, 10);
  const after = when => String(when || "").slice(0, 10) > cut;
  // Churned after the baseline: the account still held its pre-churn ARR back then.
  let arr = account.churn && after(account.churn.date)
    ? toUSD(account.churn.arr, account.churn.currency || account.currency, rates)
    : toUSD(account.arr, account.currency, rates);

  (account.renewals || []).forEach(r => {
    if (!after(r.completedOn)) return;
    arr -= toUSD(r.arr - r.prevArr, r.currency || account.currency, rates);
  });
  (account.arrEvents || []).forEach(ev => {
    // A currency restatement is not revenue movement. Skipped explicitly rather than
    // relying on its delta being 0, matching retentionStats.
    if (ev.kind === "redenomination") return;
    if (!after(ev.date)) return;
    arr -= toUSD(ev.delta, ev.currency || account.currency, rates);
  });
  return Math.round(arr);
}
```

Add to the `window.__health` export at `crm.html:3789`:

```javascript
  retentionStats, cohortData, churnRows, renewalOutcomeRows, quarterKey, monthsBetween, toUSD, diffRow, writeQueue, reportError, fingerprintOf,
  lastCompletedDecember, arrAsOf };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/health/run.mjs > out.txt 2>&1`
Expected: all 9 new tests PASS, and the pre-existing tests still pass. Read the final `N passed, 0 failed` line and confirm the total went UP by 9 from the previous baseline.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/account-retention.test.mjs tests/health/run.mjs
git commit -m "feat: reconstruct point-in-time ARR with arrAsOf"
```

---

### Task 2: `accountRetention`

**Files:**
- Modify: `crm.html` — immediately after `arrAsOf`
- Modify: `crm.html:3789` — add `accountRetention` to the export
- Test: `tests/health/account-retention.test.mjs` (append)

**Interfaces:**
- Consumes: `arrAsOf`, `lastCompletedDecember` from Task 1; existing `retentionStats(accounts, rates)`
- Produces: `accountRetention(account, rates, now) -> { nrr, grr, baselineARR, currentARR, delta, pct, isNew, baselineKey }`
  - `nrr`, `grr`: numbers (ratios, e.g. `1.18`) or `null`
  - `baselineARR`, `currentARR`, `delta`: USD numbers
  - `pct`: number (e.g. `16.7`) or `null`
  - `isNew`: boolean — true when `startDate` is after the baseline
  - `baselineKey`: string, e.g. `"Dec'25"` — for the column header

- [ ] **Step 1: Write the failing tests**

Append to `tests/health/account-retention.test.mjs`:

```javascript
const NOW = "2026-08-19";

test("accountRetention reports growth against the prior-year close", async () => {
  const a = scored({ id: "grew", name: "Grew Co", arr: 120000,
    startDate: "2024-01-01",
    arrEvents: [{ id: "e1", date: "2026-03-01", delta: 20000, kind: "expansion", source: "adjustment" }] });
  const r = await call("accountRetention", [a, RATES, NOW]);
  assert(r.isNew === false, "an account started in 2024 is not new");
  assert(r.baselineARR === 100000, `baseline should be 100000, got ${r.baselineARR}`);
  assert(r.currentARR === 120000, `current should be 120000, got ${r.currentARR}`);
  assert(r.delta === 20000, `delta should be 20000, got ${r.delta}`);
  assert(Math.abs(r.pct - 20) < 0.05, `pct should be 20, got ${r.pct}`);
  assert(r.baselineKey === "Dec'25", `baselineKey should be Dec'25, got ${r.baselineKey}`);
});

test("accountRetention reports contraction with GRR below 100%", async () => {
  const a = scored({ id: "shrank", name: "Shrank Co", arr: 80000,
    startDate: "2024-01-01",
    arrEvents: [{ id: "e1", date: rel(-100), delta: -20000, kind: "contraction", source: "adjustment" }] });
  const r = await call("accountRetention", [a, RATES, NOW]);
  assert(r.delta < 0, `delta should be negative, got ${r.delta}`);
  assert(r.grr !== null && r.grr < 1, `GRR should be below 1, got ${r.grr}`);
});

test("accountRetention marks an account started after the baseline as new, with null metrics", async () => {
  const a = scored({ id: "fresh", name: "Fresh Co", arr: 60000, startDate: "2026-03-01" });
  const r = await call("accountRetention", [a, RATES, NOW]);
  assert(r.isNew === true, "an account started in 2026 is new relative to Dec'25");
  assert(r.nrr === null && r.grr === null, `metrics must be null for a new account, got ${r.nrr}/${r.grr}`);
  assert(r.delta === null && r.pct === null, `delta/pct must be null for a new account`);
});

test("accountRetention gives a churned account 0% GRR", async () => {
  const a = scored({ id: "lost", name: "Lost Co", arr: 50000, arrUSD: 0,
    startDate: "2023-01-01",
    churn: { date: rel(-60), arr: 50000, reason: "Price" } });
  const r = await call("accountRetention", [a, RATES, NOW]);
  assert(r.grr === 0, `a churned account's GRR should be 0, got ${r.grr}`);
});

test("accountRetention shows no movement for a non-USD account whose local ARR never changed", async () => {
  const a = scored({ id: "eur", name: "Euro Co", arr: 100000, currency: "EUR", startDate: "2024-01-01" });
  const r = await call("accountRetention", [a, RATES, NOW]);
  assert(r.delta === 0, `FX drift must not create movement: delta was ${r.delta}`);
});

test("accountRetention agrees with retentionStats for a single account", async () => {
  // The tie-out that matters: there must be exactly one retention formula.
  const a = scored({ id: "tie", name: "Tie Co", arr: 120000, startDate: "2024-01-01",
    renewals: [{ id: "r1", completedOn: rel(-180), prevArr: 100000, arr: 120000, by: "Priya" }] });
  const { page, browser } = await launch(bookSeed([a]));
  await page.waitForFunction(() => window.__health);
  const [mine, theirs] = await page.evaluate(([acct, rates, now]) => [
    window.__health.accountRetention(acct, rates, now),
    window.__health.retentionStats([acct], rates),
  ], [a, RATES, NOW]);
  await browser.close();
  assert(mine.nrr === theirs.nrr, `NRR disagrees: ${mine.nrr} vs ${theirs.nrr}`);
  assert(mine.grr === theirs.grr, `GRR disagrees: ${mine.grr} vs ${theirs.grr}`);
});

test("accountRetention does not throw on an account with no fields set", async () => {
  const r = await call("accountRetention", [{ id: "bare", arr: 0, arrUSD: 0, currency: "USD" }, RATES, NOW]);
  assert(r && typeof r === "object", "should return an object rather than throwing");
  assert(!Number.isNaN(r.baselineARR), `baselineARR must not be NaN, got ${r.baselineARR}`);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node tests/health/run.mjs > out.txt 2>&1`
Expected: the 7 new tests FAIL with `window.__health.accountRetention is not a function`.

- [ ] **Step 3: Implement**

Insert into `crm.html` immediately after `arrAsOf`:

```javascript
// Per-account retention. NRR and GRR are delegated to retentionStats with a
// single-account array, so there is exactly ONE retention formula in this codebase and
// the account column agrees with the Analytics headline by construction.
//
// An account that started after the baseline has no prior close, so a percentage would be
// meaningless: it is flagged `isNew` and left out of the maths. New logos belong to new
// business, not to retention.
function accountRetention(account, rates, now = iso(Date.now())) {
  const baselineDate = lastCompletedDecember(now);
  const baselineKey = `Dec'${baselineDate.slice(2, 4)}`;
  const isNew = String(account.startDate || "").slice(0, 10) > baselineDate;
  const currentARR = Math.round(toUSD(account.churn ? 0 : account.arr, account.currency, rates));
  if (isNew) {
    return { nrr: null, grr: null, baselineARR: null, currentARR, delta: null, pct: null, isNew: true, baselineKey };
  }
  const baselineARR = arrAsOf(account, baselineDate, rates);
  const { nrr, grr } = retentionStats([account], rates);
  const delta = currentARR - baselineARR;
  return { nrr, grr, baselineARR, currentARR, delta,
    pct: baselineARR > 0 ? (delta / baselineARR) * 100 : null,
    isNew: false, baselineKey };
}
```

Add `accountRetention` to the `window.__health` export.

- [ ] **Step 4: Run to verify they pass**

Run: `node tests/health/run.mjs > out.txt 2>&1`
Expected: all 16 tests in the file PASS; total up by 7 from Task 1's baseline; `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/account-retention.test.mjs
git commit -m "feat: add per-account NRR, GRR and prior-close movement"
```

---

### Task 3: Accounts list columns

**Files:**
- Modify: `crm.html:2310` (`AccountList`) — the `rows` memo (~line 2348) and the table header/body
- Test: `tests/health/retention-ui.test.mjs` (create)
- Modify: `tests/health/run.mjs` — register the new file

**Interfaces:**
- Consumes: `accountRetention` from Task 2
- Produces: each row object gains a `_ret` property holding the `accountRetention` result. Column `data-` hooks for tests: `data-nrr`, `data-grr`, `data-movement`.

- [ ] **Step 1: Write the failing tests**

Create `tests/health/retention-ui.test.mjs`:

```javascript
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { rel, RATES, scored, bookSeed } from "./money-fixture.mjs";

const BOOK = [
  scored({ id: "grew", name: "Grew Co", arr: 120000, startDate: "2024-01-01",
    arrEvents: [{ id: "e1", date: rel(-100), delta: 20000, kind: "expansion", source: "adjustment" }] }),
  scored({ id: "shrank", name: "Shrank Co", arr: 80000, startDate: "2024-01-01",
    arrEvents: [{ id: "e2", date: rel(-100), delta: -20000, kind: "contraction", source: "adjustment" }] }),
  scored({ id: "fresh", name: "Fresh Co", arr: 60000, startDate: rel(-30) }),
];

test("the accounts list shows NRR, GRR and a movement badge per account", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForSelector("[data-account-row]");
  const cells = await page.$$eval("[data-account-row]", rows => rows.map(r => ({
    name: r.querySelector("td:nth-child(3)").innerText.trim(),
    nrr: r.querySelector("[data-nrr]")?.innerText.trim(),
    grr: r.querySelector("[data-grr]")?.innerText.trim(),
    mv: r.querySelector("[data-movement]")?.innerText.trim(),
  })));
  const grew = cells.find(c => c.name.includes("Grew"));
  assert(grew && /%/.test(grew.nrr), `expected an NRR percentage, got ${JSON.stringify(grew)}`);
  assert(grew.mv.includes("▲"), `expected an up badge for a grown account, got ${grew.mv}`);
  const shrank = cells.find(c => c.name.includes("Shrank"));
  assert(shrank.mv.includes("▼"), `expected a down badge for a shrunk account, got ${shrank.mv}`);
  await browser.close();
});

test("an account started after the baseline shows a new badge, not a percentage", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForSelector("[data-account-row]");
  const mv = await page.$$eval("[data-account-row]", rows => {
    const row = rows.find(r => r.innerText.includes("Fresh Co"));
    return row.querySelector("[data-movement]").innerText.trim();
  });
  assert(/new/i.test(mv), `expected a "new" marker, got ${mv}`);
  await browser.close();
});

test("the NRR column sorts the book", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForSelector("[data-account-row]");
  await page.click("th[data-sort-key='nrr']");
  await new Promise(r => setTimeout(r, 100));
  const names = await page.$$eval("[data-account-row] td:nth-child(3)", tds => tds.map(t => t.innerText.trim()));
  assert(names.length === 3, `expected 3 rows, got ${names.length}`);
  const shrankFirst = names[0].includes("Shrank") || names[names.length - 1].includes("Shrank");
  assert(shrankFirst, `sorting by NRR should move the contracted account to an end: ${names.join(" | ")}`);
  await browser.close();
});

test("the movement column header names the baseline", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForSelector("[data-account-row]");
  const header = await page.$eval("th[data-sort-key='movement']", th => th.innerText.trim());
  assert(/Dec'\d\d/.test(header), `header should name the baseline, got "${header}"`);
  await browser.close();
});
```

- [ ] **Step 2: Register and run to verify failure**

Add `import "./retention-ui.test.mjs";` to `tests/health/run.mjs`.

Run: `node tests/health/run.mjs > out.txt 2>&1`
Expected: the 4 new tests FAIL — the selectors `[data-nrr]`, `[data-grr]`, `[data-movement]` do not exist.

- [ ] **Step 3: Implement the columns**

In `AccountList`, inside the `rows` memo (~line 2348), attach the metrics **immediately
after filtering and BEFORE sorting**. Order matters: the sort comparator runs O(n log n)
times, so calling `accountRetention` inside it would recompute the whole replay thousands
of times on a 2,000-account book and undo the windowing work. Compute once per row, then
sort on the stored value.

Replace the filter line's `let r = scored.filter(...)` result handling so the mapping
happens right after it:

```javascript
    // Computed once per row, BEFORE the sort. The comparator below runs O(n log n) times;
    // calling accountRetention there would replay every account's ledger thousands of
    // times on a large book. Also keeps it out of render, which matters because the list
    // is windowed and render re-runs on every scroll.
    r = r.map(a => ({ ...a, _ret: accountRetention(a, settings.rates || {}) }));
```

Extend the sort accessor to read the stored value (the existing `get` in the same memo):

```javascript
    const get = a => sort.k === "renewalDate" ? daysUntil(a.renewalDate)
      : sort.k === "arr" ? a.arrUSD
      : sort.k === "nrr" ? (a._ret.nrr ?? -1)
      : sort.k === "grr" ? (a._ret.grr ?? -1)
      : sort.k === "movement" ? (a._ret.pct ?? -Infinity)
      : a[sort.k];
```

**The parent/sub flattening below spreads rows** (`out.push({ ...s, _sub: true })`), which
preserves `_ret` because it is a plain property — verify this holds when you read the code
rather than assuming it.

Add `data-sort-key` to the existing `Th` component so tests can target headers:

```javascript
  const Th = ({ k, children, className = "" }) => (
    <th data-sort-key={k} aria-sort={...} ... >
```

Add the three header cells after the Health column:

```jsx
            <Th k="nrr">NRR</Th><Th k="grr">GRR</Th><Th k="movement">vs {rows[0]?._ret?.baselineKey || "Dec"}</Th>
```

Add the three body cells in the same position:

```jsx
                  <td className="px-2 text-xs" data-nrr>{a._ret.nrr === null ? "—" : `${Math.round(a._ret.nrr * 100)}%`}</td>
                  <td className="px-2 text-xs" data-grr>{a._ret.grr === null ? "—" : `${Math.round(a._ret.grr * 100)}%`}</td>
                  <td className="px-2 text-xs" data-movement>
                    {a._ret.isNew
                      ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">new</span>
                      : a._ret.delta === 0
                        ? <span className="text-slate-400">─ flat</span>
                        : <span className={a._ret.delta > 0 ? "text-emerald-600" : "text-rose-600"}>
                            {a._ret.delta > 0 ? "▲" : "▼"} {a._ret.pct === null ? "—" : `${a._ret.pct > 0 ? "+" : ""}${a._ret.pct.toFixed(1)}%`}
                          </span>}
                  </td>
```

**`colCount` must go up by 3** — it is used by the empty-state row and by the windowing
spacer rows. Find `const colCount = qbrDue ? 12 : 11;` and change it to `qbrDue ? 15 : 14`.
Missing this leaves the spacer rows spanning too few columns and the table misaligns when
windowed.

- [ ] **Step 4: Run to verify they pass**

Run: `node tests/health/run.mjs > out.txt 2>&1`
Expected: the 4 new tests PASS. **The virtualization tests must also still pass** — if any
of them fail, `colCount` is wrong.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/retention-ui.test.mjs tests/health/run.mjs
git commit -m "feat: show NRR, GRR and prior-close movement on the accounts list"
```

---

### Task 4: Account detail retention block

**Files:**
- Modify: `crm.html:2576` (`AccountDetail`)
- Test: `tests/health/retention-ui.test.mjs` (append)

**Interfaces:**
- Consumes: `accountRetention` from Task 2
- Produces: a block with `data-retention-block`, containing `data-baseline-arr`, `data-current-arr`, `data-change`, `data-ratio`

- [ ] **Step 1: Write the failing test**

Append to `tests/health/retention-ui.test.mjs`:

```javascript
test("the account detail view shows the full retention arithmetic", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForSelector("[data-account-row]");
  await page.click("[data-account-row]:has-text('Grew Co')");
  await page.waitForSelector("[data-retention-block]");
  const b = await page.$eval("[data-retention-block]", el => ({
    baseline: el.querySelector("[data-baseline-arr]").innerText,
    current: el.querySelector("[data-current-arr]").innerText,
    change: el.querySelector("[data-change]").innerText,
    ratio: el.querySelector("[data-ratio]").innerText,
  }));
  assert(/100,000|100k/i.test(b.baseline), `baseline should show 100000, got ${b.baseline}`);
  assert(/120,000|120k/i.test(b.current), `current should show 120000, got ${b.current}`);
  assert(/\+/.test(b.change) && /20/.test(b.change), `change should show +20000, got ${b.change}`);
  assert(/%/.test(b.ratio), `ratio should be a percentage, got ${b.ratio}`);
  await browser.close();
});

test("a new account's detail view explains why there is no comparison", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForSelector("[data-account-row]");
  await page.click("[data-account-row]:has-text('Fresh Co')");
  await page.waitForSelector("[data-retention-block]");
  const txt = await page.$eval("[data-retention-block]", el => el.innerText);
  assert(/new|started after/i.test(txt), `expected an explanation for a new account, got: ${txt}`);
  await browser.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node tests/health/run.mjs > out.txt 2>&1`
Expected: FAIL — `[data-retention-block]` never appears.

- [ ] **Step 3: Implement**

In `AccountDetail`, add near the existing ARR display:

```jsx
      {(() => {
        const r = accountRetention(account, st.settings.rates || {});
        return (
          <div data-retention-block className="nm-inset mt-3 p-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">
              Retention since {r.baselineKey}
            </div>
            {r.isNew ? (
              <p className="text-sm text-slate-500">
                This account started after the {r.baselineKey} close, so there is no prior-year
                figure to compare against. New accounts are excluded from NRR and GRR.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-y-1 text-sm">
                <span className="text-slate-500">{r.baselineKey} close</span>
                <span data-baseline-arr className="text-right font-medium">{fmtMoney(r.baselineARR)}</span>
                <span className="text-slate-500">Today</span>
                <span data-current-arr className="text-right font-medium">{fmtMoney(r.currentARR)}</span>
                <span className="text-slate-500">Change</span>
                <span data-change className={`text-right font-medium ${r.delta > 0 ? "text-emerald-600" : r.delta < 0 ? "text-rose-600" : ""}`}>
                  {r.delta > 0 ? "+" : ""}{fmtMoney(r.delta)}{r.pct !== null && ` (${r.pct > 0 ? "+" : ""}${r.pct.toFixed(1)}%)`}
                </span>
                <span className="text-slate-500">Retention since {r.baselineKey}</span>
                <span data-ratio className="text-right font-medium">
                  {r.baselineARR > 0 ? `${((r.currentARR / r.baselineARR) * 100).toFixed(1)}%` : "—"}
                </span>
              </div>
            )}
          </div>
        );
      })()}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node tests/health/run.mjs > out.txt 2>&1`
Expected: both new tests PASS, `0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/retention-ui.test.mjs
git commit -m "feat: show the full retention arithmetic on the account page"
```

---

### Task 5: Full-suite verification and falsification

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Run the whole suite unpiped**

Run: `node tests/health/run.mjs > out.txt 2>&1; echo "EXIT=$?"`
Expected: `0 failed` and `EXIT=0`. Record the total count.

- [ ] **Step 2: Falsify the tie-out test**

Temporarily change `accountRetention` to compute NRR itself rather than delegating —
e.g. return `nrr: 1` unconditionally. Re-run the suite.
Expected: *accountRetention agrees with retentionStats for a single account* FAILS.
Then revert and confirm the suite is green again.

- [ ] **Step 3: Falsify the redenomination guard**

Temporarily remove the `if (ev.kind === "redenomination") return;` line in `arrAsOf`.
Re-run the suite.
Expected: *arrAsOf SKIPS a redenomination* FAILS with a value of 100000 instead of 108000.
Then revert and confirm green.

- [ ] **Step 4: Confirm no SQL change**

Run: `git diff master --stat -- supabase-setup.sql`
Expected: empty output. This feature must not touch the database schema.

- [ ] **Step 5: Commit any fixes and report**

Report: the final suite line, both falsification results, and anything that could not be
done. If a falsification does NOT produce the expected failure, the test is decorative —
say so rather than moving on.
