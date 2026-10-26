# Client Onboarding & Implementation Projects — Design

Date: 2026-10-26 · Status: draft for user approval
The user skipped the Q&A, so everything marked **(my call)** is a default the user hasn't confirmed yet.

## Intent

Today the CRM picks an account up once a CSM owns it. The stretch from "deal signed" to "customer live" happens outside the app. That's where handover detail gets lost and nobody can see who in implementation is overloaded.

This feature puts that stretch inside the CRM:

1. **Handover.** When a deal closes, the seller fills in a handover checklist and the account goes into the implementation queue.
2. **Plan and delivery.** An implementation lead assigns the project to an implementer. That person builds a project plan made of tasks and works through them one by one.
3. **Sign-off.** When every task is done, the account's CSM reviews each task and either signs it off or sends it back. Once every task is signed off, the project closes and the CSM manages the account as usual.
4. **Repeat projects.** An account that's already live can get another project, such as a new module or a rollout to a new region. It goes through the same cycle, except the **CSM** fills in the checklist instead of sales.
5. **Workload.** Implementation leads can see how many projects each implementer has and how much time they're committed to, so they can assign new work fairly.

## Goals

- One project record per onboarding or implementation, linked to an account, with a clear stage at every point.
- A handover checklist that has to be complete before the project goes into the queue.
- Two implementation roles: **Implementation lead** (assigns work, sees everything) and **Implementation user** (works on the projects assigned to them).
- A project plan made of tasks, each with an owner, a due date, estimated hours and logged hours.
- CSM sign-off on each task, with "send back" and a note.
- A workload view for each implementer: active projects, remaining planned hours, hours logged, and when they next become free.
- Any number of projects per account over its life, with history kept.

## Non-goals (this build)

- Email alerts for project events. The bell covers them in-app. Email can come later through the existing alert pipeline.
- Gantt charts or task dependencies. (The dashboard status chart below is in scope.) Tasks are an ordered list.
- Time-sheet approval and billing hours. Logged hours are for workload only.
- Customer-facing portal or a client-visible project plan.
- Automatically creating the project when an opportunity is marked Won. The app suggests it, and a person confirms.

## Anti-goals

- Changing or breaking any existing flow. Everything is additive, following the repo's additive-only rule.
- A second "tasks" concept that leaks into the existing Tasks page. Project tasks stay separate from CSM tasks.
- A heavy form that sellers skip. The checklist stays short and the template is editable.

## Roles (user decision 2026-10-26: separate roles)

- `profiles.role` (and `invites.role` / `invite_user`) gains two values: **`impl_lead`** and **`impl_user`**. They **replace** admin/user/lead for those people; an implementer is not also a CSM. Admins set them on the Team screen and in invites like any role.
- **Implementation lead (`impl_lead`):** sees every project; assigns/reassigns implementers; edits any plan; sees the Workload tab. This is the "implementation admin". Org admins hold the same powers.
- **Implementation user (`impl_user`):** sees every project read-only on the board; edits plan and tasks only on projects where they are the assigned implementer; logs time on their own tasks.
- **Narrowed CRM access (my call):** both implementation roles get the sidebar items **Implementation** and **Accounts** only. Accounts are read-only to them (profile, contacts, project card) — no edits to ARR, health inputs, renewals, opportunities, CSM tasks, finance, settings, or create/delete. Enforced by RLS: implementation roles have SELECT on accounts/contacts and no write on the existing tables.
- **Sales / CSM (role admin/user/lead):** fill in the handover checklist; see project status on the account page.
- **The account's CSM** signs off tasks (org admins as fallback).
- A restricted CRM Lead (role `lead`, no finance) sees projects only on their own accounts.
- **Parallel projects allowed (user decision):** an account can have several open projects at once; no uniqueness check.

## Lifecycle

Each project moves through these stages:

`Handover → Queued → Planning → In progress → CSM review → Live`

There's also a side state, **On hold** (reachable from Planning or In progress), and **Cancelled** (a lead or admin can cancel at any stage).

