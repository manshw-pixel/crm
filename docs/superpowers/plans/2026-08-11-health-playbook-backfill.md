# Health Playbook Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-triggered Settings action that seeds ♥ health-playbook tasks for every currently at-risk account, closing the hole left by the auto-seeder's silent first run.

**Architecture:** One pure selector (`backfillCandidates`), one new presentational component (`HealthBackfillCard`) rendered inside the existing `HealthPlaybookCard`, and a click handler that loops the candidates and dispatches the **existing** `SEED_HEALTH_PLAYBOOK` reducer action once per account. No new reducer case, no new persistence path.

**Tech Stack:** Single-file React 18 + Babel-in-browser (`crm.html`), Supabase for persistence, Playwright (headless Edge) driven by a hand-rolled runner in `tests/health/`.

**Spec:** `docs/superpowers/specs/2026-08-11-health-playbook-backfill-design.md`

## Global Constraints

- **All changes to `crm.html` must be strictly additive.** Do not alter the behavior of the existing auto-seeder effect (`crm.html:2501`), the `SEED_HEALTH_PLAYBOOK` reducer case (`crm.html:412`), or the existing `HealthPlaybookCard` step editors.
- **Do not add a new reducer case.** The backfill reuses `SEED_HEALTH_PLAYBOOK`.
- `crm.html` is a single file with no build step — all code goes in the existing `<script type="text/babel">` block, placed near the code it relates to.
- Task ids must be exactly `hpb-<accountId>-<band>-<YYYY-MM-DD>-<stepId>` — same shape the auto-seeder emits, so same-day re-runs upsert rather than duplicate.
- Task titles must be prefixed `"♥ "` (heart + one space).
- Synthetic events must carry `source: "backfill"`.
- Settings is already admin-only via view gating (`crm.html:2379`, `crm.html:2634`). Do **not** add a second role check.
- Run the full suite with `node run.mjs` from `tests/health/` (there is no npm test script). Expect the 20 pre-existing tests to keep passing at every commit.
- Commit after each task. Work on branch `feat/health-playbook-backfill`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `crm.html` | `backfillCandidates` helper, next to `healthPlaybookOf` (~line 449) | Modify |
| `crm.html` | `HealthBackfillCard` component + render inside `HealthPlaybookCard` (~line 2093-2120) | Modify |
| `crm.html` | `scored` prop threaded `App → Settings → HealthPlaybookCard` (~lines 2123, 2172, 2634) | Modify |
| `crm.html` | `backfillCandidates` added to the `window.__health` export (~line 2663) | Modify |
| `tests/health/backfill.test.mjs` | All backfill tests | Create |
| `tests/health/run.mjs` | Register the new test file | Modify |

---

### Task 1: `backfillCandidates` selector

**Files:**
- Modify: `crm.html` (~line 449, immediately after `const healthPlaybookOf = ...`)
- Modify: `crm.html` (~line 2663, the `window.__health` export)
- Create: `tests/health/backfill.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: `scored` — the array the App component computes; each element is an account plus a derived `risk` field holding `"Green" | "Yellow" | "Red"`, and the raw account fields including `churn` and `healthPlaybookBand`.
- Produces: `backfillCandidates(scored) -> Account[]`, exported on `window.__health.backfillCandidates`. Used by Task 2 and Task 3.

- [ ] **Step 1: Write the failing test**

Create `tests/health/backfill.test.mjs`:

```js
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// Score inputs chosen to land in each band (same values the crossing tests rely on).
const GREEN  = { usage: 90, sentiment: 90, tickets: 0,  nps: 60 };
const YELLOW = { usage: 55, sentiment: 55, tickets: 3,  nps: 0 };
const RED    = { usage: 15, sentiment: 15, tickets: 20, nps: -80 };

// A mixed book covering every candidate/non-candidate case in the spec.
export const MIXED = [
  seedAccount({ id: "a1", name: "Never Red",   inputs: RED,    healthBand: "Red" }),
  seedAccount({ id: "a2", name: "Never Yellow", inputs: YELLOW, healthBand: "Yellow" }),
  seedAccount({ id: "a3", name: "Seeded Yellow", inputs: YELLOW, healthBand: "Yellow", healthPlaybookBand: "Yellow" }),
  seedAccount({ id: "a4", name: "Churned Red",  inputs: RED,    healthBand: "Red", churn: true }),
  seedAccount({ id: "a5", name: "Healthy",      inputs: GREEN,  healthBand: "Green" }),
];

