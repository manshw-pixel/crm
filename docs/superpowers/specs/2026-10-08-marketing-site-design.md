# onevio.in marketing site — design

Date: 2026-10-08

## Goal
A public website at **onevio.in** that sells OneVio CRM to B2B companies' customer success
teams. It has two jobs:
- Turn visitors into **demo requests**.
- Send existing customers to **Login** (`https://crm.onevio.in/crm.html`).

## Decisions (agreed with user)
- **Audience:** companies buying a CS platform (option A). The primary action is Book a demo; the secondary is Login.
- **Demo requests** go into Supabase. They are listed on the platform admin's Clients console, and you get an email via the existing Brevo config (option A).
- **Hosting:** a new GitHub repo, `onevio-site`, on GitHub Pages. DNS stays in Cloudflare (option A).
- **No pricing section** (option C).
- **Honesty rule:** every claim maps to a shipped feature. There are no invented customer logos,
  testimonials, user counts or uptime figures. Screenshots use **demo data only**, never
  production data.

## Components and where they live

| Unit | Repo | Responsibility |
|---|---|---|
| `demo_requests` table + `submit_demo_request()` + `list_demo_requests()` | `crm` (supabase-setup.sql) | Store requests; public can only submit |
| Request email | `crm` (email-alerts.sql) | One Brevo email per request to the platform admin(s) |
| Demo requests list | `crm` (src/25-auth-admin.jsx, Clients console) | Platform admin reads requests |
| Screenshot script | `crm` (`tests/site-shots.mjs`) | Render the app with a rich demo dataset and save PNGs |
| Static site | new `onevio-site` repo | The pages, assets, form JS, Pages deploy |

The site never ships CRM code. It only calls one RPC over HTTPS with the public anon key, which
is the same key the CRM's browser bundle already ships.

## Site structure (onevio-site)
Files: `index.html`, `privacy.html`, `404.html`, `assets/` (screenshots as optimised PNG/WebP,
favicon, OG image), `site.css`, `demo-form.js`, `CNAME` (`onevio.in`), `robots.txt`,
`sitemap.xml`. Hand-written HTML/CSS, with no framework or build step. Google Fonts is the only
external dependency.

Sections of `index.html`, in order:
1. **Header (sticky):**
   - OneVio wordmark.
   - Anchor links: Features, How it works, Book a demo.
   - A **Login** button linking to `https://crm.onevio.in/crm.html`.
   - On phones, these collapse into a menu button.
2. **Hero:**
   - Headline about catching renewals and churn risk early.
   - A one-line sub-heading naming the audience (customer success teams).
   - Buttons: **Book a demo** (to `#demo`) and **Login**.
   - The dashboard screenshot in a browser frame.
3. **Features:** six alternating screenshot/text blocks. Each has a headline, 2–3 sentences and 3 bullets drawn from real behaviour:
   1. **Health scores and alerts**: weighted health score, risk bands, the notification bell.
   2. **Renewals and playbooks**: renewals pipeline and stages, auto-created playbook tasks in the 90-day window, QBR nudges.
   3. **Retention you can defend**: ARR bridge, NRR/GRR from existing customers only, churn analysis, cohorts.
   4. **Every account in one place**: account page, contacts, activities, documents, email touchpoints logged by forwarding.
   5. **Team workflow**: tasks by owner, My book vs All, bulk actions, CSV import/export.
   6. **License deployment**: total vs deployed, lowest-deployment accounts.
4. **How it works:** three steps.
   1. Import accounts from CSV or your spreadsheet.
   2. Your CSMs work renewals and tasks.
   3. Leadership tracks ARR, NRR and GRR.
5. **Built for teams:** separate workspace per company with data isolation enforced in the
   database; admin and user roles; disable a user instantly; daily email digests; dark mode;
   works on phones.
6. **Book a demo (`#demo`):** a form with name*, company*, work email*, team size (select: 1–5, 6–20,
   21–50, 50+), and an optional message.
   - **On success:** the form is replaced by `Thanks — we'll be in touch within one working day.`
   - **On failure:** an inline error with the contact email shown as selectable text.
7. **Footer:** wordmark, Login, contact email (text), Privacy, `© 2026 OneVio`.

`privacy.html` states what the form collects, why, where it's stored (Supabase), that nothing is
sold or shared, and the contact address for deletion. `404.html` links home and to Login.

