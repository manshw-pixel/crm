# Per-Account ARR History + Audit Trail — Design Spec (2026-07-13)

## Goal

Every ARR change lands in the account's revenue timeline regardless of how it was made, and key business-field changes are recorded (who / when / old → new) and visible on the account page. Time-sensitive: history only accumulates once shipped.

## Context

OneVio CRM, single-file `crm.html` (React-in-Babel + Supabase), all changes strictly additive. Today `COMPLETE_RENEWAL` (→ `renewals[]`), `ADJUST_ARR` incl. won opportunities (→ `arrEvents[]`), and `CHURN_ACCOUNT` (→ `churn`) record entries with `by`. Two paths change ARR **silently**: the account edit form and CSV import (both dispatch plain `EDIT_ACCOUNT`). No record exists of non-ARR field edits.

## Audited fields

`arr`, `renewalDate`, `csm`, `tier`, `contractStatus`, `renewalStage`.

## Audit entry shape

Stored in a new `audit` array on each account (rides inside the account JSON like `renewals`/`arrEvents` — no schema change; sync, export, backup, delete-cascade unchanged):

```js
{ id, date: iso(now), field, from, to, by, source }
```

`source` ∈ `"edit form" | "csv import" | "inline" | "renewal" | "adjustment" | "opportunity" | "churn" | "reactivate"`.

## Reducer-level recording

`EDIT_ACCOUNT` is the choke point. The action gains optional `by` (user name) and `source`; the reducer diffs `action.patch` against the current account for the six audited fields and appends one audit entry per **real** change (strict `!==` after normalizing numbers; no-op patches record nothing). Backward compatible: a dispatch without `by` records `by: "unknown"` — but every existing call site is updated to pass it:

- Account edit form (`source: "edit form"`)
- CSV import row-update path (`source: "csv import"`, `by` = importing user)
- Inline renewal-stage selects on account header and Renewals grid (`source: "inline"`)
- Billing-completed patches change no audited field → naturally record nothing.

The lifecycle actions also append compact audit entries (same shape) so Change history is complete in one place:

- `COMPLETE_RENEWAL` → `field: "arr"` (prevArr → new) if changed, and `field: "renewalDate"` (from → to), `source: "renewal"`.
- `ADJUST_ARR` → `field: "arr"`, `source` = the entry's source (`"adjustment"` or `"opportunity"`).
- `CHURN_ACCOUNT` → `field: "contractStatus"`, from current → "Churned", `source: "churn"`.
- `REACTIVATE_ACCOUNT` → `field: "contractStatus"`, from "Churned" → "Active", `source: "reactivate"`.

## Closing the silent ARR paths

When an `EDIT_ACCOUNT` patch changes `arr`, the reducer additionally appends an `arrEvents` entry:

```js
{ id, date: iso(now), delta: newArr - oldArr, kind: delta > 0 ? "expansion" : "contraction",
  source: "edit" | "import", reason: "ARR edited", note: "", by }
```

so these changes appear in the existing Revenue events timeline and flow into NRR/GRR via the existing `retentionStats` aggregation of `arrEvents`, exactly like manual adjustments today. (`source` `"edit"`/`"import"` distinguishes them from `"adjustment"`/`"opportunity"`.)

## UI

One collapsible **"Change history"** card on the account detail page, below the Revenue events card:

- Newest-first rows: `date · field: from → to · by · source`.
- ARR values formatted with the account currency; dates with `fmtDate`.
- Shows the latest 50 entries with a "Show all (N)" toggle; hidden entirely when `audit` is empty/absent.

No new views, no Supabase schema change.

## Edge cases

- Multi-field edit → one entry per changed field, same timestamp.
- Currency itself is not audited; ARR entries render with the account's current currency.
- `audit` is unbounded — accounts number in the dozens and entries are tiny; revisit only if it ever matters.
- Existing accounts have no `audit` array — all reads use `(a.audit || [])`.

## Out of scope

- Auditing tasks, opportunities, contacts, or settings.
- A global cross-account audit view.
- Editing or deleting audit entries (append-only by construction).

## Testing

Extend the Playwright E2E harness (mocked Supabase, headless Edge):

1. Edit ARR + CSM together via the account form → two audit entries (correct field/from/to/by/source), and the ARR change also appears in Revenue events with `source: "edit"`.
2. No-op save of the edit form → zero new entries.
3. CSV import that updates an existing account's ARR → audit entry + revenue event with `source` `"csv import"` / `"import"` and the importing user's name.
4. Complete renewal → audit entries for `arr` (when changed) and `renewalDate`; Adjust ARR → `arr` entry; churn + reactivate → `contractStatus` entries.
5. Inline renewal-stage change → audit entry with `source: "inline"`.
6. Change history card renders newest-first, collapsible, respects the 50-row cap, absent when no history.
7. NRR/GRR reflects an edit-sourced ARR increase (regression on `retentionStats`).

## Deployment

Branch `feat/arr-audit-trail` → PR via `gh --body-file` → merge to master (auto-deploys). Strictly additive.
