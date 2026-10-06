# Health score sub-options and Value Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-activity-type recency sub-options (auto-scored from dates, editable sub-weights and windows) and a new Value parameter (three Yes/No sub-options with sub-weights), both shipping inert so no score moves until an admin turns them on.

**Architecture:** Everything lives in the single-file app `crm.html` (React via esbuild transform, no bundler). Scoring stays in one place, `scoreComponents`/`healthScore`, which gain an optional `settings` argument carrying two new sibling objects, `settings.recencyMix` and `settings.valueMix`. `settings.weights` stays flat and gains `value: 0`. Per-account answers live in `inputs.value`. No database migration: the settings row and the accounts are JSON blobs.

**Tech Stack:** React 18 (UMD globals), Tailwind, Supabase JS (mocked in tests), Playwright E2E harness in `tests/health/` (`framework.mjs` `test/assert`, `harness.mjs` `launch`/`launchPersistent`/`seedAccount`).

**Spec:** `docs/superpowers/specs/2026-10-06-health-score-subweights-design.md`

## Global Constraints

- Ship inert: `DEFAULT_WEIGHTS.value = 0` and `recencyMix.enabled = false`. With both in that state every score must equal today's score exactly.
- Recency sub-options: all 7 activity types `call, email, QBR, ticket, note, renewal, churn`.
- Sub-weight defaults: call 25, email 20, QBR 25, note 10, ticket 10, renewal 10, churn 0.
- Window defaults: call/email/note/ticket 7→60 days, QBR 90→180, renewal/churn 365→730.
- Value sub-options and default sub-weights: `caseStudy: 34, savings: 33, roi: 33`.
- Value labels: "Case study published", "Savings approved by customer", "ROI approved by customer".
- CSV columns: `caseStudy`, `approvedSavings`, `approvedRoi`. Accepted: yes/no, true/false, 1/0 (case-insensitive). Blank = unchanged. Anything else = counted and reported in the import banner. Export writes `yes`/`no`.
- `weights` stays flat; sub-options live only in `recencyMix` / `valueMix`.
- Do not change band thresholds (70/40) or health playbook rules.
- Test runs: build first (`node build.mjs`), then `node tests/health/run-one.mjs <file>`. Every new test file must be added to the import list in `tests/health/run.mjs` (it is NOT a glob). Never pipe a test command; redirect to a file instead.
- `window.__store.getState()` returns the last committed render. After a dispatch inside `page.evaluate`, wait `await new Promise(r => setTimeout(r, 50))` before reading.
- `arrUSD` is not stored; pure-function fixtures that need it must set it.

## Review Focus

1. **A settings row saved before this change** (no `value`, no `recencyMix`, no `valueMix`) loads with the defaults and scores exactly as before. Task 1 pins this with a `fetchAll`-path test seeding an old-shape settings row.
2. **An admin types a bad window** in Settings (blank, NaN, negative, or `zeroDays <= fullDays`). Expected: the inputs clamp to whole days ≥ 0, scoring treats `zero <= full` as a step at `full`, and nothing renders NaN. Task 1 tests the scoring side; Task 3 tests the input clamp.
3. **Activities with a future date or an unknown type** (e.g. a legacy `"meeting"`). Expected: a future date counts as 0 days ago (score 100); unknown types are ignored by the mix. Task 1 tests both.
4. **A CSV that sets only one Value column.** Expected: the other two Value answers on that account stay unchanged, not reset to No. Task 4 tests it.
5. **Value weight above 0 while every Value sub-weight is 0.** Expected: Value scores 0 (no division by zero, no NaN score). Task 1 tests it.

---

## File Structure

- Modify `crm.html`, in the scoring block near line 145-180, the `fetchAll` settings merge (~457), the reducer (~695, ~763), `persist` (~566), `UpdateHealthForm` (~1469), CSV export/import (~2239, ~2317-2400, banners ~2290 and ~2965), the account detail Health trend card (~3285), the Settings weights card (~3718-3760), the scored memo (~4417), the Integrations sales template (~2498), and `window.__health` (~4760).
- Create `tests/health/health-mix.test.mjs` for pure scoring and the settings merge (Task 1).
- Create `tests/health/health-mix-ui.test.mjs` for the account form and detail (Task 2) and the Settings card (Task 3).
- Create `tests/health/health-mix-csv.test.mjs` for the CSV round trip (Task 4).
- Modify `tests/health/run.mjs` to register the three files.

---

### Task 1: Scoring core, defaults, settings merge and actions