**Visual direction:**
- It follows the CRM's identity (indigo accent, the same wordmark) so Login feels continuous.
- The page itself gets its own considered type pairing and layout.
- Light and dark themes via `prefers-color-scheme`.
- Responsive down to 360px with no horizontal scroll.
- Respects `prefers-reduced-motion`.
- **Quality bar:** Lighthouse ≥ 90 for performance, accessibility, best practices and SEO on mobile. Pages have meta description, canonical, Open Graph and Twitter tags, plus the favicon.

## Demo requests (crm repo)

**Table `public.demo_requests`:**
- Columns: `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`,
  `name text not null`, `company text not null`, `email text not null`, `team_size text`,
  `message text`, `source text default 'onevio.in'`.
- RLS is enabled with **no policies**, so nothing is readable or writable directly by anon or authenticated.

**`submit_demo_request(p_name, p_company, p_email, p_team_size, p_message, p_website)`:**
- Security definer, executable by `anon` and `authenticated`.
- **Honeypot:** `p_website` is a hidden field. If it's non-empty, return `ok` and store nothing.
- **Validation:** trims all fields. Name and company 1–120 characters; email passes `valid_email()` and is
  ≤ 200 characters; team_size is one of the four options or null; message ≤ 2000 characters.
  Violations raise `submit_demo_request: <field> ...`.
- **Rate limit:** at most 3 requests per email per 24h, and 200 per 24h overall. Beyond that,
  raise `Too many requests — please email us instead.`
- Inserts the row, then calls the request email (below) when email alerts are installed.
- Returns `'ok'`.

**`list_demo_requests()`:** platform admin only. Returns rows newest first, limited to 200.

**Email** (in `email-alerts.sql`, so it's absent when alerts aren't installed):
- `notify_demo_request(p_id uuid)` sends one Brevo email via the existing `alert_post` and
  `alert_config` (api_key, from_email, from_name, api_base) to every platform admin's email.
- Subject: `New demo request: <company>`.
- Body: the escaped fields, using `html_escape`.
- A missing key or config means it silently skips: the request is still stored, and the console is the source of truth.
- `submit_demo_request` calls it via `to_regprocedure` / dynamic `perform`, so the setup file doesn't depend on email-alerts.sql.

**Console:**
- On the Clients console, a **Demo requests (N)** card below Clients lists date, name, company,
  email (selectable), team size and message.
- New since the last visit are highlighted, using a per-viewer `localStorage` last-seen timestamp.

## Screenshots (crm repo, `tests/site-shots.mjs`)
- Uses `buildMockedHtml` from `tests/health/harness.mjs` with a **rich fictional dataset**:
  - about 25 accounts with fictional company names, across tiers, CSMs, currencies and renewal dates;
  - 12 monthly snapshots so the trends charts render;
  - tasks, opportunities, activities, contacts, and license figures;
  - one org named "Acme Analytics".
- Playwright opens the dashboard, renewals, account page, tasks and the analytics section (expanded). It captures at 1440×900 with deviceScaleFactor 2 in light mode, plus a dark dashboard shot.
- Output: `site-shots/*.png`, which is git-ignored in crm and copied into `onevio-site/assets/` by the plan.
- Re-runnable whenever the app changes.

## Deploy (onevio-site)
- GitHub repo `manshw-pixel/onevio-site` (public, like `crm`).
- Pages serves from the default branch root, and `CNAME` contains `onevio.in`.
- A workflow runs html-validate, checks links, and checks that the Login URL and the RPC URL exist.
- **DNS** (user does this in Cloudflare):
  - Apex `onevio.in`: four A records, `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`. Set them to **DNS only** (grey cloud) so GitHub can issue HTTPS.
  - `www`: CNAME to `manshw-pixel.github.io`.
  - Then tick "Enforce HTTPS" in the repo's Pages settings.

## Testing
- **RLS tests** (`tests/rls/demo-requests.test.mjs`):
  - anon can submit and cannot select;
  - the honeypot stores nothing;
  - each validation rule rejects;
  - the rate limit triggers;
  - only the platform admin can list;
  - an org admin cannot.
  - Positive controls throughout.
- **Health tests:** the Demo requests card renders the rows and the "new" highlight; a non-platform admin never calls `list_demo_requests`.
- **Site:**
  - A Playwright check against the static files, served locally: the Login href is exact, every anchor target exists, no horizontal scroll at 360px, and both themes render.
  - The form posts the right RPC args with the mocked fetch, shows the success state, and shows the error state.
- **Manual after DNS:** https://onevio.in loads with a valid certificate; a real demo request appears on the console and arrives by email.

## Out of scope
Blog, pricing, analytics/tracking scripts, cookie banner (no cookies are set), multi-language,
self-serve sign-up.
