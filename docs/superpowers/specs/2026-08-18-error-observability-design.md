# Error Observability Design

**Date:** 2026-08-18
**Status:** implemented — see docs/superpowers/plans/2026-08-18-error-observability.md
**Branch:** `feat/error-observability` (off `master` @ `3a3ec80`)

## Goal

Make production failures visible to an admin without asking a user to report them.

Today the application has no error reporting of any kind. `ViewBoundary` catches a render
crash, shows a panel and calls `console.error` — into a console nobody is watching.
`dbError` raises a toast that scrolls away. The write queue's give-up path, added the same
day as this spec, marks the header "Not saved" and tells no one else. A user whose work
failed to save is the only person who knows.

This matters more now than it did last week: PR #27 rewrote the entire write path. That
change is well tested, but a rewrite of the code that persists revenue data deserves a way
to find out when it misbehaves in the field.

## Non-goals

- A third-party monitoring service. Rejected below.
- Performance monitoring, traces, or session replay.
- Alerting (email, webhook, push). The admin panel is pull, not push.
- Capturing user actions as breadcrumbs.
- Any change to how errors are *handled*. This spec only adds reporting.

## Decisions taken

| Question | Decision |
|---|---|
| Where errors go | **A table in the existing Supabase project** |
| What is captured | **Crashes, failed writes, failed loads, and retries** |
| Payload detail | **Context, never row data** |
| How it is read | **An admin-only panel in Settings** |
| Volume control | **Fingerprint + occurrence count, 30-day retention** |
| How the client writes | **A `log_error` RPC doing an atomic upsert** |

### Why not Sentry

Richer tooling, and no schema work. Rejected on three grounds. It introduces a vendor to a
project that currently has exactly one. It sends error data off-site, and this app's errors
carry customer names and revenue figures in their messages. And the build step deliberately
eliminated every non-Supabase network request — `dist/crm.html` makes none — so adding a
reporting SaaS would give back a property that took real work to obtain.

The capture layer is a single helper, so replacing the sink later is a contained change.
That is not a reason to build a plugin seam now; it is a reason not to worry about the
choice.

### Why an RPC rather than a client-side read-then-write

Maintaining `count` from the client means reading the current value, adding one, and
writing it back. Two tabs erroring at once both read 5 and both write 6.

That is the exact defect PR #27 spent a day eliminating from `merge_row`, and error
reporting is the worst possible place to reintroduce it: it runs precisely when the
application is already unhealthy, and concurrent failures are correlated rather than
independent — one flaky network breaks every open tab at once. The count is computed inside
the statement, under the lock `on conflict` already takes.

## Architecture

### The table

```sql
public.error_log (
  fingerprint  text primary key,
  level        text not null check (level in ('crash','write_failed','load_failed','retry')),
  message      text not null,
  stack        text,
  context      jsonb not null default '{}'::jsonb,
  user_id      uuid,
  app_version  text,
  user_agent   text,
  count        int  not null default 1,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now()
)
```

`fingerprint` is the primary key, not a surrogate id: identity IS the grouping. It is a
hash of `level`, the message with volatile substrings removed, and the view or table the
error came from — so the same bug collapses to one row whether it fires once or ten
thousand times, and the panel answers "is this getting worse?" by reading `count` rather
than by counting rows.

`context` carries the view, table, action and error code. **It never carries row data** —
no patch contents, no account fields. The application's whole subject matter is customer
revenue; copying it into a second table with different access rules would be a privacy
regression dressed as an improvement. The row id is recorded so a failure can be traced;
the row's values are not.

### `log_error` — the write path

```sql
log_error(fingerprint text, level text, message text, stack text,
          context jsonb, app_version text, user_agent text) returns void
```

- `insert … on conflict (fingerprint) do update set count = error_log.count + 1,
  last_seen = now()`, plus refreshing `message`/`stack`/`context` so the stored copy is the
  most recent occurrence.
- `user_id` is taken from `auth.uid()` inside the function, not from the client. A client
  cannot attribute an error to another user.