**Files:**
- Modify: `crm.html` (scoring block ~145-180, `clampInputs` ~150, `fetchAll` ~457, `persist` ~566, reducer ~695 and ~763, scored memo ~4417, sales template ~2498, `window.__health` ~4760)
- Create: `tests/health/health-mix.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Produces (all top-level in `crm.html`, exported on `window.__health`):
  - `DEFAULT_WEIGHTS` gains `value: 0`; `WEIGHT_LABELS.value = "Value"`
  - `ACTIVITY_TYPES = ["call", "email", "QBR", "ticket", "note", "renewal", "churn"]`
  - `DEFAULT_RECENCY_MIX = { enabled: false, types: { call: { weight: 25, fullDays: 7, zeroDays: 60 }, ... } }`
  - `VALUE_ITEMS = [["caseStudy", "Case study published"], ["savings", "Savings approved by customer"], ["roi", "ROI approved by customer"]]`
  - `DEFAULT_VALUE_MIX = { caseStudy: 34, savings: 33, roi: 33 }`
  - `windowScore(daysSince: number|null, fullDays: number, zeroDays: number) -> 0..100`
  - `recencyBreakdown(acct, activities, recencyMix) -> [{ type, weight, score, lastDate }]` (one entry per type in `ACTIVITY_TYPES`)
  - `scoreComponents(acct, activities, settings?) -> { usage, sentiment, tickets, recency, nps, value }`, all numbers 0..100
  - `healthScore(acct, activities, weights, settings?) -> number`
  - `mergeSettings(saved) -> settings` (the `fetchAll` merge, extracted so it can be tested)
  - `inputs.value` shape `{ caseStudy: bool, savings: bool, roi: bool }` via `clampInputs`
  - Reducer actions `SET_RECENCY_MIX { mix }` and `SET_VALUE_MIX { mix }`, persisted like `SET_WEIGHTS`

- [ ] **Step 1: Write the failing tests**

Create `tests/health/health-mix.test.mjs`:

```js
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const empty = `window.__seedRows = { accounts: [], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
async function H() {
  const { page, browser } = await launch(empty);
  await page.waitForFunction(() => window.__health && window.__health.scoreComponents);
  return { page, browser };
}

test("windowScore: full, midpoint, zero, never, future, and a zero<=full step", async () => {
  const { page, browser } = await H();
  try {
    const r = await page.evaluate(() => {
      const w = window.__health.windowScore;
      return [w(0, 7, 60), w(7, 7, 60), w(33.5, 7, 60), w(60, 7, 60), w(90, 7, 60), w(null, 7, 60), w(-5, 7, 60), w(7, 7, 7), w(8, 7, 7), w(3, 10, 5)];
    });
    assert(JSON.stringify(r) === JSON.stringify([100, 100, 50, 0, 0, 0, 100, 100, 0, 100]), "windowScore: " + JSON.stringify(r));
  } finally { await browser.close(); }
});

test("inert defaults reproduce today's score for every sample-data account", async () => {
  const { page, browser } = await H();
  try {
    const bad = await page.evaluate(() => {
      const H = window.__health, d = seedData();
      const settings = H.mergeSettings({});
      const legacy = (a, acts) => { // today's formula, copied verbatim as the reference
        const la = acts.filter(x => x.accountId === a.id).sort((x, y) => y.date.localeCompare(x.date))[0];
        const ds = la ? Math.floor((Date.now() - new Date(la.date)) / 864e5) : 999;
        return ds <= 7 ? 100 : ds >= 60 ? 0 : Math.round(100 * (1 - (ds - 7) / 53));
      };
      return d.accounts.filter(a => {
        const c = H.scoreComponents(a, d.activities, settings);
        return c.recency !== legacy(a, d.activities) || c.value !== 0 ||
          H.healthScore(a, d.activities, settings.weights, settings) !== H.healthScore(a, d.activities, { usage: 30, sentiment: 20, tickets: 15, recency: 20, nps: 15 });
      }).map(a => a.name);
    });
    assert(bad.length === 0, "scores moved with inert settings: " + bad.join(", "));
  } finally { await browser.close(); }
});

test("recency blend uses each type's own window; unknown types are ignored", async () => {
  const { page, browser } = await H();
  try {
    const r = await page.evaluate(({ d0, d120 }) => {
      const H = window.__health;
      const mix = { enabled: true, types: { ...H.mergeSettings({}).recencyMix.types } };
      Object.keys(mix.types).forEach(t => mix.types[t] = { ...mix.types[t], weight: 0 });
      mix.types.call = { weight: 50, fullDays: 7, zeroDays: 60 };
      mix.types.QBR = { weight: 50, fullDays: 90, zeroDays: 180 };
      const a = { id: "x", inputs: {} };
      const acts = [{ accountId: "x", type: "call", date: d0 }, { accountId: "x", type: "QBR", date: d120 }, { accountId: "x", type: "meeting", date: d0 }];
      const settings = { ...H.mergeSettings({}), recencyMix: mix };
      return { rec: H.scoreComponents(a, acts, settings).recency, bd: H.recencyBreakdown(a, acts, mix).filter(b => b.weight > 0).map(b => [b.type, b.score]) };
    }, { d0: day(0), d120: day(-120) });
    // call 100, QBR at 120d in a 90->180 window = 67; blend (100+67)/2 = 84 (rounded)
    assert(r.rec === 84, "blend: " + JSON.stringify(r));
    assert(JSON.stringify(r.bd) === JSON.stringify([["call", 100], ["QBR", 67]]), "breakdown: " + JSON.stringify(r.bd));
  } finally { await browser.close(); }
});

test("enabled mix with every sub-weight 0 falls back to today's rule", async () => {
  const { page, browser } = await H();
  try {
    const r = await page.evaluate(d => {
      const H = window.__health;
      const base = H.mergeSettings({});
      const types = {}; Object.keys(base.recencyMix.types).forEach(t => types[t] = { ...base.recencyMix.types[t], weight: 0 });
      const s = { ...base, recencyMix: { enabled: true, types } };
      return H.scoreComponents({ id: "x", inputs: {} }, [{ accountId: "x", type: "QBR", date: d }], s).recency;
    }, day(-3));
    assert(r === 100, "fallback recency: " + r);
  } finally { await browser.close(); }
});

test("value blends the Yes/No answers; zero sub-weights and malformed input read as 0", async () => {
  const { page, browser } = await H();
  try {
    const r = await page.evaluate(() => {
      const H = window.__health, s = H.mergeSettings({});
      const v = val => H.scoreComponents({ id: "x", inputs: { value: val } }, [], s).value;
      const zero = { ...s, valueMix: { caseStudy: 0, savings: 0, roi: 0 }, weights: { ...s.weights, value: 50 } };
      return [v({ caseStudy: true, savings: true, roi: true }), v({ caseStudy: true }), v(undefined), v("yes"), v({ caseStudy: "yes" }),
        H.scoreComponents({ id: "x", inputs: { value: { caseStudy: true } } }, [], zero).value,
        H.healthScore({ id: "x", inputs: { value: { caseStudy: true } } }, [], zero.weights, zero)];
    });
    assert(r[0] === 100 && r[1] === 34 && r[2] === 0 && r[3] === 0 && r[4] === 0 && r[5] === 0, "value: " + JSON.stringify(r));
    assert(Number.isFinite(r[6]), "score is not finite: " + r[6]);
  } finally { await browser.close(); }
});

test("an old settings row loads with the defaults and per-type deep merge", async () => {
  const { page, browser } = await H();
  try {
    const s = await page.evaluate(() => window.__health.mergeSettings({
      weights: { usage: 30, sentiment: 20, tickets: 15, recency: 20, nps: 15 },
      recencyMix: { enabled: true, types: { call: { weight: 5, fullDays: 3, zeroDays: 30 } } } }));
    assert(s.weights.value === 0, "value weight default missing");
    assert(s.recencyMix.enabled === true && s.recencyMix.types.call.weight === 5, "saved mix lost");
    assert(s.recencyMix.types.QBR.fullDays === 90, "missing type not defaulted");
    assert(s.valueMix.caseStudy === 34, "valueMix default missing");
  } finally { await browser.close(); }
});

test("SET_RECENCY_MIX and SET_VALUE_MIX update settings", async () => {
  const { page, browser } = await launch(`window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`);
  try {
    await page.waitForFunction(() => window.__store);
    const s = await page.evaluate(async () => {
      const st = window.__store.getState().settings;
      window.__store.dispatch({ type: "SET_RECENCY_MIX", mix: { ...st.recencyMix, enabled: true } });
      window.__store.dispatch({ type: "SET_VALUE_MIX", mix: { caseStudy: 1, savings: 0, roi: 0 } });
      await new Promise(r => setTimeout(r, 50));
      const n = window.__store.getState().settings;
      return [n.recencyMix.enabled, n.valueMix.caseStudy];
    });
    assert(s[0] === true && s[1] === 1, "actions did not apply: " + JSON.stringify(s));
  } finally { await browser.close(); }
});
```

