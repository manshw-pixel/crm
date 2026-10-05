# Email Touchpoint Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CSM forwards/Ccs a customer thread to a touchpoints address and it is logged as an `email` activity on the right account in their own org, or bounced back to them with the reason.

**Architecture:** One new SQL file, `touchpoints.sql`, applied after `supabase-setup.sql` and `email-alerts.sql`. Small pure helper functions (address parsing, quote stripping), one matching function, one bounce function reusing the existing Brevo seam (`alert_post`), and one `security definer` entry point `ingest_touchpoint(p_secret, p_message)` callable by `anon`. No app code changes; one health test proves the new activity fields render.

**Tech Stack:** Postgres (plpgsql/sql) on Supabase; RLS test suite in `tests/rls` (real Postgres + GoTrue, node + `pg` + supabase-js); health suite in `tests/health` (Playwright against `dist/crm.html`).

**Spec:** `docs/superpowers/specs/2026-10-05-email-touchpoint-ingest-design.md`

## Global Constraints

- All new SQL lives in `touchpoints.sql` at the repo root; it must be safely re-runnable (`create or replace`, `if not exists`, `on conflict do nothing`, `drop policy if exists`).
- `ingest_touchpoint` is the ONLY new function executable by `anon`; every other new function is revoked from `public, anon, authenticated`. `authenticated` must NOT be able to execute `ingest_touchpoint`.
- The placeholder secret `'CHANGE-ME'` must never be accepted.
- `ingest_log` stores no subject and no body. A `rejected_sender` row stores the sender's DOMAIN only.
- Unknown/disabled/org-less senders and senders in a disabled org get NO bounce.
- Bounces go only to the resolved CSM sender. The original body is never quoted in a bounce.
- Activity id is `'em-' || md5(message_id)`; activity `data` = `{type:"email", date, accountId, loggedBy, summary(≤200), details(≤4000, quotes stripped), source:"email", participants}`.
- Generic-domain blocklist, verbatim: gmail.com, googlemail.com, outlook.com, hotmail.com, live.com, yahoo.com, icloud.com, me.com, aol.com, proton.me, protonmail.com.
- Every absence assertion in a test is paired with a positive control (see memory "RLS anon-key vacuity": an absence check alone proved nothing five times).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Display-name and upper-case From** (`"Plain User" <USER@TEST.LOCAL>`) — expected to resolve to the CSM exactly as the bare lower-case address does. Pinned in Task 1 (`tp_addr`) and Task 3 (end-to-end).
2. **Contact emails stored with stray case/whitespace in CRM data** (`" Jane@Acme.COM "`) — expected to match. Pinned in Task 2.
3. **Customer writes from a subdomain** (`mail.acme.com` while the contact is `acme.com`) — expected: NO match (exact-domain only), so the CSM gets a bounce telling them to add the contact. Pinned in Task 2 so nobody "fixes" it silently.
4. **Missing or unparseable message date** — expected: the activity is dated today, not an error. Pinned in Task 3.
5. **Very long subject/body** — expected: truncated to 200/4000 chars, not rejected. Pinned in Task 3.

## Running the suites

- RLS suite: needs Docker and `supabase start`. Export the anon key first:
  `export SUPABASE_ANON_KEY=$(supabase status -o json | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).ANON_KEY))")`
  then `node tests/rls/run.mjs`. Never pipe it — the exit code is the gate. It runs every RLS file; read the PASS/FAIL lines for the new tests.
- Health suite: `npm run build` first (the harness loads `dist/crm.html`), then `node tests/health/run.mjs`, or one file with `node tests/health/run-one.mjs tests/health/<file>`.

---

### Task 1: Helper functions + wiring `touchpoints.sql` into the RLS harness

**Files:**
- Create: `touchpoints.sql`
- Modify: `tests/rls/fixtures.mjs` (apply the new file in `resetStack`)
- Create: `tests/rls/touchpoints.test.mjs`
- Modify: `tests/rls/run.mjs` (import the new test file before `migration.test.mjs`)

**Interfaces:**
- Produces (all `public`, all revoked from `public, anon, authenticated`):
  - `tp_addr(p text) returns text` — lower-cased bare address from `"Name <a@b>"` or `a@b`; NULL if no `@`.
  - `tp_domain(p text) returns text` — domain part of `tp_addr(p)`, NULL if none.
  - `tp_generic(p_domain text) returns boolean` — true for the blocklist.
  - `tp_body_addrs(p text) returns text[]` — distinct lower-cased addresses found in free text; `'{}'` if none.
  - `tp_strip_quotes(p text) returns text` — body cut at the first quoted-reply marker, trailing whitespace trimmed.
  - In `fixtures.mjs`: `export const seedContact = seedEntity("contacts");`

- [ ] **Step 1: Wire the file into the harness**

In `tests/rls/fixtures.mjs`, below the `ALERTS_SQL` constant add:

```js
const TOUCH_SQL = fileURLToPath(new URL("../../touchpoints.sql", import.meta.url));
```

