# Account-wise NRR and GRR, with movement against the prior-year close

Date: 2026-08-19
Status: approved for planning

## The problem

OneVio reports NRR and GRR for the whole book, in Analytics. It cannot answer "which
accounts are driving that number", and it cannot answer "has this account moved since we
closed last year". Both questions get asked of a CS team constantly, and today they are
answered by opening accounts one at a time and reading the ARR audit trail.

## What this adds

Per-account retention on the Accounts page:

- **NRR** and **GRR** per account, trailing twelve months.
- **Movement against the prior-year close** — the last completed December.

Placement is split deliberately. The list carries compact, sortable figures so the book can
be scanned and ranked; the account detail view carries the full arithmetic so a number can
be understood and defended.

| Surface | Shows |
|---|---|
| Accounts list | `NRR %`, `GRR %`, and a movement badge (`▲ +16.7%` / `▼ -8.0%` / `─ flat`) |
| Account detail | Baseline ARR → today's ARR, change in $ and %, and the retention ratio since the baseline |

## Decisions, and why

**TTM basis for NRR/GRR.** Per-account NRR and GRR use the same trailing-365-day window as
the existing `retentionStats`. The alternative — measuring since the Dec close — would put
two NRR numbers on screen that legitimately disagree. Reusing the window means the account
column and the Analytics headline agree by construction rather than by coincidence.

**Baseline is the last completed December, not a hardcoded Dec-2025.** It reads Dec'25
today and Dec'26 from January 2027, with the column header naming the baseline so it is
never ambiguous. A hardcoded date silently decays into an irrelevant comparison that
someone has to notice.

**FX: today's rates on both sides.** Both the baseline ARR and today's ARR convert at
current rates, so the delta shows revenue movement with FX drift removed. An EUR account
whose local ARR never moved reads as flat, not as growth.

The cost is stated plainly: the baseline figure will **not** tie to what was reported in
December at December's rates. That is the accepted trade — the column answers "did this
account grow" rather than "what did we report". Splitting real movement from FX effect
would need a historical rate table, which does not exist; if that is wanted later it is a
separate piece of work, not a tweak.

**Accounts with no baseline are `new`, and excluded from the math.** An account that
started after the baseline has no prior close, so any percentage is meaningless. It shows a
`new` marker rather than a number and is left out of NRR/GRR entirely. This matches how
retention is conventionally computed: new logos belong to new business, not to retention.
Treating the baseline as zero would inflate every roll-up; a blank cell would read as a bug.

**Per-account GRR is expected to read mostly 100%, and that is correct.** GRR excludes
expansion, so a single account only moves off 100% when it contracts or churns. It is kept
because a column of 100%s with occasional dips is exactly how downsell becomes visible.
This is recorded so a future reader does not "fix" it.

## Architecture

Two pure functions and two presentation changes. The functions carry all the logic and are
testable without a browser.

### `arrAsOf(account, isoDate, rates) -> number`

Point-in-time ARR in USD. Takes today's ARR and walks the account's history backwards,
undoing every movement dated after `isoDate`:

- `arrEvents` — won opportunities and manual ARR adjustments; each carries `date`, `delta`
  and `currency`.
- `renewals` — each carries `completedOn`, `arr` and `prevArr`.
- `churn` — an account churned after the baseline held its pre-churn ARR at the baseline.

**Redenominations are skipped**, matching `retentionStats` (crm.html:1458). A currency
restatement is not revenue movement, and letting one through would show as growth.

This is the reusable primitive. It is exported so tests can exercise it directly, and so
later features (a trend column, a period-over-period report) do not each reinvent it.

Reconstruction is sound because the event trail is complete: direct ARR edits write an
`arrEvent` (crm.html:581), as do won opportunities and manual adjustments.

### `accountRetention(account, rates, now) -> object`

Returns `{ nrr, grr, baselineARR, currentARR, delta, pct, isNew, baselineKey }`.

- `nrr` and `grr` come from `retentionStats([account], rates)` — the existing function,
  called with a single-account array. No second implementation of the retention formula.
- `baselineARR` comes from `arrAsOf(account, lastCompletedDecember(now), rates)`.
- `isNew` is true when the account's `startDate` is after the baseline; `nrr`, `grr`,
  `delta` and `pct` are then null.

### Presentation

- **`AccountList`**: three columns — NRR %, GRR %, movement badge — all sortable via the
  existing `Th` sort mechanism. Computed in the existing `rows` memo so windowing is
  unaffected: the metrics are part of the row data, not a per-render computation.
- **Account detail**: a retention block showing baseline → today, Δ$, Δ%, and the ratio.

## Testing

Unit-level, against the exported functions:

| Case | Expectation |
|---|---|
| Account with an expansion event after the baseline | `baselineARR` excludes it; delta positive |
| Account with a contraction after the baseline | delta negative; GRR below 100% |
| Account churned after the baseline | GRR 0%; baseline holds pre-churn ARR |
| Account started after the baseline | `isNew`, metrics null, excluded from math |
| Account with no events at all | baseline equals current; flat |
| Redenomination between baseline and now | no movement — the phantom-growth guard |
| Non-USD account, local ARR unchanged | flat, proving FX drift is removed |
| Empty book | no throw, no NaN |

**The tie-out test that matters most:** reconstruct a known account's baseline and assert it
agrees with its ARR audit trail. The replay must not drift from the ledger the app already
shows; if the two ever disagree, the ledger is right and the replay is wrong.

Browser-level: the three columns render and sort; the `new` badge appears for a 2026-start
account; the detail block shows the arithmetic.

`arrUSD` is not a stored field — the scoring pass adds it — so fixtures must set it
explicitly or every sum silently becomes `NaN`. New test files must be registered in
`tests/health/run.mjs`, which uses a hardcoded import list rather than a glob.

## Out of scope

- Splitting FX effect from real movement (needs a historical rate table that does not exist).
- Storing per-account ARR in the monthly snapshots. Snapshots are aggregate-only today
  (`totalARR`, `accounts`, `nrr`, `grr`, counts). Storing per-account history would be
  cleaner to read but cannot answer for Dec'25 retroactively, so it solves next year's
  problem rather than this one. If reconstruction proves slow, a stored cache is the
  follow-up — added with evidence, not in anticipation.
- Roll-up of sub-account retention into the parent. Each account is measured on its own,
  matching how the list already shows sub-account ARR as a separate `Σ` figure.
- Any change to `supabase-setup.sql`. This feature is computation over data already stored.
