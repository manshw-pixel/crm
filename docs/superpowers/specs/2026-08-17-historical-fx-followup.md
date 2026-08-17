# Follow-up: historical FX rates and currency redenomination

Date: 2026-08-17
Status: open — not scheduled, needs a decision

Deferred from the `retentionStats` currency fix (branch `fix/historical-currency`), which
stamped the booking currency onto renewal and ARR-event entries and made the readers honour
it. Two related problems remain open. Both are judgement calls about what the numbers
should *mean*, not bugs with an obvious right answer.

## 1. Historical entries convert at today's rate

`toUSD(n, cur, rates)` (`crm.html:84`) always applies the *current* rates table. Now that a
2025 renewal is correctly known to have been booked in INR, it is still converted at
today's INR rate rather than the rate in force when it was booked.

Consequences:

- NRR/GRR shift whenever someone edits the rates table in Settings, with no audit trail
  connecting the change to the moved numbers. A board metric silently rewrites its own
  history.
- Cross-period comparisons conflate real revenue movement with FX movement.

Option: stamp `rate` alongside `currency` when an entry is written, and convert historical
entries at their stamped rate, falling back to the current table when absent.

Costs to weigh before doing it:

- Every existing stored entry lacks the field, so the fallback path is permanent, and the
  book will mix stamped and unstamped entries for a long time.
- Reported NRR/GRR **will visibly change** the day it ships. That needs to be a deliberate,
  announced change, not a side effect.
- It only helps going forward. It cannot recover the rate that was in force for entries
  already written.

Open question for the user: should retention metrics be *stable* (stamped rates — history
never moves) or *comparable in today's money* (current rates — everything restated)? Both
are defensible. Finance teams usually want the first for reporting and the second for
planning, which may mean showing both.

## 2. Changing currency and ARR in one edit books a bogus delta — RESOLVED 2026-08-17

Fixed on branch `fix/redenomination`. Implementation notes below the original write-up.

### What was actually built

`EDIT_ACCOUNT` now detects a `currency` change and writes a single `arrEvents` entry with
`kind: "redenomination"` and `delta: 0`, carrying `fromCurrency`/`toCurrency` and
`fromArr`/`toArr`, instead of an expansion/contraction entry. `retentionStats` skips the
kind explicitly rather than relying on the zero delta. `currency` was added to
`AUDIT_FIELDS` (it was not audited at all before), and the ARR timeline gained a neutral
`⇄ redenominated` branch — without it the entry rendered as a blank row.

**The write-up below missed a second case,** found while implementing: if only the
*currency* changes and the ARR number does not, the old code wrote **no event at all**,
yet `arrUSD` — and with it `retARR` and the NRR/GRR base — moved by the whole FX factor,
entirely unexplained. Both cases now produce a redenomination entry.

### Original write-up

`EDIT_ACCOUNT` (`crm.html:395`) writes an `arrEvents` entry whenever `arr` changes,
computing `delta = to - from`. If the same save also changes `currency`, `from` and `to`
are denominated differently, so the delta is arithmetic on two different units and is
recorded as expansion or contraction.

Example: an account switching from INR 1,000,000 to its USD equivalent of 12,000 records a
**contraction of 988,000** — pure redenomination, no revenue lost.

The currency fix stamps the pre-edit currency (correct for `from`), but no stamp makes a
cross-currency subtraction meaningful. The real fix is to recognise redenomination as its
own thing:

- Detect `currency` changing in the same patch as `arr`.
- Either suppress the `arrEvents` entry entirely, or write it with `kind: "redenomination"`
  and `delta: 0` so the audit trail still records that it happened while analytics ignore
  it.
- The second is preferable — the ARR audit trail exists precisely so changes are not
  invisible.

This is a smaller and more clear-cut piece of work than item 1, and it is a genuine
correctness bug rather than a modelling choice. It is a reasonable next task on its own.

## Testing notes

`tests/health/currency-history.test.mjs` already covers the stamped-currency behaviour and
the unstamped fallback; extend it rather than starting a new file. `money-fixture.mjs`
carries `RATES = { INR: 0.012, PHP: 0.018 }` and the `scored()` helper, which must set
`arrUSD` explicitly or every sum becomes NaN.
