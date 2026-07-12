# QBR Cadence, Cohort View, and Richer Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add QBR scheduling with auto-advance, a cohort retention grid, and axis/tooltip SVG charts to the single-file OneVio CRM.

**Architecture:** All changes live in `crm.html` (React via Babel-in-browser, Supabase persistence through the existing reducer + `persist()` write-through). Everything is additive: two new optional account fields (`qbrFrequency`, `nextQbrDate`), new pure-function helpers, new SVG components, and new Dashboard cards. No existing feature is removed or restructured.

**Tech Stack:** React 18 (UMD, in-browser Babel), Tailwind (CDN), Supabase JS v2, hand-rolled SVG charts. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-12-qbr-cohorts-charts-design.md`

## Global Constraints

- Single file: every change goes in `crm.html`. No new files, no new CDN dependencies.
- Additive only: never remove or rename existing fields, actions, components, or cards.
- New account fields must default safely for existing rows (`qbrFrequency` missing ⇒ treated as `"None"`, `nextQbrDate` missing ⇒ `""`).
- There is no JS test harness for `crm.html`; each task ends with a manual browser verification step. Open the file via a local static server (`python -m http.server` in the repo root, then `http://localhost:8000/crm.html`) — sign in with your existing account.
- Line numbers below refer to `crm.html` at commit `cb51ee2`; use the quoted code as the anchor, not the number, if they have drifted.
- Commit after every task with the exact message given.

---

### Task 1: QBR data model, form fields, and auto-advance

**Files:**
- Modify: `crm.html` — helpers near line 80, `AccountForm` (~lines 549–595), `reducer` `ADD_ACTIVITY` (~line 296), `persist` `ADD_ACTIVITY` (~line 238)

**Interfaces:**
- Produces: `QBR_FREQS` (array of option strings), `QBR_FREQ_MONTHS` (map), `addMonths(dateStr, m) -> iso string`, `qbrStatus(a) -> null | { kind: "unscheduled"|"overdue"|"due"|"scheduled", d?: number }`. Account objects gain `qbrFrequency` (string) and `nextQbrDate` (iso string or `""`). Tasks 2 uses `qbrStatus`.

- [ ] **Step 1: Add QBR helpers**

Directly after the line `const uid = () => Math.random().toString(36).slice(2, 10);` (~line 80), insert:

```js
/* ------------------------------- QBR cadence ------------------------------- */
const QBR_FREQS = ["None", "Quarterly", "Semi-annual", "Annual"];
const QBR_FREQ_MONTHS = { Quarterly: 3, "Semi-annual": 6, Annual: 12 };
const addMonths = (dateStr, m) => { const d = new Date(dateStr); d.setMonth(d.getMonth() + m); return iso(d.getTime()); };
/* null = QBRs not applicable (churned, or no frequency and no date set) */
function qbrStatus(a) {
  if (a.churn) return null;
  const hasFreq = a.qbrFrequency && a.qbrFrequency !== "None";
  if (!hasFreq && !a.nextQbrDate) return null;
  if (!a.nextQbrDate) return { kind: "unscheduled" };
  const d = daysUntil(a.nextQbrDate);
  return d < 0 ? { kind: "overdue", d: -d } : d <= 30 ? { kind: "due", d } : { kind: "scheduled", d };
}
```

- [ ] **Step 2: Add the two fields to AccountForm state**

In `AccountForm` (~line 554), the `useState` initializer has an `existing ? {...} : {...}` pair. Append to the **existing** branch (after `parentId: existing.parentId || ""`):

```js
, qbrFrequency: existing.qbrFrequency || "None", nextQbrDate: existing.nextQbrDate || ""
```

Append to the **new-account** branch (after `parentId: ""`):

```js
, qbrFrequency: "None", nextQbrDate: ""
```

- [ ] **Step 3: Render the form inputs**

In `AccountForm`'s JSX, directly after the `<F label="Contract status">…</F>` field (~line 576), insert:

```jsx
<F label="QBR cadence"><Select value={v.qbrFrequency} onChange={e => set("qbrFrequency", e.target.value)} options={QBR_FREQS} className="w-full" /></F>
{v.qbrFrequency !== "None" && <F label="Next QBR"><Input type="date" value={v.nextQbrDate} onChange={e => set("nextQbrDate", e.target.value)} /></F>}
```

No change to the `clean` object is needed — `...v` already carries both keys through `EDIT_ACCOUNT`/`ADD_ACCOUNT`.

