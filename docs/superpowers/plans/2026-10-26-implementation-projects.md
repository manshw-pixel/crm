# Client Onboarding & Implementation Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Handover checklist → implementation queue → project plan of tasks → CSM sign-off → Live, with two new implementation roles, a workload view and a Dashboard projects chart.

**Architecture:** Two new jsonb tables (`projects`, `project_tasks`) in the same shape as the entity tables but kept OUT of `ENTITY_TABLES` (so backup/replace_all, snapshots and the lead child loops are untouched); they get their own list `IMPL_TABLES`. Pure logic (stage rules, workload, chart counts) lives in `src/lib/implementation.js` with golden unit tests; UI is a new `src/29-implementation.jsx` module plus small additive hooks in existing modules. Database rules are enforced by RLS + triggers in `supabase-setup.sql`.

**Tech Stack:** React (in-browser JSX modules joined by `build.mjs`), Supabase Postgres/RLS, node:test unit tests, Playwright health harness, live QA agent.

**Spec:** `docs/superpowers/specs/2026-10-26-implementation-projects-design.md`

## Global Constraints

- Additive only: no existing behaviour changes for roles admin/user/lead. master is protected — branch `implementation-projects`, one PR per phase.
- New role values exactly `impl_lead` and `impl_user`. They replace admin/user/lead for that person.
- Stages exactly: `handover`, `queued`, `planning`, `in_progress`, `csm_review`, `live`, `on_hold`, `cancelled`. Labels: Handover, Queued, Planning, In progress, CSM review, Live, On hold, Cancelled.
- Project `type`: `onboarding` when the account has no earlier project, else `expansion`. Parallel open projects per account are allowed.
- Task `status`: `todo|doing|done`; `signoff`: `pending|signed|returned`.
- Default weekly capacity 30h; load colours green < 80%, amber 80–100%, red > 100%.
- Dashboard chart statuses: Active, Completed, On hold only (no Dormant). Cancelled excluded.
- Any new settings key must be added to `fetchAll` in `src/06-write-queue.jsx` (`implChecklist`, `implPlanTemplates`, `implCapacity`).
- Security definer helpers re-check `is_active()`; `merge_row` stays security invoker.
- Every PR adds live QA scenarios in `tests/qa/features/11-implementation.mjs`, run with `node tests/qa/run.mjs --feature 11` against org "Crm" before merge, each proven to fail once.
- After PR 1 merges the user re-runs `supabase-setup.sql`.

## Review Focus

1. An `impl_user`/`impl_lead` falling into a branch written as `role !== "admin"` and getting full CSM powers (edit ARR, create accounts) — expect read-only accounts. Pinned by Task 2 RLS test + Task 4 health test.
2. A sent-back task while other tasks are signed — signed ones must keep `signed`, project returns to `in_progress`. Pinned in Task 1 unit tests.
3. A project whose history has no entries before the chart year (created mid-year) or that went live and was then cancelled — chart must not count it before creation; cancelled excluded. Pinned in Task 9 unit tests.
4. An account renamed or CSM renamed (`renameEverywhere`) mid-review — sign-off by the new CSM name must work. Pinned in Task 2 RLS test (update csm then sign).
5. An implementer with no open tasks or no due dates — workload shows 0h / "—", never NaN or Infinity %. Pinned in Task 1 unit tests.

---

# PR 1 — Roles and data

### Task 1: Pure logic module `src/lib/implementation.js`

**Files:**
- Create: `src/lib/implementation.js`; Modify: `src/lib/index.js` (add `export * from "./implementation.js";`)
- Test: `tests/unit/implementation.test.mjs`

**Interfaces — Produces:**
- `STAGES` (array of the 8 ids in Global Constraints order), `STAGE_LABEL` (id→label), `OPEN_STAGES = ["queued","planning","in_progress","csm_review"]`
- `projectType(accountId, projects) -> "onboarding"|"expansion"`
- `canTransition(project, tasks, to, actor) -> { ok: boolean, reason?: string }` where `actor = { id, role, name }` and `tasks` are that project's tasks. Rules: handover→queued needs every required checklist item filled (`project.checklistTemplate` / `project.checklist`); queued→planning only `impl_lead`/`admin` and needs `implementerId`; planning→in_progress needs ≥1 task, actor is implementer/impl_lead/admin; in_progress→csm_review needs every task `done`; csm_review→live needs every task `signed`, actor is account CSM (by name) or admin; any open stage→on_hold and on_hold→previous stage by implementer/impl_lead/admin; →cancelled only impl_lead/admin.
- `applySignoff(tasks, taskId, verdict, note, actor, now) -> { tasks, projectStage }` — `returned` sets that task `status:"todo", signoff:"returned", signoffNote:note` and `projectStage:"in_progress"`; `signed` sets `signedBy/signedAt`; when all signed `projectStage:"live"`, else `"csm_review"`. Other tasks untouched.
- `historyEntry(from, to, actor, note, now) -> { at, by, from, to, note }`
- `loggedHours(task) -> number` (sum of `timeLog[].hours`)
- `workload(implementers, projects, tasks, capacityById, today) -> Array<{ id, name, active, remainingHours, logged30, freeFrom: string|null, loadPct: number|null, band: "green"|"amber"|"red"|null }>` sorted by `loadPct` ascending (nulls first). `loadPct = remaining / (capacity × max(1, weeks until freeFrom))`; null when no open tasks.
- `stageAt(project, isoDate) -> stage|null` — replays `history` (null before the first entry).

