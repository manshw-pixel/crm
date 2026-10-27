# Integrations: sales and finance feeds (design)

Date: 2026-10-27. Status: DRAFT for user review.

## Why

The implementation module (PRs #93-#98) added a step between closed deal and CSM ownership, but
the sales feed still drops every account straight into Accounts. Sales should be able to send a
new deal either into **onboarding** (an implementation project) or **directly to CSM/Accounts**.
The finance feed only sets `billingCompletedDate`. It should carry the data the finance module
actually uses: purchase orders and payments.

## What exists today

- Settings → Integrations (`src/18-drive-sync.jsx`) has two shared-drive folders, **sales** and
  **finance**. It uses the browser File System Access API (Chrome/Edge only), runs every 5 minutes
  while a tab is open, and records each processed file by name and modified time.
- Sales CSV = the accounts export (`accountsCSVText`), imported by `importAccountsCSV`. It matches
  on accountNo, then name, and supports custom fields.
- Finance CSV = `accountNo,name,billingCompletedDate` (`importBillingCSV`).
- Implementation handover = a checklist from `settings.implChecklist` (default ids: `order_form`,
  `go_live_target`, `customer_contact`, `modules_scope`, `licences`, `commitments`,
  `integrations`, `kickoff`). A project is created at `queued` with a `handover→queued` history
  entry. `projectType()` makes it onboarding (first project) or expansion.
- Finance tables (`finance.sql`): `purchase_orders` (po_number, po_date, po_value, currency,
  years, billing_cycle quarterly/half_yearly/annual, billing_start, **file_path required**,
  status submitted→approved/rejected/cancelled), `po_schedule` (built on approval), and `invoices`
  (created in-app, numbered per billing entity; paid via `set_invoice_status(p_id, 'paid',
  paid_date, ref)`).

## Goals

1. **Sales routing.** Each row of the sales CSV says where the account goes:
   - `onboarding`: create or update the account, then create an implementation project with the
     handover checklist filled from the CSV.
   - `accounts` (the default, today's behaviour): the account goes straight to Accounts with its
     CSM.
2. **Finance fields that match the finance module.**
   - Purchase orders CSV: imports POs as **submitted**, so finance still approves them in-app.
   - Payments CSV: marks existing invoices paid (or waived) with date and reference.
   - The billing-completed CSV keeps working.
3. **One Integrations section** that shows, per feed, the folder, template downloads, what was
   imported, and what was refused and why.

## Non-goals (this round)

- Importing invoices. Invoices are generated in-app because numbering, tax and PDFs live there.
- Live connectors (HubSpot/Salesforce/Zoho/Tally/QuickBooks APIs) and webhooks. See "Later".
- Server-side scheduled sync. The feed still runs in an open Chrome/Edge tab.

## Anti-goals

- An import must never skip a human gate that exists in the app: PO approval, the handover
  checklist's required items, or CSM sign-off.
- A re-synced or edited file must never create duplicate projects or POs.
- A finance file must never be processed by a user who isn't a finance user.

## Design

### 1. Sales feed: `destination` column

- New optional column `destination` with values `onboarding` | `accounts`. Blank uses the feed's
  default, set in Settings (default `accounts`, so existing files behave as today).
- Checklist columns are named by **checklist item id** (`go_live_target`, `customer_contact`,
  `modules_scope`, ...). The onboarding template download includes the org's current checklist
  ids. Check items accept yes/no/true/false/1/0. Dates use the same parser as other CSV dates
  (DD-MM-YYYY / ISO).
- `onboarding` row:
  1. Upsert the account exactly as the accounts import does. It is still an account record, and
     it shows in Accounts (implementation users already see Accounts read-only).
  2. If the account **already has an open project** (queued..csm_review, or on_hold), skip
     project creation and note "open project exists" in the log. This is the dedupe rule, and it
     holds across re-syncs and edits.
  3. Otherwise create a project with type from `projectType()`, the checklist from the row, and
     `targetGoLive` from the date item, like `HandoverForm`.
     - All required items filled: stage `queued`, history `handover→queued`, note "Imported from
       sales feed (<file>)".
     - Required items missing: stage `handover` (a draft). The project shows on the board's
       handover state for sales or CSM to finish in-app. The log lists the missing items.
- `accounts` row: today's behaviour, unchanged.
- Log line per file: `accounts +N / updated N · projects queued N · drafts N · skipped N (reasons)`.

### 2. Finance feed: files recognised by header

The importer looks at each CSV's header row to decide what kind of file it is, not its filename:

| File kind | Required columns | Effect |
|---|---|---|
| Purchase orders | `accountNo` (or `name`), `po_number`, `po_date`, `po_value`, `currency`, `years`, `billing_cycle`, `billing_start`, `po_file` | insert `purchase_orders` row, status `submitted` |
| Payments | `invoice_number`, `status` (paid/waived), `paid_date`, `payment_ref` / `reason` | `set_invoice_status` |
| Billing (legacy) | `accountNo`, `billingCompletedDate` | today's `importBillingCSV` |

- **PO PDF:** `file_path` is required by the schema and the approval flow relies on it.
  `po_file` names a PDF **in the same folder**. The importer uploads it through the same storage
  path the PO form uses. A row whose PDF is missing is refused, with "PDF <name> not found" in
  the log.
- **Dedupe:** the existing unique index (org, account, po_number, excluding cancelled) refuses a
  repeat. The log shows it as "already imported", not as an error.
- Payments match on invoice number. Unknown invoice numbers, already-paid invoices, or status
  changes the RPC refuses are logged per row, and the rest of the file continues.
- **Who runs it:** only users with `is_finance()`. For anyone else the finance folder shows "Only
  finance users can sync this folder", and the timer skips it. RLS/RPC already enforce this
  server-side; the UI check only avoids a log full of refusals.
- Values are validated against the finance enums before any write: currency INR/USD/PHP;
  billing_cycle quarterly/half_yearly/annual (also accepting "Quarterly", "Half-yearly",
  "Annual"); years 1-10; value > 0.

### 3. Integrations section UI

- Two cards, **Sales feed** and **Finance feed**. Each has: folder status (connected / needs
  access / not set), Choose folder, Sync now, last sync time, the files in the folder with a
  status each, and template downloads:
  - Sales: "Accounts → CSM" template (today's) and "Onboarding" template (account columns +
    `destination=onboarding` + checklist id columns).
  - Finance: Purchase orders, Payments, Billing completed.
- A shared **activity log** below, filterable by feed, with errors highlighted. It keeps the
  current log storage in `settings.integrations` (existing cap).
- A short "How this works" note: Chrome/Edge, the tab must be open, files are processed once per
  modified time, and editing a file re-imports it (dedupe rules make that safe).

### 4. What happens to the existing Integrations section (approved 2026-10-27)

Upgraded in place, nothing removed: same Settings anchor (`set-integrations`), same two folder
handles (IndexedDB keys `sales` / `finance` stay, so connected folders stay connected), same
`settings.integrations.processed` map (already-imported files are not re-imported) and log
history. Files without a `destination` column and the billing-completed CSV behave exactly as
today.

## Build order (3 PRs, each with unit + health + live QA scenarios)

1. **Sales routing.** Pure `src/lib/sales-import.js` (row → {account, project | draft | skip,
   reasons}), golden unit tests, wired into the sales sync, onboarding template, Settings default
   destination. QA: drop an onboarding CSV and see a queued project on the board.
2. **Finance POs and payments.** Pure `src/lib/finance-import.js` (header sniffing, row
   validation), PDF lookup and upload, payments via `set_invoice_status`, finance-only gating.
   Likely no SQL: existing tables, RLS and RPCs cover it (confirm during planning). QA: a PO lands
   as submitted with its PDF; a payment marks an invoice paid.
3. **Integrations UI.** The two feed cards, templates, filtered log, and help text.

## Later (not this round)

- **Webhook intake:** a Supabase Edge Function endpoint with a per-org secret, accepting the same
  row shape as JSON. Zapier, HubSpot or Salesforce workflows could then post closed-won deals with
  no open tab, and it would reuse `sales-import.js` server-side.
- **Accounting export:** approved PO schedules and invoices as CSV for Tally / Zoho Books /
  QuickBooks.
- **Calendar/email:** already partly covered by the touchpoints inbox (@mail.onevio.in).

## Calls I made (user to confirm)

1. Routing is a **`destination` column** with a Settings default, not two separate sales folders.
   One file can carry both kinds.
2. Onboarding imports with missing required checklist items become **handover drafts**, not
   refusals.
3. Imported POs **require their PDF** in the folder and arrive as **submitted**, never
   auto-approved.
4. Finance files are recognised **by header**, so filenames don't matter.
5. The existing **billing-completed CSV stays supported**.
