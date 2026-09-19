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

## Rollout: one maintenance window, in this order

Do all of this in one sitting. Tell users beforehand that the app will be briefly down.

1. Open `supabase-setup.sql` and set the two `EDIT ME` literals (see below).
2. In the Supabase SQL editor, run the whole of `supabase-setup.sql`, then the whole of
   `email-alerts.sql`. Both are safe to re-run. The order matters: `email-alerts.sql`
   is validated against the new schema when it is created, so running it first fails.
3. Deploy the app (merge this PR) **immediately** after step 2.
4. Tell users to reload the page.
5. Sign in as the platform admin, confirm the sidebar shows the default org, and create the
   first client from Settings → Platform.

Both split orders break the app, so there is no safe "one piece first":

- **App first, SQL later:** the new client reads `profiles.org_id` and `platform_admin`,
  which do not exist yet. Every user gets "Could not load your profile".
- **SQL first, app later:** the old client still reads `settings` by `id = 1`, a column the
  migration drops, and uploads un-prefixed paths that the new storage policies refuse.

So the app is down for everyone between step 2 and step 4. Keep that gap to minutes.

**The platform-admin login must exist before the file is run.** The `EDIT ME` email update
flips `platform_admin = true` only on a profile that already exists, and is a no-op
otherwise. Use an existing user, or have that person sign up first. If the login was
created after the upgrade (so it matched no invite and has no org), the same update also
puts it in the default org, so it never lands on the "no workspace" screen. If the account
signs up only after you ran the file, re-run `supabase-setup.sql` once it has.

## The EDIT ME literals

Both live in `supabase-setup.sql` and are idempotent (change and re-run any time):

- Line 20 — `insert into public.orgs (id, name) values (..., 'My Company')`: the default
  org's name, the one that receives every pre-existing row and user.
- Line 62 — `where ... lower(email) = lower('you@yourcompany.com')`: the platform admin's
  sign-in email. A no-op until that account exists. The same update also sets the account's
  org to the default org if it has none.

## Ship together

These four pieces go live in the same maintenance window (see Rollout above). Splitting
them leaves the app broken:

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
- **M2.** Realtime DELETE events are not RLS-filtered by Supabase. Every client subscribes
  to the whole schema, so org B's browsers receive org A's delete events (the old row's
  `(org_id, id)` key), which leaks row ids, timing and volume across orgs and triggers extra
  refetches. Fix: filter each channel on `org_id=eq.<current org>`, or drop payloads whose
  `old.org_id` is not the current org.
- **M3.** An org-less (uninvited) login can still call `log_error`. Its rows land in the
  null-org "system" bucket that only the platform admin sees, so it can spoof or flood that
  bucket, and each call runs the 30-day sweep. Fix: require `current_org()`, or keep org-less
  rows apart from system rows.
- **M4.** With "Confirm email" OFF, an open invite can be claimed by whoever signs up with
  that address first; with no invite withdrawal (above) that window can stay open. Recommend
  Confirm email ON for multi-tenant installs, and ship invite withdrawal soon.
- **M5.** The default-org uuid literal is repeated in `supabase-setup.sql` and
  `email-alerts.sql`, and the uuid regex appears twice. A `default_org()` helper would
  remove the drift risk.
- No alert-preferences UI yet; `org_alert_prefs` rows are SQL-edited per client for now.

## Tests

- `node build.mjs` — clean build.
- `node tests/health/run.mjs` (mocked suite) — green.
- `tests/rls/` (real Supabase stack in Docker) needs Docker, unavailable on this dev
  machine; CI runs and gates it. Green through 3c6da38 at rls 190 / health 307, plus the
  platform-admin protection tests added by the final-review fixes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
