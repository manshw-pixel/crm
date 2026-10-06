# Health score: recency sub-options and a Value parameter

Date: 2026-10-06 · Status: approved design, awaiting spec review

## Goal

Make the health score more expressive in two ways, without moving anyone's score
until an admin chooses to:

1. **Engagement recency** becomes a weighted blend of per-activity-type recency, one
   sub-option per activity type, each with its own sub-weight and recency window.
2. A new top-level parameter, **Value**, blends three Yes/No sub-options per account:
   case study, approved savings, approved ROI, each with a sub-weight.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| How a recency sub-option gets its score | Automatically, from the date of that type's last activity |
| Which types | All 7 activity types: call, email, QBR, ticket, note, renewal, churn |
| Recency windows | Per type, editable in Settings |
| How Value sub-options are rated | Yes / No per account (Yes = 100, No = 0) |
| Rollout | Value ships at 0% weight; recency sub-options ship switched off |

## Why rollout is staged

Scores feed the health playbook: an account that crosses into Yellow or Red
auto-seeds tasks for its CSM. Two effects would shift every account at once:

- **Value** starts as No/No/No (0) for everyone, so any non-zero weight drops scores.
- **Recency blend** can only be equal to or lower than today's rule. Today uses the
  most recent activity of *any* type. Each per-type score is at most that, so a
  weighted average of them is too. An account with a call yesterday but no QBR for six
  months scores 100 today and less under the blend.

So both ship inert: `weights.value = 0` and `recencyMix.enabled = false`. With both
in that state **every score is identical to today's**, and a test pins this. An
admin turns each on in Settings after seeing an impact preview.

## Data

### Settings (in the existing `settings` row JSON)

```js
weights:    { usage: 30, sentiment: 20, tickets: 15, recency: 20, nps: 15, value: 0 }
recencyMix: {
  enabled: false,
  types: {
    call:    { weight: 25, fullDays: 7,   zeroDays: 60  },
    email:   { weight: 20, fullDays: 7,   zeroDays: 60  },
    QBR:     { weight: 25, fullDays: 90,  zeroDays: 180 },
    note:    { weight: 10, fullDays: 7,   zeroDays: 60  },
    ticket:  { weight: 10, fullDays: 7,   zeroDays: 60  },
    renewal: { weight: 10, fullDays: 365, zeroDays: 730 },
    churn:   { weight: 0,  fullDays: 365, zeroDays: 730 },
  },
}
valueMix:   { caseStudy: 34, savings: 33, roi: 33 }
```

- `weights` stays **flat**: everything that loops over it (sliders, formula, account
  bars) keeps working. Sub-options live in the two new sibling objects, read only by
  scoring and the Settings card.
- `fetchAll` merges saved values over these defaults, as it does for `weights`
  today, and deep-merges `recencyMix.types` per type, so a type added later gets its
  default.
- Churn defaults to weight 0 because a recent churn activity should not raise health.
- New actions: `SET_RECENCY_MIX` and `SET_VALUE_MIX`, each replacing its object, the
  same way `SET_WEIGHTS` works. They are admin-only by the existing settings RLS.

### Per account

`inputs.value = { caseStudy: bool, savings: bool, roi: bool }`, stored inside the
existing `inputs` JSON. No database migration. `clampInputs` coerces it, and missing
or malformed values read as all false.

## Scoring (`scoreComponents`, the single source of truth)

```
typeScore(t) = never happened            -> 0
               daysSince(last t) <= full -> 100
               daysSince(last t) >= zero -> 0
               otherwise                 -> round(100 * (1 - (ds - full) / (zero - full)))

recency = recencyMix.enabled && Σ type weights > 0
          ? round(Σ w_t * typeScore(t) / Σ w_t)
          : today's rule (any activity: 100 within 7d, linear to 0 at 60d)

value   = Σ valueMix weights > 0
          ? round(Σ w_i * (input_i ? 100 : 0) / Σ w_i)
          : 0
```

- `scoreComponents` gains a `settings` argument (`recencyMix`, `valueMix`). All four
  call sites pass `st.settings`.
- It also returns `recencyDetail`, a list of `{ type, score, lastDate }` used by the
  account page breakdown.
- The `fullDays`/`zeroDays` guard: the Settings inputs enforce `zeroDays > fullDays`,
  and scoring treats `zero <= full` as a step function at `full`.
- `healthScore` stays unchanged: it already weights whatever keys `weights` has.
- `WEIGHT_LABELS` and `DEFAULT_WEIGHTS` gain `value`.

## UI

### Settings: Health score weights card

- A Value slider joins the existing five. Effective % is normalised as today.
- **Engagement recency ▸ Sub-options** panel, collapsed by default:
  - an enable switch
  - per type: a sub-weight slider, plus "full within [7] d" and "zero at [60] d"
    number boxes
- **Value ▸ Sub-options** panel: three sub-weight sliders.
- **Impact preview**, shown beside the recency switch and the Value slider. It
  recomputes every account with the candidate settings and compares bands with the
  current ones, for example "Turning this on moves 3 accounts down a band
  (2 → Yellow, 1 → Red)". For Value: "At this weight, 5 accounts would move down a
  band". The preview uses the same `healthScore`, so it cannot disagree with what
  saving would do.
- The formula line at the top of the card includes value.

### Update health form

Three checkboxes under a "Value" heading: "Case study published", "Savings approved
by customer", "ROI approved by customer". Saving writes `inputs.value`, recomputes
the score and logs history like the other inputs.

### Account detail: Health trend card

- A Value bar joins the input bars.
- The Engagement recency row expands (when the mix is enabled) to per-type rows,
  for example "QBR 42 · last 101d ago" or "renewal 0 · never".

### CSV import / export

- New optional columns `caseStudy`, `approvedSavings`, `approvedRoi`.
- **Accepted values:** yes/no, true/false, 1/0 (case-insensitive).
- **Blank:** leaves the stored value unchanged.
- **Anything else:** reported through the existing coercion banner.
- **Export:** writes yes/no.
- When a value changes, the score is recomputed the same way the existing health
  columns already do.

## Testing

**Pure (via `window.__health`):**
- per-type window maths at the boundaries (full, zero, midpoint), a never-happened
  type, and zero ≤ full
- recency blend arithmetic; all-zero sub-weights fall back to today's rule
- **switch off and Value at 0% give exactly today's score for every sample-data
  account** (the safety pin)
- Value blend; missing or malformed `inputs.value` reads as false
- the impact-preview counts match the bands produced by actually applying the
  settings

**UI:**
- the Settings panels render; editing a sub-weight dispatches and persists across
  a reload (stateful mock)
- the enable switch and the preview text
- the Update health checkboxes save `inputs.value` and log history
- the account page shows the Value bar and the per-type breakdown
- CSV round trip of the three columns, plus a bad value reaching the banner

## Out of scope

- auto-enabling the recency mix or giving Value a non-zero default weight
- changing the 70/40 band thresholds or the health playbook rules
- per-account overrides of recency sub-scores
- server-side scoring (the formula stays client-only by design; see the
  supabase-setup.sql note)
