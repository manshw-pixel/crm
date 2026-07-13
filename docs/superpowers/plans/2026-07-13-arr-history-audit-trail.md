# ARR History + Audit Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record who/when/old→new for six key account fields, and make every ARR change (including form edits and CSV imports) land in the account's revenue timeline.

**Architecture:** All changes in `crm.html` (single-file React-in-Babel + Supabase). The `EDIT_ACCOUNT` reducer case becomes the audit choke point (diffs the patch, appends `audit` entries and — for ARR — `arrEvents` entries); lifecycle actions (`COMPLETE_RENEWAL`, `ADJUST_ARR`, `CHURN_ACCOUNT`, `REACTIVATE_ACCOUNT`) append compact audit entries; call sites pass `by`/`source`; one new "Change history" card on the account page. `audit` rides inside the account JSON — no schema change, existing persistence/export/delete-cascade work unchanged.

**Tech Stack:** React 18 UMD + Babel in `crm.html`, Supabase JS v2, Tailwind CDN, Playwright (`channel: "msedge"`) for E2E.

## Global Constraints

- **All changes to `crm.html` are behavior-additive** — existing features preserved exactly; existing arrays (`renewals`, `arrEvents`, `churn`) untouched in shape.
- Branch `feat/arr-audit-trail`; PR via `gh` with `--body-file`; master merge deploys live (GitHub Pages).
- **Dates are ISO `YYYY-MM-DD` strings compared textually.**
- Audited fields (exact list): `arr`, `renewalDate`, `csm`, `tier`, `contractStatus`, `renewalStage`.
- Audit entry shape (exact): `{ id, date, field, from, to, by, source }` with `source ∈ "edit form" | "csv import" | "inline" | "renewal" | "adjustment" | "opportunity" | "churn" | "reactivate"`.
- All reads of the new array use `(a.audit || [])`.
- Spec: `docs/superpowers/specs/2026-07-13-arr-history-audit-trail-design.md`.
- The E2E harness is scratch — never commit harness files.
- Landmarks (current master, commit `c47fc86`): reducer `EDIT_ACCOUNT` at `crm.html:299`, `COMPLETE_RENEWAL` at `crm.html:300-302`, `CHURN_ACCOUNT` at `crm.html:303-304`, `REACTIVATE_ACCOUNT` at `crm.html:305-306`, `ADJUST_ARR` at `crm.html:307-308`; `AccountForm` at `crm.html:679` (EDIT dispatch at 694); `importAccountsCSV` at `crm.html:1230` (EDIT dispatch at 1267; call sites at 1368 drive-sync and 1472 AccountList); inline stage selects at `crm.html:1556` (AccountDetail) and `crm.html:1778` (Renewals); Revenue history card IIFE at `crm.html:1694-1731`; App view wiring at `crm.html:2205-2209`.

---

### Task 0: Branch

- [ ] **Step 1:**

```powershell
git checkout master; git pull; git checkout -b feat/arr-audit-trail
```

---

### Task 1: Reducer-level audit engine

**Files:**
- Modify: `crm.html` — helper above `/* ------------------------------ store (Supabase) ------------------------------ */` (line ~220), reducer cases at 299-308, reactivate call site at 1579-1580.

**Interfaces:**
- Produces: `AUDIT_FIELDS` (array), `auditChanges(a, patch, by, source)` → array of audit entries; `EDIT_ACCOUNT` accepts optional `by`, `source`; `REACTIVATE_ACCOUNT` accepts optional `by`. Account gains `audit` array; ARR-changing `EDIT_ACCOUNT` also appends to `arrEvents` with `source: "edit" | "import"`, `reason: "ARR edited"`.

- [ ] **Step 1: Add the helper** (directly above the `/* store (Supabase) */` comment):