Add `import "./health-mix.test.mjs";` to `tests/health/run.mjs` next to the other imports.

- [ ] **Step 2: Run to verify failure**

Run: `node build.mjs; node tests/health/run-one.mjs health-mix.test.mjs > ../hm.txt 2>&1; type ..\hm.txt` (PowerShell) or `cat ../hm.txt` (bash)
Expected: all 7 FAIL (`windowScore`/`mergeSettings` undefined, or timeouts waiting for `__health.scoreComponents`).

- [ ] **Step 3: Implement the scoring core**

In `crm.html`, replace `DEFAULT_WEIGHTS`/`WEIGHT_LABELS` (~145-146) with:

```js
const DEFAULT_WEIGHTS = { usage: 30, sentiment: 20, tickets: 15, recency: 20, nps: 15, value: 0 };
const WEIGHT_LABELS = { usage: "Product usage", sentiment: "Sentiment", tickets: "Support tickets", recency: "Engagement recency", nps: "NPS", value: "Value" };
/* Engagement recency sub-options: one per activity type, each scored from that type's own
   last date against its own window. Ships disabled -- see the rollout note in the spec:
   the blend can only be <= today's any-activity rule, so turning it on moves scores. */
const ACTIVITY_TYPES = ["call", "email", "QBR", "ticket", "note", "renewal", "churn"];
const DEFAULT_RECENCY_MIX = { enabled: false, types: {
  call: { weight: 25, fullDays: 7, zeroDays: 60 }, email: { weight: 20, fullDays: 7, zeroDays: 60 },
  QBR: { weight: 25, fullDays: 90, zeroDays: 180 }, ticket: { weight: 10, fullDays: 7, zeroDays: 60 },
  note: { weight: 10, fullDays: 7, zeroDays: 60 }, renewal: { weight: 10, fullDays: 365, zeroDays: 730 },
  churn: { weight: 0, fullDays: 365, zeroDays: 730 } } };
/* Value: Yes/No per account, blended by sub-weight. Ships at weight 0 (DEFAULT_WEIGHTS.value). */
const VALUE_ITEMS = [["caseStudy", "Case study published"], ["savings", "Savings approved by customer"], ["roi", "ROI approved by customer"]];
const DEFAULT_VALUE_MIX = { caseStudy: 34, savings: 33, roi: 33 };
function mergeSettings(saved) {
  const s = saved || {}, rm = s.recencyMix || {}, types = {};
  ACTIVITY_TYPES.forEach(t => { types[t] = { ...DEFAULT_RECENCY_MIX.types[t], ...((rm.types || {})[t] || {}) }; });
  return { weights: { ...DEFAULT_WEIGHTS, ...(s.weights || {}) },
    recencyMix: { enabled: !!rm.enabled, types }, valueMix: { ...DEFAULT_VALUE_MIX, ...(s.valueMix || {}) } };
}
```

Extend `clampInputs` (~150) so it also normalises `value` (append before `return out;`):

```js
  if (raw && typeof raw.value === "object" && raw.value) {
    out.value = {};
    VALUE_ITEMS.forEach(([k]) => { out.value[k] = raw.value[k] === true; });
  }
```

Replace `scoreComponents` and `healthScore` (~163-179) with:

