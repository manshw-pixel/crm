# OneVio CRM — Test Catalogue

Owner: Quality & Testing. Last full audit: 2026-10-07 (branch `qa-audit`).

This is the map of **what is tested, where, and what is not**. Every automated case is listed
by name in the [appendix](#appendix-every-automated-case), generated from the suites, so it
cannot drift from what actually runs. Areas marked **MANUAL** have no automation and must be
run by hand before a release that touches them.

## How to run

| Suite | Command | Where it runs | What it proves |
|---|---|---|---|
| Unit (pure logic) | `npm run test:unit` | local + CI, ~1.5s | `src/lib`: reducer + write plan, write queue, money, dates, scoring, retention, CSV, URLs. Golden cases pin behaviour to the pre-split app. |
| Worker | `npm run test:worker` | local + CI | Cloudflare email worker (touchpoint ingest). |
| E2E (browser) | `node tests/health/run.mjs > e2e.log 2>&1` | local + CI, ~60 min locally | The **built** `dist/crm.html` against an in-memory Supabase mock. Never pipe it — the exit code is the deploy gate. |
| One E2E file | `node tests/health/run-one.mjs <file>` | local | Fast red/green loop. |
| RLS / access control | `node tests/rls/run.mjs` | **CI only** (needs Docker) — open a draft PR to trigger | Real Postgres + GoTrue + Storage: policies, triggers, RPCs, multi-tenant isolation. |

Rules every new test follows (see `tests/` gotchas): register it in `run.mjs` (hardcoded list);
wait ~50ms after `dispatch` before reading `__store`; target `data-*` attributes, not page text;
**prove it bites** — revert the fix, watch it fail, restore.

## Coverage matrix

Legend: ✅ automated · ⚠️ partial · ❌ none (MANUAL)

### 1. Authentication & session
| ID | Case | Status | Where |
|---|---|---|---|
| AUTH-01 | Sign in, sign out, session restore | ✅ | `signout`, `rls/auth` |
| AUTH-02 | Sign-up matching an invite joins that org; no invite → no org, no data | ✅ | `rls/auth`, `rls/orgs` |
| AUTH-03 | Disabled user is locked out (RLS, not just UI) | ✅ | `rls/policies`, `settings` |
| AUTH-04 | Password reset email → set-new-password screen → sign in | ❌ MANUAL | Supabase redirect to `https://crm.onevio.in/crm.html` |
| AUTH-05 | Disabled client org shows the suspended screen | ✅ | `client-console`, `rls/orgdisable` |

### 2. Multi-tenant isolation
| ID | Case | Status | Where |
|---|---|---|---|
| TEN-01 | Org A cannot read/write org B rows, settings, files | ✅ | `rls/orgs`, `rls/storage` |
| TEN-02 | Platform admin console: create, list, enable/disable, switch org | ✅ | `client-console`, `rls/orgs` |
| TEN-03 | Realtime DELETE events do not leak across orgs | ❌ known open item | — |
| TEN-04 | Invite withdrawal | ❌ not built | — |

### 3. Accounts
| ID | Case | Status | Where |
|---|---|---|---|
| ACC-01 | Create (auto account #), edit, delete with cascade to contacts/activities/tasks/opps | ✅ | `reducer-actions`, `bulk`, `persistence` |
| ACC-02 | Deleting a parent orphans subs and writes `parentId: null` | ✅ | `reducer-actions` |
| ACC-03 | Every field edit leaves one audit entry; ARR edits book expansion/contraction | ✅ | `arr-audit`, `diffrow` |
| ACC-04 | Currency change = redenomination, not contraction | ✅ | `redenomination`, `currency-history` |
| ACC-05 | Churn (single + bulk) and reactivate | ✅ | `reducer-actions`, `bulk` |
| ACC-06 | Documents add/edit/delete with audit | ✅ | `reducer-actions` |
| ACC-07 | Document/attachment links can never execute script | ✅ | `link-safety`, `unit/urls` |
| ACC-08 | List virtualization at 2000 accounts within perf budget | ✅ | `virtualization` |
| ACC-09 | Filters, sort, segments, mobile layout | ✅ | `segments`, `page-polish`, `mobile` |
| ACC-10 | Total and deployed licenses: edit form, CSV import/export, validation | ✅ | `licenses` |
| ACC-11 | License deployment card: summary, per-account list, scope filtering | ✅ | `licenses` |

### 4. Health scoring & playbooks
| ID | Case | Status | Where |
|---|---|---|---|
| HLT-01 | Score formula, weights, clamp of inputs | ✅ | `unit/scoring`, `health-mix` |
| HLT-02 | Recency per-type blend + Value parameter (inert by default) | ✅ | `health-mix*` |
| HLT-03 | Band crossing fires health playbook once | ✅ | `crossing`, `backfill` |
| HLT-04 | Onboarding playbook seeding | ✅ | `reducer-actions`, `tasks` |
| HLT-05 | Health snapshots monthly | ✅ | `health-snapshot` |

### 5. Revenue analytics
| ID | Case | Status | Where |
|---|---|---|---|
| REV-01 | NRR/GRR trailing 12m; **new logos excluded from the ratios** | ✅ | `unit/retention-cohort`, `retention` |
| REV-02 | Per-account retention vs Dec close (ledger replay) | ✅ | `account-retention`, `retention-ui` |
| REV-03 | AM book by handover cohort | ✅ | `am-book`, `transition-date` |
| REV-04 | Cohort grid, churn analysis, renewal outcomes vs forecast | ✅ | `cohort`, `churn-analysis`, `renewal-outcomes` |
| REV-05 | Money formatting incl. negatives and the K→M boundary | ✅ | `unit/money-format` |
| REV-07 | ARR bridge: opening + new + expansion − contraction − churn = today; bridge NRR/GRR equal the tiles | ✅ | `arr-bridge` (unit + E2E) |
| REV-08 | Per-account and headline retention honour an explicit "as of" date | ✅ | `unit/retention-now` |
| REV-06 | FX: unknown currency converts to 0 | ⚠️ by design, untested in UI | `unit/money` |

### 6. Renewals, tasks, QBRs, activities, contacts
| ID | Case | Status | Where |
|---|---|---|---|
| REN-01 | Complete renewal writes entry with booked currency | ✅ | `renewal-write` |
| TSK-01 | Task create/edit/toggle/bulk, buckets, filters | ✅ | `tasks`, `reducer-actions` |
| QBR-01 | Logging a QBR schedules the next (month-end safe) | ✅ | `reducer-actions`, `unit/qbr` |
| ACT-01 | Activities add/edit/delete, touchpoint inbox entries | ✅ | `reducer-actions`, `touchpoint-activity`, `worker/*` |
| CON-01 | Contacts add/edit/delete | ✅ | `contacts`, `reducer-actions` |
| OPP-01 | Opportunity add, stage change, won → ARR event | ⚠️ add/stage only | `reducer-actions` |

### 7. Import / export
| ID | Case | Status | Where |
|---|---|---|---|
| CSV-01 | Export → re-import round-trips; dedupe by account # then name | ✅ | `csv` |
| CSV-02 | DD-MM vs MM-DD detection; mixed file refused | ✅ | `csv-dates`, `unit/csv` |
| CSV-03 | **Blank/unreadable cells never overwrite stored data** (arr, licenses, deployedLicenses, currency, tier, status) | ✅ | `csv-import-safety`, `unit/csv-number` |
| CSV-04 | Grouped numbers (`1,000,000`, `10,00,000`, `$`, `₹`) parse correctly | ✅ | `unit/csv-number` |
| CSV-05 | Exports are safe to open in Excel (formula injection) | ✅ | `unit/csv-injection` |
| CSV-06 | Finance billing CSV | ✅ | `csv` |
| CSV-07 | JSON import / sample data / clear — admin only, one transaction | ✅ | `rls/replace` |
| CSV-08 | Google Drive folder sync end-to-end with a real Drive | ❌ MANUAL | `drive-permission` covers permission only |

### 8. Persistence & resilience
| ID | Case | Status | Where |
|---|---|---|---|
| DUR-00 | Reducer: every action never mutates state (frozen-input check, table must list every action), transitions, and the exact writes each produces (`persistOps`); `diffRow` edge cases | ✅ | `unit/reducer` (68) |
| DUR-02u | Write queue in isolation: serial, backoff schedule, rejected sends, give-up clears + reports once, recovery | ✅ | `unit/write-queue` (7) |
| DUR-01 | Writes send diffs (merge_row), concurrent edits don't revert each other | ✅ | `diffrow`, `rls/merge` |
| DUR-02 | Write queue: serial, retry with backoff, refetch on give-up | ✅ | `writequeue`, `syncstatus` |
| DUR-05 | Legacy account # backfill writes only {accountNo} via the queue, retries, never loops after give-up | ✅ | `accountno-backfill` |
| DUR-03 | Offline / load failure still renders | ✅ | `offline` |
| DUR-04 | Errors are captured and reported to error_log | ✅ | `capture`, `reporterror`, `errorpanel`, `rls/errorlog` |

### 9. Notifications
| ID | Case | Status | Where |
|---|---|---|---|
| NTF-01 | Bell derives alerts from state | ✅ | `bell` |
| NTF-02 | Email alerts: routing, escaping, scheduling | ✅ | `rls/emailalerts` |
| NTF-03 | Real email delivery via Brevo, bounce handling | ❌ MANUAL | send a test digest; bounce test still pending |

### 10. Accessibility & UX
| ID | Case | Status | Where |
|---|---|---|---|
| UX-01 | Icon buttons named, keyboard nav, Ctrl+K palette | ✅ | `a11y`, `tier3-polish` |
| UX-02 | Confirm dialogs, undo, toasts | ✅ | `confirm-dialog`, `undo-actions`, `toast` |
| UX-03 | Cross-browser (Safari/Firefox) | ❌ MANUAL | suite runs Chromium/Edge only |
| UX-04 | Dark mode: Light/Dark/Auto (device default, per-device), no flash, live device + cross-tab follow, blocked storage, print = light | ✅ | `dark-mode`, `unit/theme` |
| UX-05 | Dark contrast: every text/background pair the app uses ≥ 4.5:1 | ✅ | `dark-mode` |
| UX-06 | Light mode pixel-identical after the token change | ✅ (one-off) | `tests/visual/light-diff.mjs` |

## Manual release checklist (the ❌ rows)

1. AUTH-04 — request a reset for a test user; the link lands on the set-new-password screen; new password works.
2. CSV-08 — connect Drive, drop a CSV in the folder, confirm import and log line.
3. NTF-03 — trigger a digest to a real inbox; check rendering in Gmail and Outlook.
4. UX-03 — smoke the dashboard, an account page and an import in Safari and Firefox.

## Appendix: every automated case

Generated from `tests/**/*.test.mjs`. Regenerate it when you add tests.

### tests/unit

- **analytics.test.mjs** — golden cases (see golden.json)
- **csv.test.mjs** — golden cases (see golden.json)
- **arr-bridge.test.mjs**
  - bridge components and identity
  - bridge NRR/GRR equal the dashboard tiles exactly
  - empty book
- **csv-injection.test.mjs**
  - csvCell neutralises formula-leading text
  - csvCell leaves numbers (incl. negatives) and plain text untouched
  - export then re-import round-trips a formula-looking name exactly
- **csv-number.test.mjs**
  - parseCsvNumber reads plain, grouped and currency-marked numbers
  - parseCsvNumber: blank is '' (leave alone), garbage is null (report)
  - importSummary reports unreadable numbers
- **dates.test.mjs** — golden cases (see golden.json)
- **imports.test.mjs**
  - src/lib/${f} imports in plain Node
- **money.test.mjs** — golden cases (see golden.json)
- **money-format.test.mjs**
  - negative amounts take a leading sign and the same abbreviation as positives
  - amounts that round to 1000K are shown as millions
  - rounding to zero never shows a negative zero
- **qbr.test.mjs** — golden cases (see golden.json)
- **retention.test.mjs** — golden cases (see golden.json)
- **retention-cohort.test.mjs**
  - a new logo does not move NRR or GRR
  - a new logo's own churn and expansion stay in the displayed totals
  - an account with no startDate stays in the cohort
- **scoring.test.mjs** — golden cases (see golden.json)
- **urls.test.mjs**
  - safeUrl keeps http(s) links unchanged
  - safeUrl blocks script-capable and non-web schemes
  - safeUrl rejects non-strings and relative junk

### tests/health

- **a11y.test.mjs**
  - nav items expose labels and mark the current view
  - sortable account columns expose aria-sort
  - aria-sort follows the active column and direction
  - the command palette is a labelled modal dialog
  - every icon-only button carries an accessible name
  - every bulk dialog kind moves focus into the dialog on open
  - Tab is trapped inside the bulk dialog
  - every select in the account list has an accessible name
  - the account list result count is announced
  - the bulk selection count is announced
  - the import result region exists before an import runs
- **account-retention.test.mjs**
  - lastCompletedDecember returns the prior 31 December for a mid-year date
  - lastCompletedDecember in January still points at the December just gone
  - lastCompletedDecember on 31 December treats that December as complete
  - arrAsOf on an account with no history returns today's ARR
  - arrAsOf undoes an ARR event dated after the baseline
  - arrAsOf ignores an ARR event dated before the baseline
  - arrAsOf undoes a renewal completed after the baseline
  - arrAsOf SKIPS a redenomination — a currency restatement is not revenue movement
  - arrAsOf on an account churned after the baseline returns its pre-churn ARR
  - arrAsOf returns zero for an account already churned at the baseline
  - accountRetention reports growth against the prior-year close
  - accountRetention reports contraction with GRR below 100%
  - accountRetention marks an account started after the baseline as new, with null metrics
  - accountRetention gives a churned account 0% GRR
  - accountRetention shows no movement for a non-USD account whose local ARR never changed
  - accountRetention agrees with retentionStats for a single account
  - accountRetention does not throw on an account with no fields set
- **am-book.test.mjs**
  - cohorts split on the prior-year close, not on today
  - a future transition date is a scheduled handover, not part of the AM book
  - a churned account is never listed as a scheduled handover
  - opening plus expansion minus reduction equals the current balance
  - expansion and reduction are reported separately, not netted
  - an account churned during the year books its whole opening ARR as reduction
  - an account churned before the year contributes nothing at all
  - a redenomination is not counted as expansion or reduction
  - scheduled handovers report ARR but no year movement
  - a foreign-currency account is measured in USD
  - the dashboard card shows the three section totals and expands to accounts
  - the card sits above Recently declined
  - a scheduled handover shows an ARR figure only under Today, never under 1 Jan
  - an account that moved to AM this year counts as owned-before once the year turns
  - a handover still in the future this year is AM-owned once that year has passed
  - the card labels name the current year rather than a hardcoded one
- **arr-audit.test.mjs**
  - ADJUST_ARR books an increase as expansion
  - ADJUST_ARR books a decrease as contraction with a negative delta
  - ADJUST_ARR writes an audit entry recording the ARR move
  - an ARR change sourced from an opportunity is audited as such
  - successive adjustments append rather than replace
  - editing ARR through EDIT_ACCOUNT derives an arrEvent with the right kind
  - submitting the adjust form without changing ARR writes nothing
  - a CSV-sourced ARR edit is tagged import, not edit
- **backfill.test.mjs**
  - backfillCandidates selects non-churned Yellow/Red only
  - backfill card reports the never-seeded / already-seeded split
  - backfill requires confirmation and Cancel writes nothing
  - backfill card disables the button when nothing is at risk
  - backfill seeds tasks for every at-risk account and skips the rest
  - backfill writes one synthetic event per candidate, tagged backfill
  - auto-seeder adds nothing after a backfill, and a same-day re-run is idempotent
  - a same-day re-run does not duplicate backfill events
  - backfill does not fabricate a duplicate event when the auto-seeder already logged a real decline today
  - backfilled accounts appear in the dashboard Recently-declined card
- **bell.test.mjs**
  - bell shows recent health-decline item
  - contract expired inside the grace window still alerts; long-expired one does not
  - reading an alert hides the row until 'Show read' is toggled
- **boundary.test.mjs**
  - a crash confined to one view leaves the rest of the app usable
  - navigating away from a crashed view clears the error
  - data that breaks the app shell shows a panel, not a blank page
  - a healthy book renders no error panel
- **bulk.test.mjs**
  - BULK_PATCH_ACCOUNTS reassigns CSM and writes one audit entry each
  - BULK_PATCH_ACCOUNTS writes no audit entry when the value is unchanged
  - BULK_PATCH_ACCOUNTS ignores ids that do not exist
  - BULK_ADD_TASKS appends one task per account
  - BULK_CHURN churns every account with a shared reason and an audit entry
  - BULK_DELETE removes accounts and cascades to all four collections
  - RESTORE_SNAPSHOT undoes a bulk delete including cascades and sub parentId
  - RESTORE_SNAPSHOT undoes a bulk churn back to Active
  - select-all covers only the filtered rows
  - selecting a parent does not select its sub-accounts
  - changing a filter clears the selection
  - bulk churn requires a reason before it will submit
  - bulk reassign shows an undo toast that restores the prior CSM
  - Escape closes the bulk dialog without closing the account view
  - a selected account that disappears from data is excluded from a subsequent bulk action
  - an account deleted while the bulk dialog is open is excluded at dispatch time
  - applying a bulk action after every selected account vanished warns instead of closing silently
  - BULK_CHURN writes a churn activity per account, matching single churn
  - BULK_CHURN drops activities for accounts that no longer exist
  - undoing a bulk churn removes the churn activities it created
  - deleting a single account offers an undo that restores it with its children
  - bulk Reassign CSM excludes a disabled teammate, but the account list still shows them as the current CSM
- **capture.test.mjs**
  - a permanently failing write reports write_failed
  - a transient failure that later succeeds reports retry
  - an uncaught error is reported as a crash
  - an unhandled promise rejection is reported as a crash
  - no report carries row data in its context
- **churn-analysis.test.mjs**
  - churnRows groups by reason and sorts by ARR lost
  - churnRows groups by CSM and by tier
  - churnRows falls back to Other and Unassigned for missing fields
  - the Quarterly dim returns exactly eight chronological zero-filled quarters
  - the Quarterly window rolls back across a year boundary
  - a churn keeps its own currency, not the account's current one
  - churnRows on a book with no churn returns nothing
- **client-console.test.mjs**
  - a user of a disabled client sees the suspended screen, not the app
  - a user of an enabled client gets the app (control for the suspended test)
  - a platform admin lands on the console, not the CRM; an org admin lands on the CRM
  - Settings no longer carries the platform card
  - Open on another org sets the flag, calls switch_org and reloads
  - Open on the current org enters the CRM without switch_org; ← Clients returns to the console
  - a reload inside a client stays inside it
  - Disable confirms, calls set_org_disabled and shows the badge; Enable clears it
  - disabling OneVio shows the extra warning
  - + New client reveals the create form and creates through create_org, then signs the admin up
  - New client with an existing org-less login reports it was added, not created
  - create_org's refusal is shown and no sign-up is attempted
  - a platform admin with no org of their own still lands on the console
  - an org-less ordinary user still gets the no-workspace screen (control)
  - a switch_org that throws clears the in-client flag and shows the error
  - a profile load that throws reports it instead of hanging silently
- **cohort.test.mjs**
  - cohortData groups recent accounts by start quarter and old ones by year
  - cohortData skips accounts with a missing or unparseable startDate
  - a never-churned account stays retained in every quarter column
  - an account that churns in its first quarter still counts as retained at Q0
  - logo retention and ARR retention diverge when a large account churns
  - a cohort's columns stop at its own age
  - monthsBetween and quarterKey agree on quarter boundaries
- **confirm-dialog.test.mjs**
  - the confirm dialog is a labelled modal and traps focus
  - the typed-confirmation button stays disabled until the word matches exactly
  - cancelling the confirm dialog writes nothing
  - Escape closes the confirm dialog
- **contacts.test.mjs**
  - a contact can be edited, and the edit survives a reload
  - an edit with a blank name is refused
  - deleting a contact asks first, then removes it from the store and the database
- **crossing.test.mjs**
  - first run: existing Red account seeds nothing, initializes band
  - worsening Green->Yellow seeds Yellow playbook + event
  - no duplicate seeding on stable band
  - recovery to Green clears pbBand; later decline re-seeds
  - worsening Yellow->Red escalation seeds Red playbook + event
  - pbBand suppression: crossing that doesn't exceed stored pbBand seeds nothing
- **csv.test.mjs**
  - parseCSV keeps a quoted comma inside one field
  - parseCSV unescapes a doubled quote
  - parseCSV treats CRLF the same as LF
  - parseCSV keeps a newline inside a quoted field
  - parseCSV drops blank and whitespace-only rows
  - parseCSV emits the final row when there is no trailing newline
  - import rejects a file with no data rows
  - import rejects a header without a name column
  - import skips rows with an empty name and counts them
  - import creates a new account and counts it as ok
  - import matches an existing accountNo and updates instead of duplicating
  - import matches an existing name case-insensitively
  - import dispatches UPDATE_INPUTS when health columns are present
  - import coerces a non-numeric arr to 0 rather than NaN
  - import counts an unrecognized tier and still falls back to Mid
  - import counts an unrecognized contractStatus
  - an empty tier cell is not counted as a coercion
  - a valid tier in different case is not counted as a coercion
  - the error paths still return the coercion counters
  - the import banner reports unrecognized tiers
  - a coercion tones the import banner amber, not success green
  - a clean import keeps the success green banner
- **csv-dates.test.mjs**
  - CSV dates: day-first, ISO, month-name and invalid cells parse as expected
  - CSV import reads an Excel DD-MM-YYYY file correctly and never resurrects a churned row
  - CSV import refuses a file that mixes DD-MM and MM-DD dates
  - billing CSV reads DD-MM-YYYY billing dates
  - folder card lists each CSV with its status, and Sync now imports only the new one
- **csv-import-safety.test.mjs**
  - blank arr/currency/tier/status/licenses/deployedLicenses cells leave the account unchanged
  - grouped and currency-marked arr is read correctly; garbage is reported, not zeroed
- **currency-history.test.mjs**
  - renewal deltas convert at the currency stamped on the entry
  - ARR event deltas convert at the currency stamped on the entry
  - entries without a stamped currency fall back to the account's current currency
  - quarterly renewed ARR converts at the stamped currency
  - COMPLETE_RENEWAL stamps the account currency onto the renewal entry
  - ADJUST_ARR stamps the account currency onto the ARR event
  - an explicit currency on the entry is not overwritten by the reducer
- **dashboard.test.mjs**
  - dashboard shows Recently declined card with account
- **dashboard-polish.test.mjs**
  - dashboard money and retention stats render at hero size with tabular numerals
  - overflowing dashboard list shows a +N more cue that clears at the bottom
  - a list that fits shows no overflow cue
- **dates.test.mjs**
  - addMonths clamps month-end dates instead of overflowing
- **diffrow.test.mjs**
  - diffRow reports only the scalar fields that changed
  - diffRow returns an empty diff when nothing changed
  - diffRow sends a changed nested object whole, not field by field
  - diffRow classifies a trailing addition as an append
  - diffRow appends multiple trailing items in order
  - diffRow falls back to a whole-array set when an item was REMOVED
  - diffRow falls back to a whole-array set when items were REORDERED
  - diffRow falls back to a whole-array set when an EXISTING item was edited
  - diffRow handles an array that did not exist before
  - diffRow treats an absent prev row as a whole write
  - diffRow reports a field cleared to undefined as an explicit null
- **drive-permission.test.mjs**
  - drive sync: auto-scan after reload never asks for permission, and flags the folder instead
  - drive sync: one click on Grant access re-grants and syncs the folder
- **errorpanel.test.mjs**
  - an admin sees the error panel with counts
  - the panel lists the most recent error first
  - a plain user has no Settings view, so no error panel
  - an empty log shows a neutral message, not an error state
- **health-mix.test.mjs**
  - windowScore: full, midpoint, zero, never, future, and a zero<=full step
  - inert defaults reproduce today's score for every sample-data account
  - recency blend uses each type's own window; unknown types are ignored
  - enabled mix with every sub-weight 0 falls back to today's rule
  - value blends the Yes/No answers; zero sub-weights and malformed input read as 0
  - an old settings row loads with the defaults and per-type deep merge
  - SET_RECENCY_MIX and SET_VALUE_MIX update settings
  - fetchAll merges an old-shape settings row and scores are unchanged
- **health-mix-csv.test.mjs**
  - export writes the three Value columns as yes/no
  - a CSV setting one Value column leaves the other two unchanged
  - blank leaves a value alone; an unreadable value is counted for the banner
  - re-importing our own export adds no history point and keeps inputsUpdatedAt
  - a CSV that changes one answer updates it and logs exactly one history point
  - a new account from a CSV with one Value column stores all three booleans
- **health-mix-ui.test.mjs**
  - Update health saves the Value answers and logs a history point
  - the account page shows a Value bar, and per-type recency only when the mix is on
  - bandImpact counts accounts that would drop a band
  - Settings: sub-option panels edit and persist; day boxes clamp; preview shows
  - day-window inputs never store a transient or invalid window
- **health-snapshot.test.mjs**
  - the app records one health snapshot per account, once per session
  - editing an account does not re-send the baseline
  - adding an account does not re-send the baseline
  - the baseline waits for 
  - a failed baseline write retries instead of being permanently skipped
- **licenses.test.mjs**
  - edit form saves total and deployed licenses
  - empty Deployed stays not recorded when only the name changes
  - over-deployed shows a warning and still saves
  - detail header shows deployed-of-total, total only, or nothing
  - CSV import sets total and deployed licenses
  - CSV headers 'Total licenses' and 'Deployed licenses' are recognised
  - CSV empty deployed cell leaves the value unchanged
  - CSV unreadable deployed value is left unchanged and reported
  - dashboard card totals only active accounts with both figures
  - dashboard card lowest list orders, flags amber below 50, and opens the account
  - dashboard card shows over-deployment as 130% with a full bar
  - dashboard card empty states
  - dashboard card follows the My book scope
- **helpers.test.mjs**
  - isoPlus adds days textually
  - BAND_RANK orders bands
  - healthPlaybookOf falls back to default with Yellow+Red lists
- **link-safety.test.mjs**
  - document and attachment links never render a javascript: href
- **mobile.test.mjs**
  - desktop (1280px): fixed sidebar, no menu button, 3-column stat row -- unchanged layout
  - phone (375px): sidebar is an off-screen drawer, 2-column stats, no sideways scroll
  - phone: menu opens the drawer, choosing a view closes it, backdrop also closes it
  - phone: notification panel fits inside the screen
- **offline.test.mjs**
  - dist makes zero non-file requests
  - dist ships no CDN references and no in-browser compiler
- **orgs.test.mjs**
  - a signed-in user with no org sees the no-workspace screen, not the app
  - a platform admin sees the current org name in the sidebar; a normal user does not
  - adding a user invites them before signing them up
  - an address with an existing org-less login is attached, and no sign-up is attempted
- **page-polish.test.mjs**
  - dashboard analytics start collapsed but stay mounted, and open on demand
  - the task reschedule menu says what it does
  - account list filters carry their own labels
  - the renewals board shows a cue while months sit past the right edge
  - secondary account actions live in a More menu that Escape closes
  - destructive data actions sit in a separate danger zone
  - account detail header is a breadcrumb back to the list
- **persistence.test.mjs**
  - SMOKE: a bulk delete persists, and Undo restores every collection across a reload
  - SMOKE: a bulk churn and its undo both survive a reload
  - SMOKE: saved segments persist across a reload
  - SMOKE: pre-existing single-account flows still work and persist
  - SMOKE: undoing a single-account delete survives a reload
  - an account edit writes only the changed field, not the whole blob
  - the audit entry the reducer appends travels as an append, not a whole array
- **pill.test.mjs**
  - pill shows done/total for the latest episode
  - pill turns amber when an open step is past due (behind pace)
  - pill turns emerald when all steps done
  - no pill when the account has no health tasks
  - header meta panel renders labeled facts
- **redenomination.test.mjs**
  - changing currency and ARR together books a redenomination, not a contraction
  - changing only the currency still records a redenomination
  - the redenomination entry records both currencies and both amounts
  - an ARR change without a currency change is unaffected
  - a redenomination moves neither expansion nor contraction in retentionStats
  - the currency field change is written to the audit trail
  - the redenomination renders in the ARR timeline rather than as a blank row
- **reducer.test.mjs**
  - SEED_HEALTH_PLAYBOOK records event, band, and tasks
  - SEED_HEALTH_PLAYBOOK with empty items still records transition
- **arr-bridge.test.mjs**
  - ARR bridge shows new customers as new business and adds up to today's ARR
  - phone: ARR bridge fits the screen
- **reducer-actions.test.mjs**
  - reducer: contacts add, edit, delete
  - reducer: activities add/edit/bulk-delete, and a QBR schedules the next one
  - reducer: tasks edit/toggle/bulk-delete and playbook seeding
  - reducer: documents add/edit/delete each leave an audit entry
  - reducer: churn then reactivate, opportunities, and settings actions persist
  - reducer: deleting a parent orphans its sub-account and writes the cleared parentId
- **renewal-outcomes.test.mjs**
  - renewalOutcomeRows returns five quarters, oldest first, current flagged last
  - a renewal lands in the quarter it completed in, not the term it covers
  - churn and slippage are counted in the quarter they fall in
  - a renewal completed on time clears the slipped flag
  - win rate is renewed over renewed-plus-churned, and null for an empty quarter
  - forecast comes from the snapshot for the quarter's first month
  - a snapshot without commit90 is ignored
  - the quarter window rolls back across a year boundary
  - a foreign-currency renewal converts at the configured rate
- **renewal-write.test.mjs**
  - COMPLETE_RENEWAL moves the date, updates ARR and records the renewal
  - COMPLETE_RENEWAL resets billing and the renewal stage for the new term
  - COMPLETE_RENEWAL stores the renewal entry verbatim, losing no fields
  - COMPLETE_RENEWAL writes audit entries only for fields that changed
  - a flat renewal writes no ARR audit entry
  - the renewal form's date field is prefilled one year out, not 365 days out
  - addMonths keeps the calendar day when the year it spans contains a leap day
  - COMPLETE_RENEWAL writes no arrEvent, so retention counts the renewal once
- **reporterror.test.mjs**
  - reportError sends one log_error with the level and message
  - reportError NEVER throws, even when the RPC rejects
  - a rejected report surfaces nothing to the user
  - identical errors are throttled into one call
  - different errors are NOT throttled together
  - the fingerprint is stable for the same error and differs across errors
  - reportError does NOT enqueue onto the write queue
  - a rejected report produces no unhandled rejection
- **retention.test.mjs**
  - retentionStats computes NRR and GRR from churn, renewals and ARR events
  - retentionStats ignores events older than twelve months
  - retentionStats returns null ratios for an empty book rather than NaN
  - a completed renewal is counted once, from renewals and not also from arrEvents
  - an account in an unrecognized currency contributes zero revenue, silently
  - a foreign-currency churn converts at the configured rate
- **retention-ui.test.mjs**
  - the accounts list shows NRR, GRR and a movement badge per account
  - an account started after the baseline shows a new badge, not a percentage
  - the NRR column sorts the book
  - the movement column header names the baseline
  - the account detail view shows the full retention arithmetic
  - a new account's detail view explains why there is no comparison
- **second-pass.test.mjs**
  - dashboard: trends shrink to a note without data, and overdue shows on Tasks due 7d
  - tasks: one source mark with a name, a legend, and an overdue chip
  - accounts: flat movement is a muted dash and billing is a pill
  - renewals: playbook progress is labelled and an empty outcomes table collapses to a line
  - account detail: one header card, health input bars, bordered contact buttons
  - settings: a section index, no scope toggle, and readable playbook names
- **segments.test.mjs**
  - settings.segments defaults to an empty array when absent
  - SET_SEGMENTS persists a segment carrying all ten filter fields
  - applying a segment sets every filter field
  - a partial filter from a dashboard card preserves the typed search
  - a dashboard card still clears the filters it cleared before segments existed
  - saving a view stores the current filters as a segment
  - cancelling the save-view prompt stores nothing
  - deleting the active segment removes it and clears the selection
  - the segment dropdown shows segment names, not raw ids
  - a non-admin cannot save or delete segments, but can still apply them
  - an admin still sees the segment controls
- **settings.test.mjs**
  - Settings shows Health playbook editor with Yellow & Red sections
  - Users card shows each user's email and a disable control
  - a disabled user is marked as such and offers re-enable
  - a disabled user is ejected instead of seeing the app
- **signout.test.mjs**
  - a sign-out the server rejects still clears the stored session and reloads
  - a normal sign-out does not force a reload
- **smoke.test.mjs**
  - app renders with seeded account
- **syncstatus.test.mjs**
  - the header shows a saving indicator that settles to saved
  - the error status PERSISTS on screen rather than scrolling away like a toast
  - a teammate's realtime change does NOT refetch while writes are still queued
- **tab-icon.test.mjs**
  - tab: title is OneVio CRM and the OV icon decodes as an image
- **tasks.test.mjs**
  - bucketTasks splits on the day boundaries
  - bucketTasks puts Done tasks in done regardless of due date
  - bucketTasks sorts by due date then priority
  - filterTasks scope keeps only the user's tasks when mine
  - filterTasks source splits health, renewal and manual
  - filterTasks band matches the task's account risk
  - filterTasks q matches task title and account name
  - Tasks view groups tasks into due-date sections with counts
  - Tasks view shows a distinct empty state when filters match nothing
  - ticking a task completes it and moves it to Done
  - rescheduling an overdue task moves it out of Overdue
  - the source filter hides health-playbook tasks when set to renewal
  - a task referencing a deleted account still renders, with a dash for the account
  - Tasks view shows the no-tasks-at-all empty state when the seed has zero tasks
- **tier3-polish.test.mjs**
  - the bell is an SVG icon named with its unread count
  - a slow first load shows a skeleton, never the empty-book copy, then the data
  - a failed first load still renders the views rather than a skeleton forever
  - renewal days render as chips banded by urgency
  - an overdue renewal reads as overdue in the account list
  - icon-only buttons on the dashboard and account page have accessible names
- **toast.test.mjs**
  - error toasts persist and info toasts auto-dismiss
  - undo toast exposes an Undo button that fires the callback
  - error toast is announced assertively
- **touchpoint-activity.test.mjs**
  - an ingested email activity renders on the account timeline
- **transition-date.test.mjs**
  - the account detail header shows the sales-to-AM transition date when set
  - an account with no transition date says so rather than rendering an invalid date
  - the edit form saves a transition date onto the account
  - clearing the transition date in the form stores null, not an empty string
  - CSV import backfills a transition date onto an existing account
  - CSV import ignores an unparseable transition date rather than storing garbage
  - CSV export includes the transition date column
- **undo-actions.test.mjs**
  - reactivating an account acts immediately and offers an Undo
  - undoing a reactivation puts the account back to churned
  - deleting an account no longer asks for confirmation and still restores on Undo
- **virtualization.test.mjs**
  - windowing keeps the DOM row count bounded at 2000 accounts, at any scroll offset
  - scrolling reveals the correct rows in the correct order
  - sub-accounts still render directly under their parent when windowed
  - select-all selects every filtered row, not just the visible slice
  - select-all covers the whole FILTERED set, not the whole book
  - sorting is correct with windowing on
  - search filtering is correct with windowing on
  - at 100 rows or fewer windowing is off and every row renders
  - windowing engages just above the 100-row threshold
  - row height is re-measured after a viewport resize
  - the account name cell stays on one line so rows keep a uniform height
  - sorting 2000 accounts is far faster than the pre-windowing baseline
  - the sticky header and aria-sort survive windowing
- **writequeue.test.mjs**
  - a transient failure is retried and then succeeds
  - a permanent failure ends in the error status and rolls back by refetching
  - two edits to the same row are sent in order, never concurrently
  - the status is 'saving' while work is pending and 'saved' once it drains
  - a delete queued behind a slow merge is not resurrected as a partial ghost

### tests/rls

- **auth.test.mjs**
  - a sign-up matching an admin invite lands in that org as admin
  - a sign-up matching a user invite lands in that org as user
  - a sign-up with no invite gets no org and reads nothing
  - re-running the setup file leaves an uninvited sign-up org-less
  - invite email matching is case-insensitive
  - profile name falls back to the email prefix when sign-up sends no name
  - a profile is auto-created and named from signup metadata
  - an org admin cannot make themselves a platform admin
  - demoting the last admin is refused
  - one of two admins can be demoted
  - disabling the last admin is refused
  - an admin cannot disable themselves even when another admin exists
  - one of two admins can be disabled by the other
  - admin_user_list returns every user with their email
  - a non-admin cannot call admin_user_list
  - an admin can change a user's email, and a non-admin cannot
  - admin_set_user_email rejects a duplicate address
  - admin_set_user_email rejects a malformed address
  - after an email change the new address signs in and the old one does not
- **emailalerts.test.mjs**
  - record_health writes one row per account
  - record_health upserts rather than duplicating within a day
  - record_health drops an unknown accountId and keeps the valid one
  - record_health still exists for the owner but is closed to an anonymous client
  - a signed-in plain user can still record health
  - email_log is admin-readable and closed to plain users
  - email_log refuses a second send of the same kind to the same person today
  - alert_recipients resolves each profile to an email address
  - unrouted_csms reports a csm value that matches no profile
  - unrouted_csms reports unmatched csms and ignores matched ones
  - alert_renewals returns only this CSM's accounts renewing within 30 days
  - alert_renewals excludes churned accounts
  - alert_renewals adds unowned accounts only when asked
  - alert_renewals tolerates a garbage (non-blank) renewalDate instead of raising
  - alert_overdue_tasks routes through the account's CSM and skips Done
  - alert_overdue_tasks does not leak another CSM's tasks
  - alert_overdue_tasks tolerates a garbage (non-blank) due date instead of raising
  - alert_qbr_nudge lists QBRs due within 14 days or already past
  - alert_qbr_nudge flags a past QBR with no QBR activity logged near it
  - alert_qbr_nudge does NOT flag a past QBR that was logged within 14 days of it
  - alert_qbr_nudge ignores accounts with qbrFrequency None
  - alert_qbr_nudge tolerates a garbage (non-blank) nextQbrDate instead of raising
  - alert_overdue_tasks adds unowned accounts' tasks only when asked
  - alert_qbr_nudge adds unowned accounts only when asked
  - alert_qbr_nudge tolerates a blank activity date instead of raising
  - send_alerts mails each CSM their own book and logs the send
  - send_alerts sends nothing when a book has no rows
  - send_alerts will not double-send the same kind to the same person today
  - send_alerts escapes HTML in account names and task titles
  - send_alerts excludes an invalid-but-regex-shaped date instead of breaking every recipient's digest
  - send_alerts refuses to run when the API key is still the placeholder
  - send_alerts refuses to run when the sender is still the placeholder
  - send_alerts skips a kind an org has disabled in org_alert_prefs
  - alert builders see only the org they are asked about
  - overdue-task and QBR builders see only the org they are asked about
  - alert_recipients is per org
  - unrouted_csms is per org: accounts and profile names both come from that org only
  - send_alerts logs one row per recipient per org and honours per-org enabled_kinds
  - each org's digest carries only that org's accounts and unrouted list
  - create_org gives the new org prefs; send_alerts skips orgs with no recipients or no prefs
  - an org B admin cannot read org A's email_log rows
  - org_alert_prefs is readable only in-org and writable only by that org's admin
  - settle_alert_sends marks a 201 response as sent
  - settle_alert_sends marks a 401 response as failed and records the body
  - settle_alert_sends gives up on a send that never got a response
  - settle_alert_sends gives up on a stale row with no request_id at all
  - settle_alert_sends leaves a recent unanswered send alone
  - settle_alert_sends routes a failed send into error_log for an admin to see
  - settle_alert_sends counts a failure once across repeat sweeps, not once per sweep
  - settle_alert_sends does not double-count a failure across back-to-back sweeps at cron cadence
  - settle_alert_sends self-corrects an 'unknown' row once a late response arrives
  - log_error_system collapses repeat calls into one row via fingerprint
  - log_error_system sweeps rows past 30 days but keeps rows inside the horizon
  - record_health sweeps snapshots past 90 days but keeps snapshots inside the horizon
  - ${fn}() still exists for the owner but is closed to an anonymous client
  - ${fn}() still exists for the owner but is closed to a signed-in plain user
  - a refused log_error_system() call writes no error_log row
- **errorlog.test.mjs**
  - a plain user can report an error
  - a plain user cannot READ the error log
  - an admin can read the error log
  - an anonymous client can neither report nor read
  - reporting the same fingerprint twice yields ONE row with count 2
  - N concurrent reports of one fingerprint all count
  - log_error stamps user_id from auth.uid(), ignoring the client
  - a plain user cannot update or delete a row to erase their own errors
  - an org B admin cannot read an org A error row
  - the same fingerprint logged from both orgs gives two rows
  - a null-org system row is invisible to an org admin and visible to the platform admin
- **merge.test.mjs**
  - two clients patching DIFFERENT fields of one account both survive
  - two clients appending an arrEvent both land, neither duplicated
  - a REPLAYED append does not duplicate the entry
  - arrEvents dedupes by id even when the entry contents differ
  - history dedupes by whole-element equality
  - merge_row inserts the row when it does not exist yet
  - merge_row does NOT let a plain user write settings
  - merge_row cannot be pointed at an arbitrary table
  - merge_row rejects a table name crafted for SQL injection
  - N concurrent appends to one row all survive
- **migration.test.mjs**
  - migration: pre-multitenant data lands in the default org intact
- **orgdisable.test.mjs**
  - a disabled org's user reads and writes nothing; other orgs are untouched; re-enable restores
  - a disabled org's ADMIN cannot write settings, update profiles, invite or list users
  - the platform admin keeps access inside a disabled org, including a disabled home org
  - set_org_disabled works for the platform admin only, and a locked-out user can read the flag
  - the email dispatcher's org list skips a disabled org
- **orgs.test.mjs**
  - a user reads only their own org's rows on every entity table
  - settings are per org
  - an insert naming another org is rejected
  - a client upsert({id, data}) lands in the caller's org against the composite key
  - merge_row stamps the caller's org and never touches another org's row
  - merge_row into settings writes only the caller's org row
  - replace_all deletes only the caller's org
  - record_health stamps the org and only accepts the caller's accounts
  - health_snapshots are visible only within the org
  - invites are visible only to the org's own admin
  - an org admin can insert an invite into their own org, not another
  - a user cannot change their own org_id or platform flag
  - an org admin cannot move a user to another org
  - admin_user_list never returns another org's users
  - admin_set_user_email refuses a user in another org
  - profiles are visible only within the org
  - demoting an org's last admin fails even though other orgs have admins
  - orgs: a member sees only their own org; the platform admin sees all
  - invite_user: an org admin invites into their own org only
  - invite_user: a plain user cannot invite
  - invite_user: an org B admin's invite lands in org B, never org A
  - invite_user: anonymous callers are refused
  - invite_user: rejects a bad role and a malformed address
  - invite_user: re-inviting the same email replaces the role and re-opens the invite
  - create_org: platform admin creates an org with settings and an admin invite
  - create_org: an org admin, a plain user and anon cannot create orgs
  - create_org: rejects a malformed admin address
  - switch_org: platform admin moves into org B and sees its rows; others cannot
  - switch_org: refuses an unknown org
  - replace_all after switch_org touches only the new org's rows
  - list_orgs: platform admin gets every org with a user count; others are refused
  - invite_user: another org's admin cannot take over an address with an open invite
  - invites_insert: an org B admin cannot insert a second open invite for a held address
  - create_org: a retry with the same name errors and makes one org; the owner signs up into it
  - invite_user: an existing org-less login is attached to the caller's org and reads its data
  - invite_user: a login already in another org is refused and leaves no invite
  - invite_user: a brand-new address still gets an open invite and returns 'invited'
  - guard_profile_org: a client still cannot set its own org_id, even an org-less one
  - create_org: an existing org-less login becomes the new org's admin
  - create_org: an admin address whose login is in another workspace is refused and creates nothing
  - C1: an org B admin cannot change the email of a platform admin switched into org B
  - C1: an org B admin cannot disable or re-role a platform admin switched into org B
  - C1: admin_user_list hides a switched-in platform admin from org B's admin
  - C1: invite_user cannot attach an org-less platform-admin login
  - C1: invite_user cannot attach a disabled org-less login
  - C1: create_org cannot make a platform-admin or disabled login the new org's admin
  - C1 control: a platform admin still updates its own row, and switch_org still works
- **policies.test.mjs**
  - a plain user cannot delete an account
  - an admin can delete an account
  - a plain user cannot write settings
  - an admin can write settings
  - a plain user cannot change another user's role
  - a plain user cannot escalate their own role
  - any authenticated user can read every business table
  - any authenticated user can insert and update business rows
  - a plain user CAN delete child rows (documents finding F1)
  - every authenticated user can read every profile (documents finding F4)
  - an anonymous client can read nothing
  - an anonymous client cannot insert
  - an anonymous client cannot update or delete
  - a disabled user reads nothing from the business tables
  - a disabled user cannot insert
  - a disabled user can still read their OWN profile, and no other
  - a disabled admin loses admin powers
  - re-enabling a user restores access
  - a disabled user cannot read settings
  - a disabled user cannot read health_snapshots
  - record_health is refused for a disabled user
- **replace.test.mjs**
  - replace_all swaps the whole dataset for an admin
  - A FAILING replace_all leaves every original row in place
  - a plain user cannot replace_all
- **storage.test.mjs**
  - an authenticated user can upload to attachments
  - an authenticated user can list attachments
  - any authenticated user CAN delete another same-org user's attachment (documents finding F2)
  - an anonymous client cannot upload
  - an anonymous client cannot delete
  - anyone with the URL can read an attachment (documents finding F5)
  - a user cannot upload under another org's prefix
  - a user cannot list or delete another org's files
  - an upload outside the org prefix is refused
  - a legacy un-prefixed object is visible and deletable by the default org only
- **touchpoints.test.mjs**
  - tp_addr reduces display-name and case variants to the bare address
  - tp_generic flags the blocklist and nothing else
  - tp_body_addrs finds addresses but not bare domains or trailing punctuation
  - tp_strip_quotes cuts at reply markers and keeps forwarded content
  - tp_match finds the account by contact domain, scoped to the org
  - tp_match ignores generic domains, excluded domains and churned accounts
  - tp_match narrows a shared domain by exact address, else reports both
  - tp_match tolerates messy stored contact emails but not subdomains
  - a forwarded thread is logged on the matching account
  - body addresses are a fallback; a bare domain mention is not
  - a wrong or placeholder secret writes nothing
  - missing message_id or from is refused without a log row
  - unknown, disabled, org-less and disabled-org senders are rejected silently
  - an active CSM's From without a verified sender auth is rejected silently
  - a CSM cannot log onto another org's account
  - an ambiguous match bounces naming both accounts and logs nothing
  - the same message_id twice logs once and bounces once
  - auto-submitted mail is recorded but never bounced
  - an empty message is malformed and bounced
  - a failed bounce is recorded and the call still succeeds
  - a bad date falls back to today and long text is truncated
  - org admins read their own org's ingest_log, and no one else's
  - no API role can write ingest_log or touchpoint_config
  - only anon may call ingest_touchpoint, and nobody may call the helpers

### tests/worker

- **touchpoints.test.mjs**
  - toMessage maps a parsed email to the ingest shape
  - auth_ok is true for a Cloudflare-stamped DMARC/DKIM pass
  - auth_ok is false with no Authentication-Results header
  - a forged non-Cloudflare header claiming dmarc=pass is ignored
  - the first Cloudflare header is used even when a forged one sits above it
  - dkim=pass for an unrelated domain with dmarc=fail is not aligned
  - dkim=pass from a parent domain of the From subdomain is aligned
  - a message with no Message-ID gets a stable id derived from its bytes
  - an HTML-only email still yields text
  - email() posts to ingest_touchpoint with the secret and anon key
  - email() throws on a non-2xx so the sending server retries
  - email() rejects a 200 whose body is not ok, without leaking the secret
  - email() throws when settings are missing rather than posting to undefined

