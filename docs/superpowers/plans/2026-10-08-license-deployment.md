# License Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accounts record Total and Deployed licenses, and a dashboard card (the last one) shows total vs deployed with the 5 lowest-deployment accounts.

**Architecture:**
- `licenses` keeps its stored name and is relabelled Total. A new optional `deployedLicenses` lives in the account JSON, so no SQL change is needed.
- All math lives in one pure helper, `src/lib/licenses.js`, used by the account detail line and the dashboard card.
- The form, detail page, CSV and dashboard are thin consumers of that helper.

**Tech Stack:**
- React-in-JSX modules in `src/NN-*.jsx`, joined by `build.mjs`.
- Pure ES modules in `src/lib`, exported to globals, tested with `node:test`.
- Playwright health suite in `tests/health`. `npm run build` must run before it.

**Spec:** `docs/superpowers/specs/2026-10-08-license-deployment-design.md`

## Global Constraints

- Work in the worktree `D:/AI Project/crm-licenses`, branch `license-deployment`. Never touch `D:/AI Project/My Company`.
- Stored field names: `licenses` (Total) and `deployedLicenses` (Deployed). Do not rename `licenses`.
- Missing, empty or null `deployedLicenses` means "not recorded", and is distinct from `0`.
- An account counts on the card only when `licenses > 0`.
- The card input is the dashboard's `scored` (in-scope, non-churned).
- Card UI copy, verbatim:
  - `N accounts have no deployed count yet.` (singular when N is 1: `1 account has no deployed count yet.`)
  - `No accounts have licenses yet. Add Total licenses on an account's Edit form.`
  - `No deployed counts recorded yet.`
  - `Lowest deployment`
- Form warning, verbatim: `Deployed is higher than total.` The save is still allowed.
- Detail line, verbatim format: `150 deployed of 200 (75%)`. When deployed isn't recorded, show the total alone.
- Percent: `Math.round(deployed / total * 100)`. It may exceed 100. Bars are capped at 100% width.
- Amber below 50%.
- Wait on conditions in tests, never fixed timeouts (known store-read timing flakes).
- **Golden files:** never run `tests/unit/golden/make-golden.mjs`. It rewrites the whole file from the built dist. Update only the changed `accountsCSVText` golden case by hand.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An existing account opened in the edit form with no `deployedLicenses`, then saved.** It must stay "not recorded", not become 0. Pinned in Task 2.
2. **A CSV row with an empty deployedLicenses cell on an account that has a value.** The value must be left unchanged, not cleared and not zeroed (the CSV data-loss class fixed in the QA audit). Pinned in Task 3.
3. **Over-deployment, deployed > total.** The pct exceeds 100, the bar is capped, and the save is allowed. Pinned in Tasks 1, 2 and 4.
4. **Accounts with totals but no deployed figures.** They must not drag the % down. Pinned in Task 1.
5. **`licenses` stored as a numeric string (older imports).** The helper must coerce it with `Number()`. Pinned in Task 1.

---

### Task 1: Pure license helper

**Files:**
- Create: `src/lib/licenses.js`
- Modify: `src/lib/index.js` (add `export * from "./licenses.js";`)
- Create: `tests/unit/licenses.test.mjs`

**Interfaces (produces, as app globals):**
- `licenseFigures(account) -> { total: number, deployed: number|null, pct: number|null }`. `total` is 0 when not set. `deployed` is null when not recorded. `pct` is null unless total > 0 and deployed is recorded.
- `licenseSummary(accounts) -> { total, deployed, pct, counted, missingDeployed, lowest }`, as defined in the spec. `lowest` items are `{ id, name, total, deployed, pct }`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/licenses.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { licenseFigures, licenseSummary } from "../../src/lib/licenses.js";

const A = (id, licenses, deployedLicenses, name = id) => ({ id, name, licenses, ...(deployedLicenses === undefined ? {} : { deployedLicenses }) });

test("licenseFigures: not set, not recorded, recorded, zero, numeric strings", () => {
  assert.deepEqual(licenseFigures({}), { total: 0, deployed: null, pct: null });
  assert.deepEqual(licenseFigures(A("a", 200)), { total: 200, deployed: null, pct: null });
  assert.deepEqual(licenseFigures(A("a", 200, 150)), { total: 200, deployed: 150, pct: 75 });
  assert.deepEqual(licenseFigures(A("a", 200, 0)), { total: 200, deployed: 0, pct: 0 });
  assert.deepEqual(licenseFigures(A("a", "200", "150")), { total: 200, deployed: 150, pct: 75 });
  assert.deepEqual(licenseFigures(A("a", 200, null)), { total: 200, deployed: null, pct: null });
  assert.deepEqual(licenseFigures(A("a", 200, "")), { total: 200, deployed: null, pct: null });
  assert.deepEqual(licenseFigures(A("a", 0, 5)), { total: 0, deployed: 5, pct: null });
});

