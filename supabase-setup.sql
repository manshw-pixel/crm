-- ============================================================
-- CS CRM — Supabase setup
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to re-run (idempotent).
-- ============================================================

-- ---------- EDIT ME: platform identity ----------
-- The default org receives every row and user that existed before multi-tenancy. Its id
-- is fixed so this file can stamp existing data without a lookup. The platform admin is
-- the one account that can create client orgs and switch between them (the Clients
-- console a platform admin lands on). Both EDIT ME literals (the org name here, the platform admin's email below
-- the profiles backfill) are idempotent: change them and re-run.
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.orgs enable row level security;
-- Client disable (Clients console). A full, reversible lockout: org_enabled() below is
-- ANDed into is_active() AND is_admin(), so every policy and every definer RPC that gates
-- on either inherits it. Data is kept; re-enabling restores access.
alter table public.orgs add column if not exists disabled boolean not null default false;
-- Client limits, set by the platform admin on the Clients console. null = Unlimited.
-- The minimums live in the table, so no writer (RPC, SQL editor) can store a smaller value.
alter table public.orgs add column if not exists max_users int;
alter table public.orgs add column if not exists max_accounts int;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orgs_max_users_min') then
    alter table public.orgs add constraint orgs_max_users_min check (max_users is null or max_users >= 2);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orgs_max_accounts_min') then
    alter table public.orgs add constraint orgs_max_accounts_min check (max_accounts is null or max_accounts >= 5);
  end if;
end $$;
insert into public.orgs (id, name)
values ('00000000-0000-0000-0000-000000000001', 'My Company')   -- EDIT ME: your company name
on conflict (id) do nothing;

-- ---------- tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'CSM',
  role text not null default 'user' check (role in ('admin','user','lead','impl_lead','impl_user')),
  created_at timestamptz not null default now()
);

-- Disabling is the reversible alternative to deleting a user: a delete would orphan the
-- free-text `csm` / `owner` references that renameEverywhere() exists to keep in sync.
alter table public.profiles
  add column if not exists disabled boolean not null default false;

-- Finance access (invoicing): granted per user by an admin; guarded by guard_profile_finance in finance.sql.
alter table public.profiles
  add column if not exists finance boolean not null default false;

-- Lead role (spec 2026-10-13 PR 3). create table if not exists never touches an existing
-- constraint, so swap it idempotently for databases created before 'lead' existed.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','user','lead','impl_lead','impl_user'));

-- org_id is NULL for a sign-up that matched no invite: such a user has a valid session and
-- reads nothing (is_active() requires an org). platform_admin can only be set by SQL or by
-- a platform admin (guard_profile_org below).
-- Backfill ONLY in the run that adds the column: every profile that exists at that moment
-- predates multi-tenancy and belongs to the default org. On any later re-run an org-less
-- profile is an uninvited sign-up, and stamping it would hand a stranger all of org A --
-- so no re-run may ever touch org_id here.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'org_id') then
    alter table public.profiles add column org_id uuid references public.orgs(id);
    update public.profiles set org_id = '00000000-0000-0000-0000-000000000001';
  end if;
end $$;
alter table public.profiles
  add column if not exists platform_admin boolean not null default false;

-- EDIT ME: the platform admin's sign-in email. A no-op until that account exists (and on
-- the placeholder); re-run this file after that person has signed up. A login created after
-- the upgrade matched no invite and so has no org; placing it in the default org here keeps
-- it off the "no workspace" screen (it can switch_org anywhere from there). Runs as SQL, so
-- guard_profile_org's operator branch lets it through.
update public.profiles set platform_admin = true,
       org_id = coalesce(org_id, '00000000-0000-0000-0000-000000000001')
  where (not platform_admin or org_id is null)
    and id = (select id from auth.users where lower(email) = lower('you@yourcompany.com'));   -- EDIT ME

create table if not exists public.invites (
  email text not null,
  org_id uuid not null references public.orgs(id) on delete cascade,
  role text not null check (role in ('admin','user','lead','impl_lead','impl_user')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (email, org_id)
);
alter table public.invites enable row level security;
alter table public.invites drop constraint if exists invites_role_check;
alter table public.invites add constraint invites_role_check check (role in ('admin','user','lead','impl_lead','impl_user'));
-- At most ONE open invite per address across all orgs. Without this, handle_new_user had to
-- pick among several orgs' invites, and any org admin could re-invite someone else's pending
-- owner to capture their sign-up. Blocks invite_user, create_org and the invites_insert
-- policy path alike.
create unique index if not exists invites_one_open_per_email
  on public.invites (lower(email)) where accepted_at is null;

-- ---------- helper: which org is this request for? ----------
-- The single source of tenancy. Every policy and every org-stamping RPC reads this.
-- Definer so it can read profiles regardless of the profiles policies. Stable alone does NOT
-- make the planner evaluate it once per statement: a bare call in a policy runs per row. So
-- every policy below wraps the helpers as (select public.current_org()), which Postgres
-- hoists into an initplan evaluated once per query.
create or replace function public.current_org()
returns uuid language sql stable security definer set search_path = public as
$$ select org_id from profiles where id = auth.uid() $$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and platform_admin and not disabled) $$;

-- True when the caller's org is not disabled, or the caller is the platform admin (who must
-- be able to open a disabled client, and must survive their own home org being disabled).
create or replace function public.org_enabled()
returns boolean language sql stable security definer set search_path = public as
$$ select public.is_platform_admin()
       or exists (select 1 from profiles p join orgs o on o.id = p.org_id
                  where p.id = auth.uid() and not o.disabled) $$;

-- ---------- helper: one definition of a plausible email address ----------
-- Used by every SQL function that accepts an address from the browser, so the rule cannot
-- drift between them. Immutable, touches no table, reveals nothing: needs no gate.
create or replace function public.valid_email(p text)
returns boolean language sql immutable set search_path = public as
$$ select coalesce(p ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$', false) $$;

-- settings: one row per org. Pre-multitenant this was `id int primary key check (id = 1)`.
create table if not exists public.settings (
  org_id uuid primary key default public.current_org() references public.orgs(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'settings' and column_name = 'id') then
    alter table public.settings add column if not exists org_id uuid;
    update public.settings set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
    alter table public.settings drop constraint settings_pkey;
    alter table public.settings drop column id;
    alter table public.settings
      alter column org_id set not null,
      alter column org_id set default public.current_org(),
      add primary key (org_id),
      add constraint settings_org_id_fkey foreign key (org_id) references public.orgs(id) on delete cascade;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['accounts','contacts','activities','tasks','opportunities'] loop
    execute format('create table if not exists public.%I (
      org_id uuid not null default public.current_org() references public.orgs(id) on delete cascade,
      id text not null,
      data jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (org_id, id)
    )', t);
    -- migrate a pre-multitenant table: add + backfill + swap the primary key, once
    execute format('alter table public.%I add column if not exists org_id uuid', t);
    execute format('update public.%I set org_id = %L where org_id is null', t, '00000000-0000-0000-0000-000000000001');
    execute format('alter table public.%I alter column org_id set not null, alter column org_id set default public.current_org()', t);
    if exists (select 1 from pg_constraint
               where conrelid = format('public.%I', t)::regclass and contype = 'p' and array_length(conkey, 1) = 1) then
      execute format('alter table public.%I drop constraint %I, add primary key (org_id, id)', t, t || '_pkey');
    end if;
    if not exists (select 1 from pg_constraint where conrelid = format('public.%I', t)::regclass and conname = t || '_org_id_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (org_id) references public.orgs(id) on delete cascade', t, t || '_org_id_fkey');
    end if;
  end loop;
end $$;

-- Implementation projects (spec 2026-10-26). Same shape as the entity tables, but NOT in
-- their loops: replace_all and the lead child loops must not touch them. Created here (not
-- in their section at the end) so the realtime publication loop below can add them.
create table if not exists public.projects (
  org_id uuid not null default public.current_org() references public.orgs(id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, id)
);
create table if not exists public.project_tasks (
  org_id uuid not null default public.current_org() references public.orgs(id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, id)
);
alter table public.projects enable row level security;
alter table public.project_tasks enable row level security;

-- ---------- helper: is the current user an admin? ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and not disabled)
          and public.org_enabled() $$;

-- ---------- helper: is the current user active (not disabled)? ----------
-- Gates every policy below. This is what makes disabling take effect on a LIVE session:
-- the user keeps a valid JWT, but their next query matches no rows. Anything enforced only
-- in the client would be a label the browser is trusted to honour, which it is not.
create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and not disabled and org_id is not null)
          and public.org_enabled() $$;

-- Lead visibility (spec 2026-10-13 PR 3). Restricted = an active lead WITHOUT finance access.
-- (profiles.finance is added near the top of this file, matching finance.sql's definition.)
create or replace function public.lead_restricted()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'lead' and not finance and not disabled) $$;
create or replace function public.lead_owns(p_org uuid, p_account text)
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from accounts where org_id = p_org and id = p_account and data->>'leadId' = auth.uid()::text) $$;
create or replace function public.my_name()
returns text language sql stable security definer set search_path = public as
$$ select name from profiles where id = auth.uid() $$;
-- Implementation roles (spec 2026-10-26). impl_role() is the caller's role when it is an
-- implementation role, else null; the CRM write policies require it null, which leaves impl
-- users read-only on accounts and their children. Definer, so each re-checks is_active().
create or replace function public.impl_role()
returns text language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and role in ('impl_lead','impl_user')
          and not disabled and public.is_active() $$;
