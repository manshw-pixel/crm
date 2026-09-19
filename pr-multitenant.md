## What this does

Hosts several client companies in one OneVio install. Every user now belongs to exactly
one **org** and sees only that org's data; a **platform admin** creates client orgs and
their first admin invite from Settings → Platform, and can switch into any org to see
exactly what that client sees.

## What changes for existing users

Nothing visible. The migration creates one **default org** and stamps every existing row,
user and setting onto it, so the current team keeps seeing exactly what it saw before.
Public sign-up is no longer "first account becomes admin" — from now on, joining requires
an invite from an org admin (Settings → Users) or from the platform admin (Settings →
Platform); an uninvited sign-up lands on a "not attached to a workspace yet" screen instead
of gaining access.

## Rollout steps (in order)

1. Merge and deploy the app.
2. Open `supabase-setup.sql` and set the two `EDIT ME` literals (see below), then run the
   whole file in the Supabase SQL editor. Safe to re-run.
3. Run `email-alerts.sql` next, in the SQL editor. Also idempotent. This order matters:
   its `alert_recipients()` function is validated against the schema at creation time, so
   running it before `supabase-setup.sql` fails with `column p.disabled does not exist`
   (pre-existing behavior, unrelated to this change, but the same ordering rule now also
   covers the new org tables/columns).
4. Mint the platform admin: sign in once as that account (so its profile row exists), set
   the `EDIT ME` email in `supabase-setup.sql` to match, and re-run the file — it flips
   `platform_admin = true` on that profile. (You can also do this directly by SQL:
   `update public.profiles set platform_admin = true where id = (select id from
   auth.users where lower(email) = lower('you@yourcompany.com'));`)
5. Sign in, confirm the sidebar shows the default org, create the first client from
   Settings → Platform.

## The EDIT ME literals

Both live in `supabase-setup.sql` and are idempotent (change and re-run any time):

- Line 20 — `insert into public.orgs (id, name) values (..., 'My Company')`: the default
  org's name, the one that receives every pre-existing row and user.
- Line 58 — `where ... lower(email) = lower('you@yourcompany.com')`: the platform admin's
  sign-in email. A no-op until that account has actually signed up once.

## Ship together

These four pieces land in the same deploy — splitting them leaves the app half-working:

1. The schema/RLS/RPC changes in `supabase-setup.sql` (orgs, invites, org_id on every
   table, org-scoped policies).
2. The per-org alert changes in `email-alerts.sql` (`org_alert_prefs`, per-org
   `send_alerts()` iteration).
3. The app changes (`crm.html`): org-aware load/writes, invite-before-sign-up, the
   Platform card, the no-workspace screen, the sidebar org badge.
4. The storage policy changes (org-prefixed upload paths, `storage.objects` read/insert
   policies gated on the first path segment). If the storage policies ship without the
   matching client changes (or vice versa), uploads fail outright — the client writes to
   `<org_id>/...` paths that only the updated policies allow.

Existing (legacy) uploaded files are **not** moved or re-linked to an org prefix — see
Known follow-ups.

## Known follow-ups

Deferred, tracked in the build ledger, not blocking this PR:

- `health_snapshots.org_id` has no foreign key to `orgs`.
- Two cross-org storage `list()` calls in the client ignore their error return.
- Legacy-file storage cleanup assumes an API delete of a fileless row; a legacy file sitting
  at the bucket root (no prefix at all) is unreachable by the org-prefix policies.
- `email_log`'s unique key lacks `org_id`: a platform admin who switches org and resends the
  same alert same-day could be silently skipped. Not an issue until a platform admin
  actually needs to trigger two same-day sends across orgs.
- The prefs backfill's cross-join re-creates `org_alert_prefs` rows on rerun even for orgs
  where a row was deliberately deleted.
- Send-failure escalations are now visible to the platform admin only; org admins no longer
  see them in their own error panel.
- `switch_org` keeps the platform admin's existing role in the target org, so switching
  into an org where they hold no admin role can leave them without admin access there.
- No cap on org name length in `create_org`.
- No way to withdraw an open invite for an address that never signs up.
- A `switch_org` in another browser tab leaves this tab's cached org stale until refresh
  (the server correctly refuses the resulting cross-org write).
- Disabled org-less logins can still be attached as an org's admin via `invite_user` /
  `create_org`.
- The ~8-line "attach an existing org-less login" block is duplicated between
  `invite_user` and `create_org`.
- No alert-preferences UI yet; `org_alert_prefs` rows are SQL-edited per client for now.

## Tests

- `node build.mjs` — clean build.
- `node tests/health/run.mjs` (mocked suite) — green.
- `tests/rls/` (real Supabase stack in Docker) needs Docker, unavailable on this dev
  machine; CI already runs and gates it, and it is green on this branch.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
