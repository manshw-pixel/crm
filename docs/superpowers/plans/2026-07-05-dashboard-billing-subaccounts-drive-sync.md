# Dashboard Clicks, Billing, Sub-accounts, Drive Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clickable dashboard cards, per-cycle billing-completion tracking, sub-accounts with ARR rollup, and shared-drive-folder CSV sync to the CRM.

**Architecture:** All work is in the single-file React app `crm.html` (React 18 UMD + Babel + Supabase, state via reducer + `persist()` write-through). New account fields flow through existing `EDIT_ACCOUNT`/`ADD_ACCOUNT` actions; folder sync uses the File System Access API with handles in IndexedDB and a processed-file registry in the Supabase `settings` row.

**Tech Stack:** React 18 (in-browser Babel), Tailwind CDN, Supabase JS, File System Access API, IndexedDB.

**Spec:** `docs/superpowers/specs/2026-07-05-dashboard-billing-subaccounts-drive-sync-design.md`

## Global Constraints

- Single file: all changes go in `crm.html`. No build step, no new dependencies.
- No automated test harness exists — each task ends with manual browser verification (open `crm.html` in Chrome/Edge, sign in, exercise the feature).
- Dashboard totals / NRR / GRR must keep counting each account exactly once (rollups are display-only).
- Follow existing style: Tailwind classes, `nm`/`nm-sm`/`nm-inset` tokens, terse code, comments only for non-obvious constraints.
- Commit after each task.

---

### Task 1: Clickable dashboard cards

**Files:**
- Modify: `crm.html` — `Stat` (~line 351), `Dashboard` (~633–758), `AccountList` (~845), `App` (~1376–1494)

**Interfaces:**
- Produces: `App` state `acctFilter` (`{risk?, showChurned?} | null`), `openAccounts(filter)` passed to `Dashboard`, `initialFilter` prop on `AccountList`.

- [ ] **Step 1: Make `Stat` accept `onClick`**

Replace the `Stat` component with:

```jsx
const Stat = ({ label, value, sub, tone, onClick }) => (
  <Card className={onClick ? "cursor-pointer transition hover:border-indigo-300 hover:shadow-md" : ""}>
    <div role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}
      onKeyDown={onClick ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className="outline-none">
      <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${tone || "text-slate-700"}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  </Card>
);
```

- [ ] **Step 2: Add filter state + navigation in `App`**

In `App`, next to `const [acctId, setAcctId] = useState(null);` add:

```jsx
const [acctFilter, setAcctFilter] = useState(null); // {risk, showChurned} applied to AccountList on card click
const openAccounts = filter => { setView("Accounts"); setAcctId(null); setAcctFilter(filter || { t: Date.now() }); };
```

(`t: Date.now()` makes even a no-filter click a fresh object so the effect in AccountList re-fires and resets filters.)

Pass `openAccounts={openAccounts}` to `<Dashboard …/>` and `initialFilter={acctFilter}` to `<AccountList …/>`.

- [ ] **Step 3: Apply `initialFilter` in `AccountList`**

Add prop `initialFilter` to the `AccountList` signature and, after the state declarations:

```jsx
useEffect(() => {
  if (!initialFilter) return;
  setRisk(initialFilter.risk || "All");
  setShowChurned(!!initialFilter.showChurned);
}, [initialFilter]);
```

- [ ] **Step 4: Wire the dashboard cards**

In `Dashboard` (add `openAccounts` to its props), set onClick on each `Stat`:

- `Total ARR` → `onClick={() => openAccounts()}`
- `ARR at risk` and `At-risk accounts` → `onClick={() => openAccounts({ risk: "Red" })}`
- `GRR (12m)` and `NRR (12m)` → `onClick={() => openAccounts()}`
- `Churned ARR (12m)` → `onClick={() => openAccounts({ showChurned: true })}`
- `Tasks due 7d` → scroll to the week-tasks card: `onClick={() => document.getElementById("week-tasks")?.scrollIntoView({ behavior: "smooth" })}` and add `id="week-tasks"` via a wrapping `<div id="week-tasks">` around the `Card title={scope === "mine" ? "My tasks due this week" : …}`.

- [ ] **Step 5: Verify manually**

