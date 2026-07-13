# Renewal Playbooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-create a shared, editable checklist of renewal tasks for every account that enters the 90-day renewal window.

**Architecture:** All product changes live in `crm.html` (single-file React-in-Babel + Supabase). One new default template constant + helper, two new reducer actions (`SET_PLAYBOOK`, `SEED_PLAYBOOK`) with write-through persistence, one seeding `useEffect` in `App`, one Settings editor card, and a progress pill in the Renewals month grid. Verification via the session's Playwright E2E harness (mocked Supabase, headless Edge).

**Tech Stack:** React 18 UMD + Babel in `crm.html`, Supabase JS v2, Tailwind CDN classes, Playwright (`channel: "msedge"`) for E2E.

## Global Constraints

- **All changes to `crm.html` are strictly additive** — existing features must be preserved exactly.
- Merging to master deploys the live team app (GitHub Pages) — work on branch `feat/renewal-playbooks`, PR via `gh` with `--body-file`.
- **Dates are ISO `YYYY-MM-DD` strings compared textually** (`t.due < iso(Date.now())`), never via `new Date()` comparisons — UTC-vs-local has bitten twice.
- Spec: `docs/superpowers/specs/2026-07-13-renewal-playbooks-design.md`.
- The E2E harness is scratch — never commit `crm-test*.html`, `drive*.js`, or screenshots.
- Existing code landmarks (line numbers as of commit `b4c5d0a`): helpers `iso/addDays/daysUntil/uid` at `crm.html:70-80`, `fetchAll` settings merge at `crm.html:244-245`, `persist()` settings case at `crm.html:272`, reducer at `crm.html:291-346`, `RENEWAL_STAGES` at `crm.html:1717`, `Renewals` component at `crm.html:1723`, `Settings` component at `crm.html:1773`, `App` snapshot effect at `crm.html:2047-2064`, view wiring at `crm.html:2142-2143`.

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```powershell
git checkout -b feat/renewal-playbooks
```

---

### Task 1: Playbook engine — template, actions, persistence

**Files:**
- Modify: `crm.html` (helpers near line 80, `fetchAll` line 244-245, `persist()` line 252-274, `reducer()` line 291-346, new constants before `/* ----- tiny charts ----- */` at line 348)

**Interfaces:**
- Produces: `DEFAULT_PLAYBOOK` (array of `{ id, title, offsetDays, priority }`), `playbookOf(settings)` → array, `isoMinus(dateStr, days)` → ISO string, reducer actions `SET_PLAYBOOK { playbook }` and `SEED_PLAYBOOK { id, seededFor, items }`. Seeded task shape: `{ id, accountId, title: "▶ …", due, priority, status: "Open", owner, playbook: true, renewalFor }`. Account field `playbookSeededFor` (ISO string).

- [ ] **Step 1: Add the date helper**

After `const daysSince = …` (`crm.html:73`), add:

```js
const isoMinus = (dateStr, days) => iso(new Date(dateStr).getTime() - days * DAY);
```

- [ ] **Step 2: Add the default template + accessor**

Immediately before `/* ----------------------------- tiny charts ----------------------------- */` (`crm.html:348`), add:

```js
/* --------------------------- renewal playbook --------------------------- */
/* Shared checklist template; offsetDays = days before the renewal date the task is due.
 * settings.playbook stays unset until first edited in Settings — the default applies meanwhile. */
const DEFAULT_PLAYBOOK = [
  { id: "pb90", title: "Renewal kickoff call", offsetDays: 90, priority: "High" },
  { id: "pb75", title: "Health & usage review", offsetDays: 75, priority: "Medium" },
  { id: "pb60", title: "Send renewal quote", offsetDays: 60, priority: "High" },
  { id: "pb45", title: "Negotiate terms", offsetDays: 45, priority: "High" },
  { id: "pb30", title: "Confirm commercials", offsetDays: 30, priority: "High" },
  { id: "pb14", title: "Contract out for signature", offsetDays: 14, priority: "High" },
  { id: "pb7", title: "Confirm signature & billing", offsetDays: 7, priority: "High" },
];
const playbookOf = settings => settings.playbook || DEFAULT_PLAYBOOK;
```

