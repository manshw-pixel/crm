# Health Alerts & Playbooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect when an account's health crosses into a worse risk band, seed per-band playbook tasks, and surface the decline in the notification bell and a dashboard card — all additive to the existing health-scoring engine.

**Architecture:** Persist a last-known band per account (`healthBand`); a seeder `useEffect` (mirroring the renewal-playbook seeder at `crm.html:2377`) compares the live band to the stored one, records band-change events, and seeds tasks from editable per-band templates in Settings. Alerts read from the persisted `healthEvents`. First-run silently initializes `healthBand` without seeding, so existing Yellow/Red accounts aren't retroactively spammed.

**Tech Stack:** Single-file React (via Babel in-browser) + Tailwind classes + Supabase in `crm.html`. Tests via a Playwright E2E harness driving headless Edge (`channel: "msedge"`) against a copy of `crm.html` with an in-memory Supabase mock.

## Global Constraints

- All changes are **strictly additive** — no existing behavior, reducer case, or component may change semantics. New reducer cases, helpers, and JSX only.
- Band thresholds and scoring formula are **frozen**: `riskOf(score)` → `>=70` Green, `40..69` Yellow, `<40` Red. Do not modify.
- Band ordering: Green(0) < Yellow(1) < Red(2). "Worse" = higher rank.
- ISO date strings (`YYYY-MM-DD` from `iso()`) are compared **textually**, never as `Date` objects (UTC-vs-local pitfall — has bitten this repo twice).
- The real health-input reducer action is **`UPDATE_INPUTS`** (not `UPDATE_HEALTH`).
- Deterministic task id format: `` `hpb-${accountId}-${band}-${crossingDate}-${stepId}` ``.
- Task title marker for health tasks: `♥ ` prefix (renewal tasks use `▶ `).
- New settings key `healthPlaybook` stays **unset until first edited**, with `DEFAULT_HEALTH_PLAYBOOK` as the fallback via `healthPlaybookOf(settings)`.
- Per-user bell read-state uses the existing `localStorage` key `notifRead_<user.name>` and the existing `notifRead` Set / `markNotifRead` mechanism.
- Deploy: merging to `master` auto-deploys to GitHub Pages. Do not merge until the user says so (they test on localhost first).

---

## Task 1: E2E test harness scaffold

Builds the reusable Playwright harness that later tasks add test cases to. No product code changes.

**Files:**
- Create: `tests/health/harness.mjs` (builds a mocked copy of `crm.html`, exposes helpers)
- Create: `tests/health/run.mjs` (test runner entry; imports harness, runs cases)
- Create: `tests/package.json` (declares `@playwright/test` / `playwright` dep, `"type": "module"`)

**Interfaces:**
- Produces: `buildMockedHtml(seedJs: string): string` — returns `crm.html` with the Supabase line replaced by an in-memory mock and `window.__seed` set. `launch(): Promise<{ page, browser }>` — opens the mocked page in headless Edge and waits for `#root` to render. `seedAccount(overrides): object` — returns a minimal valid account row.

- [ ] **Step 1: Create `tests/package.json`**

```json
{
  "name": "crm-health-tests",
  "private": true,
  "type": "module",
  "devDependencies": { "playwright": "^1.47.0" }
}
```

- [ ] **Step 2: Install Playwright + Edge channel**

Run: `cd tests && npm install && npx playwright install msedge`
Expected: exits 0; `node_modules/playwright` present.

- [ ] **Step 3: Write `tests/health/harness.mjs`**

