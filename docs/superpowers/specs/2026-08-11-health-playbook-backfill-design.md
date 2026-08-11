# Health Playbook Backfill — Design

**Date:** 2026-08-11
**Status:** Approved
**Target:** `crm.html` (single-file React + Supabase)

## Problem

The health-band seeder (`crm.html:2501`) only seeds ♥ playbook tasks when an account *crosses* into a worse band. On first run for an account it initializes silently:

```js
if (prev === undefined) {                 // first run: initialize silently
  dispatch({ type: "SEED_HEALTH_PLAYBOOK", id: a.id, healthBand: cur,
    healthPlaybookBand: a.healthPlaybookBand, event: null, items: [] });
  return;
}
```

That silence was deliberate — it stops the feature from retroactively spamming the whole book on the day it ships. But it leaves a permanent hole: an account that was already Red when the feature shipped has no worse band to cross into, so it never gets a playbook. It only ever would if it recovered to Green and then declined again.

This spec adds a one-time, admin-triggered bulk action that seeds playbooks for currently at-risk accounts.

## Decisions

| Question | Decision |
|---|---|
| Where does the action live? | Settings bulk action, next to the health-playbook editor. Settings is already admin-only. |
| Does it write `healthEvents`? | Yes — synthetic events, so backfilled accounts light up the notification bell and the dashboard "Recently declined" card. Tagged `source: "backfill"` so history can distinguish them. |
| Which accounts? | All non-churned accounts currently Yellow or Red, **re-seeding regardless** of whether they already have a playbook. |

### Accepted trade-off on re-seeding

Task ids are `hpb-<acct>-<band>-<date>-<step>`, so re-running on the same day is idempotent (the persistence layer upserts by id). An account seeded on an *earlier* date, however, gets a second live set of ♥ tasks while the first set is still open, and its progress pill denominator grows accordingly. This was raised and accepted. The confirmation preview breaks the candidate count out by never-seeded vs already-seeded so the operator sees it before committing.

## Components

### 1. `backfillCandidates(scored)` — pure helper

```
backfillCandidates(scored) -> Account[]
```

Returns every account where `!a.churn && (a.risk === "Yellow" || a.risk === "Red")`. `a.risk` is the live band derived from the score, the same input the auto-seeder uses. Pure and dependency-free; exported on `window.__health` alongside the existing `BAND_RANK` / `healthPlaybookOf` / `DEFAULT_HEALTH_PLAYBOOK` (`crm.html:2663`) so E2E can assert selection without driving the UI.

### 2. `HealthBackfillCard` — UI

Rendered inside `HealthPlaybookCard`, below the existing Yellow/Red step editors. `HealthPlaybookCard` gains a `scored` prop, threaded `App → Settings → HealthPlaybookCard` (both currently pass only `st` / `dispatch` / `user`).

States:

- **Idle** — count line, e.g. *"12 at-risk accounts — 4 never seeded, 8 already have a playbook (will get a fresh set)"*, plus a `Seed playbooks now` button. Never-seeded means `healthPlaybookBand === undefined`.
- **Zero candidates** — button disabled, line reads *"No at-risk accounts — nothing to seed."*
- **Confirming** — button flips to `Confirm — seed 12 accounts?` with a `Cancel` beside it. Inline confirm, matching the app's existing style; no `window.confirm`.
- **Done** — after dispatching, a transient line: *"Seeded 12 accounts (34 tasks)."* The count line recomputes from live state on the next render.

### 3. Write path

Reuses the existing `SEED_HEALTH_PLAYBOOK` reducer action (`crm.html:412`) — **no new reducer case**. One dispatch per candidate account. Per account:

- `items` — one task per non-blank step of `healthPlaybookOf(st.settings)[a.risk]`, built exactly as the live seeder builds them: id `hpb-${a.id}-${a.risk}-${today}-${s.id}`, `healthPlaybook: true`, `healthBand: a.risk`, `healthFor: today`, `title: "♥ " + s.title`, `due: isoPlus(today, s.dueDays)`, `priority: s.priority`, `status: "Open"`, `owner: a.csm || ""`.
- `healthBand: a.risk`
- `healthPlaybookBand: a.risk`
- `event: { date: today, from: "Green", to: a.risk, source: "backfill" }`

The `source` key is additive. The notification bell and the dashboard "Recently declined" card filter on `BAND_RANK[e.to] > BAND_RANK[e.from] && daysSince(e.date) <= 30` (`crm.html:1232`, `crm.html:2554`) and pick these up unchanged.

### 4. Interaction with the auto-seeder

The auto-seeder effect (`crm.html:2501`) depends on `scored` and re-runs after the backfill dispatches. Because the backfill sets `healthBand` to the account's current band, the effect hits `if (cur === prev) return;` and exits before seeding. No double-seed. This is asserted explicitly in E2E rather than assumed.

`dispatch` is a `useState`-setter wrapper (async state), so the effect observes the new bands only on a subsequent render — the early return still holds on that render.

### 5. Scope

The action always operates on the full book, ignoring the `mine`/`all` scope toggle. Settings is admin-only (view gating at `crm.html:2379` and `crm.html:2634`), consistent with the other bulk controls there.

## Testing

Playwright against the existing E2E harness (copy `crm.html`, swap the Supabase client for the in-memory mock incl. `channel`/`removeChannel` stubs, seed via `window.__seed`, headless Edge via `channel: "msedge"`). Assert against `#root`, not `body`.

Seed a mix: never-seeded Red, never-seeded Yellow, already-seeded Yellow, churned Red, healthy Green.

1. `backfillCandidates` returns exactly the three non-churned Yellow/Red accounts — churned and Green excluded.
2. The count line reports the correct never-seeded vs already-seeded split.
3. `Seed playbooks now` does not write until confirmed; `Cancel` returns to idle with no state change.
4. After confirm, each candidate has one ♥ task per non-blank step of its band's template, owned by its CSM, due `today + dueDays`.
5. The churned and Green accounts have no new tasks and no new `healthEvents`.
6. Each candidate gains exactly one `healthEvent` with `source: "backfill"`, and the dashboard "Recently declined" card lists them.
7. A same-day re-run adds zero net tasks (deterministic ids upsert).
8. The auto-seeder adds nothing on the renders following a backfill.

## Out of scope

- Undo / un-seed. Tasks can be deleted through the existing task UI.
- A per-account seed button (considered, deferred — the bulk action covers the actual problem).
- Any change to the first-run silence in the auto-seeder; it stays as-is.
- Suppressing duplicate ♥ tasks for already-seeded accounts (accepted trade-off above).

## Constraints

All changes to `crm.html` are strictly additive — existing behavior is preserved. Merging to master auto-deploys the live team app, so this ships via PR with E2E green first.
