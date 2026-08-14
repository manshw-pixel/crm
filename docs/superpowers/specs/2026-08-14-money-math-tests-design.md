# Money-Math Test Coverage — Design

**Date:** 2026-08-14
**Branch:** `test/money-math` (off `5ecf01a`, the PR #15 merge)
**Status:** design approved in chat; awaiting spec review

## Problem

The suite is 115 tests across 17 files and covers health scoring, playbooks, tasks,
bulk actions, saved segments, CSV import, accessibility and persistence. It asserts
nothing about money.

Every figure that leaves this app and lands in front of leadership — NRR, GRR, cohort
retention, churn by reason/CSM/tier, renewal win rates, forecast accuracy — is computed
by code with zero tests. `"renewal"` appears in the suite only as task metadata: a source
filter and a task title. No test asserts a single ARR number.

This is the failure mode that already happened once. The QBR `addMonths` month-end bug
was found by hand, not by the suite. A wrong ARR figure is silent: nobody sees a stack
trace, the number just goes into a board deck.

Gap 1 (nothing gates the deploy) closed on 2026-08-14 with PR #15. This closes gap 2.

## Scope

In scope — seven surfaces:

| Surface | `crm.html` | What it produces |
| --- | --- | --- |
| `retentionStats` | 1233 | NRR, GRR, churned ARR, expansion, contraction (trailing 12 months) |
| `cohortData` | 1265 | Quarterly cohort retention, logo and ARR |
| `ChurnAnalysis` row math | 1335 (in `useMemo`) | Churn grouped by Reason / CSM / Tier / Quarterly |
| `RenewalOutcomes` row math | 1377 (in `useMemo`) | Renewed, churned, slipped, win rate, forecast delta by quarter |
| `COMPLETE_RENEWAL` | reducer 392, form 1166 | Moves the renewal date, updates ARR, writes the renewals entry |
| `ADJUST_ARR` + audit trail | reducer 403, form 1205, `auditChanges` 231 | Expansion/contraction events and the ARR audit log |
| `toUSD` | 79 | Multi-currency conversion, used by every surface above |

Out of scope: the opportunity pipeline, documents, integrations, the snapshot *writer*
(`SET_SNAPSHOTS`, 3096) — only the snapshot *reader* in `RenewalOutcomes` is covered here.
Gap 3 (7 `confirm()`, 2 `alert()`, no error boundary, `aria-live` used once) is deliberately
a separate branch.

## Decisions taken in brainstorming

1. **Bugs found are fixed in this branch.** A failing test comes first, then the fix. Every
   resulting change in a user-visible number is listed explicitly in the PR body. This
   departs from the additive-only rule that governed PRs #12-14, and does so knowingly:
   tests that pin known-wrong math would make the suite report green while the numbers stay
   wrong, which is worse than no test.
2. **The two `useMemo` bodies get extracted to pure functions.** DOM-level assertions would
   run against `fmtMoney` output (`$1.2M`), and that rounding hides exactly the small errors
   this work exists to catch.
3. **All seven surfaces in one branch.** They share one fixture — a book of accounts
   carrying `renewals[]`, `churn`, `arrEvents[]` and mixed currencies feeds nearly all of
   them — so splitting would duplicate the expensive part.

## Architecture

### Changes to `crm.html`

**1. Extract `ChurnAnalysis`'s row math** (currently the `useMemo` at 1335) to a top-level
pure function:

```js
function churnRows(accounts, rates, dim, now = new Date()) { … }
```

The component becomes `useMemo(() => churnRows(accounts, rates, dim), [accounts, rates, dim])`.
`now` is injected because the `Quarterly` branch builds its last-8-quarters window from the
current date.

**2. Extract `RenewalOutcomes`'s row math** (the `useMemo` at 1377) to:

```js
function renewalOutcomeRows(accounts, rates, snapshots, now = new Date()) { … }
```

Both keep their current behavior exactly. The `now` parameter defaults to `new Date()`, so
neither component changes except to call the extracted function.

**3. Widen the `window.__health` export** at 3282 to add:

```
retentionStats, cohortData, churnRows, renewalOutcomeRows, quarterKey, monthsBetween, toUSD
```

This is the pattern `parseCSV` and `importAccountsCSV` already use to become testable.

### Test files

| File | Covers |
| --- | --- |
| `tests/health/money-fixture.mjs` | Shared seed builder — not a test file, and deliberately never imported by `run.mjs` |
| `tests/health/retention.test.mjs` | `retentionStats` |
| `tests/health/cohort.test.mjs` | `cohortData`, `quarterKey`, `monthsBetween` |
| `tests/health/churn-analysis.test.mjs` | `churnRows` |
| `tests/health/renewal-outcomes.test.mjs` | `renewalOutcomeRows` |
| `tests/health/renewal-write.test.mjs` | `COMPLETE_RENEWAL` reducer + `CompleteRenewalForm` |
| `tests/health/arr-audit.test.mjs` | `ADJUST_ARR`, `auditChanges`, `withAudit` |

**Registering the files matters.** `run.mjs` discovers nothing by glob — it carries an
explicit `import "./x.test.mjs"` list (lines 6-22). Each of the six new test files must be
added to it. A file that is written but not imported never runs, reports no failure, and
leaves the count looking plausible; that is the single easiest way for this branch to
appear finished while covering nothing. The task that adds a test file adds its import in
the same commit, and the expected test count is checked after each.

Currency is asserted inside the retention and churn files rather than in a file of its own.
`toUSD` in isolation is one line; what matters is its behavior in context — an unrecognized
currency resolves to rate `0` (`rates?.[cur] ?? 0`), which silently zeroes that account's
revenue instead of failing. That deserves a named test where revenue is actually summed.

## The central risk: these functions read the clock

`retentionStats`, `cohortData`, `churnRows` and `renewalOutcomeRows` all call `Date.now()` or
`new Date()` internally and bucket results by quarter. Tests written naively against them
pass in August and fail on 1 January.

That failure mode is now materially worse than it was last week: as of PR #15 a red suite
blocks the deploy. A test that breaks on a calendar boundary would wedge deploys on a day
nobody is watching, and would train everyone to distrust the gate.

Three rules, binding on every test in this spec:

1. **Never hardcode a quarter key.** No test contains the literal `"2026-Q3"`. Expected keys
   are computed in-page from the same clock the implementation reads.
2. **Seed by relative offset.** Dates come from a `rel(days)` helper, as `tasks.test.mjs`
   already does — `rel(-95)` for last quarter, not `"2026-05-11"`.
3. **Where a test must pin an absolute date, inject the clock.** `churnRows` and
   `renewalOutcomeRows` take `now`; those tests pass an explicit `new Date("2026-05-15")`
   and assert exact keys and exact sums. This is why the extraction includes a `now`
   parameter rather than only lifting the body verbatim.

`retentionStats` and `cohortData` are not given injected clocks — that would widen the
refactor past what the coverage needs. They are tested under rules 1 and 2, with offsets
chosen to sit far from a quarter edge (e.g. a "within the last 12 months" event seeded at
`rel(-180)`, never `rel(-364)`).

## Coverage

**`retentionStats`** — the 12-month boundary includes an event at `rel(-180)` and excludes
one at `rel(-400)`; expansion and contraction are separated by sign, with contraction stored
positive; churn contributes to `churnedARR` and drops out of `retARR`; the `base`
reconstruction at 1252 is pinned against a hand-computed figure; an empty book returns
`grr: null, nrr: null` rather than `NaN` or a division by zero; renewal deltas and
`arrEvents` are not double-counted for the same account (`COMPLETE_RENEWAL` writes a
`renewals` entry and no `arrEvent`, and the test pins that invariant); an account in an
unrecognized currency contributes 0, and the test says so in its name.

**`cohortData`** — accounts group into `YYYY-QN` keys; anything older than three years
collapses to a bare `YYYY` key; an account with no `startDate` or an unparseable one is
skipped rather than crashing; `surv` is `Infinity` for the never-churned, so they stay alive
in every column; a churn inside the first quarter still counts as alive at Q0 (`surv >= q`
with `surv === 0`); logo percentage and ARR percentage diverge when a large account churns;
`cells` extends only to the cohort's own age, not the grid's width.

**`churnRows`** — each of Reason, CSM, Tier groups and sums correctly; a missing reason falls
back to `"Other"`, a missing CSM to `"Unassigned"`; non-quarterly dims sort by ARR descending;
`Quarterly` returns exactly 8 chronological quarters, zero-filled where nothing churned;
`churn.currency` takes precedence over the account's current currency, which is the correct
behavior for a historical event.

**`renewalOutcomeRows`** — five quarters, oldest to newest, with the last flagged `current`;
a renewal lands in the quarter of its `completedOn`, not its `from`/`to` dates; win rate is
`renewed / (renewed + churned)` and is `null`, not `0`, when a quarter had neither; the
`slipped` condition at 1389 (past renewal date, not churned, no covering renewal) is tested
in both directions; a `snapshots` entry matching the quarter's first month supplies
`forecast`, absent snapshots leave it `null`, and the forecast delta's sign is asserted both
ways. The quarter-window arithmetic at 1379 (`Math.floor(now.getMonth() / 3) * 3 - off * 3`,
which goes negative and must roll into the previous year) is tested with an injected January
`now` — the case most likely to be wrong and least likely to be noticed.

**`COMPLETE_RENEWAL`** — the renewal date moves, `arr` updates, `contractStatus` returns to
`Active`, `billingCompleted` resets to `false` with a null date, `renewalStage` resets to
`"Not started"`, and one entry appends to `renewals[]`; audit entries are written for `arr`
and `renewalDate` only when each actually changed; a renewal at unchanged ARR writes the
date entry and no ARR entry; the ADD_ACTIVITY companion is recorded. Form-level: the
computed default date (see Known Defects) and that a blank ARR field coerces to 0 via
`+newArr || 0` rather than `NaN`.

**`ADJUST_ARR` and the audit trail** — a positive delta books `kind: "expansion"`, a negative
one `"contraction"`; a zero delta dispatches nothing at all and just closes the form (1213);
`arrEvents` appends while the audit entry records `from`/`to`; `source` resolves to
`"opportunity"` when the entry says so and `"adjustment"` otherwise (405); `auditChanges` on
an `EDIT_ACCOUNT` ARR edit appends the derived `arrEvent` at 387 with the right `kind`, and
tags `source: "import"` when the edit came from CSV.

## Known defects, to fix in this branch

**Confirmed — `CompleteRenewalForm:1167`.** The default next renewal date is
`iso(new Date(acct.renewalDate).getTime() + 365 * DAY)`. Verified in node: a contract
renewing on `2027-03-01` defaults to **`2028-02-29`**, one day early, because the 365-day
span crosses leap day. The fix is `addMonths(acct.renewalDate, 12)` — an existing helper
that already has month-end clamping tests from the QBR fix.

There is no timezone component to this bug. `iso` formats via `toISOString` (UTC) and
`new Date("2027-03-01")` parses as UTC midnight, so both ends are UTC and nothing shifts by
locale. An earlier reading of mine claimed otherwise; it was wrong.

**Suspected, to be confirmed by test before any change:**

- `retentionStats:1252` — the `base` reconstruction
  (`retARR + churnedARR - expansion + contraction`). If this is wrong, every NRR and GRR
  figure the app has ever shown is wrong. Pinned against a hand-computed fixture first.
- `retentionStats:1240` — a historical renewal delta converts with `a.currency`, the
  account's *current* currency, while the churn path at 1237 correctly prefers the
  event's own `churn.currency`. An account that changed currency reports wrong history.
  `renewals` entries carry no currency field today, so a fix means either writing one at
  `COMPLETE_RENEWAL` time (helps future data only) or accepting the limitation and
  documenting it. **This one is called out for a judgment call at implementation time, not
  fixed blind.**

Any further defect found during implementation follows the same protocol: failing test,
then fix, then an entry in the PR body describing the number that changed.

## Testing

Existing harness, unchanged: `launch(seed)` from `tests/health/harness.mjs`, the custom
runner at `tests/health/run.mjs`, assertions via `framework.mjs`.

- Baseline is **115 passed, 0 failed**. This branch targets roughly 155.
- **Never pipe the suite** — `run.mjs`'s exit code is the CI gate, and a pipe replaces it.
- Run one suite at a time; concurrent Playwright runs contend for browsers.
- Every test must also pass with `CRM_TEST_CHANNEL=""` (bundled Chromium), because that is
  what CI runs. Established in PR #15.
- Pure-function tests reach the math through `page.evaluate` on `window.__health`, so they
  cost one page load and no DOM interaction. Form-level tests drive the real UI.

**Suite runtime.** Cases run sequentially and most launch their own browser, so ~40 new
tests extend the run by roughly a third; the CI `test` job is currently around 7 minutes.
That is acceptable but not free, and it is a reason to prefer one `page.evaluate` covering
several assertions on the same fixture over one browser launch per assertion. Where a group
of assertions shares a seed, they share a page.

## Success criteria

1. All seven surfaces have named tests asserting exact numbers, not formatted strings.
2. The suite is green on both msedge and bundled Chromium.
3. The leap-day renewal defect is fixed, with a test that fails before the fix.
4. Every behavior change is listed in the PR body with the old and new number.
5. No test contains a hardcoded quarter key or absolute date except where a clock is
   explicitly injected.
6. `crm.html` changes are limited to the two extractions, the widened export, and defect
   fixes. No unrelated refactoring.
