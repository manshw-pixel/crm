# Internal email alerts: five digests, sent per CSM

Date: 2026-08-21
Status: approved for planning

## The problem

OneVio has no email functionality. `crm.html` sends nothing — no compose, no
`mailto:`, no templates. The `email` strings in it are a contact field, an
activity *type* logged by hand, and Supabase auth forms.

One file exists: `renewal-alerts.sql` (commit `ce8cf92`), a standalone
Supabase job — `pg_cron` + `pg_net` calling Brevo — that mails every team
member a digest of accounts renewing within 30 days. It is not part of the
app and does not ship with it. As committed it is **inert**: the key line
still reads `PASTE_YOUR_BREVO_API_KEY`, and the function short-circuits on
exactly that string. By design the real key is pasted into the Supabase SQL
Editor and never committed, so the repository cannot tell whether it was ever
run.

The gap: work that needs attention today is only visible to someone who opens
the app. Renewals land, tasks go overdue, health declines and QBRs slip for
people who are not looking.

Note that notifications and digests were **explicitly excluded by the user**
in three prior specs (churn-forecast, renewal-playbooks, health-alerts), with
`renewal-alerts.sql` as the one deliberate exception. This spec reverses that
decision knowingly, at the user's request, for internal recipients only.

## Decisions taken during design

| Question | Decision |
|---|---|
| Recipients | **Internal team only** — signed-up users in `profiles`. No customer-facing mail. |
| Alerts | Five: renewals, overdue tasks, health drops, Monday MBR/QBR nudge, weekly summary. |
| Scoping | **Per-CSM, own book only.** Unowned accounts route to admins. |
| CSM to recipient | **Match on name, report misses.** No schema change to accounts. |
| Preferences | **Admin sets globally**, in `alert_config`. No per-user table. |
| Runtime | **Hybrid (approach C)** — SQL builders; the app owns health scoring. |

Because recipients are internal and consented by signing up, the whole
compliance layer is out of scope: no unsubscribe flow, no bounce or complaint
handling, no sender-domain reputation management, no per-contact consent.

## Two constraints that shaped the design

**1. Health scoring lives in JavaScript, inside `crm.html`'s JSX.** It is not
an importable module; the ~264 tests drive it through a real browser via
`window.__store`. Any non-JS runtime wanting a health score must reimplement
the formula — and the weights are admin-configurable in Settings, so two
copies would drift the moment someone tunes them. PR #35 established the rule
that there is one formula (`accountRetention` delegates to `retentionStats`);
this design does not break it.

**2. There is no per-account health history.** Snapshots are aggregate-only.
Unlike ARR — which PR #35 reconstructs by replaying `arrEvents` backwards —
health has **no event ledger and cannot be replayed**; it is computed fresh
from current inputs. "Health dropped since last check" therefore has no
baseline and none can be manufactured retroactively. It works only from the
day recording begins.

This splits the five alerts:

| Alert | Needs | Available today |
|---|---|---|
| Renewals approaching | `renewalDate` arithmetic | yes |
| Overdue tasks | `due` arithmetic | yes |
| QBR due + logging hygiene | `nextQbrDate`, activity recency | yes |
| Health drops | JS scoring + stored baseline | blocked, self-resolving |
| Weekly summary | ARR movement (+ health) | partially |

Rejected alternatives: **pure SQL** (would duplicate the scoring formula and
sit outside the Playwright harness entirely); **Supabase Edge Function**
(`supabase/` holds only `config.toml`; adds a deploy surface, CLI steps and
secrets management to a project deliberately kept to one HTML file plus SQL).

## Architecture

Four pieces, one direction of flow. **Builders are pure; only the dispatcher
touches the network.** That is what makes the logic testable without sending
mail, and what stops a Brevo outage from corrupting anything.

### 1. `alert_config` (extend the existing table)

Already defined by `renewal-alerts.sql` with RLS on and **zero policies**, so
the key is unreadable by app users. Keep it as the credential store; add:

- `enabled_kinds text[]` — the admin's global on/off switches.
- `health_drop_points int default 10`, `health_drop_window_days int default 7`.
- `api_base text` defaulting to Brevo's endpoint — injectable so tests can
  exercise the failure path (see Testing).

Columns rather than a new table, so there is exactly one place a human edits.

### 2. Health-baseline writer (app-side, JavaScript)

When the app computes health scores — already on every load — it upserts
`{accountId, score, computedAt}` into a new `health_snapshots` table, one row
per account per day. Repeated loads on the same day overwrite rather than
accumulate.