- [ ] **Step 3: Round-trip `settings.playbook` through `fetchAll`**

In `fetchAll` (`crm.html:244-245`), the settings object is rebuilt field-by-field, so an unknown field is silently dropped on load. Change:

```js
      integrations: { processed: {}, log: [], ...(saved.integrations || {}) }, snapshots: saved.snapshots || [] },
```

to:

```js
      integrations: { processed: {}, log: [], ...(saved.integrations || {}) }, snapshots: saved.snapshots || [], playbook: saved.playbook },
```

- [ ] **Step 4: Reducer cases**

In `reducer()`, after `case "SET_SNAPSHOTS": …` (`crm.html:343`), add:

```js
    case "SET_PLAYBOOK": return { ...state, settings: { ...state.settings, playbook: action.playbook } };
    case "SEED_PLAYBOOK": return { ...state,
      tasks: [...state.tasks, ...action.items],
      accounts: state.accounts.map(a => a.id === action.id ? { ...a, playbookSeededFor: action.seededFor } : a) };
```

- [ ] **Step 5: Persistence cases**

In `persist()`, extend the settings case (`crm.html:272`) from

```js
    case "SET_WEIGHTS": case "SET_RATES": case "SET_INTEGRATIONS": case "SET_SNAPSHOTS":
```

to

```js
    case "SET_WEIGHTS": case "SET_RATES": case "SET_INTEGRATIONS": case "SET_SNAPSHOTS": case "SET_PLAYBOOK":
```

and after `case "ADD_TASK": …` (`crm.html:260`), add:

```js
    case "SEED_PLAYBOOK": { action.items.forEach(t => up("tasks", t)); const a = next.accounts.find(x => x.id === action.id); return a && up("accounts", a); }
```

- [ ] **Step 6: Sanity check + commit**

Open `crm.html` in a browser (or just re-scan the diff) — no syntax errors, app still boots to the login/setup screen. Then:

```powershell
git add crm.html; git commit -m "feat: renewal playbook template, actions and persistence"
```

---

### Task 2: Auto-seeding effect in App

**Files:**
- Modify: `crm.html` — inside `App`, immediately after the monthly-snapshot `useEffect` (ends `crm.html:2064`)

**Interfaces:**
- Consumes: `playbookOf`, `isoMinus`, `SEED_PLAYBOOK` (Task 1); existing `loaded`, `st`, `dispatch`, `daysUntil`, `uid`.
- Produces: tasks with `playbook: true` and `renewalFor` set; accounts stamped `playbookSeededFor`.

- [ ] **Step 1: Add the effect**

```js
  useEffect(() => { // auto-create renewal playbook tasks when an account is within 90d of renewal
    if (!loaded) return;
    const pb = playbookOf(st.settings);
    if (!pb.length) return;
    st.accounts.forEach(a => {
      // no lower bound on daysUntil: accounts already past renewal still seed (spec: include overdue)
      if (a.churn || daysUntil(a.renewalDate) > 90 || a.playbookSeededFor === a.renewalDate) return;
      const items = pb.filter(p => p.title.trim()).map(p => ({
        id: uid(), accountId: a.id, playbook: true, renewalFor: a.renewalDate,
        title: "▶ " + p.title, due: isoMinus(a.renewalDate, p.offsetDays),
        priority: p.priority, status: "Open", owner: a.csm || "" }));
      if (items.length) dispatch({ type: "SEED_PLAYBOOK", id: a.id, seededFor: a.renewalDate, items });
    });
  }, [loaded, st.accounts, st.settings.playbook]);
```