test("licenseFigures: over-deployment exceeds 100 and rounding", () => {
  assert.equal(licenseFigures(A("a", 100, 130)).pct, 130);
  assert.equal(licenseFigures(A("a", 3, 1)).pct, 33);
  assert.equal(licenseFigures(A("a", 3, 2)).pct, 67);
});

test("licenseSummary: only accounts with both figures feed the totals and %", () => {
  const s = licenseSummary([A("a", 200, 150), A("b", 100, 50), A("c", 400), A("d", 0, 10), A("e", undefined)]);
  assert.equal(s.total, 300);
  assert.equal(s.deployed, 200);
  assert.equal(s.pct, 67);
  assert.equal(s.counted, 3);          // a, b, c have licenses > 0
  assert.equal(s.missingDeployed, 1);  // c
});

test("licenseSummary: lowest is ascending by ratio, ties by name, capped at 5", () => {
  const s = licenseSummary([A("1", 100, 90, "Zeta"), A("2", 100, 10, "Beta"), A("3", 100, 10, "Alpha"),
    A("4", 100, 50, "C"), A("5", 100, 60, "D"), A("6", 100, 70, "E"), A("7", 100, 80, "F")]);
  assert.deepEqual(s.lowest.map(x => x.name), ["Alpha", "Beta", "C", "D", "E"]);
  assert.deepEqual(s.lowest[0], { id: "3", name: "Alpha", total: 100, deployed: 10, pct: 10 });
});

test("licenseSummary: empty and no-deployed cases", () => {
  assert.deepEqual(licenseSummary([]), { total: 0, deployed: 0, pct: null, counted: 0, missingDeployed: 0, lowest: [] });
  const s = licenseSummary([A("a", 200), A("b", 100)]);
  assert.equal(s.counted, 2); assert.equal(s.missingDeployed, 2); assert.equal(s.pct, null); assert.deepEqual(s.lowest, []);
});
```

- [ ] **Step 2: Run and confirm failure.** `node --test tests/unit/licenses.test.mjs`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/lib/licenses.js`:

```js
// Total vs deployed licenses (spec 2026-10-08). `licenses` is Total; `deployedLicenses` is
// optional, and missing/blank means "not recorded" -- which is not the same as 0 deployed.
const toNum = v => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function licenseFigures(a) {
  const total = Math.max(0, toNum(a?.licenses) ?? 0);
  const d = toNum(a?.deployedLicenses);
  const deployed = d == null ? null : Math.max(0, d);
  const pct = total > 0 && deployed != null ? Math.round((deployed / total) * 100) : null;
  return { total, deployed, pct };
}

// Totals and % use only accounts with BOTH figures, so missing data never reads as low deployment.
export function licenseSummary(accounts) {
  let total = 0, deployed = 0, counted = 0, missingDeployed = 0;
  const withBoth = [];
  for (const a of accounts || []) {
    const f = licenseFigures(a);
    if (f.total <= 0) continue;
    counted++;
    if (f.deployed == null) { missingDeployed++; continue; }
    total += f.total; deployed += f.deployed;
    withBoth.push({ id: a.id, name: a.name, total: f.total, deployed: f.deployed, pct: f.pct, ratio: f.deployed / f.total });
  }
  const lowest = withBoth
    .sort((x, y) => x.ratio - y.ratio || String(x.name).localeCompare(String(y.name)))
    .slice(0, 5)
    .map(({ ratio, ...rest }) => rest);
  return { total, deployed, pct: total > 0 ? Math.round((deployed / total) * 100) : null, counted, missingDeployed, lowest };
}
```

Add `export * from "./licenses.js";` to `src/lib/index.js`. First grep `src/` to check that `licenseFigures` and `licenseSummary` don't collide with existing globals.

- [ ] **Step 4: Run and confirm pass.** `node --test tests/unit/licenses.test.mjs && npm run test:unit && npm run build`. Expected: all pass, and the build's purity guard is OK.

- [ ] **Step 5: Commit.** "Add pure license deployment helpers".

---

### Task 2: Account form and detail

