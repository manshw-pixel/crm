# QBR Cadence, Cohort View, and Richer Charts — Design Spec

**Date:** 2026-07-12
**Target:** `crm.html` (single-file OneVio CRM, Supabase-backed, deployed via GitHub Pages)

## Context

Contacts, activity logging, tasks/follow-ups, rule-based health scoring, NRR/GRR
stats, and trend sparklines already exist. This round adds the three genuinely
new pieces: QBR scheduling, cohort retention analysis, and upgraded charts.
No new dependencies; all charts are hand-rolled SVG consistent with the
existing `TrendLine` component.

## 1. QBR cadence

### Data model
Two new fields on the account object (stored in the existing `accounts` jsonb rows):

- `qbrFrequency`: `"None" | "Quarterly" | "Semi-annual" | "Annual"`. Default `"None"`.
- `nextQbrDate`: ISO date string or `""`.

Both editable in the account create/edit form, next to the existing date fields.

### Behavior
- When an activity of type `QBR` is logged on an account whose `qbrFrequency`
  is not `"None"`, set `nextQbrDate` = activity date + interval (Quarterly = +3
  months, Semi-annual = +6, Annual = +12).
- Churned accounts are excluded from all QBR-due counts.
- `nextQbrDate` blank with a frequency set is allowed; UI shows "not scheduled".

### UI
- **Account detail header:** chip showing QBR status — rose "QBR overdue Nd",
  amber "QBR due in Nd" when ≤30 days out, slate "Next QBR <date>" otherwise,
  or "QBR not scheduled" when frequency is set but no date.
- **Dashboard:** "QBRs due" stat card showing count due within 30 days plus
  overdue count; clicking opens the Accounts table filtered to those accounts
  via the existing `openAccounts(filter)` mechanism (new filter key, e.g.
  `qbrDue: true`).

## 2. Cohort view

- New collapsible **Cohorts** section on the Dashboard, respecting the
  existing scope filter (mine/all) and visible to all roles.
- **Rows:** cohorts by start quarter from `startDate`; cohorts older than
  3 years are grouped by start year to keep the grid compact.
- **Columns:** quarters elapsed since cohort start (Q0 .. now).
- **Cell:** % of that cohort still active at that elapsed point, derived from
  churn dates (churn-type activity date; fall back to `contractStatus` with
  churn treated as effective at the account's last renewal date if no churn
  activity exists).
- **Toggle:** logo retention (count-based) vs ARR retention. ARR retention
  uses each account's last-known ARR (no per-month ARR history exists) and is
  labeled "approx." in the UI.
- Accounts with no `startDate` are excluded from the grid.
- Cell background on a green→rose scale by retention %; empty (future) cells blank.

## 3. Richer charts

- Extend the existing SVG `TrendLine` into a `Chart` component with:
  Y-axis value labels, horizontal gridlines, X-axis month labels (thinned to
  fit), and a hover tooltip showing month + formatted value.
- Apply to the existing snapshot series: total ARR, NRR, GRR (up to 24 months).
- Add a **stacked-bar chart** of Green/Yellow/Red active-account counts per
  month from the same snapshots, with hover tooltip per bar.
- Pure SVG + Tailwind classes; no external chart library.
- Fewer than 2 snapshots: keep the existing "collecting one snapshot per
  month" message and hide the charts.

## Out of scope

- Per-account ARR history (would require new snapshot granularity).
- Reworking existing contacts/activities/tasks features.
- Backend/ML risk scoring.

## Testing

`crm.html` has no JS test harness; verification is manual in the browser
against the built-in demo data:

1. Set a QBR frequency + date on an account; log a QBR activity; confirm
   `nextQbrDate` advances by the frequency.
2. Confirm dashboard QBRs-due card counts and click-through filtering.
3. Verify cohort grid math against demo accounts (known start/churn dates),
   including the logo/ARR toggle and year-grouping of old cohorts.
4. Verify chart axes, gridlines, and tooltips with seeded multi-month
   snapshot data; confirm the <2-snapshot fallback message.
5. Confirm the new account fields round-trip through Supabase (save, reload).