Open `crm.html` in Chrome, sign in. Click each card: At-risk → Accounts with Risk=Red preselected; Churned ARR → Accounts with "show churned" checked; Total ARR/GRR/NRR → Accounts unfiltered (clicking after having a Red filter set must reset it); Tasks due 7d → smooth-scrolls to the week-tasks card. Manually opening Accounts via nav must NOT re-apply an old filter after you changed filters by hand (it may re-apply only when a card is clicked again — acceptable since each click makes a fresh object).

- [ ] **Step 6: Commit**

```bash
git add crm.html && git commit -m "feat: dashboard stat cards click through to filtered accounts"
```

---

### Task 2: Billing completed (per renewal cycle)

**Files:**
- Modify: `crm.html` — `AccountForm` (~521), `AccountDetail` (~926), `AccountList` table (~892), `CompleteRenewalForm` (~584), reducer `COMPLETE_RENEWAL` (~274), `exportCSV` (~764), `importAccountsCSV` (~790), revenue-history renewal row (~1075)

**Interfaces:**
- Produces: account fields `billingCompleted: boolean`, `billingCompletedDate: "YYYY-MM-DD"|null`; renewal history entries gain `billingCompleted`/`billingCompletedDate` of the closed term. Task 4's finance importer patches these two fields via `EDIT_ACCOUNT`.

- [ ] **Step 1: AccountForm fields**

In `AccountForm`'s initial state add to both branches: existing → `billingCompleted: !!existing.billingCompleted, billingCompletedDate: existing.billingCompletedDate || ""`, new → `billingCompleted: false, billingCompletedDate: ""`. In `clean`, add `billingCompletedDate: v.billingCompleted ? (v.billingCompletedDate || iso(Date.now())) : null, billingCompleted: !!v.billingCompleted`. Add form fields after "Dedicated support":

```jsx
<F label="Billing completed"><Select value={v.billingCompleted ? "Yes" : "No"} onChange={e => set("billingCompleted", e.target.value === "Yes")} options={["No", "Yes"]} className="w-full" /></F>
{v.billingCompleted && <F label="Billing date"><Input type="date" value={v.billingCompletedDate} onChange={e => set("billingCompletedDate", e.target.value)} /></F>}
```

- [ ] **Step 2: Account detail badge + quick action**

In `AccountDetail`, in the header row (after the renewal pill), add:

```jsx
<span className={`nm-sm !rounded-full px-3 py-1 text-sm font-semibold ${a.billingCompleted ? "text-emerald-600" : "text-amber-600"}`}>
  {a.billingCompleted ? `Billing ✓ ${fmtDate(a.billingCompletedDate)}` : "Billing pending"}</span>
```

In the quick-actions row (next to Complete renewal): `{!a.churn && !a.billingCompleted && <Btn kind="primary" onClick={() => setForm("billing")}>$ Mark billing completed</Btn>}`.

Add a `BillingForm` component next to `CompleteRenewalForm`:

```jsx
function BillingForm({ acct, user, dispatch, onDone }) {
  const [date, setDate] = useState(iso(Date.now()));
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => {
      e.preventDefault();
      dispatch({ type: "EDIT_ACCOUNT", id: acct.id, patch: { billingCompleted: true, billingCompletedDate: date } });
      dispatch({ type: "ADD_ACTIVITY", item: { id: uid(), accountId: acct.id, type: "note", date, summary: `Billing completed for current term · by ${user.name}` } });
      onDone();
    }}>
      <label className="text-xs text-slate-700">Billing completed on<Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" /></label>
      <Btn kind="primary" type="submit">Mark completed</Btn><Btn onClick={onDone}>Cancel</Btn>
      <span className="text-xs text-slate-500">Resets to pending automatically when the next renewal is completed.</span>
    </form>
  );
}
```

and wire `form === "billing" ? <BillingForm acct={a} user={user} dispatch={dispatch} onDone={() => setForm(null)} />` into the form switch.

- [ ] **Step 3: Renewal resets billing**

Reducer `COMPLETE_RENEWAL`: add `billingCompleted: false, billingCompletedDate: null` to the account patch. In `CompleteRenewalForm`'s dispatched `entry`, add `billingCompleted: !!acct.billingCompleted, billingCompletedDate: acct.billingCompletedDate || null` (closed term's state, shown in history). In the revenue-history renewal row, after the "term extended" span add:

```jsx
<span className={`text-xs ${e.r.billingCompleted ? "text-emerald-600" : "text-slate-400"}`}>{e.r.billingCompleted ? `billed ${fmtDate(e.r.billingCompletedDate)}` : "billing n/a"}</span>
```