Notes for the implementer:
- The stamp `playbookSeededFor === renewalDate` makes this idempotent across reloads AND re-arms automatically when `COMPLETE_RENEWAL` moves `renewalDate` forward.
- Items with a blank title (possible via the Settings editor) are skipped; if all are blank, no dispatch and **no stamp** — that is acceptable (it will retry next load, still creating nothing).
- The dispatch inside the effect changes `st.accounts`, re-firing the effect; the stamp check terminates the loop after one pass per account.

- [ ] **Step 2: Manual smoke check**

Serve the repo locally is not possible against real Supabase without touching team data — rely on reading the diff plus the Task 5 E2E run. Verify only that Babel parses: open `crm.html` via `file://` in a browser and confirm no console syntax error before the (expected) network failures.

- [ ] **Step 3: Commit**

```powershell
git add crm.html; git commit -m "feat: auto-seed renewal playbook tasks inside the 90-day window"
```

---

### Task 3: Settings — playbook editor card

**Files:**
- Modify: `crm.html` — new `PlaybookCard` component directly above `function Settings` (`crm.html:1773`), rendered inside `Settings` after `<IntegrationsCard …/>` (`crm.html:1820`)

**Interfaces:**
- Consumes: `playbookOf`, `SET_PLAYBOOK` (Task 1); existing `Card`, `Input`, `Select`, `Btn`, `uid`.

- [ ] **Step 1: Add the component**

```js
function PlaybookCard({ st, dispatch }) {
  const pb = playbookOf(st.settings);
  const setPb = list => dispatch({ type: "SET_PLAYBOOK", playbook: list });
  const edit = (id, patch) => setPb(pb.map(p => p.id === id ? { ...p, ...patch } : p));
  return (
    <Card title="Renewal playbook">
      {pb.map(p => (
        <div key={p.id} className="mb-2 flex items-center gap-2 text-sm">
          <Input value={p.title} placeholder="Step…" onChange={e => edit(p.id, { title: e.target.value })} className="flex-1 min-w-[160px]" />
          <Input type="number" min="0" max="365" value={p.offsetDays} title="Days before renewal"
            onChange={e => edit(p.id, { offsetDays: Math.min(365, Math.max(0, Math.round(+e.target.value || 0))) })} className="w-20" />
          <span className="whitespace-nowrap text-xs text-slate-500">d before</span>
          <Select value={p.priority} onChange={e => edit(p.id, { priority: e.target.value })} options={["High", "Medium", "Low"]} />
          <button title="Remove step" className="text-rose-400 hover:text-rose-600" onClick={() => setPb(pb.filter(x => x.id !== p.id))}>✕</button>
        </div>
      ))}
      <Btn onClick={() => setPb([...pb, { id: uid(), title: "", offsetDays: 30, priority: "Medium" }])}>+ Add step</Btn>
      <p className="mt-3 text-xs text-slate-500">When an account comes within 90 days of renewal, one task per step is created automatically for its CSM (due = renewal date − days, marked ▶). Edits apply to accounts seeded from then on; already-created tasks are unchanged. Shared by the whole team.</p>
    </Card>
  );
}
```

(First edit materializes the default template into `settings.playbook` — intended per spec.)

- [ ] **Step 2: Render it in Settings**

In `Settings`'s JSX, change

```js
      <IntegrationsCard st={st} dispatch={dispatch} />
```

to

```js
      <IntegrationsCard st={st} dispatch={dispatch} />
      <PlaybookCard st={st} dispatch={dispatch} />
```

- [ ] **Step 3: Commit**

```powershell
git add crm.html; git commit -m "feat: editable renewal playbook in Settings"
```

---

### Task 4: Renewals view — playbook progress pill

**Files:**
- Modify: `crm.html` — `Renewals` component signature (`crm.html:1723`), account card JSX (`crm.html:1754-1762`), view wiring (`crm.html:2142`)

**Interfaces:**
- Consumes: seeded task fields `playbook`, `renewalFor`, `status`, `due` (Task 2).

