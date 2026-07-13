# Command Palette (Ctrl+K) — Design Spec (2026-07-13)

## Goal

Keyboard-first navigation and quick actions: `Ctrl+K` / `Cmd+K` opens a palette that jumps to any view or account and can open an account with a specific action form already open.

## Context

OneVio CRM, single-file `crm.html` (React-in-Babel + Supabase), strictly additive changes. Existing shortcuts: `1–4` switch views, `/` focuses account search, `Esc` closes account detail / forms. `AccountDetail` opens action forms via local state `setForm("activity" | "task" | "renewal" | "health" | "edit" | …)`. Views: Dashboard, Accounts, Renewals, Settings (Settings admin-only).

## Trigger & overlay

- `Ctrl+K` (or `Cmd+K`) toggles the palette from anywhere, **including inside inputs** (unlike the digit shortcuts). `e.preventDefault()` to suppress the browser's default.
- Centered modal overlay (fixed, dimmed backdrop): a search input (autofocused) + result list.
- `Esc` closes; `↑`/`↓` move selection (wrapping); `Enter` executes the selected result; clicking a result executes it; clicking the backdrop closes.
- Opening resets the query to empty.

## Commands

Merged result list from two sources, filtered by **case-insensitive subsequence match** (query "nrw" matches "Northwind"; empty query matches everything):

1. **Views** — `Go to Dashboard`, `Go to Accounts`, `Go to Renewals`, `Go to Settings`. The Settings entry appears only for `user.role === "admin"` (mirrors the nav).
2. **Accounts** — every account by name (churned included, suffixed `· churned`). Selecting navigates to the account detail page.
3. **Account actions** — when the selected/top account match is unambiguous (it is the highlighted result), its contextual actions render beneath it as selectable child rows:
   - `Log activity` → form `"activity"`
   - `Add task` → form `"task"`
   - `Complete renewal` → form `"renewal"` (hidden when the account is churned)
   - `Update health` → form `"health"`
   - `Edit account` → form `"edit"`
   Selecting one opens the account **with that form already open**.

Ranking: on empty query, views first then accounts alphabetically; otherwise best match first (prefix match beats subsequence; ties alphabetical). List capped at 12 rows (actions of the highlighted account don't count toward the cap).

## Wiring

- New component `CommandPalette({ open, onClose, accounts, user, go })` rendered once in `App`. `go(viewName)` or `go(viewName, accountId, form)` is a thin wrapper over the existing `setView` / `setAcctId`.
- **Open-with-form path:** `App` keeps a `pendingForm` state. The palette calls `openAccount(id, form)`; App stores the form name and passes it to `AccountDetail` as a new optional `initialForm` prop. `AccountDetail` consumes it once in a `useEffect` (calls its existing `setForm`, then signals App to clear `pendingForm`). No behavior change when `initialForm` is absent.
- Palette reads `accounts` from the already-scored list (name + churn flag are enough); no new data or persistence — this feature is UI-only.
- Existing shortcuts (`1–4`, `/`, `Esc`) unchanged; the palette's key handling is scoped to when it is open, except the global Ctrl/Cmd+K opener.

## Edge cases

- No matches → single non-selectable "No results" row.
- Palette open + account deleted concurrently by a teammate → executing a stale account entry falls through to `openAccount(missing-id)`, which already renders nothing/back-safe; acceptable.
- The digit/`/` handlers already ignore keystrokes typed inside inputs; the palette input relies on that (typing "1" in the palette must not switch views — verify since the palette input is an INPUT element, which those handlers skip).

## Out of scope

- Global commands (new account, export, scope toggle) — deferred.
- Recent/frecency ranking, fuzzy scoring beyond subsequence.
- Mobile/touch affordances beyond click.

## Testing

Playwright E2E (mocked Supabase, headless Edge):

1. `Ctrl+K` opens the palette; `Esc` closes it; backdrop click closes it.
2. Empty query lists views first; typing filters (subsequence: "nrw" → Northwind); ↑↓ moves selection; `Enter` on `Go to Renewals` switches views.
3. `Enter` on an account opens its detail page.
4. Selecting `Add task` under an account opens that account with the Add-task form visible; `Complete renewal` absent for a churned account.
5. Typing digits inside the palette input does not switch views.
6. Settings entry present for admin profile (mock user is admin); the role gate is asserted structurally (entry list built from the same role check as the nav).
7. Zero page errors.

## Deployment

Branch `feat/command-palette` → PR via `gh --body-file` → merge to master (auto-deploys). Strictly additive.
