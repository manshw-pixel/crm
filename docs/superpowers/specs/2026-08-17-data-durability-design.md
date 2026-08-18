# Data Durability Design

**Date:** 2026-08-17
**Status:** approved, awaiting implementation plan
**Branch:** `fix/data-durability` (off `master` @ `1867fda`)

## Goal

Close the three defects in OneVio's write path that can lose or silently revert a user's
work. The application's primary job is to be the system of record for revenue data; today
that record can diverge from what the user sees, with no signal.

## The three defects

All three were found by reading the code on 2026-08-17. None has been reproduced at
runtime — the first task of the plan is to make each one fail a test before fixing it.

### D1 — A failed write is silent and unrecoverable

`persist()` (`crm.html:304`) is fire-and-forget. `dispatch` (`crm.html:3199`) reduces state
and then calls `persist` without awaiting it:

```js
const up = (t, item) => sb.from(t).upsert({...}).then(({ error }) => error && dbError(t, error));
```

On failure `dbError` (`crm.html:268`) shows a toast reading *"Your last change may not be
shared — reload to resync"* and stops. Local state keeps the change, the server never
received it, and the user keeps editing a divergent view. There is no retry, no queue, no
rollback, and no offline handling. A brief network blip loses work quietly, and the burden
of noticing falls on the user.

### D2 — Concurrent editors silently clobber each other

Every write upserts the **entire account JSON blob**. `AccountForm` snapshots all ~17
fields into `useState` at mount (`crm.html:1129`) and dispatches them as one patch on
submit.

Sequence: Priya opens the edit form → Dana saves a new ARR → Priya's client refetches (her
*form* state is now stale) → Priya saves → Dana's ARR is reverted. No error is raised, and
the realtime refetch then propagates the reverted value to everyone.

`updated_at` is written on every single upsert and **read nowhere** — a repo-wide grep
returns zero read sites. The column needed to detect this already exists and is already
populated.

### D3 — `replaceAllRemote` empties the database before writing anything

`replaceAllRemote` (`crm.html:371`) deletes every row from all five entity tables in a
loop, then inserts. It is not a transaction. Any failure in between — a dropped
connection, an RLS denial, one bad row in an imported file — leaves the entire team with
an empty database and no backup.

It is reachable from three places: "load sample data", "clear data", and JSON import
(`crm.html:2856-2911`). The import path is the worst, because it validates only
`s.accounts && s.settings` before destroying live data.

## Decisions taken

| Question | Decision |
|---|---|
| Concurrent edits to one account | **Field-level merge** — both edits survive when they touch different fields |
| Append-only arrays (`arrEvents`, `history`) | **Append semantics in the merge**, staying inside the current single-blob schema |
| Write failure | **Retry with backoff plus a visible sync status**; roll back if it finally fails |
| Sequencing vs. the RLS suite | **Verify and merge `test/rls-auth` first**, then build on it |

Rejected, and why: promoting `arrEvents`/`history` to their own tables is structurally the
right answer but requires new tables, policies, realtime wiring and changes to every
reader — too large for the value here. A full offline queue persisted to `localStorage`
was rejected as YAGNI: the realistic failure is a brief blip, not a day offline.

## Architecture

### The pivot: diff rows, don't change forms

The obvious fix for D2 is to make each form compute what actually changed. That means
editing ~15 forms and leaves a permanent trap: any new form that forgets to diff silently
reintroduces clobbering.

Instead the patch is computed **generically**, in the one place that already sees both
versions of the state:

```js
persist(action, next, prev)   // dispatch already holds prev; it simply isn't passed today
```

For each row that changed, `diffRow(prevItem, nextItem)` returns:

- `patch` — scalar and nested-object fields whose values differ
- `appends` — arrays where `next` is exactly `prev` plus new trailing items
- a whole-array set as a fallback, when an array was reordered or had items removed

No form changes at all. It covers every action type automatically, **including appends the
reducer generates internally** — which is where `arrEvents` actually comes from
(`crm.html:404`, `410`, `432`), so a form-level diff would have missed them regardless.

`diffRow` is pure and synchronous.

### `merge_row` — the server-side merge

```sql
merge_row(tbl text, row_id text, patch jsonb, appends jsonb)
```

- `data = data || patch` — jsonb `||` is a shallow merge, which is what field-level
  semantics require