create or replace function public.is_impl_manager()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role in ('admin','impl_lead') and not disabled)
          and public.is_active() $$;
revoke execute on function public.impl_role() from public, anon;
revoke execute on function public.is_impl_manager() from public, anon;
grant execute on function public.impl_role() to authenticated;
grant execute on function public.is_impl_manager() to authenticated;
-- Child-row ownership judged on the STORED row (falls back to p_data for a brand-new id).
-- Needed because INSERT ... ON CONFLICT DO UPDATE also checks SELECT USING against the
-- PROPOSED insert row, which in merge_row is only the patch and usually lacks accountId.
create or replace function public.lead_child_ok(p_tbl text, p_org uuid, p_id text, p_data jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare d jsonb;
begin
  if p_tbl not in ('contacts','activities','tasks','opportunities','projects','project_tasks') then return false; end if;
  execute format('select data from public.%I where org_id = $1 and id = $2', p_tbl)
    into d using p_org, p_id;
  if d is null then d := p_data; end if;
  return public.lead_owns(p_org, d->>'accountId')
      or (coalesce(d->>'accountId', '') = '' and d->>'owner' = public.my_name());
end $$;
-- Policies call these as the querying role, so authenticated MUST keep execute; nobody
-- else needs them (anon has no rows to see, and PUBLIC carries Postgres's default grant).
revoke execute on function public.lead_restricted() from public, anon;
revoke execute on function public.lead_owns(uuid, text) from public, anon;
revoke execute on function public.my_name() from public, anon;
revoke execute on function public.lead_child_ok(text, uuid, text, jsonb) from public, anon;
grant execute on function public.lead_restricted() to authenticated;
grant execute on function public.lead_owns(uuid, text) to authenticated;
grant execute on function public.my_name() to authenticated;
grant execute on function public.lead_child_ok(text, uuid, text, jsonb) to authenticated;

-- ---------- signup trigger: attach through a pending invite ----------
-- The old rule "first sign-up ever becomes admin" is gone: with several orgs there is no
-- meaningful "first". A sign-up is attached to an org ONLY if a pending invite matches its
-- email; anything else gets a profile with no org, which is_active() rejects everywhere.
-- The browser cannot say "put me in org X": invites are written by invite_user() (org
-- admins, own org only) and create_org() (platform admin), never by the client directly.
-- Gate: this is a trigger on auth.users, not callable through the API; the invite match
-- IS the gate, and a sign-up with no match gets role 'user' and no org.
-- Only a CONFIRMED login may claim an invite. Anyone can sign up with an address they do not
-- own; if that unverified login took the invite, whoever set its password would hold the
-- invited role (account pre-hijack). An unconfirmed sign-up stays org-less with the invite
-- left open, and handle_user_confirmed() below attaches it once the owner clicks the link.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  inv invites;
begin
  if new.email_confirmed_at is not null then
    select * into inv from invites
     where lower(email) = lower(trim(new.email)) and accepted_at is null;
  end if;
  -- invites_one_open_per_email guarantees at most one row: no tiebreak needed.
  insert into profiles (id, name, role, org_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(inv.role, 'user'),
    inv.org_id
  ) on conflict (id) do nothing;
  if inv.email is not null then
    update invites set accepted_at = now() where email = inv.email and org_id = inv.org_id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The other half of the rule above: when a login's email becomes confirmed, attach it through
-- its open invite. attach_orgless_login() (defined further down; resolved at run time) keeps
-- its refusals -- never a platform admin, a disabled login or one already in an org. A refusal
-- here must not fail the confirmation itself, so it is swallowed and the invite stays open.
create or replace function public.handle_user_confirmed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  inv invites;
begin
  select * into inv from invites
   where lower(email) = lower(trim(new.email)) and accepted_at is null;
  if inv.email is null then return new; end if;
  begin
    perform public.attach_orgless_login('confirm', inv.email, new.id, inv.org_id, inv.role);
    update invites set accepted_at = now() where email = inv.email and org_id = inv.org_id;
  exception when others then
    null;
  end;
  return new;
end $$;
revoke execute on function public.handle_user_confirmed() from public, anon, authenticated;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_user_confirmed();

-- ---------- admin guard: any number of admins per org, but never zero ----------
create or replace function public.guard_admin_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.disabled and not old.disabled and new.id = auth.uid() then
    raise exception 'You cannot disable yourself';
  end if;
  -- One predicate for both routes to zero admins: demotion (role change) and disabling.
  -- The original guard watched only role, so an admin could disable their way to an app
  -- nobody can administer -- the same failure it was written to prevent.
  if tg_op = 'UPDATE'
     and old.role = 'admin' and not old.disabled
     and (new.role <> 'admin' or new.disabled)
     and (select count(*) from profiles
            where role = 'admin' and not disabled and id <> old.id and org_id = old.org_id) = 0 then
    raise exception 'At least one admin must remain';
  end if;
  return new;
end $$;

drop trigger if exists guard_admin_count on public.profiles;
create trigger guard_admin_count
  before insert or update of role, disabled on public.profiles
  for each row execute function public.guard_admin_count();

-- ---------- org column immutability and the platform admin's row ----------
-- profiles_update_admin lets an org admin edit rows in their org; this trigger is what
-- stops that admin (or a user editing their own row) from moving anyone to another org
-- or minting a platform admin. It also protects the platform admin's own row: switch_org
-- places that profile inside a client org, where the client's admins would otherwise pass
-- profiles_update_admin and could disable it, demote it or move it. So a row with
-- platform_admin = true can have its role, disabled flag or org changed only by a caller
-- who is a platform admin (itself included). Its email lives in auth.users and is guarded
-- by admin_set_user_email's own check.
-- switch_org is NOT exempt: it runs with auth.uid() set, and passes because its caller is
-- a platform admin.
create or replace function public.guard_profile_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Operator contexts only: the SQL editor, pg_cron and service_role have no auth.uid().
  -- No browser request reaches this branch -- every authenticated request (definer RPCs
  -- included) carries the caller's sub, and anon has no update path to profiles. This is
  -- how this file's own backfill and the platform-admin EDIT ME update run.
  if auth.uid() is null then return new; end if;
  if old.platform_admin
     and (new.role is distinct from old.role
          or new.disabled is distinct from old.disabled
          or new.org_id is distinct from old.org_id)
     and not public.is_platform_admin() then
    raise exception 'Only a platform admin can change a platform admin''s role, status or org';
  end if;
  -- attach_orgless_login() (invite_user, create_org) sets this transaction-local flag
  -- itself. A client cannot: set_config is not exposed through the API, and the flag is
  -- only honoured for a row that had NO org (it can never move someone between orgs),
  -- never for a platform admin or a disabled login, and never for the platform flag.
  if current_setting('app.invite_attach', true) = 'on'
     and old.org_id is null and not old.platform_admin and not old.disabled
     and new.platform_admin is not distinct from old.platform_admin then
    return new;
  end if;
  if (new.org_id is distinct from old.org_id or new.platform_admin is distinct from old.platform_admin)
     and not public.is_platform_admin() then
    raise exception 'Only a platform admin can change a user''s org or platform flag';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile_org on public.profiles;
create trigger guard_profile_org
  before update of org_id, platform_admin, role, disabled on public.profiles
  for each row execute function public.guard_profile_org();

-- ---------- row-level security ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.activities enable row level security;
alter table public.tasks enable row level security;
alter table public.opportunities enable row level security;

-- THE TENANCY BOUNDARY. Every business policy is "active user AND the row's org is my org".
-- The `with check` half is what stops a client naming another org on an insert or update:
-- the column has a default of current_org(), but a default is a convenience, not a guard.

-- profiles: an active user sees their org's profiles; anyone sees their own row.
-- A disabled (or org-less) user must still read their OWN row (and only it), so Root() can
-- tell them their access was removed. Gate it flatly and their profile fetch errors instead,
-- leaving them stuck on "Loading profile..." -- the opposite of a clean sign-out.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (((select public.is_active()) and org_id = (select public.current_org())) or id = auth.uid());
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using ((select public.is_admin()) and org_id = (select public.current_org()))
  with check ((select public.is_admin()) and org_id = (select public.current_org()));

-- orgs: members see their own org (the sidebar shows its name); the platform admin sees all.
-- No insert/update/delete from the browser: create_org() is the only writer.
drop policy if exists orgs_select on public.orgs;
create policy orgs_select on public.orgs for select to authenticated
  using (id = (select public.current_org()) or (select public.is_platform_admin()));

-- invites: org admins read and create their own org's invites. invite_user()/create_org()
-- are the app's writers; the insert policy is the direct-API equivalent, pinned to the org.
drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites for select to authenticated
  using ((select public.is_admin()) and org_id = (select public.current_org()));
drop policy if exists invites_insert on public.invites;
create policy invites_insert on public.invites for insert to authenticated
  with check ((select public.is_admin()) and org_id = (select public.current_org()));

-- settings: read all in org, write admin in org
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org()));
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all to authenticated
  using ((select public.is_admin()) and org_id = (select public.current_org()))
  with check ((select public.is_admin()) and org_id = (select public.current_org()));