This is the piece that keeps the JS formula the single source of truth:
**SQL never scores anything; it only compares two stored numbers.**

### 3. Five builder functions (SQL, pure)

One per alert. Each takes a recipient and **returns rows** — no sending, no
side effects, individually testable.

### 4. Dispatcher `send_alerts(kind)` (SQL, security definer)

Resolves recipients, calls the relevant builder per person, renders HTML,
posts to Brevo via `pg_net`, records the outcome. `pg_cron` calls it: daily
for alerts 1–3, Mondays for 4–5. Execute is revoked from `public`, `anon` and
`authenticated`, as the existing script does.

Recipient resolution is its own function: `account.csm` to `profiles.name` to
`auth.users.email`. **`account.csm` is free text**, matched by string equality
against the user's name (`crm.html:3783`), and `profiles` has no email column
— addresses live in `auth.users`, unreadable from the browser. The first hop
is brittle: a renamed user, a typo, or a value matching nobody produces a book
that emails no one. Any unmatched `csm` value is therefore **collected and
reported** — into the admin digest and into `error_log` — never silently
dropped. A silent absence is the failure mode this project has been bitten by
repeatedly.

Accounts with an empty `csm`, and accounts whose `csm` matches no profile, are
routed to **admins** (`is_admin()`), so no account's alerts fall on the floor
merely because ownership is unset. They appear in a separate, clearly labelled
section of the admin's digest rather than mixed into the admin's own book.

## The five alerts

A digest with zero rows is **not sent**. The existing script establishes that
rule and it is what keeps a daily email from becoming background noise.

**1. Renewals approaching** (daily) — recipient's accounts with `renewalDate`
within 30 days, excluding churned. Soonest first; existing red/amber
convention at the 7-day mark. This is `renewal-alerts.sql`'s query re-scoped
from the whole team to one person's book.

**2. Overdue tasks** (daily) — tasks with `status != 'Done'` and `due <
today`, grouped by account, oldest first. Tasks carry no assignee, so routing
goes through the account's `csm`.

**3. Health drops** (daily; dormant until baselines exist) — accounts where
today's snapshot is at least `health_drop_points` below the most recent
snapshot at least `health_drop_window_days` old. Two guards: an account with
fewer than two snapshots is **skipped**, never treated as a drop from zero;
and an account is not re-alerted for the same decline on consecutive days.

Re-arming, stated precisely to remove the ambiguity: once an account alerts,
record the score that triggered it. It does not alert again until either the
score rises back above that trigger score, or it falls a further
`health_drop_points` below it. A slow continuous slide therefore produces one
email per threshold crossed, not one per day.

The 10-point / 7-day default is **a guess** — there is no data on day-to-day
score noise. It lives in `alert_config` so it is tunable without a code
change, and the first real value should be expected to be wrong.

**4. Monday MBR/QBR nudge** (Mondays) — two sections in one email:

- *Due to schedule*: `nextQbrDate` within 14 days or already past, per
  `qbrFrequency`.
- *Possibly unlogged*: `nextQbrDate` has passed but no activity of type `QBR`
  exists within ±14 days of it — the meeting that likely happened and was
  never written down.

The second section is **a suspicion, not a fact, and the email must say so in
those words.** Phrased as an accusation it will be resented, and the signal is
genuinely inferential. There is no `MBR` concept in the data model; monthly
reviews are covered by `qbrFrequency` and activity recency, not a new field.

**5. Weekly book summary** (Mondays) — ARR movement over the last 7 days from
`arrEvents`, renewals landing this week, opportunities that changed stage, and
count of accounts at risk. The health section is omitted until baselines
exist, then appears automatically.

Alerts 1 and 4 **overlap with the UI** — the Accounts view already has a "QBR
due" filter and renewal badges. Accepted: email's job is to reach someone who
is not looking at the app. But they re-surface known data, and for a team
living in the app daily they add less than 2, 3 and 5.

## Delivery and failure

`renewal-alerts.sql` calls `net.http_post` through `perform`, **discarding the
request id**, then returns `email queued to N recipient(s)`. That is a claim
about the queue, not about delivery. A revoked key, an unverified sender and a
blown quota all produce the identical cheerful message and the failure is
invisible forever. This is the same shape as the vacuous RLS tests and the FX
test that could not fail: a green signal measuring nothing. Fixing it is a
primary goal of this work, not a side effect.

`pg_net` is asynchronous, parking responses in `net._http_response`. So:

- The dispatcher **captures the request id** and writes an `email_log` row:
  recipient, kind, row count, request id, `status = 'queued'`, timestamp.
