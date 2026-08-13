# Bulk Actions, Saved Segments, and Undo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-select bulk actions and team-shared saved segments to the account list, replace all blocking `alert()` calls with a non-blocking toast system carrying snapshot-based undo, and add the app's first accessibility attributes.

**Architecture:** `crm.html` is a single-file React app (~2,862 lines) compiled in-browser by Babel. State lives in one `useReducer`-style store: `reducer(state, action)` produces the next state and `persist(action, next)` mirrors it into Supabase. All new mutations follow that same pair. Undo is snapshot-based: a bulk action captures the prior records of everything it touches, and the toast's Undo button dispatches `RESTORE_SNAPSHOT` with that capture. Saved segments live in `settings.segments`, following the existing `SET_PLAYBOOK` pattern exactly, so they sync team-wide with no schema change.

**Tech Stack:** React 18 + Babel standalone (in-browser JSX), Tailwind utility classes, Supabase JS client, Playwright (headless Edge) for E2E tests.

**Spec:** `docs/superpowers/specs/2026-08-12-bulk-segments-undo-design.md`

## Global Constraints

- **Every change is additive.** No existing behavior, prop, or component may be removed or renamed. Merging to `master` deploys the live team app immediately.
- **All 13 existing test files in `tests/health/` must pass unchanged** at every commit. This is the merge gate, not the new tests.
- **Run tests with:** `cd tests && node health/run.mjs` (from the repo root: `node tests/health/run.mjs`).
- **Line numbers in this plan are locators, not contracts.** Match on the surrounding code, not the number.
- **Date comparisons compare ISO strings textually** — never round-trip through `Date`. UTC-vs-local has broken tests here twice.
- **Existing helpers to reuse (do not reimplement):** `uid()` (line 82), `iso(d)` (line 70), `withAudit(a, entries)` (line 241), `fmtMoney`, `fmtDate`, `daysUntil`.
- **Existing UI primitives:** `Card({title, right, children, className, id})` (623), `Btn({children, onClick, kind, type, disabled})` (649), `Input` (652, forwardRef), `Select({options, ...props})` (653) where `options` is an array of strings.
- **Constants to reuse:** `CHURN_REASONS` (880), `ENTITY_TABLES` (244).
- **`window.__store = { getState, dispatch }`** is already exposed (line 2631). Tests drive the reducer through it.
- **Commit after every task.** Branch: `feat/bulk-segments-undo`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `crm.html` | The entire app | Modify — all production changes land here |
| `tests/health/toast.test.mjs` | Toast lifecycle and error persistence | Create (Task 1) |
| `tests/health/bulk.test.mjs` | Bulk reducer cases, selection math, undo restore | Create (Tasks 2–5) |
| `tests/health/segments.test.mjs` | Segment save/apply/rename/delete, filter merge | Create (Task 6) |
| `tests/health/a11y.test.mjs` | ARIA attributes and the Escape-collision regression | Create (Task 7) |
| `tests/health/run.mjs` | Test registry | Modify — one `import` line per new file |

`crm.html` is a deliberately single-file app; do not split it. New components are added inline in the section matching their role, as noted per task.

---

### Task 0: Create the feature branch

- [ ] **Step 1: Branch from master**

```bash
git checkout master
git pull
git checkout -b feat/bulk-segments-undo
```

- [ ] **Step 2: Confirm the existing suite is green before touching anything**

Run: `node tests/health/run.mjs`
Expected: all cases PASS, final line `N passed, 0 failed`. If anything fails here, stop and report — it is a pre-existing break, not yours.

---

### Task 1: Toast infrastructure and `alert()` replacement

**Files:**
- Modify: `crm.html` — add `ToastProvider`/`useToast` after the UI primitives (~line 656); rewrite `dbError` (245); convert 7 more `alert()` sites; mount the provider in `Root`/`App`
- Create: `tests/health/toast.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `pushToast({ text, tone, undo })` → `string` (the toast id). `tone` is `"info" | "success" | "error"`, default `"info"`. `undo` is an optional `() => void`; when present the toast renders an Undo button and lives 10000ms. `info`/`success` without `undo` live 5000ms. `error` never auto-dismisses.
  - `useToast()` → `pushToast`. Every later task obtains `pushToast` this way.
  - `window.__toast = pushToast` for test access.

- [ ] **Step 1: Write the failing test**

Create `tests/health/toast.test.mjs`:

```javascript
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("error toasts persist and info toasts auto-dismiss", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__toast);
  const res = await page.evaluate(async () => {
    window.__toast({ text: "boom", tone: "error" });
    window.__toast({ text: "hello", tone: "info" });
    await new Promise(r => setTimeout(r, 100));
    const both = document.querySelectorAll("[data-toast]").length;
    await new Promise(r => setTimeout(r, 5400));
    const after = [...document.querySelectorAll("[data-toast]")].map(n => n.getAttribute("data-tone"));
    return { both, after };
  });
  assert(res.both === 2, `expected 2 toasts, got ${res.both}`);
  assert(res.after.length === 1 && res.after[0] === "error", `error toast should survive, got ${JSON.stringify(res.after)}`);
  await browser.close();
});

test("undo toast exposes an Undo button that fires the callback", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__toast);
  const fired = await page.evaluate(async () => {
    window.__undoFired = false;
    window.__toast({ text: "did a thing", tone: "success", undo: () => { window.__undoFired = true; } });
    await new Promise(r => setTimeout(r, 100));
    document.querySelector("[data-toast-undo]").click();
    await new Promise(r => setTimeout(r, 100));
    return { flag: window.__undoFired, gone: document.querySelectorAll("[data-toast]").length };
  });
  assert(fired.flag === true, "undo callback did not fire");
  assert(fired.gone === 0, "toast should dismiss after undo");
  await browser.close();
});

test("error toast is announced assertively", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__toast);
  const role = await page.evaluate(async () => {
    window.__toast({ text: "boom", tone: "error" });
    await new Promise(r => setTimeout(r, 100));
    return document.querySelector("[data-toast]").getAttribute("role");
  });
  assert(role === "alert", `expected role=alert, got ${role}`);
  await browser.close();
});
```

Register it in `tests/health/run.mjs` after the `tasks.test.mjs` import:

```javascript
import "./toast.test.mjs";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/health/run.mjs`
Expected: the three toast cases FAIL (timeout waiting for `window.__toast`). All 13 existing files still PASS.

- [ ] **Step 3: Add the toast system**

Insert after the `Select` primitive (after line ~656 in `crm.html`):

```jsx
/* ------------------------------ toasts ------------------------------ */
const ToastCtx = React.createContext(() => {});
const useToast = () => useContext(ToastCtx);
const TOAST_TONE = {
  info: "border-slate-300 text-slate-800",
  success: "border-emerald-300 text-emerald-800",
  error: "border-rose-300 text-rose-700",
};
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});
  const dismiss = useCallback(id => {
    clearTimeout(timers.current[id]); delete timers.current[id];
    setToasts(ts => ts.filter(t => t.id !== id));
  }, []);
  const pushToast = useCallback(({ text, tone = "info", undo }) => {
    const id = uid();
    // errors never auto-dismiss: a failed write may not have reached the team
    setToasts(ts => [...ts, { id, text, tone, undo }].slice(-3));
    if (tone !== "error") timers.current[id] = setTimeout(() => dismiss(id), undo ? 10000 : 5000);
    return id;
  }, [dismiss]);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  useEffect(() => { window.__toast = pushToast; }, [pushToast]);
  return (
    <ToastCtx.Provider value={pushToast}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} data-toast data-tone={t.tone} role={t.tone === "error" ? "alert" : "status"}
               className={`nm flex items-start gap-2 border-l-4 p-3 text-sm ${TOAST_TONE[t.tone]}`}>
            <span className="flex-1 whitespace-pre-line">{t.text}</span>
            {t.undo && <button data-toast-undo className="font-bold text-indigo-600 hover:underline"
              onClick={() => { t.undo(); dismiss(t.id); }}>Undo</button>}
            <button aria-label="Dismiss notification" className="text-slate-400 hover:text-slate-700"
              onClick={() => dismiss(t.id)}>✕</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