```js
// Days since a date, floored at 0 so a future-dated activity counts as "today".
const windowScore = (ds, full, zero) => {
  if (ds === null || ds === undefined) return 0;
  const d = Math.max(0, ds);
  if (d <= full) return 100;
  if (zero <= full || d >= zero) return 0;
  return Math.round(100 * (1 - (d - full) / (zero - full)));
};
function recencyBreakdown(acct, activities, recencyMix) {
  const mix = recencyMix || DEFAULT_RECENCY_MIX;
  return ACTIVITY_TYPES.map(type => {
    const c = { ...DEFAULT_RECENCY_MIX.types[type], ...((mix.types || {})[type] || {}) };
    const last = activities.filter(x => x.accountId === acct.id && x.type === type).map(x => x.date).sort().pop() || null;
    return { type, weight: +c.weight || 0, score: windowScore(last ? daysSince(last) : null, +c.fullDays || 0, +c.zeroDays || 0), lastDate: last };
  });
}
function scoreComponents(acct, activities, settings) {
  const la = lastActivityDate(acct.id, activities);
  const ds = la ? daysSince(la) : 999;
  const inp = { ...DEFAULT_INPUTS, ...clampInputs(acct.inputs) }; // tolerate missing/bad stored inputs
  const legacyRecency = ds <= 7 ? 100 : ds >= 60 ? 0 : Math.round(100 * (1 - (ds - 7) / 53));
  const rm = settings && settings.recencyMix;
  let recency = legacyRecency;
  if (rm && rm.enabled) {
    const parts = recencyBreakdown(acct, activities, rm).filter(p => p.weight > 0);
    const tw = parts.reduce((s, p) => s + p.weight, 0);
    if (tw > 0) recency = Math.round(parts.reduce((s, p) => s + p.weight * p.score, 0) / tw);
  }
  const vm = { ...DEFAULT_VALUE_MIX, ...((settings && settings.valueMix) || {}) };
  const vw = VALUE_ITEMS.reduce((s, [k]) => s + (+vm[k] || 0), 0);
  const ans = inp.value || {};
  const value = vw > 0 ? Math.round(VALUE_ITEMS.reduce((s, [k]) => s + (+vm[k] || 0) * (ans[k] === true ? 100 : 0), 0) / vw) : 0;
  return {
    usage: inp.usage,
    sentiment: inp.sentiment,
    tickets: 100 - Math.min(inp.tickets * 10, 100),
    recency,
    nps: Math.round((inp.nps + 100) / 2),
    value,
  };
}
function healthScore(acct, activities, weights, settings) {
  const c = scoreComponents(acct, activities, settings);
  const tw = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  return Math.round(Object.keys(weights).reduce((s, k) => s + (weights[k] / tw) * (c[k] ?? 0), 0));
}
```

Note that `DEFAULT_INPUTS` has no `value`, so `inp.value` is undefined unless stored. That is intended: it reads as all No.

Update the header comment's formula (~46-47) to add `+ w.value*valueScore` and a line `valueScore: sub-weighted Yes/No answers (inputs.value); recency: per-type blend when settings.recencyMix.enabled`.

`fetchAll` settings (~457): replace `weights: { ...DEFAULT_WEIGHTS, ...(saved.weights || {}) },` with `...mergeSettings(saved),`. That spreads `weights`, `recencyMix` and `valueMix`. Also add `recencyMix: mergeSettings({}).recencyMix, valueMix: { ...DEFAULT_VALUE_MIX }` to the `settings` of both `seedData()` (~264) and `emptyData()` (~267), next to `weights`.

Persist (~566): add `case "SET_RECENCY_MIX": case "SET_VALUE_MIX":` to the `SET_WEIGHTS` case list.

Reducer (~763), next to `SET_WEIGHTS`:

```js
    case "SET_RECENCY_MIX": return { ...state, settings: { ...state.settings, recencyMix: action.mix } };
    case "SET_VALUE_MIX": return { ...state, settings: { ...state.settings, valueMix: action.mix } };
```

Pass settings at every scoring call site:
- reducer `UPDATE_INPUTS` (~695): `healthScore(upd, state.activities, state.settings.weights, state.settings)`
- sales template (~2498): `healthScore(a, st.activities, st.settings.weights, st.settings)`
- scored memo (~4417): `healthScore(a, st.activities, st.settings.weights, st.settings)`
- account detail (~3152): `scoreComponents(a, st.activities, st.settings)`

`window.__health` (~4760): add `windowScore, recencyBreakdown, scoreComponents, healthScore, mergeSettings, ACTIVITY_TYPES, VALUE_ITEMS`.

- [ ] **Step 4: Run to verify pass**

Run: `node build.mjs; node tests/health/run-one.mjs health-mix.test.mjs > ../hm.txt 2>&1`, then read `../hm.txt`.
Expected: `7 passed, 0 failed`.

Also run the existing files that score accounts (one at a time, each to its own output file): `reducer.test.mjs`, `settings.test.mjs`, `health-snapshot.test.mjs`, `crossing.test.mjs`, `backfill.test.mjs`, `dashboard.test.mjs`. Expected: all pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/health-mix.test.mjs tests/health/run.mjs
git commit -m "Score recency per activity type and add a Value component (both inert by default)"
```

---

### Task 2: Update health form and account detail breakdown

**Files:**
- Modify: `crm.html` (`UpdateHealthForm` ~1469, account detail Health trend card ~3285-3300)
- Create: `tests/health/health-mix-ui.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: `VALUE_ITEMS`, `recencyBreakdown(acct, activities, recencyMix)`, `scoreComponents(..., settings)`, `clampInputs` with `value`, all from Task 1.
- Produces: DOM hooks `[data-value-check="caseStudy|savings|roi"]` (checkbox inputs in the form), `[data-recency-breakdown]` (container of per-type rows, rendered only when `st.settings.recencyMix.enabled`), and `[data-recency-type="<type>"]` rows.

