# Total vs deployed licenses — design

Date: 2026-10-08

## Goal
Each account records **Total licenses** (licenses sold) and **Deployed licenses** (licenses
in use). A dashboard card, placed last, shows total vs deployed across the accounts in view,
and lists the accounts with the lowest deployment so CSMs can chase adoption.

## Decisions (agreed with user)
- The existing `licenses` field becomes **Total licenses**. Its stored name stays `licenses`, so
  existing data and old CSVs keep working with no migration. Deployed starts blank.
- The card shows a summary plus the 5 lowest-deployment accounts (option A).

## Data
- `licenses` (number, existing): Total licenses. `0`/missing means "not set".
- `deployedLicenses` (number, new, optional): blank/missing means "not recorded", which is
  distinct from `0` (recorded as zero deployed).
- Fields live in the account's `data` JSON, so no SQL change is needed.

## Account edit form (src/13-forms.jsx)
- "Licenses" is relabelled **Total licenses**. A new **Deployed licenses** number field sits next to it.
- Both fields take whole numbers ≥ 0. An empty Deployed field saves as "not recorded" (key removed or null), not 0.
- When deployed > total (and total > 0), the form shows an amber line, `Deployed is higher than total.`
  The save is still allowed, because over-deployment is real and must be recordable.

## Account detail (src/21-account-detail.jsx)
- Total set and deployed recorded: `Licenses: 150 deployed of 200 (75%)`.
- Total set and deployed not recorded: `Licenses: 200` (as today).
- Total not set: no licenses line (as today).

## CSV (src/lib/csv.js export, src/17-csv.jsx import)
- Export adds a `deployedLicenses` column directly after `licenses`.
- Import reads `deployedLicenses`, with the same unreadable-number handling as `licenses`: an unreadable value
  is left unchanged and counted in the existing "unreadable number(s)" warning, whose text becomes
  "(arr/licenses/deployedLicenses)". Header matching follows the importer's existing normalisation,
  so headers "Total licenses" and "Deployed licenses" are also accepted as aliases for
  `licenses` and `deployedLicenses`.

## Dashboard card: "License deployment" (last card on the dashboard)
Pure helper `licenseSummary(accounts)` in `src/lib/licenses.js`:
- **In:** the dashboard's in-scope active accounts (`scored`, which already respects Mine/All
  and excludes churned).
- **Counted:** accounts with `licenses > 0`.
- **Returns:**
  - `{ total, deployed, pct, counted, missingDeployed, lowest }`
  - `total`: sum of `licenses` over counted accounts **that have a deployed figure recorded**.
    The % compares like with like, so accounts with no deployed figure do not drag it down.
  - `deployed`: sum of `deployedLicenses` over those same accounts.
  - `pct`: `deployed / total`, rounded to a whole percent. null when total is 0.
  - `missingDeployed`: count of counted accounts with no deployed figure.
  - `lowest`: up to 5 accounts with a deployed figure, sorted by deployment ratio ascending, ties
    by name. Each is `{ id, name, total, deployed, pct }`.

Card rendering:
- Summary line `4,200 total · 3,150 deployed · 75%` and a horizontal bar. The bar width is capped
  at 100%, while the number can exceed 100%.
- When `missingDeployed > 0`: `N accounts have no deployed count yet.`
- "Lowest deployment" list: name, `120 / 400`, `30%`. The % is amber below 50%. A row click opens the account.
- Empty state (no counted accounts): `No accounts have licenses yet. Add Total licenses on an
  account's Edit form.`
- If accounts have totals but none has a deployed figure, show the totals line with
  `No deployed counts recorded yet.` instead of a % and list.

## Testing
- **Unit** (`tests/unit/licenses.test.mjs`): sums only accounts with both figures; `pct` rounding and the
  null case; `missingDeployed`; exclusion of `licenses` 0/missing; `lowest` ordering, ties and cap of 5;
  over-deployment (pct > 100).
- **Health** (Playwright):
  - The form saves both fields; an empty Deployed saves as not recorded.
  - The over-deployed warning shows and the save is still allowed.
  - The detail text covers its three cases.
  - CSV export has the column, and CSV import sets `deployedLicenses`, including from the "Deployed licenses" header.
  - The card shows the right numbers, excludes churned and out-of-scope accounts, the lowest list opens
    the account, and the empty state renders.
  - The card renders in dark mode.

## Out of scope
License history over time, per-module licenses, and alerts on low deployment.