```

If `useContext` is not already in the React destructuring line near the top of the script, add it there alongside `useState`/`useEffect`/`useMemo`/`useRef`/`useCallback`.

- [ ] **Step 4: Mount the provider**

`ToastProvider` must wrap everything that renders. Find where `Root` renders `<App user={...} />` and wrap the outermost rendered element:

```jsx
<ToastProvider><App user={...} /></ToastProvider>
```

Mount it high enough that `dbError` (a module-scope function, not a component) can reach it — `dbError` uses the `window.__toast` escape hatch, which the provider sets in Step 3.

- [ ] **Step 5: Convert `dbError` (module scope, line ~245)**

```javascript
const dbError = (where, error) => {
  console.error(where, error);
  const text = `Save failed (${where}): ${error.message}\nYour last change may not be shared — reload to resync.`;
  if (window.__toast) window.__toast({ text, tone: "error" }); else alert(text);
};
```

The `alert` fallback stays for the window before the provider mounts. This is the only surviving `alert` in the file.

- [ ] **Step 6: Convert the 7 remaining `alert()` sites**

Each of these is inside a component, so call `const toast = useToast();` at the top of that component and replace the `alert(...)` call. Keep the message text and all surrounding control flow (`return`, `setBusy(false)`) exactly as-is.

| Locator | Replacement |
|---|---|
| `alert("Could not delete file: " + error.message)` (~791) | `toast({ text: "Could not delete file: " + error.message, tone: "error" })` |
| `alert("Upload failed: " + ex.message)` (~822) | `toast({ text: "Upload failed: " + ex.message, tone: "error" })` |
| `alert("Upload failed: " + ex.message)` (~860) | `toast({ text: "Upload failed: " + ex.message, tone: "error" })` |
| `alert("Bulk update failed: " + ex.message)` (~2327) | `toast({ text: "Bulk update failed: " + ex.message, tone: "error" })` |
| `alert("Imported for the whole team.")` (~2332) | `toast({ text: "Imported for the whole team.", tone: "success" })` |
| `alert(ex && ex.message ? ... : "Invalid JSON file.")` (~2332) | same expression, wrapped as `toast({ text: <expr>, tone: "error" })` |
| `alert("Could not load shared data: " + e.message)` (~2634) | `toast({ text: "Could not load shared data: " + e.message, tone: "error" })` |
| `alert("Could not load your profile: " + error.message)` (~2850) | `toast({ text: "Could not load your profile: " + error.message, tone: "error" })` |

For the two sites inside `App` (~2634) and `Root` (~2850), `useToast()` works if the component is inside `ToastProvider`. If `Root` sits *outside* the provider, use `window.__toast?.({...}) ?? alert(...)` there instead — do not restructure `Root`.

- [ ] **Step 7: Verify no stray alerts remain**

Run: `grep -n "alert(" crm.html`
Expected: exactly 2 hits, both inside `dbError` and any `Root` fallback from Step 6 — each guarded by a `window.__toast` check.

- [ ] **Step 8: Run all tests**

Run: `node tests/health/run.mjs`
Expected: PASS on all cases including the 3 new toast cases, `0 failed`.

- [ ] **Step 9: Commit**

```bash
git add crm.html tests/health/toast.test.mjs tests/health/run.mjs
git commit -m "feat: non-blocking toast system, replacing blocking alert() calls"
```

---

### Task 2: Non-destructive bulk reducer cases

**Files:**
- Modify: `crm.html` — add `BULK_PATCH_ACCOUNTS` and `BULK_ADD_TASKS` to `reducer` (~line 403, beside `SET_WEIGHTS`) and to `persist` (~line 288)
- Create: `tests/health/bulk.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: `withAudit(a, entries)`, `uid()`, `iso()`.
- Produces:
  - `{ type: "BULK_PATCH_ACCOUNTS", ids: string[], patch: object, by: string }` — applies `patch` to every account in `ids`, writing one audit entry per changed field with `source: "bulk"`.
  - `{ type: "BULK_ADD_TASKS", items: Task[] }` — appends all tasks.
  - `{ type: "RESTORE_SNAPSHOT", snapshot }` — defined fully in Task 3; Task 2 only needs `snapshot.accounts`.

- [ ] **Step 1: Write the failing test**

Create `tests/health/bulk.test.mjs`:

```javascript
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "a1", name: "Alpha", csm: "Priya", tier: "Mid" });
const B = seedAccount({ id: "a2", name: "Beta", csm: "Priya", tier: "SMB" });
export const seed = `window.__seedRows = { accounts: ${JSON.stringify([A, B])}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("BULK_PATCH_ACCOUNTS reassigns CSM and writes one audit entry each", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const res = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_PATCH_ACCOUNTS", ids: ["a1", "a2"], patch: { csm: "Dana" }, by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    const s = window.__store.getState();
    return s.accounts.map(a => ({ id: a.id, csm: a.csm, audit: (a.audit || []).map(e => [e.field, e.from, e.to, e.source]) }));
  });
  assert(res.every(a => a.csm === "Dana"), "csm not reassigned on both");
  assert(res.every(a => a.audit.length === 1), "expected exactly one audit entry per account");
  assert(res[0].audit[0][0] === "csm" && res[0].audit[0][1] === "Priya" && res[0].audit[0][2] === "Dana", "audit from/to wrong");
  assert(res[0].audit[0][3] === "bulk", "audit source should be 'bulk'");
  await browser.close();
});

test("BULK_PATCH_ACCOUNTS writes no audit entry when the value is unchanged", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const audits = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_PATCH_ACCOUNTS", ids: ["a1"], patch: { csm: "Priya" }, by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    return (window.__store.getState().accounts.find(a => a.id === "a1").audit || []).length;
  });
  assert(audits === 0, `expected no audit entry for a no-op change, got ${audits}`);
  await browser.close();
});

test("BULK_PATCH_ACCOUNTS ignores ids that do not exist", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const n = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_PATCH_ACCOUNTS", ids: ["a1", "nope"], patch: { tier: "Enterprise" }, by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().accounts.length;
  });
  assert(n === 2, `account count changed, got ${n}`);
  await browser.close();
});