```js
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const CRM = fileURLToPath(new URL("../../crm.html", import.meta.url));

// In-memory Supabase mock: enough surface for load + write-through + realtime stubs.
const MOCK = `const sb = (() => {
  const tables = {};
  const api = t => ({
    select: async () => ({ data: window.__seedRows?.[t] || [], error: null }),
    upsert: async () => ({ error: null }),
    insert: async () => ({ error: null }),
    delete: () => ({ eq: async () => ({ error: null }), neq: async () => ({ error: null }) }),
  });
  return {
    from: api,
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
    auth: { getUser: async () => ({ data: { user: { email: "t@t.io" } } }), signOut() {}, onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  };
})();`;

export function buildMockedHtml(seedJs) {
  let html = readFileSync(CRM, "utf8");
  // Replace the configured-Supabase constructor line with the mock.
  html = html.replace(/const sb = [^\n]*CONFIGURED[^\n]*\n/, MOCK + "\n");
  // Inject the seed just before the app bootstraps.
  html = html.replace("<body>", `<body><script>${seedJs}</script>`);
  const dir = mkdtempSync(join(tmpdir(), "crm-health-"));
  const file = join(dir, "crm.html");
  writeFileSync(file, html);
  return "file://" + file.replace(/\\\\/g, "/");
}

export function seedAccount(o = {}) {
  return {
    id: o.id || "t1", name: o.name || "Test Co", tier: "Mid", arr: 100000, currency: "USD",
    industry: "Tech", csm: o.csm || "Priya", startDate: "2025-01-01", renewalDate: "2027-01-01",
    contractStatus: "Active", inputs: o.inputs || { usage: 80, sentiment: 80, tickets: 0, nps: 40 },
    history: o.history || [], inputsUpdatedAt: "2026-07-01",
    ...(o.healthBand !== undefined ? { healthBand: o.healthBand } : {}),
    ...o,
  };
}

export async function launch(seedJs) {
  const url = buildMockedHtml(seedJs);
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForSelector("#root", { timeout: 15000 });
  return { page, browser };
}
```

- [ ] **Step 4: Write `tests/health/run.mjs` runner skeleton**

```js
// Minimal assert-based runner; later tasks push cases into CASES.
export const CASES = [];
export function test(name, fn) { CASES.push({ name, fn }); }
export function assert(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }

// Import test files (added by later tasks) here:
// import "./crossing.test.mjs";

if (import.meta.url === `file://${process.argv[1].replace(/\\\\/g, "/")}`) {
  let pass = 0, fail = 0;
  for (const c of CASES) {
    try { await c.fn(); console.log("PASS", c.name); pass++; }
    catch (e) { console.error("FAIL", c.name, "\\n ", e.message); fail++; }
  }
  console.log(`\\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
```

- [ ] **Step 5: Smoke-test the harness**

Create `tests/health/smoke.test.mjs`:

```js
import { launch, seedAccount } from "./harness.mjs";
import { test, assert } from "./run.mjs";

test("app renders with seeded account", async () => {
  const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
  const { page, browser } = await launch(seed);
  const txt = await page.textContent("body");
  assert(/Test Co/.test(txt), "seeded account name should appear");
  await browser.close();
});
```

Add `import "./smoke.test.mjs";` to `run.mjs`, then run: `cd tests && node health/run.mjs`
Expected: `PASS app renders with seeded account`, `1 passed, 0 failed`.

> NOTE: If the `const sb =` replacement regex in Step 3 doesn't match, open `crm.html`, find the actual Supabase-init line, and adjust the regex to match it exactly. This is the one harness detail that depends on the current file.

- [ ] **Step 6: Commit**

```bash
git add tests/
git commit -m "test: e2e harness scaffold for health alerts"
```

---

## Task 2: Constants, helpers, and default templates

Pure additions near the existing health-score constants (`crm.html:97-159`) and date helpers (`crm.html:70-74`).

**Files:**
- Modify: `crm.html` (add after `isoMinus` at line 74; add near `DEFAULT_PLAYBOOK`/`playbookOf` at lines 410-419)
- Test: `tests/health/helpers.test.mjs`

**Interfaces:**
- Produces:
  - `isoPlus(dateStr, days) => string` — `iso(new Date(dateStr).getTime() + days*DAY)`.
  - `BAND_RANK = { Green: 0, Yellow: 1, Red: 2 }`.
  - `DEFAULT_HEALTH_PLAYBOOK = { Yellow: [...], Red: [...] }` — each step `{ id, title, dueDays, priority }`.
  - `healthPlaybookOf(settings) => { Yellow: [...], Red: [...] }` — returns `settings.healthPlaybook || DEFAULT_HEALTH_PLAYBOOK`.
  - A test hook `window.__health = { isoPlus, BAND_RANK, healthPlaybookOf, DEFAULT_HEALTH_PLAYBOOK }` (additive, harmless) so pure logic is unit-testable via `page.evaluate`.

- [ ] **Step 1: Write the failing test** — `tests/health/helpers.test.mjs`

```js
import { launch, seedAccount } from "./harness.mjs";
import { test, assert } from "./run.mjs";

const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("isoPlus adds days textually", async () => {
  const { page, browser } = await launch(seed);
  const r = await page.evaluate(() => window.__health.isoPlus("2026-07-28", 5));
  assert(r === "2026-08-02", `expected 2026-08-02, got ${r}`);
  await browser.close();
});

test("BAND_RANK orders bands", async () => {
  const { page, browser } = await launch(seed);
  const ranks = await page.evaluate(() => window.__health.BAND_RANK);
  assert(ranks.Green === 0 && ranks.Yellow === 1 && ranks.Red === 2, "band ranks wrong");
  await browser.close();
});

test("healthPlaybookOf falls back to default with Yellow+Red lists", async () => {
  const { page, browser } = await launch(seed);
  const pb = await page.evaluate(() => window.__health.healthPlaybookOf({}));
  assert(Array.isArray(pb.Yellow) && pb.Yellow.length > 0, "Yellow default missing");
  assert(Array.isArray(pb.Red) && pb.Red.length > 0, "Red default missing");
  await browser.close();
});
```

Add `import "./helpers.test.mjs";` to `run.mjs`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests && node health/run.mjs`
Expected: the three `helpers.test.mjs` cases FAIL (`window.__health` is undefined).

- [ ] **Step 3: Add `isoPlus` after line 74**

```js
const isoPlus = (dateStr, days) => iso(new Date(dateStr).getTime() + days * DAY);
```

- [ ] **Step 4: Add band constants + templates near line 419 (after `playbookOf`)**

```js
const BAND_RANK = { Green: 0, Yellow: 1, Red: 2 };
const DEFAULT_HEALTH_PLAYBOOK = {
  Yellow: [
    { id: "hy1", title: "Schedule check-in call with account", dueDays: 3, priority: "Medium" },
    { id: "hy2", title: "Review usage & recent activity for decline drivers", dueDays: 5, priority: "Medium" },
    { id: "hy3", title: "Confirm champion still engaged", dueDays: 7, priority: "Low" },
  ],
  Red: [
    { id: "hr1", title: "Escalate to CSM lead / exec sponsor", dueDays: 1, priority: "High" },
    { id: "hr2", title: "Book save/recovery call with decision maker", dueDays: 2, priority: "High" },
    { id: "hr3", title: "Draft recovery plan & risk summary", dueDays: 5, priority: "High" },
  ],
};
const healthPlaybookOf = settings => settings.healthPlaybook || DEFAULT_HEALTH_PLAYBOOK;
```

- [ ] **Step 5: Add the test hook** — find the top-level app render/bootstrap (search for `ReactDOM` in `crm.html`) and add, just before it, at module top level:

```js
window.__health = { isoPlus, BAND_RANK, healthPlaybookOf, DEFAULT_HEALTH_PLAYBOOK };
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd tests && node health/run.mjs`
Expected: the three `helpers.test.mjs` cases PASS.

- [ ] **Step 7: Commit**

```bash
git add crm.html tests/health/helpers.test.mjs tests/health/run.mjs
git commit -m "feat: health-band constants, isoPlus, default health playbook"
```

---

## Task 3: Reducer actions + persistence + state-load merge

Adds `SET_HEALTH_PLAYBOOK` and `SEED_HEALTH_PLAYBOOK` (the latter carries a possibly-empty `items` array and always records the band transition).

**Files:**
- Modify: `crm.html` reducer (after `SEED_PLAYBOOK` case ~line 402)
- Modify: `crm.html` persist switch (`SET_*` case ~line 289; `SEED_PLAYBOOK` case ~line 277)
- Modify: `crm.html` state-load `settings` object (~line 261)
- Test: `tests/health/reducer.test.mjs`

**Interfaces:**
- Consumes: `BAND_RANK`, `healthPlaybookOf` (Task 2).
- Produces:
  - Action `{ type: "SET_HEALTH_PLAYBOOK", healthPlaybook }` → sets `settings.healthPlaybook`.
  - Action `{ type: "SEED_HEALTH_PLAYBOOK", id, healthBand, healthPlaybookBand, event, items }` → appends `items` (may be `[]`) to `tasks`; patches account `id` with `healthBand`, `healthPlaybookBand`, and appends `event` to `healthEvents`. `event` is `{ date, from, to }`; `healthPlaybookBand` may be `undefined` (cleared on recovery).

- [ ] **Step 1: Write the failing test** — `tests/health/reducer.test.mjs`

```js
import { launch, seedAccount } from "./harness.mjs";
import { test, assert } from "./run.mjs";

// Drives the reducer through the app by exposing dispatch on window (added in Step 4).
const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("SEED_HEALTH_PLAYBOOK records event, band, and tasks", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length);
  const res = await page.evaluate(() => {
    window.__store.dispatch({ type: "SEED_HEALTH_PLAYBOOK", id: "t1",
      healthBand: "Yellow", healthPlaybookBand: "Yellow",
      event: { date: "2026-07-28", from: "Green", to: "Yellow" },
      items: [{ id: "hpb-t1-Yellow-2026-07-28-hy1", accountId: "t1", healthPlaybook: true, title: "♥ x", status: "Open" }] });
    const a = window.__store.getState().accounts.find(x => x.id === "t1");
    return { band: a.healthBand, pbBand: a.healthPlaybookBand, events: a.healthEvents,
      taskCount: window.__store.getState().tasks.filter(t => t.healthPlaybook).length };
  });
  assert(res.band === "Yellow", "healthBand not set");
  assert(res.pbBand === "Yellow", "healthPlaybookBand not set");
  assert(res.events.length === 1 && res.events[0].to === "Yellow", "event not recorded");
  assert(res.taskCount === 1, "task not appended");
  await browser.close();
});

