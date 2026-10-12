# Finance Invoicing — Design

Date: 2026-10-12
Status: Draft for review

## Goal

Let the finance team create invoices inside the CRM, email them to customers as PDFs, and record whether each invoice was paid or waived. Every account keeps its full invoice history. A Finance page and a Dashboard card show paid, pending and waived amounts.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Statuses | `pending` → `paid` or `waived`. No "in progress". Overdue is derived (pending and past due date), not stored. |
| Countries | Customers in India, US, Philippines. |
| Legal entities | Separate entity per country (India, US, PH), each with own tax ID, bank, address, number series. |
| Entity on invoice | Account has a `billing_entity_id`, defaulted from country, editable. The invoice copies it at creation. |
| Creation | Manual, one invoice at a time, line items pre-filled from the account's licenses and ARR. No billing runs or recurring invoices in v1. |
| Delivery | Email with the PDF attached, sent via Brevo from one sender address held in settings (`support@onevio.in` now, `billing@onevio.in` later). |
| Access | A **Finance access** toggle on any user, independent of the user/admin role. Finance and admins create, send, mark paid and waive. Everyone in the org can view invoices and download PDFs. |
| Navigation | New **Finance** page in the sidebar, plus an **Invoices** tab on the account page and a finance card on the Dashboard. |

## Architecture

The PDF is generated in the browser with jsPDF and uploaded to a private Supabase Storage bucket. A Supabase Edge Function `send-invoice` loads the PDF and sends it through Brevo with the PDF as an attachment, using the same pattern as the email-alerts sender. Everything is scoped to the client org with RLS, like existing tables.

## Data model

### `billing_entities`
`id, org_id, name, country (IN|US|PH), address, state (India: for GST place-of-supply), tax_id (GSTIN/EIN/TIN), tax_id_label, currency (INR|USD|PHP), bank_details (text), logo_path, invoice_prefix, next_number (int), default_tax_pct, lut_number (India, nullable), created_at`

### `accounts` (additive columns)
`billing_entity_id (nullable FK)`, `billing_email`, `billing_address`, `customer_tax_id`, `customer_state` (India only), `country`.

### `invoices`
`id, org_id, account_id, entity_id, number (unique per entity), issue_date, due_date, currency, line_items jsonb [{description, qty, rate, amount}], subtotal, tax_lines jsonb [{label, pct, amount}], total, status (pending|paid|waived), paid_date, payment_ref, waive_reason, status_by, status_at, pdf_path, sent_to, sent_cc, sent_at, sent_by, created_by, created_at`

- Rows are created only when an invoice is sent (see Send flow). A sent invoice's amounts, line items and number never change. Only status fields change.
- `waived` requires a non-empty `waive_reason`. `paid` requires a `paid_date`.
- A paid or waived invoice can be reverted to pending by Finance or admins (mistaken checkbox). The revert is recorded in `status_by` and `status_at`.

### `profiles` (additive)
`finance boolean default false`.

### Settings
Org-level `invoice_sender_email` (default `support@onevio.in`).

### Numbering
A SQL function `next_invoice_number(entity_id)` increments `next_number` under a row lock and returns `prefix + zero-padded number` (e.g. `IN/2026-27/0001`, `US-0001`). It is called inside the same transaction that inserts the invoice. Gaps are acceptable only if a send fails after numbering (see Error handling).

## Tax rules — `src/lib/invoice-tax.js` (pure, unit-tested)

`computeTax(entity, account, subtotal) → tax_lines[]`

- **India entity, Indian customer, same state:** CGST 9% + SGST 9%.
- **India entity, Indian customer, other state:** IGST 18%.
- **India entity, foreign customer:** zero-rated export. No tax line, with the note "Supply meant for export under LUT <lut_number> without payment of IGST".
- **US entity:** `default_tax_pct` (0 by default). If above 0, one "Sales tax" line.
- **PH entity:** VAT 12%.