test("BULK_ADD_TASKS appends one task per account", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const tasks = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_ADD_TASKS", items: [
      { id: "bt1", accountId: "a1", title: "Check in", due: "2026-09-01", owner: "Dana", status: "Open" },
      { id: "bt2", accountId: "a2", title: "Check in", due: "2026-09-01", owner: "Dana", status: "Open" },
    ] });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().tasks.map(t => t.id);
  });
  assert(tasks.length === 2 && tasks.includes("bt1") && tasks.includes("bt2"), `tasks not appended: ${JSON.stringify(tasks)}`);
  await browser.close();
});
```

Register in `tests/health/run.mjs`:

```javascript
import "./bulk.test.mjs";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/health/run.mjs`
Expected: the 4 bulk cases FAIL (no state change — unknown action types fall through the reducer). Everything else PASSes.

- [ ] **Step 3: Add the reducer cases**

In `reducer`, immediately before `case "SET_WEIGHTS":` (~line 403):

```javascript
    case "BULK_PATCH_ACCOUNTS": {
      const ids = new Set(action.ids);
      return { ...state, accounts: state.accounts.map(a => {
        if (!ids.has(a.id)) return a;
        // one audit entry per genuinely-changed field, matching EDIT_ACCOUNT's shape
        const entries = Object.entries(action.patch)
          .filter(([f, v]) => a[f] !== v)
          .map(([f, v]) => ({ id: uid(), date: iso(Date.now()), field: f, from: a[f], to: v, by: action.by, source: "bulk" }));
        return withAudit({ ...a, ...action.patch }, entries);
      }) };
    }
    case "BULK_ADD_TASKS": return { ...state, tasks: [...state.tasks, ...action.items] };
```

- [ ] **Step 4: Add the persist cases**

In `persist`, add a new case beside the existing account-upsert group (~line 288):

```javascript
    case "BULK_PATCH_ACCOUNTS": {
      const ids = new Set(action.ids);
      next.accounts.filter(a => ids.has(a.id)).forEach(a => up("accounts", a));
      return;
    }
    case "BULK_ADD_TASKS": return action.items.forEach(t => up("tasks", t));
```

- [ ] **Step 5: Run all tests**

Run: `node tests/health/run.mjs`
Expected: `0 failed`.

- [ ] **Step 6: Commit**

```bash
git add crm.html tests/health/bulk.test.mjs tests/health/run.mjs
git commit -m "feat: BULK_PATCH_ACCOUNTS and BULK_ADD_TASKS reducer cases"
```

---

### Task 3: Destructive bulk cases and the undo snapshot

**Files:**
- Modify: `crm.html` — `BULK_CHURN`, `BULK_DELETE`, `RESTORE_SNAPSHOT` in `reducer` and `persist`; add `snapshotFor()` helper near `withAudit` (~line 241)
- Modify: `tests/health/bulk.test.mjs`

**Interfaces:**
- Consumes: `withAudit`, `uid`, `iso`, the `seed` export from Task 1 of `bulk.test.mjs`.
- Produces:
  - `snapshotFor(state, ids)` → `{ accounts, contacts, activities, tasks, opportunities, parentIds }` where each collection holds the **full prior records** touched by `ids`, and `parentIds` is `{ [subId]: originalParentId }` for every sub-account of a deleted parent.
  - `{ type: "BULK_CHURN", ids, reason, note, date, by }`
  - `{ type: "BULK_DELETE", ids }`
  - `{ type: "RESTORE_SNAPSHOT", snapshot }` — replaces every record in the snapshot by id and re-adds any that are missing.

- [ ] **Step 1: Write the failing test**

Append to `tests/health/bulk.test.mjs`:

```javascript
const P = seedAccount({ id: "p1", name: "Parent" });
const S = seedAccount({ id: "s1", name: "Sub", parentId: "p1" });
const cascadeSeed = `window.__seedRows = {
  accounts: ${JSON.stringify([P, S])}.map(d => ({ id: d.id, data: d })),
  contacts: [{ id: "c1", data: { id: "c1", accountId: "p1", name: "Ann" } }],
  activities: [{ id: "v1", data: { id: "v1", accountId: "p1", date: "2026-07-01", type: "call", summary: "hi" } }],
  tasks: [{ id: "k1", data: { id: "k1", accountId: "p1", title: "T", status: "Open", due: "2026-09-01" } }],
  opportunities: [{ id: "o1", data: { id: "o1", accountId: "p1", stage: "Open", amount: 10 } }],
  team: [], settings: [] };`;

test("BULK_CHURN churns every account with a shared reason and an audit entry", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const res = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_CHURN", ids: ["a1", "a2"], reason: "Price", note: "batch", date: "2026-08-12", by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().accounts.map(a => ({
      status: a.contractStatus, reason: a.churn && a.churn.reason, date: a.churn && a.churn.date,
      audit: (a.audit || []).map(e => [e.field, e.to, e.source]) }));
  });
  assert(res.every(a => a.status === "Churned"), "not all churned");
  assert(res.every(a => a.reason === "Price"), "shared reason not written");
  assert(res.every(a => a.date === "2026-08-12"), "churn date wrong");
  assert(res.every(a => a.audit.length === 1 && a.audit[0][0] === "contractStatus" && a.audit[0][1] === "Churned"), "audit entry missing");
  await browser.close();
});

test("BULK_DELETE removes accounts and cascades to all four collections", async () => {
  const { page, browser } = await launch(cascadeSeed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const after = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_DELETE", ids: ["p1"] });
    await new Promise(r => setTimeout(r, 50));
    const s = window.__store.getState();
    return { accounts: s.accounts.map(a => a.id), subParent: s.accounts.find(a => a.id === "s1").parentId,
      contacts: s.contacts.length, activities: s.activities.length, tasks: s.tasks.length, opps: s.opportunities.length };
  });
  assert(after.accounts.length === 1 && after.accounts[0] === "s1", `expected only the sub to survive, got ${JSON.stringify(after.accounts)}`);
  assert(after.subParent === null, "sub should be orphaned (parentId null)");
  assert(after.contacts === 0 && after.activities === 0 && after.tasks === 0 && after.opps === 0, "cascade incomplete");
  await browser.close();
});

