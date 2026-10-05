-- Email touchpoint ingest: a CSM forwards a customer thread to the touchpoints inbox and it
-- is logged as an `email` activity on the matching account. Design:
-- docs/superpowers/specs/2026-10-05-email-touchpoint-ingest-design.md
--
-- Run AFTER supabase-setup.sql and email-alerts.sql: bounces reuse alert_config/alert_post.
-- Safe to re-run.

-- ---------- address helpers ----------
-- Lower-cased bare address from `"Name" <a@b>` or `a@b`. NULL for anything with no @, so a
-- caller can filter junk with `is not null` instead of re-validating.
create or replace function public.tp_addr(p text)
returns text language sql immutable as $$
  select case when x like '%_@_%' then x end
  from (select lower(trim(coalesce(substring(p from '<([^>]+)>'), p))) as x) s;
$$;

create or replace function public.tp_domain(p text)
returns text language sql immutable as $$
  select nullif(split_part(public.tp_addr(p), '@', 2), '');
$$;

-- Personal-mail domains never identify a customer. Without this one Gmail contact on any
-- account would claim every thread that Ccs anyone at Gmail.
create or replace function public.tp_generic(p_domain text)
returns boolean language sql immutable as $$
  select coalesce(p_domain = any(array['gmail.com','googlemail.com','outlook.com','hotmail.com',
    'live.com','yahoo.com','icloud.com','me.com','aol.com','proton.me','protonmail.com']), false);
$$;

-- Addresses in free text, for the body fallback. Address-shaped only: a bare "prohance.ai"
-- mention must never match. The domain must end in a 2+ letter label, which also keeps a
-- sentence's trailing full stop out of it ("mail jane@acme.com." -> jane@acme.com).
create or replace function public.tp_body_addrs(p text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct lower(m[1])), '{}')
  from regexp_matches(coalesce(p, ''),
    '([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})', 'g') as m;
$$;

-- Cut a reply at the first quoted-history marker. A FORWARD marker is deliberately not one:
-- when a CSM forwards a thread, the forwarded part is the customer content we want.
create or replace function public.tp_strip_quotes(p text)
returns text language plpgsql immutable as $$
declare
  lines text[] := regexp_split_to_array(replace(coalesce(p, ''), E'\r\n', E'\n'), E'\n');
  i int;
begin
  for i in 1 .. coalesce(array_length(lines, 1), 0) loop
    if lines[i] ~ '^\s*On .+ wrote:\s*$'
       or lines[i] ~* '^\s*-+\s*Original Message\s*-+'
       or lines[i] ~ '^\s*>' then
      return regexp_replace(array_to_string(lines[1:i-1], E'\n'), '\s+$', '');
    end if;
  end loop;
  return regexp_replace(array_to_string(lines, E'\n'), '\s+$', '');
end $$;

revoke execute on function public.tp_addr(text), public.tp_domain(text), public.tp_generic(text),
  public.tp_body_addrs(text), public.tp_strip_quotes(text) from public, anon, authenticated;