test("SEED_HEALTH_PLAYBOOK with empty items still records transition", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length);
  const res = await page.evaluate(() => {
    window.__store.dispatch({ type: "SEED_HEALTH_PLAYBOOK", id: "t1",
      healthBand: "Green", healthPlaybookBand: undefined,
      event: { date: "2026-07-29", from: "Yellow", to: "Green" }, items: [] });
    const a = window.__store.getState().accounts.find(x => x.id === "t1");
    return { band: a.healthBand, pbBand: a.healthPlaybookBand, events: a.healthEvents.length,
      tasks: window.__store.getState().tasks.filter(t => t.healthPlaybook).length };
  });
  assert(res.band === "Green", "band not updated");
  assert(res.pbBand === undefined, "pbBand should be cleared");
  assert(res.events === 1 && res.tasks === 0, "empty-items transition mishandled");
  await browser.close();
});
```

Add `import "./reducer.test.mjs";` to `run.mjs`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests && node health/run.mjs`
Expected: both `reducer.test.mjs` cases FAIL (`window.__store` undefined / action unhandled).

- [ ] **Step 3: Add reducer cases after the `SEED_PLAYBOOK` case (~line 402)**

```js
    case "SET_HEALTH_PLAYBOOK": return { ...state, settings: { ...state.settings, healthPlaybook: action.healthPlaybook } };
    case "SEED_HEALTH_PLAYBOOK": return { ...state,
      tasks: [...state.tasks, ...action.items],
      accounts: state.accounts.map(a => a.id === action.id
        ? { ...a, healthBand: action.healthBand, healthPlaybookBand: action.healthPlaybookBand,
            healthEvents: [...(a.healthEvents || []), action.event] }
        : a) };
```