test("RESTORE_SNAPSHOT undoes a bulk delete including cascades and sub parentId", async () => {
  const { page, browser } = await launch(cascadeSeed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const after = await page.evaluate(async () => {
    const snap = window.__snapshotFor(window.__store.getState(), ["p1"]);
    window.__store.dispatch({ type: "BULK_DELETE", ids: ["p1"] });
    await new Promise(r => setTimeout(r, 50));
    window.__store.dispatch({ type: "RESTORE_SNAPSHOT", snapshot: snap });
    await new Promise(r => setTimeout(r, 50));
    const s = window.__store.getState();
    return { accounts: s.accounts.map(a => a.id).sort(), subParent: s.accounts.find(a => a.id === "s1").parentId,
      contacts: s.contacts.length, activities: s.activities.length, tasks: s.tasks.length, opps: s.opportunities.length };
  });
  assert(after.accounts.join() === "p1,s1", `accounts not restored: ${JSON.stringify(after.accounts)}`);
  assert(after.subParent === "p1", `sub parentId not restored, got ${after.subParent}`);
  assert(after.contacts === 1 && after.activities === 1 && after.tasks === 1 && after.opps === 1, "cascaded rows not restored");
  await browser.close();
});

test("RESTORE_SNAPSHOT undoes a bulk churn back to Active", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const after = await page.evaluate(async () => {
    const snap = window.__snapshotFor(window.__store.getState(), ["a1", "a2"]);
    window.__store.dispatch({ type: "BULK_CHURN", ids: ["a1", "a2"], reason: "Price", note: "", date: "2026-08-12", by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    window.__store.dispatch({ type: "RESTORE_SNAPSHOT", snapshot: snap });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().accounts.map(a => ({ s: a.contractStatus, churn: a.churn, audit: (a.audit || []).length }));
  });
  assert(after.every(a => a.s === "Active"), "status not restored");
  assert(after.every(a => !a.churn), "churn entry not cleared");
  assert(after.every(a => a.audit === 0), "audit entries should be rolled back with the snapshot");
  await browser.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/health/run.mjs`
Expected: the 4 new cases FAIL — `window.__snapshotFor is not a function` and unchanged state.

- [ ] **Step 3: Add `snapshotFor` next to `withAudit` (~line 241)**

```javascript
/* Prior-state capture for undo. `ids` are account ids; the snapshot also carries every
   cascaded row DELETE_ACCOUNT would remove, plus the original parentId of each sub whose
   parent is being deleted (DELETE_ACCOUNT nulls those out). */
function snapshotFor(state, ids) {
  const set = new Set(ids);
  const touches = r => set.has(r.accountId);
  const parentIds = {};
  state.accounts.filter(a => a.parentId && set.has(a.parentId)).forEach(a => { parentIds[a.id] = a.parentId; });
  return {
    accounts: state.accounts.filter(a => set.has(a.id) || parentIds[a.id]).map(a => ({ ...a })),
    contacts: state.contacts.filter(touches).map(r => ({ ...r })),
    activities: state.activities.filter(touches).map(r => ({ ...r })),
    tasks: state.tasks.filter(touches).map(r => ({ ...r })),
    opportunities: state.opportunities.filter(touches).map(r => ({ ...r })),
    parentIds,
  };
}
```

Expose it for tests beside the existing `window.__store` effect in `App` (~line 2631):

```javascript
  useEffect(() => { window.__snapshotFor = snapshotFor; }, []);
```

- [ ] **Step 4: Add the reducer cases**

Beside the Task 2 cases in `reducer`:

```javascript
    case "BULK_CHURN": {
      const ids = new Set(action.ids);
      return { ...state, accounts: state.accounts.map(a => ids.has(a.id)
        ? withAudit({ ...a, contractStatus: "Churned",
            churn: { date: action.date, reason: action.reason, note: action.note || "", arr: a.arr, currency: a.currency, by: action.by } },
            [{ id: uid(), date: iso(Date.now()), field: "contractStatus", from: a.contractStatus, to: "Churned", by: action.by, source: "churn" }])
        : a) };
    }
    case "BULK_DELETE": {
      const ids = new Set(action.ids);
      const gone = r => ids.has(r.accountId);
      return { ...state,
        // _orphaned marks subs whose parent was just deleted so persist() writes them back
        accounts: state.accounts.filter(a => !ids.has(a.id))
          .map(a => (a.parentId && ids.has(a.parentId)) ? { ...a, parentId: null, _orphaned: true } : a),
        contacts: state.contacts.filter(r => !gone(r)),
        activities: state.activities.filter(r => !gone(r)),
        tasks: state.tasks.filter(r => !gone(r)),
        opportunities: state.opportunities.filter(r => !gone(r)) };
    }
    case "RESTORE_SNAPSHOT": {
      const merge = (cur, saved) => {
        const byId = new Map(saved.map(r => [r.id, r]));
        const kept = cur.map(r => byId.has(r.id) ? byId.get(r.id) : r);
        const present = new Set(cur.map(r => r.id));
        return [...kept, ...saved.filter(r => !present.has(r.id))];
      };
      const s = action.snapshot;
      return { ...state,
        accounts: merge(state.accounts, s.accounts),
        contacts: merge(state.contacts, s.contacts),
        activities: merge(state.activities, s.activities),
        tasks: merge(state.tasks, s.tasks),
        opportunities: merge(state.opportunities, s.opportunities) };
    }
```

`merge` restoring accounts by id also restores each sub's original `parentId`, because the snapshot captured the sub's whole prior record — `parentIds` is carried for the persist layer and for readability.

- [ ] **Step 5: Add the persist cases**

```javascript
    case "BULK_CHURN": {
      const ids = new Set(action.ids);
      next.accounts.filter(a => ids.has(a.id)).forEach(a => up("accounts", a));
      return;
    }
    case "BULK_DELETE":
      action.ids.forEach(id => {
        sb.from("accounts").delete().eq("id", id).then(({ error }) => error && dbError("accounts", error));
        ["contacts", "activities", "tasks", "opportunities"].forEach(t =>
          sb.from(t).delete().eq("data->>accountId", id).then(({ error }) => error && dbError(t, error)));
      });
      next.accounts.filter(a => a._orphaned).forEach(a => { delete a._orphaned; up("accounts", a); });
      return;
    case "RESTORE_SNAPSHOT": {
      const s = action.snapshot;
      s.accounts.forEach(a => up("accounts", a));
      ["contacts", "activities", "tasks", "opportunities"].forEach(t => s[t].forEach(r => up(t, r)));
      return;
    }
```

- [ ] **Step 6: Run all tests**

Run: `node tests/health/run.mjs`
Expected: `0 failed`.

- [ ] **Step 7: Commit**

```bash
git add crm.html tests/health/bulk.test.mjs
git commit -m "feat: BULK_CHURN, BULK_DELETE, and snapshot-based RESTORE_SNAPSHOT"
```

---

### Task 4: Row selection on the account list

**Files:**
- Modify: `crm.html` — `AccountList` (starts line 1666): selection state, checkbox column, select-all header, sticky action bar
- Modify: `tests/health/bulk.test.mjs`

**Interfaces:**
- Consumes: the `rows` memo already computed in `AccountList` (post-filter, post-grouping).
- Produces: DOM contract the later tasks and tests rely on —
  - each row checkbox carries `data-select="<accountId>"`
  - the header checkbox carries `data-select-all`
  - the sticky bar carries `data-bulkbar` and its count text is exactly `"N selected"`

- [ ] **Step 1: Write the failing test**

Append to `tests/health/bulk.test.mjs`:

```javascript
test("select-all covers only the filtered rows", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3"); // Accounts view
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(async () => {
    const setVal = (el, v) => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setVal(document.querySelector('input[placeholder^="Search"]'), "Alpha");
    await new Promise(r => setTimeout(r, 100));
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    return document.querySelector("[data-bulkbar]").textContent;
  });
  assert(res.includes("1 selected"), `expected "1 selected" with a filter applied, got: ${res}`);
  await browser.close();
});

test("selecting a parent does not select its sub-accounts", async () => {
  const { page, browser } = await launch(cascadeSeed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector('[data-select="p1"]');
  const res = await page.evaluate(async () => {
    document.querySelector('[data-select="p1"]').click();
    await new Promise(r => setTimeout(r, 100));
    return { bar: document.querySelector("[data-bulkbar]").textContent,
      subChecked: document.querySelector('[data-select="s1"]').checked };
  });
  assert(res.bar.includes("1 selected"), `expected 1 selected, got: ${res.bar}`);
  assert(res.subChecked === false, "sub-account was implicitly selected");
  await browser.close();
});

test("changing a filter clears the selection", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const gone = await page.evaluate(async () => {
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    const setVal = (el, v) => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setVal(document.querySelector('input[placeholder^="Search"]'), "Alpha");
    await new Promise(r => setTimeout(r, 150));
    return !document.querySelector("[data-bulkbar]");
  });
  assert(gone === true, "selection survived a filter change");
  await browser.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/health/run.mjs`
Expected: 3 new cases FAIL (timeout waiting for `[data-select-all]`).

- [ ] **Step 3: Add the selection state**

In `AccountList`, after the `qbrDue` state declaration:

```javascript
  const [selected, setSelected] = useState(() => new Set());
  const toggleOne = id => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
```

After the `rows` memo, clear the selection whenever the visible set changes:

```javascript
  // a selection must never outlive the rows that produced it
  useEffect(() => { setSelected(new Set()); }, [q, tier, risk, csm, renew, billing, showChurned, onlyChurned, qbrDue]);
  const allVisibleSelected = rows.length > 0 && rows.every(a => selected.has(a.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(rows.map(a => a.id)));
```

- [ ] **Step 4: Add the checkbox column**

In the `<thead>` row, before `<Th k="accountNo">`:

```jsx
            <th className="w-8 px-2 py-1.5">
              <input type="checkbox" data-select-all aria-label="Select all filtered accounts"
                checked={allVisibleSelected} onChange={toggleAll} />
            </th>
```

In the `rows.map` `<tr>`, as the first `<td>` — `stopPropagation` is required so ticking a box does not open the account:

```jsx
                  <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" data-select={a.id} aria-label={`Select ${a.name}`}
                      checked={selected.has(a.id)} onChange={() => toggleOne(a.id)} />
                  </td>
```

Bump both empty-state `colSpan` values by one: `colSpan={qbrDue ? 12 : 11}`.

- [ ] **Step 5: Add the sticky action bar**

Immediately before the `<div className="max-h-[65vh] overflow-auto">` table wrapper. The five buttons are wired in Task 5; here they only set `bulkAction`:

```jsx
      {selected.size > 0 && (
        <div data-bulkbar className="nm-sm mb-3 flex flex-wrap items-center gap-2 p-3">
          <span className="text-sm font-bold text-slate-800">{selected.size} selected</span>
          <Btn onClick={() => setBulkAction("csm")}>Reassign CSM</Btn>
          <Btn onClick={() => setBulkAction("tier")}>Change tier</Btn>
          <Btn onClick={() => setBulkAction("task")}>Add task</Btn>
          <Btn onClick={() => setBulkAction("churn")}>Churn</Btn>
          <Btn onClick={() => setBulkAction("delete")}>Delete</Btn>
          <button className="ml-auto text-xs font-semibold text-slate-500 hover:text-slate-800"
            onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}
```

Add the state it needs, beside `selected`:

```javascript
  const [bulkAction, setBulkAction] = useState(null); // "csm" | "tier" | "task" | "churn" | "delete"
```

- [ ] **Step 6: Run all tests**

Run: `node tests/health/run.mjs`
Expected: `0 failed`. In particular the existing account-list cases must still pass — if one fails on column count, fix the `colSpan`, not the test.

- [ ] **Step 7: Commit**

```bash
git add crm.html tests/health/bulk.test.mjs
git commit -m "feat: multi-select and bulk action bar on the account list"
```

---

### Task 5: The bulk dialog, wired to actions and undo

**Files:**
- Modify: `crm.html` — add `BulkDialog` immediately before `function AccountList` (line 1666); wire it into `AccountList`
- Modify: `tests/health/bulk.test.mjs`

**Interfaces:**
- Consumes: `pushToast` via `useToast()` (Task 1); `BULK_PATCH_ACCOUNTS`, `BULK_ADD_TASKS` (Task 2); `BULK_CHURN`, `BULK_DELETE`, `RESTORE_SNAPSHOT`, `snapshotFor` (Task 3); `selected`/`bulkAction` (Task 4).
- Produces: `<BulkDialog kind ids accounts team user dispatch onClose />`. Its root carries `data-bulkdialog`; its submit button carries `data-bulk-confirm`.

- [ ] **Step 1: Write the failing test**

Append to `tests/health/bulk.test.mjs`:

```javascript
test("bulk churn requires a reason before it will submit", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(async () => {
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    [...document.querySelectorAll("[data-bulkbar] button")].find(b => b.textContent === "Churn").click();
    await new Promise(r => setTimeout(r, 100));
    const btn = document.querySelector("[data-bulk-confirm]");
    return { disabled: btn.disabled };
  });
  assert(res.disabled === true, "confirm should be disabled until a reason is chosen");
  await browser.close();
});

test("bulk reassign shows an undo toast that restores the prior CSM", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(async () => {
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    [...document.querySelectorAll("[data-bulkbar] button")].find(b => b.textContent === "Reassign CSM").click();
    await new Promise(r => setTimeout(r, 100));
    const sel = document.querySelector("[data-bulkdialog] select");
    const setSel = (el, v) => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setSel(sel, "Dana");
    await new Promise(r => setTimeout(r, 50));
    document.querySelector("[data-bulk-confirm]").click();
    await new Promise(r => setTimeout(r, 150));
    const afterApply = window.__store.getState().accounts.map(a => a.csm);
    document.querySelector("[data-toast-undo]").click();
    await new Promise(r => setTimeout(r, 150));
    const afterUndo = window.__store.getState().accounts.map(a => a.csm);
    return { afterApply, afterUndo };
  });
  assert(res.afterApply.every(c => c === "Dana"), `reassign did not apply: ${JSON.stringify(res.afterApply)}`);
  assert(res.afterUndo.every(c => c === "Priya"), `undo did not restore: ${JSON.stringify(res.afterUndo)}`);
  await browser.close();
});

test("Escape closes the bulk dialog without closing the account view", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  await page.evaluate(async () => {
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    [...document.querySelectorAll("[data-bulkbar] button")].find(b => b.textContent === "Change tier").click();
  });
  await page.waitForSelector("[data-bulkdialog]");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const state = await page.evaluate(() => ({
    dialog: !!document.querySelector("[data-bulkdialog]"),
    stillOnList: !!document.querySelector("[data-select-all]"),
  }));
  assert(state.dialog === false, "dialog did not close on Escape");
  assert(state.stillOnList === true, "Escape leaked past the dialog and changed the view");
  await browser.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/health/run.mjs`
Expected: the 3 new cases FAIL (no `[data-bulkdialog]`).

- [ ] **Step 3: Add the `BulkDialog` component**

Insert immediately before `function AccountList(...)`:

```jsx
/* ------------------------------ bulk actions ------------------------------ */
const BULK_TITLE = { csm: "Reassign CSM", tier: "Change tier", task: "Add task to each", churn: "Churn accounts", delete: "Delete accounts" };
function BulkDialog({ kind, ids, accounts, team, user, dispatch, onClose }) {
  const toast = useToast();
  const names = team.map(t => t.name).filter(Boolean);
  const [csmVal, setCsmVal] = useState(names[0] || user.name);
  const [tierVal, setTierVal] = useState("Mid");
  const [title, setTitle] = useState(""); const [due, setDue] = useState(iso(Date.now()));
  const [owner, setOwner] = useState(user.name);
  const [reason, setReason] = useState(""); const [note, setNote] = useState("");
  const [date, setDate] = useState(iso(Date.now()));
  const [confirmText, setConfirmText] = useState("");
  const ref = useRef();
  useEffect(() => { ref.current?.focus(); }, []);
  // stopPropagation is required: App registers a window-level Escape that closes the
  // account detail view, so an unguarded Escape would close the dialog AND navigate.
  const onKeyDown = e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
  useEffect(() => {
    const h = e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", h, true); // capture phase: runs before App's handler
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);

  const ready = kind === "churn" ? !!reason
    : kind === "delete" ? confirmText === "DELETE"
    : kind === "task" ? !!title.trim()
    : true;

  const submit = () => {
    if (!ready) return;
    const n = ids.length;
    const state = window.__store.getState();
    if (kind === "task") {
      const items = ids.map(id => ({ id: uid(), accountId: id, title: title.trim(), due, owner, status: "Open" }));
      dispatch({ type: "BULK_ADD_TASKS", items });
      const created = new Set(items.map(t => t.id));
      toast({ text: `Added a task to ${n} account${n === 1 ? "" : "s"}.`, tone: "success",
        undo: () => dispatch({ type: "BULK_DELETE_TASKS", ids: [...created] }) });
    } else {
      const snapshot = snapshotFor(state, ids);
      if (kind === "csm") dispatch({ type: "BULK_PATCH_ACCOUNTS", ids, patch: { csm: csmVal }, by: user.name });
      else if (kind === "tier") dispatch({ type: "BULK_PATCH_ACCOUNTS", ids, patch: { tier: tierVal }, by: user.name });
      else if (kind === "churn") dispatch({ type: "BULK_CHURN", ids, reason, note, date, by: user.name });
      else if (kind === "delete") dispatch({ type: "BULK_DELETE", ids });
      const verb = { csm: "Reassigned", tier: "Retiered", churn: "Churned", delete: "Deleted" }[kind];
      toast({ text: `${verb} ${n} account${n === 1 ? "" : "s"}.`, tone: "success",
        undo: () => dispatch({ type: "RESTORE_SNAPSHOT", snapshot }) });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 pt-[15vh]" onClick={onClose}>
      <div data-bulkdialog role="dialog" aria-modal="true" aria-label={BULK_TITLE[kind]}
           className="nm w-full max-w-md p-4" onClick={e => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="mb-3 flex items-center">
          <h3 className="flex-1 text-sm font-bold text-slate-800">{BULK_TITLE[kind]} · {ids.length} account{ids.length === 1 ? "" : "s"}</h3>
          <button aria-label="Close dialog" className="text-slate-400 hover:text-slate-700" onClick={onClose}>✕</button>
        </div>
        <div className="flex flex-col gap-2">
          {kind === "csm" && <label className="text-xs text-slate-700">New CSM
            <Select ref={ref} value={csmVal} onChange={e => setCsmVal(e.target.value)} options={names.length ? names : [user.name]} /></label>}
          {kind === "tier" && <label className="text-xs text-slate-700">New tier
            <Select value={tierVal} onChange={e => setTierVal(e.target.value)} options={["Enterprise", "Mid", "SMB"]} /></label>}
          {kind === "task" && <>
            <label className="text-xs text-slate-700">Title<Input ref={ref} value={title} onChange={e => setTitle(e.target.value)} /></label>
            <label className="text-xs text-slate-700">Due<Input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
            <label className="text-xs text-slate-700">Owner
              <Select value={owner} onChange={e => setOwner(e.target.value)} options={names.length ? names : [user.name]} /></label>
          </>}
          {kind === "churn" && <>
            <label className="text-xs text-slate-700">Reason (required)
              <Select value={reason} onChange={e => setReason(e.target.value)} options={["", ...CHURN_REASONS]} /></label>
            <label className="text-xs text-slate-700">Date<Input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
            <label className="text-xs text-slate-700">Note<Input value={note} onChange={e => setNote(e.target.value)} /></label>
            <p className="text-[11px] text-slate-500">One shared reason is written to all {ids.length} accounts.</p>
          </>}
          {kind === "delete" && <>
            <p className="text-xs text-rose-700">This deletes {ids.length} account{ids.length === 1 ? "" : "s"} and all their contacts, activities, tasks and opportunities. Sub-accounts survive but lose their parent.</p>
            <label className="text-xs text-slate-700">Type DELETE to confirm
              <Input ref={ref} value={confirmText} onChange={e => setConfirmText(e.target.value)} /></label>
          </>}
        </div>
        <div className="mt-4 flex gap-2">
          <Btn kind="primary" disabled={!ready} onClick={submit}>Apply</Btn>
          <Btn onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </div>
  );
}
```

`<Btn>` does not currently forward arbitrary props, but it does accept `disabled` — no change needed. `<Select>` spreads `...p` onto the `<select>`, so `ref` passes through as a DOM attribute warning-free only if you drop it; if React warns, remove `ref={ref}` from the `Select` in the `csm` branch and leave focus to the browser default.

- [ ] **Step 4: Add the `BULK_DELETE_TASKS` case used by the task-undo path**

In `reducer`, beside `BULK_ADD_TASKS`:

```javascript
    case "BULK_DELETE_TASKS": { const ids = new Set(action.ids); return { ...state, tasks: state.tasks.filter(t => !ids.has(t.id)) }; }
```

In `persist`:

```javascript
    case "BULK_DELETE_TASKS":
      return action.ids.forEach(id => sb.from("tasks").delete().eq("id", id).then(({ error }) => error && dbError("tasks", error)));
```

- [ ] **Step 5: Render the dialog from `AccountList`**

Inside the `Card`, after the bulk bar:

```jsx
      {bulkAction && <BulkDialog kind={bulkAction} ids={[...selected]} accounts={allAccounts}
        team={team} user={user} dispatch={dispatch}
        onClose={() => { setBulkAction(null); setSelected(new Set()); }} />}
```

- [ ] **Step 6: Run all tests**

Run: `node tests/health/run.mjs`
Expected: `0 failed`.

- [ ] **Step 7: Commit**

```bash
git add crm.html tests/health/bulk.test.mjs
git commit -m "feat: bulk action dialog with snapshot undo toasts"
```

---

### Task 6: Saved segments

**Files:**
- Modify: `crm.html` — `fetchAll` settings default (~line 267); `SET_SEGMENTS` in `reducer` (~403) and `persist` (~297); the `initialFilter` effect in `AccountList` (~1676); segment toolbar UI
- Create: `tests/health/segments.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: `st.settings` and `dispatch` (already passed into `AccountList` as `dispatch`; `settings` must be **added** as a new prop `settings={st.settings}` at the `AccountList` call site, line ~2827).
- Produces: `{ type: "SET_SEGMENTS", segments: Segment[] }` where `Segment = { id, name, filter }` and `filter = { q, tier, risk, csm, renew, billing, showChurned, onlyChurned, qbrDue, sort }`.

**This task contains the plan's highest regression risk — Step 5.**

- [ ] **Step 1: Write the failing test**

Create `tests/health/segments.test.mjs`:

```javascript
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "a1", name: "Alpha", csm: "Priya", tier: "Mid" });
const B = seedAccount({ id: "a2", name: "Beta", csm: "Dana", tier: "SMB" });
const seed = `window.__seedRows = { accounts: ${JSON.stringify([A, B])}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("settings.segments defaults to an empty array when absent", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const segs = await page.evaluate(() => window.__store.getState().settings.segments);
  assert(Array.isArray(segs) && segs.length === 0, `expected [], got ${JSON.stringify(segs)}`);
  await browser.close();
});

test("SET_SEGMENTS persists a segment carrying all ten filter fields", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const seg = await page.evaluate(async () => {
    window.__store.dispatch({ type: "SET_SEGMENTS", segments: [{ id: "s1", name: "My book", filter: {
      q: "al", tier: "Mid", risk: "All", csm: "Priya", renew: "90", billing: "All",
      showChurned: false, onlyChurned: false, qbrDue: false, sort: { k: "arr", dir: -1 } } }] });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().settings.segments[0];
  });
  assert(seg.name === "My book", "segment not stored");
  assert(Object.keys(seg.filter).length === 10, `expected 10 filter fields, got ${Object.keys(seg.filter).length}`);
  assert(seg.filter.sort.k === "arr" && seg.filter.sort.dir === -1, "sort not carried");
  await browser.close();
});

test("applying a segment sets every filter field", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-segment-select]");
  const res = await page.evaluate(async () => {
    window.__store.dispatch({ type: "SET_SEGMENTS", segments: [{ id: "s1", name: "Dana book", filter: {
      q: "", tier: "All", risk: "All", csm: "Dana", renew: "All", billing: "All",
      showChurned: false, onlyChurned: false, qbrDue: false, sort: { k: "accountNo", dir: 1 } } }] });
    await new Promise(r => setTimeout(r, 150));
    const sel = document.querySelector("[data-segment-select]");
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(sel, "s1");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    return [...document.querySelectorAll("tbody tr")].map(r => r.textContent);
  });
  assert(res.length === 1 && res[0].includes("Beta"), `segment did not filter to Dana's book: ${JSON.stringify(res)}`);
  await browser.close();
});

// REGRESSION (spec 7.1): a dashboard card passes a PARTIAL filter and must not
// clobber filter fields it does not mention.
test("a partial filter from a dashboard card preserves the typed search", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector('input[placeholder^="Search"]');
  const q = await page.evaluate(async () => {
    const box = document.querySelector('input[placeholder^="Search"]');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(box, "Alpha");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    window.__openAccounts({ risk: "Red" }); // what a dashboard card click does
    await new Promise(r => setTimeout(r, 200));
    return document.querySelector('input[placeholder^="Search"]').value;
  });
  assert(q === "Alpha", `partial filter wiped the search box (got "${q}")`);
  await browser.close();
});
```

Register in `run.mjs`:

```javascript
import "./segments.test.mjs";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/health/run.mjs`
Expected: 4 new cases FAIL — `segments` is `undefined`, no `[data-segment-select]`, no `window.__openAccounts`.

- [ ] **Step 3: Default `segments` in `fetchAll`**

In the `settings:` object literal (~line 268), add one key:

```javascript
      segments: saved.segments || [],
```

Add the same key to the two `settings: {` literals at lines ~223 and ~226 (`seedData()` and `emptyData()`):

```javascript
segments: []
```

- [ ] **Step 4: Add `SET_SEGMENTS`**

In `reducer`, beside `SET_PLAYBOOK`:

```javascript
    case "SET_SEGMENTS": return { ...state, settings: { ...state.settings, segments: action.segments } };
```

In `persist`, add `case "SET_SEGMENTS":` to the existing settings-upsert case list (~line 297):

```javascript
    case "SET_WEIGHTS": case "SET_RATES": case "SET_INTEGRATIONS": case "SET_SNAPSHOTS": case "SET_PLAYBOOK": case "SET_HEALTH_PLAYBOOK": case "SET_SEGMENTS":
```

- [ ] **Step 5: Extend `initialFilter` WITHOUT breaking partial filters**

The current effect (line ~1676) unconditionally resets 5 fields. Replace it with a merge that only touches keys actually present in the incoming object. **Do not** convert this into a full reset — a dashboard card passes `{risk, t}` only, and resetting the rest wipes the user's search.

```javascript
  useEffect(() => {
    if (!initialFilter) return;
    const f = initialFilter;
    const has = k => Object.prototype.hasOwnProperty.call(f, k);
    // only fields the caller actually supplied are applied; dashboard cards pass a
    // partial filter and must leave everything else (notably `q`) untouched
    if (has("q")) setQ(f.q);
    if (has("tier")) setTier(f.tier);
    if (has("risk")) setRisk(f.risk);
    if (has("csm")) setCsm(f.csm);
    if (has("renew")) setRenew(f.renew);
    if (has("billing")) setBilling(f.billing);
    if (has("showChurned")) setShowChurned(!!f.showChurned);
    if (has("onlyChurned")) setOnlyChurned(!!f.onlyChurned);
    if (has("qbrDue")) setQbrDue(!!f.qbrDue);
    if (has("sort")) setSort(f.sort);
  }, [initialFilter]);
```

Note the behavior this preserves: dashboard cards that previously relied on `risk`/`showChurned`/`onlyChurned`/`billing`/`qbrDue` being *reset to defaults* when absent now leave them alone. Verify the dashboard cards pass every key they intend to clear — check each `openAccounts({...})` call site and add explicit `risk: "All"` / `showChurned: false` style keys where a card means "clear this".

- [ ] **Step 6: Expose `openAccounts` for the regression test**

In `App`, beside the existing `window.__store` effect:

```javascript
  useEffect(() => { window.__openAccounts = openAccounts; });
```

- [ ] **Step 7: Pass settings into `AccountList`**

At the call site (~line 2827) add one prop: `settings={st.settings}`. Add `settings` to the `AccountList` parameter list.

- [ ] **Step 8: Add the segment toolbar UI**

In `AccountList`, at the start of the filter row (before the search `Input`):

```jsx
        <Select data-segment-select value={activeSeg} className="w-40"
          aria-label="Saved segment"
          onChange={e => {
            const id = e.target.value; setActiveSeg(id);
            const s = (settings.segments || []).find(x => x.id === id);
            if (s) setPendingSeg({ ...s.filter, t: Date.now() });
          }}
          options={["", ...(settings.segments || []).map(s => s.id)]} />
        <Btn onClick={() => {
          const name = window.prompt("Name this segment");
          if (!name) return;
          const seg = { id: uid(), name, filter: { q, tier, risk, csm, renew, billing, showChurned, onlyChurned, qbrDue, sort } };
          dispatch({ type: "SET_SEGMENTS", segments: [...(settings.segments || []), seg] });
        }}>Save view</Btn>
        {activeSeg && <Btn onClick={() => {
          dispatch({ type: "SET_SEGMENTS", segments: (settings.segments || []).filter(s => s.id !== activeSeg) });
          setActiveSeg("");
        }}>Delete segment</Btn>}
```

`Select` renders `<option value={o}>{o}</option>` from plain strings, so the dropdown would show ids. Add an optional label map to `Select` **additively**, defaulting to current behavior:

```jsx
const Select = ({ options, labels, ...p }) => (
  <select {...p} className={"nm-inset border-0 px-3 py-1.5 text-sm text-slate-800 outline-none " + (p.className || "")}>
    {options.map(o => <option key={o} value={o}>{labels ? (labels[o] ?? o) : o}</option>)}
  </select>
);
```

and pass `labels={{ "": "— segment —", ...Object.fromEntries((settings.segments || []).map(s => [s.id, s.name])) }}`.

Add the two state hooks beside `selected`:

```javascript
  const [activeSeg, setActiveSeg] = useState("");
  const [pendingSeg, setPendingSeg] = useState(null);
```

Both `initialFilter` (dashboard cards) and `pendingSeg` (segment selection) apply a
filter object the same way, so extract Step 5's body into one function rather than
duplicating the ten `if (has(...))` lines. Replace the Step 5 effect with:

```javascript
  const applyFilter = useCallback(f => {
    const has = k => Object.prototype.hasOwnProperty.call(f, k);
    // only fields the caller actually supplied are applied; dashboard cards pass a
    // partial filter and must leave everything else (notably `q`) untouched
    if (has("q")) setQ(f.q);
    if (has("tier")) setTier(f.tier);
    if (has("risk")) setRisk(f.risk);
    if (has("csm")) setCsm(f.csm);
    if (has("renew")) setRenew(f.renew);
    if (has("billing")) setBilling(f.billing);
    if (has("showChurned")) setShowChurned(!!f.showChurned);
    if (has("onlyChurned")) setOnlyChurned(!!f.onlyChurned);
    if (has("qbrDue")) setQbrDue(!!f.qbrDue);
    if (has("sort")) setSort(f.sort);
  }, []);
  useEffect(() => { if (initialFilter) applyFilter(initialFilter); }, [initialFilter, applyFilter]);
  useEffect(() => { if (pendingSeg) applyFilter(pendingSeg); }, [pendingSeg, applyFilter]);
```

A saved segment carries all ten keys, so applying one sets every field; a dashboard
card carries only what it means to change. Same code path, different payloads.

- [ ] **Step 9: Run all tests**

Run: `node tests/health/run.mjs`
Expected: `0 failed`. The partial-filter regression case is the one that matters most here.

- [ ] **Step 10: Commit**

```bash
git add crm.html tests/health/segments.test.mjs tests/health/run.mjs
git commit -m "feat: team-shared saved segments on the account list"
```

---

### Task 7: Accessibility pass

**Files:**
- Modify: `crm.html` — `Btn` prop forwarding, nav buttons (~2767), palette modal (~2596), `Th` sort headers (~1716), account-detail modals
- Create: `tests/health/a11y.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: everything prior. Produces no new API.

- [ ] **Step 1: Write the failing test**

Create `tests/health/a11y.test.mjs`:

```javascript
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount({ id: "a1", name: "Alpha" }))}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("nav items expose labels and mark the current view", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
  const res = await page.evaluate(() => {
    const navs = [...document.querySelectorAll("nav button, [data-nav] button")];
    return { count: navs.length, labelled: navs.every(b => b.getAttribute("aria-label")),
      current: navs.filter(b => b.getAttribute("aria-current") === "page").length };
  });
  assert(res.count >= 4, `expected nav buttons, got ${res.count}`);
  assert(res.labelled, "every nav button needs an aria-label");
  assert(res.current === 1, `exactly one nav item should be aria-current, got ${res.current}`);
  await browser.close();
});

test("sortable account columns expose aria-sort", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(() => {
    const ths = [...document.querySelectorAll("thead th[aria-sort]")];
    return { any: ths.length, ascending: ths.filter(t => t.getAttribute("aria-sort") === "ascending").length };
  });
  assert(res.any >= 8, `expected aria-sort on sortable headers, got ${res.any}`);
  assert(res.ascending === 1, `exactly one column should be the active sort, got ${res.ascending}`);
  await browser.close();
});

test("the command palette is a labelled modal dialog", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
  await page.keyboard.press("Control+k");
  await page.waitForSelector('[role="dialog"]');
  const res = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return { modal: d.getAttribute("aria-modal"), label: d.getAttribute("aria-label") };
  });
  assert(res.modal === "true", "palette should be aria-modal");
  assert(!!res.label, "palette needs an aria-label");
  await browser.close();
});
```

Register in `run.mjs`:

```javascript
import "./a11y.test.mjs";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/health/run.mjs`
Expected: 3 new cases FAIL.

- [ ] **Step 3: Let `Btn` forward accessibility props**

`Btn` currently destructures a fixed prop set and drops everything else. Make it additive-safe:

```jsx
const Btn = ({ children, onClick, kind = "default", type = "button", disabled, ...rest }) => (
  <button type={type} onClick={onClick} disabled={disabled} {...rest} className={`px-3.5 py-1.5 text-xs font-bold disabled:opacity-50 ${kind === "primary" ? "grad text-white" : "nm-btn text-slate-700"}`}>{children}</button>
);
```

`className` stays hard-coded after the spread so no caller can accidentally clobber the button styling.

- [ ] **Step 4: Label the nav and mark the current view**

At the nav button (~line 2767), which already has `title={v}`:

```jsx
              <button key={v} title={v} aria-label={v} aria-current={view === v ? "page" : undefined}
                onClick={() => { setView(v); setAcctId(null); }}
```

Wrap the nav button list in a `<nav aria-label="Main">` element if it is not already inside one.

- [ ] **Step 5: Add `aria-sort` to sortable headers**

In the `Th` helper inside `AccountList` (~1716):

```jsx
  const Th = ({ k, children, className = "" }) => (
    <th aria-sort={sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
        className={`cursor-pointer select-none px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-800 ${className}`}
        onClick={() => setSort(s => ({ k, dir: s.k === k ? -s.dir : 1 }))}>
      {children}{sort.k === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
```

- [ ] **Step 6: Make the palette a labelled dialog**

At the palette's inner panel (~line 2597):

```jsx
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="nm w-full max-w-lg p-3" onClick={e => e.stopPropagation()}>
```

- [ ] **Step 7: Label the remaining icon-only buttons**

Run: `grep -n '>✕<' crm.html`
Give every hit an `aria-label` describing what it dismisses (e.g. `aria-label="Dismiss import result"` on the import-message close at ~1732). Do the same for any other button whose only child is a glyph.

- [ ] **Step 8: Confirm the aria count moved off zero**

Run: `grep -c "aria-" crm.html`
Expected: a number well above 20 (was 0 before this branch).

- [ ] **Step 9: Run all tests**

Run: `node tests/health/run.mjs`
Expected: `0 failed` across all 17 test files.

- [ ] **Step 10: Commit**

```bash
git add crm.html tests/health/a11y.test.mjs tests/health/run.mjs
git commit -m "feat: accessibility attributes across nav, tables, dialogs and toasts"
```

---

### Task 8: Manual verification and PR

- [ ] **Step 1: Full suite, one more time**

Run: `node tests/health/run.mjs`
Expected: `0 failed`. Record the pass count for the PR body.

- [ ] **Step 2: Manual smoke of the destructive path**

Open `crm.html` against the real Supabase config in a browser, load sample data from Settings, then:

1. Select 2 accounts → Delete → type `DELETE` → Apply.
2. Click **Undo** on the toast within 10s.
3. Confirm both accounts return **with** their contacts, activities, tasks and opportunities, and that any sub-accounts have their parent restored.
4. Reload the page and confirm the restore survived — this proves the persist path, which the mocked harness cannot.

This step is not optional. `RESTORE_SNAPSHOT`'s Supabase writes are the one thing the in-memory mock does not actually verify.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/bulk-segments-undo
```

Write the PR body to a file first — PowerShell mangles inline quoting:

```bash
gh pr create --title "Bulk actions, saved segments, and undo" --body-file pr-body.md
```

The body should cover: the two gaps closed, the five bulk actions, the undo model and its accepted 10s overwrite risk, the shared-churn-reason caveat, and the spec's section 7 regression surface with the tests that cover each item.

---

## Self-Review Notes

- **Spec coverage:** §1 toasts → Task 1. §2 selection → Task 4. §3 bulk actions → Tasks 2, 3, 5. §4 segments → Task 6. §5 accessibility → Task 7. §6 testing → tests in every task; the spec's three planned files became four (`a11y.test.mjs` split out). §7.1 partial-filter regression → Task 6 Step 5 + its dedicated test. §7.2 Escape collision → Task 5 Step 3 (capture-phase listener) + its test. §7.3 alert timing → Task 1. §7.4 layout → Task 4 Step 4 `colSpan`.
- **Deviation from the spec worth noting:** `BULK_ADD_TASKS` undo needed a `BULK_DELETE_TASKS` case, added in Task 5 Step 4. The spec describes the undo behavior but does not name that action.
- **The Escape fix uses a capture-phase listener** rather than relying on `onKeyDown` bubbling, because `App`'s handler is registered on `window` and would otherwise fire first regardless of `stopPropagation` on a React synthetic event. Both are wired in Task 5; the test proves the outcome either way.