**Files:**
- Modify: `src/13-forms.jsx` (the initial `v` state ~lines 248-249, `clean` ~line 255, the Licenses field ~line 280)
- Modify: `src/21-account-detail.jsx:74`
- Create: `tests/health/licenses.test.mjs`, and add `import "./licenses.test.mjs";` to `tests/health/run.mjs` (explicit imports)

**Interfaces:**
- Consumes: `licenseFigures` (Task 1).

- [ ] **Step 1: Write failing health tests** in `tests/health/licenses.test.mjs`. Read `tests/health/account-limit.test.mjs` and `tests/health/harness.mjs` first, and reuse their seeding, navigation (`button[title="Accounts"]`), form-open selectors, and the `merge_row` write inspection via `window.__rpcCalls`. Wait for app readiness with the same condition waits those tests use. Write these tests, with real assertions and no stubs:
  1. **Edit form saves both fields.** Seed an account with `licenses: 200` and no `deployedLicenses`. Open Edit and check the fields labelled "Total licenses" (value 200) and "Deployed licenses" (empty) exist. Set Deployed to 150 and save. Assert the account's merge_row patch has `deployedLicenses: 150` and `licenses: 200`.
  2. **Empty Deployed stays not recorded (Review Focus 1).** Seed `licenses: 200`, no deployed. Open Edit, change only the name, and save. Assert no merge_row patch for that account sets `deployedLicenses` to `0`. It's absent or null.
  3. **Over-deployed warning and save allowed.** Total 100, Deployed 130. The text `Deployed is higher than total.` is visible, and saving still writes `deployedLicenses: 130`.
  4. **Detail line, three cases.** Seed three accounts: `{licenses: 200, deployedLicenses: 150}`, `{licenses: 200}`, and `{}`. Open each detail page. The header shows `150 deployed of 200 (75%)`, then `200`, then no Licenses meta at all.

- [ ] **Step 2: Build and run, confirm failure.** `npm run build && node tests/health/run-one.mjs licenses.test.mjs`. Expected: FAIL (no "Deployed licenses" field).

- [ ] **Step 3: Implement the form.**
  - In both initial-state objects add `deployedLicenses`. For an existing account, use `existing.deployedLicenses ?? ""`. For a new one, use `""`.
  - In `clean`, after `licenses: +v.licenses || 0,` add:
    `deployedLicenses: v.deployedLicenses === "" || v.deployedLicenses == null ? null : Math.max(0, Math.round(+v.deployedLicenses) || 0),`
  - Replace the Licenses field with:

```jsx
      <F label="Total licenses"><Input type="number" min="0" value={v.licenses} onChange={e => set("licenses", e.target.value)} /></F>
      <F label="Deployed licenses"><Input data-deployed-licenses type="number" min="0" value={v.deployedLicenses} onChange={e => set("deployedLicenses", e.target.value)} /></F>
      {+v.licenses > 0 && v.deployedLicenses !== "" && +v.deployedLicenses > +v.licenses &&
        <div data-overdeployed className="col-span-2 text-xs text-amber-600 md:col-span-4">Deployed is higher than total.</div>}
```

  - Check how a `null` in a patch is persisted. Look at `merge_patch` in supabase-setup.sql and at the reducer `EDIT_ACCOUNT` in src/lib/reducer.js. If null is stored as JSON null, `licenseFigures` treats it as "not recorded" and that's fine. If it would delete other data, stop and report NEEDS_CONTEXT.

- [ ] **Step 4: Implement the detail line.** Replace line 74 with:

```jsx
        {(() => { const f = licenseFigures(a); return f.total > 0
          ? <Meta label="Licenses" value={f.deployed == null ? f.total : `${f.deployed} deployed of ${f.total} (${f.pct}%)`} />
          : null; })()}
```

- [ ] **Step 5: Build and run, confirm pass.** `npm run build && node tests/health/run-one.mjs licenses.test.mjs`. Also run any existing test that asserts the old "Licenses" form label: `grep -rln "Licenses" tests/health` and run each file found.

- [ ] **Step 6: Commit.** "Add total and deployed licenses to the account form and detail".

---

### Task 3: CSV export and import

**Files:**
- Modify: `src/lib/csv.js` (the `cols` array in `accountsCSVText`; the `importSummary` warning text ~line 84)
- Modify: `src/17-csv.jsx` (~line 71, plus header aliasing near `const header = rows[0].map(norm);`)
- Modify: `src/20-account-list.jsx:216` (warning text)
- Modify: `tests/unit/golden/golden.json` (hand-edit only the `accountsCSVText` case)
- Modify: `tests/health/licenses.test.mjs`