- [ ] **Step 4: Auto-advance nextQbrDate when a QBR activity is logged**

In `reducer` (~line 296), replace:

```js
case "ADD_ACTIVITY": return { ...state, activities: [...state.activities, action.item] };
```

with:

```js
case "ADD_ACTIVITY": {
  let accounts = state.accounts;
  if (action.item.type === "QBR") { // logging a QBR schedules the next one per the account's cadence
    accounts = accounts.map(a => {
      if (a.id !== action.item.accountId) return a;
      const m = QBR_FREQ_MONTHS[a.qbrFrequency];
      return m ? { ...a, nextQbrDate: addMonths(action.item.date, m) } : a;
    });
  }
  return { ...state, accounts, activities: [...state.activities, action.item] };
}
```

- [ ] **Step 5: Persist the advanced account**

In `persist` (~line 238), replace:

```js
case "ADD_ACTIVITY": return up("activities", action.item);
```

with:

```js
case "ADD_ACTIVITY": {
  if (action.item.type === "QBR") { const a = next.accounts.find(x => x.id === action.item.accountId); if (a && QBR_FREQ_MONTHS[a.qbrFrequency]) up("accounts", a); }
  return up("activities", action.item);
}
```

- [ ] **Step 6: Manual verification**

Serve and open the app. On any account: ✎ Edit account → set QBR cadence "Quarterly" and a Next QBR date → Save. Re-open the edit form and confirm both values round-trip. Then + Log activity → type `QBR` → Log; re-open the edit form and confirm Next QBR moved to today + 3 months. Reload the page (Supabase round-trip) and confirm the date persisted. Confirm logging a non-QBR activity does not change the date.

- [ ] **Step 7: Commit**

```bash
git add crm.html
git commit -m "feat: QBR cadence fields with auto-advance on logged QBRs"
```

---

### Task 2: QBR status chip, dashboard card, and table filter

**Files:**
- Modify: `crm.html` — `AccountDetail` header (~line 1227), `Dashboard` (~lines 719–775), `AccountList` (~lines 1084–1162), `openAccounts` filter consumption (~line 1092)

**Interfaces:**
- Consumes: `qbrStatus(a)` from Task 1.
- Produces: `openAccounts({ qbrDue: true })` filter key handled by `AccountList` via `initialFilter.qbrDue`.

- [ ] **Step 1: Account detail chip**

In `AccountDetail`, directly after the billing chip `<span …>{a.billingCompleted ? … : "Billing pending"}</span>` (~line 1227–1228), insert:

```jsx
{(() => { const s = qbrStatus(a); return s && (
  <span className={`nm-sm !rounded-full px-3 py-1 text-sm font-semibold ${s.kind === "overdue" ? "text-rose-600" : s.kind === "due" ? "text-amber-600" : "text-slate-700"}`}>
    {s.kind === "overdue" ? `QBR overdue ${s.d}d` : s.kind === "due" ? `QBR due in ${s.d}d` : s.kind === "scheduled" ? `Next QBR ${fmtDate(a.nextQbrDate)}` : "QBR not scheduled"}
  </span>); })()}
```

- [ ] **Step 2: Dashboard "QBRs due" stat**

In `Dashboard`, after the `const owners = …` line (~line 751), add:

```js
const qbrAccts = scored.map(a => ({ a, s: qbrStatus(a) })).filter(x => x.s && (x.s.kind === "due" || x.s.kind === "overdue"));
const qbrOverdue = qbrAccts.filter(x => x.s.kind === "overdue").length;
```

Then change the row `<div className="grid grid-cols-3 gap-3">` that contains the **Billing completed** stat (~line 769) to `grid-cols-4`, and insert as its first child:

```jsx
<Stat label="QBRs due (30d)" value={qbrAccts.length}
  tone={qbrOverdue ? "text-rose-600" : qbrAccts.length ? "text-amber-600" : undefined}
  sub={qbrOverdue ? `${qbrOverdue} overdue` : "on schedule"} onClick={() => openAccounts({ qbrDue: true })} />
```

- [ ] **Step 3: AccountList filter**

In `AccountList` (~line 1091), after `const [onlyChurned, setOnlyChurned] = useState(false);` add:

```js
const [qbrDue, setQbrDue] = useState(false);
```

In the `useEffect` on `initialFilter` (~line 1092–1098), add:

```js
setQbrDue(!!initialFilter.qbrDue);
```