Rates come from the entity row, not constants, except the CGST/SGST split rule. `src/lib/invoice-totals.js` handles line amounts, subtotal and total, with rounding to 2 decimals per line and on the total.

## UI

### Finance page (new sidebar view)
- **Summary strip:** Paid, Pending, Waived and Overdue totals, **grouped by currency** (never summed across INR/USD/PHP). Filters: date range (issue date), entity.
- **Invoice table across all accounts:** number, account, entity, issue date, due date, total, status, **Paid** checkbox. Filters: status, entity, currency, overdue, account search. CSV export (with the existing formula-injection guard). Virtualized like other long lists.
- **Paid checkbox:** opens a small dialog for paid date (default today) and an optional payment reference. Unchecking reverts to pending, with a confirm step.
- **Row actions:** Download PDF, Re-send, Waive (requires a reason).
- **New invoice** (Finance only): pick the account first, then open the invoice form.
- Users without finance access see the page read-only, with no checkbox, waive or create controls.

### Invoice form
Pre-filled with the account's billing entity, billing email (To), owning CSM (CC), issue date today, due date today + 30 days (editable), and one line item from the account's licenses × rate or ARR for the period. Line items are editable, totals and tax are live, and there is a PDF preview. One **Send** button. Validation: billing email present, entity set, at least one line item, total above 0.

### Account page
New **Invoices** tab showing the same table filtered to the account, with the same actions per permission. Account edit form gains the billing fields listed above.

### Dashboard
A finance card with Paid / Pending / Waived amounts per currency for the current quarter, a donut chart of the primary currency, and an overdue count. It links to the Finance page.

### Settings
- **Users:** each user row gets a **Finance access** toggle (admin only). The invite form gets the same checkbox.
- **Billing entities** section (admin only): CRUD for entities, logo upload, sender email field.

## Send flow

1. The client renders the PDF from form data plus a provisional number obtained from an RPC `create_invoice(...)`. This RPC assigns the number and inserts the row with `sent_at = null`.
2. The client renders the final PDF with that number and uploads it to `invoices/<org_id>/<invoice_id>.pdf`.
3. The client calls the Edge Function `send-invoice(invoice_id)`. The function verifies the caller has finance access in that org, loads the PDF, sends via Brevo (to `billing_email`, cc CSM, from `invoice_sender_email`), then sets `sent_at`, `sent_by` and `sent_to`.
4. Re-send repeats step 3 with the stored PDF.

## Permissions (RLS-enforced)

- `invoices`, `billing_entities`: SELECT for any member of the org. INSERT and status UPDATE only where the caller's profile has `finance = true` or `role = 'admin'`. No DELETE.
- Storage bucket `invoices`: read for org members, write for finance/admin, path prefixed by `org_id`.
- `billing_entities` write: admin only.
- `profiles.finance` can be changed by admins only. Any SECURITY DEFINER function (e.g. `create_invoice`) must check membership and finance access explicitly, because definer functions bypass RLS.
- Disabled users lose all access, as today.

## Error handling

- **Upload or send fails after numbering:** the invoice stays with `sent_at = null` and shows as **Unsent** with a Retry action. Its number is kept, so no gap is created unless Finance discards it. Discarding an unsent invoice marks it `waived` with reason "Discarded before sending", which keeps the number series auditable.
- **Brevo error:** surface the message in a toast and in the error log.
- **Missing entity or billing email on the account:** the New invoice form blocks with a link to fix the account.

## Testing

- Unit tests (node:test, `src/lib`): tax for every entity/customer combination, totals and rounding, number formatting.
- RLS tests with real authenticated sessions (not the anon key): non-finance user cannot insert or mark paid, other org cannot read, finance can, a revoked finance toggle takes effect.
- E2E: create invoice → send (Brevo mocked) → appears in the account tab and Finance page → mark paid → waive another → Dashboard card totals per currency.
- Edge Function test: rejects callers without finance access.

## Out of scope (v1)

Billing runs and recurring invoices, partial payments, payment gateways, automatic reminders, credit notes, multi-currency conversion, per-entity sender addresses.
