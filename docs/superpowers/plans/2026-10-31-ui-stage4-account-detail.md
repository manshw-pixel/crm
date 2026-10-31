# UI Refresh Stage 4: Account detail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh subagent per task; review between tasks). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Restyle the Account detail page to the approved Stage 4 preview (light, dark, 390px) with no data, permission or SQL change.

**Architecture:** Presentation-only changes in `src/21-account-detail.jsx` plus `.ad-*` CSS in `crm.html <style id="components">`, built on the existing CSS-variable palette so dark mode follows. Reuses Stage 1–3 atoms: `initialsOf`, `avatarSlot` + `.acct-av[data-av]` palette, `RISK_WORD`, `riskOf`, `FlagPill`/`flagSeverity`, `Btn`, `MoreMenu`. One new small atom, `HealthRing`, goes in `src/10-ui-atoms.jsx`.

**Tech Stack:** React 18 (Babel-in-browser), Tailwind (built), `src/NN-*.jsx` joined by `node build.mjs`; unit tests `node:test`; health tests Playwright (`tests/health/harness.mjs`); QA `tests/qa/run.mjs` live.

**Spec:** Rollout plan `docs/superpowers/plans/2026-10-28-ui-refresh-rollout.md` (Stage 4 row) + approved preview boards `Stage4`, `Stage4Dark`, `Stage4Phone` (canvas row 6, v23) on https://claude.ai/artifact/QpgZxzAadjAd2QqtJd5bNm — copy colours from its `t = dark ? {...} : {...}` table and the `RED/AMB/GRY/GRN` pill tables. Owner approved as-is 2026-10-31.

## Global Constraints

1. Visual only. No reducer action, store shape, Supabase query, RLS or SQL change. Every form, dialog, Undo toast, inline renewal-stage select, opportunity-stage flow (Won confirm) and read-only (`isImplRole`) hiding behaves exactly as today.
2. Page order (preview): `← Accounts` back link → **header card** (56px avatar · h1 name + `#no` · sub line `Tier · Industry · Lead X · Parent <link>` · health ring + word + "Inputs updated Nd ago" · action row) → **4 stat cards** (ARR, Renewal, Licenses [only when `f.total > 0`], CSM) → **profile & status card** (meta line incl. Modules/Support/custom fields · retention row · status pills) → churned banner / sub-accounts / open form (unchanged position) → **tabs** → overview: two columns, left `flex 2` = Activity timeline, Opportunities, Revenue history, Change history; right `flex 1` = Health breakdown, Open tasks, Contacts → Projects card, Documents card (stay below, restyled card shell only).
3. Health is never colour alone: ring has `role="img"` `aria-label="Health N, <RISK_WORD>"` and the word is visible text.
4. Status pills use the preview's severity tables: Billing pending = amber, Billing ✓ = green; Sales → AM / Impl → CSM / Transition not set = grey; QBR overdue = red, QBR due = amber, scheduled/not scheduled = grey; ♥ playbook: done = green, behind = amber, else red (text gains " playbook", e.g. `♥ 2/4 playbook`); flags via `FlagPill` (still excluding `Renewal in…`). Renewal stage select stays a select with the accent-soft pill look and a real `<label>` (visually hidden).
5. Renewal stat: value + icon tile coloured by `flagSeverity(\`Renewal in ${d}d\`)` when `d >= 0` (red <30, amber <60), else default ink; overdue (`d < 0`) = red.
6. Activity rows: 34px icon tile by type (call, email, meeting, qbr, note; anything else = note) with the preview's SVG paths and light/dark tints; type word visible in caps (never icon alone); details + attachments stay under the summary.
7. Revenue history becomes collapsed-by-default like Change history (`Show`/`Hide` button with `aria-expanded`); content unchanged when open.
8. a11y bar from Stage 2: text 4.5:1, icons/focus 3:1, visible focus rings, reduced motion, accessible names on every icon button, forced-colors, 44px touch targets on phone (buttons, tabs, ✎ icon buttons), 200% zoom, print (action row + tabs hidden), long names truncate with `title`.
9. Phone 390px: no page horizontal scroll (`scrollWidth - clientWidth <= 0`); columns stack (right column below left); action row wraps.
10. Keep every existing hook and its text: `data-header-card`, `data-retention-block`, `data-baseline-arr`, `data-current-arr`, `data-change`, `data-ratio`, `data-csm-since-label`, `data-lead-meta`, `data-custom-details`, `data-custom-value`, `data-transition-pill`, `data-csm-handover-pill`, `data-flag`, `data-account-tab`, `data-input-bar`, `data-recency-breakdown`, `data-recency-type`, `data-edit-contact`, `data-delete-contact`, card titles (`Open tasks (N)`, `Contacts (N)`, `Activity timeline (N)`, `Opportunities (N open)`, `Revenue history (N)`, `Change history (N)`), button labels (`+ Log activity`, `+ Add task`, `✎ Update health`, `✓ Complete renewal`, `✎ Edit account`, `↻ Reactivate`), and "Inputs last updated …" wording inside the health card (tests grep it). New hooks: `data-health-ring`, `data-health-word`, `data-stat="arr|renewal|licenses|csm"`, `data-activity-icon="<type>"`, `data-status-pill` + `data-sev` on every status pill.
11. Test rules (memory `onevio-test-suite-gotchas`): register new health files in `tests/health/run.mjs`; build before `run-one.mjs`; redirect output to a file, never a pipe; target `data-*` hooks; prove each new test bites by breaking the code once; run the FULL gate per task, not a subset.
12. Branch `ui-stage4-account-detail`; one commit per task; never commit `supabase-setup.sql` / `.env.qa.example`. Full gate: `npm run test:unit` and `node tests/health/run.mjs > <scratchpad>\health-full.txt 2>&1`.

