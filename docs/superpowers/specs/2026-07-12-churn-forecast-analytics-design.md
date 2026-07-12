# Churn Analysis & Renewal Outcomes — Design Spec

**Date:** 2026-07-12
**Target:** `crm.html` (single-file OneVio CRM, Supabase-backed, GitHub Pages)

## Context

Churn entries (`{date, reason, note, arr, currency, by}` on the account) and
renewal history (`renewals[]` entries with `completedOn`, `prevArr`, `arr`)
have accumulated but are never aggregated. The Renewals page computes a live
90-day forecast (Commit / Best case / At risk by `renewalStage`) that is
never recorded, so forecast accuracy cannot be measured. This round adds
churn breakdowns, a retrospective renewal-outcomes view, and forward-only
forecast recording. All changes are additive.

## 1. Churn analysis (Dashboard)

A new "Churn analysis" card on the Dashboard, below the cohort retention
grid, respecting the existing scope selection (mine/All — same account
sourcing as the cohort grid).

- **Dimension toggle** in the card header: `Reason | CSM | Tier | Quarterly`
  (pill buttons, like the cohort grid's Logos/ARR toggle). Default: Reason.
- **Rows per dimension value:** label · accounts lost · ARR lost (USD),
  with a horizontal bar proportional to ARR lost, sorted descending by ARR.
  - Reason: the churn entry's `reason` (one of the existing CHURN_REASONS).
  - CSM: the account's `csm` (blank ⇒ "Unassigned").
  - Tier: the account's `tier`.
  - Quarterly: churn per calendar quarter, last 8 quarters, oldest first
    (this is the trend view; keep chronological order, not ARR-sorted).
- **Data:** all accounts with a truthy `churn` entry. Reactivated accounts
  (churn cleared) do not count. ARR lost = `toUSD(churn.arr,
  churn.currency || account.currency, rates)` — the existing fallback
  pattern.
- **Window:** all-time for Reason/CSM/Tier; the Quarterly view provides the
  time dimension. No separate window toggle (YAGNI).
- **Empty state:** "No churn recorded. 🎉"

## 2. Renewal outcomes by quarter (Renewals page)

A new "Renewal outcomes" card on the Renewals page, below the existing
forecast stats and month rail. One row per quarter: the last 4 completed
calendar quarters plus the current (partial) quarter, oldest first.

Per-quarter columns, computed from existing history across all non-deleted
accounts:

- **Renewed** — count and summed ARR (USD) of `renewals[]` entries whose
  `completedOn` falls in the quarter. ARR uses the entry's `arr` converted
  at the account's currency.
- **Churned** — count and ARR (USD) of churn entries dated in the quarter
  (same conversion as §1).
- **Slipped** — accounts whose current `renewalDate` fell inside that
  quarter, is in the past, and the account is neither churned nor has a
  renewal completed on/after that date (i.e., overdue renewals). Count only.
- **Win rate** — renewed ARR ÷ (renewed ARR + churned ARR), shown as a
  percent chip: emerald ≥ 90%, amber ≥ 75%, rose below. "—" when the
  denominator is 0.
- Quarters with no renewals, churn, or slips render their cells as "—".

## 3. Forecast recording & accuracy (forward-only)

- The existing monthly snapshot effect (one snapshot per calendar month in
  `settings.snapshots`) gains four fields captured from the same live
  computation the Renewals page uses: `due90` (ARR due in next 90 days,
  USD), `commit90` (stage Committed), `atRisk90` (stage At risk),
  `due90Count`.
- **Accuracy display:** in the Renewal outcomes card, a quarter's row gains
  a "Forecast (commit)" value when a snapshot exists from at or before that
  quarter's start (i.e., the forecast is ≥ 90 days old): show that
  snapshot's `commit90` next to the quarter's actual renewed ARR, with the
  delta. Use the snapshot from the month the quarter started (e.g., the
  2026-10 snapshot for Q4-2026).
- Until any comparable snapshot exists, the card footer notes:
  "Forecast tracking started <month year> — accuracy appears after a full
  quarter."

## Error handling / edge cases

- Churn entries missing `currency` fall back to the account's currency.
- Accounts without `renewals[]` or `startDate` are simply skipped by the
  relevant aggregations; no crashes on missing fields.
- Historical snapshots without the new forecast fields are tolerated
  (treated as "no forecast recorded" for their period).
- All new UI tolerates zero data (fresh workspace) with empty states.

## Out of scope

- Stage-at-renewal attribution (stage history is not stored).
- Editing or backfilling historical forecasts.
- Email digests/notifications (explicitly deferred by the user).

## Testing

Extend the session's Playwright E2E harness (scratchpad `e2e/` — mocked
Supabase + seeded data):

1. Seed 3+ churned accounts across different reasons/CSMs/tiers/quarters and
   assert each toggle mode's rows and ARR totals.
2. Seed `renewals[]` history and churn in known quarters; assert the
   outcomes table's renewed/churned/slipped counts and win-rate chips.
3. Assert the current-month snapshot now records `due90`/`commit90`/
   `atRisk90`/`due90Count`, and the footer note shows until snapshots age.
4. Manual regression pass on the live data after merge (dashboard cards,
   Renewals page, no console errors).
