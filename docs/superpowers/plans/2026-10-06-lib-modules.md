# Lib Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move OneVio's pure logic (dates, money, QBR, health scoring, retention maths, analytics maths, CSV parsing) into real ES modules under `src/lib/`, bundled into the page as globals, with Node unit tests that must reproduce golden outputs recorded from master.

**Architecture:** `src/lib/*.js` are ES modules with explicit imports and exports. `build.mjs` bundles `src/lib/index.js` with esbuild (IIFE, `globalName: "__lib"`), adds `Object.assign(globalThis, __lib);`, and inlines it as a `<script>` immediately before the app script. The 26 classic app files keep calling those names as globals, with no call-site edits. Unit tests run with `node --test` against `src/lib` directly.

**Tech Stack:** Node 24 (`node:test`, `node:assert/strict`, `mock.timers`), esbuild 0.25 (`build` for lib, `transform` for app, unchanged), Playwright E2E suite (`tests/health`, unchanged).

**Spec:** `docs/superpowers/specs/2026-10-06-lib-modules-design.md`

## Global Constraints

- Moved code is cut and pasted **verbatim**: no renames, refactors or logic edits. Only `export` keywords and `import` lines are added. If any other line must change, the commit message says which line and why.
- **Pure only.** A lib function may use its arguments, its own module, imports from other `src/lib` modules, and standard JS. Anything that needs app code (components, store, `sb`, `dispatch`, toasts, React) stays in the app.
- **Stays in the app:** `uid`, `importAccountsCSV`, `importBillingCSV`, `exportCSV`, `OPP_STAGE_WEIGHT`, all components, and everything in `00-core-config.jsx` above the date helpers (TEAM CONFIG, `APP_VERSION`, `sb`, `signOut`, …).
- Lib files must not reference `window`, `document`, `localStorage`, `React`, `ReactDOM`, `sb`, `supabase`, `location` or `navigator`. The build enforces this.
- No name may be both exported by `src/lib` and declared at the top level of a `src/NN-*.jsx` file. The build enforces this.
- **No edits to any file in `tests/health/` or `tests/rls/`.** Those suites must pass unchanged.
- Unit tests compare against `tests/unit/golden/golden.json`. It was generated from master at 2026-06-15T12:00:00Z, UTC, and is committed with this plan. **Never regenerate or edit it** to make a test pass.
- Never pipe build or test commands; redirect to files. Don't run the full browser suite locally (out of memory); CI runs it. `run-one.mjs` takes a bare filename: `node tests/health/run-one.mjs smoke.test.mjs > ../x.txt 2>&1`. Always `node build.mjs` first.
- `core.autocrlf=true`: never convert line endings.

## Review Focus

1. **A missed `import` inside a lib function's rarely-run branch.** In the browser it would quietly resolve to the global (it still works). In Node it is a `ReferenceError`. Expected: caught, because every exported function has golden cases. Each task's Step 2 also lists each moved function's free identifiers and checks that every one is either local, imported, or standard JS.
2. **A leftover app copy of a moved name** shadows the lib version. Expected: the build fails and names it. Task 1 proves the guard fires.
3. **A timezone-dependent function** (`renewalOutcomeRows`, `churnRows`, `quarterKey`, `fmtDate`) passes locally (IST) but fails in CI (UTC), or the reverse. Expected: the test helper pins `TZ=UTC` and the clock, so results are identical everywhere. Task 1 runs the suite under both a pinned and an unpinned local shell to prove it.
4. **Load order:** app top-level code that runs immediately and calls a lib name (e.g. `00-core-config.jsx` uses `iso`/`DAY` at load). Expected: the lib script runs first, so these resolve. The `smoke` and `offline` E2E tests catch a regression in every task.
5. **Tailwind classes that now live only in lib** (`RISK_STYLE`). Expected: the content glob includes `./src/lib/**/*.js`. Task 2 checks that `bg-rose-100` still appears in the built CSS.

---

## File Structure

