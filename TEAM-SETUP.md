# CS CRM — Team Setup (one-time, ~10 minutes)

The CRM is a single file (`crm.html`) that stores shared data in a free [Supabase](https://supabase.com) project. Everyone on the team sees and edits the same accounts.

## 1. Create the Supabase project

1. Sign up at supabase.com (free tier is enough) and click **New project**.
2. Pick a name (e.g. `cs-crm`) and a **region close to your team**. Set a strong database password (you won't need it day-to-day).

## 2. Create the tables and rules

1. In the project, open **SQL Editor → New query**.
2. Paste the entire contents of `supabase-setup.sql` and click **Run**. It should say "Success".

## 3. Configure the app

1. In Supabase, go to **Project Settings → API** and copy:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string)
2. Open `crm.html` in a text editor, find the `TEAM CONFIG` block near the top, and paste both values:
   ```js
   const SUPABASE_URL = "https://abcd1234.supabase.co";
   const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```
   The anon key is safe to publish — permissions are enforced by database rules, not by hiding the key.

## 4. (Recommended) Simplify sign-up

In Supabase: **Authentication → Sign In / Providers → Email** — turn **off** "Confirm email". Otherwise every colleague must click a confirmation link before their first sign-in (also fine, your choice).

## 5. Publish

Publishing is automated. Push to `master` and `.github/workflows/pages.yml` builds the
app, runs the full test suite, and deploys only if the suite passes.

1. Repo **Settings → Pages → Source**, choose **GitHub Actions** (not "Deploy from a branch").
2. Push to `master`.
3. Share the URL: `https://<your-user>.github.io/<repo>/`

### Building locally

`crm.html` is the source you edit; it is **not** what gets served. `node build.mjs`
compiles its JSX ahead of time and inlines every dependency into `dist/crm.html`, a
single self-contained file that loads nothing from the network.

```sh
npm ci          # once — installs esbuild + tailwind
node build.mjs  # writes dist/crm.html and dist/index.html
```

Open `dist/crm.html` directly, or serve `dist/` over localhost. Never edit anything in
`dist/` — it is generated and gitignored. The test suite builds automatically before it
runs, so `node tests/health/run.mjs` needs no separate build step.

### Running the security tests

`tests/rls/` checks the database's access rules — who can delete an account, who can
change a role, what a logged-out visitor can reach. They run against a real Supabase stack
in Docker, not a mock, so they need Docker running and the Supabase CLI installed.

```sh
supabase start           # real postgres + auth + storage, locally
cd tests/rls && npm ci
node tests/rls/run.mjs
```

These tests **pin the rules as they are today**. If one starts failing, the access model
changed — decide whether that was intended before making the test agree with the code.
Schema changes belong in `supabase-setup.sql`, which is what both the tests and the hosted
project are built from.

On Windows, Docker Desktop needs the WSL2 backend (`wsl --install`, then reboot). Without
it `supabase start` cannot run and the suite is CI-only on that machine.

## 6. First logins

- Sign-up is invite-only: a colleague can only join through **Settings → Users → Add** (an
  admin invites them by email), or by being the platform admin created during setup below.
  Public sign-up with no invite creates a login that sees nothing until an admin attaches it.
- Invited colleagues start as **user** (no Settings access) unless invited as admin.
- In **Settings → Users** you can promote colleagues to admin (any number per org; the last admin can never be demoted or disabled — the database enforces it).
- To remove someone entirely: Supabase dashboard → **Authentication → Users** → delete.

## Clients (multi-tenant)

OneVio hosts several client companies in one install. Each client is an **org**; users
belong to exactly one org and see only its data.

**First-time upgrade of an existing install: one maintenance window, in this order**
1. Make sure the platform-admin login already exists (an existing user, or have that person
   sign up first). Then open `supabase-setup.sql` and set the two `EDIT ME` literals:
   - Line 20, `insert into public.orgs (id, name) values (..., 'My Company')` — the default
     org's name. Every row and user that existed before multi-tenancy is stamped onto this
     org, so nothing changes visibly for your current team.
   - Line 62, `where ... lower(email) = lower('you@yourcompany.com')` — the platform admin's
     sign-in email. It is a no-op until that account exists (re-run the file once it does).
     It also puts the account in the default org if it has no org yet.
   Both are idempotent: change and re-run the whole file any time.
2. Run `supabase-setup.sql`, then `email-alerts.sql`, in the SQL editor, in that order. Both
   are safe to re-run.
3. Deploy the new app **immediately** afterwards, and tell users to reload.

   The app is down between steps 2 and 3, so keep that gap to minutes. Neither piece can go
   first safely: the new app reads `profiles.org_id`, which does not exist before the SQL
   runs ("Could not load your profile" for everyone), and the old app reads `settings` by an
   `id` column the SQL drops and uploads files to paths the new storage policies refuse.

**Onboarding a client**
Settings → Platform (visible only to the platform admin) → fill in client name, the admin's
name, email and a temporary password → Create client. Share the credentials. That admin
adds their own team from Settings → Users. Switch into a client from the same card to see
exactly what they see; the amber badge in the sidebar shows which org you are currently in.

**Alert preferences per client** are rows in `public.org_alert_prefs` (which alert kinds are
enabled, health-drop sensitivity); edit them in the SQL editor for now — there is no UI for
this yet.

## Disabling a user

Admins can disable a colleague from **Settings → Users** instead of deleting their
account outright — their profile and history stay in place, but their access stops.

**Rolling this out to an existing project.** This feature shipped by changing
`supabase-setup.sql` itself, not by adding a new file. To pick it up, re-run
`supabase-setup.sql` **whole, top to bottom**, in the Supabase SQL editor — the same
step as section 2, just done again — **then re-run `email-alerts.sql`, in that order**,
if you've also installed the email digests (section 7 below). This run **rewrites the
live RLS policies**, it does not merely add to them. Do not run only part of the file:
the Supabase SQL editor runs the whole paste as one transaction, so a failure partway
through rolls the whole run back rather than leaving policies half-applied — but you
still want to finish it top to bottom rather than relying on that safety net. Ordering
against `email-alerts.sql` matters for a different reason: that file's `alert_recipients()`
function is `language sql`, which Postgres validates against the schema at creation time,
so running it before `supabase-setup.sql` adds the `disabled` column fails immediately with
`column p.disabled does not exist`. You do **not** need to re-run
`email-alerts-schedule.sql` for this change — its last statement fires a real send to
your team's real inboxes, so only run it when you actually mean to (re)install the cron
schedule.

**What "disabled" actually blocks.** A disabled user loses read/write access to every
entity through the database's row-level security rules the moment you flip the switch,
and they're signed out of the open app with an "Your access has been removed" screen the
next time it talks to the server. What disabling does **not** do is block sign-in itself:
Supabase's auth service (GoTrue) will still hand a disabled user a valid session token if
they try to log in again, because RLS only governs access to data, not authentication.
Don't describe this feature anywhere as preventing sign-in — it doesn't. If you ever need
a hard sign-in block, that requires calling GoTrue's admin API with the project's
`service_role` secret, which this app does not do.

One more wrinkle: a user disabled **while already signed in** keeps a stale copy of their
own profile in the browser until something forces a refresh (a reload, a new query), so
they may not see the ejection screen right away. That's a cosmetic delay only — RLS is
already denying their queries from the instant you disable them, so they have no real
access regardless of what their screen still shows.

**Changing a user's email.** An admin can also change a colleague's email address from
**Settings → Users**, next to the disable control. This bypasses Supabase's normal
confirm-the-new-address flow entirely — the address takes effect immediately and becomes
their sign-in address the moment it's saved, with no confirmation email sent to either the
old or new address.

## Optional: email alerts

Each person gets a digest covering **their own accounts only**: renewals due within 30
days and overdue tasks (daily at 09:00 IST), plus a Monday nudge for reviews that need
scheduling or look like they happened without being logged. Nothing is sent when there is
nothing to report.

1. Create a free account at [brevo.com](https://www.brevo.com) (300 emails/day free).
2. Brevo → **Senders & Domains → Senders** → add and verify the address alerts come **from**.
3. Brevo → **SMTP & API → API Keys** → **Generate a new API key** → copy it.
4. Open `email-alerts.sql`, paste the key and sender into the two `EDIT ME` lines —
   **do this in the Supabase SQL Editor, not in the repo copy** (never commit the real key).
   Edit **both** lines: the sender address must be a real, verified address too, not just
   the API key. The dispatcher refuses to send while `from_email` is still the placeholder
   `you@example.com`, and if you only paste the key you'll get a puzzling
   "alert_config not set" result instead of a sent email.

   **If you already ran the file once with the placeholders still in it**, editing it and
   running it again will *not* help: the config insert ends with `on conflict (id) do
   nothing`, which protects a real key in production but also means row 1 is never
   rewritten. Correct it with an update instead, in the SQL Editor:

   ```sql
   update public.alert_config
      set api_key = '<brevo key>', from_email = '<verified sender>'
    where id = 1;
   ```

   Check what is actually stored with
   `select left(api_key, 12), from_email from public.alert_config where id = 1;`
5. Run `email-alerts.sql` first, in the Supabase **SQL Editor**. Then run
   `email-alerts-schedule.sql` — this second script is what actually installs pg_cron and
   starts the scheduled sending; running only the first file creates the tables and
   functions but nothing will ever fire on its own. The last line of the second script
   fires a real send immediately, not a synthetic self-test: it mails every CSM who
   currently has a renewal due within 30 days (and mails admins the unowned accounts too),
   so its result text reaches real colleagues' inboxes.

This **replaces** `renewal-alerts.sql`, which mailed the whole team one shared digest.
**Do not run `renewal-alerts.sql` again** — the schedule script unschedules its old job for
you once, but re-running the old file recreates that job, and you'll get two renewal
emails a day: one team-wide from the old job, one per-CSM from the new one. The old file is
kept only for reference; if you ran it by mistake, undo it with
`select cron.unschedule('crm-renewal-alerts');`

**Checking whether mail is actually going out.** Settings → the error panel shows a
`email-send-failed` entry if any send failed in the last day. Admins can also read the
`email_log` table directly: `status` is `sent`, `failed`, `queued` or `unknown`, and
`response` carries Brevo's own words when a send was rejected.

**Accounts nobody is alerted about.** Alerts are routed by matching an account's CSM name
to a user's name. If they do not match — a typo, a renamed user, an unassigned account —
those accounts are listed in a highlighted block at the bottom of every admin's digest.
Fix them by correcting the CSM field on the account.

To change send times, edit the cron expressions at the end of `email-alerts-schedule.sql`
(they are UTC) and re-run that file. To stop all alerts:
`select cron.unschedule(j) from unnest(array['onevio-alerts-renewals','onevio-alerts-overdue','onevio-alerts-monday','onevio-alerts-settle']) j;`

## Day-to-day notes

- Changes save to the shared database immediately and other open browsers refresh within a second or two.
- **Settings** (health-score weights, currency rates, sample/clear/import data) is admin-only, enforced server-side.
- **Export JSON** (Settings) any time for a backup. **Import JSON** replaces the team's data — admins only, be careful.
- Deleting an account (admin only) removes it for everyone, including its contacts, activities, tasks and opportunities.

**Re-run `supabase-setup.sql` after pulling this change.** It adds the `error_log` table
and the `log_error` function. Until you do, the app still works but records nothing, and
the Settings error panel shows a permissions error.