export function seedBook(accts) {
  return `window.__seedRows = { accounts: ${JSON.stringify(accts)}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
}
export const wait = page => page.waitForFunction(() => window.__store && window.__store.getState().accounts.length);

test("backfillCandidates selects non-churned Yellow/Red only", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  const ids = await page.evaluate(() => {
    const scored = [
      { id: "a1", risk: "Red",    churn: false },
      { id: "a2", risk: "Yellow", churn: false },
      { id: "a3", risk: "Yellow", churn: false },
      { id: "a4", risk: "Red",    churn: true },
      { id: "a5", risk: "Green",  churn: false },
    ];
    return window.__health.backfillCandidates(scored).map(a => a.id);
  });
  assert(ids.join(",") === "a1,a2,a3", "wrong candidates: " + ids.join(","));
  await browser.close();
});
```

Register it in `tests/health/run.mjs` by adding this line after the existing `import "./dates.test.mjs";`:

```js
import "./backfill.test.mjs";
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `tests/health/`:

```
node run.mjs
```

Expected: `FAIL backfillCandidates selects non-churned Yellow/Red only` with a message about `window.__health.backfillCandidates is not a function`. The 20 pre-existing tests must still pass.

- [ ] **Step 3: Add the helper**

In `crm.html`, immediately after `const healthPlaybookOf = settings => settings.healthPlaybook || DEFAULT_HEALTH_PLAYBOOK;`:

```js
/* Accounts eligible for the one-time playbook backfill: every live at-risk account.
 * Re-seeds accounts that already have a playbook (deliberate — see the 2026-08-11 spec). */
const backfillCandidates = scored => scored.filter(a => !a.churn && (a.risk === "Yellow" || a.risk === "Red"));
```

Then extend the debug export near the bottom of the script:

```js
window.__health = { isoPlus, addMonths, BAND_RANK, healthPlaybookOf, DEFAULT_HEALTH_PLAYBOOK, backfillCandidates };
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `tests/health/`:

```
node run.mjs
```

Expected: `PASS backfillCandidates selects non-churned Yellow/Red only`, and `21 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/backfill.test.mjs tests/health/run.mjs
git commit -m "feat: backfillCandidates selector for at-risk playbook seeding"
```

---

### Task 2: `HealthBackfillCard` UI (counts + confirm gate, no writes yet)

The component renders and gates, but its confirm handler does nothing yet. Task 3 fills in the write. This split exists so the counting/threading can be reviewed independently of the state mutation.

**Files:**
- Modify: `crm.html` (~line 2093-2120, `HealthPlaybookCard`)
- Modify: `crm.html` (~line 2123, `function Settings({ st, dispatch, user })`)
- Modify: `crm.html` (~line 2634, the `<Settings ... />` render)
- Modify: `tests/health/backfill.test.mjs`

**Interfaces:**
- Consumes: `backfillCandidates(scored)` from Task 1.
- Produces: `HealthBackfillCard({ st, dispatch, scored })` with a `run()` handler that Task 3 implements. `HealthPlaybookCard` and `Settings` both gain a `scored` prop.

- [ ] **Step 1: Write the failing test**

Append to `tests/health/backfill.test.mjs`:

```js
import { rootText } from "./harness.mjs";

const openSettings = async page => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForFunction(() => document.querySelector("#root")?.textContent.includes("Health playbook"));
};

test("backfill card reports the never-seeded / already-seeded split", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  await openSettings(page);
  const txt = await rootText(page);
  assert(/3 at-risk accounts/.test(txt), "candidate count missing: " + txt.slice(0, 400));
  assert(/2 never seeded/.test(txt), "never-seeded count missing");
  assert(/1 already ha(s|ve) a playbook/.test(txt), "already-seeded count missing");
  await browser.close();
});

test("backfill requires confirmation and Cancel writes nothing", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  await openSettings(page);
  await page.getByRole("button", { name: "Seed playbooks now" }).click();
  await page.waitForFunction(() => document.querySelector("#root")?.textContent.includes("Confirm — seed 3 accounts?"));
  const midway = await page.evaluate(() => window.__store.getState().tasks.filter(t => t.healthPlaybook).length);
  assert(midway === 0, "clicking the button must not write before confirmation: " + midway);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForFunction(() => document.querySelector("#root")?.textContent.includes("Seed playbooks now"));
  const after = await page.evaluate(() => window.__store.getState().tasks.filter(t => t.healthPlaybook).length);
  assert(after === 0, "Cancel must not write: " + after);
  await browser.close();
});

test("backfill card disables the button when nothing is at risk", async () => {
  const { page, browser } = await launch(seedBook([seedAccount({ id: "a5", inputs: GREEN, healthBand: "Green" })]));
  await wait(page);
  await openSettings(page);
  const txt = await rootText(page);
  assert(/No at-risk accounts/.test(txt), "empty-state copy missing: " + txt.slice(0, 400));
  const disabled = await page.getByRole("button", { name: "Seed playbooks now" }).isDisabled();
  assert(disabled, "button should be disabled with zero candidates");
  await browser.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `tests/health/`:

```
node run.mjs
```

Expected: the three new tests FAIL (timeouts waiting for text / `getByRole` not finding "Seed playbooks now"). Tests from Task 1 and the 20 pre-existing tests still pass.

- [ ] **Step 3: Add the component and thread the `scored` prop**

In `crm.html`, add this component immediately **before** `function HealthPlaybookCard(...)`:

```jsx
/* One-time backfill: seed ♥ playbooks for accounts that are already at risk.
 * The auto-seeder only fires on band crossings, so accounts that were Red before the
 * feature shipped never get a playbook. Re-seeds already-seeded accounts by design. */
function HealthBackfillCard({ st, dispatch, scored }) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null);
  const cands = backfillCandidates(scored);
  const fresh = cands.filter(a => a.healthPlaybookBand === undefined).length;
  const seeded = cands.length - fresh;
  const run = () => { setConfirming(false); };   // Task 3 implements the write
  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <div className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-500">Backfill</div>
      <p className="mb-2 text-sm text-slate-600">
        {cands.length === 0
          ? "No at-risk accounts — nothing to seed."
          : `${cands.length} at-risk accounts — ${fresh} never seeded, ${seeded} already have a playbook (will get a fresh set).`}
      </p>
      {confirming ? (
        <div className="flex items-center gap-2">
          <Btn onClick={run}>{`Confirm — seed ${cands.length} accounts?`}</Btn>
          <Btn onClick={() => setConfirming(false)}>Cancel</Btn>
        </div>
      ) : (
        <Btn disabled={cands.length === 0} onClick={() => { setDone(null); setConfirming(true); }}>Seed playbooks now</Btn>
      )}
      {done && <p className="mt-2 text-sm font-semibold text-emerald-600">{`Seeded ${done.accounts} accounts (${done.tasks} tasks).`}</p>}
    </div>
  );
}
```

Note the copy uses "accounts" and "already have a playbook" unconditionally — the test regex tolerates both verb forms, but keep the plural form so the strings stay stable.

Change the `HealthPlaybookCard` signature and render:

```jsx
function HealthPlaybookCard({ st, dispatch, scored }) {
```

and inside its returned `<Card title="Health playbook">`, after the existing closing `</p>`, add:

```jsx
      <HealthBackfillCard st={st} dispatch={dispatch} scored={scored} />
```

Thread the prop through Settings — change the signature at ~line 2123:

```jsx
function Settings({ st, dispatch, user, scored }) {
```

change the child render at ~line 2172:

```jsx
      <HealthPlaybookCard st={st} dispatch={dispatch} scored={scored} />
```

and change the App-level render at ~line 2634:

```jsx
      {view === "Settings" && user.role === "admin" && <Settings st={st} dispatch={dispatch} user={user} scored={scored} />}
```

Verify `Btn` forwards a `disabled` prop to its underlying `<button>`. If it does not, add `disabled={props.disabled}` to the `Btn` definition — that is additive and does not change existing call sites, which never pass `disabled`.

- [ ] **Step 4: Run the tests to verify they pass**

Run from `tests/health/`:

```
node run.mjs
```

Expected: `24 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/backfill.test.mjs
git commit -m "feat: health playbook backfill card with candidate counts and confirm gate"
```

---

### Task 3: Wire the write path

**Files:**
- Modify: `crm.html` (the `run` handler in `HealthBackfillCard`)
- Modify: `tests/health/backfill.test.mjs`

**Interfaces:**
- Consumes: `SEED_HEALTH_PLAYBOOK` reducer action (`crm.html:412`), `healthPlaybookOf(settings)`, `isoPlus(date, days)`, `iso(ms)`.
- Produces: no new exports. On confirm, per candidate account: `items` (♥ tasks), `healthBand`, `healthPlaybookBand`, and a `{ date, from: "Green", to, source: "backfill" }` event.

- [ ] **Step 1: Write the failing tests**

Append to `tests/health/backfill.test.mjs`:

```js
const confirmBackfill = async page => {
  await page.getByRole("button", { name: "Seed playbooks now" }).click();
  await page.getByRole("button", { name: /^Confirm — seed \d+ accounts\?$/ }).click();
  await page.waitForFunction(() => /Seeded \d+ accounts/.test(document.querySelector("#root")?.textContent || ""));
};

test("backfill seeds tasks for every at-risk account and skips the rest", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  await openSettings(page);
  await confirmBackfill(page);
  const r = await page.evaluate(() => {
    const s = window.__store.getState();
    const byAcct = id => s.tasks.filter(t => t.healthPlaybook && t.accountId === id);
    return {
      a1: byAcct("a1").map(t => t.id), a2: byAcct("a2").length, a3: byAcct("a3").length,
      a4: byAcct("a4").length, a5: byAcct("a5").length,
      a1owner: byAcct("a1")[0]?.owner, a1title: byAcct("a1")[0]?.title,
      a1status: byAcct("a1")[0]?.status,
    };
  });
  assert(r.a1.length === 3 && r.a1.every(id => /^hpb-a1-Red-\d{4}-\d{2}-\d{2}-hr\d$/.test(id)), "a1 task ids wrong: " + r.a1);
  assert(r.a2 === 3, "a2 should get 3 Yellow tasks, got " + r.a2);
  assert(r.a3 === 3, "already-seeded a3 should be re-seeded, got " + r.a3);
  assert(r.a4 === 0, "churned a4 must be skipped, got " + r.a4);
  assert(r.a5 === 0, "healthy a5 must be skipped, got " + r.a5);
  assert(r.a1owner === "Priya", "task owner should be the CSM, got " + r.a1owner);
  assert(r.a1title.startsWith("♥ "), "task title not marked: " + r.a1title);
  assert(r.a1status === "Open", "task status should be Open, got " + r.a1status);
  await browser.close();
});

test("backfill writes one synthetic event per candidate, tagged backfill", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  await openSettings(page);
  await confirmBackfill(page);
  const r = await page.evaluate(() => {
    const s = window.__store.getState();
    const ev = id => (s.accounts.find(a => a.id === id).healthEvents || []);
    return { a1: ev("a1"), a3: ev("a3").length, a4: ev("a4").length, a5: ev("a5").length,
      a1pb: s.accounts.find(a => a.id === "a1").healthPlaybookBand };
  });
  assert(r.a1.length === 1, "a1 should have exactly one event, got " + r.a1.length);
  assert(r.a1[0].from === "Green" && r.a1[0].to === "Red", "a1 event bands wrong: " + JSON.stringify(r.a1[0]));
  assert(r.a1[0].source === "backfill", "a1 event not tagged: " + JSON.stringify(r.a1[0]));
  assert(r.a3 === 1, "a3 should gain one event, got " + r.a3);
  assert(r.a4 === 0 && r.a5 === 0, "churned/healthy accounts must gain no events");
  assert(r.a1pb === "Red", "a1 healthPlaybookBand should be Red, got " + r.a1pb);
  await browser.close();
});