- Create `src/lib/index.js`, `dates.js`, `money.js` (Task 1); `qbr.js`, `scoring.js` (Task 2); `retention.js`, `analytics.js` (Task 3); `csv.js` (Task 4).
- Create `tests/unit/_golden.mjs` (helper) and `imports.test.mjs` (Task 1), plus one `<module>.test.mjs` per module in its task.
- Already committed with this plan: `tests/unit/golden/make-golden.mjs` and `tests/unit/golden/golden.json`.
- Modify `build.mjs`, `tailwind.config.js`, `package.json`, `.github/workflows/pages.yml` (Task 1).
- Modify `src/00-core-config.jsx` (Task 1); delete `src/01-qbr.jsx` (Task 2); modify `src/08-playbook-engine.jsx` (Task 2); delete `src/14-retention-math.jsx` (Task 3); modify `src/15-analytics-cards.jsx` (Task 3) and `src/17-csv.jsx` (Task 4). Line numbers below are approximate; find code by name.

---

### Task 1: Mechanism, dates and money

**Files:**
- Create: `src/lib/index.js`, `src/lib/dates.js`, `src/lib/money.js`, `tests/unit/_golden.mjs`, `tests/unit/imports.test.mjs`, `tests/unit/dates.test.mjs`, `tests/unit/money.test.mjs`
- Modify: `src/00-core-config.jsx` (remove the date and money helpers), `src/01-qbr.jsx` (remove `addMonths` only), `build.mjs`, `tailwind.config.js`, `package.json`, `.github/workflows/pages.yml`

**Interfaces:**
- Produces:
  - `src/lib/index.js` re-exports each module (`export * from "./dates.js";` …). Later tasks append lines.
  - `goldenSuite(moduleName, lib)` in `tests/unit/_golden.mjs`.
  - Every lib export becomes a browser global before the app script runs.

- [ ] **Step 1: Write the test helper and the failing tests**

`tests/unit/_golden.mjs`:

```js
// Shared harness for the pure-logic unit tests. Pins the timezone and the clock to the
// values golden.json was recorded under, revives encoded arguments, and normalises
// outputs the same way the generator serialised them.
process.env.TZ = "UTC";
import { readFileSync } from "node:fs";
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const G = JSON.parse(readFileSync(new URL("./golden/golden.json", import.meta.url), "utf8"));

const revive = v => {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object") {
    if ("$date" in v) return new Date(v.$date);
    if ("$undef" in v) return undefined;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
  }
  return v;
};
const norm = v => v === undefined ? null
  : JSON.parse(JSON.stringify(v instanceof Map ? { $map: [...v.entries()] } : v));

export function goldenSuite(moduleName, lib) {
  const cases = G.cases.filter(c => c[0] === moduleName);
  test(`${moduleName}: has golden cases`, () => assert.ok(cases.length > 0));
  cases.forEach(([, fn, args, expected], i) => {
    test(`${moduleName}.${fn} #${i}`, () => {
      mock.timers.enable({ apis: ["Date"], now: Date.parse(G.now) });
      try {
        assert.equal(typeof lib[fn], "function", `${fn} is not exported from src/lib/${moduleName}.js`);
        assert.deepEqual(norm(lib[fn](...revive(args))), expected);
      } finally { mock.timers.reset(); }
    });
  });
}
```

`tests/unit/dates.test.mjs`:

```js
import { goldenSuite } from "./_golden.mjs";
import * as lib from "../../src/lib/dates.js";
goldenSuite("dates", lib);
```

`tests/unit/money.test.mjs`:

```js
import { goldenSuite } from "./_golden.mjs";
import * as lib from "../../src/lib/money.js";
goldenSuite("money", lib);
```

`tests/unit/imports.test.mjs`:

```js
// Every lib module must import cleanly in plain Node (no window/document). An import-time
// reference to a browser global throws here -- the backstop for the build's lint guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