| Stage | Who moves it forward | Rule |
|---|---|---|
| Handover | Seller or CSM | Fills in the checklist. "Submit" requires every *required* item. |
| Queued | Implementation lead or admin | Assigns an implementer, which moves it to Planning. |
| Planning | Implementer | Builds tasks and sets the target go-live date. "Start" requires at least one task. |
| In progress | Implementer | Works the tasks. "Send for sign-off" requires every task Done. |
| CSM review | CSM | Signs off or sends back each task. A sent-back task reopens, with a note, and the project returns to In progress. When every task is signed off, the project moves to Live. |
| Live | none | Closed. Records `liveAt`, and the account carries on under the CSM. |

- `type` is `onboarding` (first project, checklist by sales) or `expansion` (later project, checklist by the CSM). It defaults to `onboarding` when the account has no earlier project, and to `expansion` otherwise (parallel projects allowed).
- Every stage change is written to the project's own history list (who, when, from, to, note). It also writes a system activity on the account, with `system:true` so health recency scoring ignores it.

## Handover checklist

- The template is stored in settings as `settings.implChecklist`: a list of `{id, label, kind: check|text|date, required}`. **Remember the fetchAll trap:** add the new key in `src/06-write-queue.jsx` or it disappears on reload.
- Default template **(my call)**: signed order form attached (check, required) · go-live target date (date, required) · customer project contact (text, required) · modules / scope purchased (text, required) · licences sold (text) · special commitments made in the sale (text) · integrations required (text) · kickoff call scheduled (check).
- Org admins edit the template under Settings → Implementation. Each project keeps a copy of the template it was created with, so later edits to the template don't change existing projects.
- On the Opportunities form, setting the stage to **Won** shows a toast with a "Start onboarding" button that opens the checklist for that account. Account detail also always has a **New project** button.

## Project plan