test("auto-seeder adds nothing after a backfill, and a same-day re-run is idempotent", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  await openSettings(page);
  await confirmBackfill(page);
  await page.waitForTimeout(600);   // let the auto-seeder effect re-run on the new bands
  const first = await page.evaluate(() => window.__store.getState().tasks.filter(t => t.healthPlaybook).length);
  assert(first === 9, "expected 9 tasks after backfill + settled effects, got " + first);
  await confirmBackfill(page);
  await page.waitForTimeout(600);
  const second = await page.evaluate(() => window.__store.getState().tasks.filter(t => t.healthPlaybook).length);
  assert(second === 9, "same-day re-run must not add tasks, got " + second);
  await browser.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `tests/health/`:

```
node run.mjs
```

Expected: the three new tests FAIL — `confirmBackfill` times out waiting for the "Seeded N accounts" line, because `run()` is still a no-op. Everything else passes.

- [ ] **Step 3: Implement `run`**

Replace the placeholder `run` in `HealthBackfillCard` with:

```jsx
  const run = () => {
    const today = iso(Date.now());
    const hpb = healthPlaybookOf(st.settings);
    let tasks = 0;
    cands.forEach(a => {
      const items = (hpb[a.risk] || []).filter(s => s.title.trim()).map(s => ({
        id: `hpb-${a.id}-${a.risk}-${today}-${s.id}`, accountId: a.id, healthPlaybook: true,
        healthBand: a.risk, healthFor: today, title: "♥ " + s.title,
        due: isoPlus(today, s.dueDays), priority: s.priority, status: "Open", owner: a.csm || "" }));
      tasks += items.length;
      dispatch({ type: "SEED_HEALTH_PLAYBOOK", id: a.id, healthBand: a.risk,
        healthPlaybookBand: a.risk, items,
        event: { date: today, from: "Green", to: a.risk, source: "backfill" } });
    });
    setDone({ accounts: cands.length, tasks });
    setConfirming(false);
  };
```

`dispatch` is a `useCallback` wrapping a **functional** `setSt(prev => ...)` (`crm.html:2434`), so dispatching once per account inside a loop applies every update — no batching loss.

Setting `healthBand: a.risk` is what keeps the auto-seeder quiet afterwards: on its next run `cur === prev`, so it returns before seeding.

- [ ] **Step 4: Run the tests to verify they pass**

Run from `tests/health/`:

```
node run.mjs
```

Expected: `27 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/backfill.test.mjs
git commit -m "feat: seed health playbooks for currently at-risk accounts"
```

---

### Task 4: Verify the alert surfaces and open the PR

**Files:**
- Modify: `tests/health/backfill.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1-3. Produces nothing new.

- [ ] **Step 1: Write the failing test**

The dashboard "Recently declined" card and the notification bell both filter on `BAND_RANK[e.to] > BAND_RANK[e.from] && daysSince(e.date) <= 30` (`crm.html:1232`, `crm.html:2554`). Synthetic `from: "Green"` events satisfy both. Append to `tests/health/backfill.test.mjs`:

```js
test("backfilled accounts appear in the dashboard Recently-declined card", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  await openSettings(page);
  await confirmBackfill(page);
  await page.getByRole("button", { name: "Dashboard" }).click();
  await page.waitForFunction(() => document.querySelector("#root")?.textContent.includes("Recently declined"));
  const txt = await rootText(page);
  assert(/Never Red/.test(txt), "backfilled account missing from Recently declined: " + txt.slice(0, 600));
  assert(!/Churned Red/.test(txt), "churned account must not appear as recently declined");
  await browser.close();
});
```

- [ ] **Step 2: Run the test**

Run from `tests/health/`:

```
node run.mjs
```

Expected: PASS on the first run — Task 3 already wrote the events this test observes. If it fails, the failure is real: check that the dashboard card renders account names (not ids) and adjust the assertion to whatever it actually renders, but do **not** change `crm.html` to satisfy it without confirming the card is genuinely broken.

- [ ] **Step 3: Run the full suite one final time**

Run from `tests/health/`:

```
node run.mjs
```

Expected: `28 passed, 0 failed`. Do not proceed until you have seen that exact line.

- [ ] **Step 4: Commit**

```bash
git add tests/health/backfill.test.mjs
git commit -m "test: backfilled accounts surface in the Recently-declined card"
```

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/health-playbook-backfill
gh pr create --title "feat: seed health playbooks for currently at-risk accounts" --body-file <path-to-body>
```

Write the PR body to a temp file first — PowerShell mangles inline quoting on `--body`. The body should state: the problem (first-run silence strands already-Red accounts), the three design decisions (Settings bulk action, synthetic `source: "backfill"` events, re-seed all at-risk regardless), the accepted duplicate-task trade-off, and the test count. Do **not** merge — merging deploys the live team app, and that is the user's call.

## Self-Review Notes

Spec coverage check: candidate helper (Task 1), UI + counts + confirm + empty state (Task 2), write path incl. tasks/bands/synthetic events (Task 3), auto-seeder non-interference and same-day idempotence (Task 3), alert surfaces (Task 4). Spec test items 1-8 all map to a task. The spec's "transient done line" is implemented as `done` state cleared when the user re-enters the confirm flow.
