# UX Robustness — Design

**Date:** 2026-08-14
**Branch:** `ux/robustness` (off `80cf0b3`, the PR #16 merge)
**Status:** design approved in chat; awaiting spec review

## Problem

OneVio rates 8.7/10. Gaps 1 and 2 closed today — PR #15 put a falsified test gate in front
of the Pages deploy, PR #16 took the suite to 160 tests and covered every ARR figure the app
reports. Gap 3 is what remains, and it is the only thing between the app and a 9.

Three symptoms, one theme — the app is well-tested but not defensive:

1. **Seven blocking `confirm()` calls.** They read as an internal tool, and they are weak
   protection: a dialog people click through reflexively stops nothing.
2. **No error boundary.** This is one 3,292-line HTML file with no monitoring. A render
   crash is a white screen, and the team would learn about it from a colleague rather than
   a log. There are 18 `catch` blocks, so async failures are handled; render failures are
   not.
3. **`aria-live` used once**, on the toast region, out of 19 `aria-*` attributes total.
   Content that changes without moving focus is silent to a screen reader.

## Scope

In scope: the seven `confirm()` call sites, a per-view error boundary, three `aria-live`
regions, and the `reducer.test.mjs` flake carried over from PR #16.

Out of scope: `retentionStats:1240`, where historical renewal deltas convert using the
account's *current* currency. Fixing it properly means writing a currency field at
`COMPLETE_RENEWAL` time — a data-model change to analytics with nothing to do with dialogs
or error boundaries. It gets its own branch.

## Correction to the stated gap: the two `alert()` calls stay

Earlier ratings counted "7 `confirm()` + 2 `alert()`" as nine defects. On reading them, the
two `alert()` calls are not defects:

```js
// crm.html:266
if (window.__toast) window.__toast({ text, tone: "error" }); else alert(text);
// crm.html:3279
.then(({ data, error }) => error ? (window.__toast?.({...}) ?? alert("Could not load your profile: " + error.message)) : setProfile(data));
```

Both try the toast first and fall back only when the toast provider is not mounted. Line
3279 runs during profile load, *before* `ToastProvider` wraps `App` (3285), so that fallback
is genuinely reachable and is the only error channel during boot. Removing it would be
cosmetic and would lose boot-time error reporting.

**Decision: both stay.** A comment at each site records why, so the next audit does not
re-flag them. The gap is seven items, not nine.

## Principle: reversibility decides the treatment

A confirm dialog is friction spent to prevent loss. Spend it only where loss is real.

- **Reversible, and undo already exists** → do the action, show an Undo toast. No dialog.
- **Irreversible or financially material** → modal confirm dialog.
- **Catastrophic and team-wide** → modal dialog requiring a typed word.

Applied to the seven sites:

| `crm.html` | Action | Treatment | Rationale |
| --- | --- | --- | --- |
| 2293 | Reactivate account | Undo toast | Trivially reversible — re-churn restores it |
| 2298 | Delete account + cascades | Undo toast | **Already shows an Undo toast at 2304.** The confirm is redundant belt-and-braces |
| 961 | Delete document | Confirm dialog | Removes the stored file; no undo path exists |
| 2399 | Mark opportunity Won, book ARR | Confirm dialog | Financially material; reversing needs a manual Adjust ARR |
| 2406 | Stage change on an already-booked Won | Confirm dialog | Informational acknowledgement, not a data guard |
| 2786 | Load sample data over team data | Dialog + type `REPLACE` | Destroys the team's real data |
| 2787 | Clear ALL team data | Dialog + type `DELETE` | The most destructive action in the app |

Net: seven blocking dialogs become **two undo-toasts and five modals, two of them typed**.
Fewer clicks on the paths people take daily; real friction only where loss is permanent.

That line 2298 already pairs a `confirm()` with an Undo toast is the strongest evidence for
this principle — the safer mechanism is already in the codebase, sitting behind a dialog
that adds nothing.

## Architecture

### `<Modal>` — extracted, not written twice

`BulkDialog` (1857-1896) already contains correct modal behavior: focus the first control on
open, trap Tab inside the dialog, and handle Escape in the **capture phase** so it does not
also trigger App's window-level Escape (which would close the dialog *and* navigate back).
That comment at 1894 records a real bug someone already fixed.

Rather than reimplement it, extract the shell into `<Modal>`:

```js
function Modal({ titleId, onClose, children, initialFocusRef })
```

It owns the overlay, `role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}`,
the focus-on-open effect, the Tab trap, and the capture-phase Escape handler.

**`BulkDialog` is refactored onto the same shell.** Two divergent modal implementations in
one file is exactly how the Escape bug reappears in the copy that did not get the fix. The
refactor is protected by four existing a11y tests — focus moves into the dialog on open for
every kind, Tab is trapped, the dialog is labelled, and Escape closes it without closing the
account view.

### `<ConfirmDialog>` — built on `<Modal>`

```js
function ConfirmDialog({ title, body, confirmLabel, tone, typedWord, onConfirm, onClose })
```

`tone` is `"danger"` or `"normal"` and selects the confirm button styling. When `typedWord`
is set, the confirm button stays disabled until the input matches exactly — reusing the
gating pattern already at 1899 (`confirmText === "DELETE"`).

Call sites hold a small piece of state (`const [confirming, setConfirming] = useState(null)`)
and render `<ConfirmDialog>` when it is set, following how `AccountDetail` already manages
its `form` state at 2226.

### `<ViewBoundary>` — per-view, self-clearing

A class component, because `componentDidCatch` has no hook equivalent:

```js
class ViewBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("View crashed:", error, info); }
  render() { ... }
}
```

One instance wraps the whole view switch (3251-3256), keyed on the current view:

```jsx
<ViewBoundary key={view} view={view}>
  {view === "Dashboard" && <Dashboard ... />}
  ...
</ViewBoundary>
```

`key={view}` does the recovery work for free: navigating to another view remounts the
boundary, so the error state clears without any manual reset. The fallback panel names the
failed view, shows `error.message`, and offers a "Try again" that remounts the subtree via a
retry counter in the key.

Nav, header, command palette and toasts live outside the boundary and keep working, so a
crash in Analytics costs one screen rather than the session — which matters when someone is
mid-QBR.

**Known limit, stated rather than papered over:** an error boundary catches render, lifecycle
and constructor errors. It does not catch errors inside event handlers, async callbacks, or
`setTimeout`. Those already route through the 18 `catch` blocks and the error toast. This
closes the white-screen hole, not every hole.

### `aria-live` regions

Three additions, chosen because their content changes without focus moving — the case a
screen reader otherwise misses entirely:

1. **Account list result count** — `aria-live="polite"`, so filtering announces "47 accounts".
2. **Bulk selection count** — `aria-live="polite"`, so checkbox and select-all changes announce.
3. **Import result banner** — `aria-live="polite"`; it currently appears silently after a
   CSV import, including the amber coercion warning added in PR #14.

Not every changing region gets one. Over-announcing is its own accessibility failure, and
the toast region already covers the app's main notification channel.

## The carried-over flake

`reducer.test.mjs`'s "SEED_HEALTH_PLAYBOOK with empty items still records transition" fails
roughly 2 runs in 8. Diagnosed during PR #16: the test dispatches an artificial `Green` band,
but the seeded account *scores* Yellow (its `inputsUpdatedAt` is stale, dragging the recency
input down), so the health auto-seeder fires and overwrites the band, appending a second
event. Measured at 0/50/250ms — only 0ms passes, so that `setTimeout(r, 0)` is load-bearing
and a longer wait fails deterministically. (I raised it to 50ms during PR #16, which broke it
outright, and reverted.)

**Fix:** give the test a fixture that scores Green — fresh `inputsUpdatedAt` and high inputs
— so the auto-seeder agrees with the dispatched band and has nothing to correct. The race
disappears rather than being won more often, and the wait length stops mattering.

This is in scope because the flake can now fail a deploy run: since PR #15, a red suite
blocks the Pages deploy.

## Testing

Existing harness: `launch(seed)` from `tests/health/harness.mjs`, the runner at
`tests/health/run.mjs`, assertions from `framework.mjs`.

- Baseline is **160 passed, 0 failed**. Every task ends green.
- **Never pipe the suite** — its exit code is the CI gate. Redirect to a file instead.
- Register every new test file in `run.mjs`'s hardcoded import list; it does not glob.
- Dispatch-then-read needs `await new Promise(r => setTimeout(r, 50))` inside the same
  `page.evaluate`, because `getState()` returns the last committed render.

New coverage:

| Area | Tests |
| --- | --- |
| `ConfirmDialog` | Focus moves in on open; Tab is trapped; labelled via `aria-labelledby`; Escape closes without closing the account view; confirm fires the action; cancel writes nothing |
| Typed confirmation | Button disabled until the word matches exactly; a near-miss (`delete` vs `DELETE`) stays disabled; clearing the field re-disables |
| Undo toasts | Reactivate shows Undo and restores the churned state; delete-account still restores every cascade (the existing test must keep passing with the confirm removed) |
| `ViewBoundary` | A view that throws renders the fallback with the error text; nav still works; switching view clears the error; "Try again" remounts |
| `aria-live` | The three regions carry `aria-live="polite"` |
| Flake | The reducer test passes across repeated runs |

The `ViewBoundary` test needs a view that throws. A test-only hook — `window.__crashView`
read by a component — would be production code existing solely for tests, so it is ruled
out.

**The test seeds corrupt data instead:** an account whose `renewals` is a string rather than
an array. `renewalOutcomeRows` and `AccountDetail` both call `(a.renewals || []).forEach`,
which throws on a string, and this is the app's real-world failure mode — a malformed row
arriving from Supabase is exactly the scenario the boundary exists for. The test opens the
affected view, asserts the fallback panel renders with the error text, asserts the nav is
still clickable, then navigates away and asserts the error clears.

Verified rather than assumed: `("corrupt" || []).forEach(...)` throws
`TypeError: (v || []).forEach is not a function`, as do a number and a plain object. The
`|| []` guard only catches null and undefined, so any non-array truthy value reaches
`.forEach` and throws. A string seed is what the test uses.

## Success criteria

1. Zero `confirm()` calls remain in `crm.html`; both `alert()` fallbacks remain, each with a
   comment explaining why.
2. One `<Modal>` implementation, used by both `BulkDialog` and `ConfirmDialog`.
3. A render crash in any view leaves nav, header and command palette usable.
4. `aria-live` count goes from 1 to 4.
5. The reducer flake passes 5 consecutive runs.
6. Suite green on msedge and on bundled Chromium (`CRM_TEST_CHANNEL=""`).