- [ ] **Step 1: Write the failing tests**

Create `tests/health/health-mix-ui.test.mjs`:

```js
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const seedOf = (accts, acts = [], settings = null) => `window.__seedRows = { accounts: ${rows(accts)}, contacts: [], activities: ${rows(acts)}, tasks: [], opportunities: [], team: [], settings: ${settings ? JSON.stringify([{ id: 1, data: settings }]) : "[]"} };`;
async function openDetail(page, name) {
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length > 0);
  await page.click('button[title="Accounts"]');
  await page.getByText(name).first().click();
  await page.waitForSelector("[data-more-actions]", { timeout: 8000 });
}

test("Update health saves the Value answers and logs a history point", async () => {
  const A = seedAccount({ id: "v1", name: "Value Co" });
  const { page, browser } = await launch(seedOf([A]));
  try {
    await openDetail(page, "Value Co");
    await page.getByRole("button", { name: "✎ Update health" }).click();
    await page.check('[data-value-check="caseStudy"]');
    await page.check('[data-value-check="roi"]');
    await page.getByRole("button", { name: "Save" }).click();
    const a = await page.evaluate(async () => { await new Promise(r => setTimeout(r, 50)); return window.__store.getState().accounts[0]; });
    assert(JSON.stringify(a.inputs.value) === JSON.stringify({ caseStudy: true, savings: false, roi: true }), "value: " + JSON.stringify(a.inputs.value));
    assert((a.history || []).length === 1, "no history point logged");
  } finally { await browser.close(); }
});

test("the account page shows a Value bar, and per-type recency only when the mix is on", async () => {
  const A = seedAccount({ id: "v2", name: "Mix Co" });
  const acts = [{ id: "x1", accountId: "v2", type: "QBR", date: day(-101), summary: "q" }];
  const off = await launch(seedOf([A], acts));
  try {
    await openDetail(off.page, "Mix Co");
    assert(await off.page.locator("[data-input-bar]").count() === 6, "expected 6 input bars incl. Value");
    assert(await off.page.$("[data-recency-breakdown]") === null, "breakdown shown while the mix is off");
  } finally { await off.browser.close(); }
  const on = await launch(seedOf([A], acts, { recencyMix: { enabled: true } }));
  try {
    await openDetail(on.page, "Mix Co");
    await on.page.waitForSelector("[data-recency-breakdown]", { timeout: 5000 });
    const qbr = await on.page.textContent('[data-recency-type="QBR"]');
    assert(/QBR/.test(qbr) && /101d ago/.test(qbr), "QBR row: " + qbr);
    assert(/never/.test(await on.page.textContent('[data-recency-type="renewal"]')), "never-happened type not labelled");
  } finally { await on.browser.close(); }
});
```

Add `import "./health-mix-ui.test.mjs";` to `tests/health/run.mjs`.

- [ ] **Step 2: Run to verify failure**

Run: `node build.mjs; node tests/health/run-one.mjs health-mix-ui.test.mjs > ../hmu.txt 2>&1`, then read the file.
Expected: both FAIL (no `[data-value-check]`, no `[data-recency-breakdown]`).

- [ ] **Step 3: Implement**

`UpdateHealthForm` (~1469): keep `v` as is (it already carries `value` through `clampInputs` when stored). Add a Value block before the Save button and include `value` in the dispatch:

```jsx
      <fieldset className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
        <legend className="mb-1 font-semibold">Value</legend>
        {VALUE_ITEMS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="checkbox" data-value-check={k} checked={!!(v.value || {})[k]}
              onChange={e => setV({ ...v, value: { ...(v.value || {}), [k]: e.target.checked } })} />{label}
          </label>
        ))}
      </fieldset>
```

Change the submit to send a complete value object, so unchecked boxes are stored as `false`:

```js
dispatch({ type: "UPDATE_INPUTS", id: acct.id, inputs: { ...v, value: Object.fromEntries(VALUE_ITEMS.map(([k]) => [k, !!(v.value || {})[k]])) } });
```

Account detail Health trend card (~3292): the input-bar list already maps `Object.keys(comps)`, so `value` appears automatically as a bar labelled "Value". Inside that map, after the row whose key is `recency`, render the breakdown when enabled. Replace the map body with:

```jsx
            {Object.keys(comps).map(k => <React.Fragment key={k}>
              <div className="flex items-center gap-2">
                <span className="w-36 shrink-0">{WEIGHT_LABELS[k]}</span>
                <span data-input-bar className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, comps[k]))}%`, background: comps[k] >= 70 ? RISK_HEX.Green : comps[k] >= 40 ? RISK_HEX.Yellow : RISK_HEX.Red }} /></span>
                <span className="w-8 text-right font-semibold tabular-nums">{comps[k]}</span>
              </div>
              {k === "recency" && st.settings.recencyMix?.enabled && <div data-recency-breakdown className="mb-1 ml-4 space-y-0.5 text-[11px] text-slate-500">
                {recencyBreakdown(a, st.activities, st.settings.recencyMix).filter(b => b.weight > 0).map(b =>
                  <div key={b.type} data-recency-type={b.type} className="flex justify-between">
                    <span>{b.type}</span>
                    <span className="tabular-nums">{b.score} · {b.lastDate ? `last ${daysSince(b.lastDate)}d ago` : "never"}</span>
                  </div>)}
              </div>}
            </React.Fragment>)}
```

**Important:** this adds a sixth `[data-input-bar]`. `tests/health/second-pass.test.mjs` asserts exactly 5. Update that assertion to 6, with a comment `// usage, sentiment, tickets, recency, nps, value`.

- [ ] **Step 4: Run to verify pass**