- [ ] **Step 1: Pass tasks into Renewals**

At `crm.html:2142`, change

```js
      {view === "Renewals" && <Renewals scored={active} openAccount={openAccount} dispatch={dispatch} allBook={scored} rates={st.settings.rates} snapshots={st.settings.snapshots || []} />}
```

to

```js
      {view === "Renewals" && <Renewals scored={active} openAccount={openAccount} dispatch={dispatch} allBook={scored} rates={st.settings.rates} snapshots={st.settings.snapshots || []} tasks={st.tasks} />}
```

and the component signature at `crm.html:1723` to

```js
function Renewals({ scored, openAccount, dispatch, allBook = [], rates = {}, snapshots = [], tasks = [] }) {
```

- [ ] **Step 2: Add the pill to the month-grid account card**

Inside the account card, directly after the `<select …>{RENEWAL_STAGES.map(…)}</select>` closing tag (`crm.html:1761`), add:

```js
              {(() => {
                const pt = tasks.filter(t => t.accountId === a.id && t.playbook && t.renewalFor === a.renewalDate);
                if (!pt.length) return null;
                const done = pt.filter(t => t.status === "Done").length;
                const behind = pt.some(t => t.status !== "Done" && t.due < iso(Date.now())); // textual ISO compare
                return <span title={behind ? "Playbook behind pace — an open step is past due" : "Playbook on pace"}
                  className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${behind ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{done}/{pt.length} ✓</span>;
              })()}
```

