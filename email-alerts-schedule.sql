-- ============================================================
-- OneVio — email alert scheduling (pg_cron, pg_net)
-- ============================================================
-- Deliberately a SEPARATE file from email-alerts.sql. Run this one SECOND, after
-- email-alerts.sql, in the Supabase SQL Editor.
--
-- Why separate: tests/rls/fixtures.mjs applies email-alerts.sql on every test bootstrap.
-- `create extension pg_cron` requires pg_cron to be listed in shared_preload_libraries --
-- when it isn't (as in the test database), the statement aborts the whole schema reset
-- before a single RLS test runs, and the failure looks exactly like a policy bug rather
-- than a missing extension. Scheduling real cron jobs inside a test database, and this
-- file's trailing live `select public.send_alerts('renewals')`, would also just be wrong
-- to run on every test start. Keep the two files apart.
--
-- Safe to re-run (idempotent): extensions use IF NOT EXISTS, and every job is unscheduled
-- before being rescheduled.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- schedule ----------
-- 03:30 UTC = 09:00 IST. Times are UTC; edit to taste and re-run this file.
select cron.unschedule('crm-renewal-alerts')
  where exists (select 1 from cron.job where jobname = 'crm-renewal-alerts');

select cron.unschedule(j) from unnest(array[
  'onevio-alerts-daily','onevio-alerts-monday','onevio-alerts-settle']) j
 where exists (select 1 from cron.job where jobname = j);

select cron.schedule('onevio-alerts-daily', '30 3 * * *', $$
  select public.send_alerts('renewals');
  select public.send_alerts('overdue_tasks');
$$);

select cron.schedule('onevio-alerts-monday', '35 3 * * 1', $$
  select public.send_alerts('qbr_nudge');
$$);

-- Runs on the :10 of every hour. pg_net answers in seconds, but an hourly sweep also
-- catches the rows that never got an answer at all.
select cron.schedule('onevio-alerts-settle', '10 * * * *', $$
  select public.settle_alert_sends();
$$);

-- Fire once now to check the wiring. The result text says what happened.
select public.send_alerts('renewals');