```js
/* ------------------------------ audit trail ------------------------------ */
const AUDIT_FIELDS = ["arr", "renewalDate", "csm", "tier", "contractStatus", "renewalStage"];
/* one entry per audited field the patch really changes (numbers normalized) */
function auditChanges(a, patch, by, source) {
  const out = [];
  AUDIT_FIELDS.forEach(f => {
    if (!(f in patch)) return;
    const from = f === "arr" ? (+a[f] || 0) : (a[f] ?? "");
    const to = f === "arr" ? (+patch[f] || 0) : (patch[f] ?? "");
    if (from !== to) out.push({ id: uid(), date: iso(Date.now()), field: f, from, to, by: by || "unknown", source: source || "edit form" });
  });
  return out;
}
const withAudit = (a, entries) => entries.length ? { ...a, audit: [...(a.audit || []), ...entries] } : a;
```

- [ ] **Step 2: Rewrite the `EDIT_ACCOUNT` reducer case** (crm.html:299) from the current one-liner to:

```js
    case "EDIT_ACCOUNT": return { ...state, accounts: state.accounts.map(a => {
      if (a.id !== action.id) return a;
      const entries = auditChanges(a, action.patch, action.by, action.source);
      let upd = withAudit({ ...a, ...action.patch }, entries);
      const arrCh = entries.find(x => x.field === "arr");
      if (arrCh) upd = { ...upd, arrEvents: [...(a.arrEvents || []), { id: uid(), date: iso(Date.now()),
        delta: arrCh.to - arrCh.from, kind: arrCh.to > arrCh.from ? "expansion" : "contraction",
        source: action.source === "csv import" ? "import" : "edit", reason: "ARR edited", note: "", by: arrCh.by }] };
      return upd;
    }) };
```

(Behavior without `by`/`source` still applies the patch; it just also records audit entries with `by: "unknown"` — every call site gets real values in Task 2.)

- [ ] **Step 3: Lifecycle actions append audit entries.** Replace cases 300-308 with:

```js
    case "COMPLETE_RENEWAL": return { ...state, accounts: state.accounts.map(a => a.id === action.id
      ? withAudit({ ...a, renewalDate: action.newDate, arr: action.newArr, contractStatus: "Active", billingCompleted: false, billingCompletedDate: null, renewalStage: "Not started", renewals: [...(a.renewals || []), action.entry] },
          [ ...((+a.arr || 0) !== (+action.newArr || 0) ? [{ id: uid(), date: iso(Date.now()), field: "arr", from: +a.arr || 0, to: +action.newArr || 0, by: action.entry.by, source: "renewal" }] : []),
            { id: uid(), date: iso(Date.now()), field: "renewalDate", from: a.renewalDate, to: action.newDate, by: action.entry.by, source: "renewal" } ])
      : a) };
    case "CHURN_ACCOUNT": return { ...state, accounts: state.accounts.map(a => a.id === action.id
      ? withAudit({ ...a, contractStatus: "Churned", churn: action.entry },
          [{ id: uid(), date: iso(Date.now()), field: "contractStatus", from: a.contractStatus, to: "Churned", by: action.entry.by, source: "churn" }]) : a) };
    case "REACTIVATE_ACCOUNT": return { ...state, accounts: state.accounts.map(a => a.id === action.id
      ? withAudit({ ...a, contractStatus: "Active", churn: null },
          [{ id: uid(), date: iso(Date.now()), field: "contractStatus", from: "Churned", to: "Active", by: action.by || "unknown", source: "reactivate" }]) : a) };
    case "ADJUST_ARR": return { ...state, accounts: state.accounts.map(a => a.id === action.id
      ? withAudit({ ...a, arr: action.newArr, arrEvents: [...(a.arrEvents || []), action.entry] },
          [{ id: uid(), date: iso(Date.now()), field: "arr", from: +a.arr || 0, to: +action.newArr || 0, by: action.entry.by, source: action.entry.source === "opportunity" ? "opportunity" : "adjustment" }]) : a) };
```

- [ ] **Step 4: Reactivate call site passes `by`** — at crm.html:1579 change `dispatch({ type: "REACTIVATE_ACCOUNT", id: a.id });` to `dispatch({ type: "REACTIVATE_ACCOUNT", id: a.id, by: user.name });` (`user` is in scope in AccountDetail).

- [ ] **Step 5: Verify + commit** — re-read the diff (balanced braces, no other hunks), then:

```powershell
git add crm.html; git commit -m "feat: reducer-level audit trail for key account fields"
```

---