and in `resetStack`, directly after `await client.query(readFileSync(ALERTS_SQL, "utf8"));` add:

```js
    // Bounces reuse alert_config and alert_post, so this must come after email-alerts.sql.
    await client.query(readFileSync(TOUCH_SQL, "utf8"));
```

At the bottom, next to `seedActivity`, add:

```js
export const seedContact  = seedEntity("contacts");
```

In `tests/rls/run.mjs` add `import "./touchpoints.test.mjs";` on the line before `import "./migration.test.mjs";`.

Create `touchpoints.sql` with only a header so the harness loads:

```sql
-- Email touchpoint ingest: a CSM forwards a customer thread to the touchpoints inbox and it
-- is logged as an `email` activity on the matching account. Design:
-- docs/superpowers/specs/2026-10-05-email-touchpoint-ingest-design.md
--
-- Run AFTER supabase-setup.sql and email-alerts.sql: bounces reuse alert_config/alert_post.
-- Safe to re-run.
```

- [ ] **Step 2: Write the failing tests**

Create `tests/rls/touchpoints.test.mjs`:

```js
// Email touchpoint ingest against a REAL Postgres. Helpers are called by superuser SQL
// (they are revoked from every API role); ingest_touchpoint is called as `anon`, exactly
// the way the provider shim will call it.
import { test, assert } from "../health/framework.mjs";
import { sql } from "./fixtures.mjs";

const one = async (q, params = []) => Object.values((await sql(q, params))[0])[0];

test("tp_addr reduces display-name and case variants to the bare address", async () => {
  assert(await one(`select tp_addr('"Plain User" <USER@TEST.LOCAL>')`) === "user@test.local",
    "display-name form was not reduced");
  assert(await one(`select tp_addr('  Jane@Acme.COM ')`) === "jane@acme.com", "case/whitespace not normalised");
  assert(await one(`select tp_addr('not an address')`) === null, "a string without @ produced an address");
  assert(await one(`select tp_domain('Bob <bob@Sub.Acme.com>')`) === "sub.acme.com", "tp_domain wrong");
});

test("tp_generic flags the blocklist and nothing else", async () => {
  assert(await one(`select tp_generic('gmail.com')`) === true, "gmail.com not generic");
  assert(await one(`select tp_generic('protonmail.com')`) === true, "protonmail.com not generic");
  assert(await one(`select tp_generic('prohance.ai')`) === false, "control: a company domain was flagged generic");
});

test("tp_body_addrs finds addresses but not bare domains or trailing punctuation", async () => {
  const got = await one(`select tp_body_addrs('Ping jane@acme.com. Also see prohance.ai and BOB@Acme.com')`);
  assert(JSON.stringify([...got].sort()) === JSON.stringify(["bob@acme.com", "jane@acme.com"]),
    `got ${JSON.stringify(got)}`);
  const none = await one(`select tp_body_addrs('just prohance.ai mentioned')`);
  assert(none.length === 0, `a bare domain produced ${JSON.stringify(none)}`);
});

test("tp_strip_quotes cuts at reply markers and keeps forwarded content", async () => {
  const gmail = await one(`select tp_strip_quotes($1)`,
    ["Thanks, sending the quote.\r\n\r\nOn Mon, 5 Oct 2026 at 09:00, Jane <jane@acme.com> wrote:\r\n> earlier text"]);
  assert(gmail === "Thanks, sending the quote.", `gmail style: ${JSON.stringify(gmail)}`);
  const outlook = await one(`select tp_strip_quotes($1)`, ["Top line\n-----Original Message-----\nFrom: x"]);
  assert(outlook === "Top line", `outlook style: ${JSON.stringify(outlook)}`);
  const angle = await one(`select tp_strip_quotes($1)`, ["Reply\n> quoted"]);
  assert(angle === "Reply", `> style: ${JSON.stringify(angle)}`);
  // Control: a forward's content IS the customer thread and must survive.
  const fwd = await one(`select tp_strip_quotes($1)`,
    ["FYI\n---------- Forwarded message ---------\nFrom: Jane <jane@acme.com>\nRenewal is fine"]);
  assert(/Renewal is fine/.test(fwd), `forwarded content was stripped: ${JSON.stringify(fwd)}`);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node tests/rls/run.mjs`
Expected: the four new tests FAIL with `function tp_addr(unknown) does not exist` (and similar); all others still PASS.

- [ ] **Step 4: Implement the helpers**

Append to `touchpoints.sql`:

```sql
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
```

- [ ] **Step 5: Run to verify they pass**

Run: `node tests/rls/run.mjs`
Expected: the four new tests PASS, nothing else regresses, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add touchpoints.sql tests/rls/fixtures.mjs tests/rls/run.mjs tests/rls/touchpoints.test.mjs
git commit -m "Add touchpoint address and quote-stripping helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Account matching (`tp_match`)

**Files:**
- Modify: `touchpoints.sql` (append)
- Modify: `tests/rls/touchpoints.test.mjs` (append)

