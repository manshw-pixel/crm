# Renewal Playbooks — Design Spec (2026-07-13)

## Goal

When an account enters the 90-day renewal window, a standard checklist of renewal tasks is created automatically so no step of the renewal motion is missed. The checklist template is shared and editable by the team.

## Context

OneVio CRM is a single-file React + Supabase app (`crm.html`) deployed to GitHub Pages on master push. Renewal stages (`Not started → Outreach → Quote sent → Negotiating → Committed / At risk`), tasks (`{ id, accountId, title, due, priority, status, owner, details, attachments }`), and a Renewals view with month buckets and 90-day forecast already exist. All changes must be strictly additive.

## Playbook template

New `settings.playbook` array in the shared team settings (synced like weights/rates):

```js
{ id, title, offsetDays, priority }
```

`offsetDays` = days before the renewal date the task is due. Default template shipped in code (used when `settings.playbook` is undefined; never written until first edit):

| offsetDays | title | priority |
|---|---|---|
| 90 | Renewal kickoff call | High |
| 75 | Health & usage review | Medium |
| 60 | Send renewal quote | High |
| 45 | Negotiate terms | High |
| 30 | Confirm commercials | High |
| 14 | Contract out for signature | High |
| 7 | Confirm signature & billing | High |

**Settings editor:** a "Renewal playbook" card in the Settings view — list of items with title / days-before-renewal / priority fields, add row, delete row. Saving dispatches the existing settings-update path so it syncs to the whole team.

## Auto-creation (client-side, idempotent)

There is no backend cron; seeding runs in the app after data loads (and after any dispatch that changes accounts):

For each account where `!acct.churn`, `daysUntil(renewalDate) ≤ 90` (a lower bound is deliberately omitted so accounts already past their renewal date still seed — consistent with the "seed everything including overdue" decision), and `acct.playbookSeededFor !== acct.renewalDate`:

1. Create one task per playbook item:
   - `due = renewalDate − offsetDays` (computed by textual ISO date math via the existing `addDays`-style helpers; compare dates as strings — known UTC pitfall)
   - `owner = acct.csm` (fallback: empty)
   - `title = "▶ " + item.title` (prefix marks playbook tasks visually)
   - `priority = item.priority`, `status = "Open"`, `playbook: true`
2. Stamp the account: `playbookSeededFor = renewalDate` (via `EDIT_ACCOUNT`-style patch action).

**Backfill decision (user chose):** create **all** items, including those whose milestone date has already passed — they appear overdue. This gives a complete record of what was skipped.

**Re-arm:** completing a renewal moves `renewalDate` forward, so the stamp no longer matches and the next cycle seeds automatically when the account re-enters the 90-day window.

**Editing the template mid-cycle** does not retro-create or modify already-seeded tasks; the new template applies to accounts seeded afterwards.

**Concurrency:** seeding goes through the normal reducer + Supabase upsert; two teammates loading simultaneously could in theory double-seed — accepted risk, same exposure as any concurrent edit today.

## UI

1. **Settings** — playbook editor card (above).
2. **Account detail** — playbook tasks are ordinary tasks in the existing Open tasks card: checkable, editable, deletable. No new components.
3. **Renewals view** — each account card in the month grid gets a progress pill `n/m ✓` (completed playbook tasks / total for the current cycle), amber when behind pace (any incomplete playbook task with `due < today`), emerald when on pace, hidden when no playbook tasks exist.

## Out of scope

- Per-tier playbooks (possible later — template is an array; a keyed-by-tier map would be a follow-up).
- Stage-triggered tasks (e.g. extra tasks on "At risk").
- Notifications/digests (excluded by user for the whole product).

## Testing

Extend the Playwright E2E harness (in-memory Supabase mock, `window.__seed`, headless Edge):

1. Account at ~50d to renewal → all 7 default tasks created; ones with milestone before today show overdue; `playbookSeededFor` stamped; reload creates no duplicates.
2. Complete renewal → date moves forward; when the new date is within 90d, a fresh set seeds.
3. Edit playbook in Settings (remove an item, change an offset) → an account entering the window afterwards gets the edited template.
4. Renewals view shows the `n/m ✓` pill and amber behind-pace state.
5. Churned accounts never seed.

## Deployment

Feature branch → PR (`gh`, body via `--body-file`) → merge to master → GitHub Pages auto-deploy. All changes additive; existing features preserved.
