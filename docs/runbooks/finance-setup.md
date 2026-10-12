# Finance invoicing — operator setup

1. Supabase SQL Editor: run `supabase-setup.sql` (adds `profiles.finance` + `admin_user_list` v2), then `finance.sql`.
   Order matters: `finance.sql` needs `email-alerts.sql`'s `alert_config` / `alert_post` / `html_escape`, which are already live.
2. In Brevo, confirm `support@onevio.in` is a verified sender (it is the default in `billing_settings`).
3. Supabase SQL: confirm `select id from storage.buckets where id in ('invoices','purchase-orders')` returns 2 rows.
4. In the app: Settings → Billing → add the three entities (India, US, Philippines) with prefix, tax ID, bank details;
   India: state + LUT number.
5. Settings → Users → switch on "finance" for the finance team.
6. Dry run: submit a test PO on an internal account → approve it → raise period 1 → send to an internal address. Then in SQL:
   `select status_code, content from net._http_response order by id desc limit 1;` — expect 201.
7. Later, to switch sender: Settings → Billing → sender = `billing@onevio.in` (verify it in Brevo first).

## Known limits (v1)
- PDF text uses Helvetica: `₹` prints as "Rs."; other non-Latin text (e.g. Hindi names) prints as "?". A Unicode font is a follow-up.
- The Finance invoice table is not virtualized.
