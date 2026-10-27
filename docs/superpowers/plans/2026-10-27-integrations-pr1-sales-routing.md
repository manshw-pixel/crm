# Integrations PR 1: Sales Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sales-feed CSV row with `destination=onboarding` creates or updates the account and opens an implementation project (queued, or a handover draft if required checklist items are missing). Rows without it go to Accounts exactly as today.

**Architecture:** A pure ES module, `src/lib/sales-import.js`, decides each onboarding row's outcome (queued / draft / skip) from the row, its account, the existing projects and the checklist template. `importAccountsCSV` (`src/17-csv.jsx`) additionally reports which account id each data row landed on. The sales branch of the folder sync (`src/18-drive-sync.jsx`) feeds those ids into the module and dispatches `ADD_PROJECT`. Handover drafts get a collapsed board column and a fill-and-submit checklist in project detail.

**Tech Stack:** Browser JSX joined by `build.mjs` (globals, no imports in `src/NN-*.jsx`), pure logic in `src/lib/*.js` re-exported via `src/lib/index.js`, `node:test` unit tests, Playwright health tests (`tests/health`, run one with `node tests/health/run-one.mjs <file>`), live QA (`tests/qa/features`).

**Spec:** `docs/superpowers/specs/2026-10-27-integrations-design.md` (sections 1 and 4; finance and UI cards are PRs 2-3).

## Global Constraints

- Additive only. Files without a `destination` column behave exactly as today, and the same holds when the default is `accounts`.
- Keep IndexedDB keys `sales` / `finance`, the `settings.integrations.processed` map and `log` (cap stays `log.slice(-20)`).
- `destination` values: `onboarding` | `accounts`, case-insensitive, trimmed. Blank uses `settings.integrations.salesDefault` (default `"accounts"`). Any other value: the row's account is still imported, no project, and the log reason is `unknown destination "<v>"`.
- Checklist columns are named by checklist item **id** from `settings.implChecklist || DEFAULT_IMPL_CHECKLIST`.
- Check items are true for `yes|y|true|1|✓` (case-insensitive) and false otherwise. Date items use `parseCsvDate(v, order)` with the file's detected `csvDateOrder`.
- An open project means stage in `["queued","planning","in_progress","csm_review","on_hold","handover"]`. An account with one gets no new project; reason `open project exists`.
- No SQL change: `guard_project` allows insert at `handover` or `queued` (verified, `supabase-setup.sql:1644-1666`).
- Imported project history note: `Imported from sales feed (<file name>)`. `createdBy` = syncing user's name.
- Never commit `supabase-setup.sql` EDIT ME values; check with `git show HEAD | grep -c "EDIT ME"` (expect 0).

## Review Focus

1. Two onboarding rows for the same new account in one file: exactly one project (the in-file dedupe must count projects created earlier in the same run). Test in Task 1.
2. A re-synced edited file: no duplicate project. Already covered by the open-project rule; test in Task 3 (sync twice with a modified time).
3. A file whose `destination` column exists but is blank on every row, with default `accounts`: identical outcome to today, no projects. Test in Task 3.
4. A row the accounts import skipped (bad currency, churn-skipped, no name): no project, reason `account not imported`. Test in Task 1 (accountId null).
5. Saving integrations after a sync must not drop `salesDefault` (today `SET_INTEGRATIONS` replaces the object). Test in Task 4.

---

### Task 1: Pure onboarding-row planner

**Files:**
- Create: `src/lib/sales-import.js`
- Modify: `src/lib/index.js` (add `export * from "./sales-import.js";`)
- Test: `tests/unit/sales-import.test.mjs`

