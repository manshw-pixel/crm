-- finance.sql -- invoicing. Run AFTER supabase-setup.sql, email-alerts.sql, touchpoints.sql.
-- Re-runnable. Creates no extensions (the RLS harness applies this file).
-- See docs/superpowers/specs/2026-10-12-finance-invoicing-design.md

-- profiles.finance and admin_user_list v2 live in supabase-setup.sql.
-- Only an org admin may change the flag. profiles_update_admin already limits updates to
-- admins; this trigger makes the rule explicit for the finance column too.
create or replace function public.guard_profile_finance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.finance is distinct from old.finance and not public.is_admin() then
    raise exception 'Only an admin can change finance access';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile_finance on public.profiles;
create trigger guard_profile_finance before update of finance on public.profiles
  for each row execute function public.guard_profile_finance();

create or replace function public.is_finance()
returns boolean language sql stable security definer set search_path = public as
$$ select public.is_active() and exists (select 1 from profiles where id = auth.uid()
          and not disabled and (finance or role = 'admin')) $$;

create table if not exists public.billing_entities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org() references public.orgs(id) on delete cascade,
  name text not null,
  country text not null check (country in ('IN','US','PH')),
  address text not null default '',
  state text not null default '',
  tax_id text not null default '',
  tax_id_label text not null default '',
  currency text not null check (currency in ('INR','USD','PHP')),
  bank_details text not null default '',
  logo_path text,
  invoice_prefix text not null,
  next_number int not null default 1 check (next_number > 0),
  default_tax_pct numeric(5,2) not null default 0 check (default_tax_pct between 0 and 100),
  lut_number text,
  created_at timestamptz not null default now()
);
alter table public.billing_entities enable row level security;
drop policy if exists billing_entities_select on public.billing_entities;
create policy billing_entities_select on public.billing_entities for select to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org()));
drop policy if exists billing_entities_write on public.billing_entities;
create policy billing_entities_write on public.billing_entities for all to authenticated
  using ((select public.is_admin()) and org_id = (select public.current_org()))
  with check ((select public.is_admin()) and org_id = (select public.current_org()));

create table if not exists public.billing_settings (
  org_id uuid primary key default public.current_org() references public.orgs(id) on delete cascade,
  sender_email text not null default 'support@onevio.in',
  sender_name text not null default 'OneVio Billing'
);
alter table public.billing_settings enable row level security;
drop policy if exists billing_settings_select on public.billing_settings;
create policy billing_settings_select on public.billing_settings for select to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org()));
drop policy if exists billing_settings_write on public.billing_settings;
create policy billing_settings_write on public.billing_settings for all to authenticated
  using ((select public.is_admin()) and org_id = (select public.current_org()))
  with check ((select public.is_admin()) and org_id = (select public.current_org()));
insert into public.billing_settings (org_id) select id from public.orgs on conflict (org_id) do nothing;

-- ---------- purchase orders ----------
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org() references public.orgs(id) on delete cascade,
  account_id text not null,
  account_name text not null,
  po_number text not null check (trim(po_number) <> ''),
  po_date date not null,
  po_value numeric(14,2) not null check (po_value > 0),
  currency text not null check (currency in ('INR','USD','PHP')),
  years int not null check (years between 1 and 10),
  billing_cycle text not null check (billing_cycle in ('quarterly','half_yearly','annual')),
  billing_start date not null,
  file_path text not null,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','cancelled')),
  submitted_by uuid not null default auth.uid(),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid, reviewed_at timestamptz, reject_reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists purchase_orders_live_number
  on public.purchase_orders (org_id, account_id, lower(trim(po_number))) where status <> 'cancelled';
alter table public.purchase_orders enable row level security;
drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org())
         and (not (select public.lead_restricted()) or public.lead_owns(org_id, account_id)));
drop policy if exists purchase_orders_insert on public.purchase_orders;
create policy purchase_orders_insert on public.purchase_orders for insert to authenticated
  with check ((select public.is_active()) and org_id = (select public.current_org()) and status = 'submitted'
              and submitted_by = auth.uid() and reviewed_by is null
              and (select public.impl_role()) is null   -- implementation roles are read-only
              and (not (select public.lead_restricted()) or public.lead_owns(org_id, account_id)));