- [ ] **Step 4: Accounts table column + filter**

In `AccountList`: new state `const [billing, setBilling] = useState("All");`, add to the filter chain `(billing === "All" || (billing === "Completed") === !!a.billingCompleted)`, add to the `rows` useMemo deps, and add a filter control after the renew select:

```jsx
<Select value={billing} onChange={e => setBilling(e.target.value)} options={["All", "Completed", "Pending"]} />
<span className="text-xs text-slate-500">billing</span>
```

Add header `<Th k="billingCompletedDate">Billing</Th>` (before Flags; bump the empty-row `colSpan` to 10) and body cell:

```jsx
<td className="px-2 text-xs">{a.billingCompleted ? <span className="text-emerald-600">✓ {fmtDate(a.billingCompletedDate)}</span> : <span className="text-amber-600">pending</span>}</td>
```

- [ ] **Step 5: CSV export/import**

`exportCSV`: append `"billingCompleted", "billingCompletedDate"` to `cols`; in `cell`, `c === "billingCompleted" ? (a.billingCompleted ? "Yes" : "No") : …`. `importAccountsCSV`: after the `dedicatedsupport` line add:

```jsx
if (has("billingcompleted")) vals.billingCompleted = ["yes", "true", "y", "1"].includes(col(r, "billingcompleted").toLowerCase());
if (has("billingcompleteddate") && date(col(r, "billingcompleteddate"))) vals.billingCompletedDate = date(col(r, "billingcompleteddate"));
```

Also update the import-success message's column list to mention the two new columns.

- [ ] **Step 6: Verify manually**

Edit an account → set billing completed with date → badge shows green in detail and ✓ in table; filter Pending/Completed works; Complete renewal → billing resets to pending and revenue history shows the prior term's "billed <date>"; Export CSV includes the columns; re-import the exported CSV updates without duplicates.

- [ ] **Step 7: Commit**

```bash
git add crm.html && git commit -m "feat: per-term billing completion with date, table filter, CSV round-trip"
```

---

### Task 3: Sub-accounts with ARR rollup

**Files:**
- Modify: `crm.html` — `AccountForm`, `AccountList` (row building + ARR cell), `AccountDetail`, reducer/persist `DELETE_ACCOUNT`

**Interfaces:**
- Produces: account field `parentId: string|null` (one level deep). Helper `subsOf(accounts, id)` → array of scored subs.

- [ ] **Step 1: Parent picker in AccountForm**

`AccountForm` already receives `team`; also pass `accounts={st.accounts}` from both render sites (`AccountList` gets `allAccounts` — pass `accounts={allAccounts}`; `AccountDetail` passes `accounts={st.accounts}`). In `AccountForm({ dispatch, onDone, existing, team = [], accounts = [] })`:

```jsx
const hasSubs = existing && accounts.some(x => x.parentId === existing.id);
// eligible parents: top-level accounts only (one level deep), never itself
const parentOptions = accounts.filter(x => !x.parentId && (!existing || x.id !== existing.id));
```

Initial state gains `parentId: existing?.parentId || ""` (new: `""`). `clean` gains `parentId: v.parentId || null`. Field (after Billing):

```jsx
<F label="Parent account">{hasSubs
  ? <div className="py-1.5 text-xs text-slate-500">Has sub-accounts — can't also be a sub.</div>
  : <select value={v.parentId} onChange={e => set("parentId", e.target.value)} className="nm-inset w-full border-0 px-3 py-1.5 text-sm text-slate-800 outline-none">
      <option value="">None (top-level)</option>
      {parentOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>}
</F>
```

- [ ] **Step 2: Nest subs in the accounts table with rollup**

In `AccountList`, replace the `rows` useMemo result with a parent-grouped ordering. After the existing filter+sort producing `r` (rename the sorted array `sorted`):

```jsx
// group: each top-level row followed by its (filter-surviving) subs; subs whose parent
// is filtered out appear at their own sorted position
const byParent = new Map();
sorted.forEach(a => { if (a.parentId) { byParent.set(a.parentId, [...(byParent.get(a.parentId) || []), a]); } });
const topIds = new Set(sorted.filter(a => !a.parentId).map(a => a.id));
const out = [];
sorted.forEach(a => {
  if (a.parentId && topIds.has(a.parentId)) return; // rendered under its parent
  out.push(a);
  (byParent.get(a.id) || []).forEach(s => out.push({ ...s, _sub: true }));
});
return out;
```