-- entity tables: read/insert/update for active users of the row's org
do $$
declare t text;
begin
  foreach t in array array['accounts','contacts','activities','tasks','opportunities'] loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using ((select public.is_active()) and org_id = (select public.current_org()))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    -- (select public.impl_role()) is null: implementation roles are read-only here.
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check ((select public.is_active()) and org_id = (select public.current_org()) and (select public.impl_role()) is null)', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using ((select public.is_active()) and org_id = (select public.current_org()) and (select public.impl_role()) is null) with check ((select public.is_active()) and org_id = (select public.current_org()) and (select public.impl_role()) is null)', t);
  end loop;
end $$;

-- deletes: accounts admin-only; child tables any active user -- within the org
drop policy if exists accounts_delete on public.accounts;
create policy accounts_delete on public.accounts for delete to authenticated
  using ((select public.is_admin()) and org_id = (select public.current_org()));
do $$
declare t text;
begin
  foreach t in array array['contacts','activities','tasks','opportunities'] loop
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using ((select public.is_active()) and org_id = (select public.current_org()) and (select public.impl_role()) is null)', t);
  end loop;
end $$;

-- Lead scoping (spec 2026-10-13 PR 3): a restricted lead (lead_restricted(): role lead, no
-- finance) sees and edits only accounts whose data.leadId is them, those accounts' child
-- rows, and account-less child rows they own by name. SELECT, UPDATE (USING and WITH CHECK)
-- and child DELETE are recreated with that clause; accounts_delete stays admin-only.
-- INSERT POLICIES ARE DELIBERATELY UNCHANGED: merge_row's proposed INSERT row is only the
-- patch (merge_patch('{}', patch)), which usually lacks leadId/accountId, so an ownership
-- clause there would refuse ordinary lead EDITS before ON CONFLICT is reached. New rows are
-- policed by triggers instead: guard_account_owner (leads cannot create accounts) and
-- guard_child_account (children only under the lead's own accounts).
-- ON CONFLICT DO UPDATE ALSO checks SELECT USING against the PROPOSED insert row (the bare
-- patch), so SELECT/UPDATE USING/DELETE judge ownership on the STORED row (lead_owns by id,
-- lead_child_ok); only UPDATE WITH CHECK reads the merged new row, which blocks re-pointing.
do $$
declare
  t text;
  own text;      -- judged on the STORED row: SELECT, UPDATE USING, DELETE
  own_new text;  -- judged on the merged NEW row: UPDATE WITH CHECK (blocks re-pointing)
  scoped text;
  scoped_new text;
begin
  foreach t in array array['accounts','contacts','activities','tasks','opportunities'] loop
    if t = 'accounts' then
      own := $o$public.lead_owns(org_id, id)$o$;
      own_new := $o$data->>'leadId' = auth.uid()::text$o$;
    else
      own := format('public.lead_child_ok(%L, org_id, id, data)', t);
      own_new := $o$(public.lead_owns(org_id, data->>'accountId') or (coalesce(data->>'accountId','') = '' and data->>'owner' = (select public.my_name())))$o$;
    end if;
    scoped := format('(select public.is_active()) and org_id = (select public.current_org()) and (not (select public.lead_restricted()) or %s)', own);
    scoped_new := format('(select public.is_active()) and org_id = (select public.current_org()) and (not (select public.lead_restricted()) or %s)', own_new);
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (%2$s)', t, scoped);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    -- Writes also exclude implementation roles (read-only on CRM data); SELECT does not.
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (%2$s and (select public.impl_role()) is null) with check (%3$s and (select public.impl_role()) is null)', t, scoped, scoped_new);
    if t <> 'accounts' then
      execute format('drop policy if exists %1$s_delete on public.%1$I', t);
      execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (%2$s and (select public.impl_role()) is null)', t, scoped);
    end if;
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
  if tbl not in ('accounts','contacts','activities','tasks','opportunities','settings','projects','project_tasks') then
    raise exception 'merge_row: table % is not writable through this function', tbl;
  end if;

  if tbl = 'settings' then
    insert into settings (org_id, data, updated_at)
      values (public.current_org(), public.merge_patch('{}'::jsonb, patch, appends), now())
      on conflict (org_id) do update
        set data = public.merge_patch(settings.data, patch, appends), updated_at = now();
  else
    execute format(
      'insert into public.%1$I (org_id, id, data, updated_at)
         values (public.current_org(), $1, public.merge_patch(''{}''::jsonb, $2, $3), now())
       on conflict (org_id, id) do update
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
  lim int;
begin
  -- Explicit, not incidental. An RLS-denied DELETE raises nothing and simply affects zero
  -- rows, so without this a non-admin's call would sail past `accounts` and still wipe the
  -- four child tables, failing only later at the settings upsert. The spec calls this operation admin-gated; this makes that true.
  if not public.is_admin() then
    raise exception 'replace_all: admin only';
  end if;

  -- Defence in depth: a null/omitted payload would otherwise sail through every `coalesce`
  -- below, emptying all five tables and resetting settings to `{}` -- and still return
  -- success, since there is nothing for the row-id check to reject.
  if payload is null then
    raise exception 'replace_all: no payload';
  end if;

  -- Refuse an over-limit restore BEFORE the deletes, with the plan message, rather than letting
  -- the account trigger fail it part-way (it would roll back, but with a less useful error).
  select max_accounts into lim from orgs where id = public.current_org();
  if lim is not null and jsonb_array_length(coalesce(payload -> 'accounts', '[]'::jsonb)) > lim then
    raise exception 'Your plan allows % accounts — contact OneVio to raise it.', lim;
  end if;

  foreach t in array array['accounts','contacts','activities','tasks','opportunities'] loop
    -- `where true` is not noise: Supabase enables a guard that REJECTS an unqualified
    -- DELETE outright ('DELETE requires a WHERE clause'), so a bare `delete from t` aborts
    -- the whole replace. The old client-side loop satisfied this incidentally with
    -- .neq('id', ''); this states it deliberately.
    -- The WHERE is also the tenancy scope: an admin replaces THEIR org's data, never
    -- another's (RLS would stop it too; this states it rather than relying on it).
    execute format('delete from public.%I where org_id = public.current_org()', t);
  end loop;

  foreach t in array array['accounts','contacts','activities','tasks','opportunities'] loop
    items := coalesce(payload -> t, '[]'::jsonb);
    -- Reject a row with no id explicitly: `id text primary key` would raise on the null
    -- anyway, but naming the table makes the failure legible in the toast.
    if exists (select 1 from jsonb_array_elements(items) e where e ->> 'id' is null) then
      raise exception 'replace_all: every % row needs an id', t;
    end if;
    execute format(
      'insert into public.%I (org_id, id, data, updated_at)
       select public.current_org(), e ->> ''id'', e, now() from jsonb_array_elements($1) e', t) using items;
  end loop;

  insert into settings (org_id, data, updated_at)
    values (public.current_org(), coalesce(payload -> 'settings', '{}'::jsonb), now())
    on conflict (org_id) do update set data = excluded.data, updated_at = now();
end $$;

-- ---------- error log ----------
-- The app had no error reporting at all: ViewBoundary console.errored into a console
-- nobody watches, dbError raised a toast that scrolls away, and the write queue's give-up
-- path told only the user whose save had just failed.
create table if not exists public.error_log (
  -- The fingerprint IS the identity: the same bug collapses to one row whether it fires
  -- once or ten thousand times, so "is this getting worse?" is answered by reading `count`
  -- rather than by counting rows.
  fingerprint text primary key,
  level       text not null check (level in ('crash','write_failed','load_failed','retry')),
  message     text not null,
  stack       text,
  -- Context only: the view, table, action and error code. NEVER row data -- this app's
  -- subject matter is customer revenue, and copying it into a second table with different
  -- access rules would be a privacy regression dressed up as an improvement.
  context     jsonb not null default '{}'::jsonb,
  user_id     uuid,
  app_version text,
  user_agent  text,
  count       int not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

-- Per-org since multi-tenancy. The identity is (org_id, fingerprint): two tenants hitting
-- the same bug get a row each, and each org's admin sees only their own. org_id is NULL for
-- system rows (log_error_system, from cron) -- those are platform-level, seen only by the
-- platform admin. Backfill ONLY in the run that adds the column (same rule as profiles):
-- every row that exists at that moment predates tenancy and belongs to the default org.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'error_log' and column_name = 'org_id') then
    alter table public.error_log
      add column org_id uuid references public.orgs(id) on delete cascade default public.current_org();
    update public.error_log set org_id = '00000000-0000-0000-0000-000000000001';
  end if;
  -- the old identity was fingerprint alone; it would still collapse two orgs into one row
  if exists (select 1 from pg_constraint where conrelid = 'public.error_log'::regclass and conname = 'error_log_pkey') then
    alter table public.error_log drop constraint error_log_pkey;
  end if;
  -- NULLS NOT DISTINCT: all system rows (org_id null) share one bucket per fingerprint, so
  -- `on conflict (org_id, fingerprint)` still collapses them.
  if not exists (select 1 from pg_constraint where conrelid = 'public.error_log'::regclass and conname = 'error_log_org_fingerprint_key') then
    alter table public.error_log
      add constraint error_log_org_fingerprint_key unique nulls not distinct (org_id, fingerprint);
  end if;
end $$;

alter table public.error_log enable row level security;

-- insert: ANY authenticated user. Errors happen to non-admins, and a user who cannot
-- report is a user you never hear about. This is deliberately the most permissive policy
-- in the file: a signed-in user can write rows an admin reads. Accepted knowingly --
-- restricting it would blind the log to exactly the people worth hearing from, and
-- fingerprint collapsing turns a flood into one row with a high count rather than many rows.
drop policy if exists error_log_insert on public.error_log;
-- Scoped to the caller's org: an unscoped check would let a client plant a row in another
-- tenant's log. (log_error is definer and does not go through this policy.)
create policy error_log_insert on public.error_log for insert to authenticated
  with check (org_id = (select public.current_org()));

-- select: admins only, their own org. Error messages quote application data. Null-org
-- system rows are for the platform admin only.
drop policy if exists error_log_select on public.error_log;
create policy error_log_select on public.error_log for select to authenticated
  using (((select public.is_admin()) and org_id = (select public.current_org())) or (select public.is_platform_admin()));

-- NO update and NO delete policy, deliberately. log_error owns every mutation, so nobody
-- can edit or delete a record -- including its count -- to erase their own errors.

-- Records one occurrence. The count is incremented INSIDE the statement rather than by a
-- client read-then-write, which would be the same lost update merge_row was rewritten to
-- remove. Reporting is the worst place to reintroduce it: it runs when the app is already
-- unhealthy, and concurrent failures are correlated, not independent -- one flaky network
-- breaks every open tab at once.
-- SECURITY DEFINER here, unlike every other function in this file, and deliberately.
-- `insert ... on conflict do update` requires UPDATE and SELECT policies for the caller,
-- and any UPDATE policy wide enough to let this bump `count` would also let a client
-- rewrite `message` and zero the count -- destroying the evidence the log exists to keep.
-- Definer is safe HERE specifically because this function returns void, touches one
-- hard-coded table, accepts no table name from the caller, reads nothing back, and can
-- only ever increment `count`. The admin-only select policy still governs every client
-- read of the table. The auth.uid() check below replaces the insert policy definer bypasses.
-- `create or replace` CANNOT rename an input parameter ("cannot change name of input
-- parameter"), so an existing log_error must be dropped before the create below. Harmless
-- on a fresh database, required on one that already has the earlier version.
drop function if exists public.log_error(text, text, text, text, jsonb, text, text);

-- Parameters are prefixed p_ because every one of them shares a name with a column of
-- error_log. Unprefixed, plpgsql cannot tell the parameter from the column and the whole
-- statement fails at RUNTIME with 'column reference "fingerprint" is ambiguous' -- which no
-- amount of reading caught; only executing it did.
create or replace function public.log_error(
  p_fingerprint text, p_level text, p_message text, p_stack text,
  p_context jsonb, p_app_version text, p_user_agent text)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- definer bypasses the insert policy that used to deny anon, so the check that policy
  -- was performing has to be made explicitly here instead.
  if auth.uid() is null then
    raise exception 'log_error: sign in required';
  end if;
  -- Deliberately NOT gated on is_active(), unlike record_health below: a disabled user who
  -- cannot report an error is a user whose failures we never hear about.

  insert into error_log (org_id, fingerprint, level, message, stack, context, user_id, app_version, user_agent)
  values (public.current_org(), p_fingerprint, p_level, p_message, p_stack, coalesce(p_context, '{}'::jsonb),
          auth.uid(), p_app_version, p_user_agent)
  on conflict (org_id, fingerprint) do update set
    count = error_log.count + 1,
    last_seen = now(),
    -- keep the most recent occurrence's detail
    level = excluded.level,
    message = excluded.message,
    stack = excluded.stack,
    context = excluded.context;

  -- Retention, run inline rather than on a schedule. email-alerts-schedule.sql now installs
  -- pg_cron, so "this project has no scheduler" is no longer true -- but the inline sweep
  -- is kept deliberately: it runs exactly when rows are added, needs no second moving
  -- part, and works on a stack where the alert layer was never installed. The WHERE is not
  -- optional -- Supabase rejects an unqualified DELETE.
  delete from error_log where last_seen < now() - interval '30 days';
end $$;

-- Revoke from PUBLIC **and** from anon -- both are needed, and neither substitutes for the
-- other. PUBLIC: Postgres grants EXECUTE to PUBLIC by default on every new function and
-- `create or replace` preserves it, so anon would keep inheriting execute through PUBLIC.
-- anon: on Supabase, functions created in schema `public` by `postgres` ALSO pick up an
-- explicit grant to anon and authenticated from the project's default privileges, which
-- `revoke ... from public` does not touch. Revoking only PUBLIC leaves that direct grant
-- standing and anon still reaches the body.
--
-- An earlier comment here warned that naming `anon` breaks an install where the role does
-- not exist. That concern is real for portable SQL, but not for this file: it targets
-- Supabase, where anon and authenticated are created by the platform before any user SQL
-- runs, and the RLS harness re-establishes both roles and those default privileges
-- (tests/rls/fixtures.mjs) before applying this file.
revoke execute on function public.log_error(text, text, text, text, jsonb, text, text) from public, anon;
grant execute on function public.log_error(text, text, text, text, jsonb, text, text) to authenticated;

-- ---------- realtime ----------
do $$
declare t text;
begin
  foreach t in array array['accounts','contacts','activities','tasks','opportunities','settings','profiles','projects','project_tasks'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- health snapshots ----------
-- A daily per-account score, written by the APP. Health is computed in JavaScript from
-- admin-tunable weights; reimplementing that formula in SQL would create a second source
-- of truth that drifts the moment someone tunes a weight. So SQL never scores anything --
-- it only ever compares two numbers that the app stored.
--
-- Unlike ARR, health has no event ledger and CANNOT be reconstructed backwards. This table
-- only ever knows what it was told, starting the day it ships.
create table if not exists public.health_snapshots (
  org_id     uuid not null,
  account_id text not null,
  day        date not null default current_date,
  score      int  not null check (score between 0 and 100),
  primary key (org_id, account_id, day)
);
-- migrate a pre-multitenant table: add + backfill + widen the primary key, once
alter table public.health_snapshots add column if not exists org_id uuid;
update public.health_snapshots set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
do $$
begin
  alter table public.health_snapshots alter column org_id set not null;
  if exists (select 1 from pg_constraint where conrelid = 'public.health_snapshots'::regclass
             and contype = 'p' and array_length(conkey, 1) = 2) then
    alter table public.health_snapshots drop constraint health_snapshots_pkey,
      add primary key (org_id, account_id, day);
  end if;
end $$;

alter table public.health_snapshots enable row level security;

-- select: any authenticated, active user. Scores are already visible in the app to everyone
-- who is signed in and not disabled -- gated like the entity tables, not like profiles_select.
drop policy if exists health_snapshots_select on public.health_snapshots;
create policy health_snapshots_select on public.health_snapshots
  for select to authenticated using ((select public.is_active()) and org_id = (select public.current_org())
    and (not (select public.lead_restricted()) or public.lead_owns(org_id, account_id)));

-- NO insert/update/delete policy, deliberately: every mutation funnels through
-- record_health(), which validates the shape of `score` and checks that `accountId` names a
-- real account before it inserts. RLS keeps direct writes out of the API roles, so those two
-- checks cannot be bypassed by anon or authenticated -- service_role and the table owner
-- bypass RLS entirely, as they do everywhere else in this schema.
--
-- Scope this honestly -- it is NOT an authorization boundary. Any authenticated user of this
-- internal CRM can already edit accounts directly, and record_health() is open to every
-- authenticated user, so a signed-in user CAN overwrite today's score for an account they
-- can see. What the funnel actually buys is integrity: no malformed scores, and no snapshot
-- rows for accounts that do not exist.
--
-- That accountId check holds at WRITE time only -- health_snapshots has no foreign key on
-- account_id, so deleting an account later does not cascade and its snapshots are orphaned.

create or replace function public.record_health(p_scores jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- definer bypasses RLS, so the check the missing insert policy would have performed has
  -- to be made explicitly here instead.
  if auth.uid() is null then
    raise exception 'record_health: sign in required';
  end if;
  -- record_health is SECURITY DEFINER, so it bypasses RLS entirely -- gating every policy
  -- on is_active() (health_snapshots_select included) does nothing to stop a disabled user
  -- from calling this RPC directly. A disabled user still holds a valid JWT (spec S3), so
  -- that check has to be repeated here explicitly. Do NOT delete this while "simplifying" --
  -- health_snapshots cannot be reconstructed backwards, so a disabled user overwriting it
  -- destroys data with no way to recover it.
  if not public.is_active() then
    raise exception 'record_health: no access';
  end if;

  insert into health_snapshots (org_id, account_id, day, score)
  select public.current_org(), e->>'accountId', current_date,
         least(100, greatest(0, (e->>'score')::numeric::int))
  from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) e
  where e->>'accountId' is not null
    and e->>'score' ~ '^-?[0-9]+(\.[0-9]+)?$'
    -- An unknown accountId is DROPPED, not raised on: the app sends one batch for every
    -- account on screen, and an account deleted between render and write must not cost the
    -- rest of the batch its snapshot. Without this, health_snapshots can be stuffed with
    -- rows referencing accounts that never existed.
    -- ...and the account must be in the CALLER's org: definer bypasses RLS, so without
    -- the org_id match a user could stamp a snapshot for another tenant's account id.
    and exists (select 1 from accounts a where a.id = e->>'accountId' and a.org_id = public.current_org())
    -- ...and a restricted lead may only snapshot accounts they lead (definer bypasses RLS).
    and (not public.lead_restricted() or public.lead_owns(public.current_org(), e->>'accountId'))
  on conflict (org_id, account_id, day) do update set score = excluded.score;

  get diagnostics n = row_count;

  -- health_snapshots has no scheduled sweep, so it grows at accounts x days forever without
  -- this. Retain 90 days, not 30 like error_log: drop detection needs more history than the
  -- error log to tell a genuine decline from a one-day dip. Inline for the same reason as
  -- log_error's sweep -- runs exactly when rows are added, no second moving part. The WHERE
  -- is not optional -- Supabase rejects an unqualified DELETE.
  delete from health_snapshots where day < current_date - interval '90 days';

  return n;
end $$;

-- Revoke from PUBLIC **and** anon, for the same reason as log_error above: PUBLIC carries
-- Postgres's default EXECUTE, and Supabase's default privileges add a separate explicit
-- grant to anon that revoking PUBLIC leaves standing. Without the second role named here,
-- an anonymous caller still reaches the body and is stopped only by the `sign in required`
-- raise inside it -- a check, not a grant.
revoke execute on function public.record_health(jsonb) from public, anon;
grant execute on function public.record_health(jsonb) to authenticated;

-- ---------- admin user management ----------
-- profiles has no email column; addresses live in auth.users, which the browser cannot
-- read. Definer rights are what make this join possible at all -- the same reason
-- alert_recipients() in email-alerts.sql is a definer function.
-- v2 adds `finance`; the return type changed, so the old signature is dropped first.
drop function if exists public.admin_user_list();
create or replace function public.admin_user_list()
returns table(id uuid, name text, role text, disabled boolean, email text, finance boolean)
language plpgsql security definer set search_path = public, auth as $$
begin
  -- A definer function runs as its owner and bypasses RLS, so it must assert its own
  -- authorisation. Relying on the caller's policies here would expose every address.
  if not public.is_admin() then
    raise exception 'admin_user_list: admin only';
  end if;
  return query
    select p.id, p.name, p.role, p.disabled, u.email::text, p.finance
    from profiles p join auth.users u on u.id = p.id
    where p.org_id = public.current_org()
      -- A platform admin who has switched into this org is not one of its users: hide the
      -- operator (and its address) from the org's own admins.
      and (not p.platform_admin or public.is_platform_admin())
    order by p.created_at;
end $$;

create or replace function public.admin_set_user_email(p_id uuid, p_email text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  addr text := lower(trim(p_email));
begin
  if not public.is_admin() then
    raise exception 'admin_set_user_email: admin only';
  end if;
  -- Definer bypasses RLS: without this an org admin could rewrite ANY tenant's login.
  if not exists (select 1 from profiles where id = p_id and org_id = public.current_org()) then
    raise exception 'admin_set_user_email: user is not in your org';
  end if;
  -- An org admin must never rewrite the operator's login (then reset its password and sign
  -- in as platform admin). The profiles guard cannot see this: the address is in auth.users.
  if exists (select 1 from profiles where id = p_id and platform_admin)
     and not public.is_platform_admin() then
    raise exception 'admin_set_user_email: only a platform admin can change a platform admin''s email';
  end if;
  if not public.valid_email(addr) then
    raise exception 'admin_set_user_email: % is not a valid email address', p_email;
  end if;
  if exists (select 1 from auth.users where lower(email) = addr and id <> p_id) then
    raise exception 'admin_set_user_email: % is already in use', addr;
  end if;
  if not exists (select 1 from profiles where id = p_id) then
    raise exception 'admin_set_user_email: no such user';
  end if;

  update auth.users
     set email = addr,
         -- Bypassing GoTrue's confirm-change flow is a deliberate decision (spec §6).
         -- Leaving a pending change behind would let a stale confirmation link later
         -- overwrite the address an admin just set.
         email_change = '',
         email_change_token_new = '',
         email_change_token_current = '',
         email_change_confirm_status = 0,
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = p_id;

  -- GoTrue ALSO keeps the address inside auth.identities.identity_data, and resolves
  -- some sign-in paths through it. Updating only auth.users can leave the identity
  -- stale, which is how a user ends up unable to log in with EITHER address. Task 4
  -- proves which behaviour is real; keep both in step regardless.
  -- This function assumes the 'email' provider -- a user signed in via an OAuth identity
  -- (google, github, ...) would keep that identity's stale address; there is no
  -- 'provider = email' row for it to update.
  update auth.identities
     set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(addr)),
         updated_at = now()
   where user_id = p_id and provider = 'email';
end $$;

-- Revoke from PUBLIC and anon both -- see record_health's revoke above for why PUBLIC
-- alone leaves anon's separate default grant standing.
revoke execute on function public.admin_user_list() from public, anon;
revoke execute on function public.admin_set_user_email(uuid, text) from public, anon;
grant execute on function public.admin_user_list() to authenticated;
grant execute on function public.admin_set_user_email(uuid, text) to authenticated;

-- ---------- onboarding: invites and orgs ----------
-- Internal: the one attach path for an existing org-less login, shared by invite_user and
-- create_org. Refuses a platform admin (only SQL may place the operator) and a disabled
-- login (re-enabling is a deliberate admin act, not a side effect of an invite). Raising
-- here aborts the caller's whole transaction, so no invite or org row is left behind.
-- Not callable from the API (revoked below); its only callers are definer functions,
-- which run as the owner.
create or replace function public.attach_orgless_login(p_caller text, p_addr text, p_id uuid, p_org uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  prof record;
begin
  select org_id, platform_admin, disabled into prof from profiles where id = p_id for update;
  if not found or prof.org_id is not null then
    raise exception '%: % is not an org-less login', p_caller, p_addr;
  end if;
  if prof.platform_admin then
    raise exception '%: % is a platform admin and cannot be added to a workspace', p_caller, p_addr;
  end if;
  if prof.disabled then
    raise exception '%: % is a disabled login and cannot be added to a workspace', p_caller, p_addr;
  end if;
  perform set_config('app.invite_attach', 'on', true);
  update profiles set org_id = p_org, role = p_role where id = p_id;
  perform set_config('app.invite_attach', 'off', true);
end $$;
revoke execute on function public.attach_orgless_login(text, text, uuid, uuid, text) from public, anon, authenticated;

-- ---------- client limits: seats ----------
-- A seat is an enabled member or an open invite. The platform admin never uses one: switch_org
-- puts their profile inside whichever client they open.
create or replace function public.org_seat_count(p_org uuid)
returns int language sql stable security definer set search_path = public as
$$ select (select count(*) from profiles where org_id = p_org and not disabled and not platform_admin)::int
        + (select count(*) from invites where org_id = p_org and accepted_at is null)::int $$;

-- Locks the org row first, so two concurrent invites cannot both see the last free seat.
create or replace function public.assert_seat_available(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lim int;
begin
  select max_users into lim from orgs where id = p_org for update;
  if lim is not null and public.org_seat_count(p_org) >= lim then
    raise exception 'Your plan allows % users — contact OneVio to raise it.', lim;
  end if;
end $$;
revoke execute on function public.org_seat_count(uuid) from public, anon, authenticated;
revoke execute on function public.assert_seat_available(uuid) from public, anon, authenticated;

-- The invites_insert policy lets an org admin insert invites straight through the API, which
-- would walk around invite_user's check. Hold every open-invite insert to the limit here.
-- BEFORE INSERT also fires for `insert ... on conflict do update`, so an address that already
-- has an open invite in this org (a re-send) takes no new seat and passes.
create or replace function public.guard_invite_seat()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.accepted_at is null
     and not exists (select 1 from invites where lower(email) = lower(new.email)
                     and org_id = new.org_id and accepted_at is null) then
    perform public.assert_seat_available(new.org_id);
  end if;
  return new;
end $$;
drop trigger if exists guard_invite_seat on public.invites;
create trigger guard_invite_seat
  before insert on public.invites
  for each row execute function public.guard_invite_seat();

-- Re-enabling a disabled user takes a seat back, so it is held to the same limit. The row
-- being enabled is still disabled while this runs, so it is not in the count yet.
create or replace function public.guard_seat_on_enable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.disabled and not new.disabled and new.org_id is not null and not new.platform_admin then
    perform public.assert_seat_available(new.org_id);
  end if;
  return new;
end $$;
drop trigger if exists guard_seat_on_enable on public.profiles;
create trigger guard_seat_on_enable
  before update of disabled on public.profiles
  for each row execute function public.guard_seat_on_enable();

-- ---------- client limits: accounts ----------
-- BEFORE INSERT also fires for `insert ... on conflict do update`, which merge_row uses for
-- EVERY account edit. An id that already exists is an edit, not a new account: let it through,
-- or every save is refused once a client reaches its limit.
create or replace function public.guard_account_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim int;
begin
  -- Unlocked fast path: Unlimited orgs and edits of existing accounts never touch the org row lock.
  select max_accounts into lim from orgs where id = new.org_id;
  if lim is null then return new; end if;
  if exists (select 1 from accounts where org_id = new.org_id and id = new.id) then return new; end if;
  -- A real insert under a limit: lock the org row and re-read, so concurrent inserts cannot both take the last slot.
  select max_accounts into lim from orgs where id = new.org_id for update;
  if lim is null then return new; end if;
  if (select count(*) from accounts where org_id = new.org_id) >= lim then
    raise exception 'Your plan allows % accounts — contact OneVio to raise it.', lim;
  end if;
  return new;
end $$;
drop trigger if exists guard_account_limit on public.accounts;
create trigger guard_account_limit
  before insert on public.accounts
  for each row execute function public.guard_account_limit();

-- ---------- admin-only account owners (spec 2026-10-13 PR 2) ----------
-- csm / csmSince / leadId change only by an admin. BEFORE INSERT also fires for merge_row's
-- `insert ... on conflict do update`, i.e. for every edit: an existing id is an edit and is
-- judged by the UPDATE branch, so a CSM saving ARR with the unchanged csm is never refused.
create or replace function public.guard_account_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare me text;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from accounts where org_id = new.org_id and id = new.id) then return new; end if;
    -- Lead role (spec 2026-10-13 PR 3): leads, with or without finance, never create accounts.
    if exists (select 1 from profiles where id = auth.uid() and role = 'lead') then
      raise exception 'Leads cannot create accounts';
    end if;
    select name into me from profiles where id = auth.uid();
    if coalesce(new.data->>'leadId', '') <> ''
       or (coalesce(new.data->>'csm', '') <> '' and new.data->>'csm' is distinct from me)
       or (coalesce(new.data->>'csmSince', '') <> '' and new.data->>'csm' is distinct from me) then
      raise exception 'Only an admin can change an account''s CSM or Lead';
    end if;
    return new;
  end if;
  if coalesce(new.data->>'csm', '') <> coalesce(old.data->>'csm', '')
     or coalesce(new.data->>'csmSince', '') <> coalesce(old.data->>'csmSince', '')
     or coalesce(new.data->>'leadId', '') <> coalesce(old.data->>'leadId', '') then
    raise exception 'Only an admin can change an account''s CSM or Lead';
  end if;
  return new;
end $$;
drop trigger if exists guard_account_owner on public.accounts;
create trigger guard_account_owner
  before insert or update on public.accounts
  for each row execute function public.guard_account_owner();

-- Lead role (spec 2026-10-13 PR 3): a restricted lead may only CREATE child rows under one of
-- their own accounts, or account-less rows owned by them. The INSERT policies cannot say this
-- (see the lead-scoping comment by the entity policies). An existing id is an edit through
-- merge_row's upsert; the UPDATE policies judge it.
create or replace function public.guard_child_account()
returns trigger language plpgsql security definer set search_path = public as $$
declare found_row boolean;
begin
  if auth.uid() is null or not public.lead_restricted() then return new; end if;
  execute format('select exists (select 1 from public.%I where org_id = $1 and id = $2)', tg_table_name)
    into found_row using new.org_id, new.id;
  if found_row then return new; end if;
  if public.lead_owns(new.org_id, new.data->>'accountId')
     or (coalesce(new.data->>'accountId', '') = '' and new.data->>'owner' = public.my_name()) then
    return new;
  end if;
  raise exception 'You can only add records to your own accounts';
end $$;
do $$
declare t text;
begin
  foreach t in array array['contacts','activities','tasks','opportunities'] loop
    execute format('drop trigger if exists guard_child_account on public.%I', t);
    execute format('create trigger guard_child_account before insert on public.%I for each row execute function public.guard_child_account()', t);
  end loop;
end $$;

-- Both writers of `invites`. handle_new_user() trusts an invite row absolutely, so who may
-- create one IS the tenancy boundary at sign-up time. All four are definer, so RLS does not
-- apply inside them: each one checks its own gate on entry.
-- Returns 'invited' (an open invite for a future sign-up) or 'attached' (an existing login
-- that had no org was placed straight into this org). The return type changed from void,
-- hence the drop: create or replace cannot change a return type.
drop function if exists public.invite_user(text, text);
create or replace function public.invite_user(p_email text, p_role text)
returns text language plpgsql security definer set search_path = public as $$
declare
  addr text := lower(trim(p_email));
  existing record;
begin
  if not public.is_admin() then
    raise exception 'invite_user: admin only';
  end if;
  if public.current_org() is null then
    raise exception 'invite_user: you are not in an org';
  end if;
  if p_role is null or p_role not in ('admin','user','lead','impl_lead','impl_user') then
    raise exception 'invite_user: role must be admin, user, lead, impl_lead or impl_user';
  end if;
  if not public.valid_email(addr) then
    raise exception 'invite_user: % is not a valid email address', p_email;
  end if;
  -- handle_new_user() only fires for a NEW login, so an address that already has one would
  -- never pick up an invite. Deal with it here instead of leaving a dead invite behind.
  -- Only a confirmed login is attached here. An unconfirmed one may belong to someone who
  -- signed up with an address they do not own, so it gets the open invite below instead,
  -- which handle_user_confirmed() honours once the address is verified.
  select p.id, p.org_id, u.email_confirmed_at is not null as confirmed into existing
    from profiles p join auth.users u on u.id = p.id
   where lower(u.email) = addr limit 1;
  if found and (existing.org_id is not null or existing.confirmed) then
    if existing.org_id = public.current_org() then
      raise exception 'invite_user: % is already a member of this workspace', addr;
    elsif existing.org_id is not null then
      raise exception 'invite_user: % already belongs to another workspace', addr;
    end if;
    perform public.assert_seat_available(public.current_org());
    perform public.attach_orgless_login('invite_user', addr, existing.id, public.current_org(), p_role);
    insert into invites (email, org_id, role, created_by, accepted_at)
    values (addr, public.current_org(), p_role, auth.uid(), now())
    on conflict (email, org_id) do update
      set role = excluded.role, created_by = excluded.created_by, accepted_at = now();
    return 'attached';
  end if;
  if exists (select 1 from invites where lower(email) = addr and accepted_at is null
             and org_id <> public.current_org()) then
    raise exception 'invite_user: % already has an open invite to another workspace', addr;
  end if;
  -- Re-sending an open invite to the same address takes no new seat.
  if not exists (select 1 from invites where lower(email) = addr and org_id = public.current_org()
                 and accepted_at is null) then
    perform public.assert_seat_available(public.current_org());
  end if;
  insert into invites (email, org_id, role, created_by)
  values (addr, public.current_org(), p_role, auth.uid())
  on conflict (email, org_id) do update
    set role = excluded.role, created_by = excluded.created_by, created_at = now(), accepted_at = null;
  return 'invited';
end $$;

drop function if exists public.create_org(text, text);
create or replace function public.create_org(p_name text, p_admin_email text,
                                             p_max_users int default null, p_max_accounts int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  addr text := lower(trim(p_admin_email));
  existing_id uuid;
  existing_org uuid;
  existing_confirmed boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'create_org: platform admin only';
  end if;
  if coalesce(length(trim(p_name)), 0) = 0 then
    raise exception 'create_org: name is required';
  end if;
  if not public.valid_email(addr) then
    raise exception 'create_org: % is not a valid email address', p_admin_email;
  end if;
  if p_max_users is not null and p_max_users < 2 then
    raise exception 'create_org: max users must be at least 2';
  end if;
  if p_max_accounts is not null and p_max_accounts < 5 then
    raise exception 'create_org: max accounts must be at least 5';
  end if;
  -- A retry must error, not duplicate. Both checks run before any insert; and the whole body
  -- is one transaction, so a later failure leaves no half-created org behind.
  if exists (select 1 from orgs where lower(trim(name)) = lower(trim(p_name))) then
    raise exception 'create_org: an org named % already exists', trim(p_name);
  end if;
  if exists (select 1 from invites where lower(email) = addr and accepted_at is null) then
    raise exception 'create_org: % already has an open invite', addr;
  end if;
  -- handle_new_user() fires only for a NEW login, so an admin address that already has one
  -- would never pick up the invite. As invite_user does: refuse a login in another workspace
  -- (before any insert), attach an org-less one below.
  select p.id, p.org_id, u.email_confirmed_at is not null into existing_id, existing_org, existing_confirmed
    from profiles p join auth.users u on u.id = p.id
   where lower(u.email) = addr limit 1;
  if existing_org is not null then
    raise exception 'create_org: % already belongs to another workspace', addr;
  end if;
  insert into orgs (name, max_users, max_accounts) values (trim(p_name), p_max_users, p_max_accounts) returning id into new_id;
  insert into settings (org_id, data) values (new_id, '{}'::jsonb);
  -- org_alert_prefs lives in email-alerts.sql, which may not be installed on a fresh stack.
  if to_regclass('public.org_alert_prefs') is not null then
    execute 'insert into org_alert_prefs (org_id) values ($1) on conflict (org_id) do nothing' using new_id;
  end if;
  -- Only a confirmed login becomes the admin now (see invite_user). An unconfirmed one gets
  -- the open invite, which handle_user_confirmed() honours once the address is verified.
  if existing_id is not null and existing_confirmed then
    perform public.attach_orgless_login('create_org', addr, existing_id, new_id, 'admin');
    insert into invites (email, org_id, role, created_by, accepted_at) values (addr, new_id, 'admin', auth.uid(), now());
  else
    insert into invites (email, org_id, role, created_by) values (addr, new_id, 'admin', auth.uid());
  end if;
  return new_id;
end $$;

-- Runs as the caller for guard_profile_org: auth.uid() is set and is_platform_admin() is
-- true, so the trigger lets the move through. Do not exempt definer functions from it.
create or replace function public.switch_org(p_org_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'switch_org: platform admin only';
  end if;
  if not exists (select 1 from orgs where id = p_org_id) then
    raise exception 'switch_org: no such org';
  end if;
  update profiles set org_id = p_org_id where id = auth.uid();
end $$;

drop function if exists public.list_orgs();
create or replace function public.list_orgs()
returns table(id uuid, name text, created_at timestamptz, users int, disabled boolean,
              seats int, accounts int, max_users int, max_accounts int)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'list_orgs: platform admin only';
  end if;
  return query
    select o.id, o.name, o.created_at,
           (select count(*)::int from profiles p where p.org_id = o.id and not p.disabled),
           o.disabled,
           public.org_seat_count(o.id),
           (select count(*)::int from accounts a where a.org_id = o.id),
           o.max_users, o.max_accounts
    from orgs o order by o.created_at;
end $$;

-- Any org may be disabled, OneVio included: org_enabled() exempts the platform admin, so
-- this cannot lock its caller out.
create or replace function public.set_org_disabled(p_org_id uuid, p_disabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'set_org_disabled: platform admin only';
  end if;
  update orgs set disabled = p_disabled where id = p_org_id;
  if not found then
    raise exception 'set_org_disabled: no such org';
  end if;
end $$;

-- A limit below current usage is allowed: nothing is removed, the client just cannot add more.
create or replace function public.set_org_limits(p_org_id uuid, p_max_users int, p_max_accounts int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'set_org_limits: platform admin only';
  end if;
  if p_max_users is not null and p_max_users < 2 then
    raise exception 'set_org_limits: max users must be at least 2';
  end if;
  if p_max_accounts is not null and p_max_accounts < 5 then
    raise exception 'set_org_limits: max accounts must be at least 5';
  end if;
  update orgs set max_users = p_max_users, max_accounts = p_max_accounts where id = p_org_id;
  if not found then
    raise exception 'set_org_limits: no such org';
  end if;
end $$;

revoke execute on function public.invite_user(text, text) from public, anon;
revoke execute on function public.create_org(text, text, int, int) from public, anon;
revoke execute on function public.switch_org(uuid) from public, anon;
revoke execute on function public.list_orgs() from public, anon;
revoke execute on function public.set_org_disabled(uuid, boolean) from public, anon;
grant execute on function public.invite_user(text, text) to authenticated;
grant execute on function public.create_org(text, text, int, int) to authenticated;
grant execute on function public.switch_org(uuid) to authenticated;
grant execute on function public.list_orgs() to authenticated;
grant execute on function public.set_org_disabled(uuid, boolean) to authenticated;
revoke execute on function public.set_org_limits(uuid, int, int) from public, anon;
grant execute on function public.set_org_limits(uuid, int, int) to authenticated;

-- ---------- demo requests (onevio.in) ----------
-- The public site posts to the demo-form Worker, which checks Cloudflare Turnstile and then
-- calls submit_demo_request with a shared secret. The anon key alone can reach this function,
-- so the secret -- not the captcha -- is what the database relies on.
create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null, company text not null, email text not null,
  team_size text, message text, source text not null default 'onevio.in'
);
alter table public.demo_requests enable row level security;   -- no policies: RPCs only
create index if not exists demo_requests_email_time on public.demo_requests (lower(email), created_at);

create table if not exists public.demo_form_config (
  id int primary key check (id = 1),
  secret text not null default ''
);
alter table public.demo_form_config enable row level security; -- no policies: operator SQL only
insert into public.demo_form_config (id) values (1) on conflict (id) do nothing;

create or replace function public.submit_demo_request(p_secret text, p_name text, p_company text,
  p_email text, p_team_size text, p_message text, p_website text)
returns text language plpgsql security definer set search_path = public as $$
declare
  cfg text; n text := trim(coalesce(p_name, '')); c text := trim(coalesce(p_company, ''));
  e text := lower(trim(coalesce(p_email, ''))); ts text := nullif(trim(coalesce(p_team_size, '')), '');
  m text := nullif(trim(coalesce(p_message, '')), ''); new_id uuid;
begin
  select secret into cfg from demo_form_config where id = 1;
  if coalesce(cfg, '') = '' or p_secret is null or p_secret <> cfg then
    raise exception 'submit_demo_request: not allowed';
  end if;
  if coalesce(trim(p_website), '') <> '' then return 'ok'; end if;   -- honeypot: pretend success
  if length(n) not between 1 and 120 then raise exception 'submit_demo_request: name must be 1-120 characters'; end if;
  if length(c) not between 1 and 120 then raise exception 'submit_demo_request: company must be 1-120 characters'; end if;
  if length(e) > 200 or not public.valid_email(e) then raise exception 'submit_demo_request: email is not valid'; end if;
  if ts is not null and ts not in ('1–5', '6–20', '21–50', '50+') then raise exception 'submit_demo_request: team size is not valid'; end if;
  if m is not null and length(m) > 2000 then raise exception 'submit_demo_request: message is too long'; end if;
  if (select count(*) from demo_requests where lower(email) = e and created_at > now() - interval '24 hours') >= 3
     or (select count(*) from demo_requests where created_at > now() - interval '24 hours') >= 200 then
    raise exception 'Too many requests — please email us instead.';
  end if;
  insert into demo_requests (name, company, email, team_size, message)
    values (n, c, e, ts, m) returning id into new_id;
  -- The email lives in email-alerts.sql, which may not be installed. Never let mail break a request.
  -- Both it and log_error_system are looked up at run time and called dynamically, so this file
  -- does not depend on email-alerts.sql.
  if to_regprocedure('public.notify_demo_request(uuid)') is not null then
    begin
      execute 'select public.notify_demo_request($1)' using new_id;
    exception when others then
      if to_regprocedure('public.log_error_system(text, text, text, jsonb)') is not null then
        begin
          execute 'select public.log_error_system($1, $2, $3, $4)'
            using 'demo-request-email-failed', 'write_failed', sqlerrm, jsonb_build_object('id', new_id);
        exception when others then null;
        end;
      else
        null;
      end if;
    end;
  end if;
  return 'ok';
end $$;

create or replace function public.list_demo_requests()
returns table(id uuid, created_at timestamptz, name text, company text, email text, team_size text, message text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'list_demo_requests: platform admin only'; end if;
  return query select d.id, d.created_at, d.name, d.company, d.email, d.team_size, d.message
    from demo_requests d order by d.created_at desc limit 200;
end $$;

revoke execute on function public.submit_demo_request(text, text, text, text, text, text, text) from public;
revoke execute on function public.list_demo_requests() from public, anon;
grant execute on function public.submit_demo_request(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.list_demo_requests() to authenticated;

-- ---------- attachments (Supabase Storage) ----------
-- Private bucket: every read goes through attachments_read below, so a disabled user, another
-- org, or a Lead outside the account gets nothing. The app opens files through short-lived
-- signed URLs (createSignedUrl, 60s), which are minted only after that policy passes. Stored
-- public URLs stop working on their own; the app derives the path from them, so no row is
-- rewritten. It was public until 2026-10-13: the do-update below flips existing installs.
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false)
on conflict (id) do update set public = false;

-- Gated the same way as the entity tables: a disabled user must not read or upload files
-- just because the storage policies live apart from the do-block loops above.
--
-- Org-prefixed: every new object lives under <org_id>/<account_id>/<file>, and the first
-- path segment must be the caller's org on read, upload and delete.
--
-- Legacy objects (uploaded before multi-tenancy, first segment = an account id, not a uuid
-- of an org) are NOT moved. Renaming storage.objects.name in SQL only renames the catalogue
-- row: the blob in the storage backend stays keyed by the old name, so every legacy file
-- would 404 and its row could not be deleted through SQL either (Supabase's trigger refuses
-- direct deletes). Instead, read and delete also accept a non-uuid first segment for the
-- default org, which owns every pre-multitenant file. Upload never does: new files must
-- carry the org prefix. Stored links (accounts.data.documents[], activities.data.attachments[],
-- tasks.data.attachments[]) therefore stay valid unchanged, and nothing is rewritten.
drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and (select public.is_active())
         and ((storage.foldername(name))[1] = (select public.current_org())::text
              or ((select public.current_org()) = '00000000-0000-0000-0000-000000000001'
                  and (storage.foldername(name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
         and (not (select public.lead_restricted()) or public.lead_owns((select public.current_org()), (storage.foldername(name))[2])
              or public.lead_owns((select public.current_org()), (storage.foldername(name))[1])));
drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and (select public.is_active())
              and (storage.foldername(name))[1] = (select public.current_org())::text
              and (not (select public.lead_restricted()) or public.lead_owns((select public.current_org()), (storage.foldername(name))[2])));
drop policy if exists attachments_delete on storage.objects;
create policy attachments_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and (select public.is_active())
         and ((storage.foldername(name))[1] = (select public.current_org())::text
              or ((select public.current_org()) = '00000000-0000-0000-0000-000000000001'
                  and (storage.foldername(name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
         and (not (select public.lead_restricted()) or public.lead_owns((select public.current_org()), (storage.foldername(name))[2])
              or public.lead_owns((select public.current_org()), (storage.foldername(name))[1])));

-- ---------- implementation projects (spec 2026-10-26) ----------
-- Tables are created next to the entity tables (above). Their own policies, not the entity
-- loops: any active member of the org may read, create and edit (the triggers below decide
-- WHICH edits); only an implementation lead or admin deletes. A restricted lead is scoped by
-- data.accountId, judged on the STORED row via lead_child_ok because ON CONFLICT DO UPDATE
-- checks SELECT USING against merge_row's proposed (patch-only) row.
do $$
declare t text;
begin
  foreach t in array array['projects','project_tasks'] loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using ((select public.is_active()) and org_id = (select public.current_org()) and (not (select public.lead_restricted()) or public.lead_child_ok(%1$L, org_id, id, data)))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check ((select public.is_active()) and org_id = (select public.current_org()))', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using ((select public.is_active()) and org_id = (select public.current_org()) and (not (select public.lead_restricted()) or public.lead_child_ok(%1$L, org_id, id, data))) with check ((select public.is_active()) and org_id = (select public.current_org()) and (not (select public.lead_restricted()) or public.lead_owns(org_id, data->>''accountId'')))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using ((select public.is_impl_manager()) and org_id = (select public.current_org()))', t);
    -- A restricted lead creates projects/tasks only under their own accounts (same trigger as
    -- the CRM child tables; the insert policy cannot judge a patch-only proposed row).
    execute format('drop trigger if exists guard_child_account on public.%I', t);
    execute format('create trigger guard_child_account before insert on public.%I for each row execute function public.guard_child_account()', t);
  end loop;
end $$;

-- Ruling 2026-10-26: the project's implementer may also delete tasks on their own project.
drop policy if exists project_tasks_delete on public.project_tasks;
create policy project_tasks_delete on public.project_tasks for delete to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org())
         and ((select public.is_impl_manager())
              or exists (select 1 from public.projects p where p.org_id = project_tasks.org_id
                         and p.id = project_tasks.data->>'projectId'
                         and p.data->>'implementerId' = auth.uid()::text)));

-- Is the caller the CSM (by display name, read live) of this account? Names, not ids: the
-- account's csm field is free text kept in sync by renameEverywhere().
create or replace function public.is_account_csm(p_org uuid, p_account text)
returns boolean language sql stable security definer set search_path = public as
$$ select public.is_active() and exists (
     select 1 from accounts a join profiles p on p.id = auth.uid()
      where a.org_id = p_org and a.id = p_account
        and coalesce(a.data->>'csm', '') <> '' and a.data->>'csm' = p.name) $$;
revoke execute on function public.is_account_csm(uuid, text) from public, anon;
grant execute on function public.is_account_csm(uuid, text) to authenticated;

-- Stage and assignment rules, mirroring canTransition in src/lib/implementation.js.
-- BEFORE INSERT also fires for merge_row's upsert of an EXISTING id, where NEW is only the
-- patch: that is an edit, so it is let through here and judged by the UPDATE firing, which
-- sees the merged row against OLD.
create or replace function public.guard_project()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  od jsonb;
  old_stage text;
  new_stage text := new.data->>'stage';
  mgr boolean;
  acct text;
begin
  if auth.uid() is null then return new; end if;   -- SQL editor / migrations
  if not public.is_active() then raise exception 'Your access has been removed'; end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from projects where org_id = new.org_id and id = new.id) then return new; end if;
    od := '{}'::jsonb;
  else
    od := old.data;
  end if;
  old_stage := od->>'stage';
  mgr := public.is_impl_manager();
  acct := coalesce(od->>'accountId', new.data->>'accountId');

  if coalesce(new.data->>'implementerId', '') <> coalesce(od->>'implementerId', '') and not mgr then
    raise exception 'Only an implementation lead or admin can assign the implementer';
  end if;
  -- Leaving Handover/Queued for any later stage (planning, or a skip ahead) is a lead's call.
  if tg_op = 'UPDATE' and coalesce(old_stage, 'handover') in ('handover', 'queued')
     and coalesce(new_stage, 'handover') not in ('handover', 'queued') and not mgr then
    raise exception 'Only an implementation lead or admin can start planning';
  end if;
  if old_stage = 'queued' and new_stage = 'planning' and not mgr then
    raise exception 'Only an implementation lead or admin can start planning';
  end if;
  if new_stage = 'live' and old_stage is distinct from 'live' then
    if old_stage is distinct from 'csm_review' then
      raise exception 'A project goes live only from CSM review';
    end if;
    if not exists (select 1 from project_tasks where org_id = new.org_id and data->>'projectId' = new.id)
       or exists (select 1 from project_tasks where org_id = new.org_id and data->>'projectId' = new.id
                  and coalesce(data->>'signoff', '') <> 'signed') then
      raise exception 'Every task must be signed off before a project goes live';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if not mgr and coalesce(new_stage, '') not in ('handover', 'queued') then
      raise exception 'A new project must start in Handover or Queued';
    end if;
    return new;
  end if;

  -- From Planning on, the project belongs to its implementer and the implementation leads.
  -- The one exception: the account CSM closes CSM review (send back, or go live).
  if coalesce(old_stage, 'handover') not in ('handover', 'queued') and new.data is distinct from od
     and not mgr and coalesce(od->>'implementerId', '') <> auth.uid()::text then
    if not (old_stage = 'csm_review' and new_stage in ('in_progress', 'live')
            and public.is_account_csm(new.org_id, acct)) then
      raise exception 'Only the implementer, an implementation lead or an admin can change this project';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.guard_project() from public, anon, authenticated;
drop trigger if exists guard_project on public.projects;
create trigger guard_project
  before insert or update on public.projects
  for each row execute function public.guard_project();

-- Task rules: sign-off fields belong to the account CSM (or an admin); everything else to the
-- implementer, an implementation lead or an admin. A CSM's "send back" also resets status to
-- todo (applySignoff), so that status change rides with the verdict. Same upsert handling as
-- guard_project above.
create or replace function public.guard_project_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  od jsonb;
  proj jsonb;
  sign_keys text[] := array['signoff', 'signedBy', 'signedAt', 'signoffNote'];
  sign_changed boolean;
  other_changed boolean;
begin
  if auth.uid() is null then return new; end if;
  if not public.is_active() then raise exception 'Your access has been removed'; end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from project_tasks where org_id = new.org_id and id = new.id) then return new; end if;
    od := '{}'::jsonb;
  else
    od := old.data;
    if coalesce(new.data->>'projectId', '') <> coalesce(od->>'projectId', '') then
      raise exception 'A task cannot move to another project';
    end if;
  end if;
  select data into proj from projects where org_id = new.org_id and id = new.data->>'projectId';
  if proj is null then raise exception 'A task must belong to an existing project'; end if;
  if coalesce(new.data->>'accountId', '') <> coalesce(proj->>'accountId', '') then
    raise exception 'A task''s account must match its project''s';
  end if;

  sign_changed := coalesce(new.data->>'signoff', 'pending') <> coalesce(od->>'signoff', 'pending')
    or coalesce(new.data->>'signedBy', '') <> coalesce(od->>'signedBy', '')
    or coalesce(new.data->>'signedAt', '') <> coalesce(od->>'signedAt', '')
    or coalesce(new.data->>'signoffNote', '') <> coalesce(od->>'signoffNote', '');
  if sign_changed and new.data->>'signoff' = 'returned' and new.data->>'status' = 'todo' then
    sign_keys := sign_keys || array['status'];
  end if;
  other_changed := tg_op = 'INSERT' or (new.data - sign_keys) is distinct from (od - sign_keys);

  if sign_changed and not (public.is_admin() or public.is_account_csm(new.org_id, proj->>'accountId')) then
    raise exception 'Only the account CSM or an admin can sign off a task';
  end if;
  if other_changed and not (public.is_impl_manager() or coalesce(proj->>'implementerId', '') = auth.uid()::text) then
    raise exception 'Only the implementer, an implementation lead or an admin can change this task';
  end if;
  return new;
end $$;
revoke execute on function public.guard_project_task() from public, anon, authenticated;
drop trigger if exists guard_project_task on public.project_tasks;
create trigger guard_project_task
  before insert or update on public.project_tasks
  for each row execute function public.guard_project_task();
