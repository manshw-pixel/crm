# onevio.in Marketing Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public site at onevio.in that sells OneVio CRM, with these parts:
- home page;
- four SEO feature pages;
- NRR calculator;
- privacy page and 404;
- a Turnstile-protected demo form whose requests land in Supabase, show on the Clients console and email the owner.

**Architecture:** Two repos.
- **`crm`** (this worktree, branch `marketing-site`):
  - the `demo_requests` table and RPCs;
  - the request email;
  - the `workers/demo-form` Cloudflare Worker (Turnstile check, then RPC with a shared secret);
  - the console card;
  - a screenshot script that renders the app with fictional demo data.
- **New `onevio-site`** (local folder `D:/AI Project/onevio-site`):
  - hand-written static HTML/CSS;
  - a tiny partial-stamping script;
  - tests;
  - published by GitHub Pages.

**Tech Stack:**
- Postgres/Supabase SQL.
- React-in-JSX CRM (`src/NN-*.jsx`).
- A Cloudflare Worker, bundled with esbuild and pasted into the dashboard.
- Plain HTML/CSS/JS for the site.
- Node `node:test` and Playwright for tests.
- `sharp` (site devDependency) for WebP and OG images.

**Spec:** `docs/superpowers/specs/2026-10-08-marketing-site-design.md` (in the crm repo). The approved full-page mockup is
`.superpowers/brainstorm/226-1791448011/content/home-full.html` in this worktree. It is the visual reference for structure, copy and styling. Copy it into the site repo as `design/home-mockup.html` in Task 7.

## Global Constraints

**Honesty rule:**
- Every claim maps to a shipped feature.
- No customer logos, testimonials, ratings, user counts or uptime figures.
- No `aggregateRating`.
- Screenshots use fictional demo data only.

**Claims:** the user did NOT confirm "Bring a sample CSV and we'll load it live" or "No commitment, no card". Use
`A 30-minute walkthrough with a CS lead` and `Your own separate workspace if you go ahead` instead. Never ship the unconfirmed two.

**Health score copy** uses the app's real defaults:
- usage 30, sentiment 20, support tickets 15, recency 20, NPS 15, value 0;
- weights are adjustable in Settings;
- bands are Green, Yellow and Red.

**Values:**
- Login URL: `https://crm.onevio.in/crm.html`.
- Contact and recipient email: `manshw@gmail.com`.
- Worker URL: `https://demo.onevio.in/`.

**Block and UI copy:** verbatim from the spec.
- Success: `Thanks — we'll be in touch within one working day.`
- Rate limit: `Too many requests — please email us instead.`

**Brand:**
- Logo: the CRM favicon "OV" SVG plus the wordmark `One` + `Vio` (Inter 800, "Vio" `#4f46e5`).
- Colours: background `#f5f6fa`; accent `#4f46e5`.
- Fonts: headings in Bricolage Grotesque 800; body in IBM Plex Sans.

**SQL:** additive and re-runnable. Definer functions set `search_path = public`. Revoke from `public, anon` explicitly, then grant only what's intended.

**Testing:**
- Every RLS block assertion has a positive control on the same session.
- Tests wait on conditions, never fixed sleeps.
- No Docker locally, so RLS tests run in CI only (PR `pull_request` trigger). Never `workflow_dispatch` the crm workflow on a branch, because it can deploy.

**Worktrees:** never junction `node_modules`; run `npm ci` in each.

**Commits:** messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use a second `-m`; never put it in the subject.

**Outward actions** (creating the GitHub repo, pushing, enabling Pages): the controller does these after the user confirms. Implementers never do.

## Review Focus

1. **A bot calling `submit_demo_request` directly** with the public anon key, skipping Turnstile. It must be refused without the shared secret. Pinned in Task 1.
2. **A form submission when Turnstile fails or the Worker is down.** The form shows the error state with the email, never a fake success. Pinned in Task 9.
3. **A cross-origin POST to the Worker** (another site embedding the form). It must be refused before any captcha or RPC call. Pinned in Task 3.
4. **Feature-page or FAQ copy that overstates the app**, e.g. inventing integrations, AI or SSO. It must be checked against the app. Pinned by the review checklist in Tasks 8 and 10.
5. **Phone width (360px):** no horizontal scroll on any page, a working menu, and a usable calculator. Pinned in Task 12.

---

## Part 1: crm repo (worktree `D:/AI Project/crm-site`, branch `marketing-site`)

### Task 1: Demo requests in SQL

