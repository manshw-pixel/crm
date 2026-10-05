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

-- ---------- config + log ----------
-- The provider shim holds the anon key plus this secret. RLS on with no policies: only
-- definer code reads it. Set it with:
--   update public.touchpoint_config set secret = '<long random string>' where id = 1;
create table if not exists public.touchpoint_config (
  id            int primary key default 1 check (id = 1),
  secret        text not null default 'CHANGE-ME',
  inbox_address text not null default 'touchpoints@onevio.com'
);
alter table public.touchpoint_config enable row level security;
revoke all on public.touchpoint_config from anon, authenticated;
insert into public.touchpoint_config (id) values (1) on conflict (id) do nothing;

-- One row per received message. message_id is the idempotency key: providers retry on any
-- non-2xx, and without it a retry would log the activity (or bounce) twice.
-- No subject, no body -- like email_log, this table has different access rules from the CRM
-- data. A rejected stranger's row keeps only their DOMAIN.
create table if not exists public.ingest_log (
  message_id    text primary key,
  org_id        uuid null references public.orgs(id) on delete cascade,
  sender        text not null,
  received_at   timestamptz not null default now(),
  verdict       text not null check (verdict in
                  ('logged','no_match','ambiguous','malformed','rejected_sender','duplicate')),
  account_id    text null,
  bounce_failed boolean not null default false
);
alter table public.ingest_log enable row level security;
revoke insert, update, delete, truncate on public.ingest_log from anon, authenticated;

-- ---------- bounce ----------
-- Reuses the alert sender and the alert_post seam, so tests capture it and nothing new needs
-- credentials. Returns false rather than raising: a failed bounce must not fail the ingest,
-- or the provider would retry and the retry would be a duplicate anyway.
-- Note: pg_net is asynchronous, so `true` means "queued", not "delivered".
create or replace function public.tp_bounce(p_to text, p_subject text, p_text text)
returns boolean language plpgsql security definer set search_path = public as $$
declare cfg alert_config;
begin
  select * into cfg from alert_config where id = 1;
  if cfg is null or cfg.api_key like 'PASTE%' or cfg.from_email = 'you@example.com' then
    return false;
  end if;
  perform alert_post(cfg.api_base,
    jsonb_build_object('api-key', cfg.api_key, 'content-type', 'application/json'),
    jsonb_build_object(
      'sender', jsonb_build_object('email', cfg.from_email, 'name', cfg.from_name),
      'to', jsonb_build_array(jsonb_build_object('email', p_to)),
      'subject', p_subject,
      'textContent', p_text));
  return true;
exception when others then
  return false;
end $$;

