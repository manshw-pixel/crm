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

- **You sign up first** — the first account automatically becomes **admin**.
- Colleagues open the same URL and sign up; they start as **user** (no Settings access).
- In **Settings → Users** you can promote one colleague to be the second admin (max 2 admins; the last admin can never be demoted — the database enforces both).
- To remove someone entirely: Supabase dashboard → **Authentication → Users** → delete.

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
`select cron.unschedule(j) from unnest(array['onevio-alerts-daily','onevio-alerts-monday','onevio-alerts-settle']) j;`

## Day-to-day notes

- Changes save to the shared database immediately and other open browsers refresh within a second or two.
- **Settings** (health-score weights, currency rates, sample/clear/import data) is admin-only, enforced server-side.
- **Export JSON** (Settings) any time for a backup. **Import JSON** replaces the team's data — admins only, be careful.
- Deleting an account (admin only) removes it for everyone, including its contacts, activities, tasks and opportunities.

**Re-run `supabase-setup.sql` after pulling this change.** It adds the `error_log` table
and the `log_error` function. Until you do, the app still works but records nothing, and
the Settings error panel shows a permissions error.