**Interfaces:**
- Consumes: nothing new. Produces the `deployedLicenses` CSV column.

- [ ] **Step 1: Write failing tests.** Append to `tests/health/licenses.test.mjs`, reusing the CSV upload pattern (`setInputFiles`) from `tests/health/csv-import-safety.test.mjs`:
  1. **Import sets deployedLicenses.** Import a CSV with header `name,licenses,deployedLicenses` and a row for an existing account, `Acct 0,300,120`. Assert the merge_row patch for that account has `licenses: 300` and `deployedLicenses: 120`.
  2. **The "Deployed licenses" header alias.** Header `name,Total licenses,Deployed licenses` sets both fields.
  3. **An empty cell leaves the value unchanged (Review Focus 2).** The account has `deployedLicenses: 80`. The CSV row has an empty deployedLicenses cell. Assert no patch changes `deployedLicenses`.
  4. **An unreadable value counts in the warning.** `deployedLicenses` = `abc` leaves the value unchanged, and the import message mentions an unreadable number.

  Also add a unit assertion in `tests/unit/csv.test.mjs` (or a new `tests/unit/csv-licenses.test.mjs`). `accountsCSVText([{ name: "X", licenses: 200, deployedLicenses: 150, ... }])` has the header column `deployedLicenses` immediately after `licenses`, and the row value 150.

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: Implement.**
  - **Export (`src/lib/csv.js`):** insert `"deployedLicenses"` right after `"licenses"` in `cols`. Check that `cell()` falls through to `a[c]`. An unrecorded value must export as an empty cell, not "null" or "undefined": confirm how `csvCell` renders null/undefined, and map null to "" if needed.
  - **Import (`src/17-csv.jsx`):**
    - Normalise aliases right after building `header`: `const ALIAS = { totallicenses: "licenses" }; const header = rows[0].map(norm).map(h => ALIAS[h] || h);`. `"Deployed licenses"` already normalises to `deployedlicenses`.
    - After the licenses line add: `if (has("deployedlicenses") && col(r, "deployedlicenses") !== "") { const v = num("deployedlicenses"); if (v !== undefined) vals.deployedLicenses = Math.round(v); }`.
    - Check that `num()` on an empty cell doesn't count as unreadable. The guard above skips empties, but confirm `parseCsvNumber("")`. The intent is that an empty cell means unchanged and is not counted.
  - **Warning text:** change "(arr/licenses)" to "(arr/licenses/deployedLicenses)" in `src/lib/csv.js` `importSummary`, and "in arr/licenses" to "in arr/licenses/deployedLicenses" in `src/20-account-list.jsx`.
  - **Golden:** run `npm run test:unit`. The `accountsCSVText` golden case (and any `importSummary` golden containing the warning text) will now fail. Hand-edit ONLY those entries in `tests/unit/golden/golden.json` to the new expected output. Insert the `deployedLicenses` header and an empty cell for golden accounts without the field, and record which keys you changed in the report. Never run make-golden.mjs.

- [ ] **Step 4: Run and confirm pass.** `npm run test:unit`, then `npm run build`, then run `licenses.test.mjs`, `csv.test.mjs`, `csv-import-safety.test.mjs`, `csv-dates.test.mjs` and `health-mix-csv.test.mjs`.

- [ ] **Step 5: Commit.** "Import and export deployed licenses in CSV".

---

### Task 4: Dashboard card

**Files:**
- Modify: `src/16-dashboard.jsx` (add `LicenseCard` and render it after `</AnalyticsSection>` (~line 198), so it's the last card and always visible; the Analytics section is collapsed by default)
- Modify: `tests/health/licenses.test.mjs`

**Interfaces:**
- Consumes: `licenseSummary` (Task 1). `scored` and `openAccount` are already in `Dashboard`'s props and scope.

- [ ] **Step 1: Write failing tests** (append; seed via the harness, open the Dashboard, wait for `[data-license-card]`):
  1. **Numbers.** Seed active accounts A(200/150), B(100/50), C(400, no deployed), and a churned D(1000/0). Use the same churn flag shape existing churn tests seed. The card shows `300 total · 200 deployed · 67%`, then `1 account has no deployed count yet.`. D is excluded, so 1000 doesn't appear.
  2. **Lowest list and navigation.** `Lowest deployment` lists B (`50 / 100`, `50%`) before A (`150 / 200`, `75%`). B's % is NOT amber (50 isn't below 50). Clicking B's row opens B's account page; use the same assertion other tests use for an open account.
  3. **Amber below 50.** An account at 40% has `data-low` on its % element.
  4. **Over-deployment.** An account at 130/100 shows `130%`, and the summary bar's inline width is `100%`.
  5. **Empty states.** With no account having licenses, the card shows `No accounts have licenses yet. Add Total licenses on an account's Edit form.` With totals but no deployed figures, it shows `No deployed counts recorded yet.` and no list.
  6. **Scope.** With the dashboard scope set to "mine" (follow how existing dashboard tests switch scope), an account owned by another CSM is excluded from the totals.