-- ---------- entry point ----------
create or replace function public.ingest_touchpoint(p_secret text, p_message jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  cfg       touchpoint_config;
  v_mid     text := nullif(trim(p_message->>'message_id'), '');
  v_from    text := public.tp_addr(p_message->>'from');
  v_subject text := btrim(coalesce(p_message->>'subject', ''));
  v_body    text := public.tp_strip_quotes(p_message->>'text');
  v_h       jsonb := coalesce(p_message->'headers', '{}');
  v_sender  record;
  v_addrs   text[];
  v_excl    text[];
  v_ids     text[] := '{}';
  v_verdict text;
  v_claimed text;
  v_date    date;
  v_names   text;
  v_reason  text;
begin
  select * into cfg from touchpoint_config where id = 1;
  if cfg is null or cfg.secret = 'CHANGE-ME' or p_secret is distinct from cfg.secret then
    return jsonb_build_object('ok', false);
  end if;
  if v_mid is null or v_from is null then
    return jsonb_build_object('ok', false, 'error', 'message_id and from are required');
  end if;
  if exists (select 1 from ingest_log where message_id = v_mid) then
    return jsonb_build_object('ok', true, 'verdict', 'duplicate');
  end if;

  -- Only an active CSM in an active org may file. Everyone else is dropped WITHOUT a reply:
  -- bouncing to strangers would turn this inbox into a spam relay.
  select p.id, p.name, p.org_id into v_sender
  from auth.users u
  join profiles p on p.id = u.id
  join orgs o on o.id = p.org_id
  where lower(u.email) = v_from and not p.disabled and not o.disabled;
  if not found then
    insert into ingest_log (message_id, org_id, sender, verdict)
    values (v_mid, null, split_part(v_from, '@', 2), 'rejected_sender')
    on conflict (message_id) do nothing;
    return jsonb_build_object('ok', true, 'verdict', 'rejected_sender');
  end if;

  v_addrs := array(
    select distinct public.tp_addr(x) from (
      select p_message->>'from' as x
      union all select jsonb_array_elements_text(coalesce(p_message->'to', '[]'))
      union all select jsonb_array_elements_text(coalesce(p_message->'cc', '[]'))) s
    where public.tp_addr(x) is not null);
  -- The sender's own domain (colleagues on Cc) and the inbox's never identify a customer.
  v_excl := array[split_part(v_from, '@', 2), split_part(lower(cfg.inbox_address), '@', 2)];

  if v_subject = '' and btrim(v_body) = '' then
    v_verdict := 'malformed';
  else
    v_ids := public.tp_match(v_sender.org_id, v_addrs, v_excl);
    if cardinality(v_ids) = 0 then
      -- Fallback on the ORIGINAL text: stripped quote history can still name the customer.
      v_ids := public.tp_match(v_sender.org_id, public.tp_body_addrs(p_message->>'text'), v_excl);
    end if;
    v_verdict := case cardinality(v_ids) when 0 then 'no_match' when 1 then 'logged' else 'ambiguous' end;
  end if;

  -- Claim the message before any side effect, so a concurrent retry cannot double-write.
  insert into ingest_log (message_id, org_id, sender, verdict, account_id)
  values (v_mid, v_sender.org_id, v_from, v_verdict, case when v_verdict = 'logged' then v_ids[1] end)
  on conflict (message_id) do nothing
  returning message_id into v_claimed;
  if v_claimed is null then
    return jsonb_build_object('ok', true, 'verdict', 'duplicate');
  end if;

  if v_verdict = 'logged' then
    begin
      v_date := (p_message->>'date')::timestamptz::date;
    exception when others then
      v_date := null;
    end;
    insert into activities (org_id, id, data)
    values (v_sender.org_id, 'em-' || md5(v_mid), jsonb_build_object(
      'type', 'email',
      'date', to_char(coalesce(v_date, current_date), 'YYYY-MM-DD'),
      'accountId', v_ids[1],
      'loggedBy', v_sender.name,
      'summary', left(coalesce(nullif(v_subject, ''), '(no subject)'), 200),
      'details', left(v_body, 4000),
      'source', 'email',
      'participants', to_jsonb(array(
        select a from unnest(v_addrs) a where split_part(a, '@', 2) <> all(v_excl) order by a))))
    on conflict (org_id, id) do nothing;
    return jsonb_build_object('ok', true, 'verdict', 'logged', 'account_id', v_ids[1]);
  end if;

  -- Never answer an auto-reply: two robots bouncing at each other is a mail loop.
  if lower(coalesce(v_h->>'auto-submitted', 'no')) = 'no'
     and lower(coalesce(v_h->>'precedence', '')) not in ('bulk', 'auto_reply', 'list') then
    if v_verdict = 'ambiguous' then
      select string_agg(coalesce(a.data->>'name', a.id), ', ' order by coalesce(a.data->>'name', a.id))
        into v_names
      from accounts a where a.org_id = v_sender.org_id and a.id = any(v_ids);
    end if;
    v_reason := case v_verdict
      when 'no_match'  then 'No account in OneVio has a contact at any address on this thread.'
      when 'ambiguous' then 'More than one account matched: ' || v_names || '.'
      else 'The message had no subject and no text.' end;
    if not public.tp_bounce(v_from,
         'Not logged: ' || coalesce(nullif(v_subject, ''), '(no subject)'),
         v_reason || E'\n\nNothing was logged. Add the customer contact''s email address to the '
         || E'right account in OneVio, then forward the thread again.') then
      update ingest_log set bounce_failed = true where message_id = v_mid;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'verdict', v_verdict);
end $$;

revoke execute on function public.tp_bounce(text, text, text) from public, anon, authenticated;
revoke execute on function public.ingest_touchpoint(text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_touchpoint(text, jsonb) to anon;
