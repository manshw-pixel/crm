# Dark mode — design

Date: 2026-10-07 · Status: approved in conversation, pending written-spec review

## Goal

A comfortable dark theme so the CRM can be used in low light, closing the last open gap in
the rating. Every screen is readable in both themes, dark-mode text meets WCAG AA contrast,
and **light mode is pixel-identical to today**.

## Decisions (from the user)

- **Switching:** follow the device's light/dark setting by default, with a per-person
  **Light / Dark / Auto** override.
- **Storage:** the choice is remembered **on this device only** (browser storage). No
  database or RLS change.

## Scope

In: every app screen — sign-in, password reset/set-new-password, suspended screen, client
console, dashboard (incl. ARR bridge and analytics), accounts list and detail, tasks,
renewals, settings, dialogs, toasts, bell panel, mobile drawer, charts.
Out: alert emails, CSV exports, the favicon (keeps its white tile).

## Approach: central palette remap

The app uses 640 Tailwind colour-class occurrences (53 distinct) over `white` and six
families: `slate, indigo, rose, amber, emerald, sky`. Rather than adding `dark:` variants
everywhere, every shade becomes a CSS variable and dark mode swaps the variable values.

### 1. Colour tokens

- `tailwind.config.js` redefines `white` and each shade of the six families as
  `rgb(var(--<family>-<shade>) / <alpha-value>)`, so opacity modifiers
  (`bg-slate-900/40` etc. — 4 uses) keep working. Variables hold space-separated RGB triplets.
- A new `<style>` block in `crm.html` defines the variables twice:
  - `:root` — Tailwind's stock values, i.e. today's colours exactly.
  - `html.dark` — hand-picked dark values. Neutral (`white`, `slate`) is flipped: `white` and
    `slate-50` are the darkest surfaces, `slate-900` the lightest text. Accent families are
    flipped around their middle: pale tints (`-50…-200`) become deep tints, strong shades
    (`-600…-800`) become light, mid shades (`-300…-500`) are tuned for visibility. Every
    text/background pairing the app uses must reach 4.5:1 (3:1 for large/bold numerals).
- Custom classes `.nm, .nm-sm, .nm-inset, .nm-btn, .grad`, the `body` background and text,
  scrollbars, the focus ring and `accent-color` move from hex to the same variables.
- Chart hex colours in `src/09-charts.jsx` (gridlines, axis labels, hover rule, tooltip box
  and text, sparkline dots) become `var(--…)` references (valid in inline SVG
  `fill`/`stroke`). `RISK_HEX` (green/amber/red mid-tones) is unchanged — legible on both.
- **Fixed tokens for things that must not flip:** modal/drawer overlays
  (`bg-slate-900/30|40`) use a fixed dark scrim token in both themes. A sweep during step 3
  finds any other such case; each gets a named fixed token, never an ad-hoc hex.

### 2. Choosing and applying the theme

- Storage: `localStorage["onevio.theme"]` ∈ `light | dark | auto`; missing, unknown or
  unreadable (blocked storage) ⇒ `auto`. All access wrapped in try/catch.
- **No flash:** an inline script in `crm.html` `<head>` (before any stylesheet paint)
  resolves the theme and sets `class="dark"` on `<html>` synchronously.
- `src/lib/theme.js` (pure, Node-tested): `resolveTheme(choice, systemPrefersDark)` →
  `"light" | "dark"`; `normalizeChoice(raw)` → `light|dark|auto`; the list of choices.
- Browser glue (app file): applies the class; in `auto` listens to
  `matchMedia("(prefers-color-scheme: dark)")` changes; listens to the `storage` event so
  other tabs follow; sets `<meta name="color-scheme">` / `color-scheme` CSS so native form
  controls and scrollbars match, and `<meta name="theme-color">` for the mobile browser bar.
- UI:
  - **Settings → "Appearance" card**: Light / Dark / Auto segmented buttons, current one
    marked (`aria-pressed`).
  - **Sidebar footer** next to Sign out: a sun/moon icon button that flips the *effective*
    theme and stores that explicit choice (Auto is set from Settings). Accessible name
    describes the action ("Switch to dark theme").
  - Sign-in and other pre-app screens: no control; they follow the stored choice / device.

### 3. Rollout (one PR, three verifiable steps)

1. **Tokens only** — palette and custom classes on variables, light values = stock.
   Prove light mode unchanged: screenshot key screens on master and on the branch and
   compare pixel-by-pixel (zero differing pixels expected).
2. **Dark values, no-flash script, switches.**
3. **Dark sweep** of every in-scope screen at desktop and phone width; fix must-not-flip
   cases, contrast misses (adjust the single dark value, not the family), status colours.

### Edge cases

- **Print / PDF:** `@media print` restores the light variable values.
- Storage blocked: Auto works; the toggle works for the session only.
- Rollback for a user: choosing Light returns today's exact rendering (no `dark` class).
- Emails and CSV are unaffected (they never use these styles).

## Testing

**Unit (`tests/unit/theme.test.mjs`):** `resolveTheme` for all 6 choice×device combos;
`normalizeChoice` for missing/unknown values; a **coverage guard** that every
`<family>-<shade>` used in `src/**/*.jsx` has both a light and a dark variable defined.

**E2E (`tests/health/dark-mode.test.mjs`, Chromium):**
- No flash: with `dark` stored, `<html>` has the `dark` class before React mounts.
- Auto follows the emulated `prefers-color-scheme`, including a live change.
- Settings buttons and the sidebar button switch the theme; the choice survives reload;
  a second tab follows via the `storage` event.
- Computed colours (not class names) in dark: page background, a card, body text and a Red
  risk badge have the expected dark values; contrast ≥ 4.5:1 on key text.
- Overlay behind a dialog stays dark in dark mode.
- `emulateMedia({ media: "print" })` renders light values.

**Light unchanged:** all existing E2E tests pass (they run in light) + the step-1 pixel diff.

**Bite proof:** each new test is run against a deliberately broken build (dark block
removed; overlay token flipped; no-flash script removed) and must fail.

**Manual:** screenshots of every main screen in dark, desktop and phone, for the user.

## Non-goals

- Syncing the choice across devices (would need a profiles column + RLS).
- Theming emails, CSV, or the favicon.
- A high-contrast or custom-accent theme.
