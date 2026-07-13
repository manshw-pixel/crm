# Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ctrl/Cmd+K palette that jumps to views/accounts and opens an account with a chosen action form pre-opened.

**Architecture:** All in `crm.html`. One new component (`CommandPalette`) + one matcher helper (`subseqMatch`), wired into `App` (open state, global Ctrl+K listener, `openAccount(id, form)` extension, `pendingForm` → `AccountDetail.initialForm`). UI-only — no reducer, persistence, or schema changes.

**Tech Stack:** React 18 UMD + Babel in `crm.html`, Tailwind CDN, Playwright (msedge headless) for E2E.

## Global Constraints

- **Strictly additive** — existing shortcuts (`1–4`, `/`, `Esc`) and all behavior unchanged.
- Branch `feat/command-palette`; PR via `gh --body-file`; master merge deploys live.
- Settings entries only for `user.role === "admin"` (mirror the nav).
- Subsequence match is case-insensitive; empty query matches everything; list capped at 12 top-level rows.
- Spec: `docs/superpowers/specs/2026-07-13-command-palette-design.md`.
- Landmarks (master, commit `308bb16`): `AccountDetail` signature `crm.html:1585`, its `const [form, setForm] = useState(null)` at `crm.html:1589`; `VIEWS` at `crm.html:2114`; App keyboard handler `crm.html:2139-2148`; `openAccount` at `crm.html:2192`; view renders at `crm.html:2258-2263`; `<Copyright />` at `crm.html:2264`.

---

### Task 0: Branch

- [ ] **Step 1:**

```powershell
git checkout master; git pull; git checkout -b feat/command-palette
```

---

### Task 1: CommandPalette component + App/AccountDetail wiring

**Files:**
- Modify: `crm.html` — new component block directly above `const VIEWS = …` (crm.html:2114); `App` (state, Ctrl+K effect, `openAccount`, render); `AccountDetail` (signature + one effect).

**Interfaces:**
- Produces: `subseqMatch(q, text)` → bool; `CommandPalette({ open, onClose, accounts, user, go })`; `go(view)` navigates, `go("Accounts", accountId, formKey?)` opens the account (optionally with form). Form keys: `"activity" | "task" | "renewal" | "health" | "edit"`. `AccountDetail` gains optional `initialForm`, `clearInitialForm` props.

- [ ] **Step 1: Add the component block** (directly above `const VIEWS`):

```js
/* --------------------------- command palette --------------------------- */
/* case-insensitive subsequence match: "nrw" matches "Northwind" */
function subseqMatch(q, text) {
  q = q.toLowerCase(); text = text.toLowerCase();
  if (!q) return true;
  let i = 0;
  for (const ch of text) { if (ch === q[i]) i++; if (i === q.length) return true; }
  return false;
}
const PALETTE_ACTIONS = [
  { key: "activity", label: "Log activity" }, { key: "task", label: "Add task" },
  { key: "renewal", label: "Complete renewal" }, { key: "health", label: "Update health" },
  { key: "edit", label: "Edit account" },
];
function CommandPalette({ open, onClose, accounts, user, go }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  useEffect(() => { if (open) { setQ(""); setSel(0); } }, [open]);
  if (!open) return null;
  const views = (user.role === "admin" ? VIEWS : VIEWS.filter(v => v !== "Settings"))
    .filter(v => subseqMatch(q, "go to " + v))
    .map(v => ({ type: "view", id: "v-" + v, label: `Go to ${v}`, run: () => go(v) }));
  const prefix = t => t.toLowerCase().startsWith(q.toLowerCase());
  const accts = accounts.filter(a => subseqMatch(q, a.name))
    .sort((a, b) => (prefix(b.name) - prefix(a.name)) || a.name.localeCompare(b.name))
    .map(a => ({ type: "account", id: a.id, label: a.name + (a.churn ? " · churned" : ""), acct: a, run: () => go("Accounts", a.id) }));
  const rows = (q ? [...accts, ...views] : [...views, ...accts]).slice(0, 12);
  // contextual actions expand under the top account match (only when it leads the list)
  const list = [];
  rows.forEach((r, idx) => {
    list.push(r);
    if (idx === 0 && r.type === "account") {
      PALETTE_ACTIONS.filter(x => !(r.acct.churn && x.key === "renewal")).forEach(x =>
        list.push({ type: "action", id: r.id + "-" + x.key, label: "↳ " + x.label, run: () => go("Accounts", r.acct.id, x.key) }));
    }
  });
  const cur = Math.min(sel, Math.max(list.length - 1, 0));
  const onKey = e => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((cur + 1) % list.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((cur - 1 + list.length) % list.length); }
    else if (e.key === "Enter" && list.length) { e.preventDefault(); list[cur].run(); onClose(); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 pt-[15vh]" onClick={onClose}>
      <div className="nm w-full max-w-lg p-3" onClick={e => e.stopPropagation()}>
        <Input autoFocus placeholder="Type a view or account…" value={q}
          onChange={e => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey} className="w-full" />
        <div className="mt-2 max-h-80 overflow-y-auto">
          {list.length === 0 && <div className="px-2 py-1.5 text-sm text-slate-500">No results</div>}
          {list.map((it, i) => (
            <div key={it.id} onClick={() => { it.run(); onClose(); }} onMouseEnter={() => setSel(i)}
              className={`cursor-pointer rounded px-2 py-1.5 text-sm ${it.type === "action" ? "pl-6 " : ""}${i === cur ? "bg-indigo-100 text-indigo-800" : "text-slate-800"}`}>
              {it.label}
            </div>
          ))}
        </div>
        <div className="mt-2 px-2 text-[11px] text-slate-500">↑↓ navigate · Enter select · Esc close</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: App state + Ctrl+K listener.** After `const [acctFilter, setAcctFilter] = useState(null);` (crm.html:2121) add:

```js
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingForm, setPendingForm] = useState(null); // form to auto-open on next AccountDetail mount (from palette)
```

After the existing keyboard-shortcut `useEffect` closes (crm.html:2148) add:

```js
  useEffect(() => { // Ctrl/Cmd+K toggles the command palette from anywhere, incl. inputs
    const h = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(o => !o); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);
```

- [ ] **Step 3: Extend `openAccount`** (crm.html:2192) from `const openAccount = id => { setView("Accounts"); setAcctId(id); };` to:

```js
  const openAccount = (id, form) => { setView("Accounts"); setAcctId(id); if (form) setPendingForm(form); };
```

- [ ] **Step 4: Render the palette** — directly before `<Copyright />` (crm.html:2264) add:

```js
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} accounts={scored} user={user}
        go={(v, id, form) => { if (id) openAccount(id, form); else { setView(v); setAcctId(null); } }} />