**Files:**
- Modify: `supabase-setup.sql`. Add a new section after the onboarding RPCs (after the `grant execute ... set_org_limits` lines).
- Create: `tests/rls/demo-requests.test.mjs`
- Modify: `tests/rls/run.mjs` (import it directly above `migration.test.mjs`)

**Interfaces (produces):**
- Table `public.demo_requests(id, created_at, name, company, email, team_size, message, source)`.
- Table `public.demo_form_config(id int primary key check (id = 1), secret text)`. RLS on, no policies.
- `public.submit_demo_request(p_secret text, p_name text, p_company text, p_email text, p_team_size text, p_message text, p_website text) returns text`. Returns `'ok'`. Executable by anon and authenticated.
- `public.list_demo_requests() returns table(id uuid, created_at timestamptz, name text, company text, email text, team_size text, message text)`. Platform admin only.

- [ ] **Step 1: Write the failing RLS tests.** Read `tests/rls/fixtures.mjs` first: `sessions.anon`, `sessions.platform`, `sessions.admin`, `sql()`.

```js
// Demo requests from onevio.in. The public anon key reaches submit_demo_request, so the shared
// secret (held only by the demo-form Worker) is what keeps bots that skip Turnstile out.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql } from "./fixtures.mjs";

const SECRET = "test-demo-secret-0123456789";
const setSecret = s => sql(`insert into public.demo_form_config (id, secret) values (1, $1)
  on conflict (id) do update set secret = excluded.secret`, [s]);
const args = (o = {}) => ({ p_secret: SECRET, p_name: "Asha Menon", p_company: "Kestrel Analytics",
  p_email: `asha+${Date.now()}${Math.random().toString(36).slice(2, 6)}@kestrel.test`, p_team_size: "6–20",
  p_message: "Renewals", p_website: "", ...o });
const count = async email => (await sql(`select count(*)::int n from demo_requests where email = $1`, [email]))[0].n;
const clean = () => sql(`delete from demo_requests where email like '%@kestrel.test'`);

test("submit needs the shared secret; with it, the request is stored", async () => {
  try {
    await setSecret(SECRET);
    const none = args({ p_secret: null }), wrong = args({ p_secret: "nope" }), good = args();
    const r1 = await sessions.anon.rpc("submit_demo_request", none);
    const r2 = await sessions.anon.rpc("submit_demo_request", wrong);
    assert(r1.error && r2.error, `refused without/with wrong secret: ${JSON.stringify([r1, r2])}`);
    assert(await count(none.p_email) === 0 && await count(wrong.p_email) === 0, "a request was stored without the secret");
    const ok = await sessions.anon.rpc("submit_demo_request", good);
    assert(!ok.error && ok.data === "ok", `control: right secret failed: ${ok.error?.message}`);
    assert(await count(good.p_email) === 1, "request not stored");
  } finally { await clean(); }
});

test("an empty configured secret refuses everything", async () => {
  try {
    await setSecret("");
    const r = await sessions.anon.rpc("submit_demo_request", args({ p_secret: "" }));
    assert(r.error, "empty secret accepted");
  } finally { await setSecret(SECRET); await clean(); }
});

test("honeypot: a filled website field stores nothing but returns ok", async () => {
  try {
    await setSecret(SECRET);
    const a = args({ p_website: "http://spam.example" });
    const r = await sessions.anon.rpc("submit_demo_request", a);
    assert(!r.error && r.data === "ok", JSON.stringify(r));
    assert(await count(a.p_email) === 0, "honeypot submission stored");
  } finally { await clean(); }
});

test("validation rejects bad fields", async () => {
  await setSecret(SECRET);
  const bad = [{ p_name: "" }, { p_name: "x".repeat(121) }, { p_company: "  " }, { p_email: "not-an-email" },
    { p_team_size: "huge" }, { p_message: "x".repeat(2001) }];
  try {
    for (const b of bad) {
      const r = await sessions.anon.rpc("submit_demo_request", args(b));
      assert(r.error && /submit_demo_request:/.test(r.error.message), `accepted ${JSON.stringify(b)}: ${JSON.stringify(r)}`);
    }
    const ok = await sessions.anon.rpc("submit_demo_request", args({ p_team_size: null, p_message: null }));
    assert(!ok.error, `control: optional fields null failed: ${ok.error?.message}`);
  } finally { await clean(); }
});

test("rate limit: a 4th request from one email in 24h is refused", async () => {
  try {
    await setSecret(SECRET);
    const email = `limit${Date.now()}@kestrel.test`;
    for (let i = 0; i < 3; i++) {
      const r = await sessions.anon.rpc("submit_demo_request", args({ p_email: email }));
      assert(!r.error, `request ${i + 1} refused: ${r.error?.message}`);
    }
    const r4 = await sessions.anon.rpc("submit_demo_request", args({ p_email: email }));
    assert(r4.error && /Too many requests/.test(r4.error.message), `4th not refused: ${JSON.stringify(r4)}`);
  } finally { await clean(); }
});

test("nobody reads demo_requests directly; only the platform admin can list", async () => {
  try {
    await setSecret(SECRET);
    const a = args(); await sessions.anon.rpc("submit_demo_request", a);
    for (const s of ["anon", "admin", "user"]) {
      const { data } = await sessions[s].from("demo_requests").select("*");
      assert((data || []).length === 0, `${s} read demo_requests directly`);
    }
    const denied = await sessions.admin.rpc("list_demo_requests");
    assert(denied.error && /platform admin only/.test(denied.error.message), `org admin listed: ${JSON.stringify(denied)}`);
    const { data, error } = await sessions.platform.rpc("list_demo_requests");
    assert(!error && data.some(r => r.email === a.p_email), `control: platform admin cannot list: ${error?.message}`);
  } finally { await clean(); }
});
```

