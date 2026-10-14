# OneVio QA agent

Drives the LIVE CRM (crm.onevio.in) through its UI, inside a test-only org, and reports what broke.
It never touches the database directly and never changes `src/`.

## One-time setup
1. In the client console create the QA org (currently named **Crm**). Never point this at a real org.
2. Create its users: **admin**, **csm**, **lead** (an **am** user is optional; AM scenarios skip without it).
   Confirm each user's email and sign in once so the password works.
3. Copy `.env.qa.example` to `.env.qa` and fill in `QA_BASE_URL`, `QA_ORG_NAME=Crm` and each
   `QA_<ROLE>_EMAIL` / `QA_<ROLE>_PASS`. `.env.qa` is git-ignored; never commit it.
   `QA_ENV_FILE=<path>` points the runner at a different env file.
   It only selects which file is read: the org guard still compares the signed-in org to that file's `QA_ORG_NAME`.
4. Optional, to un-skip the invoice scenarios: as the QA admin add an INR billing entity (country IN,
   Default tax % 18) in Settings -> Billing entities.

## Running
- `/qa-run` in Claude Code: runs everything, analyses failures, publishes the report artifact.
- `/qa-run 08-finance`: one feature.
- `npm run qa` (= `node tests/qa/run.mjs [--feature <prefix>] [--skip-reset]`): just the runner.
- `node tests/qa/report/build.mjs [runId]`: render `out/<runId>/report.html` (default: newest run).
- `npm run test:qa-unit`: offline unit tests.

Every run (unless `--skip-reset`) deletes all accounts named `QA qa-*` and imports 15 fresh ones named
`QA <runId> <Company>`. `--skip-reset` reuses the accounts of the most recent seeded run (`seedRunId` in
history.json) and names anything new after the current run; the invoice scenarios skip under it.

Output goes to `tests/qa/out/<runId>/` (results.json, shots/, report.html) and `out/history.json`, all git-ignored.

## Exit codes
| code | meaning |
|---|---|
| 0 | all scenarios pass / flaky / skipped |
| 1 | at least one scenario failed |
| 2 | org guard abort: signed in to an org other than `QA_ORG_NAME`; nothing was reset or run |
| 3 | pre-flight: bad args, live != master, site unreachable, same-minute rerun, no seeded run for `--skip-reset` |
| 4 | infrastructure abort after pre-flight (results.json still written with an "aborted:" note) |

## By design
- Invoices and POs cannot be deleted, so they accumulate in the QA org. Assertions are scoped to the run.
- Org-setting changes (limits, user disable) are restored in `finally`; limit scenarios skip unless the org is already full.
