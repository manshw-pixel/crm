-- surveys.sql -- NPS / CSAT surveys. PR 1: send, answer, unsubscribe. PR 2: template
-- validation (survey_template_valid) and the non-NPS throttle in send_survey.
--
-- HOW TO RUN: paste this whole file into the Supabase SQL editor and run it AFTER
-- supabase-setup.sql and email-alerts.sql (it reuses alert_config, alert_post and
-- html_escape). It is safe to re-run: every object uses `if not exists`,
-- `create or replace` or a drop-then-create.
--
-- Writes happen ONLY through the security-definer functions below. Authenticated users can
-- read surveys of their own org (leads: only accounts they own), and can never read the
-- token column. The public survey page (anon) reaches a survey only by its token.
-- Validation mirrors src/lib/surveys.js (validateAnswers, sendCandidates) and
-- src/lib/survey-templates.js (validateTemplate); keep them in step.

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables ----------
create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id text not null,
  contact_id text,
  contact_name text,
  contact_email text,
  contact_role text,
  template_id text not null,
  template_snapshot jsonb not null,
  source text not null default 'sent' check (source in ('sent','import')),
  import_id text,
  token text unique,
  sent_at timestamptz,
  expires_at timestamptz,
  submitted_at timestamptz,
  sent_by uuid
);
create index if not exists surveys_org_account on public.surveys (org_id, account_id);
create index if not exists surveys_org_sent on public.surveys (org_id, sent_at);

create table if not exists public.survey_answers (
  survey_id uuid not null references public.surveys(id) on delete cascade,
  question_id text not null,
  value_num numeric,
  value_text text,
  value_choices text[],
  primary key (survey_id, question_id)
);

alter table public.surveys enable row level security;
alter table public.survey_answers enable row level security;

-- ---------- privileges ----------
-- Column-level: the token is the survey's only credential, so it is never selectable by a
-- signed-in user. Revoke everything, then grant every OTHER column explicitly.
revoke all on public.surveys from anon, authenticated;
revoke all on public.survey_answers from anon, authenticated;
grant select (id, org_id, account_id, contact_id, contact_name, contact_email, contact_role,
              template_id, template_snapshot, source, import_id, sent_at, expires_at,
              submitted_at, sent_by)
  on public.surveys to authenticated;
revoke select (token) on public.surveys from authenticated, anon;
grant select on public.survey_answers to authenticated;

-- ---------- policies (read only; no insert/update/delete policies) ----------
drop policy if exists surveys_select on public.surveys;
create policy surveys_select on public.surveys for select to authenticated
  using ((select public.is_active()) and org_id = (select public.current_org())
         and (not (select public.lead_restricted()) or public.lead_owns(org_id, account_id)));

drop policy if exists survey_answers_select on public.survey_answers;
create policy survey_answers_select on public.survey_answers for select to authenticated
  using (exists (select 1 from public.surveys s
                  where s.id = survey_answers.survey_id
                    and (select public.is_active()) and s.org_id = (select public.current_org())
                    and (not (select public.lead_restricted()) or public.lead_owns(s.org_id, s.account_id))));

-- ---------- delete with the account ----------
create or replace function public.surveys_account_gone()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from surveys where org_id = old.org_id and account_id = old.id;
  return old;
end $$;
revoke execute on function public.surveys_account_gone() from public, anon, authenticated;
drop trigger if exists surveys_account_gone on public.accounts;
create trigger surveys_account_gone after delete on public.accounts
  for each row execute function public.surveys_account_gone();

