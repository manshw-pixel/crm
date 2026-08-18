-- ============================================================
-- CS CRM — Supabase setup
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to re-run (idempotent).
-- ============================================================

-- ---------- tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'CSM',
  role text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id int primary key check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['accounts','contacts','activities','tasks','opportunities'] loop
    execute format('create table if not exists public.%I (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )', t);
  end loop;
end $$;

-- ---------- helper: is the current user an admin? ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;

-- ---------- signup trigger: auto-create profile; first user = admin ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when not exists (select 1 from profiles) then 'admin' else 'user' end
  ) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- admin guard: any number of admins, but never zero ----------
create or replace function public.guard_admin_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from profiles where role = 'admin' and id <> old.id) = 0 then
    raise exception 'At least one admin must remain';
  end if;
  return new;
end $$;

drop trigger if exists guard_admin_count on public.profiles;
create trigger guard_admin_count
  before insert or update of role on public.profiles
  for each row execute function public.guard_admin_count();

-- ---------- row-level security ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.activities enable row level security;
alter table public.tasks enable row level security;
alter table public.opportunities enable row level security;

-- profiles: everyone signed-in reads; only admins change roles/names of others
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- settings: read all, write admin
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated using (true);
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- entity tables: read/insert/update for all signed-in users
do $$
declare t text;
begin
  foreach t in array array['accounts','contacts','activities','tasks','opportunities'] loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (true)', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (true)', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- deletes: accounts admin-only; child tables any signed-in user
drop policy if exists accounts_delete on public.accounts;
create policy accounts_delete on public.accounts for delete to authenticated using (public.is_admin());
do $$
declare t text;
begin
  foreach t in array array['contacts','activities','tasks','opportunities'] loop
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (true)', t);
  end loop;
end $$;