const dir = new URL("../../src/lib/", import.meta.url);
for (const f of readdirSync(dir).filter(f => f.endsWith(".js"))) {
  test(`src/lib/${f} imports in plain Node`, async () => {
    const m = await import(new URL(f, dir));
    assert.ok(Object.keys(m).length > 0, `${f} exports nothing`);
  });
}
```

In `package.json` `scripts`, add `"test:unit": "node --test tests/unit/"`.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit > ../u1.txt 2>&1; echo exit=$?`, then read `../u1.txt`.
Expected: exit 1; dates and money fail with "Cannot find module …/src/lib/dates.js" (the `src/lib` folder doesn't exist yet).

- [ ] **Step 3: Create the modules**

- `src/lib/dates.js`: cut from `src/00-core-config.jsx` the lines defining `DAY`, `today`, `iso`, `addDays`, `daysUntil`, `daysSince`, `isoMinus`, `isoPlus`, `fmtDate`. Cut `addMonths` and the comment line directly above it from `src/01-qbr.jsx`. Paste them verbatim, prefixing each top-level declaration with `export `. These need no imports.
- `src/lib/money.js`: cut `CURRENCIES`, `CUR_SYM`, `DEFAULT_RATES` (keep its trailing comment), `toUSD`, `fmtMoney` from `src/00-core-config.jsx`, with `export ` on each.
- `uid` stays in `00-core-config.jsx` (`Math.random`, not a golden-testable function).
- `src/lib/index.js`:

```js
// Pure logic with real module boundaries. build.mjs bundles this file and assigns every
// export to globalThis before the app script runs, so src/NN-*.jsx keep using these
// names as globals. Each module must stay free of window/document/React/store access.
export * from "./dates.js";
export * from "./money.js";
```

Check the free identifiers of every moved function: each must be a parameter, a local, a name defined in the same module, an import, or standard JS. Record the list in your report.

- [ ] **Step 4: Bundle lib in `build.mjs`, with both guards**

Add `import vm from "node:vm";`. After the existing `const { code: appJs } = await esbuild.transform(...)`, insert:

```js
// ---------------------------------------------------------------------------
// 2b. Bundle src/lib (real ES modules) into a script that runs BEFORE the app script and
//     puts every export on globalThis. See docs/superpowers/specs/2026-10-06-lib-modules-design.md
// ---------------------------------------------------------------------------
const LIB_DIR = p("src", "lib");
const libFiles = readdirSync(LIB_DIR).filter(f => f.endsWith(".js"));
// Guard: lib code must stay pure -- no browser or app globals. Comments and string
// literals are blanked first so prose like "the window opens" doesn't trip it.
const BANNED = /\b(window|document|localStorage|React|ReactDOM|sb|supabase|location|navigator)\b/;
for (const f of libFiles) {
  const code = read(join("src", "lib", f))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  const hit = code.match(BANNED);
  if (hit) throw new Error(`build: src/lib/${f} references "${hit[1]}" — lib code must not touch the browser or the app`);
}
const libBuild = await esbuild.build({
  entryPoints: [join(LIB_DIR, "index.js")], bundle: true, format: "iife", globalName: "__lib",
  target: "es2020", write: false, legalComments: "none",
});
const libBundle = libBuild.outputFiles[0].text;
// Guard: a name exported by lib must not also be declared at the top level of an app
// file -- the app's copy would silently shadow the lib's.
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(libBundle, sandbox);
const libNames = new Set(Object.keys(sandbox.__lib));
const TOP = /^(?:async\s+)?function\s+(\w+)|^(?:const|let|var|class)\s+(\w+)/gm;
const clashes = [];
for (const f of srcFiles) for (const m of read(join("src", f)).matchAll(TOP)) {
  const name = m[1] || m[2];
  if (libNames.has(name)) clashes.push(`${name} (src/${f})`);
}
if (clashes.length) throw new Error("build: declared in both src/lib and an app file: " + clashes.join(", "));
const libJs = `${libBundle}\nObject.assign(globalThis, __lib);`;
```

(`srcFiles` is the sorted list of app files from the existing join step. `readdirSync` and `join` are already imported.)

Change the final script replacement from

```js
  .replace(SCRIPT_RE, () => `<script>\n${appJs}\n</script>`);
```

to

```js
  .replace(SCRIPT_RE, () => `<script>\n${libJs}\n</script>\n<script>\n${appJs}\n</script>`);
```

In `tailwind.config.js`, set `content: ["./crm.html", "./src/**/*.jsx", "./src/lib/**/*.js"],` and add `src/lib` to its comment.

- [ ] **Step 5: CI step**

In `.github/workflows/pages.yml`, directly after the line `      - run: npm run test:worker`, add:

```yaml
      # Pure-logic unit tests (node:test, no browser). Fast; run before the E2E suite.
      - run: npm run test:unit
```

- [ ] **Step 6: Run unit tests, build, focused E2E**

```bash
npm run test:unit > ../u1.txt 2>&1; echo unit=$?
TZ=Asia/Kolkata npm run test:unit > ../u1b.txt 2>&1; echo unit-ist=$?   # the helper must override the shell TZ
node build.mjs > ../b1.txt 2>&1; echo build=$?
for f in smoke offline dates csv-dates pill; do node tests/health/run-one.mjs $f.test.mjs > ../e-$f.txt 2>&1; echo "$f: $(tail -1 ../e-$f.txt)"; done
```

Expected: unit=0 and unit-ist=0 (every dates/money golden case passes, imports pass), build=0, and every E2E file reports `0 failed`.

- [ ] **Step 7: Prove both guards fire** (restore after each; record outputs)

```bash
echo 'const toUSD = 1;' >> src/02-seed-data.jsx; node build.mjs > ../g1.txt 2>&1; echo exit=$?; tail -1 ../g1.txt; git checkout -- src/02-seed-data.jsx
echo 'export const leak = () => window.x;' >> src/lib/money.js; node build.mjs > ../g2.txt 2>&1; echo exit=$?; tail -1 ../g2.txt; git checkout -- src/lib/money.js 2>/dev/null || sed -i '$ d' src/lib/money.js
node build.mjs > ../b1.txt 2>&1; echo build=$?
```

Expected: the first build fails with `declared in both src/lib and an app file: toUSD (src/02-seed-data.jsx)`. The second fails with `src/lib/money.js references "window"`. The final build exits 0. (`money.js` is new and uncommitted, so `git checkout` cannot restore it; the `sed` removes the appended line. Confirm the file ends exactly as you wrote it.)

- [ ] **Step 8: Commit**

```bash
git add src build.mjs tailwind.config.js package.json .github/workflows/pages.yml tests/unit
git commit -m "Bundle pure logic from src/lib as globals; move dates and money; add Node unit tests"
```

---

### Task 2: QBR and health scoring

**Files:**
- Create: `src/lib/qbr.js`, `src/lib/scoring.js`, `tests/unit/qbr.test.mjs`, `tests/unit/scoring.test.mjs`
- Modify: `src/lib/index.js`, `src/08-playbook-engine.jsx` (remove `BAND_RANK`)
- Delete: `src/01-qbr.jsx` (everything in it moves; Task 1 already took `addMonths`)

**Interfaces:**
- Consumes: `daysUntil`, `daysSince` from `./dates.js`.
- Produces: the exports listed in the spec's scoring and qbr rows, plus `BAND_RANK`.

- [ ] **Step 1: Failing tests**

`tests/unit/qbr.test.mjs`:

```js
import { goldenSuite } from "./_golden.mjs";
import * as lib from "../../src/lib/qbr.js";
goldenSuite("qbr", lib);
```

`tests/unit/scoring.test.mjs`:

```js
import { goldenSuite } from "./_golden.mjs";
import * as lib from "../../src/lib/scoring.js";
goldenSuite("scoring", lib);
```

Run: `npm run test:unit > ../u2.txt 2>&1`. Expected: qbr and scoring fail with module-not-found.

- [ ] **Step 2: Move the code**
  - `src/lib/qbr.js`: `QBR_FREQS`, `QBR_FREQ_MONTHS`, the comment above `qbrStatus`, and `qbrStatus`, with `import { daysUntil } from "./dates.js";`.
  - `src/lib/scoring.js`: everything in `src/01-qbr.jsx` from `DEFAULT_WEIGHTS` through `flagsFor` (`DEFAULT_WEIGHTS`, `WEIGHT_LABELS`, the recency/value constants and comments, `mergeSettings`, `INPUT_RANGE`, `DEFAULT_INPUTS`, `clampInputs`, `lastActivityDate`, `windowScore`, `recencyBreakdown`, `scoreComponents`, `healthScore`, `bandImpact`, `riskOf`, `RISK_STYLE`, `RISK_HEX`, `flagsFor`).
    - Also cut `BAND_RANK` (one line, plus any comment directly above it) from `src/08-playbook-engine.jsx` into `scoring.js`.
    - `bandImpact` needs `BAND_RANK`; the playbook engine keeps using it as a global.
    - Add `import { daysUntil, daysSince } from "./dates.js";`, plus any further imports your free-identifier check finds.
  - Delete `src/01-qbr.jsx` once it's empty. Leave a number gap: do not renumber other files.
  - Append `export * from "./qbr.js";` and `export * from "./scoring.js";` to `src/lib/index.js`.
  - Record each moved function's free identifiers in your report.

- [ ] **Step 3: Verify**

```bash
npm run test:unit > ../u2.txt 2>&1; echo unit=$?
node build.mjs > ../b2.txt 2>&1; echo build=$?
grep -c "bg-rose-100" dist/crm.html   # RISK_STYLE class must still be in the built CSS (expect >= 1)
for f in smoke offline health-mix health-mix-ui crossing reducer dashboard tasks backfill settings; do node tests/health/run-one.mjs $f.test.mjs > ../e-$f.txt 2>&1; echo "$f: $(tail -1 ../e-$f.txt)"; done
```

Expected: unit=0 (all qbr and scoring golden cases), build=0, the grep count is at least 1, and every E2E file reports `0 failed`.

- [ ] **Step 4: Commit**

```bash
git add -A src tests/unit
git commit -m "Move QBR cadence and health scoring into src/lib"
```

---

### Task 3: Retention and analytics maths

**Files:**
- Create: `src/lib/retention.js`, `src/lib/analytics.js`, `tests/unit/retention.test.mjs`, `tests/unit/analytics.test.mjs`
- Modify: `src/lib/index.js`, `src/15-analytics-cards.jsx`
- Delete: `src/14-retention-math.jsx`

**Interfaces:**
- Consumes: `DAY`, `iso`, `daysUntil` (`./dates.js`); `toUSD` (`./money.js`). Add others your free-identifier check finds.
- Produces: `retentionStats`, `lastCompletedDecember`, `arrAsOf`, `accountRetention`, `amBookMovement`, `monthsBetween`, `quarterKey`, `cohortData`, `CHURN_DIMS`, `churnRows`, `renewalOutcomeRows`.

- [ ] **Step 1: Failing tests**

`tests/unit/retention.test.mjs`:

```js
import { goldenSuite } from "./_golden.mjs";
import * as lib from "../../src/lib/retention.js";
goldenSuite("retention", lib);
```

`tests/unit/analytics.test.mjs`:

```js
import { goldenSuite } from "./_golden.mjs";
import * as lib from "../../src/lib/analytics.js";
goldenSuite("analytics", lib);
```

Run `npm run test:unit > ../u3.txt 2>&1`. Expected: these two fail with module-not-found.

- [ ] **Step 2: Move the code**
  - `src/lib/retention.js`: the whole of `src/14-retention-math.jsx` except its first-line section-marker comment (`/* --- Dashboard --- */`, which no longer describes anything). Export the five functions and keep every comment. Delete `src/14-retention-math.jsx`.
  - `src/lib/analytics.js`: from `src/15-analytics-cards.jsx`, cut `monthsBetween`, `quarterKey`, `cohortData`, `CHURN_DIMS`, `churnRows`, `renewalOutcomeRows`, each with any comment directly above it.
    - Leave `CohortGrid`, `ChurnAnalysis`, `RenewalOutcomes`, `OPP_STAGE_WEIGHT` and `AmBookCard` in the app file. They keep using the moved names as globals.
    - If a moved function uses another pure helper from that file, move the helper too and note it.
  - Append `export * from "./retention.js";` and `export * from "./analytics.js";` to `src/lib/index.js`.
  - Record the free-identifier check in your report.

- [ ] **Step 3: Verify**

```bash
npm run test:unit > ../u3.txt 2>&1; echo unit=$?
node build.mjs > ../b3.txt 2>&1; echo build=$?
for f in smoke offline retention retention-ui account-retention cohort churn-analysis renewal-outcomes am-book currency-history redenomination dashboard; do node tests/health/run-one.mjs $f.test.mjs > ../e-$f.txt 2>&1; echo "$f: $(tail -1 ../e-$f.txt)"; done
```

Expected: unit=0, build=0, and every E2E file reports `0 failed`.

- [ ] **Step 4: Commit**

```bash
git add -A src tests/unit
git commit -m "Move retention and analytics maths into src/lib"
```

---

### Task 4: CSV parsing

**Files:**
- Create: `src/lib/csv.js`, `tests/unit/csv.test.mjs`
- Modify: `src/lib/index.js`, `src/17-csv.jsx`

**Interfaces:**
- Consumes: `daysUntil` (`./dates.js`), plus whatever the free-identifier check finds.
- Produces: `subNumbers`, `VALUE_COL`, `accountsCSVText`, `CSV_DMY`, `csvDateOrder`, `parseCsvDate`, `importSummary`, `parseCSV`. `importAccountsCSV`, `importBillingCSV` and `exportCSV` stay in `src/17-csv.jsx` and use these as globals.

- [ ] **Step 1: Failing test**

`tests/unit/csv.test.mjs`:

```js
import { goldenSuite } from "./_golden.mjs";
import * as lib from "../../src/lib/csv.js";
goldenSuite("csv", lib);
```

Run `npm run test:unit > ../u4.txt 2>&1`. Expected: csv fails with module-not-found.

- [ ] **Step 2: Move the code**
  - `src/lib/csv.js`: cut from `src/17-csv.jsx` `subNumbers` (with its comment), `VALUE_COL`, `accountsCSVText`, the CSV-dates block comment, `CSV_DMY`, `csvDateOrder`, `parseCsvDate`, `importSummary`, `parseCSV`. Export each.
  - Leave `exportCSV`, `importAccountsCSV` and `importBillingCSV` (and the file's section-marker comment) in `src/17-csv.jsx`.
  - Append `export * from "./csv.js";` to `src/lib/index.js`.
  - Record the free-identifier check.

- [ ] **Step 3: Verify**

```bash
npm run test:unit > ../u4.txt 2>&1; echo unit=$?
node build.mjs > ../b4.txt 2>&1; echo build=$?
for f in smoke offline csv csv-dates health-mix-csv bulk segments drive-permission; do node tests/health/run-one.mjs $f.test.mjs > ../e-$f.txt 2>&1; echo "$f: $(tail -1 ../e-$f.txt)"; done
```

Expected: unit=0, build=0, and every E2E file reports `0 failed`.

- [ ] **Step 4: Commit**

```bash
git add -A src tests/unit
git commit -m "Move CSV parsing into src/lib"
```

---

### Final (controller)

- **Master-vs-branch comparison:** load the sample dataset in a master build and a branch build. Compare every account's health score, risk, flags, ARR (USD), and the dashboard's NRR/GRR/churned figures, plus `Object.keys(window.__health)` with each value's `typeof`. They must be identical.
- Push and open the PR; CI runs `test:unit`, the full health suite and RLS.