**Interfaces:**
- Consumes: `tp_addr`, `tp_domain`, `tp_generic` (Task 1); `seedAccount`, `seedContact`, `ORG_A`, `ORG_B` from `fixtures.mjs`.
- Produces: `tp_match(p_org uuid, p_addrs text[], p_exclude text[]) returns text[]` — account ids. Length 1 = matched (or narrowed to one by exact address); length ≥2 = ambiguous (all domain matches, sorted); length 0 = no match. `p_addrs` must already be normalised by `tp_addr`; `p_exclude` is a list of domains that never identify a customer.

- [ ] **Step 1: Write the failing tests**

Change the fixtures import at the top of `tests/rls/touchpoints.test.mjs` to:

```js
import { sql, seedAccount, seedContact, ORG_A, ORG_B } from "./fixtures.mjs";
```

Append:

```js
// ---------- matching ----------
const match = (org, addrs, exclude = ["test.local"]) =>
  one(`select tp_match($1, $2, $3)`, [org, addrs, exclude]);

test("tp_match finds the account by contact domain, scoped to the org", async () => {
  await seedAccount("tpm-a1", { name: "Match One", contractStatus: "Active" });
  await seedContact("tpm-c1", { name: "Jane", email: "jane@match-one.example", accountId: "tpm-a1" });
  await seedAccount("tpm-b1", { name: "B Only", contractStatus: "Active" }, ORG_B);
  await seedContact("tpm-cb1", { name: "Bea", email: "bea@b-only.example", accountId: "tpm-b1" }, ORG_B);

  const hit = await match(ORG_A, ["someone@match-one.example"]);
  assert(JSON.stringify(hit) === '["tpm-a1"]', `expected tpm-a1, got ${JSON.stringify(hit)}`);
  // Org isolation, with the same call shape as the control above.
  const cross = await match(ORG_A, ["bea@b-only.example"]);
  assert(cross.length === 0, `org A matched org B's account: ${JSON.stringify(cross)}`);
  const own = await match(ORG_B, ["bea@b-only.example"]);
  assert(JSON.stringify(own) === '["tpm-b1"]', `control: org B did not match its own account: ${JSON.stringify(own)}`);
});

test("tp_match ignores generic domains, excluded domains and churned accounts", async () => {
  await seedAccount("tpm-g1", { name: "Gmail Holder", contractStatus: "Active" });
  await seedContact("tpm-cg1", { name: "Gee", email: "gee@gmail.com", accountId: "tpm-g1" });
  assert((await match(ORG_A, ["other@gmail.com"])).length === 0, "a gmail contact claimed a gmail thread");

  await seedAccount("tpm-x1", { name: "Excluded", contractStatus: "Active" });
  await seedContact("tpm-cx1", { name: "Ex", email: "ex@excluded.example", accountId: "tpm-x1" });
  assert((await match(ORG_A, ["ex@excluded.example"], ["excluded.example"])).length === 0,
    "an excluded domain still matched");
  assert((await match(ORG_A, ["ex@excluded.example"], [])).length === 1, "control: the unexcluded domain did not match");

  await seedAccount("tpm-ch1", { name: "Gone", contractStatus: "Churned" });
  await seedContact("tpm-cch1", { name: "Old", email: "old@gone.example", accountId: "tpm-ch1" });
  assert((await match(ORG_A, ["old@gone.example"])).length === 0, "a churned account matched");
});

test("tp_match narrows a shared domain by exact address, else reports both", async () => {
  await seedAccount("tpm-p1", { name: "Acme Parent", contractStatus: "Active" });
  await seedAccount("tpm-p2", { name: "Acme EMEA", contractStatus: "Active" });
  await seedContact("tpm-cp1", { name: "Pat", email: "pat@acme-shared.example", accountId: "tpm-p1" });
  await seedContact("tpm-cp2", { name: "Emma", email: "emma@acme-shared.example", accountId: "tpm-p2" });

  const narrowed = await match(ORG_A, ["emma@acme-shared.example"]);
  assert(JSON.stringify(narrowed) === '["tpm-p2"]', `exact address did not narrow: ${JSON.stringify(narrowed)}`);
  const both = await match(ORG_A, ["newperson@acme-shared.example"]);
  assert(JSON.stringify(both) === '["tpm-p1","tpm-p2"]', `expected both, got ${JSON.stringify(both)}`);
});