- [ ] **Step 2: Build and run, confirm failure.**

- [ ] **Step 3: Implement** in `src/16-dashboard.jsx`, after the `Dashboard` function, near `ArrBridgeCard`:

```jsx
/* Total vs deployed licenses over the in-scope active accounts. Totals and % use only
   accounts with both figures (see licenseSummary); accounts missing a deployed count are
   named separately so missing data is not mistaken for low deployment. */
function LicenseCard({ accounts, openAccount }) {
  const s = licenseSummary(accounts);
  const n = x => x.toLocaleString("en-IN");
  return (
    <Card title="License deployment" className="!p-3" data-license-card>
      {s.counted === 0
        ? <div className="text-sm text-slate-500">No accounts have licenses yet. Add Total licenses on an account's Edit form.</div>
        : <div className="space-y-2">
            {s.pct == null
              ? <div className="text-sm text-slate-500">No deployed counts recorded yet.</div>
              : <>
                  <div data-license-summary className="text-sm font-semibold tabular-nums">{n(s.total)} total · {n(s.deployed)} deployed · {s.pct}%</div>
                  <div className="h-2 w-full overflow-hidden rounded bg-slate-100">
                    <div data-license-bar className="h-full rounded bg-indigo-500" style={{ width: `${Math.min(100, s.pct)}%` }} />
                  </div>
                </>}
            {s.missingDeployed > 0 && <div data-license-missing className="text-xs text-slate-500">
              {s.missingDeployed === 1 ? "1 account has no deployed count yet." : `${s.missingDeployed} accounts have no deployed count yet.`}</div>}
            {s.lowest.length > 0 && <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lowest deployment</div>
              {s.lowest.map(x => (
                <button key={x.id} data-license-row={x.id} onClick={() => openAccount(x.id)}
                  className="flex w-full items-center gap-2 border-b border-slate-100 py-1 text-left text-sm last:border-0 hover:bg-slate-50">
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  <span className="tabular-nums text-slate-500">{n(x.deployed)} / {n(x.total)}</span>
                  <span data-low={x.pct < 50 ? "" : undefined} className={`w-12 text-right tabular-nums font-semibold ${x.pct < 50 ? "text-amber-600" : ""}`}>{x.pct}%</span>
                </button>))}
            </div>}
          </div>}
    </Card>
  );
}
```

Render `<LicenseCard accounts={scored} openAccount={openAccount} />` directly after `</AnalyticsSection>`. Check that `Card` forwards `data-*` props. If it doesn't, wrap the Card in `<div data-license-card>`. Check how existing tests confirm `scored` excludes churned accounts. If `scored` contains churned accounts, filter `!a.churn` in the render call, and note this in the report.

- [ ] **Step 4: Build and run.** Run `licenses.test.mjs`, `dashboard.test.mjs`, `dashboard-polish.test.mjs`, `dark-mode.test.mjs` and `mobile.test.mjs`. All must pass.

- [ ] **Step 5: Commit.** "Add the license deployment card to the dashboard".

---

### Task 5: Docs and verification

**Files:**
- Modify: `TEAM-SETUP.md` (only if it documents account fields or the CSV columns: `grep -n "licenses\|CSV" TEAM-SETUP.md`). Otherwise there are no doc changes.
- Modify: `docs/qa/test-catalogue.md` if it lists account fields or dashboard cards. Add rows for the new tests in its existing format.

- [ ] **Step 1:** Make the doc updates above, if applicable, and commit them as "Document deployed licenses".
- [ ] **Step 2:** Run `npm run test:unit && npm run build`, and run each health file touched in Tasks 2-4. The full health suite runs in CI on the PR (local full runs get killed under memory pressure on this machine).
- [ ] **Step 3:** Push and open the PR. The controller does this. The body lists what shipped and the Review Focus pins, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
