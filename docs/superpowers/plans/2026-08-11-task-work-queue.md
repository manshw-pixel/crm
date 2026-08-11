# Task Work Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Tasks view that shows every task bucketed by due date, filterable four ways, with complete / reschedule / open-account actions inline.

**Architecture:** Two pure helpers (`bucketTasks`, `filterTasks`) exported on `window.__health` for direct testing, plus one `TasksView` component wired into the existing nav. All writes reuse the existing `TOGGLE_TASK` and `EDIT_TASK` reducer actions — no new reducer cases.

**Tech Stack:** Single-file React 18 + Babel-in-browser (`crm.html`), Supabase for persistence, Playwright (headless Edge) driven by a hand-rolled runner in `tests/health/`.

**Spec:** `docs/superpowers/specs/2026-08-11-task-work-queue-design.md`

## Global Constraints

- **All changes to `crm.html` must be strictly additive.** No existing behavior changes. In particular the dashboard's "Tasks due this week" card (`crm.html:1358`) and the per-account "Open tasks" card (`crm.html:1891`) are left exactly as they are.
- **No new reducer actions.** Completing a task uses `TOGGLE_TASK` (`crm.html:394`); rescheduling uses `EDIT_TASK` (`crm.html:393`). Both already persist.
- `crm.html` is a single file with no build step — all code goes in the existing `<script type="text/babel">` block. React hooks (`useState`, `useMemo`, `useEffect`) are already in scope; do not add imports.
- Reuse the existing local components `Card`, `Btn`, `Input`, `Select`, `Chip` and the existing helpers `iso`, `isoPlus`, `daysUntil`, `fmtDate`, `uid`. Do not reimplement date math.
- **Bucket boundaries** are exactly: `< 0` overdue, `= 0` today, `1..7` this week, `> 7` later. A `status === "Done"` task goes to `done` regardless of its due date.
- **Priority order** for sorting is High → Medium → Low.
- Tests live in `tests/health/tasks.test.mjs` and run via `node run.mjs` from `tests/health/`. There is no npm test script. **31 tests pass before this plan starts** and must keep passing at every commit.
- Tests assert against `#root`, never `body` — the inert babel `<script>` source leaks into `body.textContent` and causes false positives.
- Commit after each task. Work on branch `feat/task-work-queue`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `crm.html` | `PRIORITY_RANK`, `bucketTasks`, `taskSource`, `filterTasks` helpers, placed together just before the `Sparkline` chart section (~line 451) | Modify |
| `crm.html` | `TasksView` component, placed just before `function Renewals(` (~line 2015) | Modify |
| `crm.html` | `NAV_ICONS.Tasks` (~line 2422), `VIEWS` (~line 2490), view render branch (~line 2699) | Modify |
| `crm.html` | `window.__health` export (~line 2700) | Modify |
| `tests/health/tasks.test.mjs` | All work-queue tests | Create |
| `tests/health/run.mjs` | Register the new test file | Modify |

---

### Task 1: `bucketTasks`

**Files:**
- Modify: `crm.html` (~line 451, immediately before the `/* ----- tiny charts ----- */` comment)
- Modify: `crm.html` (the `window.__health` export near the bottom)
- Create: `tests/health/tasks.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: the existing `DAY` constant (`crm.html:71`, milliseconds in a day).
- Produces: `bucketTasks(tasks, today) -> { overdue, today, week, later, done }` where `today` is an ISO `YYYY-MM-DD` string and each value is an array of task objects. Also `PRIORITY_RANK`. Both used by Task 3 and Task 4.

**Why `today` is a parameter:** the existing `daysUntil` compares against `Date.now()`, which makes tests time-of-day dependent. Passing an ISO date and comparing two UTC-midnight timestamps keeps bucketing deterministic. This repo has been bitten twice by UTC-vs-local drift on ISO date strings, so do not substitute `daysUntil` here.

- [ ] **Step 1: Write the failing tests**

Create `tests/health/tasks.test.mjs`:

```js
import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