### Task 2: Thread `by`/`source` through every EDIT_ACCOUNT call site

**Files:**
- Modify: `crm.html` — `AccountForm` (679, 694), its render sites (1478, 1602), `importAccountsCSV` (1230, 1267) and its call sites (1368, 1472), `IntegrationsCard` signature (~1355 `function IntegrationsCard({ st, dispatch })`) and its render site in Settings (~1841 `<IntegrationsCard st={st} dispatch={dispatch} />`), `AccountList` signature (~1424) and its render site (2207), inline stage selects (1556, 1778), `Renewals` signature (1743) and render site (2208).

**Interfaces:**
- Consumes: Task 1's `EDIT_ACCOUNT { by, source }`.
- Produces: every `EDIT_ACCOUNT` dispatch carries `by: user.name` and a `source` from the exact set: form → `"edit form"`, CSV import → `"csv import"`, stage selects → `"inline"`. Billing-completed patches (785, 1302) change no audited field — leave them untouched.

- [ ] **Step 1: AccountForm** — signature becomes `function AccountForm({ dispatch, onDone, existing, team = [], accounts = [], user }) {` and the edit dispatch (694) becomes:

```js
      if (existing) dispatch({ type: "EDIT_ACCOUNT", id: existing.id, patch: clean, by: user?.name, source: "edit form" });
```

Render sites: at 1602 add `user={user}` (AccountDetail has `user`); at 1478 add `user={user}` — and since `AccountList` doesn't receive `user`, add it to `AccountList`'s props and pass `user={user}` at the App render site (2207).

- [ ] **Step 2: CSV import** — signature becomes `function importAccountsCSV(file, accounts, dispatch, done, user) {` and the update dispatch (1267) becomes:

```js
        dispatch({ type: "EDIT_ACCOUNT", id: existing.id, patch: vals, by: user?.name, source: "csv import" });
```

Call sites: 1472 → `importAccountsCSV(f, allAccounts, dispatch, setImportMsg, user)`; 1368 (drive-sync) → `importAccountsCSV(f, st.accounts, dispatch, r => …, user)` — `IntegrationsCard` doesn't receive `user`, so its signature gains `user` and Settings' render of it becomes `<IntegrationsCard st={st} dispatch={dispatch} user={user} />` (Settings has `user`).

- [ ] **Step 3: Inline stage selects** — 1556 (AccountDetail, `user` in scope) and 1778 (Renewals) both become:

```js
          onChange={e => dispatch({ type: "EDIT_ACCOUNT", id: a.id, patch: { renewalStage: e.target.value }, by: user?.name, source: "inline" })}
```

`Renewals` doesn't receive `user`: signature becomes `function Renewals({ scored, openAccount, dispatch, allBook = [], rates = {}, snapshots = [], tasks = [], user }) {` and the App render (2208) gains `user={user}`.

- [ ] **Step 4: Verify + commit**

```powershell
git add crm.html; git commit -m "feat: pass actor and source on every account edit"
```

---

### Task 3: Change history card on the account page

**Files:**
- Modify: `crm.html` — inside `AccountDetail`, directly after the Revenue history IIFE closes (`})()}` at crm.html:1731, before the closing `</div>`).

**Interfaces:**
- Consumes: `(a.audit || [])` entries `{ id, date, field, from, to, by, source }`; helpers `fmtDate`, `fmtMoney`, `useState` (already imported).

- [ ] **Step 1: Add the card** (immediately after the Revenue history IIFE):

```js
      {(a.audit || []).length > 0 && <ChangeHistoryCard a={a} />}
```

and add the component directly above `function AccountDetail` (search `function AccountDetail(`):

