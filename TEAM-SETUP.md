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

1. Push the repo (or just `crm.html`) to GitHub.
2. Repo **Settings → Pages → Deploy from a branch**, pick your branch, save.
3. Share the URL: `https://<your-user>.github.io/<repo>/crm.html`

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