- [ ] **Step 4: Expose the store for tests** — find the `useReducer` call in the App component (search `useReducer(`). After it, add (additive, test-only hook):

```js
  useEffect(() => { window.__store = { getState: () => st, dispatch }; });
```

(Place inside the App component where `st` and `dispatch` are in scope. If a `st`/`state` name differs, use the actual reducer state variable.)

- [ ] **Step 5: Add persistence** — in `persist()` (~line 289) extend the settings `case` line:

```js
    case "SET_WEIGHTS": case "SET_RATES": case "SET_INTEGRATIONS": case "SET_SNAPSHOTS": case "SET_PLAYBOOK": case "SET_HEALTH_PLAYBOOK":
```

Add a new case mirroring `SEED_PLAYBOOK` (write tasks + the account):

```js
    case "SEED_HEALTH_PLAYBOOK": { action.items.forEach(t => up("tasks", t)); const a = next.accounts.find(x => x.id === action.id); return a && up("accounts", a); }
```

- [ ] **Step 6: Carry `healthPlaybook` through state-load** — in the returned `settings` object (~line 261) add `healthPlaybook`:

```js
      integrations: { processed: {}, log: [], ...(saved.integrations || {}) }, snapshots: saved.snapshots || [], playbook: saved.playbook, healthPlaybook: saved.healthPlaybook },
```

- [ ] **Step 7: Run to verify it passes**

Run: `cd tests && node health/run.mjs`
Expected: both `reducer.test.mjs` cases PASS.

- [ ] **Step 8: Commit**

```bash
git add crm.html tests/health/reducer.test.mjs tests/health/run.mjs
git commit -m "feat: SET/SEED_HEALTH_PLAYBOOK reducer actions + persistence"
```

---

## Task 4: Band-crossing detection seeder

The `useEffect` that watches accounts, initializes `healthBand` silently on first run, and dispatches `SEED_HEALTH_PLAYBOOK` on every transition (seeding tasks only on worsening past `healthPlaybookBand`).

**Files:**
- Modify: `crm.html` — add a `useEffect` next to the renewal seeder (~line 2377), inside the App component
- Test: `tests/health/crossing.test.mjs`

**Interfaces:**
- Consumes: `BAND_RANK`, `healthPlaybookOf`, `isoPlus`, `riskOf`, `SEED_HEALTH_PLAYBOOK`, and the `scored` accounts (which carry live `.risk` and `.score`, spread from the account so `healthBand`/`healthPlaybookBand`/`healthEvents` are present).
- Produces: no new exports; drives dispatches. Seeded task shape:
  `{ id: hpb-<acct>-<band>-<date>-<step>, accountId, healthPlaybook: true, healthBand, healthFor: date, title: "♥ "+step.title, due: isoPlus(date, step.dueDays), priority: step.priority, status: "Open", owner: a.csm || "" }`.

- [ ] **Step 1: Write the failing tests** — `tests/health/crossing.test.mjs`