Run: `node build.mjs; node tests/health/run-one.mjs health-mix-ui.test.mjs > ../hmu.txt 2>&1`, then the same for `second-pass.test.mjs`, `retention-ui.test.mjs` and `contacts.test.mjs`.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/health-mix-ui.test.mjs tests/health/second-pass.test.mjs tests/health/run.mjs
git commit -m "Add Value answers to Update health and a per-type recency breakdown on the account page"
```

---

### Task 3: Settings card (Value slider, sub-option panels, impact preview)

**Files:**
- Modify: `crm.html` (Settings "Health score weights" card ~3750-3765, plus one new top-level pure function next to `healthScore`)
- Modify: `tests/health/health-mix-ui.test.mjs` (append tests)

**Interfaces:**
- Consumes: `mergeSettings`, `healthScore(acct, activities, weights, settings)`, `riskOf`, `BAND_RANK` (existing: `{ Green: 0, Yellow: 1, Red: 2 }`), and the `SET_RECENCY_MIX` / `SET_VALUE_MIX` actions from Task 1.
- Produces:
  - `bandImpact(accounts, activities, fromSettings, toSettings) -> { down: number, toYellow: number, toRed: number }`, exported on `window.__health`. Counts accounts whose band rank rises (gets worse). `accounts` excludes churned (`!a.churn`).
  - DOM hooks:
    - `[data-recency-panel-toggle]`, `[data-recency-panel]`, `[data-recency-enabled]` (checkbox)
    - `[data-sub-weight="<type>"]` (range), `[data-full-days="<type>"]`, `[data-zero-days="<type>"]` (number)
    - `[data-value-panel-toggle]`, `[data-value-panel]`, `[data-value-weight="<key>"]` (range)
    - `[data-impact="recency"]`, `[data-impact="value"]` (preview text)

- [ ] **Step 1: Write the failing tests** (append to `tests/health/health-mix-ui.test.mjs`)

```js
import { launchPersistent } from "./harness.mjs";

test("bandImpact counts accounts that would drop a band", async () => {
  const { page, browser } = await launch(seedOf([seedAccount()]));
  try {
    await page.waitForFunction(() => window.__health && window.__health.bandImpact);
    const r = await page.evaluate(() => {
      const H = window.__health, base = H.mergeSettings({});
      const accts = [{ id: "g", inputs: { usage: 100, sentiment: 100, tickets: 0, nps: 100 } }, { id: "y", inputs: { usage: 75, sentiment: 75, tickets: 0, nps: 40 } }];
      const acts = [{ accountId: "g", type: "call", date: new Date().toISOString().slice(0, 10) }, { accountId: "y", type: "call", date: new Date().toISOString().slice(0, 10) }];
      const heavy = { ...base, weights: { ...base.weights, value: 300 } };
      return H.bandImpact(accts, acts, base, heavy);
    });
    assert(r.down === 2, "impact: " + JSON.stringify(r));
  } finally { await browser.close(); }
});

test("Settings: sub-option panels edit and persist; day boxes clamp; preview shows", async () => {
  const { page, browser, reload } = await launchPersistent(seedOf([seedAccount()]));
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    await page.click('button[title="Settings"]');
    await page.click("[data-recency-panel-toggle]");
    await page.waitForSelector("[data-recency-panel]");
    await page.fill('[data-zero-days="QBR"]', "200");
    await page.fill('[data-full-days="call"]', "-4");
    await page.check("[data-recency-enabled]");
    assert(/account/.test(await page.textContent('[data-impact="recency"]')), "no recency impact text");
    await page.click("[data-value-panel-toggle]");
    await page.locator('[data-value-weight="roi"]').fill("80");
    await page.waitForFunction(() => window.__health.writeQueue.queueState().status === "saved", null, { timeout: 15000 });
    await reload();
    await page.waitForFunction(() => window.__store && window.__store.getState().settings.recencyMix);
    const s = await page.evaluate(() => window.__store.getState().settings);
    assert(s.recencyMix.enabled === true, "enabled not persisted");
    assert(s.recencyMix.types.QBR.zeroDays === 200, "QBR zeroDays not persisted: " + s.recencyMix.types.QBR.zeroDays);
    assert(s.recencyMix.types.call.fullDays === 0, "negative full days not clamped: " + s.recencyMix.types.call.fullDays);
    assert(s.valueMix.roi === 80, "value sub-weight not persisted: " + s.valueMix.roi);
  } finally { await browser.close(); }
});
```

Merge the `launchPersistent` import into the existing import line rather than adding a second one: `import { launch, launchPersistent, seedAccount } from "./harness.mjs";`.

- [ ] **Step 2: Run to verify failure**

Run: `node build.mjs; node tests/health/run-one.mjs health-mix-ui.test.mjs > ../hmu.txt 2>&1`
Expected: the two new tests FAIL (`bandImpact` undefined; `[data-recency-panel-toggle]` missing). The Task 2 tests still pass.

- [ ] **Step 3: Implement**

Pure function, placed after `healthScore`, and added to `window.__health`:

```js
/* How many (non-churned) accounts would drop a band if `to` settings replaced `from`.
   Uses healthScore itself, so the preview cannot disagree with what saving does. */