In the row render: indent sub names `<td className="px-2 py-1.5 font-medium">{a._sub && <span className="mr-1 text-slate-400">↳</span>}{a.name}…`. In the ARR cell, for parents with subs show the rollup (needs full scored list — compute `const subArr = useMemo(() => { const m = new Map(); scored.forEach(a => { if (a.parentId && !a.churn) m.set(a.parentId, (m.get(a.parentId) || 0) + a.arrUSD); }); return m; }, [scored]);`):

```jsx
<td className="px-2">{fmtMoney(a.arr, a.currency)}{a.currency !== "USD" && <span className="ml-1 text-xs text-slate-500">≈{fmtMoney(a.arrUSD)}</span>}
  {subArr.has(a.id) && <span className="ml-1 text-xs font-semibold text-indigo-600" title="Own + sub-accounts (USD)">Σ {fmtMoney(a.arrUSD + subArr.get(a.id))}</span>}</td>
```

- [ ] **Step 3: Account detail — subs card and parent link**

In `AccountDetail`, compute `const subs = scored.filter(x => x.parentId === id);` and `const parent = a.parentId ? scored.find(x => x.id === a.parentId) : null;`. In the header info span add: `{parent && <> · sub-account of <button className="text-indigo-600 hover:underline" onClick={() => openAccount(parent.id)}>{parent.name}</button></>}` — add an `openAccount` prop to `AccountDetail` (pass `openAccount={openAccount}` from `App`). Below the header (e.g., after the churn banner), for parents:

```jsx
{subs.length > 0 && <Card title={`Sub-accounts (${subs.length}) · rollup ${fmtMoney(toUSD(a.arr, a.currency, st.settings.rates) + subs.filter(s => !s.churn).reduce((t, s) => t + s.arrUSD, 0))} USD`}>
  {subs.map(s => (
    <button key={s.id} onClick={() => openAccount(s.id)} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50">
      <span>{s.name}{s.churn && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-600">churned</span>}</span>
      <span className="flex items-center gap-2 text-xs text-slate-700">{fmtMoney(s.arr, s.currency)} <HealthChip score={s.score} /></span>
    </button>
  ))}
</Card>}
```

- [ ] **Step 4: Deleting a parent orphans subs**

Reducer `DELETE_ACCOUNT`: change the accounts line to
`accounts: state.accounts.filter(a => a.id !== action.id).map(a => a.parentId === action.id ? { ...a, parentId: null, _orphaned: true } : a),`.
The `_orphaned` marker lets `persist` (which only sees post-reducer state) know which subs need their cleared `parentId` written back to Supabase. Change the `persist` `DELETE_ACCOUNT` case to:

```jsx
case "DELETE_ACCOUNT": {
  sb.from("accounts").delete().eq("id", action.id).then(({ error }) => error && dbError("accounts", error));
  ["contacts", "activities", "tasks", "opportunities"].forEach(t =>
    sb.from(t).delete().eq("data->>accountId", action.id).then(({ error }) => error && dbError(t, error)));
  // orphaned subs (parent just deleted) need their cleared parentId written back
  next.accounts.filter(a => a._orphaned).forEach(a => { delete a._orphaned; up("accounts", a); });
  return;
}
```

(`up` is the helper already defined at the top of `persist`. Strip `_orphaned` before upserting, as shown.)

- [ ] **Step 5: Verify manually**

Create/edit an account, assign a parent → table shows it indented under the parent with ↳; parent ARR cell shows Σ rollup; parent detail lists subs with click-through; sub detail links back to parent; dashboard Total ARR unchanged by grouping (each account counted once); an account that has subs offers no parent picker; deleting the parent (as admin) leaves subs top-level after reload (confirms Supabase write).

- [ ] **Step 6: Commit**

```bash
git add crm.html && git commit -m "feat: sub-accounts with parent link, nested table rows and ARR rollup"
```

---

### Task 4: Shared-drive folder sync (Integrations)

**Files:**
- Modify: `crm.html` — new helpers near `importAccountsCSV`, new `IntegrationsCard` in `Settings`, `persist`/reducer for `SET_INTEGRATIONS`, `fetchAll` settings merge

