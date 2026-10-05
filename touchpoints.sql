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

-- ---------- matching ----------
-- Accounts in p_org whose contacts share a domain with p_addrs. One id = matched (or
-- narrowed to one by an exact contact address -- the parent/subsidiary case); several =
-- still ambiguous; none = no match. The caller tells them apart by cardinality.
-- Churned accounts never match: mail with a former customer is not a touchpoint to score.
create or replace function public.tp_match(p_org uuid, p_addrs text[], p_exclude text[])
returns text[] language plpgsql stable security definer set search_path = public as $$
declare v_domains text[]; v_all text[]; v_exact text[];
begin
  select coalesce(array_agg(distinct d), '{}') into v_domains
  from (select public.tp_domain(a) as d from unnest(coalesce(p_addrs, '{}')) a) s
  where d is not null
    and not (d = any(coalesce(p_exclude, '{}')))
    and not public.tp_generic(d);
  if cardinality(v_domains) = 0 then return '{}'; end if;

  select coalesce(array_agg(distinct a.id order by a.id), '{}') into v_all
  from contacts c
  join accounts a on a.org_id = c.org_id and a.id = c.data->>'accountId'
  where c.org_id = p_org
    and coalesce(a.data->>'contractStatus', '') <> 'Churned'
    and public.tp_domain(c.data->>'email') = any(v_domains);
  if cardinality(v_all) <= 1 then return v_all; end if;

  select coalesce(array_agg(distinct a.id order by a.id), '{}') into v_exact
  from contacts c
  join accounts a on a.org_id = c.org_id and a.id = c.data->>'accountId'
  where c.org_id = p_org
    and a.id = any(v_all)
    and public.tp_addr(c.data->>'email') = any(p_addrs);
  return case when cardinality(v_exact) = 1 then v_exact else v_all end;
end $$;

revoke execute on function public.tp_match(uuid, text[], text[]) from public, anon, authenticated;