export const TODAY = "2026-08-11";
const mkTask = (o = {}) => ({
  id: o.id || "t" + Math.random().toString(36).slice(2, 7), accountId: o.accountId || "a1",
  title: o.title || "Some task", due: o.due, priority: o.priority || "Medium",
  status: o.status || "Open", owner: o.owner || "Priya", ...o,
});

// Boot the app once just to reach the pure helpers on window.__health.
export const bootHelpers = async () => {
  const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
  const h = await launch(seed);
  await h.page.waitForFunction(() => window.__health && window.__health.bucketTasks);
  return h;
};

test("bucketTasks splits on the day boundaries", async () => {
  const { page, browser } = await bootHelpers();
  const r = await page.evaluate(t => {
    const b = window.__health.bucketTasks(t.tasks, t.today);
    return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.map(x => x.id)]));
  }, { today: TODAY, tasks: [
    mkTask({ id: "yesterday", due: "2026-08-10" }), mkTask({ id: "today", due: "2026-08-11" }),
    mkTask({ id: "tomorrow", due: "2026-08-12" }), mkTask({ id: "day7", due: "2026-08-18" }),
    mkTask({ id: "day8", due: "2026-08-19" }),
  ] });
  assert(r.overdue.join() === "yesterday", "overdue wrong: " + r.overdue);
  assert(r.today.join() === "today", "today wrong: " + r.today);
  assert(r.week.join() === "tomorrow,day7", "week wrong: " + r.week);
  assert(r.later.join() === "day8", "later wrong: " + r.later);
  await browser.close();
});

test("bucketTasks puts Done tasks in done regardless of due date", async () => {
  const { page, browser } = await bootHelpers();
  const r = await page.evaluate(t => {
    const b = window.__health.bucketTasks(t.tasks, t.today);
    return { done: b.done.map(x => x.id), overdue: b.overdue.map(x => x.id) };
  }, { today: TODAY, tasks: [
    mkTask({ id: "d1", due: "2026-07-01", status: "Done" }), mkTask({ id: "o1", due: "2026-07-01" }),
  ] });
  assert(r.done.join() === "d1", "done wrong: " + r.done);
  assert(r.overdue.join() === "o1", "a Done task must not appear in overdue: " + r.overdue);
  await browser.close();
});

test("bucketTasks sorts by due date then priority", async () => {
  const { page, browser } = await bootHelpers();
  const r = await page.evaluate(t => window.__health.bucketTasks(t.tasks, t.today).week.map(x => x.id),
    { today: TODAY, tasks: [
      mkTask({ id: "later-high", due: "2026-08-14", priority: "High" }),
      mkTask({ id: "soon-low", due: "2026-08-12", priority: "Low" }),
      mkTask({ id: "soon-high", due: "2026-08-12", priority: "High" }),
      mkTask({ id: "soon-med", due: "2026-08-12", priority: "Medium" }),
    ] });
  assert(r.join() === "soon-high,soon-med,soon-low,later-high", "sort wrong: " + r.join());
  await browser.close();
});
```

Register it in `tests/health/run.mjs` by adding this line after the existing `import "./backfill.test.mjs";`:

```js
import "./tasks.test.mjs";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `tests/health/`:

```
node run.mjs
```

Expected: the three new tests FAIL — `waitForFunction` times out because `window.__health.bucketTasks` does not exist. The 31 pre-existing tests still pass.

- [ ] **Step 3: Add the helper**

In `crm.html`, immediately before the `/* ----------------------------- tiny charts ----------------------------- */` comment:

