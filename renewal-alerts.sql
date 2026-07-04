-- ============================================================
-- CS CRM — daily renewal email alerts
-- Sends every team member a digest of accounts renewing within
-- 30 days, once per day (only when something is due).
--
-- BEFORE RUNNING:
--   1. Create a free account at https://www.brevo.com
--   2. Brevo -> Senders & Domains -> Senders -> verify the email
--      address you want alerts to come FROM (your own is fine)
--   3. Brevo -> SMTP & API -> API Keys -> Generate a new API key
--   4. Paste the key and sender below (two lines marked EDIT ME)
--   5. Run this whole file in Supabase SQL Editor
--
-- Change the schedule at the bottom (default 09:00 IST daily).
-- Test immediately with:  select public.send_renewal_alerts();
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- private config table: RLS on, no policies = app users can never read the key
create table if not exists public.alert_config (
  id int primary key check (id = 1),
  api_key text not null,
  from_email text not null,
  from_name text not null default 'CS CRM'
);
alter table public.alert_config enable row level security;

insert into public.alert_config (id, api_key, from_email, from_name)
values (
  1,
  'PASTE_YOUR_BREVO_API_KEY',        -- EDIT ME
  'you@example.com',                 -- EDIT ME (verified Brevo sender)
  'CS CRM'
)
on conflict (id) do update
  set api_key = excluded.api_key, from_email = excluded.from_email, from_name = excluded.from_name;

create or replace function public.send_renewal_alerts()
returns text language plpgsql security definer set search_path = public as $$
declare
  cfg alert_config;
  rows_html text;
  due_count int;
  recipients jsonb;
begin
  select * into cfg from alert_config where id = 1;
  if cfg is null or cfg.api_key like 'PASTE%' then
    return 'alert_config not set — edit renewal-alerts.sql and run it again';
  end if;

  select
    string_agg(
      format('<tr><td style="padding:6px 12px;border-bottom:1px solid #eee"><b>%s</b></td>'
          || '<td style="padding:6px 12px;border-bottom:1px solid #eee">%s</td>'
          || '<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;color:%s"><b>%s day(s)</b></td></tr>',
        a.data->>'name',
        to_char((a.data->>'renewalDate')::date, 'DD Mon YYYY'),
        case when (a.data->>'renewalDate')::date - current_date <= 7 then '#e11d48' else '#d97706' end,
        (a.data->>'renewalDate')::date - current_date)
      , '' order by (a.data->>'renewalDate')::date),
    count(*)
  into rows_html, due_count
  from accounts a
  where (a.data->>'renewalDate')::date between current_date and current_date + 30;

  if due_count = 0 then
    return 'no renewals due within 30 days — no email sent';
  end if;

  select jsonb_agg(jsonb_build_object('email', u.email))
  into recipients
  from auth.users u
  where u.email is not null;

  if recipients is null then
    return 'no users to notify';
  end if;

  perform net.http_post(
    url := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object('api-key', cfg.api_key, 'content-type', 'application/json'),
    body := jsonb_build_object(
      'sender', jsonb_build_object('email', cfg.from_email, 'name', cfg.from_name),
      'to', recipients,
      'subject', format('[CS CRM] %s renewal(s) due within 30 days', due_count),
      'htmlContent',
        '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px">'
        || format('<h2 style="color:#4f46e5">%s renewal(s) due within 30 days</h2>', due_count)
        || '<table style="border-collapse:collapse;width:100%">'
        || '<tr><th style="text-align:left;padding:6px 12px">Account</th><th style="text-align:left;padding:6px 12px">Renewal date</th><th style="text-align:right;padding:6px 12px">Due in</th></tr>'
        || rows_html
        || '</table><p style="color:#94a3b8;font-size:12px;margin-top:16px">Sent daily by your CS CRM. Open the CRM for details and quick actions.</p></div>'
    )
  );
  return format('email queued to %s recipient(s), %s renewal(s) listed', jsonb_array_length(recipients), due_count);
end $$;

-- lock the function down: only the scheduler (postgres) should call it, not app users
revoke execute on function public.send_renewal_alerts() from public, anon, authenticated;

-- schedule: 03:30 UTC = 09:00 IST daily (edit the cron expression to taste)
select cron.unschedule('crm-renewal-alerts')
  where exists (select 1 from cron.job where jobname = 'crm-renewal-alerts');
select cron.schedule('crm-renewal-alerts', '30 3 * * *', 'select public.send_renewal_alerts()');

-- run once right now to test (result text tells you what happened):
select public.send_renewal_alerts();