-- ---------- durable writes: field-level merge ----------
-- Replaces the whole-blob upsert, under which two people editing different fields of one
-- account silently reverted each other with no error raised (D2 in the durability spec).
--
-- The merge must be computed INSIDE the upsert statement, not read-modify-written around
-- it: two overlapping calls under READ COMMITTED would otherwise both read the same base
-- row and the second would write its stale result over the first -- reintroducing, in a
-- few-millisecond window, exactly the lost update this function exists to prevent.
create or replace function public.merge_patch(base jsonb, patch jsonb, appends jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = public as $$
declare
  k text;
  merged jsonb;
begin
  -- `||` is a SHALLOW merge, which is exactly the field-level semantics wanted here: only
  -- the keys present in `patch` move. diffRow sends nested objects whole for this reason.
  merged := coalesce(base, '{}'::jsonb) || coalesce(patch, '{}'::jsonb);
  for k in select jsonb_object_keys(coalesce(appends, '{}'::jsonb)) loop
    merged := jsonb_set(merged, array[k],
      public.append_dedup(coalesce(merged -> k, '[]'::jsonb), appends -> k, k));
  end loop;
  return merged;
end $$;

-- SECURITY INVOKER IS LOAD-BEARING AND MUST NOT BE CHANGED. This function is a general
-- "write anything into any row" primitive; as `security definer` it would run as its owner
-- and bypass every policy above -- settings_write and the admin gate included -- turning a
-- durability fix into privilege escalation. Invoker means the caller's own policies still
-- apply, so the guarantees tests/rls pins continue to hold through the RPC.
create or replace function public.merge_row(tbl text, row_id text, patch jsonb, appends jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  -- Allow-list, not interpolation: `tbl` arrives from the browser. Anything else is a
  -- reachable path to profiles (role escalation) or to crafted SQL.
  if tbl not in ('accounts','contacts','activities','tasks','opportunities','settings') then
    raise exception 'merge_row: table % is not writable through this function', tbl;
  end if;

  if tbl = 'settings' then
    insert into settings (id, data, updated_at)
      values (1, public.merge_patch('{}'::jsonb, patch, appends), now())
      on conflict (id) do update
        set data = public.merge_patch(settings.data, patch, appends), updated_at = now();
  else
    execute format(
      'insert into public.%1$I (id, data, updated_at)
         values ($1, public.merge_patch(''{}''::jsonb, $2, $3), now())
       on conflict (id) do update
         set data = public.merge_patch(public.%1$I.data, $2, $3), updated_at = now()', tbl)
      using row_id, patch, appends;
  end if;
end $$;

-- Concatenate `incoming` onto `base`, skipping entries already present. Dedupe is what
-- makes a RETRIED write safe to replay: the queue cannot know whether a timed-out request
-- landed, so applying it twice must equal applying it once.
--   arrEvents -> by element id (every entry has one; this is the audit record that matters)
--   everything else -> by whole-element equality
-- Accepted trade-off, from the spec: two genuinely distinct `history` snapshots with the
-- same day and score collapse into one. That is a sparkline point, not an audit record.
create or replace function public.append_dedup(base jsonb, incoming jsonb, field text)
returns jsonb language plpgsql immutable security invoker set search_path = public as $$
declare
  item jsonb;
  acc jsonb := coalesce(base, '[]'::jsonb);
begin
  -- A JSON scalar (e.g. a stray null) in `acc` would make jsonb_array_elements(acc) raise
  -- below and fail this write forever. Treat anything that isn't already an array as empty.
  if jsonb_typeof(acc) <> 'array' then
    acc := '[]'::jsonb;
  end if;
  for item in select * from jsonb_array_elements(coalesce(incoming, '[]'::jsonb)) loop
    if field = 'arrEvents' and item ? 'id' then
      if not exists (select 1 from jsonb_array_elements(acc) e where e ->> 'id' = item ->> 'id') then
        acc := acc || jsonb_build_array(item);
      end if;
    elsif not exists (select 1 from jsonb_array_elements(acc) e where e = item) then
      acc := acc || jsonb_build_array(item);
    end if;
  end loop;
  return acc;
end $$;

-- ---------- durable writes: atomic bulk replace ----------
-- This function runs inside the CALLER's single transaction, so the deletes and the inserts
-- below commit together or roll back together -- there is no window in between. The old
-- client-side version deleted five tables in a loop and then inserted; any failure in
-- between -- a dropped connection, one bad row in an imported file -- left the whole team
-- with an empty database and no backup (D3). The import path was the worst, because it
-- validated only `s.accounts && s.settings` before destroying live data.
-- security invoker, as above: the admin gate is accounts_delete / settings_write, and it
-- must keep applying to the caller.
create or replace function public.replace_all(payload jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  t text;
  items jsonb;
begin
  -- Explicit, not incidental. An RLS-denied DELETE raises nothing and simply affects zero
  -- rows, so without this a non-admin's call would sail past `accounts` and still wipe the
  -- four child tables, whose delete policy is `using (true)`, failing only later at the
  -- settings upsert. The spec calls this operation admin-gated; this makes that true.
  if not public.is_admin() then
    raise exception 'replace_all: admin only';
  end if;

  -- Defence in depth: a null/omitted payload would otherwise sail through every `coalesce`
  -- below, emptying all five tables and resetting settings to `{}` -- and still return
  -- success, since there is nothing for the row-id check to reject.
  if payload is null then
    raise exception 'replace_all: no payload';
  end if;

  foreach t in array array['accounts','contacts','activities','tasks','opportunities'] loop
    -- `where true` is not noise: Supabase enables a guard that REJECTS an unqualified
    -- DELETE outright ('DELETE requires a WHERE clause'), so a bare `delete from t` aborts
    -- the whole replace. The old client-side loop satisfied this incidentally with
    -- .neq('id', ''); this states it deliberately.
    execute format('delete from public.%I where true', t);
  end loop;

  foreach t in array array['accounts','contacts','activities','tasks','opportunities'] loop
    items := coalesce(payload -> t, '[]'::jsonb);
    -- Reject a row with no id explicitly: `id text primary key` would raise on the null
    -- anyway, but naming the table makes the failure legible in the toast.
    if false then
      raise exception 'replace_all: every % row needs an id', t;
    end if;
    execute format(
      'insert into public.%I (id, data, updated_at)
       select e ->> ''id'', e, now() from jsonb_array_elements($1) e', t) using items;
  end loop;

  insert into settings (id, data, updated_at)
    values (1, coalesce(payload -> 'settings', '{}'::jsonb), now())
    on conflict (id) do update set data = excluded.data, updated_at = now();
end $$;

-- ---------- realtime ----------
do $$
declare t text;
begin
  foreach t in array array['accounts','contacts','activities','tasks','opportunities','settings','profiles'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- attachments (Supabase Storage) ----------
-- Public bucket: anyone with a file's URL can view it (links are long
-- and unguessable, but treat uploads as shareable). 10 MB client cap.
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', true)
on conflict (id) do nothing;

drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects
  for select to authenticated using (bucket_id = 'attachments');
drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'attachments');
drop policy if exists attachments_delete on storage.objects;
create policy attachments_delete on storage.objects
  for delete to authenticated using (bucket_id = 'attachments');