- [ ] **Step 2: Add the SQL.**

```sql
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
  if to_regprocedure('public.notify_demo_request(uuid)') is not null then
    begin
      execute 'select public.notify_demo_request($1)' using new_id;
    exception when others then
      perform public.log_error_system('demo_request_email', sqlerrm, jsonb_build_object('id', new_id));
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
```

Check `log_error_system`'s real signature with `grep -n "function public.log_error_system" supabase-setup.sql` and adapt the call. If it doesn't exist in supabase-setup.sql, drop the `perform` and use `null;` in the handler, and note this in the report.

- [ ] **Step 3: Verify statically.** No Docker locally. Run `node --check tests/rls/demo-requests.test.mjs`, and re-read the SQL against its neighbours. CI runs the suite on the PR.

- [ ] **Step 4: Commit.** "Store demo requests from onevio.in behind a shared secret".

### Task 2: Demo request email

**Files:**
- Modify: `email-alerts.sql`. Add a section after `settle_alert_sends`.
- Modify: `tests/rls/emailalerts.test.mjs`. Read how it stubs `alert_post`/pg_net and asserts sends; follow that exact pattern.

**Interfaces:**
- Consumes `alert_config`, `alert_post(url, headers, body)` and `html_escape`.
- Produces `public.notify_demo_request(p_id uuid) returns void`.

- [ ] **Step 1: Write the failing tests** in emailalerts.test.mjs, in its pattern:
  1. With alert_config set, one demo submission makes exactly one `alert_post`. The payload's `to` contains the platform admin's email, the subject is `New demo request: Kestrel Analytics`, and an HTML-special name like `<b>x</b>` arrives escaped.
  2. With alert_config's `api_key` = `PASTE_YOUR_BREVO_API_KEY` (unset), no `alert_post` happens, and the request is still stored. That's the positive control on storage.

- [ ] **Step 2: Implement.**

```sql
-- One email per demo request to every platform admin. Silent when Brevo is not configured:
-- the Clients console list is the record, the email a convenience.
create or replace function public.notify_demo_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cfg record; r record; tos jsonb;
begin
  select * into cfg from alert_config where id = 1;
  if not found or cfg.api_key is null or cfg.api_key = '' or cfg.api_key like 'PASTE_%' then return; end if;
  select * into r from demo_requests where id = p_id;
  if not found then return; end if;
  select coalesce(jsonb_agg(jsonb_build_object('email', u.email)), '[]'::jsonb) into tos
    from profiles p join auth.users u on u.id = p.id where p.platform_admin and not p.disabled;
  if jsonb_array_length(tos) = 0 then return; end if;
  perform public.alert_post(cfg.api_base,
    jsonb_build_object('api-key', cfg.api_key, 'content-type', 'application/json', 'accept', 'application/json'),
    jsonb_build_object(
      'sender', jsonb_build_object('email', cfg.from_email, 'name', cfg.from_name),
      'to', tos,
      'replyTo', jsonb_build_object('email', r.email, 'name', r.name),
      'subject', 'New demo request: ' || r.company,
      'htmlContent', '<h2>New demo request</h2><p><b>' || html_escape(r.name) || '</b>, '
        || html_escape(r.company) || '<br>' || html_escape(r.email)
        || '<br>Team size: ' || coalesce(html_escape(r.team_size), '—') || '</p><p>'
        || coalesce(html_escape(r.message), '') || '</p>'));
end $$;
revoke execute on function public.notify_demo_request(uuid) from public, anon, authenticated;
```