-- ---------- helpers ----------
-- fillPlaceholders: known keys are substituted, unknown ones render blank. Unknown ones are
-- removed FIRST so a substituted value is never re-scanned as a placeholder name.
create or replace function public.survey_fill(p_text text, p_ctx jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare t text := coalesce(p_text, ''); k text;
begin
  t := regexp_replace(t, '\{(?!(firstName|accountName|csmName|orgName)\})\w+\}', '', 'g');
  foreach k in array array['firstName','accountName','csmName','orgName'] loop
    t := replace(t, '{' || k || '}', coalesce(p_ctx->>k, ''));
  end loop;
  return t;
end $$;
revoke execute on function public.survey_fill(text, jsonb) from public, anon, authenticated;

-- validateAnswers, plus: a whitespace-only text answer counts as blank.
create or replace function public.survey_answers_valid(p_questions jsonb, p_answers jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare k text; q jsonb; v jsonb; typ text; blank boolean; n numeric; ids text[];
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then return false; end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then return false; end if;
  select coalesce(array_agg(x->>'id'), '{}') into ids from jsonb_array_elements(p_questions) x;
  for k in select jsonb_object_keys(p_answers) loop
    if not (k = any(ids)) then return false; end if;
  end loop;
  for q in select * from jsonb_array_elements(p_questions) loop
    v := p_answers->(q->>'id');
    typ := jsonb_typeof(v);
    blank := v is null or typ = 'null'
          or (typ = 'string' and trim(v #>> '{}') = '')
          or (typ = 'array' and jsonb_array_length(v) = 0);
    if blank then
      if coalesce((q->>'required')::boolean, false) then return false; end if;
      continue;
    end if;
    if q->>'type' = 'nps' then
      if typ <> 'number' then return false; end if;
      n := (v #>> '{}')::numeric;
      if n <> trunc(n) or n < 0 or n > 10 then return false; end if;
    elsif q->>'type' = 'rating' then
      if typ <> 'number' then return false; end if;
      n := (v #>> '{}')::numeric;
      if n <> trunc(n) or n < 1 or n > coalesce((q->>'scale')::numeric, 5) then return false; end if;
    elsif q->>'type' = 'text' then
      if typ <> 'string' or length(v #>> '{}') > 4000 then return false; end if;
    elsif q->>'type' in ('single', 'multi') then
      -- Choice answers must be one of the question's options; no options means no valid answer.
      if jsonb_typeof(q->'options') is distinct from 'array' then return false; end if;
      if q->>'type' = 'single' then
        if typ <> 'string' or not (q->'options' @> jsonb_build_array(v)) then return false; end if;
      else
        if typ <> 'array' then return false; end if;
        if exists (select 1 from jsonb_array_elements(v) e
                    where jsonb_typeof(e) <> 'string' or not (q->'options' @> jsonb_build_array(e))) then
          return false;
        end if;
        if (select count(distinct e) from jsonb_array_elements(v) e) <> jsonb_array_length(v) then return false; end if;
      end if;
    else
      return false;   -- unknown question type
    end if;
  end loop;
  return true;
end $$;
revoke execute on function public.survey_answers_valid(jsonb, jsonb) from public, anon, authenticated;

-- validateTemplate (src/lib/survey-templates.js), plus: options must already be trimmed (the
-- client normalises before saving, so an untrimmed option means a hand-made payload).
create or replace function public.survey_template_valid(p jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare q jsonb; o jsonb; typ text; ids text[] := '{}'; opts text[]; n_nps int := 0; v_scale numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if jsonb_typeof(p->'name') is distinct from 'string' or trim(p->>'name') = ''
     or length(trim(p->>'name')) > 80 then return false; end if;
  if jsonb_typeof(p->'intro') not in ('string', 'null') then return false; end if;
  if length(trim(coalesce(p->>'intro', ''))) > 300 then return false; end if;
  if jsonb_typeof(p->'questions') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p->'questions') < 1 or jsonb_array_length(p->'questions') > 20 then return false; end if;
  for q in select * from jsonb_array_elements(p->'questions') loop
    if jsonb_typeof(q) <> 'object' then return false; end if;
    typ := q->>'type';
    if typ is null or typ not in ('nps', 'rating', 'single', 'multi', 'text') then return false; end if;
    if typ = 'nps' then n_nps := n_nps + 1; end if;
    if jsonb_typeof(q->'text') is distinct from 'string' or trim(q->>'text') = ''
       or length(trim(q->>'text')) > 300 then return false; end if;
    if coalesce(q->>'id', '') = any(ids) then return false; end if;
    ids := ids || coalesce(q->>'id', '');
    if typ = 'rating' then
      if q->'scale' is null or jsonb_typeof(q->'scale') = 'null' then v_scale := 5;
      elsif jsonb_typeof(q->'scale') = 'number' then v_scale := (q->>'scale')::numeric;
      else return false; end if;
      if v_scale not in (5, 7, 10) then return false; end if;
      if length(trim(coalesce(q->>'lowLabel', ''))) > 40 or length(trim(coalesce(q->>'highLabel', ''))) > 40 then
        return false;
      end if;
    elsif typ in ('single', 'multi') then
      if jsonb_typeof(q->'options') is distinct from 'array' then return false; end if;
      if jsonb_array_length(q->'options') < 2 or jsonb_array_length(q->'options') > 12 then return false; end if;
      opts := '{}';
      for o in select * from jsonb_array_elements(q->'options') loop
        if jsonb_typeof(o) <> 'string' then return false; end if;
        if (o #>> '{}') = '' or (o #>> '{}') <> trim(o #>> '{}') or length(o #>> '{}') > 80 then return false; end if;
        if lower(o #>> '{}') = any(opts) then return false; end if;
        opts := opts || lower(o #>> '{}');
      end loop;
    end if;
  end loop;
  return n_nps <= 1;
end $$;
revoke execute on function public.survey_template_valid(jsonb) from public, anon, authenticated;

-- ---------- send (admin only) ----------
create or replace function public.send_survey(p_account text, p_contact_ids text[], p_template jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.current_org();
  acct accounts; cfg alert_config;
  v_tpl text := p_template->>'id';
  v_cap int; v_today int;
  v_orgname text; v_from text; v_csm text; v_csm_email text; v_sender_name text;
  cid text; c jsonb; v_email text; v_reason text; open_sent timestamptz;
  eligible jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb; sent jsonb := '[]'::jsonb;
  e jsonb; v_id uuid; v_token text; v_link text; v_first text; ctx jsonb;
  q1 jsonb; v_btns text; i int; v_html text; v_invalid boolean; req bigint;
  v_throttle int; v_is_nps boolean; recent_sent timestamptz;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  -- Serialise sends per org: the pending check and the daily-cap count below are plain reads,
  -- so two concurrent sends could otherwise double-send or overshoot the cap.
  perform pg_advisory_xact_lock(hashtext('send_survey:' || v_org::text));
  if v_tpl is null or jsonb_typeof(p_template->'questions') is distinct from 'array' then
    raise exception 'template required';
  end if;
  if not public.survey_template_valid(p_template) then raise exception 'invalid template'; end if;
  v_is_nps := exists (select 1 from jsonb_array_elements(p_template->'questions') x where x->>'type' = 'nps');
  select coalesce(nullif(s.data->'surveys'->>'throttleDays', '')::int, 90) into v_throttle
    from settings s where s.org_id = v_org;
  v_throttle := coalesce(v_throttle, 90);
  select * into acct from accounts where org_id = v_org and id = p_account;
  if acct is null then raise exception 'account not found'; end if;

  -- sendCandidates, re-checked server side
  foreach cid in array coalesce(p_contact_ids, '{}') loop
    select data into c from contacts where org_id = v_org and id = cid and data->>'accountId' = p_account;
    v_email := trim(coalesce(c->>'email', ''));
    open_sent := null;
    select s.sent_at into open_sent from surveys s
     where s.org_id = v_org and s.template_id = v_tpl and s.contact_id = cid
       and s.submitted_at is null and s.expires_at::date >= current_date
     order by s.sent_at limit 1;
    -- Throttle (sendCandidates): a non-NPS send waits throttleDays after the contact's latest
    -- non-NPS survey. A survey is NPS when its snapshot has an nps question (by id otherwise).
    recent_sent := null;
    if not v_is_nps and v_throttle > 0 then
      select max(s.sent_at) into recent_sent from surveys s
       where s.org_id = v_org and s.contact_id = cid and s.sent_at > now() - make_interval(days => v_throttle)
         and not (case when jsonb_typeof(s.template_snapshot->'questions') = 'array'
                       then exists (select 1 from jsonb_array_elements(s.template_snapshot->'questions') x where x->>'type' = 'nps')
                       else s.template_id = 'nps-checkin' end);
    end if;
    v_reason := case
      when c is null then 'Not found'
      when v_email = '' then 'No email'
      when coalesce(c->>'surveyOptOut', '') <> '' then 'Opted out'
      -- surveyRecipient only decides the default tick in the UI; an explicitly passed
      -- unflagged contact is sent.
      when open_sent is not null then 'Survey pending since ' || trim(to_char(open_sent, 'FMDD Mon'))
      when recent_sent is not null then 'Surveyed ' || to_char((recent_sent at time zone 'utc')::date, 'FMDD Mon')
        || ' — wait until ' || to_char((recent_sent at time zone 'utc')::date + v_throttle, 'FMDD Mon')
    end;
    if v_reason is not null then
      skipped := skipped || jsonb_build_array(jsonb_build_object('contact_id', cid, 'reason', v_reason));
    elsif not exists (select 1 from jsonb_array_elements(eligible) x where x->>'id' = cid) then
      eligible := eligible || jsonb_build_array(c || jsonb_build_object('id', cid, 'email', v_email));
    end if;
  end loop;

  -- daily cap: per org, per UTC day, refused as a whole
  select coalesce(nullif(s.data->'surveys'->>'dailyCap', '')::int, 50),
         coalesce(s.data->'surveys'->>'fromName', '')
    into v_cap, v_from from settings s where s.org_id = v_org;
  v_cap := coalesce(v_cap, 50); v_from := coalesce(v_from, '');
  select count(*) into v_today from surveys
   where org_id = v_org and sent_at is not null
     and (sent_at at time zone 'utc')::date = (now() at time zone 'utc')::date;
  if v_today + jsonb_array_length(eligible) > v_cap then
    raise exception 'Daily survey limit reached (%). Try again tomorrow.', v_cap;
  end if;

  select * into cfg from alert_config where id = 1;
  if exists (select 1 from jsonb_array_elements(eligible) x where lower(x->>'email') not like '%.invalid')
     and (cfg is null or cfg.api_key like 'PASTE%') then
    raise exception 'email not configured: set the Brevo key (alert_config)';
  end if;

  select name into v_orgname from orgs where id = v_org;
  v_csm := nullif(trim(coalesce(acct.data->>'csm', '')), '');
  if v_csm is not null then
    select u.email::text into v_csm_email from profiles p join auth.users u on u.id = p.id
     where p.org_id = v_org and p.name = v_csm and not p.disabled limit 1;
  end if;
  v_sender_name := coalesce(nullif(v_from, ''), v_orgname);
  q1 := p_template->'questions'->0;

  for e in select * from jsonb_array_elements(eligible) loop
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into surveys (org_id, account_id, contact_id, contact_name, contact_email, contact_role,
                         template_id, template_snapshot, source, token, sent_at, expires_at, sent_by)
    values (v_org, p_account, e->>'id', e->>'name', e->>'email', e->>'role',
            v_tpl, p_template, 'sent', v_token, now(), now() + interval '30 days', auth.uid())
    returning id into v_id;

    insert into activities (org_id, id, data) values (v_org, 'sv-sent-' || v_id, jsonb_build_object(
      'type', 'survey', 'system', true,
      'date', to_char(current_date, 'YYYY-MM-DD'),
      'accountId', p_account, 'contactId', e->>'id', 'surveyId', v_id,
      'loggedBy', public.my_name(),
      'summary', format('Survey sent (%s) to %s', coalesce(p_template->>'name', v_tpl), coalesce(e->>'name', e->>'email'))))
    on conflict (org_id, id) do nothing;

    v_invalid := lower(e->>'email') like '%.invalid';
    if not v_invalid then
      v_link := 'https://crm.onevio.in/survey.html?t=' || v_token;
      v_first := split_part(trim(coalesce(e->>'name', '')), ' ', 1);
      ctx := jsonb_build_object('firstName', v_first, 'accountName', acct.data->>'name',
                                'csmName', v_csm, 'orgName', v_orgname);
      v_btns := '';
      if q1 is not null and q1->>'type' = 'nps' then
        for i in 0..10 loop
          v_btns := v_btns || format('<a href="%s&amp;q=%s&amp;v=%s" style="display:inline-block;min-width:28px;padding:6px 4px;margin:2px;border:1px solid #ccc;border-radius:4px;text-align:center;text-decoration:none;color:#222">%s</a>',
                                     html_escape(v_link), html_escape(q1->>'id'), i, i);
        end loop;
      end if;
      v_html := format('<p>%s,</p><p>%s</p><p>%s</p>%s%s<p><a href="%s" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none">Answer the survey</a></p><p style="font-size:12px;color:#888"><a href="%s&amp;u=1">Unsubscribe</a></p>',
        html_escape(case when v_first <> '' then 'Hi ' || v_first else 'Hi there' end),
        html_escape(case when v_csm is not null then v_csm || ' from ' || v_orgname else v_orgname end || ' would like your feedback'),
        html_escape(public.survey_fill(p_template->>'intro', ctx)),
        case when q1 is not null then '<p><b>' || html_escape(public.survey_fill(q1->>'text', ctx)) || '</b></p>' else '' end,
        case when v_btns <> '' then '<p>' || v_btns || '</p>' else '' end,
        html_escape(v_link), html_escape(v_link));
      req := public.alert_post(cfg.api_base,
        jsonb_build_object('api-key', cfg.api_key, 'content-type', 'application/json', 'accept', 'application/json'),
        jsonb_strip_nulls(jsonb_build_object(
          'sender', jsonb_build_object('email', cfg.from_email, 'name', v_sender_name),
          'to', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('email', e->>'email', 'name', e->>'name'))),
          'replyTo', case when v_csm_email is not null then jsonb_build_object('email', v_csm_email) end,
          'subject', format('%s would like your feedback', v_orgname),
          'htmlContent', v_html)));
      if req is null then raise exception 'send failed: no request id'; end if;
      sent := sent || jsonb_build_array(jsonb_build_object('contact_id', e->>'id', 'survey_id', v_id));
    else
      sent := sent || jsonb_build_array(jsonb_build_object('contact_id', e->>'id', 'survey_id', v_id, 'token', v_token));
    end if;
  end loop;

  return jsonb_build_object('sent', sent, 'skipped', skipped);
end $$;
revoke execute on function public.send_survey(text, text[], jsonb) from public, anon;
grant execute on function public.send_survey(text, text[], jsonb) to authenticated;

-- ---------- public page: read by token ----------
create or replace function public.get_survey(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s surveys; v_answers jsonb;
begin
  if coalesce(p_token, '') = '' then return null; end if;
  select * into s from surveys where token = p_token
     and (expires_at > now() or (submitted_at is not null and submitted_at > now() - interval '7 days'));
  if s is null then return null; end if;
  select jsonb_object_agg(question_id, coalesce(to_jsonb(value_num), to_jsonb(value_choices), to_jsonb(value_text)))
    into v_answers from survey_answers where survey_id = s.id;
  return jsonb_strip_nulls(jsonb_build_object(
    'orgName', (select name from orgs where id = s.org_id),
    'csmName', (select nullif(trim(data->>'csm'), '') from accounts where org_id = s.org_id and id = s.account_id),
    'firstName', nullif(split_part(trim(coalesce(s.contact_name, '')), ' ', 1), ''),
    'accountName', (select data->>'name' from accounts where org_id = s.org_id and id = s.account_id),
    'intro', s.template_snapshot->>'intro',
    'questions', s.template_snapshot->'questions',
    'answers', v_answers,
    'submittedAt', s.submitted_at)) ||
    jsonb_build_object('editable', s.submitted_at is null or s.submitted_at > now() - interval '7 days');
end $$;
revoke execute on function public.get_survey(text) from public;
grant execute on function public.get_survey(text) to anon, authenticated;

-- ---------- public page: submit ----------
create or replace function public.submit_survey(p_token text, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s surveys; k text; v jsonb; typ text;
begin
  if coalesce(p_token, '') = '' then return jsonb_build_object('ok', false); end if;
  select * into s from surveys where token = p_token
     and (expires_at > now() or (submitted_at is not null and submitted_at > now() - interval '7 days')) for update;
  if s is null then return jsonb_build_object('ok', false); end if;
  if s.submitted_at is not null and s.submitted_at <= now() - interval '7 days' then
    return jsonb_build_object('ok', false);
  end if;
  if not public.survey_answers_valid(s.template_snapshot->'questions', p_answers) then
    return jsonb_build_object('ok', false);
  end if;

  delete from survey_answers where survey_id = s.id;
  for k, v in select key, value from jsonb_each(p_answers) loop
    typ := jsonb_typeof(v);
    continue when typ = 'null' or (typ = 'string' and trim(v #>> '{}') = '')
               or (typ = 'array' and jsonb_array_length(v) = 0);
    insert into survey_answers (survey_id, question_id, value_num, value_text, value_choices) values (
      s.id, k,
      case when typ = 'number' then (v #>> '{}')::numeric end,
      case when typ = 'string' then v #>> '{}' end,
      case when typ = 'array' then array(select jsonb_array_elements_text(v)) end);
  end loop;

  if s.submitted_at is null then
    update surveys set submitted_at = now() where id = s.id;
    insert into activities (org_id, id, data) values (s.org_id, 'sv-ans-' || s.id, jsonb_build_object(
      'type', 'survey',
      'date', to_char(current_date, 'YYYY-MM-DD'),
      'accountId', s.account_id, 'contactId', s.contact_id, 'surveyId', s.id,
      'summary', format('Survey answered by %s', coalesce(s.contact_name, s.contact_email))))
    on conflict (org_id, id) do nothing;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.submit_survey(text, jsonb) from public;
grant execute on function public.submit_survey(text, jsonb) to anon, authenticated;

-- ---------- public page: unsubscribe ----------
create or replace function public.unsubscribe_survey(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s surveys;
begin
  if coalesce(p_token, '') = '' then return jsonb_build_object('ok', false); end if;
  select * into s from surveys where token = p_token;
  if s is null or s.contact_id is null then return jsonb_build_object('ok', false); end if;
  update contacts set data = data || jsonb_build_object('surveyOptOut', to_char(current_date, 'YYYY-MM-DD')),
                      updated_at = now()
   where org_id = s.org_id and id = s.contact_id;
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.unsubscribe_survey(text) from public;
grant execute on function public.unsubscribe_survey(text) to anon, authenticated;