-- Edit / resubmit: only while submitted or rejected, and the row must come out as 'submitted'
-- with the review fields cleared. Approve/reject/cancel are the definer RPCs below.
drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update on public.purchase_orders for update to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org()) and submitted_by = auth.uid()
         and status in ('submitted','rejected')
         and (not (select public.lead_restricted()) or public.lead_owns(org_id, account_id)))
  with check ((select public.is_active()) and org_id = (select public.current_org()) and submitted_by = auth.uid()
              and status = 'submitted' and reviewed_by is null and reject_reason is null
              and (not (select public.lead_restricted()) or public.lead_owns(org_id, account_id)));

create table if not exists public.po_schedule (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  seq int not null,
  period_start date not null,
  period_end date not null,
  amount numeric(14,2) not null check (amount > 0),
  invoice_id uuid unique,
  unique (po_id, seq)
);
alter table public.po_schedule enable row level security;
drop policy if exists po_schedule_select on public.po_schedule;
create policy po_schedule_select on public.po_schedule for select to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org())
         and (not (select public.lead_restricted()) or exists (select 1 from purchase_orders po
              where po.id = po_schedule.po_id and public.lead_owns(po.org_id, po.account_id))));
-- no write policy: approve_po / cancel_po / create_invoice are the only writers.

-- SQL mirror of src/lib/invoice.js buildSchedule (anchor day kept, remainder on last).
-- The RLS tests pin both to the same fixtures; change them together.
create or replace function public.po_schedule_rows(p purchase_orders)
returns table(seq int, period_start date, period_end date, amount numeric)
language sql immutable as $$
  with k as (select case p.billing_cycle when 'quarterly' then 3 when 'half_yearly' then 6 else 12 end as step),
       n as (select p.years * 12 / step as cnt, step from k),
       c as (select (p.po_value * 100)::bigint as total, cnt, step from n)
  select i::int,
         (p.billing_start + make_interval(months => (i - 1) * step))::date,
         ((p.billing_start + make_interval(months => i * step))::date - 1),
         (case when i = cnt then total - (total / cnt) * (cnt - 1) else total / cnt end)::numeric / 100
    from c, generate_series(1, cnt) i
$$;
-- Postgres `date + interval 'n months'` clamps from the ORIGINAL date each time, which
-- matches the JS anchor-day rule (31 Jan + 3 months = 30 Apr, + 6 months = 31 Jul).

-- Best effort: a missing Brevo config or an unknown submitter address must NOT block the
-- approval itself, so this swallows its own errors into error_log, the same way
-- send_alerts guards per recipient. A missing billing_settings row (orgs created after this
-- file first ran) falls back to the column defaults rather than skipping the mail.
create or replace function public.notify_po_decision(po purchase_orders)
returns void language plpgsql security definer set search_path = public, auth as $$
declare cfg alert_config; bs billing_settings; addr text;
begin
  select * into cfg from alert_config where id = 1;
  select * into bs from billing_settings where org_id = po.org_id;
  select email into addr from auth.users where id = po.submitted_by;
  if cfg is null or cfg.api_key like 'PASTE%' or addr is null then return; end if;
  perform public.alert_post(cfg.api_base,
    jsonb_build_object('api-key', cfg.api_key, 'content-type', 'application/json', 'accept', 'application/json'),
    jsonb_build_object('sender', jsonb_build_object('email', coalesce(nullif(bs.sender_email, ''), 'support@onevio.in'),
                                                    'name', coalesce(nullif(bs.sender_name, ''), 'OneVio Billing')),
      'to', jsonb_build_array(jsonb_build_object('email', addr)),
      'subject', format('[OneVio] PO %s for %s was %s', po.po_number, po.account_name, po.status),
      'htmlContent', format('<p>PO <b>%s</b> for <b>%s</b> (%s %s) was <b>%s</b>.</p>%s',
         html_escape(po.po_number), html_escape(po.account_name), po.currency, to_char(po.po_value, 'FM999,999,999,990.00'), po.status,
         case when po.status = 'rejected' then format('<p>Reason: %s</p><p>Edit the PO on the account and resubmit.</p>', html_escape(po.reject_reason)) else '' end)));
exception when others then
  begin
    perform public.log_error_system('notify_po_decision', 'write_failed', sqlerrm, jsonb_build_object('po_id', po.id));
  exception when others then null;
  end;
end $$;
-- definer with no caller checks: close it to the API roles as well (same pattern as email-alerts.sql)
revoke execute on function public.notify_po_decision(purchase_orders) from public, anon, authenticated;