**Interfaces:**
- Consumes: `importAccountsCSV(file, accounts, dispatch, done)` (Task existing), billing fields from Task 2.
- Produces: `settings.integrations = { processed: { [`${name}|${lastModified}`]: true }, log: [{t, folder, file, msg, err?}] }`; IndexedDB store `crm-sync` holding directory handles under keys `"sales"`/`"finance"`.

- [ ] **Step 1: Settings plumbing**

`fetchAll` settings return: add `integrations: { processed: {}, log: [], ...(saved.integrations || {}) }`. Same default in `seedData`/`emptyData` settings objects. Reducer:

```jsx
case "SET_INTEGRATIONS": return { ...state, settings: { ...state.settings, integrations: action.integrations } };
```

`persist`: add `case "SET_INTEGRATIONS":` to the existing `SET_WEIGHTS/SET_RATES` settings-upsert branch.

- [ ] **Step 2: IndexedDB handle store + folder scan helpers**

Add above `Settings`:

```jsx
/* ---------------------- shared-drive folder sync ---------------------- */
const FS_SUPPORTED = "showDirectoryPicker" in window;
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open("crm-sync", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("handles");
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const idbSet = async (k, v) => { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction("handles", "readwrite"); tx.objectStore("handles").put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
const idbGet = async k => { const db = await idb(); return new Promise((res, rej) => { const rq = db.transaction("handles").objectStore("handles").get(k); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); };
const idbDel = async k => { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction("handles", "readwrite"); tx.objectStore("handles").delete(k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
async function ensurePermission(handle) {
  if (await handle.queryPermission({ mode: "read" }) === "granted") return true;
  return (await handle.requestPermission({ mode: "read" })) === "granted";
}
async function listCsvFiles(dirHandle) {
  const out = [];
  for await (const [name, h] of dirHandle.entries())
    if (h.kind === "file" && /\.csv$/i.test(name)) out.push(await h.getFile());
  return out;
}
```

- [ ] **Step 3: Finance billing-CSV importer**

Next to `importAccountsCSV` add (reuses `parseCSV`):

```jsx
/* finance CSV: accountNo and/or name + billingCompletedDate — marks billing completed */
function importBillingCSV(text, accounts, dispatch) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { updated: 0, skipped: 0, err: "no data rows" };
  const norm = s => s.toLowerCase().replace(/[^a-z]/g, "");
  const header = rows[0].map(norm);
  const col = (r, key) => { const i = header.indexOf(key); return i >= 0 ? (r[i] || "").trim() : ""; };
  if (header.indexOf("billingcompleteddate") < 0) return { updated: 0, skipped: 0, err: 'needs a "billingCompletedDate" column' };
  const byNo = new Map(accounts.filter(a => a.accountNo).map(a => [String(a.accountNo), a]));
  const byName = new Map(accounts.map(a => [a.name.toLowerCase(), a]));
  let updated = 0, skipped = 0;
  rows.slice(1).forEach(r => {
    const d = new Date(col(r, "billingcompleteddate"));
    const acct = (col(r, "accountno") && byNo.get(col(r, "accountno"))) || byName.get(col(r, "name").toLowerCase());
    if (!acct || isNaN(d)) { skipped++; return; }
    dispatch({ type: "EDIT_ACCOUNT", id: acct.id, patch: { billingCompleted: true, billingCompletedDate: iso(d.getTime()) } });
    updated++;
  });
  return { updated, skipped };
}
```

- [ ] **Step 4: IntegrationsCard component**

Add above `Settings` and render `<IntegrationsCard st={st} dispatch={dispatch} />` inside `Settings`' grid (after the Data card):