**Interfaces:**
- Consumes: `projectType`, `historyEntry`, `OPEN_STAGES` from `./implementation.js`; `parseCsvDate` from `./csv.js`.
- Produces:
  - `rowDestination(value: string|undefined, fallback: "onboarding"|"accounts") -> "onboarding"|"accounts"|{ unknown: string }`
  - `checklistFromRow(cells: Record<string,string>, template: Item[], order: "dmy"|"mdy") -> Record<string, boolean|string>` (only items whose column is present and non-blank)
  - `planOnboardingRow({ accountId, accountName, cells, template, order, projects, user, now, file, newId }) -> { kind: "queued"|"draft", project } | { kind: "skip", reason: string }`
    - `projects` = existing projects plus ones planned earlier in this run (the caller appends).
    - `project` shape is the same as HandoverForm's (`src/29-implementation.jsx:34-38`): `id: newId, accountId, type, stage, implementerId: null, createdBy: user.name, checklistTemplate (copy), checklist, targetGoLive, startedAt: null, liveAt: null, history, holdReason: ""`, plus `source: "sales-feed"`, and `missing: string[]` (labels) on drafts.
    - queued: `history = [historyEntry("handover","queued",user,"Imported from sales feed (<file>)",now)]`. draft: `stage "handover"`, `history = []`.
    - `targetGoLive`: value of `go_live_target` if present, else the first date item's value, else `null`.

- [ ] **Step 1: Write failing tests** in `tests/unit/sales-import.test.mjs`:
  - `rowDestination`: `"Onboarding "`→`"onboarding"`, `""`/`undefined`→fallback, `"crm"`→`{ unknown: "crm" }`.
  - `checklistFromRow`: with the default template, `{ order_form: "Yes", go_live_target: "15-11-2026", customer_contact: "Asha", kickoff: "no" }` and order `"dmy"` → `{ order_form: true, go_live_target: "2026-11-15", customer_contact: "Asha", kickoff: false }`. A blank cell is omitted.
  - `planOnboardingRow` with all four required items → `kind "queued"`, `project.stage "queued"`, `type "onboarding"`, `targetGoLive "2026-11-15"`, `history[0].note` includes the file name.
  - Missing `customer_contact` → `kind "draft"`, `stage "handover"`, `missing` equals `["Customer project contact"]`.
  - Account with an existing `in_progress` project → `{ kind: "skip", reason: "open project exists" }`. A `live` project → allowed, `type "expansion"`.
  - `accountId: null` → `{ kind: "skip", reason: "account not imported" }`.
  - Same run: call twice for one accountId, appending the first result's project to `projects` → the second call returns skip `open project exists`.
