# QA Agent — Design

**Date:** 2026-10-14
**Status:** Draft, awaiting user review

## Goal

On the user's instruction (`/qa-run [feature]`), an agent runs a full end-to-end QA pass of the
live CRM (crm.onevio.in), exercising every feature as a human tester would, then publishes a
shareable report with pass/fail per feature and, for each failure, a suspected cause and a
proposed fix. The agent never changes code.

## Decisions (agreed with the user)

| Topic | Decision |
|---|---|
| Target | The live site, inside a dedicated **"OneVio QA"** org. Real client orgs are never touched. |
| Execution | Scripted Playwright scenarios (deterministic). Claude orchestrates and analyses failures. |
| Supabase access | **None.** No service-role key, no CLI, no SQL. Everything goes through the app's UI as a user. |
| Report | One fixed, private artifact page, updated in place each run; shareable by link. |
| On failure | Report + proposed fix (file/line, reasoning, confidence). No code changes, no PRs. |

## One-time manual setup (user)

1. In the client console, create org **"OneVio QA"** with generous limits.
2. In that org, create four permanent users: QA Admin, QA CSM, QA AM, QA Lead (confirm their emails once).
3. Put their emails and passwords in `.env.qa` at the repo root (git-ignored):
   `QA_BASE_URL`, `QA_ORG_NAME`, `QA_ADMIN_EMAIL/PASS`, `QA_CSM_EMAIL/PASS`, `QA_AM_EMAIL/PASS`, `QA_LEAD_EMAIL/PASS`.

## Feature catalogue (v1)

| # | Feature | Scenarios |
|---|---|---|
| 1 | Sign-in & access | admin sign-in; wrong password rejected; sign-out; disabled user blocked (admin disables QA Lead, Lead sign-in fails, re-enable) |
| 2 | Users | Add-user form submits and reports status; each role sees only what it should; user limit message shown when limit set low then restored |
| 3 | Client upload (CSV) | import fixture CSV incl. custom-field columns; verify rows, DD-MM dates, currency, owners; re-import updates not duplicates; malformed file rejected cleanly |
| 4 | Accounts | create/edit; contacts; touchpoints; attachment upload + open via signed URL; account limit enforced |
| 5 | Health & playbooks | score renders and moves after a touchpoint; a playbook creates tasks |
| 6 | Tasks | create, assign, complete, filter |
| 7 | Renewals | upcoming list; change renewal date; churn account, ARR changes |
| 8 | Finance | create invoice, verify totals/tax; PDF downloads; purchase order; payment status |
| 9 | Dashboard & analytics | ARR, NRR/GRR, ARR bridge, license cards agree with the seeded fixture |
| 10 | Platform | client console renders for platform admin only; dark mode; mobile viewport; notification bell |

**Out of scope v1:** creating a brand-new user through to first sign-in (needs email confirmation),
alert-email delivery, touchpoint email-ingest worker, exploratory (unscripted) testing.

## Run flow

1. **Pre-flight** — site reachable; deployed build matches `origin/master`; `.env.qa` present; QA Admin's
   org name equals `QA_ORG_NAME`. Any failure aborts with a clear message.
2. **Reset** — as QA Admin, delete every account/task/invoice in the QA org through the app's own bulk
   actions, then import the fixture via CSV. Leftovers from a crashed run are removed here.
3. **Execute** — Playwright runs feature scenarios (all, or the one named), screenshot per step, trace on failure.
4. **Cleanup** — delete what the run created (best effort; reset on the next run is the backstop).
5. **Analyse** — Claude reads each failure's screenshot, error and related `src/` code, writes cause + fix + confidence.
6. **Publish** — update the fixed report artifact.

### Safety guard

Every scenario begins by asserting the signed-in profile's org is `QA_ORG_NAME`. The runner aborts the whole
run on mismatch. This is the only thing standing between the agent and real client data, so it is a
hard stop, not a warning, and it has its own test (pointed at a non-QA login, the run must refuse).

## Components

- `tests/qa/env.mjs` — loads/validates `.env.qa`.
- `tests/qa/session.mjs` — sign in as a role; the org guard.
- `tests/qa/fixtures/` — the seed CSV (~15 accounts, mixed currencies/statuses, custom fields) and expected totals.
- `tests/qa/features/NN-name.mjs` — one file per catalogue feature; each exports scenarios `{ id, title, run(page, ctx) }`.
- `tests/qa/run.mjs` — pre-flight, reset, execute, cleanup; writes `tests/qa/out/<runId>/results.json` + screenshots/traces. Exit code non-zero on any failure.
- `tests/qa/report/` — HTML template that renders results + history.
- `.claude/commands/qa-run.md` — the slash command: run, analyse failures, publish.
- History: last 20 `results.json` summaries kept in `tests/qa/out/history.json` (git-ignored) and embedded into the report.

## Report

Verdict + run time + build SHA + diff vs previous run (new failures / newly fixed); feature table with
expandable scenarios; per-failure card (steps, screenshot, error, suspected cause at `file:line`, proposed fix,
confidence); 20-run history strip to separate flakes from regressions.

## Testing the tester

- The org guard: refusal test against a non-QA login.
- Each scenario has been seen to fail at least once (break the assertion locally) so none pass vacuously.
- Two consecutive clean runs on live with no leftover rows in the QA org before declaring v1 done.

## Risks

- **Live data in a shared DB:** mitigated by the org guard and RLS; QA users exist only in the QA org.
- **Flakiness on live network:** one automatic retry per scenario; a pass on retry is reported as "flaky", not "pass".
- **Limits tests change org settings:** they restore the original value in a `finally`.