```

- [ ] **Step 5: AccountDetail initialForm.** Signature (crm.html:1585) gains two props:

```js
function AccountDetail({ st, scored, id, dispatch, back, user, team, openAccount, initialForm, clearInitialForm }) {
```

Directly after `const [form, setForm] = useState(null);` (crm.html:1589) add:

```js
  useEffect(() => { if (initialForm) { setForm(initialForm); clearInitialForm && clearInitialForm(); } }, [initialForm]);
```

And the `AccountDetail` render in App (crm.html:2260) gains `initialForm={pendingForm} clearInitialForm={() => setPendingForm(null)}`.

- [ ] **Step 6: Verify + commit** — read the diff (balanced JSX, six hunks only), then:

```powershell
git add crm.html; git commit -m "feat: Ctrl+K command palette with view/account navigation and quick actions"
```

---

### Task 2: E2E verification

**Files:** scratch only — this session's harness at `<THIS_SESSION_SCRATCHPAD>\e2e\`. Commit nothing.

- [ ] **Step 1:** Rebuild `crm-test.html` from the branch's `crm.html` (same mock block, `window.__seed`, playbook fixtures a1→+50d/a4→+200d/a6→−5d, churn fixture a3 CSM "Sana") so prior suites keep passing.

- [ ] **Step 2:** Write `drive6.js` (same skeleton; msedge headless, pageerror capture, `check()` tally). Checks (spec Testing 1-7):

1. `Control+k` opens the palette (input with placeholder "Type a view or account…" visible); `Escape` closes; reopen; backdrop click closes.
2. Empty query lists `Go to Dashboard` first; type `nrw` → "Northwind Analytics" is the top row (subsequence match); `ArrowDown`/`ArrowUp` move the highlight; type `renew` then select `Go to Renewals` with Enter → Renewals view visible ("Due next 90d").
3. Ctrl+K, type an account name, Enter on the account row → its detail page (account header name visible).
4. Ctrl+K, type "Northwind", Enter on the `↳ Add task` child row → detail page opens with the Add-task form visible (task title input). Then verify the churned account (a3) shows NO `↳ Complete renewal` child row while other actions are present.
5. With the palette open, type "1" into the input → view does NOT change (palette input keystrokes don't trigger the digit shortcuts).
6. `Go to Settings` present for the admin mock user.
7. Zero pageerror lines.

- [ ] **Step 3:** `node drive6.js` → all PASS; regressions `node drive.js` (25), `drive2.js` (11), `drive3.js` (27), `drive5.js` (25) → all PASS.

- [ ] **Step 4:** Screenshot `shot-palette.png`. `git status` clean.

---

### Task 3: PR

- [ ] **Step 1:** `git push -u origin feat/command-palette`; `gh pr create --title "feat: Ctrl+K command palette" --body-file <scratchpad>\pr-body-palette.md` (what/why, E2E evidence, additive guarantee, Claude Code attribution).
- [ ] **Step 2:** Merge after user approval: `gh pr merge --merge`.