create or replace function public.approve_po(p_id uuid, p_amounts numeric[], p_confirm_mismatch boolean default false)
returns public.purchase_orders language plpgsql security definer set search_path = public as $$
declare po purchase_orders; cnt int;
begin
  if not public.is_finance() then raise exception 'finance access required'; end if;
  select * into po from purchase_orders where id = p_id and org_id = public.current_org() for update;
  if po is null then raise exception 'purchase order not found'; end if;
  if po.status <> 'submitted' then raise exception 'only a submitted PO can be approved'; end if;
  select count(*) into cnt from po_schedule_rows(po);
  if p_amounts is not null then
    if exists (select 1 from unnest(p_amounts) a where a <> round(a, 2)) then raise exception 'amounts must have at most 2 decimals'; end if;
    if coalesce(array_length(p_amounts, 1), 0) <> cnt then raise exception 'expected % amounts', cnt; end if;
    if exists (select 1 from unnest(p_amounts) a where a is null or a <= 0) then raise exception 'every amount must be above 0'; end if;
    if (select sum(a) from unnest(p_amounts) a) <> po.po_value and not p_confirm_mismatch then
      raise exception 'amounts do not add up to the PO value';
    end if;
  end if;
  insert into po_schedule (org_id, po_id, seq, period_start, period_end, amount)
  select po.org_id, po.id, r.seq, r.period_start, r.period_end, coalesce(p_amounts[r.seq], r.amount)
    from po_schedule_rows(po) r;
  update purchase_orders set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = null
   where id = po.id returning * into po;
  perform public.notify_po_decision(po);
  return po;
end $$;

create or replace function public.reject_po(p_id uuid, p_reason text)
returns public.purchase_orders language plpgsql security definer set search_path = public as $$
declare po purchase_orders;
begin
  if not public.is_finance() then raise exception 'finance access required'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reject reason required'; end if;
  update purchase_orders set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = trim(p_reason)
   where id = p_id and org_id = public.current_org() and status = 'submitted' returning * into po;
  if po is null then raise exception 'only a submitted PO can be rejected'; end if;
  perform public.notify_po_decision(po);
  return po;
end $$;

create or replace function public.cancel_po(p_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare po purchase_orders; removed int;
begin
  if not public.is_finance() then raise exception 'finance access required'; end if;
  update purchase_orders set status = 'cancelled', reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id and org_id = public.current_org() and status in ('submitted','approved') returning * into po;
  if po is null then raise exception 'PO not found or not cancellable'; end if;
  delete from po_schedule where po_id = po.id and invoice_id is null;
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke execute on function public.approve_po(uuid, numeric[], boolean) from public, anon;
revoke execute on function public.reject_po(uuid, text) from public, anon;
revoke execute on function public.cancel_po(uuid) from public, anon;
revoke execute on function public.po_schedule_rows(purchase_orders) from public, anon;
grant execute on function public.approve_po(uuid, numeric[], boolean) to authenticated;
grant execute on function public.reject_po(uuid, text) to authenticated;
grant execute on function public.cancel_po(uuid) to authenticated;
grant execute on function public.po_schedule_rows(purchase_orders) to authenticated;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org() references public.orgs(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id),
  schedule_id uuid not null unique references public.po_schedule(id),
  account_id text not null,
  account_name text not null,
  entity_id uuid not null references public.billing_entities(id),
  number text not null,
  issue_date date not null,
  due_date date not null,
  currency text not null,
  line_items jsonb not null default '[]',
  subtotal numeric(14,2) not null default 0,
  tax_lines jsonb not null default '[]',
  tax_note text,
  tax_exempt boolean not null default false,
  total numeric(14,2) not null,
  status text not null default 'pending' check (status in ('pending','paid','waived')),
  paid_date date,
  payment_ref text,
  waive_reason text,
  status_by uuid,
  status_at timestamptz,
  pdf_path text,
  sent_to text,
  sent_cc text,
  sent_at timestamptz,
  sent_by uuid,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint invoices_entity_number_key unique (entity_id, number),
  constraint invoices_paid_has_date check (status <> 'paid' or paid_date is not null),
  constraint invoices_waived_has_reason check (status <> 'waived' or coalesce(trim(waive_reason), '') <> '')
);
create index if not exists invoices_org_account on public.invoices (org_id, account_id);
alter table public.invoices enable row level security;
-- SELECT only. Every write goes through the definer RPCs below, so there is NO insert,
-- update or delete policy: amounts can never be edited after creation.
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org())
         and (not (select public.lead_restricted()) or public.lead_owns(org_id, account_id)));