- A **settle job** runs a few minutes later, joins `email_log` to
  `net._http_response`, and resolves each row to `sent` or `failed` with the
  HTTP status and Brevo's response body. Anything unsettled after an hour
  becomes `unknown` rather than staying `queued` forever.
- Failures and unroutable CSM names flow into `error_log` through the existing
  fingerprint mechanism, collapsing to one row with a rising `count`, visible
  in the admin error panel from PR #33. **No new UI is required for this to be
  visible** — the reason to reuse `error_log` rather than invent a parallel
  surface.

`email_log` copies `error_log`'s policy shape exactly: RLS on, admin-only
`select`, **no `update` and no `delete` policy**, dispatcher owns every write.
It stores recipient address, kind and counts — **never account names, ARR
figures or row contents.** `error_log`'s header makes this argument for
customer revenue data; it applies identically here.

- **Idempotency**: unique on `(kind, recipient, date)`, so a cron double-fire
  or a manual re-run cannot double-send.
- **Quota**: Brevo free is 300/day. Five kinds times per-CSM sending is
  comfortably inside that at current team size, but the dispatcher logs when
  within 10% rather than discovering the ceiling by hitting it.
- **Secrets**: the key stays in `alert_config`, pasted via the SQL Editor,
  never committed. `TEAM-SETUP.md` already states this.

## Testing

**Builders** — `tests/rls/` already runs real SQL against a local Supabase
with its own bootstrap and exit-code contract. Seed accounts, tasks and
activities; call each builder directly; assert on returned rows. Covers the
30-day window, the overdue-task join, the two-snapshot guard, the ±14-day QBR
inference, and recipient resolution including unmatched-name reporting.

**Dispatcher** — the `api_base` column makes the send target injectable.
Tests point it at a local endpoint and exercise **both a 200 and a 500**,
which is the only way to prove the settle-to-`sent`/`failed` path works.
Without that column the failure path ships unverified — reproducing the exact
defect this design exists to fix.

**Health-baseline writer** — app-side JS, so `tests/health/` with Playwright:
snapshot written on load; upserted, not duplicated, within a day; and an
account with a single snapshot produces **no** alert.

Three traps this project has already paid for, guarded by construction:

- Every new test must be **shown to fail before it passes**. The vacuous-RLS
  and unlisted-currency-FX incidents were both green tests asserting nothing.
  A builder test that "passes" on zero matched rows is that bug in new
  clothing, so each asserts a specific **non-empty** result, not an absence.
- Any test asserting on rendered UI must seed `profiles`, or the account table
  never renders; and must press `3` to reach Accounts first.
- Use the subset runner, not full-suite background runs — the harness has
  repeatedly killed those.

**Known gap:** `pg_cron` scheduling is not tested. That it fires at 03:30 UTC
is taken on trust and verified once manually; testing it means waiting on
wall-clock time. Everything the scheduler *calls* is covered.

## Incidental correction

`log_error`'s retention comment states that this project has no scheduler, and
runs cleanup inline for that reason. Installing `pg_cron` makes that premise
false. The behaviour is not changed here, but **the comment must be corrected**
rather than left to mislead the next reader.

## Implementation order

This is a large spec — five alerts, a baseline writer, a dispatcher and a
settle job. It should be built in this order, because each phase is
independently shippable and the later ones depend on the earlier:

1. **Plumbing**: extend `alert_config`, create `email_log`, build the
   dispatcher and the settle job, with **one** trivial builder behind them.
   This is the phase that proves delivery is observable; nothing else is worth
   building until a failed send is visible.
2. **The three date-driven alerts** (renewals, overdue tasks, Monday nudge) —
   pure SQL over existing data, no new dependencies.
3. **Health baseline writer** — app-side, ships dark and starts accumulating.
4. **Health drop alert** — switches on once baselines exist, roughly one to
   two weeks after phase 3 reaches production.
5. **Weekly summary** — last, since it is the only one that gains a section
   retroactively when phase 4 lands.

Phases 1 and 2 deliver the majority of the value. If work stops after phase 2,
what shipped is coherent and complete on its own terms.

## Non-goals

- Any customer-facing email. Contacts are never recipients.
- Per-user preferences — admin-global only, by decision.
- `mailto:` links or compose UI in the app.
- A real `MBR` entity in the data model.
- An `owner_id` FK on accounts. Considered and rejected as its own project;
  name-matching with visible miss reporting is the chosen path.
- Unsubscribe, bounce and complaint handling — not applicable to internal
  consented recipients.
- Migrating `renewal-alerts.sql` users. Its cron job should be unscheduled
  when this ships, since alert 1 supersedes it.