test("tp_match tolerates messy stored contact emails but not subdomains", async () => {
  await seedAccount("tpm-m1", { name: "Messy", contractStatus: "Active" });
  await seedContact("tpm-cm1", { name: "Mo", email: "  Mo@Messy-Co.EXAMPLE ", accountId: "tpm-m1" });
  assert(JSON.stringify(await match(ORG_A, ["x@messy-co.example"])) === '["tpm-m1"]',
    "a contact email with case/whitespace did not match");
  // Pinned on purpose: exact domain only. The bounce tells the CSM to add the contact.
  assert((await match(ORG_A, ["x@mail.messy-co.example"])).length === 0, "a subdomain matched");
  await seedContact("tpm-cm2", { name: "No Mail", accountId: "tpm-m1" });   // contact with no email: harmless
  assert(JSON.stringify(await match(ORG_A, ["x@messy-co.example"])) === '["tpm-m1"]',
    "a contact without an email broke matching");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/rls/run.mjs`
Expected: the four new tests FAIL with `function tp_match(...) does not exist`.

- [ ] **Step 3: Implement**

Append to `touchpoints.sql`:

```sql
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `node tests/rls/run.mjs`
Expected: all touchpoint tests PASS, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add touchpoints.sql tests/rls/touchpoints.test.mjs
git commit -m "Match touchpoint threads to accounts by contact domain

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `ingest_touchpoint` — config, log, sender resolution, activity write, bounces

**Files:**
- Modify: `touchpoints.sql` (append)
- Modify: `tests/rls/touchpoints.test.mjs` (append)

**Interfaces:**
- Consumes: Task 1 helpers, `tp_match` (Task 2); from `email-alerts.sql`: table `alert_config` (`api_key, from_email, from_name, api_base`, row `id = 1`) and `alert_post(p_url text, p_headers jsonb, p_body jsonb) returns bigint`; from `supabase-setup.sql`: `profiles(id, name, org_id, disabled)`, `orgs(id, disabled)`, `activities(org_id, id, data)`, `accounts`.
- Produces:
  - table `touchpoint_config(id int = 1, secret text default 'CHANGE-ME', inbox_address text default 'touchpoints@onevio.com')`
  - table `ingest_log(message_id text pk, org_id uuid null, sender text, received_at timestamptz, verdict text, account_id text null, bounce_failed boolean)` with RLS ENABLED and no policies yet (Task 4 adds the read policy).
  - `tp_bounce(p_to text, p_subject text, p_text text) returns boolean` — true if queued.
  - `ingest_touchpoint(p_secret text, p_message jsonb) returns jsonb` — `{ok:false}` (bad secret), `{ok:false, error}` (missing message_id/from), else `{ok:true, verdict[, account_id]}` with verdict in `logged | no_match | ambiguous | malformed | rejected_sender | duplicate`. Execute granted to `anon` only.
  - `p_message` keys: `message_id, from, to[], cc[], date, subject, text, headers{}` (header names lower-case).

- [ ] **Step 1: Write the failing tests**

Change the fixtures import at the top of `tests/rls/touchpoints.test.mjs` to:

```js
import { sessions, sql, seedAccount, seedContact, signUpFresh, invitedFresh, ORG_A, ORG_B } from "./fixtures.mjs";
```

Append:

```js
// ---------- ingest_touchpoint ----------
const SECRET = "tp-test-secret";
const INBOX = "touchpoints@onevio.test";

// Same network seam the alert tests replace: bounces land in test_sent, never on the wire.
const stubSend = () => sql(`
  create table if not exists public.test_sent (
    id bigserial primary key, url text, body jsonb, at timestamptz default now());
  create or replace function public.alert_post(p_url text, p_headers jsonb, p_body jsonb)
  returns bigint language plpgsql as $$
  declare n bigint;
  begin
    insert into test_sent (url, body) values (p_url, p_body) returning id into n;
    return n;
  end $$;`);

async function setup() {
  await stubSend();
  await sql(`delete from test_sent`);
  await sql(`update alert_config set api_key = 'test-key', from_email = 'alerts@onevio.test' where id = 1`);
  await sql(`update touchpoint_config set secret = $1, inbox_address = $2 where id = 1`, [SECRET, INBOX]);
}

let seq = 0;
const msg = o => ({ message_id: `<tp-${Date.now()}-${++seq}@test>`, from: "user@test.local",
  to: [INBOX], cc: [], date: "2026-10-01T09:00:00Z", subject: "Renewal chat", text: "Hi there", ...o });
const ingest = async (m, secret = SECRET) => {
  const { data, error } = await sessions.anon.rpc("ingest_touchpoint", { p_secret: secret, p_message: m });
  if (error) throw new Error(`ingest_touchpoint errored: ${error.message}`);
  return data;
};
const activityFor = async (m, org = ORG_A) =>
  (await sql(`select data from activities where org_id = $1 and id = 'em-' || md5($2)`, [org, m.message_id]))[0]?.data ?? null;
const logFor = async m => (await sql(`select * from ingest_log where message_id = $1`, [m.message_id]))[0] ?? null;
const bouncesTo = async email => (await sql(`select body from test_sent`))
  .filter(r => (r.body.to || []).some(t => t.email === email));

async function seedCustomer(id, domain, org = ORG_A, name = `Cust ${id}`) {
  await seedAccount(id, { name, contractStatus: "Active" }, org);
  await seedContact(`${id}-c`, { name: "Contact", email: `contact@${domain}`, accountId: id }, org);
}

test("a forwarded thread is logged on the matching account", async () => {
  await setup();
  await seedCustomer("tpi-a1", "happy.example");
  const m = msg({ from: '"Plain User" <USER@TEST.LOCAL>', cc: ["Contact <contact@happy.example>"],
    text: "Quote attached.\nOn Mon, 5 Oct 2026, Contact <contact@happy.example> wrote:\n> old" });
  const out = await ingest(m);
  assert(out.ok === true && out.verdict === "logged" && out.account_id === "tpi-a1", JSON.stringify(out));
  const a = await activityFor(m);
  assert(a, "no activity was written");
  assert(a.type === "email" && a.source === "email" && a.accountId === "tpi-a1", JSON.stringify(a));
  assert(a.loggedBy === "Plain User", `loggedBy was ${a.loggedBy}`);
  assert(a.summary === "Renewal chat" && a.details === "Quote attached.", `summary/details: ${JSON.stringify(a)}`);
  assert(a.date === "2026-10-01", `date was ${a.date}`);
  assert(JSON.stringify(a.participants) === '["contact@happy.example"]',
    `participants should be external only: ${JSON.stringify(a.participants)}`);
  const log = await logFor(m);
  assert(log.verdict === "logged" && log.org_id === ORG_A && log.account_id === "tpi-a1", JSON.stringify(log));
  assert((await bouncesTo("user@test.local")).length === 0, "a logged message bounced");
});

test("body addresses are a fallback; a bare domain mention is not", async () => {
  await setup();
  await seedCustomer("tpi-b1", "bodyonly.example");
  const viaBody = msg({ text: "FYI\n---------- Forwarded message ---------\nFrom: contact@bodyonly.example\nHello" });
  assert((await ingest(viaBody)).verdict === "logged", "body-address fallback did not log");
  const bare = msg({ text: "We should talk to bodyonly.example soon" });
  const out = await ingest(bare);
  assert(out.verdict === "no_match", `bare domain gave ${out.verdict}`);
  assert(await activityFor(bare) === null, "a bare domain mention wrote an activity");
});

test("a wrong or placeholder secret writes nothing", async () => {
  await setup();
  await seedCustomer("tpi-s1", "secret.example");
  const bad = msg({ cc: ["contact@secret.example"] });
  assert((await ingest(bad, "wrong")).ok === false, "wrong secret was accepted");
  assert(await logFor(bad) === null && await activityFor(bad) === null, "wrong secret wrote something");
  await sql(`update touchpoint_config set secret = 'CHANGE-ME' where id = 1`);
  const ph = msg({ cc: ["contact@secret.example"] });
  assert((await ingest(ph, "CHANGE-ME")).ok === false, "the placeholder secret was accepted");
  await setup();
  // Control: the same shape with the right secret logs.
  const good = msg({ cc: ["contact@secret.example"] });
  assert((await ingest(good)).verdict === "logged", "control: correct secret did not log");
});

test("missing message_id or from is refused without a log row", async () => {
  await setup();
  const out = await ingest({ from: "user@test.local", subject: "x", text: "y" });
  assert(out.ok === false && /message_id/.test(out.error || ""), JSON.stringify(out));
  const out2 = await ingest({ message_id: "<no-from@test>", subject: "x" });
  assert(out2.ok === false, JSON.stringify(out2));
  assert((await sql(`select 1 from ingest_log where message_id = '<no-from@test>'`)).length === 0, "a row was logged");
});

test("unknown, disabled, org-less and disabled-org senders are rejected silently", async () => {
  await setup();
  await seedCustomer("tpi-r1", "reject.example");
  await seedCustomer("tpi-r1b", "reject.example", ORG_B);
  const disabled = await invitedFresh("tp-disabled@test.local");
  await sql(`update profiles set disabled = true where id = $1`, [disabled.id]);
  await signUpFresh("tp-orgless@test.local");          // uninvited => org_id is null
  const senders = ["stranger@elsewhere.example", "tp-disabled@test.local", "tp-orgless@test.local"];
  for (const from of senders) {
    const m = msg({ from, cc: ["contact@reject.example"] });
    const out = await ingest(m);
    assert(out.ok === true && out.verdict === "rejected_sender", `${from}: ${JSON.stringify(out)}`);
    assert(await activityFor(m) === null, `${from}: an activity was written`);
    const log = await logFor(m);
    assert(log.sender === from.split("@")[1], `${from}: log kept "${log.sender}", expected the domain only`);
    assert(log.org_id === null, `${from}: log row carried an org`);
  }
  await sql(`update orgs set disabled = true where id = $1`, [ORG_B]);
  try {
    const m = msg({ from: "userb@test.local", cc: ["contact@reject.example"] });
    assert((await ingest(m)).verdict === "rejected_sender", "a sender in a disabled org was accepted");
    assert(await activityFor(m, ORG_B) === null, "disabled org got an activity");
  } finally {
    await sql(`update orgs set disabled = false where id = $1`, [ORG_B]);
  }
  assert((await sql(`select body from test_sent`)).length === 0, "a rejected sender was bounced");
  // Control: the same thread from an active CSM logs.
  const ok = msg({ cc: ["contact@reject.example"] });
  assert((await ingest(ok)).verdict === "logged", "control: an active CSM did not log");
});

test("a CSM cannot log onto another org's account", async () => {
  await setup();
  await seedCustomer("tpi-o1", "orgb-only.example", ORG_B);
  const a = msg({ cc: ["contact@orgb-only.example"] });
  const out = await ingest(a);
  assert(out.verdict === "no_match", `org A sender got ${out.verdict}`);
  assert(await activityFor(a, ORG_B) === null && await activityFor(a, ORG_A) === null, "cross-org activity written");
  assert((await bouncesTo("user@test.local")).length === 1, "the no_match was not bounced");
  // Control: org B's own CSM logs the same thread.
  const b = msg({ from: "userb@test.local", cc: ["contact@orgb-only.example"] });
  assert((await ingest(b)).verdict === "logged", "control: org B's CSM did not log");
  assert((await activityFor(b, ORG_B))?.accountId === "tpi-o1", "control: activity not on org B's account");
});

test("an ambiguous match bounces naming both accounts and logs nothing", async () => {
  await setup();
  await seedCustomer("tpi-m1", "twins.example", ORG_A, "Twin Parent");
  await seedCustomer("tpi-m2", "twins.example", ORG_A, "Twin EMEA");
  const m = msg({ cc: ["someone-new@twins.example"], subject: "Pricing" });
  assert((await ingest(m)).verdict === "ambiguous", "not ambiguous");
  assert(await activityFor(m) === null, "an ambiguous message wrote an activity");
  const [b] = await bouncesTo("user@test.local");
  assert(b, "no bounce was sent");
  assert(b.body.subject === "Not logged: Pricing", `subject was ${b.body.subject}`);
  assert(/Twin Parent/.test(b.body.textContent) && /Twin EMEA/.test(b.body.textContent), b.body.textContent);
  assert(!/someone-new/.test(b.body.textContent), "the bounce quoted thread content");
  assert((b.body.to || []).length === 1, "the bounce went to more than the sender");
});

test("the same message_id twice logs once and bounces once", async () => {
  await setup();
  await seedCustomer("tpi-d1", "dupe.example");
  const m = msg({ cc: ["contact@dupe.example"] });
  assert((await ingest(m)).verdict === "logged", "first delivery did not log");
  assert((await ingest(m)).verdict === "duplicate", "second delivery was not a duplicate");
  assert((await sql(`select count(*)::int n from activities where id = 'em-' || md5($1)`, [m.message_id]))[0].n === 1,
    "duplicate activity");
  const miss = msg({ cc: ["x@nobody-here.example"] });
  await ingest(miss); await ingest(miss);
  assert((await bouncesTo("user@test.local")).length === 1, "a retried no_match bounced twice");
});

test("auto-submitted mail is recorded but never bounced", async () => {
  await setup();
  const auto = msg({ cc: ["x@nobody-auto.example"], headers: { "auto-submitted": "auto-replied" } });
  assert((await ingest(auto)).verdict === "no_match", "auto mail verdict wrong");
  assert(await logFor(auto), "auto mail was not recorded");
  assert((await bouncesTo("user@test.local")).length === 0, "auto mail was bounced");
  const control = msg({ cc: ["x@nobody-auto.example"] });
  await ingest(control);
  assert((await bouncesTo("user@test.local")).length === 1, "control: an ordinary no_match did not bounce");
});

test("an empty message is malformed and bounced", async () => {
  await setup();
  const m = msg({ subject: "", text: "  " });
  assert((await ingest(m)).verdict === "malformed", "empty message not malformed");
  const [b] = await bouncesTo("user@test.local");
  assert(b && b.body.subject === "Not logged: (no subject)", `bounce: ${JSON.stringify(b && b.body)}`);
});

test("a failed bounce is recorded and the call still succeeds", async () => {
  await setup();
  await sql(`create or replace function public.alert_post(p_url text, p_headers jsonb, p_body jsonb)
             returns bigint language plpgsql as $$ begin raise exception 'brevo down'; end $$;`);
  try {
    const m = msg({ cc: ["x@nobody-fail.example"] });
    const out = await ingest(m);
    assert(out.ok === true && out.verdict === "no_match", JSON.stringify(out));
    assert((await logFor(m)).bounce_failed === true, "bounce_failed was not set");
  } finally {
    await stubSend();
  }
  const ok = msg({ cc: ["x@nobody-fail.example"] });
  await ingest(ok);
  assert((await logFor(ok)).bounce_failed === false, "control: a working bounce was marked failed");
});

test("a bad date falls back to today and long text is truncated", async () => {
  await setup();
  await seedCustomer("tpi-t1", "trunc.example");
  const m = msg({ cc: ["contact@trunc.example"], date: "not a date",
    subject: "S".repeat(500), text: "B".repeat(9000) });
  assert((await ingest(m)).verdict === "logged", "long message did not log");
  const a = await activityFor(m);
  const [{ today }] = await sql(`select to_char(current_date, 'YYYY-MM-DD') as today`);
  assert(a.date === today, `date was ${a.date}, expected ${today}`);
  assert(a.summary.length === 200 && a.details.length === 4000, `lengths ${a.summary.length}/${a.details.length}`);
  const noDate = msg({ cc: ["contact@trunc.example"], date: undefined });
  await ingest(noDate);
  assert((await activityFor(noDate)).date === today, "a missing date did not fall back to today");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/rls/run.mjs`
Expected: the new tests FAIL (`touchpoint_config` / `ingest_touchpoint` does not exist); earlier tests PASS.

- [ ] **Step 3: Implement**

Append to `touchpoints.sql`:

```sql
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `node tests/rls/run.mjs`
Expected: all touchpoint tests PASS, the rest of the suite still PASSES, exit code 0. If the email-alert tests now fail, check that this file did not leave `alert_post` stubbed in a way they don't expect — each alert test calls its own `stubSend()` first, so they should not.

- [ ] **Step 5: Commit**

```bash
git add touchpoints.sql tests/rls/touchpoints.test.mjs
git commit -m "Add ingest_touchpoint: log matched threads, bounce the rest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `ingest_log` read access and API-role lockdown

**Files:**
- Modify: `touchpoints.sql` (append)
- Modify: `tests/rls/touchpoints.test.mjs` (append)

**Interfaces:**
- Consumes: `ingest_log`, `ingest_touchpoint`, `tp_match` (Tasks 2–3); `public.current_org()` and `public.is_admin()` from `supabase-setup.sql`; the test helpers `setup`, `msg`, `ingest` defined in Task 3's test block.
- Produces: policy `ingest_log_select` (org admins read their own org's rows).

- [ ] **Step 1: Write the failing tests**

Append to `tests/rls/touchpoints.test.mjs`:

```js
// ---------- access ----------
test("org admins read their own org's ingest_log, and no one else's", async () => {
  await setup();
  const a = msg({ cc: ["x@nobody-acl.example"] });
  const b = msg({ from: "userb@test.local", cc: ["x@nobody-acl.example"] });
  await ingest(a); await ingest(b);

  const own = await sessions.admin.from("ingest_log").select("message_id").eq("message_id", a.message_id);
  assert(!own.error && own.data.length === 1, `org A admin could not read its own row: ${JSON.stringify(own)}`);
  const cross = await sessions.admin.from("ingest_log").select("message_id").eq("message_id", b.message_id);
  assert(!cross.error && cross.data.length === 0, "org A admin read org B's row");
  const ownB = await sessions.adminB.from("ingest_log").select("message_id").eq("message_id", b.message_id);
  assert(ownB.data.length === 1, "control: org B admin could not read its own row");
  const plain = await sessions.user.from("ingest_log").select("message_id").eq("message_id", a.message_id);
  assert(plain.data.length === 0, "a non-admin CSM read ingest_log");
});

test("no API role can write ingest_log or touchpoint_config", async () => {
  const ins = await sessions.admin.from("ingest_log")
    .insert({ message_id: "<forged@test>", sender: "x", verdict: "logged" });
  assert(ins.error, "an admin inserted into ingest_log");
  assert((await sql(`select 1 from ingest_log where message_id = '<forged@test>'`)).length === 0, "forged row exists");
  const cfg = await sessions.admin.from("touchpoint_config").select("secret");
  assert(cfg.error || cfg.data.length === 0, "an admin read the touchpoint secret");
});

test("only anon may call ingest_touchpoint, and nobody may call the helpers", async () => {
  const asUser = await sessions.admin.rpc("ingest_touchpoint", { p_secret: SECRET, p_message: msg({}) });
  assert(asUser.error, "an authenticated user could call ingest_touchpoint");
  const helper = await sessions.anon.rpc("tp_match", { p_org: ORG_A, p_addrs: ["a@b.example"], p_exclude: [] });
  assert(helper.error, "anon could call tp_match");
  // Control: anon CAN call the entry point (a wrong secret still returns ok:false, not an error).
  const { data, error } = await sessions.anon.rpc("ingest_touchpoint", { p_secret: "nope", p_message: msg({}) });
  assert(!error && data.ok === false, `control: anon could not call ingest_touchpoint: ${error && error.message}`);
});
```

- [ ] **Step 2: Run to verify the read test fails**

Run: `node tests/rls/run.mjs`
Expected: "org admins read their own org's ingest_log…" FAILS on "org A admin could not read its own row" (RLS is on with no policy). The other two tests should already PASS — they pin lockdown that Task 3 put in place; if either fails, fix the grants in Task 3's block rather than here.

- [ ] **Step 3: Implement**

Append to `touchpoints.sql`:

```sql
-- ---------- ingest_log access ----------
-- Org admins only: it answers "why didn't my email show up?". Wrapped in (select ...) like
-- every policy in supabase-setup.sql, so the helpers run once per query, not once per row.
drop policy if exists ingest_log_select on public.ingest_log;
create policy ingest_log_select on public.ingest_log for select to authenticated
  using (org_id = (select public.current_org()) and (select public.is_admin()));
```

- [ ] **Step 4: Run to verify all pass**

Run: `node tests/rls/run.mjs`
Expected: all PASS, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add touchpoints.sql tests/rls/touchpoints.test.mjs
git commit -m "Let org admins read their ingest log; lock touchpoints to anon

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Timeline rendering check + setup docs

**Files:**
- Create: `tests/health/touchpoint-activity.test.mjs`
- Modify: `tests/health/run.mjs` (add the import after the last existing test import)
- Modify: `TEAM-SETUP.md` (append a section)

**Interfaces:**
- Consumes: `launch`, `seedAccount`, `rootText` from `tests/health/harness.mjs`; the activity shape from Task 3.

- [ ] **Step 1: Write the test**

Create `tests/health/touchpoint-activity.test.mjs`:

```js
import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

// An ingested email carries two keys the app never writes itself (source, participants).
// This proves the timeline renders such a row as an ordinary email activity rather than
// crashing or hiding it.
const acct = seedAccount({ id: "tp1", name: "Inbox Co", healthBand: "Yellow" });
const act = { id: "em-abc", accountId: "tp1", type: "email", date: "2026-10-01",
  summary: "Renewal chat from inbox", details: "Quote attached.", loggedBy: "Priya",
  source: "email", participants: ["contact@inbox.example"] };
const seed = `window.__seedRows = { accounts: [{ id: "tp1", data: ${JSON.stringify(acct)} }],
  activities: [{ id: "em-abc", data: ${JSON.stringify(act)} }],
  contacts: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("an ingested email activity renders on the account timeline", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.click('button[title="Accounts"]');
    await page.getByText("Inbox Co").first().waitFor({ timeout: 8000 });
    await page.getByText("Inbox Co").first().click();
    await page.waitForFunction(() => /Activity timeline/.test(document.getElementById("root").textContent),
      { timeout: 8000 });
    const text = await rootText(page);
    assert(/Activity timeline \(1\)/.test(text), "timeline count is not 1");
    assert(text.includes("Renewal chat from inbox"), "summary not rendered");
    assert(text.includes("Quote attached."), "details not rendered");
  } finally {
    await browser.close();
  }
});
```

Add `import "./touchpoint-activity.test.mjs";` to `tests/health/run.mjs` after the last existing `import "./....test.mjs";` line.

- [ ] **Step 2: Run it**

Run: `npm run build` then `node tests/health/run-one.mjs tests/health/touchpoint-activity.test.mjs`
Expected: PASS. (No app change is expected. If it FAILS, stop and report — the spec assumed unknown activity keys are tolerated, and a failure here means that assumption is wrong.)

Falsify once so the test is known to bite: temporarily change the seeded `summary` in the assertion to `"Renewal chat from inboxX"`, run, confirm FAIL, revert.

- [ ] **Step 3: Document setup**

Append to `TEAM-SETUP.md`:

```markdown
## Email touchpoints (inbound)

Forward or Cc a customer thread to the touchpoints inbox and it is logged as an `email`
activity on the account whose contacts share the customer's email domain.

**Setup (once):**
1. Run `touchpoints.sql` in the Supabase SQL editor, after `supabase-setup.sql` and
   `email-alerts.sql`. It is safe to re-run.
2. Set the shared secret and inbox address:
   `update public.touchpoint_config set secret = '<long random string>', inbox_address = 'touchpoints@yourdomain' where id = 1;`
3. Point an inbound-mail provider at the inbox (needs an MX record). Its webhook must call
   `POST /rest/v1/rpc/ingest_touchpoint` with the anon key and a body of
   `{ "p_secret": "<secret>", "p_message": { ... } }`, where `p_message` is:

   ```json
   { "message_id": "<id@mail>", "from": "csm@yourdomain", "to": ["touchpoints@yourdomain"],
     "cc": ["customer@acme.com"], "date": "2026-10-05T09:12:00Z",
     "subject": "Re: renewal", "text": "plain-text body",
     "headers": { "auto-submitted": "no" } }
   ```
   Header names must be lower-case. Until a provider is connected the feature is dormant.

**Rules:** only active OneVio users can file (anyone else is silently ignored); the account
must have a contact at the customer's exact domain; Gmail/Outlook-style personal domains never
match. If nothing matches, or two accounts match, the sender gets a "Not logged" reply saying
why. Admins can see every received message and its outcome in the `ingest_log` table.
```

- [ ] **Step 4: Run both full suites**

Run: `npm run build`, `node tests/health/run.mjs`, then `node tests/rls/run.mjs`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/health/touchpoint-activity.test.mjs tests/health/run.mjs TEAM-SETUP.md
git commit -m "Prove ingested emails render on the timeline; document touchpoint setup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