- [ ] **Step 2: Run** `node --test tests/unit/sales-import.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the three functions in `src/lib/sales-import.js`. Keep the required-item check identical to `checklistFilled` in `implementation.js:23` (export that helper from `implementation.js` and reuse it rather than duplicating it). Add the index export.
- [ ] **Step 4: Run** `node --test tests/unit/sales-import.test.mjs` then `npm run test:unit`. Expected: all PASS (the lib golden "every export has a case" check, if present, must pass too).
- [ ] **Step 5: Commit** `feat(integrations): pure onboarding-row planner for the sales feed`.

### Task 2: Accounts import reports where each row landed

**Files:**
- Modify: `src/17-csv.jsx:7-143` (`importAccountsCSV`)
- Test: `tests/health/csv.test.mjs` (add one test)

**Interfaces:**
- Produces: the `done(result)` object gains `rowAccounts: Array<{ row: number, id: string|null, name: string }>`, one per data row in file order (`row` is the 1-based data row index). `id` is the existing or newly created account id, or `null` when the row was skipped. Also `cells: Array<Record<string,string>>` (header→raw cell, lower-cased header keys) and `order` (the detected date order). Every existing field is unchanged.

- [ ] **Step 1: Write failing health test** `"accounts CSV import reports the account id of each row"`. Seed account `a1` "Alpha". Import a 3-row CSV via the harness's existing CSV-import helper in `csv.test.mjs`: Alpha (update), Beta (new), and a row with a bad currency. Read the result through the existing `window.__lastImport` hook if one exists, otherwise add `window.__lastImport = r` inside `done` (test-only, matching how other tests read import results). Assert `rowAccounts[0].id === "a1"`, `rowAccounts[1].id` equals the new Beta account's id in the store, `rowAccounts[2].id === null`, and `cells[1].name === "Beta"`.
- [ ] **Step 2: Run** `npm run build && node tests/health/run-one.mjs csv.test.mjs`. Expected: the new test FAILs.
- [ ] **Step 3: Implement.** Collect `rowAccounts` / `cells` while building `ops` (the existing match and new-item branches already know the id), and pass them plus `order` to the final `done`. Early-error `done` calls get `rowAccounts: []`.
- [ ] **Step 4: Run** the same command. Expected: all csv tests PASS.
- [ ] **Step 5: Commit** `feat(csv): accounts import reports the account each row landed on`.

### Task 3: Sales sync routes onboarding rows into projects

**Files:**
- Modify: `src/18-drive-sync.jsx:94-112` (sales branch of `sync`)
- Test: create `tests/health/sales-routing.test.mjs`

**Interfaces:**
- Consumes: Task 1 (`rowDestination`, `planOnboardingRow`), Task 2 (`rowAccounts`, `cells`, `order`).
- Produces: one log line per sales file: `importSummary(r)` + ` · projects queued N · drafts N · skipped N` (+ ` (<reason>: n, …)` when N>0). The suffix only appears when the file has a `destination` column or `salesDefault === "onboarding"`.

- [ ] **Step 1: Write failing health tests.** Drive the sync the way existing drive-sync tests do. If none exist, stub `window.showDirectoryPicker` / an IndexedDB handle with an in-memory directory exposing `entries()` and files with `name`, `lastModified`, `text()`. Cases:
  - `"onboarding row with full checklist queues a project"`: one row `name=Kestrel,destination=onboarding,order_form=yes,go_live_target=15-11-2026,customer_contact=Asha,modules_scope=Core`. Expect the store to have account Kestrel and one project `{ stage: "queued", type: "onboarding", source: "sales-feed" }`; the log line includes `projects queued 1`.
  - `"missing required item makes a handover draft"`: no `customer_contact` → project `stage "handover"`; the log includes `drafts 1`.
  - `"blank destination with default accounts changes nothing"`: a `destination` column, all blank → zero projects; the account is imported.
  - `"re-sync of an edited file does not duplicate"`: run case 1, bump `lastModified`, sync again → still exactly one project; the log includes `open project exists: 1`.
  - `"unknown destination imports the account only"`: `destination=crm` → zero projects; the log includes `unknown destination "crm"`.
- [ ] **Step 2: Run** `npm run build && node tests/health/run-one.mjs sales-routing.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** In the sales branch's `done` callback: if `r.err`, keep today's behaviour. Otherwise, for each `rowAccounts[i]`, compute `rowDestination(cells[i].destination, integ.salesDefault || "accounts")`. For `"onboarding"`, call `planOnboardingRow` with `template = st.settings.implChecklist || DEFAULT_IMPL_CHECKLIST`, `projects = [...(st.projects||[]), ...plannedSoFar]`, `newId = uid()` and `now = iso(Date.now())`, then dispatch `ADD_PROJECT` for queued/draft. Tally kinds and reasons for the log suffix.
- [ ] **Step 4: Run** the same command plus `node tests/health/run-one.mjs implementation-store.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): sales feed routes onboarding rows into implementation projects`.

### Task 4: Settings default destination and onboarding template

**Files:**
- Modify: `src/18-drive-sync.jsx` (card UI near `:146`, `sync` at `:112`)
- Modify: `src/lib/reducer.js` (the `SET_INTEGRATIONS` case: merge instead of replace)
- Test: `tests/health/sales-routing.test.mjs` (add), `tests/unit/reducer.test.mjs` (add)

**Interfaces:**
- Produces: `settings.integrations.salesDefault: "accounts"|"onboarding"`. Select `[data-sales-default]` with options "Accounts (straight to CSM)" / "Onboarding (implementation project)". Button `[data-onboarding-template]` labelled "Onboarding template" downloads `sales-onboarding.csv`: the header = the `accountsCSVText` header + `destination` + every checklist item id. No data rows except one example row whose `name` is `Example Co (delete this row)`, `destination` is `onboarding`, and checklist cells are blank.

- [ ] **Step 1: Write failing tests.**
  - Unit (reducer): `SET_INTEGRATIONS` with `{ processed, log }` on a state whose `integrations.salesDefault === "onboarding"` keeps `salesDefault`.
  - Health `"default destination onboarding routes rows without a destination column"`: choose Onboarding in `[data-sales-default]`, sync a file with no `destination` column and a full checklist → one queued project. Then sync again (new file) → `salesDefault` is still `"onboarding"` in the store.
  - Health `"onboarding template lists checklist ids"`: click `[data-onboarding-template]` with a download listener; the header contains `destination`, `go_live_target`, `customer_contact`.
