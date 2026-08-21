-- ============================================================
-- OneVio — internal email alerts
-- Per-CSM digests: renewals, overdue tasks, and a Monday MBR/QBR nudge.
-- Supersedes renewal-alerts.sql (unschedule that job -- see the end of this file).
--
-- Extensions (pg_cron, pg_net) and the cron schedule live in email-alerts-schedule.sql,
-- NOT here. This file is re-run on every test bootstrap (see tests/rls/fixtures.mjs), and
-- pg_cron requires being listed in shared_preload_libraries -- when it isn't, `create
-- extension pg_cron` aborts the whole reset before a single RLS test runs, and the failure
-- looks like a policy bug rather than a missing extension. Scheduling real cron jobs inside
-- a test database would also just be wrong. Do not merge the two files back together.
--
-- BEFORE RUNNING (this file):
--   1. Create a free account at https://www.brevo.com
--   2. Brevo -> Senders & Domains -> Senders -> verify the FROM address
--   3. Brevo -> SMTP & API -> API Keys -> generate a key
--   4. Paste the key and sender into the two EDIT ME lines below
--   5. Run this whole file in the Supabase SQL Editor -- NOT in the repo copy,
--      so the real key is never committed.
--
-- Safe to re-run (idempotent).
-- See docs/superpowers/specs/2026-08-21-email-alerts-design.md
-- ============================================================

-- ---------- config ----------
-- RLS on with NO policies: app users can never read the API key.
create table if not exists public.alert_config (
  id int primary key check (id = 1),
  api_key text not null,
  from_email text not null,
  from_name text not null default 'OneVio'
);
alter table public.alert_config enable row level security;

alter table public.alert_config
  add column if not exists enabled_kinds text[] not null
    default array['renewals','overdue_tasks','qbr_nudge'],
  add column if not exists health_drop_points int not null default 10,
  add column if not exists health_drop_window_days int not null default 7,
  add column if not exists api_base text not null
    default 'https://api.brevo.com/v3/smtp/email';

insert into public.alert_config (id, api_key, from_email, from_name)
values (1,
  'PASTE_YOUR_BREVO_API_KEY',   -- EDIT ME
  'you@example.com',            -- EDIT ME (verified Brevo sender)
  'OneVio')
on conflict (id) do nothing;    -- do NOT clobber a key already pasted in production

-- ---------- send log ----------
-- Mirrors error_log's policy shape. Stores WHO was mailed and HOW MANY rows -- never
-- account names, ARR figures or row contents. This app's subject matter is customer
-- revenue and copying it into a table with different access rules would be a privacy
-- regression dressed up as an audit trail.
create table if not exists public.email_log (
  id          bigserial primary key,
  kind        text not null,
  recipient   text not null,
  day         date not null default current_date,
  row_count   int  not null,
  request_id  bigint,
  status      text not null default 'queued'
              check (status in ('queued','sent','failed','unknown')),
  http_status int,
  response    text,
  created_at  timestamptz not null default now(),
  settled_at  timestamptz,
  -- Idempotency: a cron double-fire or a manual re-run cannot double-send.
  unique (kind, recipient, day)
);

alter table public.email_log enable row level security;

drop policy if exists email_log_select on public.email_log;
create policy email_log_select on public.email_log
  for select to authenticated using (public.is_admin());

-- NO insert/update/delete policy: the dispatcher (security definer) owns every write.

-- ---------- recipients ----------
-- profiles has no email column; addresses live in auth.users, which the browser cannot
-- read. Definer rights are what make this join possible at all.
create or replace function public.alert_recipients()
returns table(profile_id uuid, person text, email text, admin boolean)
language sql security definer set search_path = public, auth as $$
  select p.id, p.name, u.email::text, (p.role = 'admin')
  from profiles p
  join auth.users u on u.id = p.id
  where u.email is not null;
$$;

-- Accounts whose `csm` matches no profile name, or is blank. account.csm is FREE TEXT
-- matched by string equality against profiles.name, so a rename or a typo silently
-- produces a book that emails nobody. Returning them makes that visible: the dispatcher
-- puts them in the admin digest and fingerprints them into error_log.
create or replace function public.unrouted_csms()
returns table(csm text, accounts int)
language sql security definer set search_path = public as $$
  select coalesce(nullif(trim(a.data->>'csm'), ''), '(unassigned)') as csm,
         count(*)::int
  from accounts a
  where coalesce(a.data->>'contractStatus', '') <> 'Churned'
    and not exists (
      select 1 from profiles p
      where p.name = trim(a.data->>'csm')
    )
  group by 1;
$$;

revoke execute on function public.alert_recipients() from public;
revoke execute on function public.unrouted_csms()   from public;

-- ---------- builders ----------
-- Builders are PURE: they return rows, write nothing and call nothing over the network.
-- That is what lets the suite prove the logic without sending a single email.

create or replace function public.alert_renewals(
  p_csm text, p_include_unowned boolean default false)
returns table(account_id text, account_name text, renewal_date date, days_left int)
language sql security definer set search_path = public as $$
  select a.id,
         a.data->>'name',
         (a.data->>'renewalDate')::date,
         ((a.data->>'renewalDate')::date - current_date)::int
  from accounts a
  where coalesce(a.data->>'contractStatus', '') <> 'Churned'
    and nullif(a.data->>'renewalDate', '') is not null
    and (case when nullif(a.data->>'renewalDate', '') is not null
              then (a.data->>'renewalDate')::date end)
        between current_date and current_date + 30
    and ( trim(a.data->>'csm') = p_csm
          or (p_include_unowned and not exists (
                select 1 from profiles p where p.name = trim(a.data->>'csm'))) )
  order by 3 asc;
$$;

revoke execute on function public.alert_renewals(text, boolean) from public;

-- Tasks carry no assignee of their own, so ownership is inherited from the account.
create or replace function public.alert_overdue_tasks(
  p_csm text, p_include_unowned boolean default false)
returns table(task_id text, title text, due_date date, days_overdue int,
              account_id text, account_name text)
language sql security definer set search_path = public as $$
  select t.id,
         t.data->>'title',
         (t.data->>'due')::date,
         (current_date - (t.data->>'due')::date)::int,
         a.id,
         a.data->>'name'
  from tasks t
  join accounts a on a.id = t.data->>'accountId'
  where coalesce(t.data->>'status', '') <> 'Done'
    and nullif(t.data->>'due', '') is not null
    and (case when nullif(t.data->>'due', '') is not null
              then (t.data->>'due')::date end) < current_date
    and coalesce(a.data->>'contractStatus', '') <> 'Churned'
    and ( trim(a.data->>'csm') = p_csm
          or (p_include_unowned and not exists (
                select 1 from profiles p where p.name = trim(a.data->>'csm'))) )
  order by 3 asc;
$$;

revoke execute on function public.alert_overdue_tasks(text, boolean) from public;

-- Two sections in one email. The 'unlogged' half is an INFERENCE, not a fact: a past QBR
-- date with no QBR activity near it usually means the meeting happened and was never
-- written down, but it can equally mean the meeting slipped. The rendered email must say
-- so in those words -- phrased as an accusation it will be resented, and rightly.
create or replace function public.alert_qbr_nudge(
  p_csm text, p_include_unowned boolean default false)
returns table(account_id text, account_name text, next_qbr date, days_left int, section text)
language sql security definer set search_path = public as $$
  with mine as (
    select a.id, a.data->>'name' as nm, (a.data->>'nextQbrDate')::date as nq
    from accounts a
    where coalesce(a.data->>'contractStatus', '') <> 'Churned'
      and coalesce(a.data->>'qbrFrequency', 'None') <> 'None'
      and nullif(a.data->>'nextQbrDate', '') is not null
      and ( trim(a.data->>'csm') = p_csm
            or (p_include_unowned and not exists (
                  select 1 from profiles p where p.name = trim(a.data->>'csm'))) )
  )
  select id, nm, nq, (nq - current_date)::int, 'due'
  from mine
  where nq <= current_date + 14
  union all
  select m.id, m.nm, m.nq, (m.nq - current_date)::int, 'unlogged'
  from mine m
  where m.nq < current_date
    and not exists (
      select 1 from activities v
      where v.data->>'accountId' = m.id
        and v.data->>'type' = 'QBR'
        and nullif(v.data->>'date', '') is not null
        and (v.data->>'date')::date between m.nq - 14 and m.nq + 14
    )
  order by 3 asc;
$$;

revoke execute on function public.alert_qbr_nudge(text, boolean) from public;

-- ---------- the network seam ----------
-- The ONLY place this system talks to the outside world. It exists as its own function so
-- the test suite can `create or replace` it with a recorder: pg_net lives inside the
-- Supabase container and reaching a host process from there is platform-specific and
-- flaky, whereas swapping one function is neither.
--
-- It returns the pg_net request id. renewal-alerts.sql called net.http_post through
-- `perform` and THREW THAT ID AWAY, then reported success -- which is why a revoked key,
-- an unverified sender and a blown quota were all indistinguishable from a delivered
-- email. Never discard this value.
--
-- language plpgsql, NOT sql: a `language sql` body is validated against pg_net at CREATE
-- TIME, and pg_net is deliberately not installed in the test database (the extensions
-- live in email-alerts-schedule.sql, which the test harness never applies, because
-- `create extension pg_cron` would abort the whole schema reset). plpgsql defers name
-- resolution to run time, so this creates cleanly with no extension installed, and the
-- test suite's recorder (which replaces this function wholesale) never needs pg_net
-- either. Do not "simplify" this back to `language sql` -- it will fail to create and
-- every RLS test in this file will go red.
create or replace function public.alert_post(p_url text, p_headers jsonb, p_body jsonb)
returns bigint language plpgsql as $$
begin
  return net.http_post(url := p_url, headers := p_headers, body := p_body);
end $$;

create or replace function public.send_alerts(p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare
  cfg        alert_config;
  r          record;
  rows_html  text;
  n_rows     int;
  n_sent     int := 0;
  req        bigint;
  subject    text;
  unrouted   text;
begin
  select * into cfg from alert_config where id = 1;
  if cfg is null or cfg.api_key like 'PASTE%' then
    return 'alert_config not set — edit email-alerts.sql and run it again';
  end if;
  if not (p_kind = any(cfg.enabled_kinds)) then
    return format('%s is disabled in alert_config.enabled_kinds', p_kind);
  end if;

  -- Unmatched CSM names, rendered into the admin digest so the failure is visible to a
  -- human rather than only to whoever thinks to read a table.
  select string_agg(format('<li>%s — %s account(s)</li>', csm, accounts), '')
    into unrouted from unrouted_csms();

  for r in select * from alert_recipients() loop
    if p_kind = 'renewals' then
      select count(*), string_agg(format(
        '<tr><td style="padding:6px 12px;border-bottom:1px solid #eee"><b>%s</b></td>'
        || '<td style="padding:6px 12px;border-bottom:1px solid #eee">%s</td>'
        || '<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;color:%s"><b>%s day(s)</b></td></tr>',
        account_name, to_char(renewal_date, 'DD Mon YYYY'),
        case when days_left <= 7 then '#e11d48' else '#d97706' end, days_left), '')
        into n_rows, rows_html
        from alert_renewals(r.person, r.admin);
      subject := format('[OneVio] %s renewal(s) due within 30 days', n_rows);

    elsif p_kind = 'overdue_tasks' then
      select count(*), string_agg(format(
        '<tr><td style="padding:6px 12px;border-bottom:1px solid #eee"><b>%s</b></td>'
        || '<td style="padding:6px 12px;border-bottom:1px solid #eee">%s</td>'
        || '<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;color:#e11d48"><b>%s day(s)</b></td></tr>',
        account_name, title, days_overdue), '')
        into n_rows, rows_html
        from alert_overdue_tasks(r.person, r.admin);
      subject := format('[OneVio] %s overdue task(s)', n_rows);

    elsif p_kind = 'qbr_nudge' then
      -- alert_qbr_nudge can legitimately return the SAME account twice, once per
      -- `section` ('due' and 'unlogged') -- a past-due unlogged review satisfies both.
      -- The section label is rendered into every row so the reader sees two clearly
      -- distinct, labelled lines rather than what looks like a duplicate.
      select count(*), string_agg(format(
        '<tr><td style="padding:6px 12px;border-bottom:1px solid #eee"><b>%s</b></td>'
        || '<td style="padding:6px 12px;border-bottom:1px solid #eee">%s</td>'
        || '<td style="padding:6px 12px;border-bottom:1px solid #eee">%s</td></tr>',
        account_name, to_char(next_qbr, 'DD Mon YYYY'),
        case when section = 'due' then 'due to be scheduled'
             else 'may have happened without being logged' end), '')
        into n_rows, rows_html
        from alert_qbr_nudge(r.person, r.admin);
      subject := format('[OneVio] %s account(s) need a review scheduled or logged', n_rows);

    else
      return format('unknown alert kind: %s', p_kind);
    end if;

    -- A digest with nothing in it is not sent. This is what keeps a daily email from
    -- becoming something people filter to a folder.
    continue when coalesce(n_rows, 0) = 0;

    -- Idempotency: the unique (kind, recipient, day) constraint means a cron double-fire
    -- or a manual re-run takes this branch and sends nothing. Claim the slot BEFORE
    -- posting, so a crash between the two cannot produce a second email.
    begin
      insert into email_log (kind, recipient, row_count) values (p_kind, r.email, n_rows);
    exception when unique_violation then
      continue;
    end;

    req := alert_post(
      cfg.api_base,
      jsonb_build_object('api-key', cfg.api_key, 'content-type', 'application/json'),
      jsonb_build_object(
        'sender', jsonb_build_object('email', cfg.from_email, 'name', cfg.from_name),
        'to', jsonb_build_array(jsonb_build_object('email', r.email, 'name', r.person)),
        'subject', subject,
        'htmlContent',
          '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:620px">'
          || format('<h2 style="color:#4f46e5">%s</h2>', subject)
          || '<table style="border-collapse:collapse;width:100%">' || rows_html || '</table>'
          || case when p_kind = 'qbr_nudge' then
               '<p style="color:#64748b;font-size:12px;margin-top:12px">Rows marked '
               || '&ldquo;may have happened without being logged&rdquo; are a guess, not a '
               || 'record: the review date has passed and no QBR activity was logged near '
               || 'it. If the meeting did not happen, reschedule it instead.</p>'
             else '' end
          || case when r.admin and unrouted is not null then
               '<p style="color:#b45309;font-size:12px;margin-top:16px"><b>Accounts nobody '
               || 'is receiving alerts for</b> — the CSM name on these matches no user:</p>'
               || format('<ul style="color:#b45309;font-size:12px">%s</ul>', unrouted)
             else '' end
          || '<p style="color:#94a3b8;font-size:12px;margin-top:16px">Sent by OneVio. '
          || 'Open the CRM for details and quick actions.</p></div>'
      ));

    update email_log set request_id = req
     where kind = p_kind and recipient = r.email and day = current_date;
    n_sent := n_sent + 1;
  end loop;

  return format('%s: %s recipient(s) mailed', p_kind, n_sent);
end $$;

revoke execute on function public.alert_post(text, jsonb, jsonb) from public;
revoke execute on function public.send_alerts(text) from public;