```js
const AUDIT_FIELD_LABEL = { arr: "ARR", renewalDate: "Renewal date", csm: "CSM", tier: "Tier", contractStatus: "Contract status", renewalStage: "Renewal stage" };
function ChangeHistoryCard({ a }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const entries = [...(a.audit || [])].sort((x, y) => y.date.localeCompare(x.date) || (y.id > x.id ? 1 : -1));
  const shown = showAll ? entries : entries.slice(0, 50);
  const fmtVal = (f, v) => f === "arr" ? fmtMoney(+v || 0, a.currency) : f === "renewalDate" ? fmtDate(v) : (v === "" || v == null ? "—" : String(v));
  return (
    <Card title={`Change history (${entries.length})`}>
      <button className="mb-1 text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setOpen(o => !o)}>{open ? "Hide" : "Show"}</button>
      {open && <>
        {shown.map(e => (
          <div key={e.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-1 text-xs last:border-0">
            <span className="text-slate-500">{fmtDate(e.date)}</span>
            <span className="font-semibold text-slate-800">{AUDIT_FIELD_LABEL[e.field] || e.field}:</span>
            <span className="text-slate-700">{fmtVal(e.field, e.from)} → <b>{fmtVal(e.field, e.to)}</b></span>
            <span className="ml-auto text-slate-500">by {e.by} · {e.source}</span>
          </div>
        ))}
        {!showAll && entries.length > 50 && <button className="mt-1 text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setShowAll(true)}>Show all ({entries.length})</button>}
      </>}
    </Card>
  );
}
```

- [ ] **Step 2: Verify + commit**

```powershell
git add crm.html; git commit -m "feat: change history card on account page"
```

---

### Task 4: E2E verification via the Playwright harness

**Files:** scratch only — reuse this session's harness at `<THIS_SESSION_SCRATCHPAD>\e2e\` (has node_modules, mock pattern, drive.js/drive2.js/drive3.js). Commit nothing.

- [ ] **Step 1:** Rebuild `crm-test.html` from the branch's `crm.html`, re-applying the same mock block (`__mockSb`, `TEST_PROFILE`, `channel`/`removeChannel` stubs, write-back to `window.__seed` + localStorage), `window.__seed = seedData();`, and the playbook-era fixtures (a1→+50d, a4→+200d, a6→−5d, churn fixture on a3 with CSM "Sana") so the three prior suites keep passing.

- [ ] **Step 2:** Write `drive4.js` (same skeleton: msedge headless, pageerror capture, `check()` tally, exit code). Checks (spec Testing 1-7):

1. Open a4 → ✎ Edit account → change ARR (e.g. 72000→90000) AND CSM in one save → account has exactly 2 new audit entries (field/from/to correct, `by` = test user, `source: "edit form"`), and one new arrEvents entry (`delta: 18000, kind: "expansion", source: "edit", reason: "ARR edited"`), visible in Revenue history as "▲ expansion".
2. Re-open the edit form and save without changes → audit length unchanged.
3. Import a CSV (via the harness: set the file input with Playwright's `setInputFiles` using a temp CSV updating a4's ARR by name) → new audit entry + arrEvents entry with `source: "csv import"` / `"import"`.
4. Complete renewal on a1 with a changed ARR → audit entries for `arr` and `renewalDate` (`source: "renewal"`); ⇄ Adjust ARR → `arr` entry (`source: "adjustment"`); churn a7 then reactivate → two `contractStatus` entries (`source: "churn"`, `"reactivate"`).
5. Change renewal stage from the account header select → audit entry `field: "renewalStage", source: "inline"`.
6. Change history card: renders only when entries exist, "Show" expands, newest entry first, ARR values formatted as money.
7. NRR sanity: after the +18000 edit-sourced expansion, `retentionStats` expansion reflects it (read the Dashboard NRR stat or compute via page.evaluate on `window.__seed`) — proves edit-sourced events flow into retention like adjustments.
8. Zero pageerror lines.

- [ ] **Step 3:** Run `node drive4.js` → all PASS; regression `node drive.js` (25), `node drive2.js` (11), `node drive3.js` (27) → all PASS (update harness-copy expectations only if broken purely by new audit data, and say so).

- [ ] **Step 4:** Screenshot `shot-change-history.png`. Confirm `git status` clean.

---

### Task 5: PR

- [ ] **Step 1:** `git push -u origin feat/arr-audit-trail`, then `gh pr create --title "feat: per-account ARR history + audit trail" --body-file <scratchpad>\pr-body-audit.md` (body: what/why, audited fields, silent-path closure, E2E evidence, additive guarantee, Claude Code attribution).
- [ ] **Step 2:** Merge only after user approval: `gh pr merge --merge`.