```js
/* ------------------------------ task queue ------------------------------ */
const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };
/* Buckets tasks for the work queue. `today` is an ISO YYYY-MM-DD string; comparing two
 * UTC-midnight timestamps keeps this deterministic (daysUntil compares against Date.now(),
 * which makes results depend on the time of day the suite happens to run). */
const bucketTasks = (tasks, today) => {
  const out = { overdue: [], today: [], week: [], later: [], done: [] };
  const t0 = new Date(today).getTime();
  tasks.forEach(t => {
    if (t.status === "Done") { out.done.push(t); return; }
    if (!t.due) { out.later.push(t); return; }        // guards imported/hand-edited rows
    const d = Math.round((new Date(t.due).getTime() - t0) / DAY);
    if (d < 0) out.overdue.push(t);
    else if (d === 0) out.today.push(t);
    else if (d <= 7) out.week.push(t);
    else out.later.push(t);
  });
  const cmp = (a, b) => (a.due || "9999-99-99").localeCompare(b.due || "9999-99-99")
    || (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
  Object.keys(out).forEach(k => out[k].sort(cmp));
  return out;
};
```

Then extend the debug export near the bottom of the script, keeping every existing key:

```js
window.__health = { isoPlus, addMonths, BAND_RANK, healthPlaybookOf, DEFAULT_HEALTH_PLAYBOOK, backfillCandidates, bucketTasks };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `tests/health/`:

```
node run.mjs
```

Expected: `34 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/tasks.test.mjs tests/health/run.mjs
git commit -m "feat: bucketTasks helper for the work queue"
```

---

### Task 2: `filterTasks`

**Files:**
- Modify: `crm.html` (directly below `bucketTasks`)
- Modify: `crm.html` (the `window.__health` export)
- Modify: `tests/health/tasks.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime; sits beside it.
- Produces: `taskSource(task) -> "health" | "renewal" | "manual"` and `filterTasks(tasks, accountsById, opts) -> Task[]`, where `opts` is `{ scope, userName, source, band, q }`. Used by Task 3 and Task 4.
- `accountsById` is a plain object mapping account id to the **scored** account (which carries `risk` and `name`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/health/tasks.test.mjs`:

```js
const ACCTS = { a1: { id: "a1", name: "Northwind Analytics", risk: "Red" },
                a2: { id: "a2", name: "Bluepeak Logistics", risk: "Green" } };
const FTASKS = [
  { id: "h1", accountId: "a1", title: "♥ Escalate", owner: "Priya", healthPlaybook: true },
  { id: "r1", accountId: "a1", title: "▶ Send quote", owner: "Marco", playbook: true },
  { id: "m1", accountId: "a2", title: "Call champion", owner: "Priya" },
];
const ids = arr => arr.map(x => x.id).join();

test("filterTasks scope keeps only the user's tasks when mine", async () => {
  const { page, browser } = await bootHelpers();
  const r = await page.evaluate(a => ({
    mine: window.__health.filterTasks(a.tasks, a.accts, { scope: "mine", userName: "Priya" }).map(x => x.id).join(),
    all: window.__health.filterTasks(a.tasks, a.accts, { scope: "all", userName: "Priya" }).map(x => x.id).join(),
  }), { tasks: FTASKS, accts: ACCTS });
  assert(r.mine === "h1,m1", "mine wrong: " + r.mine);
  assert(r.all === "h1,r1,m1", "all wrong: " + r.all);
  await browser.close();
});

test("filterTasks source splits health, renewal and manual", async () => {
  const { page, browser } = await bootHelpers();
  const r = await page.evaluate(a => ({
    health: window.__health.filterTasks(a.tasks, a.accts, { source: "health" }).map(x => x.id).join(),
    renewal: window.__health.filterTasks(a.tasks, a.accts, { source: "renewal" }).map(x => x.id).join(),
    manual: window.__health.filterTasks(a.tasks, a.accts, { source: "manual" }).map(x => x.id).join(),
  }), { tasks: FTASKS, accts: ACCTS });
  assert(r.health === "h1", "health wrong: " + r.health);
  assert(r.renewal === "r1", "renewal wrong: " + r.renewal);
  assert(r.manual === "m1", "manual wrong: " + r.manual);
  await browser.close();
});

test("filterTasks band matches the task's account risk", async () => {
  const { page, browser } = await bootHelpers();
  const r = await page.evaluate(a => window.__health.filterTasks(a.tasks, a.accts, { band: "Red" }).map(x => x.id).join(),
    { tasks: FTASKS, accts: ACCTS });
  assert(r === "h1,r1", "band wrong: " + r);
  await browser.close();
});

test("filterTasks q matches task title and account name", async () => {
  const { page, browser } = await bootHelpers();
  const r = await page.evaluate(a => ({
    byTitle: window.__health.filterTasks(a.tasks, a.accts, { q: "escal" }).map(x => x.id).join(),
    byAccount: window.__health.filterTasks(a.tasks, a.accts, { q: "bluepeak" }).map(x => x.id).join(),
    none: window.__health.filterTasks(a.tasks, a.accts, { q: "zzzz" }).length,
  }), { tasks: FTASKS, accts: ACCTS });
  assert(r.byTitle === "h1", "title search wrong: " + r.byTitle);
  assert(r.byAccount === "m1", "account-name search wrong: " + r.byAccount);
  assert(r.none === 0, "unmatched query should return nothing, got " + r.none);
  await browser.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `tests/health/`:

```
node run.mjs
```

Expected: the four new tests FAIL with `window.__health.filterTasks is not a function`. Everything else passes.

- [ ] **Step 3: Add the helper**

In `crm.html`, directly below `bucketTasks`:

```js
/* Source of a task: the two seeders tag their own rows, anything untagged is hand-created. */
const taskSource = t => (t.healthPlaybook ? "health" : t.playbook ? "renewal" : "manual");
/* accountsById maps account id -> scored account (carries `risk` and `name`). */
const filterTasks = (tasks, accountsById, { scope = "all", userName = "", source = "all", band = "all", q = "" } = {}) =>
  tasks.filter(t => {
    if (scope === "mine" && t.owner !== userName) return false;
    if (source !== "all" && taskSource(t) !== source) return false;
    const a = accountsById[t.accountId];
    if (band !== "all" && (!a || a.risk !== band)) return false;
    if (q.trim()) {
      const hay = `${t.title || ""} ${a ? a.name : ""}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });
```

Then extend the export again, keeping every existing key:

```js
window.__health = { isoPlus, addMonths, BAND_RANK, healthPlaybookOf, DEFAULT_HEALTH_PLAYBOOK, backfillCandidates, bucketTasks, filterTasks };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `tests/health/`:

```
node run.mjs
```

Expected: `38 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/tasks.test.mjs
git commit -m "feat: filterTasks helper for the work queue"
```

---

### Task 3: `TasksView` — sections, counts, nav wiring

This task renders the queue read-only. Row interactions come in Task 4.

**Files:**
- Modify: `crm.html` (new component immediately before `function Renewals(`, ~line 2015)
- Modify: `crm.html` (`NAV_ICONS` ~line 2422, `VIEWS` ~line 2490, view branch ~line 2699)
- Modify: `tests/health/tasks.test.mjs`

**Interfaces:**
- Consumes: `bucketTasks`, `filterTasks` from Tasks 1-2.
- Produces: `TasksView({ st, scored, dispatch, user, openAccount })`. Task 4 adds the row's action controls inside it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/health/tasks.test.mjs`:

```js
// A book with tasks spread across every bucket. Dates are relative so the test never ages out.
const rel = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
export const QUEUE_SEED = () => {
  const accts = [
    seedAccount({ id: "a1", name: "Northwind Analytics", csm: "Priya", inputs: { usage: 15, sentiment: 15, tickets: 20, nps: -80 }, healthBand: "Red", healthPlaybookBand: "Red" }),
    seedAccount({ id: "a2", name: "Bluepeak Logistics", csm: "Marco", inputs: { usage: 90, sentiment: 90, tickets: 0, nps: 60 }, healthBand: "Green" }),
  ];
  const tasks = [
    { id: "q-over", accountId: "a1", title: "Escalate to exec", due: rel(-4), priority: "High", status: "Open", owner: "Priya", healthPlaybook: true },
    { id: "q-today", accountId: "a1", title: "Call the champion", due: rel(0), priority: "High", status: "Open", owner: "Priya" },
    { id: "q-week", accountId: "a2", title: "Send renewal quote", due: rel(3), priority: "Medium", status: "Open", owner: "Marco", playbook: true },
    { id: "q-later", accountId: "a2", title: "Plan expansion", due: rel(20), priority: "Low", status: "Open", owner: "Priya" },
    { id: "q-done", accountId: "a1", title: "Old finished thing", due: rel(-9), priority: "Low", status: "Done", owner: "Priya" },
  ];
  return `window.__seedRows = { accounts: ${JSON.stringify(accts)}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: ${JSON.stringify(tasks)}.map(d => ({ id: d.id, data: d })), opportunities: [], team: [], settings: [] };
window.__seedProfile = { id: "u1", name: "Priya", role: "admin" };`;
};
export const openTasks = async page => {
  await page.getByRole("button", { name: "Tasks" }).first().click();
  await page.waitForFunction(() => /Overdue/.test(document.querySelector("#root")?.textContent || ""));
};

test("Tasks view groups tasks into due-date sections with counts", async () => {
  const { page, browser } = await launch(QUEUE_SEED());
  await page.waitForFunction(() => window.__store && window.__store.getState().tasks.length);
  await openTasks(page);
  const txt = await rootText(page);
  // Scope defaults to All for admins, so every seeded task is in view.
  assert(/Overdue\s*\(?1\)?/.test(txt) || /Overdue.*1/.test(txt), "overdue count missing: " + txt.slice(0, 500));
  assert(/Escalate to exec/.test(txt), "overdue task not rendered");
  assert(/Call the champion/.test(txt), "today task not rendered");
  assert(/Northwind Analytics/.test(txt), "account name not rendered on the row");
  await browser.close();
});

test("Tasks view shows a distinct empty state when filters match nothing", async () => {
  const { page, browser } = await launch(QUEUE_SEED());
  await page.waitForFunction(() => window.__store && window.__store.getState().tasks.length);
  await openTasks(page);
  await page.getByPlaceholder("Search tasks…").fill("zzzznotathing");
  await page.waitForFunction(() => /No tasks match/.test(document.querySelector("#root")?.textContent || ""));
  const txt = await rootText(page);
  assert(/No tasks match these filters/.test(txt), "filtered empty state missing: " + txt.slice(0, 400));
  assert(!/Nothing in the queue/.test(txt), "should not show the no-tasks-at-all state when tasks exist");
  await browser.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `tests/health/`:

```
node run.mjs
```

Expected: both new tests FAIL — there is no "Tasks" nav button, so `getByRole(...).click()` times out. Everything else passes.

- [ ] **Step 3: Add the component**

In `crm.html`, immediately before `function Renewals(`:

```jsx
/* ------------------------------ tasks view ------------------------------ */
const SOURCE_GLYPH = { health: "♥", renewal: "▶", manual: "" };
function TasksView({ st, scored, dispatch, user, openAccount }) {
  const [scope, setScope] = useState("all");
  const [source, setSource] = useState("all");
  const [band, setBand] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState({ overdue: true, today: true, week: false, later: false, done: false });
  const byId = useMemo(() => Object.fromEntries(scored.map(a => [a.id, a])), [scored]);
  const filtered = filterTasks(st.tasks, byId, { scope, userName: user.name, source, band, q });
  const buckets = bucketTasks(filtered, iso(Date.now()));
  const total = Object.values(buckets).reduce((n, list) => n + list.length, 0);
  const SECTIONS = [
    ["overdue", "Overdue"], ["today", "Today"], ["week", "This week"], ["later", "Later"], ["done", "Done"],
  ];
  const Row = ({ t }) => {
    const a = byId[t.accountId];
    const late = t.status !== "Done" && t.due && daysUntil(t.due) < 0;
    return (
      <div className="flex items-center gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0">
        <input type="checkbox" checked={t.status === "Done"} title="Complete"
          onChange={() => dispatch({ type: "TOGGLE_TASK", id: t.id })} />
        <span className="w-4 text-center text-xs text-slate-400">{SOURCE_GLYPH[taskSource(t)]}</span>
        <span className={`flex-1 ${t.status === "Done" ? "text-slate-400 line-through" : ""}`}>{t.title}</span>
        <button className="text-xs text-indigo-600 hover:underline" onClick={() => openAccount(t.accountId)}>{a ? a.name : "—"}</button>
        <span className={`w-24 text-right text-xs ${late ? "font-semibold text-rose-600" : "text-slate-700"}`}>{t.due ? fmtDate(t.due) : "—"}</span>
        <span className="w-14 text-right text-xs text-slate-500">{t.priority}</span>
      </div>
    );
  };
  return (
    <Card title={`Work queue (${total})`} right={
      <div className="flex flex-wrap items-center gap-2">
        <Btn kind={scope === "mine" ? "primary" : "default"} onClick={() => setScope("mine")}>Mine</Btn>
        <Btn kind={scope === "all" ? "primary" : "default"} onClick={() => setScope("all")}>All</Btn>
        <Select value={source} title="Source" onChange={e => setSource(e.target.value)} options={["all", "health", "renewal", "manual"]} />
        <Select value={band} title="Health band" onChange={e => setBand(e.target.value)} options={["all", "Red", "Yellow", "Green"]} />
        <Input value={q} placeholder="Search tasks…" onChange={e => setQ(e.target.value)} className="w-44" />
      </div>
    }>
      {st.tasks.length === 0 && <p className="text-sm text-slate-500">Nothing in the queue — tasks appear here as playbooks seed them.</p>}
      {st.tasks.length > 0 && total === 0 && <p className="text-sm text-slate-500">No tasks match these filters.</p>}
      {SECTIONS.map(([key, label]) => buckets[key].length > 0 && (
        <div key={key} className="mb-3">
          <button className="mb-1 flex w-full items-center gap-2 text-left" onClick={() => setOpen(o => ({ ...o, [key]: !o[key] }))}>
            <span className={`text-xs font-bold uppercase tracking-widest ${key === "overdue" ? "text-rose-600" : "text-slate-500"}`}>{label}</span>
            <span className="text-xs text-slate-400">({buckets[key].length})</span>
            <span className="text-xs text-slate-400">{open[key] ? "▾" : "▸"}</span>
          </button>
          {open[key] && buckets[key].map(t => <Row key={t.id} t={t} />)}
        </div>
      ))}
    </Card>
  );
}
```

Add the nav icon to `NAV_ICONS` (a checklist), keeping the existing entries:

```jsx
  Tasks: <NavIcon><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></NavIcon>,
```

Change `VIEWS` so Tasks sits second:

```js
const VIEWS = ["Dashboard", "Tasks", "Accounts", "Renewals", "Settings"];
```

Add the render branch beside the other view branches (after the `Dashboard` line):

```jsx
      {view === "Tasks" && <TasksView st={st} scored={scored} dispatch={dispatch} user={user} openAccount={openAccount} />}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `tests/health/`:

```
node run.mjs
```

Expected: `40 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/tasks.test.mjs
git commit -m "feat: Tasks work-queue view with due-date sections and filters"
```

---

### Task 4: Row actions — complete and reschedule

**Files:**
- Modify: `crm.html` (the `Row` component inside `TasksView`)
- Modify: `tests/health/tasks.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: no new exports. Adds a due-date `Select` to each row dispatching `EDIT_TASK`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/health/tasks.test.mjs`:

```js
test("ticking a task completes it and moves it to Done", async () => {
  const { page, browser } = await launch(QUEUE_SEED());
  await page.waitForFunction(() => window.__store && window.__store.getState().tasks.length);
  await openTasks(page);
  await page.locator('input[type="checkbox"]').first().check();
  await page.waitForFunction(() => window.__store.getState().tasks.find(t => t.id === "q-over").status === "Done");
  const status = await page.evaluate(() => window.__store.getState().tasks.find(t => t.id === "q-over").status);
  assert(status === "Done", "task should be Done, got " + status);
  await browser.close();
});

test("rescheduling an overdue task moves it out of Overdue", async () => {
  const { page, browser } = await launch(QUEUE_SEED());
  await page.waitForFunction(() => window.__store && window.__store.getState().tasks.length);
  await openTasks(page);
  const before = await page.evaluate(() => window.__store.getState().tasks.find(t => t.id === "q-over").due);
  await page.locator('select[title="Reschedule"]').first().selectOption("7");
  await page.waitForFunction(d => window.__store.getState().tasks.find(t => t.id === "q-over").due !== d, before);
  const after = await page.evaluate(() => window.__store.getState().tasks.find(t => t.id === "q-over").due);
  const expected = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  assert(after === expected, `expected due ${expected}, got ${after}`);
  await browser.close();
});

test("the source filter hides health-playbook tasks when set to renewal", async () => {
  const { page, browser } = await launch(QUEUE_SEED());
  await page.waitForFunction(() => window.__store && window.__store.getState().tasks.length);
  await openTasks(page);
  assert(/Escalate to exec/.test(await rootText(page)), "health task should be visible before filtering");
  await page.locator('select[title="Source"]').selectOption("renewal");
  await page.waitForFunction(() => !/Escalate to exec/.test(document.querySelector("#root")?.textContent || ""));
  const txt = await rootText(page);
  assert(!/Escalate to exec/.test(txt), "health task should be hidden under the renewal filter");
  assert(/Send renewal quote/.test(txt), "renewal task should still be visible");
  await browser.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `tests/health/`:

```
node run.mjs
```

Expected: the completion test may already pass (the checkbox exists from Task 3), but the reschedule test FAILS because no `select[title="Reschedule"]` exists. Confirm which fail before implementing; that is the point of this step.

- [ ] **Step 3: Add the reschedule control**

Inside `TasksView`'s `Row`, add this local state at the top of the `Row` component:

```jsx
    const [custom, setCustom] = useState(false);
```

The shared `Select` component renders `options` as plain strings, so its label and value are always identical. This control needs distinct labels and values ("+1 week" → `7`), so use a plain `<select>` styled with the same classes. Insert it between the account button and the due-date span:

```jsx
        <select value="" title="Reschedule" className="nm-inset border-0 px-2 py-1 text-xs text-slate-700 outline-none"
          onChange={e => {
            const v = e.target.value;
            if (v === "custom") { setCustom(true); return; }
            if (v !== "") dispatch({ type: "EDIT_TASK", id: t.id, patch: { due: isoPlus(iso(Date.now()), +v) } });
          }}>
          <option value="">⋯</option>
          <option value="0">Today</option>
          <option value="1">Tomorrow</option>
          <option value="7">+1 week</option>
          <option value="custom">Pick date…</option>
        </select>
        {custom && <input type="date" className="nm-inset border-0 px-2 py-1 text-xs" autoFocus
          onChange={e => { if (e.target.value) { dispatch({ type: "EDIT_TASK", id: t.id, patch: { due: e.target.value } }); setCustom(false); } }} />}
```

The `value=""` with a `⋯` placeholder option makes this a fire-and-reset control: it always displays the placeholder rather than a sticky selection, so picking the same option twice in a row still fires `onChange`.

- [ ] **Step 4: Run the tests to verify they pass**

Run from `tests/health/`:

```
node run.mjs
```

Expected: `43 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/tasks.test.mjs
git commit -m "feat: complete and reschedule tasks inline from the work queue"
```

## Self-Review Notes

Spec coverage: `bucketTasks` incl. the no-due-date and Done cases (Task 1), `filterTasks` all four filters (Task 2), the view, sections, counts, collapse state, both empty states, and nav/palette wiring (Task 3), row completion and rescheduling (Task 4). Spec tests 1-12 all map to a task.

Two spec details deliberately simplified: the scope toggle is rendered as two `Btn`s rather than a bespoke control (matches how the dashboard does it), and section collapse state is local rather than persisted, per the spec's "not persisted" rule for filters.
