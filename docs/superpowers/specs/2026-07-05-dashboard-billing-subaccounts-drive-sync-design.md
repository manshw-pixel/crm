# Design: Clickable dashboard, billing completion, sub-accounts, shared-drive sync

Date: 2026-07-05 · App: `crm.html` (single-file React + Supabase CRM)

## 1. Clickable dashboard cards

Every dashboard `Stat` card becomes clickable and navigates with a pre-applied filter:

| Card | Target |
|---|---|
| Total ARR | Accounts tab, no filter |
| ARR at risk / At-risk accounts | Accounts tab, Risk = Red |
| GRR / NRR | Accounts tab, no filter |
| Churned ARR | Accounts tab, "show churned" enabled |
| Tasks due 7d | Tasks view (week tasks) |

Implementation:
- `Stat` accepts optional `onClick`; when present, renders hover style + `cursor-pointer` and is keyboard-accessible (button semantics).
- App shell tab state gains an optional `accountsFilter` payload; `AccountList` accepts `initialFilter` ({risk, showChurned}) applied on mount/prop change.

## 2. Billing completed (per renewal cycle)

- New account fields: `billingCompleted: boolean`, `billingCompletedDate: ISO date | null`.
- Account detail: header badge — green "Billing ✓ <date>" or amber "Billing pending"; quick action "✓ Mark billing completed" with a date picker (defaults today). Dispatches `EDIT_ACCOUNT`.
- AccountForm (edit/create): billing completed Yes/No + date fields.
- Accounts table: "Billing" column (✓ date / pending) + filter (All / Completed / Pending).
- `COMPLETE_RENEWAL` resets both fields to pending for the new term; the previous term's billing state is stored on the renewal history entry (`billingCompleted`, `billingCompletedDate`).
- CSV export/import gains `billingCompleted`, `billingCompletedDate` columns.

## 3. Sub-accounts with ARR rollup

- New account field: `parentId: accountId | null`. One level deep only — an account with subs cannot itself get a parent, and a sub cannot be chosen as a parent (dropdown excludes them; guards prevent cycles).
- AccountForm: "Parent account" dropdown (None + eligible accounts).
- Accounts table: subs render indented with `↳` directly under their parent (parent group sorts by the active sort key using parent values). Parent ARR cell shows own ARR plus rollup: `$X (Σ $Y incl. N subs)` where Y = own + subs (USD-converted).
- Account detail (parent): "Sub-accounts (N)" card listing each sub (name, ARR, health chip, click-through) and the rollup total. Sub detail shows a "Parent: <name>" link.
- ARR rollup is display-only: dashboard totals, NRR/GRR, and retention math are unchanged (each account counted once with its own ARR).
- `DELETE_ACCOUNT` on a parent clears `parentId` on its subs (orphans them, does not delete).

## 4. Shared-drive folder sync

Settings gains an **Integrations** card using the File System Access API (Chrome/Edge; feature-detected, with an explanatory note elsewhere):

- Two folder pickers: **Sales folder** (new/updated account CSVs, existing import format → reuses `importAccountsCSV`) and **Finance folder** (billing CSVs with `accountNo` and/or `name` + `billingCompletedDate`; sets fields from §2 via `EDIT_ACCOUNT`).
- **Sync now** button + automatic scan every 5 minutes while the app is open.
- Only `.csv` files are read. Processed-file registry (`fileName + lastModified`) stored in the Supabase `settings` row (`integrations.processed`), so files import once; a re-dropped modified file re-imports.
- Sync log (last ~20 events) shown in the card: per file — imported N new / updated M / skipped / error message.
- Directory handles persisted in IndexedDB so folder choices survive reload; the browser may re-prompt for read permission, handled via `queryPermission`/`requestPermission`.
- Errors never block the app: a failing file is logged and skipped.

## Error handling & testing

- All new persistence flows go through the existing reducer + `persist()` write-through; failures surface via existing `dbError` alert.
- No JS test harness exists for `crm.html`; verification is manual: drive each feature in the running app, plus sample CSV files for both sync folders (including malformed rows).