In the `rows` `useMemo` filter (~line 1104), add this clause to the chain (after the `billing` clause) and add `qbrDue` to the dependency array:

```js
&& (!qbrDue || ["due", "overdue"].includes(qbrStatus(a)?.kind || ""))
```

In the filter toolbar (~line 1161), next to the `onlyChurned` pill, add a dismiss pill:

```jsx
{qbrDue && <button className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700" onClick={() => setQbrDue(false)} title="Remove QBR-due filter">QBR due ✕</button>}
```

- [ ] **Step 4: Manual verification**

Set one account's Next QBR to a past date and another's to ~10 days out. Dashboard shows "QBRs due (30d)" = 2 with "1 overdue"; clicking it opens Accounts filtered to those two, with a "QBR due ✕" pill that clears the filter. Open the overdue account: rose "QBR overdue Nd" chip in the header. Churn a test account with a due QBR and confirm it drops out of the count.

- [ ] **Step 5: Commit**

```bash
git add crm.html
git commit -m "feat: QBR due chip, dashboard card, and accounts filter"
```

---

### Task 3: LineChart and StackedBars components + Trends & health mix card

**Files:**
- Modify: `crm.html` — chart components after `TrendLine` (~line 348), `Dashboard` JSX after the grid containing the "Trends (monthly)" card (~line 860)

**Interfaces:**
- Consumes: `st.settings.snapshots` — array of `{ month: "YYYY-MM", totalARR, accounts, nrr, grr, churnedARR, Green, Yellow, Red }`.
- Produces: `LineChart({ title, points, months, fmt, color })` and `StackedBars({ months, series })` where `series` is `[{ label, values, color }]`. Existing `TrendLine` sparklines stay untouched.

- [ ] **Step 1: Add the LineChart component**

Directly after the closing brace of `TrendLine` (~line 348), insert:

```jsx
/* full line chart: gridlines, axis labels, hover tooltip (snapshots are monthly) */
function LineChart({ title, points, months, fmt, color = "#6366f1", w = 340, h = 160 }) {
  const [hov, setHov] = useState(null);
  const vals = points.map(v => v === null || v === undefined ? null : +v);
  const nums = vals.filter(v => v !== null);
  if (nums.length < 2) return null;
  const min = Math.min(...nums), max = Math.max(...nums);
  const padL = 44, padR = 10, padT = 14, padB = 22;
  const X = i => padL + (i * (w - padL - padR)) / Math.max(vals.length - 1, 1);
  const Y = v => padT + (1 - (v - min) / (max - min || 1)) * (h - padT - padB);
  const xy = vals.map((v, i) => v === null ? null : [X(i), Y(v)]);
  const d = xy.filter(Boolean).map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const ticks = [min, (min + max) / 2, max];
  const lblEvery = Math.ceil(months.length / 6);
  const move = e => {
    const box = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - box.left) * (w / box.width);
    let best = 0; vals.forEach((v, i) => { if (v !== null && Math.abs(X(i) - fx) < Math.abs(X(best) - fx)) best = i; });
    setHov(vals[best] === null ? null : best);
  };
  return (
    <div>
      <div className="mb-1 text-xs font-bold text-slate-500">{title}</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" onMouseMove={move} onMouseLeave={() => setHov(null)}>
        {ticks.map((t, i) => <g key={i}>
          <line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} stroke="#e2e8f0" strokeWidth="1" />
          <text x={padL - 4} y={Y(t) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{fmt(t)}</text>
        </g>)}
        {months.map((m, i) => i % lblEvery === 0 && <text key={m} x={X(i)} y={h - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">{m.slice(2)}</text>)}
        <path d={d} fill="none" stroke={color} strokeWidth="2" />
        {xy.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={hov === i ? 4 : 2.5} fill={color} />)}
        {hov !== null && xy[hov] && <g>
          <line x1={xy[hov][0]} x2={xy[hov][0]} y1={padT} y2={h - padB} stroke="#cbd5e1" strokeDasharray="3 3" />
          <rect x={Math.min(xy[hov][0] + 6, w - 96)} y={padT} width="90" height="28" rx="4" fill="#0f172a" opacity="0.85" />
          <text x={Math.min(xy[hov][0] + 6, w - 96) + 6} y={padT + 12} fontSize="9" fill="#e2e8f0">{months[hov]}</text>
          <text x={Math.min(xy[hov][0] + 6, w - 96) + 6} y={padT + 23} fontSize="10" fontWeight="bold" fill="#fff">{fmt(vals[hov])}</text>
        </g>}
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Add the StackedBars component**

Directly after `LineChart`, insert:

```jsx
/* stacked bars of per-month counts (e.g. Green/Yellow/Red account mix) */
function StackedBars({ months, series, w = 340, h = 160 }) {
  const [hov, setHov] = useState(null);
  if (!months.length) return null;
  const totals = months.map((_, i) => series.reduce((s, sr) => s + (sr.values[i] || 0), 0));
  const max = Math.max(...totals, 1);
  const padL = 30, padR = 10, padT = 14, padB = 22;
  const bw = Math.min(24, ((w - padL - padR) / months.length) * 0.7);
  const X = i => padL + ((i + 0.5) * (w - padL - padR)) / months.length;
  const H = v => (v / max) * (h - padT - padB);
  const lblEvery = Math.ceil(months.length / 6);
  return (
    <div>
      <div className="mb-1 flex items-center gap-3 text-xs font-bold text-slate-500">Health mix (accounts)
        {series.map(sr => <span key={sr.label} className="flex items-center gap-1 font-normal"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: sr.color }} />{sr.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" onMouseLeave={() => setHov(null)}>
        <text x={padL - 4} y={padT + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{max}</text>
        <line x1={padL} x2={w - padR} y1={h - padB} y2={h - padB} stroke="#e2e8f0" />
        {months.map((m, i) => {
          let y = h - padB;
          return (
            <g key={m} onMouseEnter={() => setHov(i)}>
              {series.map(sr => { const bh = H(sr.values[i] || 0); y -= bh;
                return <rect key={sr.label} x={X(i) - bw / 2} y={y} width={bw} height={bh} fill={sr.color} opacity={hov === null || hov === i ? 1 : 0.4} />; })}
              {i % lblEvery === 0 && <text x={X(i)} y={h - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">{m.slice(2)}</text>}
            </g>
          );
        })}
        {hov !== null && <g>
          <rect x={Math.min(X(hov) + 6, w - 120)} y={padT} width="114" height={14 + series.length * 11} rx="4" fill="#0f172a" opacity="0.85" />
          <text x={Math.min(X(hov) + 6, w - 120) + 6} y={padT + 11} fontSize="9" fill="#e2e8f0">{months[hov]} · {totals[hov]} accounts</text>
          {series.map((sr, si) => <text key={sr.label} x={Math.min(X(hov) + 6, w - 120) + 6} y={padT + 22 + si * 11} fontSize="9" fill={sr.color}>{sr.label}: {sr.values[hov] || 0}</text>)}
        </g>}
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: Add the full-width "Trends & health mix" card to the Dashboard**

In `Dashboard`, immediately after the closing `</div>` of the `grid grid-cols-3` block that contains the "Expansion pipeline" / "Trends (monthly)" / week-tasks cards (~line 860), insert:

```jsx
{snaps.length >= 2 && <Card title="Trends & health mix" className="!p-3">
  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
    <LineChart title="Total ARR (USD)" points={snaps.map(s => s.totalARR)} months={snaps.map(s => s.month)} fmt={fmtMoney} />
    <LineChart title="NRR" points={snaps.map(s => s.nrr)} months={snaps.map(s => s.month)} fmt={x => x === null || x === undefined ? "—" : (100 * x).toFixed(0) + "%"} color="#10b981" />
    <LineChart title="GRR" points={snaps.map(s => s.grr)} months={snaps.map(s => s.month)} fmt={x => x === null || x === undefined ? "—" : (100 * x).toFixed(0) + "%"} color="#f59e0b" />
    <StackedBars months={snaps.map(s => s.month)} series={[
      { label: "Green", values: snaps.map(s => s.Green || 0), color: RISK_HEX.Green },
      { label: "Yellow", values: snaps.map(s => s.Yellow || 0), color: RISK_HEX.Yellow },
      { label: "Red", values: snaps.map(s => s.Red || 0), color: RISK_HEX.Red }]} />
  </div>
</Card>}
```

The existing compact "Trends (monthly)" card stays as-is.

- [ ] **Step 4: Manual verification**

With only one real snapshot the card is hidden — to see it, temporarily seed history from the browser console is invasive; instead use React state via the app: in Settings, note this is admin-only data. Simplest safe check: in the browser devtools console run a read-only render test by temporarily editing nothing — rather, verify with real data if ≥2 snapshots exist. If not, temporarily change `snaps.length >= 2` to `>= 0` and hard-code `snaps = [{month:"2026-05",totalARR:900000,nrr:1.02,grr:0.95,Green:5,Yellow:2,Red:1},{month:"2026-06",totalARR:940000,nrr:1.04,grr:0.96,Green:6,Yellow:1,Red:1},{month:"2026-07",totalARR:915000,nrr:1.01,grr:0.94,Green:5,Yellow:2,Red:1}]` above the card **for the check only**, confirm axes/gridlines/month labels render, hover shows month + value tooltips on both chart types, then **revert the temporary lines before committing** (verify with `git diff` that only the intended additions remain).

- [ ] **Step 5: Commit**

```bash
git add crm.html
git commit -m "feat: line charts with axes/tooltips and health-mix stacked bars"
```

---

### Task 4: Cohort retention grid

**Files:**
- Modify: `crm.html` — cohort helpers after `retentionStats` (~line 717), Dashboard card after the "Trends & health mix" card added in Task 3

**Interfaces:**
- Consumes: scored account objects (`startDate`, `churn` = `{ date, … }` or falsy, `arrUSD`).
- Produces: `cohortData(accounts) -> [{ key, size, arr, cells: [{ q, pct, arrPct }] }]` and `CohortGrid({ accounts })` component (self-contained logo/ARR toggle).

- [ ] **Step 1: Add cohort computation**

Directly after the closing brace of `retentionStats` (~line 717), insert:

```js
/* ---------------------------- cohort retention ---------------------------- */
const monthsBetween = (a, b) => (new Date(b).getFullYear() - new Date(a).getFullYear()) * 12 + (new Date(b).getMonth() - new Date(a).getMonth());
function cohortData(accounts) {
  const now = iso(Date.now());
  const threeYrsAgo = new Date(); threeYrsAgo.setFullYear(threeYrsAgo.getFullYear() - 3);
  const rows = new Map(); // key -> { key, start (earliest startDate), accts: [] }
  accounts.forEach(a => {
    if (!a.startDate || isNaN(new Date(a.startDate))) return;
    const d = new Date(a.startDate);
    const key = d < threeYrsAgo ? String(d.getFullYear()) : `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    if (!rows.has(key)) rows.set(key, { key, start: a.startDate, accts: [] });
    const r = rows.get(key);
    if (a.startDate < r.start) r.start = a.startDate;
    // quarters survived: Infinity if never churned
    r.accts.push({ arr: a.arrUSD || 0, surv: a.churn && a.churn.date ? Math.max(0, Math.floor(monthsBetween(a.startDate, a.churn.date) / 3)) : Infinity });
  });
  return [...rows.values()].sort((x, y) => x.start.localeCompare(y.start)).map(r => {
    const size = r.accts.length, arr = r.accts.reduce((s, x) => s + x.arr, 0);
    const maxQ = Math.floor(monthsBetween(r.start, now) / 3);
    const cells = [];
    for (let q = 0; q <= maxQ; q++) {
      const alive = r.accts.filter(x => x.surv >= q);
      cells.push({ q, pct: size ? alive.length / size : 0, arrPct: arr ? alive.reduce((s, x) => s + x.arr, 0) / arr : 0 });
    }
    return { key: r.key, size, arr, cells };
  });
}
```

- [ ] **Step 2: Add the CohortGrid component**

Directly after `cohortData`, insert:

```jsx
function CohortGrid({ accounts }) {
  const [mode, setMode] = useState("logo"); // "logo" | "arr"
  const rows = useMemo(() => cohortData(accounts), [accounts]);
  if (!rows.length) return null;
  const maxCols = Math.min(Math.max(...rows.map(r => r.cells.length)), 13); // cap at 3 years of quarters
  const shade = p => p >= 0.95 ? "bg-emerald-100 text-emerald-800" : p >= 0.8 ? "bg-emerald-50 text-emerald-700"
    : p >= 0.6 ? "bg-amber-50 text-amber-700" : p > 0 ? "bg-rose-50 text-rose-600" : "bg-rose-100 text-rose-700";
  return (
    <Card title="Cohort retention" className="!p-3" right={
      <div className="flex items-center gap-1 text-xs">
        {[["logo", "Logos"], ["arr", "ARR (approx.)"]].map(([k, l]) =>
          <button key={k} onClick={() => setMode(k)} className={`rounded-full px-2.5 py-0.5 font-bold ${mode === k ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:text-slate-700"}`}>{l}</button>)}
      </div>}>
      <p className="mb-2 text-xs text-slate-500">% of each start cohort still active N quarters in{mode === "arr" ? " — ARR uses each account's last-known ARR (no historical ARR)" : ""}. Cohorts older than 3 years grouped by year.</p>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead><tr>
            <th className="px-2 py-1 text-left font-bold uppercase tracking-widest text-slate-500">Cohort</th>
            <th className="px-2 py-1 text-right font-bold uppercase tracking-widest text-slate-500">{mode === "logo" ? "Accts" : "ARR"}</th>
            {Array.from({ length: maxCols }, (_, q) => <th key={q} className="px-1 py-1 text-center font-bold text-slate-500">Q{q}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key}>
                <td className="px-2 py-0.5 font-semibold text-slate-700">{r.key}</td>
                <td className="px-2 py-0.5 text-right text-slate-500">{mode === "logo" ? r.size : fmtMoney(r.arr)}</td>
                {Array.from({ length: maxCols }, (_, q) => {
                  const c = r.cells[q];
                  if (!c) return <td key={q} />;
                  const p = mode === "logo" ? c.pct : c.arrPct;
                  return <td key={q} className={`px-1 py-0.5 text-center font-semibold ${shade(p)}`} title={`${r.key} · Q${q}: ${(100 * p).toFixed(0)}% retained`}>{(100 * p).toFixed(0)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: Render on the Dashboard**

In `Dashboard`, immediately after the "Trends & health mix" card added in Task 3, insert:

```jsx
<CohortGrid accounts={scope === "all" ? allAccounts : all} />
```

(`all` includes churned in-scope accounts; `allAccounts` is the whole scored book — same sourcing as `retAccounts` for the retention stats.)

- [ ] **Step 4: Manual verification**

With real or sample data: each cohort row's Q0 cell should read 100 (or less only if an account churned within its first quarter). Churn a test account whose start was >2 quarters ago and confirm its cohort's later cells drop; reactivate it and confirm the grid recovers. Toggle Logos/ARR and confirm values change and the "(approx.)" caption appears on ARR. Confirm an account with no `startDate` (create via console is not needed — CSV import without startDate defaults it, so instead just confirm the grid renders without errors). Check the scope toggle (mine/All) changes cohort membership.

- [ ] **Step 5: Commit**

```bash
git add crm.html
git commit -m "feat: cohort retention grid with logo/ARR toggle"
```

---

### Task 5: Seed data QBR fields + end-to-end pass

**Files:**
- Modify: `crm.html` — `seedData()` (~lines 140–197)

**Interfaces:**
- Consumes: everything above. No new interfaces.

- [ ] **Step 1: Give demo accounts QBR cadence**

In `seedData()`, after the line `accounts.forEach((a, i) => { a.currency = "USD"; a.inputsUpdatedAt = addDays(-10); a.accountNo = i + 1; });` (~line 193), add:

```js
// QBR cadence demo: a1 healthy quarterly, a2 overdue, a5 due soon
Object.assign(accounts[0], { qbrFrequency: "Quarterly", nextQbrDate: addDays(78) });
Object.assign(accounts[1], { qbrFrequency: "Quarterly", nextQbrDate: addDays(-9) });
Object.assign(accounts[4], { qbrFrequency: "Semi-annual", nextQbrDate: addDays(12) });
```

- [ ] **Step 2: Full end-to-end verification**

Run the whole flow once against sample data (Settings → load sample data, admin only — confirm with the user before replacing shared data, or verify on the real book without loading samples):

1. Dashboard shows "QBRs due (30d)" = 2 (a2 overdue, a5 due); click-through filters the table; pill clears it.
2. a2's detail page shows the rose overdue chip; log a QBR activity on it and confirm the chip flips to "Next QBR <date ≈ +3 months>".
3. Cohort grid renders with the demo cohorts; toggle works.
4. If ≥2 snapshots exist, the Trends & health mix card renders with tooltips.
5. Reload the page: QBR fields, advanced dates, and everything else persist via Supabase.
6. Regression: existing cards (GRR/NRR, renewals due, expansion pipeline, team tasks, compact trends) all still render; account create/edit works with QBR cadence left at "None".

- [ ] **Step 3: Commit**

```bash
git add crm.html
git commit -m "feat: QBR cadence demo seed data"
```