## Review Focus

1. Churned account: header shows `↻ Reactivate`, no `✓ Complete renewal`, no renewal-stage select, churned banner still shown — tested in Task 1.
2. Implementation / read-only role: no action row, no ✎/🗑 buttons, renewal stage shown as a static pill, only the Overview tab — tested in Task 1.
3. Account with no licenses, no CSM, no lead, no parent, no industry: stat grid has 3 cards with no gap hole, sub line drops empty parts without stray `·` — tested in Task 1.
4. Non-USD account: ARR stat shows local amount and `≈ $X USD` sub line; parent with subs shows `Σ` rollup — tested in Task 1.
5. Very long account name (80 chars) at 390px: name wraps/truncates, no horizontal scroll, ring stays visible — tested in Task 3.

---

### Task 1: Header card, health ring, stat cards, profile & status card

**Files:**
- Modify: `src/10-ui-atoms.jsx` (new `HealthRing`)
- Modify: `src/21-account-detail.jsx:60-186` (title row + header card)
- Modify: `crm.html` `<style id="components">` (`.ad-card`, `.ad-head`, `.ad-ring`, `.ad-stat`, `.ad-pill[data-sev]` light + dark + forced-colors)
- Create: `tests/health/account-detail-stage4.test.mjs`; register in `tests/health/run.mjs`

**Interfaces:**
- Consumes: `initialsOf`, `avatarSlot`, `RISK_WORD`, `riskOf`, `flagSeverity`, `FlagPill`, `licenseFigures`, `accountRetention`, `qbrStatus`, `csmHandovers`.
- Produces: `<HealthRing score={number} size={72} />` → `<div data-health-ring role="img" aria-label="Health N, Word">` with conic-gradient track (green ≥70, amber ≥40, red below — same thresholds as `riskOf`) and the score centred; `.ad-pill[data-sev="red|amber|grey|green"]` CSS class used by Task 2's priority pills too.

