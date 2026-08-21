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