- Prunes `last_seen < now() - interval '30 days'` in the same call. Retention costs nothing
  to run here and needs no scheduler, which this project does not have.
- **`security invoker`, never `security definer`** — the same constraint that governs the
  four functions added in PR #27, for the same reason: a definer function bypasses every
  RLS policy the `tests/rls/` suite pins.

### RLS

- **insert**: any authenticated user. Errors happen to non-admins, and a user who cannot
  report is invisible. This is the one deliberately permissive policy here: any signed-in
  user can write rows an admin will read. The alternative — admin-only insert — would blind
  the log to exactly the users most worth hearing from. Accepted knowingly.
- **select**: admins only. Error messages quote application data.
- **update / delete**: no policy at all. The RPC owns every mutation; nothing else may
  edit or remove a record, including its count.

### Capture

One helper, `reportError(level, error, context)`, called from seven places. Five already
exist and currently discard their error:

- `ViewBoundary.componentDidCatch` → `crash`
- `dbError` → `write_failed`
- the write queue's give-up path → `write_failed`
- `refetch`'s catch → `load_failed`
- the write queue's retry branch → `retry`

And two new global hooks, which today catch nothing at all:

- `window.onerror`
- `window.addEventListener("unhandledrejection")`

### The reporter must not become a failure mode

This is the part most likely to go wrong, because a reporter is code that runs when the
application is already broken.

- **Fire-and-forget.** It never blocks a render or a save, and its promise rejection is
  swallowed.
- **Wrapped in its own `try/catch`.** A failure to report is discarded silently. There is
  nowhere better to send it, and surfacing it would replace a real error with a meta-error.
- **It does NOT go through the write queue.** The queue's own failure is one of the things
  it reports; routing it through the queue would mean a failing queue reports its failure
  by enqueuing another operation onto the failing queue.
- **A re-entrancy guard.** While a report is in flight, further reports from inside the
  reporter's own stack are dropped, so an error in reporting cannot report itself.
- **A client-side throttle.** Identical fingerprints are coalesced for a short window before
  sending. Postgres dedupes anyway, but a tight failure loop should not emit thousands of
  requests to do it, particularly since `retry` is a captured level and a flaky connection
  produces them in bursts.

### The viewer

An admin-only card in Settings: recent errors newest-first by `last_seen`, each showing a
level badge, the message, occurrence count, when it was last seen, and an expandable stack.
Non-admins do not see the card — and would see nothing in it anyway, since `select` is
admin-gated.

## Testing

**RLS suite (real Postgres).** The access rules and the counting are the load-bearing
claims, and both need a real database:

- a plain user can insert an error, and cannot select any
- an admin can select
- an anonymous client can neither insert nor select
- reporting the same fingerprint twice yields ONE row with `count = 2`, not two rows
- N concurrent reports of one fingerprint yield `count = N` — the regression test for the
  read-modify-write race this design exists to avoid
- `log_error` stamps `user_id` from `auth.uid()`, ignoring any client-supplied value
- a plain user cannot update or delete a row to erase their own errors

**Health suite (mocked).** The capture wiring and the safety properties:

- a view crash reports once with level `crash`
- the write queue's give-up reports `write_failed`
- a reporter whose RPC rejects does NOT surface an error to the user and does not throw
- the throttle coalesces a burst of identical errors
- reporting never routes through the write queue

## Risks

**The permissive insert policy.** Any authenticated user can write to a table admins read.
A malicious teammate could flood it. Mitigated only by fingerprint collapsing, which turns
a flood into a high count rather than many rows. Accepted: the alternative blinds the log.

**Reporting during a broken state.** The reporter runs when things are already wrong. The
guards above exist for that, and the tests assert them rather than assuming them.

**Error messages may quote application data.** `select` is admin-gated for this reason.
This spec does not attempt to scrub message text, because a scrubber that silently mangles
messages would defeat the purpose; the boundary drawn here is that `context` carries no row
data.

**A new table changes `supabase-setup.sql` again.** The RLS suite applies that file verbatim
on every reset, so a syntax error breaks the whole suite — and the file must be re-run
against the live project before the panel works, as it was for PR #27.