- [ ] **Step 1: Failing health tests** (seed: USD parent "Globex" with one sub, INR account, churned account, account with no licenses/CSM/lead/industry; flags across severities; QBR due; playbook episode):
  - `header shows avatar, name, number and sub line` — `[data-header-card] [data-avatar]` = initials; h1 = name; sub line text `Enterprise · Manufacturing · Lead …` with Parent link that opens the parent.
  - `health ring names score and word` — `[data-health-ring]` `aria-label` = `Health ${score}, ${word}`; `[data-health-word]` visible text = word.
  - `stat cards` — `[data-stat]` count 4 for Globex, 3 for the no-licence account; `[data-stat="arr"]` on INR shows `≈` USD line; Globex ARR sub contains `Σ`.
  - `renewal stat severity` — renewal in 20d → `[data-stat="renewal"]` has `data-sev="red"`; 45d → `amber`.
  - `status pills carry severity` — Billing pending `data-sev="amber"`, QBR due `amber`, transition `grey`, `♥ n/m playbook` present.
  - `existing hooks survive` — every hook in Global Constraint 10 for this region resolves.
  - `churned account header` — `↻ Reactivate` visible, no `✓ Complete renewal`, no renewal-stage select.
  - `read-only role header` — log in as implementation fixture: no `+ Log activity`, stage is static pill.
  - `empty profile parts` — sub line of the bare account has no `· ·` and does not start/end with `·`.
  - `dark: text contrast ≥ 4.5` on h1, sub line, stat labels/values, pill text, health word (reuse the contrast helper in `dashboard-stage2.test.mjs`).
- [ ] **Step 2:** `npm run build`, then `node tests/health/run-one.mjs tests/health/account-detail-stage4.test.mjs > <scratchpad>\s4-t1.txt 2>&1` → FAIL.
- [ ] **Step 3:** Implement per preview: back link text `← Accounts` (same `back()` handler, min-height 32px); header card 16px radius, 22px padding, soft shadow; 56px avatar using `.acct-av` palette at 14px radius (`data-av={avatarSlot(a.id)}`); actions row under a divider — primary `+ Log activity`, secondary buttons 40px tall 12px radius, `MoreMenu` trigger labelled `More ▾`. Stat cards: `grid auto-fit minmax(190px,1fr)`, 36px glyph tile (`$`, `R`, `L`, CSM initials). Profile card holds meta line, custom fields, retention row and status pills, separated by hairlines. Move status-pill colour logic into one `statusSev` helper inside the file.
- [ ] **Step 4:** run-one → PASS; break `HealthRing`'s label once to confirm the ring test fails, restore; full gate → green.
- [ ] **Step 5: Commit** `UI Stage 4: account header, health ring, stat and status cards`.

### Task 2: Tabs + two-column overview

**Files:**
- Modify: `src/21-account-detail.jsx:213-385` (tabs, health card, tasks, contacts, activity, opportunities, revenue history, change history)
- Modify: `crm.html` components block (`.ad-tab`, `.ad-act-ico[data-type]`, `.ad-bar`)
- Test: `tests/health/account-detail-stage4.test.mjs`

