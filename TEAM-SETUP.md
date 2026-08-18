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

## Optional: daily renewal email alerts

Emails every team member a digest of accounts renewing within 30 days (daily at 09:00 IST, only when something is due).

1. Create a free account at [brevo.com](https://www.brevo.com) (300 emails/day free).
2. Brevo → **Senders & Domains → Senders** → add and verify the address alerts should come **from** (your own email works).
3. Brevo → **SMTP & API → API Keys** → **Generate a new API key** → copy it.
4. Open `renewal-alerts.sql`, paste the API key and your verified sender address into the two `EDIT ME` lines — **do this in the Supabase SQL Editor, not in the repo copy** (never commit the real key to GitHub).
5. Run the whole script in Supabase **SQL Editor**. The last line fires a test immediately — its result text tells you whether an email was sent, and it lands in every signed-up user's inbox.

To change the send time, edit the cron expression (`'30 3 * * *'` is UTC) and re-run the script. To stop alerts: `select cron.unschedule('crm-renewal-alerts');`

## Day-to-day notes

- Changes save to the shared database immediately and other open browsers refresh within a second or two.
- **Settings** (health-score weights, currency rates, sample/clear/import data) is admin-only, enforced server-side.
- **Export JSON** (Settings) any time for a backup. **Import JSON** replaces the team's data — admins only, be careful.
- Deleting an account (admin only) removes it for everyone, including its contacts, activities, tasks and opportunities.

**Re-run `supabase-setup.sql` after pulling this change.** It adds the `error_log` table
and the `log_error` function. Until you do, the app still works but records nothing, and
the Settings error panel shows a permissions error.
