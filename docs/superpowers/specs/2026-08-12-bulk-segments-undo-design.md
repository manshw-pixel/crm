# Bulk actions, saved segments, and undo — design

Date: 2026-08-12
Target file: `crm.html` (single-file React app, ~2,862 lines)

## Goal

Close two of the three remaining gaps between OneVio CRM and a 9 rating:

- **Gap 3** — no bulk actions or saved segments on the account list; reassigning a book or retiering means editing one account at a time.
- **Gap 4 (partial)** — errors surface as blocking `alert()` calls and there is no undo on destructive actions.

The accessibility half of gap 4 ships in this same change. Test coverage of the
untested domains (gap 2) is deliberately **out of scope** and follows as its own
piece of work; this spec only adds tests for what it introduces.

All changes are additive. No existing behavior is removed or altered.

## Non-goals

- No undo for non-bulk mutations. No global action-history stack.
- No per-user (as opposed to team-shared) segment storage.
- No new Supabase tables or schema migrations.
- No test coverage for renewals, ARR audit, documents, CSV import, or the
  command palette. That is the next piece of work.

## 1. Toast and undo infrastructure

### Component

A `ToastProvider` mounted at App level exposing `useToast()`. Toasts render in a
fixed bottom-right stack.

```
pushToast({ text, tone, undo })
```

- `tone: "info" | "success" | "error"`.
- `info` and `success` auto-dismiss after 5s; when `undo` is supplied the
  window is 10s and the toast renders an Undo button.
- `error` toasts **persist until dismissed**. `dbError` signals that a write may
  not have reached the team, so it must not disappear on a timer.
- The stack is capped at 3 visible toasts; older ones drop off the top.

### Replacing `alert()`

All 8 call sites convert to toasts with their existing message text unchanged:

| Line | Site | Tone |
|---|---|---|
| 245 | `dbError` — save failed | error |
| 791 | document delete failed | error |
| 822 | upload failed | error |
| 860 | upload failed | error |
| 2327 | bulk update failed | error |
| 2332 | import succeeded / import failed | success / error |
| 2634 | could not load shared data | error |
| 2850 | could not load profile | error |

Line numbers are as of this spec's writing and are a locator, not a contract —
match on the call, not the line.

### Undo mechanics

Undo is snapshot-based and scoped to the toast. Each bulk action captures the
prior state of everything it touches before dispatching, and the toast's Undo
button dispatches `RESTORE_SNAPSHOT` with that capture.

Accepted risk: data is shared with the team in real time, so a teammate's edit
to an affected account inside the 10s window is overwritten by the restore. This
is acceptable for the book-transfer use case and is not mitigated.

## 2. Selection on the account list

State added to `AccountList`:

- `selected` — a `Set` of account ids.
- Cleared whenever the filter set or active segment changes, so a selection can
  never outlive the rows that produced it.

UI:

- A leading checkbox column on each row.
- A header select-all that covers **only the currently filtered rows** (`rows`,
  post-filter, post-grouping).
- Selecting a parent does **not** auto-select its sub-accounts. Implicit
  selection of rollup children is how a book transfer goes wrong silently; subs
  must be checked explicitly.
- A sticky action bar appears when `selected.size > 0`: "N selected", the five
  action buttons, and a clear-selection button.

## 3. Bulk actions

A single `BulkDialog` component switched on action kind.

| Action | Fields | Reducer case |
|---|---|---|
| Reassign CSM | CSM select, sourced from `team` | `BULK_PATCH_ACCOUNTS` |
| Change tier | Tier select | `BULK_PATCH_ACCOUNTS` |
| Add task to each | Title, due date, owner | `BULK_ADD_TASKS` |
| Churn | Reason (**required**), churn date | `BULK_CHURN` |
| Delete | Typed confirmation (`DELETE`) | `BULK_DELETE` |

### Reuse rule

Each bulk case applies the **same per-account transform the single-account path
already uses**. `BULK_CHURN` runs the existing `withAudit` `contractStatus`
entry per account; reassign and retier produce the same audit rows
`EDIT_ACCOUNT` produces. There is no parallel implementation of the transforms,
so the ARR audit trail and churn analytics cannot diverge between the single and
bulk paths.