**Interfaces:**
- Consumes: `.ad-pill[data-sev]` (Task 1), `Sparkline`, `scoreComponents`, `recencyBreakdown`, `initialsOf`.
- Produces: `ACTIVITY_ICON: Record<"call"|"email"|"meeting"|"qbr"|"note", string>` (SVG path data, from the preview's `I` table) in `21-account-detail.jsx`.

- [ ] **Step 1: Failing tests:**
  - `tabs are underline tabs` — `[data-account-tab]` each `min-height ≥ 44`, `aria-selected` toggles, Invoices tab still shows the invoices card.
  - `two columns on desktop` — at 1440 the Health breakdown card's left edge is right of the Activity timeline card's right edge; at 390 it is below.
  - `activity icon by type` — seeded call/email/qbr/unknown-type activities → `[data-activity-icon]` = `call`, `email`, `qbr`, `note`; type word text visible.
  - `health bars keep hooks` — `[data-input-bar]` count unchanged; header text "Inputs last updated" present; recency breakdown still renders when enabled.
  - `task priority pill` — High task pill `data-sev="red"`, Medium `amber`, Low `grey`; overdue due text red.
  - `contacts show avatar and champion word` — champion contact shows `★ Champion` text; edit/delete buttons keep `data-edit-contact`/`data-delete-contact` and aria-labels.
  - `revenue history collapsed by default` — button `aria-expanded="false"`, events hidden; click → events visible.
  - `won opportunity confirm still works` — change stage to Won → ConfirmDialog "Book expansion ARR" appears.
  - `phone icon buttons ≥ 44px` at 390.
- [ ] **Step 2:** build + run-one → FAIL.
- [ ] **Step 3:** Implement per preview: tablist with bottom border, selected tab accent ink + 2px accent underline; overview wrapper `flex flex-wrap gap-4 items-start` with left `flex: 2 1 480px` and right `flex: 1 1 300px` (both `min-w-0`); cards = `.ad-card` with `h2` title + muted count; health card header shows "Health breakdown" with the stale-inputs note on the right (keep "Inputs last updated …" text in the card), sparkline full width, 7px bars coloured by component score; tasks as `<label>` rows with checkbox, owner · due, priority pill; contacts with 32px initials circle, role · email truncated, sentiment word; opportunities restyled (type chip accent-soft, stage select 34px). Revenue history gets the Change-history `Show`/`Hide` pattern.
- [ ] **Step 4:** run-one → PASS; break `ACTIVITY_ICON` fallback once to confirm the unknown-type test fails, restore; full gate → green.
- [ ] **Step 5: Commit** `UI Stage 4: tabs and two-column overview`.

### Task 3: Phone, print, forced-colors, long content + remaining cards

**Files:**
- Modify: `crm.html` components block (`@media (max-width: 640px)`, `@media print`, `@media (forced-colors: active)`, reduced motion for ring)
- Modify: `src/21-account-detail.jsx` (Projects/Documents/sub-accounts/churned banner use `.ad-card` shell only)
- Test: `tests/health/account-detail-stage4.test.mjs`

- [ ] **Step 1: Failing tests:**
  - `390px: no horizontal scroll` for Globex and for an 80-char-name account; ring visible (bounding box inside viewport).
  - `200% zoom (720px viewport at deviceScaleFactor 2): no horizontal scroll`.
  - `print hides actions and tabs` — `page.emulateMedia({ media: "print" })` → action row and tablist `display: none`.
  - `forced-colors: pills and stat tiles have a border` — `emulateMedia({ forcedColors: "active" })` → `.ad-pill` computed border-style `solid`.
  - `focus ring visible` on `+ Log activity`, a tab, and an ✎ button (outline width ≥ 2px).
- [ ] **Step 2:** build + run-one → FAIL.
- [ ] **Step 3:** Implement the media rules; long h1 uses `break-words` and `title`; restyle remaining cards' shells.
- [ ] **Step 4:** run-one → PASS; full gate → green.
- [ ] **Step 5: Commit** `UI Stage 4: phone, print and accessibility polish`.

### Task 4: Live QA scenarios + owner screenshots + PR

**Files:**
- Modify: `tests/qa/features/_accounts.mjs` or the account-detail feature file it serves
- Modify: `tests/health/_shot-account.mjs` (untracked helper)

- [ ] **Step 1:** Add scenarios: `account header shows health ring` (`[data-health-ring]` label matches the score), `status pills carry severity` (on a run-created account with billing pending → `data-sev="amber"`), `revenue history expands`. Follow `onevio-qa-agent` rules (UI only, runId names, `waitForSaved`, `SkipScenario` never a silent pass).
- [ ] **Step 2:** `npm run test:qa-unit` → PASS.
- [ ] **Step 3:** Screenshots light / dark / 390px of the built app with demo data; publish for the owner.
- [ ] **Step 4: Commit** `UI Stage 4: QA scenarios`; push; PR with `--body-file`; after merge + deploy run `/qa-run` and record the result.