```js
import { launch, seedAccount } from "./harness.mjs";
import { test, assert } from "./run.mjs";

function seedFor(acct) {
  return `window.__seedRows = { accounts: [${JSON.stringify(acct)}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
}
const wait = page => page.waitForFunction(() => window.__store && window.__store.getState().accounts.length);

test("first run: existing Red account seeds nothing, initializes band", async () => {
  // usage/sentiment low → score < 40 → Red, but no healthBand yet.
  const acct = seedAccount({ inputs: { usage: 20, sentiment: 20, tickets: 10, nps: -60 } });
  const { page, browser } = await launch(seedFor(acct));
  await wait(page);
  const r = await page.evaluate(() => {
    const s = window.__store.getState(); const a = s.accounts.find(x => x.id === "t1");
    return { band: a.healthBand, events: (a.healthEvents || []).length, tasks: s.tasks.filter(t => t.healthPlaybook).length };
  });
  assert(r.band === "Red", "band should initialize to Red");
  assert(r.events === 0, "no events on first run");
  assert(r.tasks === 0, "no tasks on first run");
  await browser.close();
});

test("worsening Green->Yellow seeds Yellow playbook + event", async () => {
  const acct = seedAccount({ healthBand: "Green", inputs: { usage: 55, sentiment: 55, tickets: 3, nps: 0 } }); // ~Yellow
  const { page, browser } = await launch(seedFor(acct));
  await wait(page);
  const r = await page.evaluate(() => {
    const s = window.__store.getState(); const a = s.accounts.find(x => x.id === "t1");
    const t = s.tasks.filter(x => x.healthPlaybook);
    return { band: a.healthBand, pb: a.healthPlaybookBand, ev: a.healthEvents,
      ids: t.map(x => x.id), titles: t.map(x => x.title) };
  });
  assert(r.band === "Yellow" && r.pb === "Yellow", "band/pbBand not Yellow");
  assert(r.ev.length === 1 && r.ev[0].from === "Green" && r.ev[0].to === "Yellow", "event wrong");
  assert(r.ids.length === 3 && r.ids.every(id => /^hpb-t1-Yellow-\\d{4}-\\d{2}-\\d{2}-hy\\d$/.test(id)), "task ids wrong: " + r.ids);
  assert(r.titles.every(t => t.startsWith("♥ ")), "titles not marked");
  await browser.close();
});

test("no duplicate seeding on stable band", async () => {
  const acct = seedAccount({ healthBand: "Yellow", healthPlaybookBand: "Yellow", inputs: { usage: 55, sentiment: 55, tickets: 3, nps: 0 } });
  const { page, browser } = await launch(seedFor(acct));
  await wait(page);
  await page.waitForTimeout(500);
  const n = await page.evaluate(() => window.__store.getState().tasks.filter(t => t.healthPlaybook).length);
  assert(n === 0, "should not seed when band unchanged: got " + n);
  await browser.close();
});
```

Add `import "./crossing.test.mjs";` to `run.mjs`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests && node health/run.mjs`
Expected: `crossing.test.mjs` cases FAIL (seeder not present — worsening test seeds nothing).

- [ ] **Step 3: Add the seeder `useEffect`** right after the renewal seeder (~line 2390), inside App (uses `scored`, `loaded`, `dispatch`):

```js
  useEffect(() => { // auto: detect health-band crossings, seed per-band playbook tasks
    if (!loaded) return;
    const today = iso(Date.now());
    const hpb = healthPlaybookOf(st.settings);
    scored.forEach(a => {
      if (a.churn) return;
      const cur = a.risk;                       // live band from score
      const prev = a.healthBand;
      if (prev === undefined) {                 // first run: initialize silently
        dispatch({ type: "SEED_HEALTH_PLAYBOOK", id: a.id, healthBand: cur,
          healthPlaybookBand: a.healthPlaybookBand, event: null, items: [] });
        return;
      }
      if (cur === prev) return;                 // no crossing
      const worsening = BAND_RANK[cur] > BAND_RANK[prev];
      const event = { date: today, from: prev, to: cur };
      let items = [], pbBand = a.healthPlaybookBand;
      if (worsening && (cur === "Yellow" || cur === "Red") &&
          (pbBand === undefined || BAND_RANK[cur] > BAND_RANK[pbBand])) {
        items = (hpb[cur] || []).filter(s => s.title.trim()).map(s => ({
          id: `hpb-${a.id}-${cur}-${today}-${s.id}`, accountId: a.id, healthPlaybook: true,
          healthBand: cur, healthFor: today, title: "♥ " + s.title,
          due: isoPlus(today, s.dueDays), priority: s.priority, status: "Open", owner: a.csm || "" }));
        pbBand = cur;
      } else if (!worsening && cur === "Green") {
        pbBand = undefined;                     // recovered: allow re-seed on next decline
      }
      dispatch({ type: "SEED_HEALTH_PLAYBOOK", id: a.id, healthBand: cur,
        healthPlaybookBand: pbBand, event, items });
    });
  }, [loaded, scored, st.settings.healthPlaybook]);
```

- [ ] **Step 4: Handle the `event: null` first-run case in the reducer** — update the `SEED_HEALTH_PLAYBOOK` case (Task 3, Step 3) to skip a null event:

```js
    case "SEED_HEALTH_PLAYBOOK": return { ...state,
      tasks: [...state.tasks, ...action.items],
      accounts: state.accounts.map(a => a.id === action.id
        ? { ...a, healthBand: action.healthBand, healthPlaybookBand: action.healthPlaybookBand,
            healthEvents: action.event ? [...(a.healthEvents || []), action.event] : (a.healthEvents || []) }
        : a) };
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd tests && node health/run.mjs`
Expected: all `crossing.test.mjs` cases PASS (and prior tasks' cases still PASS).

- [ ] **Step 6: Add recovery+re-decline test** — append to `crossing.test.mjs`:

```js
test("recovery to Green clears pbBand; later decline re-seeds", async () => {
  const acct = seedAccount({ healthBand: "Red", healthPlaybookBand: "Red", inputs: { usage: 90, sentiment: 90, tickets: 0, nps: 60 } }); // now Green
  const { page, browser } = await launch(seedFor(acct));
  await wait(page);
  const afterRecovery = await page.evaluate(() => {
    const a = window.__store.getState().accounts.find(x => x.id === "t1");
    return { band: a.healthBand, pb: a.healthPlaybookBand };
  });
  assert(afterRecovery.band === "Green" && afterRecovery.pb === undefined, "recovery didn't clear pbBand");
  // now push it back down to Red via UPDATE_INPUTS
  await page.evaluate(() => window.__store.dispatch({ type: "UPDATE_INPUTS", id: "t1", inputs: { usage: 10, sentiment: 10, tickets: 20, nps: -80 } }));
  await page.waitForTimeout(400);
  const reseed = await page.evaluate(() => window.__store.getState().tasks.filter(t => t.healthPlaybook && t.healthBand === "Red").length);
  assert(reseed === 3, "re-decline should seed 3 Red tasks, got " + reseed);
  await browser.close();
});
```

Run: `cd tests && node health/run.mjs`
Expected: new case PASSES.

- [ ] **Step 7: Commit**

```bash
git add crm.html tests/health/crossing.test.mjs
git commit -m "feat: health-band crossing detection + playbook seeding"
```

---

## Task 5: Settings — Health playbook editor

A `HealthPlaybookCard` mirroring `PlaybookCard` (`crm.html:1992`), with Yellow and Red step lists.

**Files:**
- Modify: `crm.html` — add `HealthPlaybookCard` component after `PlaybookCard` (~line 2012); render it in `Settings` after `<PlaybookCard …/>` (~line 2063)
- Test: `tests/health/settings.test.mjs`

**Interfaces:**
- Consumes: `healthPlaybookOf`, `SET_HEALTH_PLAYBOOK`, existing `Card`/`Input`/`Select`/`Btn`/`uid`.
- Produces: `HealthPlaybookCard({ st, dispatch })` component.

- [ ] **Step 1: Write the failing test** — `tests/health/settings.test.mjs`

```js
import { launch, seedAccount } from "./harness.mjs";
import { test, assert } from "./run.mjs";

const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("Settings shows Health playbook editor with Yellow & Red sections", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForSelector("#root");
  // navigate to Settings view
  await page.getByRole("button", { name: "Settings" }).click();
  const txt = await page.textContent("body");
  assert(/Health playbook/.test(txt), "Health playbook card missing");
  assert(/Yellow/.test(txt) && /Red/.test(txt), "band sections missing");
  await browser.close();
});
```

Add `import "./settings.test.mjs";` to `run.mjs`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests && node health/run.mjs`
Expected: FAIL (no "Health playbook" text).

- [ ] **Step 3: Add `HealthPlaybookCard` after `PlaybookCard` (~line 2012)**

```js
/* --------------------------- Health playbook --------------------------- */
function HealthPlaybookCard({ st, dispatch }) {
  const hpb = healthPlaybookOf(st.settings);
  const setBand = (band, list) => dispatch({ type: "SET_HEALTH_PLAYBOOK", healthPlaybook: { ...hpb, [band]: list } });
  const editStep = (band, id, patch) => setBand(band, hpb[band].map(s => s.id === id ? { ...s, ...patch } : s));
  const Section = ({ band, tone }) => (
    <div className="mb-3">
      <div className={`mb-1 text-xs font-bold uppercase tracking-widest ${tone}`}>{band}</div>
      {hpb[band].map(s => (
        <div key={s.id} className="mb-2 flex items-center gap-2 text-sm">
          <Input value={s.title} placeholder="Step…" onChange={e => editStep(band, s.id, { title: e.target.value })} className="flex-1 min-w-[160px]" />
          <Input type="number" min="0" max="180" value={s.dueDays} title="Days after crossing"
            onChange={e => editStep(band, s.id, { dueDays: Math.min(180, Math.max(0, Math.round(+e.target.value || 0))) })} className="w-20" />
          <span className="whitespace-nowrap text-xs text-slate-500">d after</span>
          <Select value={s.priority} onChange={e => editStep(band, s.id, { priority: e.target.value })} options={["High", "Medium", "Low"]} />
          <button title="Remove step" className="text-rose-400 hover:text-rose-600" onClick={() => setBand(band, hpb[band].filter(x => x.id !== s.id))}>✕</button>
        </div>
      ))}
      <Btn onClick={() => setBand(band, [...hpb[band], { id: uid(), title: "", dueDays: 3, priority: "Medium" }])}>+ Add step</Btn>
    </div>
  );
  return (
    <Card title="Health playbook">
      <Section band="Yellow" tone="text-amber-600" />
      <Section band="Red" tone="text-rose-600" />
      <p className="mt-1 text-xs text-slate-500">When an account crosses into Yellow or Red, one task per step is created automatically for its CSM (due = crossing date + days, marked ♥). Tasks seed once per decline into a band; recovery to Green re-arms them. Shared by the whole team.</p>
    </Card>
  );
}
```

- [ ] **Step 4: Render it in `Settings`** — after `<PlaybookCard st={st} dispatch={dispatch} />` (~line 2063):

```js
      <HealthPlaybookCard st={st} dispatch={dispatch} />
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd tests && node health/run.mjs`
Expected: `settings.test.mjs` PASSES.

- [ ] **Step 6: Commit**

```bash
git add crm.html tests/health/settings.test.mjs
git commit -m "feat: Settings health-playbook editor (Yellow/Red)"
```

---

## Task 6: Notification bell — health decline alerts

Extend the `alerts` array (`crm.html:2407-2412`) with recent decline events, keeping per-item read state.

**Files:**
- Modify: `crm.html` — `alerts` builder (~line 2407); bell header label (~line 2460)
- Test: `tests/health/bell.test.mjs`

**Interfaces:**
- Consumes: `scored` (accounts with `healthEvents`), `BAND_RANK`, `daysSince`, existing `notifRead`/`markNotifRead`/`unreadCount`.
- Produces: alert items `{ id: health-<acct>-<date>-<to>, accountId, name, sub, date, days }` where `days` is `-daysSince(date)` (negative = in the past) so existing sort/badge render sensibly.

- [ ] **Step 1: Write the failing test** — `tests/health/bell.test.mjs`

```js
import { launch, seedAccount } from "./harness.mjs";
import { test, assert } from "./run.mjs";

// Account with a recent decline event already recorded (so no dependence on seeder timing).
const acct = seedAccount({ healthBand: "Yellow",
  healthEvents: [{ date: new Date(Date.now() - 3*864e5).toISOString().slice(0,10), from: "Green", to: "Yellow" }],
  inputs: { usage: 55, sentiment: 55, tickets: 3, nps: 0 } });
const seed = `window.__seedRows = { accounts: [${JSON.stringify(acct)}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("bell shows recent health-decline item", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForSelector("#root");
  await page.click('button[title="Renewal & contract alerts"]');
  const txt = await page.textContent("body");
  assert(/health dropped to Yellow/i.test(txt), "decline alert text missing");
  await browser.close();
});
```

Add `import "./bell.test.mjs";` to `run.mjs`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests && node health/run.mjs`
Expected: FAIL (no decline text).

- [ ] **Step 3: Extend the `alerts` array** (~line 2411, inside the `[...]` before `.sort`):

```js
    ...scored.flatMap(a => (a.healthEvents || [])
      .filter(e => BAND_RANK[e.to] > BAND_RANK[e.from] && daysSince(e.date) <= 30)
      .map(e => ({ id: `health-${a.id}-${e.date}-${e.to}`, accountId: a.id, name: a.name,
        sub: `Health dropped to ${e.to}`, date: e.date, days: -daysSince(e.date) }))),
```

- [ ] **Step 4: Update the bell header label** (~line 2460) so it reflects the added source:

```js
                <span className="text-xs font-semibold text-slate-700">Renewals, contracts &amp; health</span>
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd tests && node health/run.mjs`
Expected: `bell.test.mjs` PASSES; all prior cases still PASS.

> NOTE: the badge renders `a.days < 0 ? "expired" : a.days + "d"`. For past decline events `days` is negative → shows "expired", which is acceptable here, but if that reads oddly, the label render (~line 2476) may be adjusted to show `Math.abs(days)+"d ago"` when `sub` starts with "Health". Only change if the user flags it — keep additive.

- [ ] **Step 6: Commit**

```bash
git add crm.html tests/health/bell.test.mjs
git commit -m "feat: health-decline alerts in notification bell"
```

---

## Task 7: Dashboard — "Recently declined" card

New card listing accounts that dropped a band in the last 30 days.

**Files:**
- Modify: `crm.html` — `Dashboard` component; add a card in the existing `grid grid-cols-3` row (~line 1253-1280, alongside "Renewals due" / "Alerts & flags")
- Test: `tests/health/dashboard.test.mjs`

**Interfaces:**
- Consumes: `scored` (with `healthEvents`), `BAND_RANK`, `daysSince`, `fmtDate`, `RISK_HEX`, `openAccount`.
- Produces: no exports.

- [ ] **Step 1: Write the failing test** — `tests/health/dashboard.test.mjs`

```js
import { launch, seedAccount } from "./harness.mjs";
import { test, assert } from "./run.mjs";

const acct = seedAccount({ healthBand: "Red",
  healthEvents: [{ date: new Date(Date.now() - 2*864e5).toISOString().slice(0,10), from: "Yellow", to: "Red" }],
  inputs: { usage: 20, sentiment: 20, tickets: 10, nps: -60 } });
const seed = `window.__seedRows = { accounts: [${JSON.stringify(acct)}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("dashboard shows Recently declined card with account", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForSelector("#root");
  const txt = await page.textContent("body");
  assert(/Recently declined/.test(txt), "card title missing");
  await browser.close();
});
```

Add `import "./dashboard.test.mjs";` to `run.mjs`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests && node health/run.mjs`
Expected: FAIL (no "Recently declined").

- [ ] **Step 3: Compute declines** — inside `Dashboard`, near `const flagged = ...` (~line 1199):

```js
  const declines = scored
    .flatMap(a => (a.healthEvents || [])
      .filter(e => BAND_RANK[e.to] > BAND_RANK[e.from] && daysSince(e.date) <= 30)
      .map(e => ({ a, e })))
    .sort((x, y) => daysSince(x.e.date) - daysSince(y.e.date));
```

- [ ] **Step 4: Add the card** — inside the `grid grid-cols-3` row that holds "Renewals due" and "Alerts & flags" (~line 1253), add a third `Card`:

```js
        <Card title="Recently declined" className="!p-3">
          <div className="max-h-48 overflow-y-auto pr-1">
          {declines.length === 0 && <div className="text-sm text-slate-500">No recent declines. 🎉</div>}
          {declines.map(({ a, e }) => (
            <button key={a.id + e.date + e.to} onClick={() => openAccount(a.id)} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-slate-50">
              <span className="text-sm">{a.name}</span>
              <span className="flex items-center gap-2 text-xs">
                <span className="font-semibold" style={{ color: RISK_HEX[e.from] }}>{e.from}</span>
                <span className="text-slate-400">→</span>
                <span className="font-semibold" style={{ color: RISK_HEX[e.to] }}>{e.to}</span>
                <span className="text-slate-500">{fmtDate(e.date)}</span>
              </span>
            </button>
          ))}
          </div>
        </Card>
```

> If that row already has exactly 3 cards and would overflow to 4, place the new card in the following row instead (search for the next `grid` block after "Alerts & flags"). Keep the grid visually balanced; do not remove any existing card.

- [ ] **Step 5: Run to verify it passes**

Run: `cd tests && node health/run.mjs`
Expected: `dashboard.test.mjs` PASSES; all prior cases PASS.

- [ ] **Step 6: Full regression run**

Run: `cd tests && node health/run.mjs`
Expected: every case across all `*.test.mjs` PASSES, `N passed, 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add crm.html tests/health/dashboard.test.mjs
git commit -m "feat: dashboard Recently-declined card"
```

---

## Task 8: Manual localhost verification + cleanup

- [ ] **Step 1: Serve locally**

Run: `python -m http.server 8000` (from repo root), open `http://localhost:8000/crm.html`.
(If Supabase isn't configured locally, the app runs in its unconfigured/sample mode — load sample data from Settings.)

- [ ] **Step 2: Manual checks (report results to user)**
  - Settings shows the **Health playbook** editor (Yellow + Red); editing a step and adding/removing rows works.
  - Drop an account's health inputs (✎ Update health) below 70 then below 40; confirm ♥ tasks appear on the account and a bell item + dashboard "Recently declined" entry show up.
  - Existing accounts already Red on load did **not** spawn ♥ tasks retroactively.
  - Existing features (renewal playbooks, QBR, charts, documents) all still render.

- [ ] **Step 3: Remove the test hook if the user wants it gone** — the `window.__store` and `window.__health` hooks are additive and harmless, but if the user prefers, gate them behind `if (location.hostname === "localhost" || location.protocol === "file:")`. Otherwise leave as-is. Decide with the user.

- [ ] **Step 4: STOP — do not push/merge.** The user tests on localhost first and will explicitly instruct when to make it live. When instructed: push a `feat/health-alerts-playbooks` branch, open a PR with `gh` (`--body-file`), and merge to `master` after their approval.

---

## Notes for the implementer

- The `window.__store` / `window.__health` hooks exist purely so the E2E harness can drive/read the reducer without a real backend. They are additive and safe; see Task 8 Step 3.
- If any `crm.html` line number in this plan has drifted, locate the referenced code by its surrounding snippet (quoted in each task) rather than trusting the number.
- Watch the UTC pitfall: every date here flows through `iso`/`isoPlus`/`daysSince`, which the codebase already uses consistently. Do not introduce raw `new Date()` comparisons.