Match the headers and body shape that `send_alerts` already uses for Brevo. Read it and mirror it exactly; the block above is the intent.

- [ ] **Step 3: Static check, then commit.** "Email the owner when a demo request arrives".

### Task 3: demo-form Worker

**Files:**
- Create: `workers/demo-form/src/index.js`, `workers/demo-form/build.mjs` (copy touchpoints' build.mjs and adjust paths)
- Create: `tests/worker/demo-form.test.mjs`
- Modify: `package.json` scripts
  - `"build:demo-worker": "node workers/demo-form/build.mjs"`
  - `"test:worker": "node tests/worker/touchpoints.test.mjs && node tests/worker/demo-form.test.mjs"`

**Interfaces (produces):** `export default { async fetch(request, env) }`.
- **env:**
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY`;
  - `TURNSTILE_SECRET`, `DEMO_FORM_SECRET`;
  - optional `ALLOWED_ORIGINS` (comma list; default `https://onevio.in,https://www.onevio.in`).
- **Responses:** JSON `{ok:true}` or `{ok:false,error:"<code>",message:"<safe text>"}`.
- **Error codes:** `origin` (403), `method` (405), `too_large` (413), `bad_json` (400), `captcha` (400), `rejected` (400, carries the RPC's safe message), `unavailable` (502).

- [ ] **Step 1: Write the failing tests.** Read `tests/worker/touchpoints.test.mjs` for its runner and mock style. Stub `globalThis.fetch` with a recorder, and cover:
  1. An OPTIONS preflight from `https://onevio.in` returns 204 with `Access-Control-Allow-Origin: https://onevio.in`, `Allow-Methods: POST`, `Allow-Headers: content-type`. A preflight from `https://evil.example` returns 403 with no ACAO header.
  2. A POST from `https://evil.example` returns 403 `origin`, and fetch is never called.
  3. GET returns 405.
  4. A body over 8192 bytes returns 413, and fetch is never called.
  5. Invalid JSON returns 400 `bad_json`.
  6. Turnstile siteverify returning `{success:false}` gives 400 `captcha`. The only fetch is to `https://challenges.cloudflare.com/turnstile/v0/siteverify`, with form body `secret`, `response` = token, `remoteip` = the `CF-Connecting-IP` header. The RPC is not called.
  7. On success, the second fetch goes to `${SUPABASE_URL}/rest/v1/rpc/submit_demo_request` with `apikey`/`Authorization: Bearer` = anon key. The body has `p_secret: DEMO_FORM_SECRET` and each field mapped (`name`→`p_name` … `website`→`p_website`). The response is 200 `{ok:true}` with ACAO `https://onevio.in`.
  8. The RPC answers 400 with message `submit_demo_request: email is not valid`, giving 400 `rejected` with message `Please check your email address.`. `Too many requests — please email us instead.` passes through verbatim. Any other RPC error gives the generic `We couldn't send that. Please try again, or email us.`
  9. The RPC is unreachable (fetch throws), giving 502 `unavailable`.
  10. No response body ever contains `TURNSTILE_SECRET` or `DEMO_FORM_SECRET` values. Assert this across all cases.

- [ ] **Step 2: Implement `workers/demo-form/src/index.js`.** Plain ES module, no dependencies.
  - The origin allow-list, the 8 KB limit and the CORS headers are on every response for allowed origins.
  - Map the safe messages:
    - name → `Please enter your name.`
    - company → `Please enter your company.`
    - email → `Please check your email address.`
    - team size → `Please choose a team size.`
    - message → `Your message is too long.`
    - rate limit → verbatim.
    - otherwise → generic.
  - Never log secrets.

- [ ] **Step 3: Run.** `npm run test:worker` and `npm run build:demo-worker` must both pass.

- [ ] **Step 4: Commit.** "Add the demo-form Worker: Turnstile check, then the shared-secret RPC".

### Task 4: Demo requests on the Clients console

**Files:**
- Modify: `src/25-auth-admin.jsx` (`ClientConsole`: add `DemoRequestsCard` below the Clients card)
- Modify: `tests/health/harness.mjs` (the console rpc mock: `list_demo_requests` returns `window.__seedDemoRequests || []`)
- Modify: `tests/health/client-console.test.mjs`

- [ ] **Step 1: Failing tests.**
  1. Seed 2 requests and check the card titled `Demo requests (2)` renders name, company, email, team size and message. Rows newer than the stored last-seen time carry `data-demo-new`. Set `localStorage['onevio.demoSeen']` to a time between the two requests and assert only the newer one is marked.
  2. With no requests, the card says `No demo requests yet. They arrive from the form on onevio.in.`
  3. A non-platform admin (an org admin landing on the CRM) never calls `list_demo_requests`. Use the existing `__rpcCalls` pattern.

- [ ] **Step 2: Implement.**
  - **Data:** `DemoRequestsCard` calls `sb.rpc("list_demo_requests")` on mount and shows errors inline.
  - **Rows:** date (YYYY-MM-DD HH:mm local), **name** · company, email as selectable text, team size, message (clamped to 3 lines, expand on click).
  - **New marker:** read the last-seen value from localStorage in try/catch, and update it to now on unmount and on a "Mark all seen" click. New rows get an indigo dot.
  - **Theme:** use the existing `Card` component and slate/indigo classes, so dark mode works.

- [ ] **Step 3: Build and run.** `npm run build`, then run client-console, dark-mode and mobile.

- [ ] **Step 4: Commit.** "Show demo requests on the Clients console".

### Task 5: Screenshot script with a rich demo dataset

**Files:**
- Create: `tests/site-shots.mjs`
- Modify: `.gitignore` (add `site-shots/`)

**Interfaces (produces):** `node tests/site-shots.mjs` writes these PNGs, 1440×900 at deviceScaleFactor 2:

| File | Shows |
|---|---|
| `site-shots/dashboard.png` | full dashboard top |
| `site-shots/dashboard-dark.png` | same, dark theme |
| `site-shots/health.png` | health distribution plus the accounts list sorted by score |
| `site-shots/renewals.png` | Renewals view |
| `site-shots/arr-bridge.png` | Analytics expanded, ARR bridge card |
| `site-shots/account.png` | one account page with contacts, activities and the email touchpoint |
| `site-shots/tasks.png` | Tasks view or team tasks by owner |
| `site-shots/licenses.png` | License deployment card |
| `site-shots/settings-weights.png` | Settings health weights |

Each also gets a 1:1 element-crop variant where useful (`*-card.png`), cropped to the relevant card's bounding box.

- [ ] **Step 1: Build the dataset in the script.** Use `seedAccount` and `buildMockedHtml` from `tests/health/harness.mjs`, as `tests/make-demo.mjs` does.
  - **Org:** "Acme Analytics". **CSMs:** Priya, Rahul, Ananya.
  - **Accounts:** 25 with fictional names:
    - Northwind Logistics, Brightline Health, Kestrel Analytics, Harbor & Pine, Lumen Freight, Corvid Labs, and so on;
    - a mix of tiers, USD/INR/EUR, ARR from 40k to 400k, and renewal dates spread over 0–120 days;
    - health inputs spread so all three bands appear;
    - licenses on about 15 of them, with deployed set on about 12;
    - 2 churned with reasons;
    - arrEvents giving expansion and contraction over 12 months.
  - **Other rows:**
    - 12 monthly `snapshots` (Trends shows, with `snaps.length >= 2`);
    - about 30 tasks across owners, some overdue;
    - 6 open opportunities;
    - activities including one `email` touchpoint;
    - contacts on the showcased account.
  - Read the harness for every seed key it supports (`__seedRows.*`, snapshots key) before writing. Never use real customer names.

- [ ] **Step 2: Capture.** Use Playwright (from `tests/node_modules`) and wait for conditions (selectors), not timers. Expand Analytics via `[data-analytics-toggle]`, and set dark theme the way `tests/health/dark-mode.test.mjs` does.

- [ ] **Step 3: Run it.** `npm run build && node tests/site-shots.mjs`. Open 2–3 PNGs and check them with the Read tool. Verify there's no "Loading", no error toasts, and the charts are populated. Then report the file list.

- [ ] **Step 4: Commit** (script and .gitignore only). "Add the marketing screenshot script with fictional demo data".

### Task 6: Setup docs

**Files:** Modify `TEAM-SETUP.md`. Add a "Website demo form (onevio.in)" section after "Email touchpoints".

Steps, written for the user:
1. Re-run `supabase-setup.sql` (and `email-alerts.sql` for the email).
2. Set the secret: `update public.demo_form_config set secret = '<long random string>' where id = 1;`
3. Cloudflare → Turnstile → Add widget → hostnames `onevio.in`, `www.onevio.in` → copy the site key (public, goes in the site) and secret key.
4. Cloudflare → Workers → Create → paste `workers/demo-form/dist/worker.js` (from `npm run build:demo-worker`) → Settings → Variables:
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY` (as plain vars);
   - secrets `TURNSTILE_SECRET` and `DEMO_FORM_SECRET` (the same string as step 2).
5. Worker → Settings → Domains → add custom domain `demo.onevio.in`.
6. Test: submit the live form, then check the Clients console and the inbox.

Commit: "Document the website demo form setup".

---

## Part 2: onevio-site repo (`D:/AI Project/onevio-site`)

### Task 7: Scaffold

**Files (create):**
- `package.json` (private; devDependencies `playwright`, `sharp`; scripts `assemble`, `test`, `test:unit`, `images`)
- `.gitignore` (`node_modules/`, `test-results/`)
- `CNAME` (`onevio.in`), `robots.txt`, `sitemap.xml`, `.nojekyll`
- `site.css` (tokens and components, light and dark, from the mockup)
- `partials/head.html`, `partials/header.html`, `partials/footer.html`, `partials/demo.html`
- `scripts/assemble.mjs`
- `pages/*.html` (page sources)
- `design/home-mockup.html` (copied from the crm worktree path in the plan header)
- `tests/serve.mjs` (a tiny static server over the repo root)
- `tests/site.test.mjs`

**Assembly:**
- Page sources live in `pages/`, e.g. `pages/index.html`, `pages/customer-health-score.html`. They use `<!-- @include header -->` markers and a front-matter-like `<!-- @meta {json} -->` block (title, description, canonical, og image, JSON-LD).
- `scripts/assemble.mjs` writes `index.html`, `customer-health-score/index.html`, …, `404.html` and `privacy/index.html`, and regenerates `sitemap.xml` with today's date as `lastmod`.
- The generated output is committed, so Pages needs no build. The test fails if the output is stale: it runs assemble into a temp dir and diffs.

**Steps:**
- [ ] `git init` in `D:/AI Project/onevio-site` (local only; the controller creates the remote later), then `npm i -D playwright sharp` and `npx playwright install chromium`.
- [ ] Write `site.css` from the mockup:
  - **Light tokens:** `--bg #f5f6fa`, `--card #fff`, `--ink #121729`, `--body #4a5068`, `--muted #6b7189`, `--line #e3e5ee`, `--accent #4f46e5`, `--accent-soft #eef0ff`.
  - **Dark tokens** under `prefers-color-scheme: dark`, chosen for contrast; the accent lightens to `#8b8cf8`.
  - The header, buttons, sections, feature blocks, grid, steps, teams panel, demo card, FAQ `details` and footer are components built from those tokens.
  - A mobile menu (button plus panel) under 860px.
  - Focus-visible rings.
  - `prefers-reduced-motion` respected.
- [ ] Write the partials: the header with the inline OV SVG and wordmark; nav (Features dropdown via `<details>`, so it works without JS; NRR calculator; How it works; Book a demo); and Login linking to `https://crm.onevio.in/crm.html`.
- [ ] Write `scripts/assemble.mjs` and `tests/serve.mjs`.
- [ ] Add the first tests in `tests/site.test.mjs` (node:test plus Playwright against `serve.mjs`):
  - assemble output is fresh;
  - every page's Login href is exactly the Login URL;
  - every internal link and anchor target exists;
  - no horizontal scroll at 360px on any page;
  - every page has exactly one `<h1>`.
- [ ] Commit locally: "Scaffold the onevio.in site".

### Task 8: Home page

**Files:**
- Create: `pages/index.html`
- Create: `assets/shots/*.webp|png`
- Create: `scripts/images.mjs` (sharp: PNG to WebP at 1600w and 800w, plus 1200×630 OG crops)

- [ ] Run `node tests/site-shots.mjs` in the crm worktree (Task 5) and copy `site-shots/*.png` into `assets/shots-src/`. Run `npm run images` to make `assets/shots/<descriptive-name>-{800,1600}.webp` and PNG fallbacks:
  - `customer-success-dashboard`
  - `customer-health-score`
  - `renewal-management`
  - `arr-bridge-nrr-grr`
  - `customer-account-record`
  - `team-tasks`
  - `license-deployment`
  - `og-home`
- [ ] Build `pages/index.html` exactly as the approved mockup `design/home-mockup.html`: hero, six features, dashboard grid, how it works, built for teams, demo partial, FAQ, footer. Replace the stand-in product drawings with `<picture>` screenshots: WebP `srcset`, PNG fallback, width/height, alt text. The hero image is eager with `fetchpriority="high"`; the rest are lazy.
- [ ] Use the copy from the mockup, with these changes:
  - the honesty fixes in Global Constraints;
  - FAQ answers written in full, from real behaviour;
  - section H2s as in the spec's SEO section.
- [ ] Use the meta and JSON-LD from the spec (Organization, SoftwareApplication, FAQPage; no ratings).
- [ ] Extend the tests: JSON-LD parses and has the required fields, the FAQ JSON-LD matches the visible questions, and every image has alt, width and height.
- [ ] **Copy review checklist** (the reviewer will check this): every sentence maps to a feature that exists in the crm repo. Grep the src when unsure.
- [ ] Commit: "Build the home page".

### Task 9: Demo form

**Files:**
- Create: `demo-form.js`
- Modify: `partials/demo.html`

**The form:**
- Fields: name, company, email (`type=email`, `autocomplete`), team size `<select>` with values `1–5`, `6–20`, `21–50`, `50+`, and an optional message.
- A visually hidden honeypot `website` input: `tabindex=-1`, `autocomplete=off`, `aria-hidden`.
- The Turnstile container `<div class="cf-turnstile" data-sitekey="__TURNSTILE_SITE_KEY__">`. A placeholder is replaced at handover; the test uses Cloudflare's always-pass test key `1x00000000000000000000AA`.
- The Turnstile script is loaded `async defer` on pages that include the partial.

**`demo-form.js`:**
1. On submit, run `preventDefault`, then client-validate (required fields, email shape).
2. Read the token from the `cf-turnstile-response` hidden input. If it's empty, show `Please complete the check above.`
3. POST JSON to `https://demo.onevio.in/`, with the button disabled and `Sending…`.
4. On `{ok:true}`, replace the form with the success copy.
5. On an error, show the Worker's `message`, or the generic one, plus the contact line `Or email us at manshw@gmail.com` with a Copy button (`navigator.clipboard.writeText` in try/catch; on failure, select the text). Then reset Turnstile via `window.turnstile?.reset()`.
- Exports a pure `buildPayload(form)` for unit tests.

- [ ] **Tests:**
  - Unit test `buildPayload`.
  - Playwright: intercept `https://challenges.cloudflare.com/**` (serve a stub that sets the response token) and `https://demo.onevio.in/**`.
  - Assert the POST body fields, then the success state.
  - A 400 `{ok:false,message:"Please check your email address."}` shows that message and the email line.
  - A network failure shows the generic error and the email line, and never the success copy (Review Focus 2).
  - An empty token shows the prompt and makes no POST.
- [ ] Commit: "Wire the demo form to the Worker with Turnstile".

### Task 10: Four feature pages

**Files:**
- `pages/customer-health-score.html`
- `pages/renewal-management.html`
- `pages/nrr-grr-reporting.html`
- `pages/license-deployment-tracking.html`

Each page is 600–900 words following the spec's page structure: breadcrumb, H1 with the target phrase, intro, 3–4 H2 sections with 1–2 screenshots, a 3–4 question FAQ with FAQPage JSON-LD, BreadcrumbList and SoftwareApplication JSON-LD, the demo partial, a unique title/description and an OG image.

**True-to-app facts to use** (verify each in the crm src before writing):
- **Health:** the inputs and default weights above (Global Constraints). Weights are editable in Settings; bands are Green, Yellow and Red; alerts fire on health drops; daily digests.
- **Renewals:**
  - renewal stages;
  - playbook tasks auto-created inside 90 days of renewal;
  - QBR frequency and nudges;
  - renewal outcomes and declined reasons;
  - the renewals view.
- **NRR/GRR:**
  - existing customers means a start date older than 365 days;
  - the ARR bridge covers 12 months, in USD;
  - currency conversion;
  - churn analysis;
  - cohorts.
- **Licenses:**
  - total vs deployed;
  - blank means not recorded;
  - deployment % uses accounts with both figures;
  - lowest 5;
  - amber below 50%;
  - CSV columns.

- [ ] Extend the tests: unique titles and descriptions across all pages, each feature page linked from the home page and the footer, and breadcrumb JSON-LD valid.
- [ ] Commit: "Add the four feature pages".

### Task 11: NRR calculator

**Files:**
- Create: `pages/nrr-calculator.html`, `nrr-calculator.js`, `tests/nrr.test.mjs`

**Pure function (exported):**
`calcRetention({ start, expansion, contraction, churn }) -> { ok, error?, nrr, grr, end }`
- `end = start + expansion − contraction − churn`
- `nrr = end / start`
- `grr = min(1, (start − contraction − churn) / start)`
- Percentages are rounded to whole numbers for display only.
- **Errors:**
  - `Starting ARR must be more than 0.`
  - `Values can't be negative.`
  - `Contraction and churn can't be more than starting ARR.`

- [ ] **Unit tests:** the spec example (4,00,00,000 / 60,00,000 / 10,00,000 / 22,00,000 gives NRR 107%, GRR 92%, end 4,28,00,000); the GRR cap; each error; zero expansion; and floating-point inputs.
- [ ] **UI:**
  - A currency symbol picker (₹, $, €, £); formatting uses `en-IN` for ₹ and `en-US` otherwise.
  - Results update on input.
  - An SVG ARR bridge, with bars scaled to the max of start and end and labels inside the viewBox.
  - Inline validation messages.
  - It works without network: assert no requests are made during use.
- [ ] Copy (500–700 words), FAQ, JSON-LD (WebApplication and BreadcrumbList), and the "Get these numbers automatically → Book a demo" block.
- [ ] **Playwright tests:** typing the example shows `107%` and `92%`; an invalid input shows the message; no horizontal scroll at 360px.
- [ ] Commit: "Add the NRR and GRR calculator".

### Task 12: Privacy page, 404, SEO and quality pass

- [ ] **`pages/privacy.html`:**
  - what the form collects;
  - why;
  - where it's stored (Supabase);
  - that Cloudflare Turnstile is used as the spam check and sets no tracking cookies;
  - that nothing is sold;
  - the deletion contact (`manshw@gmail.com`);
  - the date.

  **`pages/404.html`:** home and Login links.
- [ ] **SEO tests across all pages:**
  - the title is 50–60 characters and the description 140–160 characters (allow ±10 and warn rather than fail for the calculator if needed; record any exception);
  - one H1;
  - canonical equals the page URL;
  - OG and Twitter tags present;
  - sitemap URLs equal the set of pages;
  - robots.txt references the sitemap.
- [ ] **Theme and mobile tests:**
  - Dark scheme (Playwright `colorScheme: 'dark'`): body background and text come from the dark tokens.
  - 360px: no horizontal scroll, the menu opens, and all nav links are reachable (Review Focus 5).
- [ ] **Lighthouse (manual, recorded in the report):** `npx lighthouse http://localhost:<port>/ --preset=desktop` is optional; run the mobile default on the home page and the calculator. Targets: ≥90 everywhere, SEO ≥95. Fix what it flags. Don't add the lighthouse package to the repo.
- [ ] **README.md:** how to edit pages (`pages/` and `partials/`, then `npm run assemble`), images, tests, and deploy.
- [ ] **GitHub Actions** `.github/workflows/test.yml`: on push and PR, run `npm ci`, install Playwright chromium, then `npm test`. Pages deploys from the branch root, so no deploy job is needed.
- [ ] Commit: "Privacy, 404, SEO checks and quality pass".

### Task 13: Handover (controller; outward steps need the user's OK)

1. **crm repo:** push `marketing-site` and open the PR. CI runs the RLS, worker and health suites. The user merges, then re-runs SQL (Task 6 docs).
2. **onevio-site:** with the user's confirmation:
   - `gh repo create manshw-pixel/onevio-site --public --source "D:/AI Project/onevio-site" --push`;
   - enable Pages (branch `main`, root) via `gh api`;
   - the user ticks Enforce HTTPS after DNS.
3. **The user's checklist,** given verbatim in chat:
   - Cloudflare DNS:
     - A records for `onevio.in` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`, all DNS only;
     - `www` CNAME → `manshw-pixel.github.io`.
   - Turnstile widget, then give the site key to Claude to replace `__TURNSTILE_SITE_KEY__` (one commit).
   - Worker deploy plus secrets plus the `demo.onevio.in` domain (TEAM-SETUP).
   - The SQL secret.
   - Google Search Console TXT verification, then submit `https://onevio.in/sitemap.xml`.
   - Bing import, LinkedIn page, and G2/Capterra/GetApp/Product Hunt listings.
4. **Live check:** https://onevio.in loads with valid HTTPS, Login opens the CRM, and a real demo request reaches the console and the inbox.
