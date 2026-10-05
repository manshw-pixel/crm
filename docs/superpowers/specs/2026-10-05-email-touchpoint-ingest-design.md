# Email touchpoint ingest — design

Date: 2026-10-05 · Status: approved in brainstorming, awaiting spec review

## Goal

A CSM forwards or Ccs a customer email thread to a touchpoints address. The thread is logged
automatically as an `email` activity on the right account, chosen by the domain of the account's
contacts (contact `someone@prohance.ai` ⇒ ProHance). CSMs no longer hand-log email touchpoints.

**Success:** a forwarded thread appears on the correct account's timeline within seconds, in the
sender's own client org only; anything that can't be logged confidently comes back to the sender
as a short reply explaining why; strangers get nothing.

## Constraints

- **No DNS yet** for onevio.com, so no MX record. The design is provider-agnostic: a normalized
  JSON message shape plus a thin per-provider adapter, written once a provider is chosen. The
  adapter is out of scope here.
- Everything lives in Postgres, matching how all other automation in this app works (approach B:
  SQL RPC + thin provider shim; an Edge Function and a Cloudflare Worker were rejected).
- No new app UI. Unmatched mail is bounced to the sender, not queued for triage.
- Multi-tenant: every match is scoped to the sender's org.

## Entry point

New file `touchpoints.sql`, applied after `supabase-setup.sql` and `email-alerts.sql`.

```
public.ingest_touchpoint(p_secret text, p_message jsonb) returns jsonb
```

`security definer`, `set search_path = public, auth`. Execute revoked from `public`, granted to
`anon` (the provider shim holds only the anon key plus the secret). The secret lives in a
single-row `touchpoint_config` table (RLS on, no policies, so only definer code reads it). A wrong
or missing secret returns `{ok:false}` and writes nothing, not even an `ingest_log` row.

The return value is always a 2xx-shaped `{ok:true, verdict}` for any authenticated call, including
rejections and bounce failures, so providers never retry a message that was already decided.

### Message shape (`p_message`)

```json
{
  "message_id": "<CAF...@mail.gmail.com>",
  "from": "csm@onevio.com",
  "to": ["touchpoints@onevio.com"],
  "cc": ["someone@prohance.ai"],
  "date": "2026-10-05T09:12:00Z",
  "subject": "Re: renewal timeline",
  "text": "plain-text body",
  "headers": { "auto-submitted": "no" }
}
```

`message_id` and `from` are required. `to`/`cc` default to empty, `date` to now. Addresses are
compared lower-cased and trimmed; display-name forms (`Name <a@b>`) are reduced to the address.

## Processing order

1. **Secret check.** Fail → `{ok:false}`, nothing written.
2. **Idempotency.** `message_id` already in `ingest_log` → verdict `duplicate`, nothing else
   happens (no second activity, no second bounce).
3. **Sender resolution.** `from` is matched against `auth.users.email` joined to `profiles`
   (the `alert_recipients()` definer pattern). Rejected **silently** (verdict `rejected_sender`, no
   bounce) when: no such user; the profile is disabled; the profile's `org_id` is null (the
   platform admin); or the org is disabled. Bouncing to strangers would make this a spam relay.
4. **Loop guard.** Messages with an `Auto-Submitted` header other than `no`, or `Precedence:
   bulk|auto_reply|list`, are recorded but never bounced.
5. **Malformed.** Empty subject *and* empty body → verdict `malformed`, bounce.
6. **Candidate domains.** Domains of all `from`/`to`/`cc` addresses, minus the sender's own domain,
   the touchpoints address's domain, and a **generic-domain blocklist** (gmail.com, googlemail.com,
   outlook.com, hotmail.com, live.com, yahoo.com, icloud.com, me.com, aol.com, proton.me,
   protonmail.com). Without the blocklist one Gmail contact would claim every personal thread.
7. **Account match.** Accounts in the sender's org, not `contractStatus = 'Churned'`, that have a
   contact (`contacts.data->>'email'`, same org) whose domain is a candidate. Contacts with no
   email contribute nothing.
8. **Body fallback.** Only if step 7 found nothing: repeat with domains taken from address-shaped
   strings in the body (`\S+@\S+`). A bare `prohance.ai` mention never matches.