- A task has: title, owner (an implementer, defaulting to the project's implementer), due date, estimated hours, logged hours, status (`todo`, `doing`, `done`), sign-off state (`pending`, `signed`, `returned` plus a note), and its order position.
- **Plan templates (my call, small):** a lead can save a project's task list as a named template and start new plans from one. These live in `settings.implPlanTemplates`, so they also need adding to fetchAll.
- Logging time is a quick "+ hours" entry on a task. Each entry stores `{by, at, hours}`, and logged hours are their total.

## Workload (for implementation leads and admins)

One row per implementer **(my call on the measures)**:
- Active projects: the count in Planning, In progress or CSM review. (Queued projects have no implementer yet, so they don't count against anyone.)
- Remaining planned hours: estimated minus logged hours, summed over their open tasks.
- Hours logged in the last 30 days.
- **Free from:** the latest target go-live date across their active projects.
- Optional **weekly capacity** for each person (set by a lead; default 30h). Load % = remaining hours ÷ (capacity × weeks until their latest due date). It's shown green below 80%, amber from 80 to 100%, and red above 100%.

The assign dialog on a Queued project lists implementers sorted by load, with these numbers shown inline, so the lead assigns based on the data.

## Screens

- **A new "Implementation" item in the sidebar**, shown to every user. A restricted Lead sees only their own accounts' projects there **(my call)**. It has three tabs:
  - **Board:** a column per stage with project cards (account, type, implementer, target date, task progress). Filters: mine, implementer, type.
  - **Workload:** the table above (implementation leads and admins only).
  - **My tasks:** open project tasks owned by me, with due dates.
- **Project detail:** a header (account, stage, type, implementer, dates, stage action button), a read-only checklist panel (editable while in Handover), the ordered task list with inline status, hours and sign-off controls, and the history list.
- **Account detail:** a "Projects" card listing current and past projects, with stage badges and a **New project** button.
- **Dashboard card: "Implementation projects" (user request 2026-10-26).** A chart on the existing Dashboard showing how many projects were **Active, Completed, On hold and Dormant** in each period, January to December of a chosen year.
  - **Toggles:** Month or Quarter (Q1 to Q4), and a year picker.
  - **Tier:** a tier filter (All, or one tier) above the chart. Under the chart, a small table of tier × status counts for the selected period (by default the latest period with data), so tiers can be compared.
  - **Definitions (my calls):**
    - *Active*: the project was in Queued, Planning, In progress or CSM review at the end of the period.
    - *Completed*: the project went Live during the period. This counts the flow in that period, not a running total.
    - *On hold*: the project was On hold at the end of the period.
    - *Dormant*: the project was open (Planning or In progress), not on hold, and had no task status change, time logged or stage change in the 30 days before the end of the period. A dormant project is counted only as Dormant, never also as Active, so the bars add up.
  - A project's state at any past date is rebuilt from its `history` list, the same ledger-replay approach the ARR cards use. Cancelled projects are left out.
  - **Who sees it:** everyone who sees the Dashboard. Restricted Leads see their own accounts' projects only. The card goes in PR 3, and the counting logic goes in `src/lib/implementation.js` with golden unit tests.
- **Bell:** derived alerts (no new store, matching the bell design). Alerts go to: a lead when a project reaches Queued; an implementer when assigned; the CSM when a project reaches CSM review; an implementer when a task is returned. Each uses the bell's existing time-window rule.

## Data **(my call)**

- Two new tables, `projects` and `project_tasks`, added to the existing jsonb table loop in `supabase-setup.sql` (`org_id, id, data jsonb, updated_at`). They're separate so two implementers editing different tasks never overwrite each other's row.
- `projects.data`: `{accountId, type, stage, implementerId, createdBy, checklistTemplate, checklist:{itemId:value}, targetGoLive, startedAt, liveAt, history:[…], holdReason}`.
- `project_tasks.data`: `{projectId, accountId, title, ownerId, due, estHours, timeLog:[…], status, signoff, signoffNote, signedBy, signedAt, order}`. `accountId` is copied onto each task so the existing RLS rules for restricted leads work unchanged.
- Role check constraints on `profiles` and `invites`, and the role list in `invite_user`, gain `impl_lead` and `impl_user`. Existing role guards (last-admin, platform-admin) are unchanged. Every place that branches on `role === "lead"` or `!== "admin"` is audited so the new roles fall into the narrowed path, not the full-access `user` path.
- **RLS:** the same org policies as the other jsonb tables, plus write rules enforced in the database, not just the UI:
  - Stage moves to Queued → Planning and implementer changes only by an implementation lead or admin.
  - Task edits only by an implementation lead, an admin, or the project's implementer.
  - Sign-off fields only by the account's CSM (matched by profile id once available, otherwise by name as the existing CSM field does) or an admin.
  - **Definer-function caution (user-disable memory):** any security definer helper must re-check `is_active()`.
- Realtime subscription and write queue: register both tables as the existing tables are registered.

## Delivery

Three PRs, each additive, each with live QA scenarios in `tests/qa/features/`, as the workflow rule requires:
1. **Roles and data:** the SQL (tables, new role values, guards, RLS incl. read-only CRM access for implementation roles), store, reducer and write-queue wiring, the Team screen role options, sidebar narrowing, RLS tests in CI. The user re-runs `supabase-setup.sql` once this merges.
2. **Handover, board and plan:** checklist template settings, New project and the Won toast, Board, project detail, tasks, time logging, plan templates, the account Projects card.
3. **Sign-off, workload and dashboard:** CSM review flow, send back, Live, the Workload tab and capacity, the assign dialog sorted by load, bell alerts, the Dashboard projects chart.

## Settled after the reviewer's read (my calls)

- **Matching the CSM for sign-off:** compared against the account's `csm` name using the existing `my_name()` helper, the same name matching the rest of the app uses today. Moving to matching by profile id is the open follow-up already listed in memory, and isn't part of this build.
- **What the database enforces:** assigning or changing the implementer (implementation lead or admin), the sign-off fields (the CSM or an admin), and **Live is reachable only when every task is signed off**. The other stage moves are checked in the UI only.
- **During CSM review:** the implementer can still log time, but can't change a task's title, estimate or status unless the CSM has sent that task back. Tasks that are already signed off keep their sign-off when another task is sent back.

## Left to the builder

Visual layout within the existing design atoms and dark-mode palette; exact card fields; how history is displayed; and pure logic (stage transitions, workload maths) placed in `src/lib/implementation.js` with golden unit tests.
