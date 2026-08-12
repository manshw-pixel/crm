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

## 7. Regression surface

The change is structurally additive — nothing existing is deleted or rewritten.
Four places nonetheless touch current behavior and must be handled explicitly.

### 7.1 The `initialFilter` effect (highest risk)

Today the effect sets 5 fields (`risk`, `showChurned`, `onlyChurned`, `billing`,
`qbrDue`) and deliberately leaves `q`, `tier`, `csm`, `renew` and `sort`
untouched, so a dashboard card click layers a risk filter on top of whatever the
user already typed.

Extending it to carry all 10 fields for segments **must preserve keys the
incoming filter object does not mention**. Applying a saved segment sets all 10;
a dashboard card click still sets only the keys it passes. If this is
implemented as an unconditional reset, clicking a dashboard card silently wipes
the search box.

Required test: type a search term, click a dashboard risk card, assert the
search term survives.

### 7.2 Escape key collision

Line 2649 registers an App-level `Escape → setAcctId(null)` that closes the
account detail view. Any Escape-to-close added to `BulkDialog` or other modals
must call `e.stopPropagation()`, following the command palette at line 2590.
Without it, one Escape closes the dialog *and* navigates out of the account.

Required test: open a bulk dialog from inside an account, press Escape, assert
the dialog closes and the account detail is still open.

### 7.3 `alert()` → toast changes timing, not logic

`alert()` blocks the page; a toast does not. All 8 sites were checked — none
depend on the blocking pause for control flow; each failure path `return`s or
calls `setBusy(false)` immediately after. The user-visible difference is that a
failure no longer halts the page, which is why error toasts persist until
dismissed.

### 7.4 Account table layout

The new checkbox column shifts column widths and the sub-account indentation.
Visual only; the rollup math and grouping logic are untouched.

### Safe by construction

- `settings.segments` needs no migration: line 267 merges saved settings
  per-key with the `saved.X || {}` pattern, so existing team data and older JSON
  exports load unchanged with `segments` defaulting to `[]`.
- Bulk actions reuse the single-account transforms rather than reimplementing
  them, so the ARR audit trail and churn analytics cannot diverge between paths.

### Merge gate

All **13 existing** test files in `tests/health/` must pass unchanged, alongside
the 3 new ones. The existing suite is the regression guarantee, not the new
tests.

## Delivery

One feature branch, one PR against `master`, verified with the E2E harness
before merge. Merging deploys to GitHub Pages immediately.