9. **Narrowing (multi-account collision).** If more than one account matched, keep only accounts
   having a contact whose **full address** appears among the participants (or, on the fallback
   path, among the body addresses). If exactly one remains, use it.
10. **Verdict.** One account → `logged`. None → `no_match`, bounce. Still several → `ambiguous`,
    bounce naming the accounts.

## Data written

### Activity

Row in `activities`, `org_id` = sender's org, `id` = `em-` + md5(`message_id`) (deterministic: a
second guard against duplicates; insert is `on conflict do nothing`).

```
{ type:"email", date:<message date, else today; YYYY-MM-DD>, accountId,
  loggedBy:<sender's profile name>, summary:<subject, ≤200 chars>,
  details:<body with quoted reply chains stripped, ≤4000 chars>,
  source:"email", participants:[<external addresses only>] }
```

`type:"email"` already exists and unknown keys are tolerated, so no reducer change. The row
reaches open browsers through the existing realtime subscription.

Quote stripping: cut the body at the first line matching `^On .+ wrote:$`, `^-----Original
Message-----`, or a run of lines starting with `>`.

### `ingest_log`

```
message_id   text primary key
org_id       uuid null references orgs(id) on delete cascade   -- null for rejected strangers
sender       text not null        -- full address; DOMAIN ONLY when verdict = rejected_sender
received_at  timestamptz not null default now()
verdict      text not null check (verdict in
               ('logged','no_match','ambiguous','malformed','rejected_sender','duplicate'))
account_id   text null
bounce_failed boolean not null default false
```

`duplicate` is returned to the caller but never written (the original row is the record).
No subject, no body: like `email_log`, this table has different access rules from the CRM data,
so customer content stays out. RLS: `select` for `is_admin()` users where `org_id =
current_org()`; no insert/update/delete policies (only the definer function writes).

## Bounces

Sent only to the resolved CSM sender, never to anyone else on the thread, and never to the
touchpoints address. Sent through the existing Brevo path in `email-alerts.sql` (same
`alert_config` sender and key, same `http_post_json` seam), so no new provider or credentials.

- Subject: `Not logged: <original subject>`
- Plain text: one line of reason, the matched account names for `ambiguous`, and the fix
  ("add the contact's email to the account in OneVio, then forward again"). The original body is
  never quoted back.

If the send fails or `alert_config` isn't set, the verdict still stands and `bounce_failed` is set
true; the call still returns ok.

## Testing

New `tests/rls/touchpoints.test.mjs` in the existing real-Postgres + GoTrue harness, calling
`ingest_touchpoint` as `anon` with the secret, outbound HTTP stubbed the way
`emailalerts.test.mjs` does. Every absence assertion has a positive control (see the RLS
anon-key vacuity lesson).

- Happy path: participant match logs one activity with right org, `loggedBy`, stripped quotes.
  Body-address fallback logs. Bare domain mention does not.
- Narrowing: shared domain resolved by exact address logs; unresolved bounces naming both.
- Org isolation: client A's CSM, domain only in client B → `no_match`, B untouched; control:
  B's CSM logs the same thread.
- Silent rejects (each with control): unknown sender, disabled user, disabled org, org-less
  platform admin, wrong secret.
- Generic domains: a Gmail contact never claims a thread.
- Idempotency: same `message_id` twice → one activity, at most one bounce, second call
  `duplicate`.
- Loop safety: `Auto-Submitted: auto-replied`, and mail from the touchpoints address, never bounce.
- Bounce failure: stubbed error → `bounce_failed`, call still ok.
- `ingest_log` access: admin reads own org only; CSM reads nothing; no direct writes; a
  rejected stranger's row holds only a domain.
- App side: one health test that an activity with `source` and `participants` renders on the
  account timeline.

## Out of scope

- The provider adapter and MX/DNS setup (documented example payload only).
- Attachments, HTML bodies, and triage UI.
- Matching on account website/domain fields; contacts are the only source.

## Rollout

The user runs `touchpoints.sql` in the Supabase SQL editor and sets the secret
(`update touchpoint_config set secret = '<random>'`). Nothing is reachable until a provider adapter
exists, so the feature is dormant and safe to ship ahead of DNS.