- for each key in `appends`, concatenate onto the existing array, deduped:
  `arrEvents` by element `id` (every entry has one), `history` by whole-element equality
  (those entries are `{ d, s }` with no id — `crm.html:488`)
- sets `updated_at = now()`

Deduping is what makes a retried operation safe to replay: the same append applied twice
collapses to one entry. **Accepted trade-off:** two genuinely distinct `history` snapshots
written the same day with the same score are indistinguishable and collapse to one. That
is a health-score sparkline point, not an audit record, and losing the duplicate changes
nothing a user can see. `arrEvents` — the record that matters — is exempt, because every
entry carries a unique id.

**It must be `security invoker`, not `security definer`.** A definer function here would
run as its owner and bypass every RLS policy the `tests/rls/` suite pins — turning a
durability fix into a privilege-escalation hole. This is the single most important
constraint in this document.

### `replace_all` — the atomic replace

```sql
replace_all(payload jsonb)
```

A PostgreSQL function body runs inside a single transaction, so the deletes and inserts
commit together or not at all. The "empty database, no backup" window closes by
construction rather than by careful ordering. Admin-gated, matching today's behaviour.

### The write queue

`persist` stops calling Supabase directly and enqueues an operation:

```js
{ id, table, rowId, patch, appends, attempts }
```

A single worker drains the queue **serially per row**, so two edits to the same account
cannot land out of order. Failures retry with backoff (~0.5s, 2s, 8s, then give up).

On final failure the local change is **rolled back by refetching**, not by inverting the
reducer. A refetch is unconditionally correct; an undo-patch has to be right about what it
is undoing, and would be a second chance to corrupt the same data.

Status is `saving | saved | error`, surfaced as a small header indicator. This is also the
first honest answer to the observability gap: a persistent error state stays on screen,
where a toast scrolls away.

### Realtime interaction

The existing handler refetches 800ms after any teammate's change (`crm.html:3211`). If it
fires while operations are still queued, it overwrites local state with a server view that
does not yet contain them — the user watches their edit vanish and then reappear.

**The refetch defers while the queue is non-empty.**

## Testing

Three layers, because these defects live in the gap between the two that exist today.

**Unit (pure).** `diffRow` against prev/next fixtures: appends, scalar changes, nested
`inputs`, reorders, removals, and empty diffs. This is where the load-bearing risk sits
(see Risks), so it gets the most cases.

**RLS suite (real Postgres).** The concurrency claims can only be proven against a real
database:

- two clients patch different fields of one account → both survive
- two clients append an `arrEvent` → both entries present, neither duplicated
- a replayed (retried) operation → no duplicate append
- `merge_row` called by a plain user against `settings` → still denied
- `replace_all` given a payload whose *second* table's insert violates a constraint → the
  whole call aborts and every original row is still present (this is the D3 regression
  test; the failure is induced by a deliberately malformed payload, not by killing the
  connection)
- `merge_row` cannot be used to escalate a role

**E2E (mocked).** Sync-indicator transitions, retry, rollback-on-failure, and the deferred
refetch.

## Phasing

Each phase is independently mergeable.

1. **Verify and merge the RLS suite** (`test/rls-auth`, 25 tests, never yet executed). It
   is the safety net for every SQL change below, including the new functions.
2. **`diffRow` + the RPCs**, with the write path switched over. Closes D2.
3. **Queue, retry, and status indicator.** Closes D1.
4. **`replace_all`.** Closes D3.

Phase 4 is the smallest and closes the largest blast radius; it stands alone and may be
pulled forward.

## Risks

**`diffRow` becomes load-bearing for correctness.** If it ever classifies a replacement as
an append, the result is duplicate audit entries — a *new* way to corrupt the trail this
codebase has spent three PRs getting right. Mitigation: it is pure, it is written first,
and it carries the densest test coverage in the change.

**The RPCs widen the security surface.** Two new callable functions reach the database.
Both need explicit policy coverage in `tests/rls/`, and `security invoker` is mandatory.

**`supabase-setup.sql` stops being read-only.** The RLS suite applies it verbatim and pins
its behaviour, so every change here must land with matching test updates rather than by
relaxing an assertion.

## Non-goals

- Offline support beyond brief network blips
- Moving `arrEvents`/`history` into their own tables
- Presence or edit locking
- Splitting `crm.html`
- Error monitoring (a separate gap; the sync indicator only partly addresses it)