(`renewalFor === a.renewalDate` scopes the pill to the current cycle; tasks from a completed prior cycle no longer match. Pill hidden when the account hasn't seeded.)

- [ ] **Step 3: Commit**

```powershell
git add crm.html; git commit -m "feat: playbook progress pill on Renewals month grid"
```

---

### Task 5: E2E verification via the Playwright harness

**Files:**
- Create (scratch, this session's scratchpad): `…\scratchpad\e2e\` copied from the previous harness at `C:\Users\manish.w\AppData\Local\Temp\claude\D--AI-Project-My-Company\bd69e494-82f1-4374-a17d-39e897e39ae1\scratchpad\e2e\` (has `node_modules/playwright`, `drive.js`, `drive2.js`, and mocked `crm-test.html`)
- No repo files committed from this task except nothing — harness stays scratch.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Copy the harness and rebuild the mocked page**

```powershell
Copy-Item -Recurse "C:\Users\manish.w\AppData\Local\Temp\claude\D--AI-Project-My-Company\bd69e494-82f1-4374-a17d-39e897e39ae1\scratchpad\e2e" "<THIS_SESSION_SCRATCHPAD>\e2e"
```

Then copy the current `crm.html` over `<scratchpad>\e2e\crm-test.html` and re-apply the mock exactly as before: replace the line

```js
const sb = CONFIGURED ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
```

with the full `__mockSb` block from the OLD `crm-test.html` (it defines `TEST_PROFILE`, `__mkSnaps`, `__mockSb`, `const sb = __mockSb();`, incl. `channel`/`removeChannel` stubs), and re-add, before `const emptyData = …`:

```js
window.__seed = seedData(); // E2E harness: demo data served by the Supabase mock
```

- [ ] **Step 2: Shape the seed for playbook scenarios**

Directly after the `window.__seed = seedData();` line add:

```js
(() => { // playbook test fixtures
  const A = window.__seed.accounts;
  A.find(a => a.id === "a1").renewalDate = addDays(50);   // mid-window: overdue 90/75/60d items + future ones
  A.find(a => a.id === "a4").renewalDate = addDays(200);  // outside window: must NOT seed
  A.find(a => a.id === "a6").renewalDate = addDays(-5);   // past due: still seeds (no lower bound)
})();
```

(`a2` at +130d and the churn-free rest stay as regression coverage; note the stock seed has no churned account — churn one in-test if needed, or skip check 8 below if none exists.)

- [ ] **Step 3: Write `drive3.js`**

Same skeleton as `drive2.js` (launch `chromium.launch({ channel: "msedge", headless: true })`, `page.on("pageerror")` logging, `goto` the `file://` URL of `crm-test.html`, wait for `text=Total ARR`, a `check(name, cond)` helper tallying failures, `process.exit(fails ? 1 : 0)`). Checks:

1. **Seeding count:** via `page.evaluate` read the mock store's tasks — `a1` has exactly 7 tasks with `playbook: true, renewalFor` = its renewalDate; owner equals `a1`'s CSM (`Priya`); every title starts with `"▶ "`.
2. **Overdue included:** among `a1`'s playbook tasks, the 90d/75d/60d items have `due < today` (textual compare) and are `status: "Open"`.
3. **Due-date math:** the 90d item's `due` string equals `isoMinus(renewalDate, 90)` computed in-page.
4. **No seed outside window:** `a4` has zero playbook tasks; `playbookSeededFor` unset.
5. **Past-due seeds:** `a6` (renewal −5d) has 7 playbook tasks.
6. **Idempotent:** `page.reload()`, wait, re-count — still exactly 7 for `a1` (stamp survived via the mock store).
7. **Re-arm on renewal:** in-page, open `a1`'s account, use Complete renewal (or dispatch via UI: click account → "✓ Complete renewal" → Save); after state settles, `a1` has a second batch of 7 playbook tasks with the NEW `renewalFor`, and the Renewals pill for `a1` shows `0/7 ✓`.
8. **Renewals pill:** navigate to Renewals view (`press "3"`), assert `a1`'s card shows text `/\d+\/7 ✓/` and it carries the amber class (behind pace, since overdue items exist).
9. **Settings editor:** navigate to Settings (`press "4"` — Settings is the 4th view in `VIEWS` and the mock profile is admin), assert the "Renewal playbook" card lists 7 rows; delete one row, add a step titled "Exec sponsor email" with 20d; then via `page.evaluate` confirm `settings.playbook` in the mock store has 7 entries (7 − 1 + 1) and the new one persists after reload.
10. **New template applies:** after the edit, in-page move `a2`'s renewalDate into the window via the account edit UI (or a dispatched EDIT_ACCOUNT through the UI date field) → `a2` seeds with the EDITED template (no deleted step, includes "▶ Exec sponsor email").
11. **No pageerror lines** across the whole run.

- [ ] **Step 4: Run**

```powershell
node drive3.js
```

Expected: all checks PASS, exit 0, no PAGEERROR lines. Also run the previous suites for regression: `node drive.js` and `node drive2.js` against the rebuilt `crm-test.html` — expect their existing checks all green (playbook tasks now exist in the seeded state; if a prior check asserts an exact open-task count, update the harness copy of that expectation, not the product).

- [ ] **Step 5: Screenshots for the PR**

Capture `shot-playbook-settings.png` (Settings card), `shot-playbook-pill.png` (Renewals grid) via `page.screenshot`.

- [ ] **Step 6: Nothing to commit** — harness is scratch. Confirm `git status` shows only `crm.html` changes already committed.

---

### Task 6: PR and merge

- [ ] **Step 1: Push and open the PR**

```powershell
git push -u origin feat/renewal-playbooks
```

Write the PR body to a temp file (PowerShell mangles inline quoting), then:

```powershell
gh pr create --title "feat: renewal playbooks — auto-created 90-day checklist" --body-file <scratchpad>\pr-body.md
```

Body covers: what/why, the seeding rules (90d trigger, overdue included, re-arm on renewal), Settings editor, Renewals pill, E2E evidence (check counts + screenshots), and the additive-only guarantee. End with the standard Claude Code attribution line.

- [ ] **Step 2: Merge after user approval**

```powershell
gh pr merge --merge
```

Master push auto-deploys to GitHub Pages.
