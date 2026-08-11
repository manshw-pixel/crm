# Task Work Queue — Design

**Date:** 2026-08-11
**Status:** Approved
**Target:** `crm.html` (single-file React + Supabase)

## Problem

OneVio CRM generates most of its tasks automatically — the renewal playbook seeds `▶` tasks for accounts within 90 days of renewal, and the health playbook seeds `♥` tasks when an account's band worsens — and then gives a CSM nowhere good to work them.

Today tasks appear on exactly two surfaces:

- the dashboard's "Tasks due this week" card (`crm.html:1358`), capped to a 7-day window in a `max-h-40` scroll box
- the per-account "Open tasks" panel (`crm.html:1891`), which requires already knowing which account to open

There is no view that answers "what do I need to do today, across my whole book?" Overdue work is invisible unless it happens to fall inside the dashboard's week window. This spec adds a Tasks view as the CSM's daily driver.

## Decisions

| Question | Decision |
|---|---|
| Default organization | Due-date buckets: Overdue / Today / This week / Later / Done |
| Inline actions | Complete, reschedule, and open the account. No inline title/owner/priority editing. |
| Filters | Scope (Mine/All), source (health / renewal / manual), account health band, free-text search — all four |

Rejected during design: full inline editing of every task field (rebuilds `AddTaskForm` inside a row for little gain — the account panel already does this), and bulk multi-select actions (YAGNI for this view; bulk operations on the *account* list are a separate, larger piece of work).

## Components

### 1. `bucketTasks(tasks, today)` — pure helper

```
bucketTasks(tasks, today) -> { overdue, today, week, later, done }
```

- `done` collects every task with `status === "Done"`, regardless of its due date, and is excluded from the other buckets.
- The rest split on `daysUntil(t.due)`: `< 0` → `overdue`, `=== 0` → `today`, `1..7` → `week`, `> 7` → `later`.
- Each bucket is sorted by due date ascending, then by priority High → Medium → Low.
- A task with a missing or empty `due` sorts to the end of `later`. (Every task created by the app has a due date; this only guards imported or hand-edited data.)

Pure and dependency-free apart from the existing `daysUntil`. Exported on `window.__health` so tests can exercise it directly, following the `backfillCandidates` precedent.

### 2. `filterTasks(tasks, accountsById, opts)` — pure helper

```
filterTasks(tasks, accountsById, { scope, userName, source, band, q }) -> Task[]
```

Applied before bucketing. `accountsById` is a plain object mapping account id to the scored account, so the helper stays pure and needs no access to component state.

- **scope** — `"mine"` keeps tasks where `owner === userName`; `"all"` keeps everything.
- **source** — `"all"` | `"health"` (`t.healthPlaybook === true`) | `"renewal"` (`t.playbook === true`) | `"manual"` (neither flag set). These flags already exist: the renewal seeder sets `playbook: true` (`crm.html:2563`) and the health seeder sets `healthPlaybook: true`.
- **band** — `"all"` | `"Red"` | `"Yellow"` | `"Green"`, compared against `accountsById[t.accountId]?.risk`. A task whose account is missing is dropped when a specific band is selected, and kept when `"all"`.
- **q** — case-insensitive substring match against the task title and the account name. Empty string matches everything.

### 3. `TasksView` — the view component

```jsx
TasksView({ st, scored, dispatch, user, openAccount })
```

Owns local `useState` for the five filter values and for which sections are expanded. Filter state is deliberately not persisted, matching how `AccountList` treats its own filters.

**Filter bar** — a scope toggle (Mine/All), three `Select`s (source, band), and a search `Input`, laid out like the existing `AccountList` control row.

**Sections** — `Overdue`, `Today`, `This week`, `Later`, `Done`, each a collapsible block with its count in the header. `Overdue` and `Today` start expanded; the rest start collapsed. `Overdue`'s header count renders in rose when non-zero.

**Row** — `[checkbox] [source glyph] [title] [account] [due control] [priority]`:

- checkbox dispatches the existing `TOGGLE_TASK` (`crm.html:394`)
- the source glyph is the `♥` / `▶` already embedded in the task title by the seeders; the title renders as stored, so no glyph is synthesized
- the account name is a button calling the existing `openAccount(t.accountId)`
- the due control is a `Select` with `Today`, `Tomorrow`, `+1 week`, `Custom…`; choosing one dispatches the existing `EDIT_TASK` with a new `due` computed via `isoPlus(iso(Date.now()), n)`. `Custom…` reveals an `<input type="date">` on that row which dispatches `EDIT_TASK` on change.
- overdue due dates render rose and bold, matching the dashboard card's existing treatment (`crm.html:1368`)

**Empty state** — when every bucket is empty, the view renders a single message distinguishing "no tasks at all" from "no tasks match these filters", rather than five empty sections.

**No new reducer actions.** `TOGGLE_TASK` and `EDIT_TASK` both already exist and already persist.

### 4. Navigation

Add `"Tasks"` to `VIEWS` (`crm.html:2490`) in second position: `["Dashboard", "Tasks", "Accounts", "Renewals", "Settings"]`. Both nav renderers (`crm.html:2447`, `crm.html:2492`) derive their lists from that array, and the command palette reads the same list, so palette navigation to Tasks comes for free. Render the view in `App` alongside the existing view branches.

The dashboard's "Tasks due this week" card is left exactly as-is. This view is additive.

## Testing

Playwright against the existing harness (copy `crm.html`, swap in the in-memory Supabase mock, seed via `window.__seed`, headless Edge via `channel: "msedge"`, assert against `#root`).

**Unit, via `window.__health`:**

1. `bucketTasks` boundaries: due yesterday → overdue; due today → today; due tomorrow → week; due +7d → week; due +8d → later.
2. A `Done` task with an overdue date lands in `done`, not `overdue`.
3. Sort order within a bucket: earlier due first; equal dues ordered High → Medium → Low.
4. `filterTasks` scope: `mine` drops another CSM's tasks; `all` keeps them.
5. `filterTasks` source: `health` keeps only `healthPlaybook` tasks, `renewal` only `playbook` tasks, `manual` only unflagged ones.
6. `filterTasks` band: `Red` keeps only tasks whose account scores Red.
7. `filterTasks` q: matches on account name as well as task title.

**E2E:**

8. Navigating to Tasks shows the seeded tasks in the correct sections with correct counts.
9. Ticking a task's checkbox moves it into `Done` and it no longer appears in its date bucket.
10. Rescheduling an overdue task to `+1 week` moves it out of `Overdue` into `Later`.
11. Selecting the Renewal source filter hides `♥` health tasks.
12. The empty state appears when filters match nothing, and reads differently from the no-tasks-at-all case.

## Out of scope

- Bulk multi-select actions (select many, complete/reassign together).
- Inline editing of title, owner, or priority — the account panel's `AddTaskForm` already covers these.
- Task creation from this view; tasks are created per-account, as today.
- Any change to the dashboard's "Tasks due this week" card.
- Persisting filter selections across sessions.
- Notifications or reminders driven off overdue tasks.

## Constraints

All changes to `crm.html` are strictly additive — no existing behavior changes, and no new reducer actions. Merging to master auto-deploys the live team app, so this ships via PR with the E2E suite green first.