function bandImpact(accounts, activities, from, to) {
  const out = { down: 0, toYellow: 0, toRed: 0 };
  accounts.filter(a => !a.churn).forEach(a => {
    const b0 = riskOf(healthScore(a, activities, from.weights, from)), b1 = riskOf(healthScore(a, activities, to.weights, to));
    if (BAND_RANK[b1] > BAND_RANK[b0]) { out.down++; if (b1 === "Yellow") out.toYellow++; else out.toRed++; }
  });
  return out;
}
```

Check that `BAND_RANK` is defined before use (it is a top-level `const`; call time is after load, so order does not matter).

In `Settings` (~3718), after `const setW = ...`, add:

```js
  const rmix = st.settings.recencyMix || mergeSettings({}).recencyMix;
  const vmix = st.settings.valueMix || mergeSettings({}).valueMix;
  const [openSub, setOpenSub] = useState({ recency: false, value: false });
  const days = x => Math.max(0, Math.round(+x || 0)); // blank/NaN/negative -> 0
  const setType = (t, patch) => dispatch({ type: "SET_RECENCY_MIX", mix: { ...rmix, types: { ...rmix.types, [t]: { ...rmix.types[t], ...patch } } } });
  const impactText = r => r.down === 0 ? "No account changes band." : `Moves ${r.down} account${r.down > 1 ? "s" : ""} down a band (${r.toYellow} → Yellow, ${r.toRed} → Red).`;
  const recencyImpact = useMemo(() => bandImpact(st.accounts, st.activities,
    { ...st.settings, recencyMix: { ...rmix, enabled: false } }, { ...st.settings, recencyMix: { ...rmix, enabled: true } }), [st]);
  const valueImpact = useMemo(() => bandImpact(st.accounts, st.activities,
    { ...st.settings, weights: { ...w, value: 0 } }, st.settings), [st]);
```

In the weights card, the slider list already maps `Object.keys(w)`, so a Value slider appears. Change that map so each row renders as `<React.Fragment key={k}>` containing the existing row, followed by a panel for `recency` and `value`:

```jsx
            {k === "recency" && <div className="mb-3 ml-4">
              <button data-recency-panel-toggle className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setOpenSub(o => ({ ...o, recency: !o.recency }))}>
                {openSub.recency ? "▾" : "▸"} Sub-options (by activity type)</button>
              {openSub.recency && <div data-recency-panel className="mt-2 space-y-1.5 text-xs">
                <label className="flex items-center gap-2 font-semibold">
                  <input type="checkbox" data-recency-enabled checked={!!rmix.enabled} onChange={e => dispatch({ type: "SET_RECENCY_MIX", mix: { ...rmix, enabled: e.target.checked } })} />
                  Score recency per activity type
                </label>
                <div data-impact="recency" className="text-slate-500">{rmix.enabled ? "On. " : "Turning this on: "}{impactText(recencyImpact)}</div>
                {ACTIVITY_TYPES.map(t => <div key={t} className="flex items-center gap-2">
                  <span className="w-16">{t}</span>
                  <input type="range" min="0" max="100" data-sub-weight={t} value={rmix.types[t].weight} onChange={e => setType(t, { weight: +e.target.value })} className="flex-1" />
                  <span className="w-8 text-right tabular-nums">{rmix.types[t].weight}</span>
                  full ≤<Input type="number" min="0" data-full-days={t} value={rmix.types[t].fullDays} onChange={e => setType(t, { fullDays: days(e.target.value) })} className="!w-16" />d
                  zero ≥<Input type="number" min="0" data-zero-days={t} value={rmix.types[t].zeroDays} onChange={e => setType(t, { zeroDays: days(e.target.value) })} className="!w-16" />d
                </div>)}
              </div>}
            </div>}
            {k === "value" && <div className="mb-3 ml-4">
              <div data-impact="value" className="text-xs text-slate-500">{w.value > 0 ? impactText(valueImpact) : "Weight 0% — Value does not affect scores yet."}</div>
              <button data-value-panel-toggle className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setOpenSub(o => ({ ...o, value: !o.value }))}>
                {openSub.value ? "▾" : "▸"} Sub-options</button>
              {openSub.value && <div data-value-panel className="mt-2 space-y-1.5 text-xs">
                {VALUE_ITEMS.map(([vk, label]) => <div key={vk} className="flex items-center gap-2">
                  <span className="w-48">{label}</span>
                  <input type="range" min="0" max="100" data-value-weight={vk} value={vmix[vk]} onChange={e => dispatch({ type: "SET_VALUE_MIX", mix: { ...vmix, [vk]: +e.target.value } })} className="flex-1" />
                  <span className="w-8 text-right tabular-nums">{vmix[vk]}</span>
                </div>)}
              </div>}
            </div>}
```

Note: Playwright `fill` on a `type=range` input sets its value and fires `input`/`change`; React's `onChange` handles it.

- [ ] **Step 4: Run to verify pass**

Run: `node build.mjs; node tests/health/run-one.mjs health-mix-ui.test.mjs > ../hmu.txt 2>&1`, then `settings.test.mjs` and `page-polish.test.mjs`.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/health-mix-ui.test.mjs
git commit -m "Add recency and Value sub-option panels with a band-impact preview to Settings"
```

---

### Task 4: CSV import and export of the Value answers

