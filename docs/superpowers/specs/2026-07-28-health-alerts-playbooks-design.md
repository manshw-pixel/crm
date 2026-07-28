# Health Alerts & Playbooks — Design Spec

**Date:** 2026-07-28
**File:** `crm.html` (single-file React + Supabase, deploys to GitHub Pages on master push)
**Status:** Approved design, pending implementation plan

## Goal

Layer two additive capabilities on top of the existing health-scoring engine:

1. **Smarter alerts (#2):** detect when an account's health worsens across a risk band and surface it in the notification bell and on a dashboard card (in addition to the existing "Health ↓" flag + sparkline).
2. **Health playbooks (#3):** auto-create a per-band checklist of tasks when an account crosses into a worse band, mirroring the existing renewal-playbook mechanism.

**All changes are strictly additive — no existing behavior changes.**

## Context: what already exists

Health scoring is already fully built in `crm.html`:

- Score engine with tunable weights (usage, sentiment, tickets, engagement recency, NPS) — `DEFAULT_WEIGHTS`, `scoreComponents()`, `healthScore()`, editable in Settings.
- Risk bands via `riskOf(score)`: `>=70` Green, `40..69` Yellow, `<40` Red.
- Health chips, risk filter, health-distribution bar, at-risk list, flags (incl. `Health ↓N` drop detection in `flagsFor`), health-trend sparkline.
- Manual `UpdateHealthForm` writing usage/sentiment/tickets/NPS; `UPDATE_HEALTH` reducer appends `{ d, s }` to `account.history` and sets `inputsUpdatedAt`.
- Renewal playbook pattern to mirror: `DEFAULT_PLAYBOOK`, `playbookOf(settings)`, `SEED_PLAYBOOK` reducer action, dedup via `account.playbookSeededFor`, deterministic ids `pb-<acct>-<renewalDate>-<step>`, and a seeder `useEffect` (~line 2377) that runs over `st.accounts`.

## Core mechanic: band-crossing detection

Scores are computed live (not stored), so detecting a *crossing* requires persisting the last-known band per account. A new seeder `useEffect` runs on account changes (mirroring the renewal seeder):

For each non-churned account, compute the current band from the live score and compare to stored `account.healthBand`:

- **First run / unset (`healthBand === undefined`):** silently initialize `healthBand` to the current band. **No event recorded, no tasks seeded.** This is critical — it prevents retroactively spamming tasks/alerts for accounts already sitting in Yellow/Red when the feature ships.
- **Worsening** (band order Green(0) < Yellow(1) < Red(2); current > stored): record a band-change event `{ date, from, to }` into `account.healthEvents`, update `healthBand`, and if the current band is Yellow or Red **and** worse than `healthPlaybookBand`, seed that band's playbook tasks and set `healthPlaybookBand` to the current band.
- **Improving** (current < stored): record the band-change event, update `healthBand`. If it recovers to **Green**, clear `healthPlaybookBand` (set to undefined) so a subsequent decline re-seeds a fresh playbook.

Band ordering helper: `const BAND_RANK = { Green: 0, Yellow: 1, Red: 2 }`.

Detection uses "today" (`iso(Date.now())`) as the crossing date. ISO date strings are compared textually (never as `Date` objects) to avoid the UTC-vs-local pitfall.

## Data model (additive)

Per account (all optional, default-safe when absent):

- `healthBand` — last-known risk band string (`"Green"|"Yellow"|"Red"`), initialized silently on first eval.
- `healthPlaybookBand` — worst band a playbook was seeded for in the current decline episode; dedup guard; cleared on recovery to Green.
- `healthEvents` — array of `{ date, from, to }` band-change records (declines and recoveries).

In `settings`:

- `healthPlaybook` — `{ Yellow: [step...], Red: [step...] }`. Each step: `{ id, title, priority, dueDays }` where `dueDays` = number of days after the crossing date the task is due. Unset until first edited (like `settings.playbook`), with a `DEFAULT_HEALTH_PLAYBOOK` fallback via a `healthPlaybookOf(settings)` accessor.

`DEFAULT_HEALTH_PLAYBOOK` (sensible starting content, editable):

```
Yellow:
  { id: "hy1", title: "Schedule check-in call with account", dueDays: 3, priority: "Medium" }
  { id: "hy2", title: "Review usage & recent activity for decline drivers", dueDays: 5, priority: "Medium" }
  { id: "hy3", title: "Confirm champion still engaged", dueDays: 7, priority: "Low" }
Red:
  { id: "hr1", title: "Escalate to CSM lead / exec sponsor", dueDays: 1, priority: "High" }
  { id: "hr2", title: "Book save/recovery call with decision maker", dueDays: 2, priority: "High" }
  { id: "hr3", title: "Draft recovery plan & risk summary", dueDays: 5, priority: "High" }
```

`emptyData()` and the state-load merge (`settings` reconstruction ~line 261) carry `healthPlaybook` through like `playbook`/`snapshots`.

## Tasks

Seeded tasks mirror renewal-playbook tasks:

- Deterministic id: `` `hpb-${a.id}-${band}-${crossingDate}-${step.id}` `` — stable (no dupes across re-renders), and band+crossingDate allow a genuine re-decline to seed a fresh set.
- Fields: `accountId`, `healthPlaybook: true`, `healthBand: band`, `healthFor: crossingDate`, `title: "♥ " + step.title`, `due: isoPlus(crossingDate, step.dueDays)` (days *after* crossing; add an `isoPlus` helper if only `isoMinus` exists), `priority`, `status: "Open"`, `owner: a.csm || ""`.
- Only steps with a non-empty `title.trim()` are seeded (matches renewal behavior).

Reducer additions:

- `SET_HEALTH_PLAYBOOK` — sets `settings.healthPlaybook` (persisted like `SET_PLAYBOOK`).
- `SEED_HEALTH_PLAYBOOK` — appends `items` to `tasks`, and patches the target account with `healthBand`, `healthPlaybookBand`, and the appended `healthEvents` entry.
- `SEED_HEALTH_PLAYBOOK` carries an `items` array that may be **empty**: every band transition (worsening that seeds, worsening that doesn't seed because the band is no worse than `healthPlaybookBand`, or an improvement) dispatches this single action, which always patches `healthBand` + appends the `healthEvents` entry + sets `healthPlaybookBand`, and appends `items` only when non-empty. This keeps exactly one persistence path per transition. Add `SEED_HEALTH_PLAYBOOK` and `SET_HEALTH_PLAYBOOK` to the persistence-key `switch` (~line 289) so they sync to Supabase.

## Alert surfaces

### Notification bell
Extend the existing bell notification builder (currently merges account renewals ≤30d + expiring Contract documents ≤60d/expired, with per-user `localStorage` read state keyed `notifRead_<user.name>`):

- Add items for **decline** `healthEvents` (`to` band is worse than `from`) whose `date` is within the last 30 days.
- Each item gets a stable notification id derived from the event (e.g. `health-<acct>-<date>-<to>`) so per-item read state works with the existing mechanism.
- Label e.g. `"<Account> health dropped to <band>"`; clicking marks read and opens the account (same as existing items).

### Dashboard "Recently declined" card
New card on the dashboard listing accounts with a decline `healthEvent` in the last 30 days: account name, `from → to` bands (colored via existing `RISK_STYLE`/`RISK_HEX`), and the date. Empty state when none.

### Flag
No change — the existing `Health ↓N` flag from `flagsFor` stays as-is.

## Settings UI

Below the existing "Renewal playbook" editor in Settings, add a **"Health playbook"** editor:

- Two per-band sections (Yellow, Red), each an editable list of steps with the same add-row / remove-row / edit-field interaction the renewal-playbook editor already uses.
- Each step row edits `title`, `dueDays` (number, days after crossing), and `priority` (High/Medium/Low select).
- Saves via `SET_HEALTH_PLAYBOOK`. Falls back to `DEFAULT_HEALTH_PLAYBOOK` when unset.

## Testing

Playwright E2E harness using the established pattern (copy `crm.html`, replace the Supabase line with an in-memory mock incl. `channel`/`removeChannel` stubs, set `window.__seed = seedData()`, drive headless Edge via `channel: "msedge"`):

1. **First-run initialization:** an account seeded already in Yellow/Red records **no** `healthEvents` and seeds **no** tasks on initial load; `healthBand` is initialized.
2. **Worsening seeds correctly:** push a health-input update dropping an account Green→Yellow; assert one decline `healthEvent`, the Yellow step set seeded with deterministic `hpb-...` ids and `♥`-prefixed titles, `due` = crossing + `dueDays`.
3. **Dedup:** re-render / re-eval does not duplicate tasks or events; staying in the same band re-seeds nothing.
4. **Red escalation:** Yellow→Red seeds the Red set (worse than `healthPlaybookBand`).
5. **Recovery + re-decline:** recovery to Green clears `healthPlaybookBand`; a later decline seeds a fresh set (new crossing date → new ids).
6. **Bell:** a decline event increments the unread bell count; "Mark all read" and click-to-open behave like existing items.

Assert ISO date strings textually.

## Non-goals / out of scope

- Automated data ingestion (the deferred usage/sentiment/NPS feed) — inputs stay manual.
- Changes to the scoring formula, weights, or band thresholds.
- Email/digest notifications (explicitly excluded per project history).
