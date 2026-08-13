# CSV Import Tests, Single-Delete Undo, and Filter Labels — Design

Date: 2026-08-13
Status: approved, ready for planning

## Why

After the bulk-actions branch (PR #12) the app rates 8/10. Three gaps hold it below 9:

1. **CSV import has zero test coverage** and is the only untested path that mutates
   accounts in bulk. It creates and edits accounts from arbitrary user files.
2. **Undo is inconsistent.** Bulk-deleting 20 accounts is undoable; deleting one is
   permanent. A user who learns to trust undo from the bulk path gets burned on the
   single path — the more common action.
3. **Five filter dropdowns have no accessible name**, so a screen reader announces
   five unlabeled comboboxes in a row.

Out of scope: test coverage for renewals, documents, the ARR audit trail and the
analytics views; converting the remaining `confirm()` calls to non-blocking dialogs.
These stay open and are the next increment after this one.

## 1. CSV import tests

### Test seam

`parseCSV` (crm.html ~1642) and `importAccountsCSV` (~1659) are module-scoped and
unreachable from a test. The file already exposes a test seam near the bottom:

```js
window.__health = { isoPlus, addMonths, BAND_RANK, healthPlaybookOf, DEFAULT_HEALTH_PLAYBOOK, backfillCandidates, bucketTasks, filterTasks };
```

Add both functions to that object. This is the established pattern, additive, and the
only production change section 1 requires beyond section 1.3.

`importAccountsCSV(file, accounts, dispatch, done, user)` takes a `File` and reads it
with `FileReader`, so tests construct `new File([csvText], "accounts.csv")` inside the
page context and await the `done` callback.

### 1.1 Parser cases (`parseCSV`)

| Case | Expectation |
| --- | --- |
| quoted field containing a comma | stays one field |
| escaped `""` inside a quoted field | becomes a single `"` |
| CRLF line endings | same result as LF |
| newline inside a quoted field | preserved, does not split the row |
| blank and whitespace-only rows | filtered out |
| no trailing newline | final row still emitted |

### 1.2 Import cases (`importAccountsCSV`)

| Case | Expectation |
| --- | --- |
| fewer than 2 rows | `err` about needing a header row; nothing dispatched |
| header without `name` | `err` naming the `name` column; nothing dispatched |
| row with an empty name | counted in `skipped`, not imported |
| new row | `ADD_ACCOUNT`, counted in `ok` |
| row matching an existing `accountNo` | `EDIT_ACCOUNT`, counted in `updated`, no new account |
| row matching an existing name in different case | updates the existing account, does not create a second |
| row with usage/sentiment/tickets/nps | also dispatches `UPDATE_INPUTS` |
| numeric fields as text | coerced; absent or non-numeric becomes 0 |

Two behaviors are pinned deliberately because they are silent and load-bearing:
case-insensitive name matching (so re-importing an export is idempotent rather than
duplicating), and the tier/contractStatus fallbacks described next.

### 1.3 Make the silent fallbacks visible

Today an unrecognized tier silently becomes `"Mid"` and an unrecognized
`contractStatus` silently becomes `"Active"`:

```js
if (has("tier")) vals.tier = ["Enterprise","Mid","SMB"].find(t => t.toLowerCase() === col(r,"tier").toLowerCase()) || "Mid";
```

A typo'd or wrongly-mapped column therefore retiers accounts across the whole import
with no signal. Keep the fallback — failing the import outright would be worse — but
count the coercions and report them.

`importAccountsCSV`'s `done` payload gains two counters:

```js
done({ ok, updated, skipped, badTier, badStatus })
```

`badTier` / `badStatus` increment only when the column is present and non-empty and the
value did not match a known option. An empty cell is not a coercion and must not count.

The import banner (~2066) appends, when either is non-zero:
`· 3 row(s) had an unrecognized tier (set to Mid)` and the equivalent for status. The
banner stays in its success style — this is a warning, not a failure.

Tests: a CSV with `tier: "Enterprise-Plus"` reports `badTier: 1` and still writes
`"Mid"`; a CSV with an empty tier cell reports `badTier: 0`.

## 2. Undo on single-account delete

The account delete (~2274) keeps its blocking `confirm()` — it cascades across five
tables and is the most destructive single action in the app. After the user confirms,
it gains the same 10-second undo toast the bulk path uses:

```js
const snapshot = snapshotFor(state, [a.id]);
dispatch({ type: "DELETE_ACCOUNT", id: a.id });
toast({ text: `Deleted ${a.name}.`, tone: "success",
        undo: () => dispatch({ type: "RESTORE_SNAPSHOT", snapshot }) });
back();
```

`snapshotFor` already handles a single id and captures the account, its contacts,
activities, tasks and opportunities, plus `parentIds` for sub-accounts — no change
needed. `AccountDetail` gains `useToast()`.

**Inherited trade-off, accepted:** `DELETE_ACCOUNT`'s persist fires deletes without
awaiting, so a late delete can race a restore. This is the existing bulk-path behavior
and the risk already accepted in the bulk/segments spec §1. Undo stays one-shot and
human-clicked; nothing fires it programmatically.

Tests: deleting an account with children and clicking Undo restores the account, all
four child collections, and any sub-account's `parentId`; the undo survives a reload
in the stateful-persistence harness.

## 3. Filter select labels

Add `aria-label` to the five unlabeled dropdowns in the account list filter row
(~2025-2030): tier, risk, CSM, renewal window, billing. The segment picker already has
one.

Test: every `<select>` rendered in the account list has an accessible name, via
`aria-label`, `aria-labelledby`, or a wrapping `<label>`. Written as a sweep rather
than five assertions so a newly added select cannot regress it — the same shape as the
existing icon-only-button sweep in `a11y.test.mjs`.

## Testing

All three land in the existing Playwright harness (`tests/health/`).

- New `csv.test.mjs` — sections 1.1, 1.2, 1.3
- `bulk.test.mjs` — single-delete undo
- `persistence.test.mjs` — single-delete undo survives a reload
- `a11y.test.mjs` — the select-label sweep

Baseline is 90 passed / 0 failed. Every new test must fail before its implementation
lands; the CSV parser tests should be written against the real parser without changing
it, so a passing-on-first-run test means the case was already covered, not that the
test works.

## Regression surface

| Risk | Mitigation |
| --- | --- |
| Adding to `window.__health` shadows or collides with an existing key | Both names are new; the object is only read by tests |
| The new counters change the `done` payload shape | `setImportMsg` spreads the object into state; the banner reads named keys, and absent counters render nothing |
| Counting coercions changes what gets written | Counters are incremented alongside the existing expression; the written value is unchanged |
| `useToast()` in `AccountDetail` | `ToastProvider` wraps `App`, so every view is already inside it |
| Single-delete undo races its own persist deletes | Accepted, pre-existing; identical to the bulk path |