**Files:**
- Modify: `crm.html` (`accountsCSVText` ~2239, `importAccountsCSV` ~2317-2400, `importSummary` ~2290, account-list import banner ~2965)
- Create: `tests/health/health-mix-csv.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: `VALUE_ITEMS`, `clampInputs` with `value`, `UPDATE_INPUTS`.
- Produces:
  - CSV columns `caseStudy`, `approvedSavings`, `approvedRoi`, mapping to `inputs.value.caseStudy`, `.savings` and `.roi`
  - The import result gains `badValue: number`, shown in both banners

- [ ] **Step 1: Write the failing tests**

Create `tests/health/health-mix-csv.test.mjs`:

```js
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const A = seedAccount({ id: "c1", name: "Csv Co", accountNo: 7, inputs: { usage: 80, sentiment: 80, tickets: 0, nps: 40, value: { caseStudy: true, savings: true, roi: false } } });
const seed = `window.__seedRows = { accounts: ${rows([A])}, contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
async function importText(page, text) {
  return page.evaluate(async t => {
    const file = new File([t], "a.csv", { type: "text/csv" });
    const res = await new Promise(done => window.__health.importAccountsCSV(file, window.__store.getState().accounts, window.__store.dispatch, done, { name: "T" }));
    await new Promise(r => setTimeout(r, 80));
    return { res, a: window.__store.getState().accounts.find(x => x.name === "Csv Co") };
  }, text);
}

test("export writes the three Value columns as yes/no", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    const csv = await page.evaluate(() => window.__health.accountsCSVText(window.__store.getState().accounts));
    const [head, row] = csv.split("\n");
    const cols = head.split(","), vals = row.split(",").map(v => v.replace(/"/g, ""));
    const at = c => vals[cols.indexOf(c)];
    assert(at("caseStudy") === "yes" && at("approvedSavings") === "yes" && at("approvedRoi") === "no", "export: " + row);
  } finally { await browser.close(); }
});

test("a CSV setting one Value column leaves the other two unchanged", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    const { a } = await importText(page, "accountNo,name,approvedRoi\n7,Csv Co,YES\n");
    assert(JSON.stringify(a.inputs.value) === JSON.stringify({ caseStudy: true, savings: true, roi: true }), "value: " + JSON.stringify(a.inputs.value));
  } finally { await browser.close(); }
});

test("blank leaves a value alone; an unreadable value is counted for the banner", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    const { res, a } = await importText(page, "accountNo,name,caseStudy,approvedSavings\n7,Csv Co,,maybe\n");
    assert(a.inputs.value.caseStudy === true && a.inputs.value.savings === true, "changed: " + JSON.stringify(a.inputs.value));
    assert(res.badValue === 1, "badValue: " + res.badValue);
  } finally { await browser.close(); }
});
```

Add `import "./health-mix-csv.test.mjs";` to `tests/health/run.mjs`.

- [ ] **Step 2: Run to verify failure**

Run: `node build.mjs; node tests/health/run-one.mjs health-mix-csv.test.mjs > ../hmc.txt 2>&1`
Expected: 3 FAIL (`caseStudy` column missing from export; value unchanged after import; `badValue` undefined).

- [ ] **Step 3: Implement**

Export (`accountsCSVText` ~2240): append `"caseStudy", "approvedSavings", "approvedRoi"` to `cols`, and extend `cell` with:

```js
const VALUE_COL = { caseStudy: "caseStudy", approvedSavings: "savings", approvedRoi: "roi" };
// in cell(a, c), before the final `: a[c]`:
  : VALUE_COL[c] ? ((a.inputs && a.inputs.value && a.inputs.value[VALUE_COL[c]]) ? "yes" : "no")
```

Declare `VALUE_COL` at top level just above `accountsCSVText` so import can reuse it.

Import (`importAccountsCSV`): declare `let badValue = 0;` next to `badDate`. After the `inputPatch` line (~2375), add:

The loop variable is named `header`, not `col`, because `col()` is the existing cell helper:

```js
      // Value answers: blank = leave alone, unreadable = count it and leave alone
      const valPatch = {};
      Object.entries(VALUE_COL).forEach(([header, key]) => {
        if (!has(header.toLowerCase())) return;
        const raw = col(r, header.toLowerCase()).trim().toLowerCase();
        if (raw === "") return;
        if (["yes", "true", "1"].includes(raw)) valPatch[key] = true;
        else if (["no", "false", "0"].includes(raw)) valPatch[key] = false;
        else badValue++;
      });
```

Merge into `inputPatch` so the existing `UPDATE_INPUTS` path recomputes and logs history, keeping untouched answers:

```js
      const hasVal = Object.keys(valPatch).length > 0;
```

In the `existing` branch, replace the `UPDATE_INPUTS` line with:

```js
        const patchIn = hasVal ? { ...inputPatch, value: { ...(existing.inputs?.value || {}), ...valPatch } } : inputPatch;
        if (Object.keys(patchIn).length) dispatch({ type: "UPDATE_INPUTS", id: existing.id, inputs: patchIn });
```

In the new-account branch, change `inputs: { ...DEFAULT_INPUTS, ...inputPatch },` to `inputs: { ...DEFAULT_INPUTS, ...inputPatch, ...(hasVal ? { value: valPatch } : {}) },`.

Add `badValue` to the final `done({...})` call.

Banners: in `importSummary` (~2296) add `if (r.badValue) bits.push(\`⚠ ${r.badValue} unreadable Value answer(s) left unchanged (use yes/no)\`);`. In the account-list banner (~2965 and ~2969), add `importMsg.badValue ||` to both condition lists, and inside the bold span:

```jsx
            {importMsg.badValue ? ` ⚠ ${importMsg.badValue} unreadable Value answer(s) left unchanged (use yes/no).` : ""}
```

Add `caseStudy, approvedSavings, approvedRoi` to the banner's "Columns:" list text.

- [ ] **Step 4: Run to verify pass**

Run: `node build.mjs; node tests/health/run-one.mjs health-mix-csv.test.mjs > ../hmc.txt 2>&1`, then `csv.test.mjs` and `csv-dates.test.mjs`.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/health-mix-csv.test.mjs tests/health/run.mjs
git commit -m "Import and export the Value answers in the accounts CSV"
```

---

### Final: full suite via CI

The full local suite exceeds this machine's memory. Push the branch, open a PR against `master`, and let CI run `test` and `rls`. Read the result with `gh pr checks <n>` plus the run log's `N passed, M failed` line, not with a piped `gh run watch`.