create or replace function public.create_invoice(p jsonb)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare e billing_entities; n int; inv invoices; si po_schedule; po purchase_orders;
begin
  if not public.is_finance() then raise exception 'finance access required'; end if;
  -- An invoice exists only for an un-raised period of an APPROVED PO. Row-locking the
  -- schedule item makes a double click / two finance users unable to raise it twice.
  select * into si from po_schedule where id = (p->>'schedule_id')::uuid and org_id = public.current_org() for update;
  if si is null then raise exception 'schedule item not found'; end if;
  if si.invoice_id is not null then raise exception 'this period is already invoiced'; end if;
  select * into po from purchase_orders where id = si.po_id;
  if po.status <> 'approved' then raise exception 'PO is not approved'; end if;
  select * into e from billing_entities
   where id = (p->>'entity_id')::uuid and org_id = public.current_org() for update;
  if e is null then raise exception 'billing entity not found'; end if;
  if coalesce(trim(p->>'sent_to'), '') = '' then raise exception 'billing email required'; end if;
  if coalesce((p->>'total')::numeric, 0) <= 0 then raise exception 'total must be above 0'; end if;
  if e.currency <> po.currency then raise exception 'entity currency % does not match PO currency %', e.currency, po.currency; end if;
  n := e.next_number;
  update billing_entities set next_number = n + 1 where id = e.id;
  insert into invoices (org_id, po_id, schedule_id, account_id, account_name, entity_id, number, issue_date, due_date, currency,
                        line_items, subtotal, tax_lines, tax_note, tax_exempt, total, sent_to, sent_cc)
  values (e.org_id, po.id, si.id, po.account_id, po.account_name, e.id, e.invoice_prefix || lpad(n::text, 4, '0'),
          (p->>'issue_date')::date, (p->>'due_date')::date, e.currency,
          coalesce(p->'line_items', '[]'), coalesce((p->>'subtotal')::numeric, 0), coalesce(p->'tax_lines', '[]'),
          p->>'tax_note', coalesce((p->>'tax_exempt')::boolean, false), (p->>'total')::numeric, trim(p->>'sent_to'), nullif(trim(coalesce(p->>'sent_cc', '')), ''))
  returning * into inv;
  update po_schedule set invoice_id = inv.id where id = si.id;
  return inv;
end $$;

