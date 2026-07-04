# Single-File Customer Success CRM — Design Spec

**Date:** 2026-07-04
**Status:** Approved

## Overview

A standalone, local/offline-first Customer Success CRM in one file: `crm.html` at the repo root. It does not touch the existing FastAPI backend or `frontend-internal/`. Double-click to run. No data leaves the browser.

## Tech

- React 18 UMD + ReactDOM UMD + Babel Standalone + Tailwind Play CDN (browser-cached after first load; only library code comes from CDN).
- All app code in one inline `<script type="text/babel">`.
- Charts: hand-rolled inline SVG (sparkline, distribution bar, donut). No chart libraries.

## State & persistence

- Single `useReducer` store: `{accounts, contacts, activities, tasks, opportunities, settings}`.
- Every dispatch autosaves to `localStorage` key `csm-crm-v1`; hydrate on load, falling back to seed data (8 realistic accounts with linked contacts/activities/tasks/opportunities and health history).
- Import JSON (replaces store), Export JSON (download), Reset to seed. Export the currently filtered account list as CSV.

## Entities

- **Account:** id, name, tier (Enterprise/Mid/SMB), arr, industry, csm, startDate, renewalDate, contractStatus, health inputs `{usage, sentiment, tickets, nps}`, `history: [{d, s}]`.
- **Contact:** id, accountId, name, role, email, isChampion, sentiment.
- **Activity:** id, accountId, contactId?, type (call/email/QBR/ticket/note), date, summary.
- **Task:** id, accountId, title, due, priority, status, owner.
- **Opportunity:** id, accountId, type (upsell/cross-sell), value, stage, closeDate.

## Health score

`score = w1·usage + w2·sentiment + w3·ticketScore + w4·recency + w5·npsNorm`

- `ticketScore = 100 − min(openTickets × 10, 100)`
- `recency`: 100 if last activity ≤7 days ago, linearly to 0 at 60 days
- `npsNorm = (nps + 100) / 2`
- Default weights 30/20/15/20/15, editable via Settings sliders; auto-normalized to 100%. Formula displayed live.
- Risk: ≥70 Green, 40–69 Yellow, <40 Red — same thresholds/colors everywhere.

## Views (client-side tabs, instant filtering)

1. **Dashboard** — Total ARR, ARR-at-risk, at-risk count, tasks due this week; renewals due 30/60/90; health distribution; alerts panel.
2. **Accounts** — dense sortable/filterable table (search, tier, risk, CSM, renewal window); health chip + days-to-renewal per row; CSV export; row click → detail.
3. **Account detail** — renewal countdown, risk chip, health trend sparkline, activity timeline, open tasks, contacts (champion/sentiment), opportunities; inline quick actions: log activity, add task, update health inputs.
4. **Renewals** — pipeline grouped by month (next 12) with account cards (ARR, status).
5. **Settings** — weight sliders + live formula; import/export/reset.

## Alerts (computed)

- No activity in 30+ days
- Renewal < 60 days
- Health dropped ≥10 points vs ~30 days ago (from history)

Shown on dashboard and as row badges.

## UX

Dense, small text, chips; `/` focuses search, `1–5` switch views, `Esc` closes forms. Green/yellow/red semantics consistent everywhere.

## Deliverable

`crm.html` runnable as-is, plus a note (in chat and as a comment block in the file) on health-score logic and how to extend it.