- [ ] **Step 1: Write failing tests** in `tests/unit/implementation.test.mjs` covering: projectType both cases; each canTransition rule incl. refusal reasons; applySignoff return-with-others-signed (Review Focus 2) and all-signed→live; workload with no tasks gives `remainingHours 0, loadPct null` (Review Focus 5) and a 60h/30h-capacity/1-week case gives `loadPct 200, band "red"`; stageAt before creation is null.
- [ ] **Step 2:** `npm run test:unit` → FAIL (module missing).
- [ ] **Step 3:** Implement. Dates compared as ISO strings textually (UTC trap).
- [ ] **Step 4:** `npm run test:unit` → PASS.
- [ ] **Step 5:** Commit `Implementation: pure stage/sign-off/workload logic`.

### Task 2: SQL — roles, tables, RLS, guards

**Files:**
- Modify: `supabase-setup.sql` (role constraints at lines ~44/59-60/93/100-101, `invite_user` role list ~1176, new section at end before grants, `merge_row` allow-list ~526, realtime publication loop ~785)
- Test: `tests/rls/implementation.test.mjs` (register in `tests/rls/run.mjs` like the others)

**Interfaces — Produces:** tables `public.projects`, `public.project_tasks` (`org_id, id, data jsonb, updated_at`, pk `(org_id,id)`); helpers `public.impl_role() -> text` (caller's role if impl_*, else null), `public.is_impl_manager() -> boolean` (admin or impl_lead, active).

Rules:
- Role check constraints and `invite_user` accept `impl_lead`, `impl_user`. Last-admin / platform-admin guards unchanged.
- Existing entity tables + settings: implementation roles get SELECT only — add `and (select public.impl_role()) is null` to the existing insert/update/delete policies' checks (accounts, contacts, activities, tasks, opportunities). Recreate those policies in the same do-blocks; do not touch the select policies.
- `projects`/`project_tasks`: select = active + same org, plus restricted-lead scoping by `data->>'accountId'` via `lead_owns`. Insert/update = active + same org (any role). Delete = `is_impl_manager()`.
- Trigger `guard_project` (before insert/update on projects): `implementerId` change or stage `queued→planning` requires `is_impl_manager()`; stage →`live` requires every `project_tasks` row with that projectId to have `signoff = 'signed'` and at least one exists; only admin, impl_lead, or a project's implementer may change it once stage ≥ planning, except stage `csm_review→in_progress|live` by the account CSM (`accounts.data->>'csm' = my_name()`); non-impl CRM users may insert only with stage `handover` or `queued`.
- Trigger `guard_project_task`: a change to `signoff|signedBy|signedAt|signoffNote` requires admin or account CSM by name; other field changes require admin, impl_lead or the parent project's `implementerId`; `accountId` must equal the parent project's.
- Add both tables to `merge_row` allow-list and the realtime publication loop. Definer helpers check `is_active()`.

- [ ] **Step 1: Write failing RLS tests:** impl_user cannot `merge_row` accounts (ARR edit) but can select it; user (CSM) can insert a handover project; user cannot set `implementerId` (error); impl_lead can; implementer can add a task, other impl_user cannot edit it; CSM named on account can sign a task, impl_user cannot; after `update accounts set data = data || '{"csm":"New Name"}'` the renamed CSM can sign (Review Focus 4); moving to live with one unsigned task fails, with all signed succeeds; restricted lead sees only own-account projects. Pair every "cannot" with a "can".
- [ ] **Step 2:** RLS runs only in CI (no local Docker). Open a draft PR to run it; expect FAIL.
- [ ] **Step 3:** Implement the SQL.
- [ ] **Step 4:** CI `node tests/rls/run.mjs` → PASS (and every existing RLS test still passes).
- [ ] **Step 5:** Commit `Implementation: roles, tables, RLS guards`.

### Task 3: Store, reducer, write queue, harness wiring

**Files:**
- Modify: `src/lib/ids.js` (add `export const IMPL_TABLES = ["projects", "project_tasks"];`), `src/06-write-queue.jsx` (fetch both tables AFTER the existing `res` entries so `slice(0,6)`/`res[6]` indexes stay valid; add `projects`, `projectTasks` to state; add settings keys `implChecklist`, `implPlanTemplates`, `implCapacity` with defaults), `src/lib/reducer.js` (actions + `persistOps`), `src/07-reducer.jsx` if it iterates tables, `src/00-core-config.jsx` (`DEFAULT_IMPL_CHECKLIST` per spec's 8 items), `tests/health/harness.mjs` (mock serves `projects`/`project_tasks` from `__seedRows`)
- Test: `tests/unit/reducer.test.mjs` (add cases), `tests/health/persistence.test.mjs` style new `tests/health/implementation-store.test.mjs`

**Interfaces — Produces:** state keys `projects`, `projectTasks`; actions `ADD_PROJECT {item}`, `EDIT_PROJECT {id, patch}`, `SET_PROJECT_STAGE {id, to, note, actor, now}` (appends `historyEntry` to `history`), `ADD_PROJECT_TASK {item}`, `EDIT_PROJECT_TASK {id, patch}`, `LOG_TASK_TIME {id, entry}` (append to `timeLog` via `appends`), `SIGNOFF_TASK {taskId, verdict, note, actor, now}` (uses `applySignoff`, also writes the project stage), `DELETE_PROJECT_TASK {id}`, `SET_IMPL_CHECKLIST {items}`, `SET_IMPL_PLAN_TEMPLATES {items}`, `SET_IMPL_CAPACITY {map}`. Stage changes also add an account activity with `system:true`. `DELETE_ACCOUNT`/`BULK_DELETE` also delete projects/tasks by `data->>accountId`.

- [ ] **Step 1: Failing tests:** reducer — SIGNOFF_TASK returned emits merge ops for task and project with `stage:"in_progress"`; LOG_TASK_TIME emits an `appends.timeLog`; settings key survives a `fetchAll` round trip (health test: seed settings `implChecklist`, reload, value present).
- [ ] **Step 2:** `npm run test:unit` and `node tests/health/run-one.mjs implementation-store` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Both → PASS; full `node tests/health/run.mjs` still green.
- [ ] **Step 5:** Commit `Implementation: store and write-path wiring`.

### Task 4: Role UI — Team screen, invites, sidebar narrowing, read-only accounts

**Files:**
- Modify: `src/25-auth-admin.jsx` (role options at ~470, ~481 add `impl_lead`, `impl_user`; badge colours), `src/26-app.jsx` (views for impl roles = `["Implementation","Accounts"]`; scope toggle hidden for them), `src/20-account-list.jsx`, `src/21-account-detail.jsx` (hide all edit/create controls when `isImplRole(user)`), `src/00-core-config.jsx` (`const isImplRole = u => u && (u.role === "impl_lead" || u.role === "impl_user");`)
- Test: `tests/health/impl-roles.test.mjs`

- [ ] **Step 1: Failing health test:** seed profile `role:"impl_user"`; sidebar lists exactly Implementation and Accounts; account detail has no "+ New account", no Edit, no "+ Add task"; Team screen select offers `impl_lead` and `impl_user` for an admin (Review Focus 1).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (Implementation view can be a placeholder until Task 6). **Step 4:** PASS + full health suite. 
- [ ] **Step 5:** Commit; then QA Task 5.

### Task 5: PR 1 QA scenarios + PR

**Files:** Create `tests/qa/features/11-implementation.mjs`.
- [ ] Scenarios: `11-implementation/invite-impl-role` (admin sets a QA user to impl_user; badge shows), `11-implementation/impl-read-only` (as impl user, account page shows no edit controls). Run `node tests/qa/run.mjs --feature 11`, prove each fails once, then pass.
- [ ] Push, PR "Implementation PR 1: roles and data" with the SQL re-run note and live QA result in the body (`--body-file`). Merge after CI green; ask the user to re-run `supabase-setup.sql`.

# PR 2 — Handover, board, plan

### Task 6: Handover checklist + New project

**Files:** Create `src/29-implementation.jsx` (register in `build.mjs` order); Modify `src/21-account-detail.jsx` (Projects card + "New project"), `src/13-forms.jsx` (on stage→Won, toast with "Start onboarding"), `src/24-settings.jsx` (Settings → Implementation: checklist template editor, admin only).
- Test: `tests/health/impl-handover.test.mjs`

**Interfaces — Produces:** `<ProjectsCard account st dispatch user />`, `<HandoverForm account st dispatch user onDone />`, `<ImplementationPage st dispatch user />` (tabs Board / Workload / My tasks; Workload stub until Task 10).

- [ ] **Step 1: Failing test:** on an account, New project → submit with a required item empty is refused with the item named; filled → project appears in Projects card as Queued, type Onboarding; a second New project on the same account → type Expansion and both listed; marking an opportunity Won shows "Start onboarding".
- [ ] Steps 2–5: run FAIL, implement (project copies `checklistTemplate` from settings at creation), PASS, commit.

### Task 7: Board, project detail, tasks, time log, plan templates

**Files:** Modify `src/29-implementation.jsx`. Test: `tests/health/impl-plan.test.mjs`.

- [ ] **Step 1: Failing test:** Board shows a column per stage (On hold/Cancelled collapsed at end) with the seeded project; impl_lead assigns from Queued (dialog lists implementers sorted by `workload()`), card moves to Planning; implementer adds 2 tasks with est hours, Start → In progress; logs "+2h" → task shows 2h; "Send for sign-off" disabled until both Done; save as template, new project "from template" gets 2 tasks; My tasks lists only own open tasks; impl_user who is not the implementer sees no edit controls.
- [ ] Steps 2–5: FAIL, implement (buttons call `canTransition`, show `reason` as tooltip), PASS, commit.

### Task 8: PR 2 QA + PR
- [ ] Add scenarios `handover-required`, `assign-and-plan`, `log-time` to `11-implementation.mjs`; run live, prove fail-once; PR "Implementation PR 2: handover, board, plan"; merge after green.

# PR 3 — Sign-off, workload, dashboard

### Task 9: CSM review, Live, bell alerts, chart logic

**Files:** Modify `src/29-implementation.jsx`, the bell source (find with `grep -n "Renewal & contract alerts" src`), `src/lib/implementation.js` (+ `chartCounts(projects, year, mode: "month"|"quarter", tierOf: accountId=>tier, tierFilter) -> { periods: string[], series: { active: number[], completed: number[], onHold: number[] }, byTier: { [tier]: { active, completed, onHold } } }` — active/onHold = `stageAt` end-of-period; completed = live-entries within period; cancelled-at-end excluded).
- Test: unit `implementation.test.mjs` (chartCounts: project created in May not counted Jan–Apr; went live in Q2 counts completed only in Q2; cancelled excluded — Review Focus 3); health `tests/health/impl-signoff.test.mjs`.

- [ ] **Step 1: Failing tests:** chartCounts cases above; CSM sees Sign off / Send back per task; send back with note → project In progress, note visible to implementer, other signed tasks still signed; all signed → Live, account activity logged; bell shows "ready for sign-off" to CSM, "assigned to you" to implementer, "returned" to implementer, "queued" to impl_lead, using the bell's existing window rule.
- [ ] Steps 2–5: FAIL, implement, PASS, commit.

### Task 10: Workload tab + Dashboard chart

**Files:** Modify `src/29-implementation.jsx` (Workload table, editable capacity per implementer → `SET_IMPL_CAPACITY`, impl_lead/admin only), `src/16-dashboard.jsx` (card "Implementation projects": Month/Quarter toggle, year picker, tier filter, stacked bars Active/Completed/On hold, tier × status table under it; use `src/09-charts.jsx` conventions — load the `dataviz` skill before writing the chart). Test: `tests/health/impl-workload.test.mjs`.

- [ ] **Step 1: Failing test:** Workload rows show active count, remaining h, logged 30d, free-from, load % with colour class; capacity edit persists after reload; an implementer with no tasks shows "—"; Dashboard card renders 12 month labels Jan–Dec, Quarter toggle shows Q1–Q4, tier filter changes counts, dark mode legible.
- [ ] Steps 2–5: FAIL, implement, PASS + full `node tests/health/run.mjs` + `npm run test:unit`, commit.

### Task 11: PR 3 QA + PR
- [ ] Add scenarios `signoff-return`, `go-live`, `workload-visible`, `dashboard-chart`; run live, prove fail-once; PR "Implementation PR 3: sign-off, workload, dashboard"; merge after green. Update memory (new `onevio-implementation-projects.md` + MEMORY.md line, branch ledger).