`BULK_ADD_TASKS` is the one action whose undo is not a state restore: it records
the ids of the tasks it created, and its undo removes exactly those ids. It adds
nothing to any account, so no account snapshot is taken.

### Churn reason caveat

Churn analytics break down by reason. A batch churn writes one shared reason
across the selection, which blunts that report. The reason field is therefore
**required** on the bulk dialog so the value is never blank or defaulted.

### Delete cascade and its snapshot

`DELETE_ACCOUNT` cascades: it removes the account, filters `contacts`,
`activities`, `tasks` and `opportunities` by `accountId`, and re-parents
surviving sub-accounts by setting `parentId: null` with an `_orphaned` marker
that `persist()` uses to write them back.

The undo snapshot for `BULK_DELETE` must therefore capture, for the selected ids:

1. the full account records,
2. all `contacts`, `activities`, `tasks`, `opportunities` rows referencing them,
3. the original `parentId` of every sub-account that gets orphaned.

`RESTORE_SNAPSHOT` writes all of it back through the existing persist path. This
is the riskiest part of the change and is covered by a dedicated test rather
than trusted by inspection.

### Sync layer

The persistence `switch` (around line 288) gains the new bulk cases, upserting
every affected account rather than the single `action.id` account. `BULK_DELETE`
and `RESTORE_SNAPSHOT` additionally touch the cascaded collections.

## 4. Saved segments

Stored as `settings.segments`:

```js
[{ id, name, filter: { q, tier, risk, csm, renew, billing,
                       showChurned, onlyChurned, qbrDue, sort } }]
```

A `SET_SEGMENTS` reducer case follows `SET_PLAYBOOK` exactly, in both the state
reducer and the persistence switch. Segments are therefore team-shared and sync
with no schema change — consistent with how weights, rates, and playbooks
already behave.

UI in the `AccountList` toolbar: a segment dropdown, "Save current view",
rename, and delete. Applying a segment routes through the existing
`initialFilter` effect, which is extended to carry all ten fields instead of the
current five (`risk`, `showChurned`, `onlyChurned`, `billing`, `qbrDue`).
Dashboard card clicks continue to work unchanged, passing a partial filter.

## 5. Accessibility

The file currently contains **zero** `aria-` attributes. This change adds:

- `aria-label` on every icon-only button (nav items, command palette, modal
  close buttons).
- `role="dialog"` + `aria-modal="true"` + focus trap + Escape-to-close on
  modals, including `BulkDialog`.
- `aria-live="polite"` on the toast stack; `role="alert"` on error toasts.
- `aria-sort` on sortable account-list column headers, reflecting `sort.dir`.
- `aria-current="page"` on the active nav item.
- Per-row checkbox `aria-label` naming the account, and a distinct label on the
  select-all checkbox.

## 6. Testing

New E2E files under `tests/health/`, registered in `run.mjs`, using the existing
Playwright harness (copy `crm.html`, swap in the in-memory Supabase mock, seed
via `window.__seed`, drive headless Edge via `channel: "msedge"`):

- `bulk.test.mjs` — selection math (select-all covers filtered rows only; parent
  selection excludes subs); reassign and retier write the expected audit rows;
  bulk churn requires a reason; **delete-then-undo restores accounts, all four
  cascaded collections, and sub-account `parentId`**.
- `segments.test.mjs` — save, apply, rename, delete; a saved segment restores
  all ten filter fields; applying a segment clears the selection.
- `toast.test.mjs` — a failing write surfaces an error toast that does not
  auto-dismiss; an undoable toast dismisses after its window and the Undo button
  disappears with it.

Date comparisons in tests compare ISO strings textually, never via `Date`
round-trips — UTC-vs-local has caused failures here twice.

## Delivery

One feature branch, one PR against `master`, verified with the E2E harness
before merge. Merging deploys to GitHub Pages immediately.