- [ ] **Step 2: Run** `npm run test:unit` and `node tests/health/run-one.mjs sales-routing.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** The reducer does `integrations: { ...(state.settings.integrations||{}), ...action.integrations }`. Check the `persistOps` path in `reducer.js:115` region persists the merged object. The select dispatches `SET_INTEGRATIONS` with `{ salesDefault }`. Add a template button next to "Export sales CSV".
- [ ] **Step 4: Run** the same two commands. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): default sales destination and onboarding template`.

### Task 5: Handover drafts are visible and can be submitted

**Files:**
- Modify: `src/29-implementation.jsx` (`BOARD_COLLAPSED`, near `:80` / `:132`)
- Modify: `src/30-project-detail.jsx` (stage `handover` view)
- Test: `tests/health/impl-handover.test.mjs` (add)

**Interfaces:**
- Consumes: `canTransition(project, tasks, "queued", actor, account)` (`implementation.js:60`, already checks required items), `SET_PROJECT_STAGE`, `EDIT_PROJECT`.
- Produces: the board's collapsed group `data-board-column="handover"`, titled "Handover drafts". In project detail at `stage === "handover"`: `[data-draft-checklist]` renders `project.checklistTemplate` as inputs (same kinds as HandoverForm), saves via `EDIT_PROJECT { checklist, targetGoLive }`, and has `[data-submit-handover]` "Submit handover", which calls `move("queued", "Handover submitted")` and shows `canTransition`'s reason when refused. Who may submit: the same users who can create a handover (`canCreate` in `ProjectsCard`).

- [ ] **Step 1: Write failing health tests.**
  - `"handover drafts appear in a collapsed board group"`: seed one project at stage `handover` → `[data-board-column="handover"] [data-board-project]` count 1.
  - `"filling the missing item and submitting moves the draft to Queued"`: open the draft, the submit button shows the refusal text containing `Customer project contact`, fill it, submit → `[data-project-detail][data-stage="queued"]`, and the history's last entry is `handover→queued`.
  - `"an implementation user cannot submit a draft"`: as `impl_user`, no `[data-submit-handover]`.
- [ ] **Step 2: Run** `npm run build && node tests/health/run-one.mjs impl-handover.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Prepend `"handover"` to `BOARD_COLLAPSED` (label "Handover drafts" via the existing label lookup). Reuse HandoverForm's field rendering by extracting `ChecklistFields({ template, values, set })` from `src/29-implementation.jsx:44-52` and using it in both places.
- [ ] **Step 4: Run** the same command plus `node tests/health/run-one.mjs impl-roles.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(implementation): handover drafts board group and submit-from-detail`.

### Task 6: Live QA scenario and PR

**Files:**
- Modify: `tests/qa/features/11-implementation.mjs` (append scenarios), `tests/qa/README.md` if it lists scenarios
- Test: the scenarios themselves

**Interfaces:**
- Consumes: everything above; QA helpers `openAccount`, `nav`, `fixtureName`, `SkipScenario`.

- [ ] **Step 1: Add scenario** `${F}/sales-feed-onboarding` (role admin). The File System Access picker can't be driven live, so drive the same code path through a test hook. Expose `window.__syncSalesText(name, text)` from `IntegrationsCard`, only when `window.__qaHooks` is set by the QA runner (confirm the runner can set it before page scripts run, via `addInitScript`). Feed a one-row onboarding CSV for a run-unique account name `QA <runId> Sales Onboarding` with a full checklist. Assert the account exists and has exactly one queued project. Then re-feed the same text with a later timestamp and assert it still has one project. Retry-safe: if the project already exists, only assert the count.
- [ ] **Step 2: Run** `npm run test:qa-unit`. Expected: PASS (the scenario module loads and ids are unique).
- [ ] **Step 3: Full local checks:** `npm run test:unit`, plus run-one for `sales-routing`, `csv`, `impl-handover`, `impl-roles` and `implementation-store`. Expected: all PASS. (The full health suite OOMs on this machine; CI is the gate.)
- [ ] **Step 4: Commit, push branch `integrations-sales-routing`, open the PR.** The body lists the behaviour, "No SQL change", the tests, and the QA scenario. Check `git show HEAD | grep -c "EDIT ME"` is 0.
- [ ] **Step 5: After merge and deploy:** run `/qa-run 11-implementation` and confirm `sales-feed-onboarding` passes.
