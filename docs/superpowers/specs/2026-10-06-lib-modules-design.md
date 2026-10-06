# Pure logic as real modules with Node unit tests

Date: 2026-10-06 · Status: approved design, awaiting spec review

## Goal

Give OneVio's pure logic (dates, money, health scoring, QBR cadence,
retention/ARR maths, analytics maths, CSV parsing) **real module boundaries**
and **fast Node unit tests**, with no change in behaviour.

This is the first round of the "enforced boundaries / unit tests" goal. UI
components, the reducer, the write queue and Supabase code stay as they are
(classic-script globals in `src/NN-*.jsx`).

Builds on the module split (PR #60, `docs/superpowers/specs/2026-10-06-module-split-design.md`).

## Approach

Pure code moves into `src/lib/*.js`: real ES modules with explicit
`import`/`export`. The build bundles `src/lib/index.js` with esbuild into a
small script that runs **before** the app script and assigns every export to
`globalThis`. The app's 26 classic files keep calling these names as globals,
with **no call-site edits**.

Node tests import `src/lib/` directly with Node's built-in test runner.

Rejected alternatives: converting the whole app to modules at once (UI scope,
not this round), and testing the logic in a fake browser page (no enforced
boundary).

## Modules

| Module | Exports (moved verbatim from) |
|---|---|
| `src/lib/dates.js` | `DAY`, `today`, `iso`, `addDays`, `daysUntil`, `daysSince`, `isoMinus`, `isoPlus`, `fmtDate` (00-core-config); `addMonths` (01-qbr) |
| `src/lib/money.js` | `CURRENCIES`, `CUR_SYM`, `DEFAULT_RATES`, `toUSD`, `fmtMoney` (00-core-config) |
| `src/lib/qbr.js` | `QBR_FREQS`, `QBR_FREQ_MONTHS`, `qbrStatus` (01-qbr) |
| `src/lib/scoring.js` | `DEFAULT_WEIGHTS`, `WEIGHT_LABELS`, `ACTIVITY_TYPES`, `DEFAULT_RECENCY_MIX`, `VALUE_ITEMS`, `DEFAULT_VALUE_MIX`, `mergeSettings`, `INPUT_RANGE`, `DEFAULT_INPUTS`, `clampInputs`, `lastActivityDate`, `windowScore`, `recencyBreakdown`, `scoreComponents`, `healthScore`, `bandImpact`, `riskOf`, `RISK_STYLE`, `RISK_HEX`, `flagsFor` (01-qbr); `BAND_RANK` (08-playbook-engine; `bandImpact` needs it) |
| `src/lib/retention.js` | `retentionStats`, `lastCompletedDecember`, `arrAsOf`, `accountRetention`, `amBookMovement` (14-retention-math) |
| `src/lib/analytics.js` | `cohortData`, `churnRows`, `renewalOutcomeRows`, `quarterKey`, `monthsBetween`, and any pure helpers they use (15-analytics-cards) |
| `src/lib/csv.js` | `subNumbers`, `VALUE_COL`, `accountsCSVText`, `CSV_DMY`, `csvDateOrder`, `parseCsvDate`, `importSummary`, `parseCSV` (17-csv) |
| `src/lib/index.js` | `export * from` each module above |

### Rules for what may move

- **Pure only.** A moved function may use only its arguments, its module's own
  definitions, its imports from other `src/lib` modules, and standard JS
  (`Date`, `Math`, `JSON`, `Intl`, string/array methods). Before moving
  anything, the plan lists each function's free identifiers. If one resolves
  to app code (a component, the store, `sb`, `dispatch`, a toast, React), the
  function **stays in the app**, and the spec's table is corrected in the plan.
- **Verbatim.** Moved code is cut and pasted unchanged, plus `export` and the
  needed `import` lines. No renames, no refactors and no logic changes. If a
  line had to change, the commit says which and why.
- **Stays in the app:** `importAccountsCSV`, `importBillingCSV` and
  `exportCSV` (they dispatch or touch the DOM), all components, and anything
  that fails the purity check above.
- `today` and the `now` defaults call `Date.now()`. That is allowed. Tests pin
  the clock (see Testing).

## Build (`build.mjs`)

- Bundle step: `esbuild.build({ entryPoints: ["src/lib/index.js"], bundle: true,
  format: "iife", globalName: "__lib", target: "es2020", write: false,
  legalComments: "none" })`. The output is then followed by
  `Object.assign(globalThis, __lib);`.
- The result is inlined as its own `<script>` **immediately before** the app
  script in `dist/crm.html`. Like the app script, it makes no network
  requests.
- **Guard: duplicate names.**
  - The lib's names come from running the bundle in a Node `vm` context and
    taking `Object.keys(__lib)`.
  - The app's names come from a regex over `src/NN-*.jsx` lines at column 0:
    `^(?:async\s+)?function\s+(\w+)|^(?:const|let|var|class)\s+(\w+)`. All
    top-level declarations in this codebase start at column 0.
  - If any name is in both, the build fails and lists the clashing names.
    Without this, a leftover app copy would shadow the lib version silently.
- **Guard: no browser or app globals in lib.** The build fails if any
  `src/lib/*.js` file references `window`, `document`, `localStorage`,
  `React`, `ReactDOM`, `sb`, `supabase`, `location` or `navigator`. Matching
  is on word boundaries, outside comments and strings where practical. A Node
  import test (below) is the backstop.
- Tailwind `content` adds `./src/lib/**/*.js`, since RISK_STYLE holds class
  strings.
- `window.__health` keeps exposing the same names. They are now globals that
  come from lib, so its line is unchanged.

## Testing

- `tests/unit/*.test.mjs` use `node:test` and `node:assert/strict`. No new
  dependencies.
- `package.json` gets `"test:unit": "node --test tests/unit/"`.
- `.github/workflows/pages.yml` runs `npm run test:unit` in the `test` job,
  before the browser suite.
- **One file per module.** Each covers the module's behaviour, including the
  edge cases the browser suite already pins. At minimum:
  - **dates:** `daysSince` and `daysUntil` across boundaries; `addMonths` at
    month ends (31 Jan + 1, leap year).
  - **money:** `toUSD` for USD, INR, a missing rate and a missing currency;
    `fmtMoney` K/M formatting.
  - **scoring:**
    - `windowScore` boundaries
    - `mergeSettings` on an old-shape row
    - `healthScore` with inert defaults equals the legacy formula
    - the recency blend
    - the Value blend, including zero sub-weights
    - `riskOf` thresholds
    - `bandImpact` counts, including churn exclusion
  - **qbr:** each frequency, plus due, overdue and none.
  - **retention:** `retentionStats` GRR/NRR on a small fixture; `arrAsOf`
    ledger replay; redenomination ignored.
  - **analytics:** `quarterKey`, `monthsBetween`, a small `cohortData` case.
  - **csv:**
    - `parseCSV` quoting and embedded commas
    - `csvDateOrder` dmy/mdy/conflict
    - `parseCsvDate` dd-mm and 2-digit years
    - an `accountsCSVText` header that includes the Value columns
- **Pinned clock.** Tests that depend on "today" use `mock.timers` from
  `node:test` with `Date` enabled, or pass explicit `now` arguments where the
  function accepts them, so they cannot flake around midnight or month ends.
- **Import test.** Every lib module is imported in plain Node, where there is
  no `window`. An import-time reference to a browser global throws, which
  backstops the lint guard.

## Verification

1. The full browser suite (`tests/health`) and RLS suite pass unchanged. No
   test file in `tests/health` or `tests/rls` is edited.
2. `npm run test:unit` passes, in CI and locally (it is cheap).
3. **Master-vs-branch comparison.** On the sample dataset, every account shows
   the same health score, risk band, ARR (USD), NRR/GRR and flags on both
   builds, and the dashboard's retention figures match. This check is
   scripted the way the PR #59 check was.
4. Both guards are shown to fire by breaking the input on purpose:
   - a duplicate name left in an app file
   - `window` used inside a lib file
5. `window.__health` still resolves every name it listed before.

## Out of scope

- UI components, reducer, write queue, persistence, Supabase, auth
- Renaming, refactoring or behaviour changes inside moved code
- Converting more areas: later rounds, one spec each
- Updating stale `crm.html:NNN` comments, except where a moved block's own
  comment would now be wrong