```jsx
function IntegrationsCard({ st, dispatch }) {
  const [handles, setHandles] = useState({ sales: null, finance: null });
  const [busy, setBusy] = useState(false);
  const integ = st.settings.integrations || { processed: {}, log: [] };
  useEffect(() => { (async () => {
    try { setHandles({ sales: await idbGet("sales") || null, finance: await idbGet("finance") || null }); } catch (e) {}
  })(); }, []);
  const pick = async key => {
    try { const h = await window.showDirectoryPicker({ mode: "read" }); await idbSet(key, h); setHandles(s => ({ ...s, [key]: h })); }
    catch (e) { /* user cancelled */ }
  };
  const clear = async key => { await idbDel(key); setHandles(s => ({ ...s, [key]: null })); };
  const sync = useCallback(async () => {
    if (busy) return; setBusy(true);
    const processed = { ...integ.processed }; const log = [...integ.log];
    const note = (folder, file, msg, err) => log.push({ t: iso(Date.now()), folder, file, msg, err: !!err });
    for (const key of ["sales", "finance"]) {
      const h = handles[key]; if (!h) continue;
      try {
        if (!await ensurePermission(h)) { note(key, "—", "permission denied", true); continue; }
        for (const f of await listCsvFiles(h)) {
          const sig = `${f.name}|${f.lastModified}`;
          if (processed[sig]) continue;
          try {
            if (key === "sales") await new Promise(res => importAccountsCSV(f, st.accounts, dispatch, r =>
              { note(key, f.name, r.err || `imported ${r.ok} new · updated ${r.updated} · skipped ${r.skipped}`, !!r.err); res(); }));
            else { const r = importBillingCSV(await f.text(), st.accounts, dispatch);
              note(key, f.name, r.err || `billing updated ${r.updated} · skipped ${r.skipped}`, !!r.err); }
            processed[sig] = true;
          } catch (ex) { note(key, f.name, ex.message, true); }
        }
      } catch (ex) { note(key, "—", ex.message, true); }
    }
    dispatch({ type: "SET_INTEGRATIONS", integrations: { processed, log: log.slice(-20) } });
    setBusy(false);
  }, [handles, st, busy]);
  useEffect(() => { // auto-scan every 5 minutes while a folder is connected
    if (!handles.sales && !handles.finance) return;
    const t = setInterval(sync, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [handles, sync]);
  if (!FS_SUPPORTED) return <Card title="Integrations — shared drive"><p className="text-sm text-slate-500">Folder sync needs Chrome or Edge (File System Access API).</p></Card>;
  return (
    <Card title="Integrations — shared drive" right={<Btn kind="primary" onClick={sync}>{busy ? "Syncing…" : "Sync now"}</Btn>}>
      {[["sales", "Sales folder", "new-account CSVs (same columns as Accounts → Import CSV)"], ["finance", "Finance folder", "billing CSVs: accountNo or name + billingCompletedDate"]].map(([key, label, hint]) => (
        <div key={key} className="mb-2 flex items-center gap-2 text-sm">
          <span className="w-28 font-semibold">{label}</span>
          {handles[key] ? <><span className="nm-inset !rounded-full px-2 py-0.5 text-xs">📁 {handles[key].name}</span>
            <button className="text-xs text-rose-500 hover:underline" onClick={() => clear(key)}>disconnect</button></>
            : <Btn onClick={() => pick(key)}>Choose folder…</Btn>}
          <span className="ml-auto text-xs text-slate-400">{hint}</span>
        </div>
      ))}
      <p className="mb-2 text-xs text-slate-500">Point these at folders synced from your shared drive (Google Drive / OneDrive desktop). New CSV files are imported once (re-import by re-saving the file); auto-checks every 5 min while the app is open.</p>
      {integ.log.length > 0 && <div className="max-h-32 overflow-y-auto border-t border-slate-100 pt-2 text-xs">
        {[...integ.log].reverse().map((l, i) => <div key={i} className={`py-0.5 ${l.err ? "text-rose-600" : "text-slate-600"}`}>{fmtDate(l.t)} · <b>{l.folder}</b> · {l.file}: {l.msg}</div>)}
      </div>}
    </Card>
  );
}
```

- [ ] **Step 5: Verify manually**

In Chrome as admin: Settings shows Integrations. Make two local folders with sample CSVs — sales: `accountNo,name,tier,arr` rows incl. one existing name (should update) and one new; finance: `name,billingCompletedDate` incl. one bad date row (skipped, logged). Connect both, Sync now → log shows results, Accounts reflects imports, billing badges set. Sync again → nothing re-imported. Re-save a file (new lastModified) → re-imported. Reload page → folders still connected (may re-prompt permission on next sync). Disconnect works. In Firefox the card shows the unsupported note.

- [ ] **Step 6: Commit**

```bash
git add crm.html && git commit -m "feat: shared-drive folder sync for sales accounts and finance billing CSVs"
```

---

## Final verification

- Run through all four features once more end-to-end in the running app; confirm dashboard totals unchanged by sub-account grouping; export JSON as a backup before/after testing if using real team data.