create or replace function public.set_invoice_status(p_id uuid, p_status text, p_paid_date date, p_ref text, p_reason text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  if not public.is_finance() then raise exception 'finance access required'; end if;
  if p_status not in ('pending','paid','waived') then raise exception 'bad status'; end if;
  if p_status = 'paid' and p_paid_date is null then raise exception 'paid date required'; end if;
  if p_status = 'waived' and coalesce(trim(p_reason), '') = '' then raise exception 'waive reason required'; end if;
  update invoices set status = p_status,
         paid_date    = case when p_status = 'paid' then p_paid_date end,
         payment_ref  = case when p_status = 'paid' then nullif(trim(coalesce(p_ref, '')), '') end,
         waive_reason = case when p_status = 'waived' then trim(p_reason) end,
         status_by = auth.uid(), status_at = now()
   where id = p_id and org_id = public.current_org()
   returning * into inv;
  if inv is null then raise exception 'invoice not found'; end if;
  return inv;
end $$;

create or replace function public.attach_invoice_pdf(p_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_finance() then raise exception 'finance access required'; end if;
  if split_part(p_path, '/', 1) <> public.current_org()::text then raise exception 'bad path'; end if;
  update invoices set pdf_path = p_path where id = p_id and org_id = public.current_org();
  if not found then raise exception 'invoice not found'; end if;
end $$;

revoke execute on function public.create_invoice(jsonb) from public, anon;
revoke execute on function public.set_invoice_status(uuid, text, date, text, text) from public, anon;
revoke execute on function public.attach_invoice_pdf(uuid, text) from public, anon;
revoke execute on function public.is_finance() from public, anon;
grant execute on function public.create_invoice(jsonb) to authenticated;
grant execute on function public.set_invoice_status(uuid, text, date, text, text) to authenticated;
grant execute on function public.attach_invoice_pdf(uuid, text) to authenticated;
grant execute on function public.is_finance() to authenticated;

-- ---------- send invoice ----------
-- alert_post is the same seam send_alerts uses (pg_net in production, a recorder in tests).
-- The send is asynchronous: a Brevo-side rejection (bad sender, quota) is visible only in
-- net._http_response, exactly as with alerts.
create or replace function public.send_invoice(p_id uuid, p_pdf_base64 text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare cfg alert_config; bs billing_settings; inv invoices; e billing_entities; po purchase_orders; req bigint;
begin
  if not public.is_finance() then raise exception 'finance access required'; end if;
  select * into cfg from alert_config where id = 1;
  select * into bs from billing_settings where org_id = public.current_org();
  if cfg is null or cfg.api_key like 'PASTE%' then
    raise exception 'email not configured: set the Brevo key (alert_config)';
  end if;
  select * into inv from invoices where id = p_id and org_id = public.current_org();
  if inv is null then raise exception 'invoice not found'; end if;
  if inv.status = 'waived' then raise exception 'invoice is waived'; end if;
  if coalesce(trim(inv.sent_to), '') = '' then raise exception 'no recipient'; end if;
  if coalesce(p_pdf_base64, '') = '' then raise exception 'pdf required'; end if;
  select * into e from billing_entities where id = inv.entity_id;
  select * into po from purchase_orders where id = inv.po_id;
  req := public.alert_post(cfg.api_base,
    jsonb_build_object('api-key', cfg.api_key, 'content-type', 'application/json', 'accept', 'application/json'),
    jsonb_strip_nulls(jsonb_build_object(
      'sender', jsonb_build_object('email', coalesce(nullif(bs.sender_email, ''), 'support@onevio.in'),
                                   'name', coalesce(nullif(bs.sender_name, ''), 'OneVio Billing')),
      'to', jsonb_build_array(jsonb_build_object('email', inv.sent_to)),
      'cc', case when inv.sent_cc is not null then jsonb_build_array(jsonb_build_object('email', inv.sent_cc)) end,
      'subject', format('Invoice %s (PO %s) from %s', inv.number, po.po_number, e.name),
      'htmlContent', format('<p>Dear %s,</p><p>Please find attached invoice <b>%s</b> against PO <b>%s</b> for %s %s, due on %s.</p><p>Regards,<br>%s</p>',
         html_escape(inv.account_name), html_escape(inv.number), html_escape(po.po_number), inv.currency, to_char(inv.total, 'FM999,999,999,990.00'),
         to_char(inv.due_date, 'DD Mon YYYY'), html_escape(e.name)),
      'attachment', jsonb_build_array(jsonb_build_object(
         'name', regexp_replace(inv.number, '[^A-Za-z0-9-]', '_', 'g') || '.pdf', 'content', p_pdf_base64)))));
  if req is null then raise exception 'send failed: no request id'; end if;
  update invoices set sent_at = now(), sent_by = auth.uid() where id = inv.id returning * into inv;
  return inv;
end $$;
revoke execute on function public.send_invoice(uuid, text) from public, anon;
grant execute on function public.send_invoice(uuid, text) to authenticated;

-- ---------- storage ----------
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false) on conflict (id) do nothing;
drop policy if exists invoices_read on storage.objects;
create policy invoices_read on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and (select public.is_active())
         and (storage.foldername(name))[1] = (select public.current_org())::text
         and (not (select public.lead_restricted()) or exists (select 1 from invoices i
              where i.org_id = (select public.current_org()) and i.pdf_path = name and public.lead_owns(i.org_id, i.account_id))));
drop policy if exists invoices_insert on storage.objects;
create policy invoices_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and (select public.is_finance())
         and (storage.foldername(name))[1] = (select public.current_org())::text);

insert into storage.buckets (id, name, public) values ('purchase-orders', 'purchase-orders', false) on conflict (id) do nothing;
drop policy if exists po_files_read on storage.objects;
create policy po_files_read on storage.objects for select to authenticated
  using (bucket_id = 'purchase-orders' and (select public.is_active())
         and (storage.foldername(name))[1] = (select public.current_org())::text
         and (not (select public.lead_restricted()) or public.lead_owns((select public.current_org()), (storage.foldername(name))[2])));
drop policy if exists po_files_insert on storage.objects;
create policy po_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'purchase-orders' and (select public.is_active())
         and (storage.foldername(name))[1] = (select public.current_org())::text
         and (not (select public.lead_restricted()) or public.lead_owns((select public.current_org()), (storage.foldername(name))[2])));
