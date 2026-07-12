# Churn Analysis & Renewal Outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add churn breakdowns (Dashboard), a renewal-outcomes-by-quarter table (Renewals page), and forward-only forecast recording to the single-file OneVio CRM.

**Architecture:** All product changes in `crm.html` (React-in-Babel + Supabase). Two new self-contained components (`ChurnAnalysis`, `RenewalOutcomes`) plus one helper (`quarterKey`) and four new fields on the existing monthly snapshot. Verification extends the session's Playwright harness in the scratchpad (mocked Supabase; runnable headlessly).

**Tech Stack:** React 18 UMD, Tailwind CDN, hand-rolled markup (no chart lib), Playwright + Edge for E2E.

**Spec:** `docs/superpowers/specs/2026-07-12-churn-forecast-analytics-design.md`

## Global Constraints

- Product changes go in `crm.html` only; no new dependencies.
- Additive only: never remove or rename existing fields, actions, components, or cards.
- Old data must be tolerated: churn entries may lack `currency` (fall back to account currency); snapshots may lack the new forecast fields; accounts may lack `renewals[]`.
- Line numbers reference `crm.html` at commit `2c339c3`; anchor on quoted code if drifted.
- E2E harness lives at `C:\Users\manish.w\AppData\Local\Temp\claude\D--AI-Project-My-Company\bd69e494-82f1-4374-a17d-39e897e39ae1\scratchpad\e2e\` (already has `node_modules/playwright`, `drive.js`, and a mocked copy `crm-test.html`).
- Commit after every task with the exact message given.

---

### Task 1: `quarterKey` helper + ChurnAnalysis card on the Dashboard

**Files:**
- Modify: `crm.html` — helper after `monthsBetween` (~line 826), new component after `CohortGrid`'s closing brace (~line 905), render after `<CohortGrid …/>` (~line 1058)

**Interfaces:**
- Produces: `quarterKey(dateLike) -> "YYYY-Qn"` (used by Task 3), `ChurnAnalysis({ accounts, rates })` component.
- Consumes: existing `toUSD`, `fmtMoney`, `Card`, `useState`, `useMemo`; account fields `churn {date, reason, arr, currency}`, `csm`, `tier`, `currency`.

- [ ] **Step 1: Add the helper**

Directly after the line `const monthsBetween = (a, b) => …;` (~line 826), insert:

```js
const quarterKey = d => { const x = new Date(d); return x.getFullYear() + "-Q" + (Math.floor(x.getMonth() / 3) + 1); };
```

- [ ] **Step 2: Add the ChurnAnalysis component**

Directly after the closing brace of the `CohortGrid` function (~line 905), insert:

```jsx
/* ---------------------------- churn analysis ---------------------------- */
const CHURN_DIMS = ["Reason", "CSM", "Tier", "Quarterly"];
function ChurnAnalysis({ accounts, rates }) {
  const [dim, setDim] = useState("Reason");
  const rows = useMemo(() => {
    const m = new Map();
    accounts.filter(a => a.churn).forEach(a => {
      const lost = toUSD(a.churn.arr || 0, a.churn.currency || a.currency, rates);
      const k = dim === "Reason" ? (a.churn.reason || "Other")
        : dim === "CSM" ? (a.csm || "Unassigned")
        : dim === "Tier" ? (a.tier || "—")
        : quarterKey(a.churn.date);
      const r = m.get(k) || { k, n: 0, arr: 0 };
      r.n++; r.arr += lost; m.set(k, r);
    });
    if (dim !== "Quarterly") return [...m.values()].sort((x, y) => y.arr - x.arr);
    // Quarterly: last 8 quarters, chronological, zero-filled
    const keys = []; const now = new Date();
    for (let i = 7; i >= 0; i--) keys.push(quarterKey(new Date(now.getFullYear(), now.getMonth() - i * 3, 1)));
    return keys.map(k => m.get(k) || { k, n: 0, arr: 0 });
  }, [accounts, rates, dim]);
  const total = rows.reduce((s, r) => s + r.arr, 0);
  const max = Math.max(...rows.map(r => r.arr), 1);
  return (
    <Card title={`Churn analysis${total ? ` · ${fmtMoney(total)} lost` : ""}`} className="!p-3" right={
      <div className="flex items-center gap-1 text-xs">
        {CHURN_DIMS.map(d => <button key={d} onClick={() => setDim(d)}
          className={`rounded-full px-2.5 py-0.5 font-bold ${dim === d ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:text-slate-700"}`}>{d}</button>)}
      </div>}>
      {rows.length === 0 && <div className="text-sm text-slate-500">No churn recorded. 🎉</div>}
      {rows.map(r => (
        <div key={r.k} className="flex items-center gap-3 py-1 text-sm">
          <span className="w-28 shrink-0 font-semibold text-slate-700">{r.k}</span>
          <div className="h-3 flex-1 rounded bg-slate-100">
            <div className="h-3 rounded bg-rose-400" style={{ width: `${(100 * r.arr) / max}%` }} />
          </div>
          <span className="w-24 shrink-0 text-right text-xs text-slate-600">{r.n ? `${r.n} acct${r.n > 1 ? "s" : ""}` : "—"}</span>
          <span className="w-20 shrink-0 text-right text-xs font-bold text-rose-600">{r.arr ? fmtMoney(r.arr) : "—"}</span>
        </div>
      ))}
    </Card>
  );
}
```

- [ ] **Step 3: Render it on the Dashboard**

Directly after the line `<CohortGrid accounts={scope === "all" ? allAccounts : all} />` (~line 1058), insert:

```jsx
<ChurnAnalysis accounts={scope === "all" ? allAccounts : all} rates={rates} />
```

(`rates` is already defined in `Dashboard` as `const rates = st.settings.rates;`.)

- [ ] **Step 4: Self-review the diff**

Run `git diff` and confirm only the three insertions above, balanced JSX.

- [ ] **Step 5: Commit**

```bash
git add crm.html
git commit -m "feat: churn analysis card with reason/CSM/tier/quarterly breakdowns"
```

---

### Task 2: Record forecast fields in the monthly snapshot

**Files:**
- Modify: `crm.html` — the snapshot `useEffect` in `App` (~lines 1938–1950)

**Interfaces:**
- Produces: snapshot objects gain `due90`, `commit90`, `atRisk90`, `due90Count` (all numbers, USD/counts). Task 3 reads `commit90`.
- Consumes: existing `renewalStageOf(a)`, `daysUntil`, scored accounts' `arrUSD`/`renewalDate`.

- [ ] **Step 1: Extend the snapshot effect**

Replace the existing effect body (~lines 1938–1950):

```js
  useEffect(() => { // one aggregate snapshot per calendar month (whole book) for trend lines
    if (!loaded || !scored.length) return;
    const month = iso(Date.now()).slice(0, 7);
    const snaps = st.settings.snapshots || [];
    if (snaps.some(s => s.month === month)) return;
    const act = scored.filter(a => !a.churn);
    const r = retentionStats(scored, st.settings.rates);
    const counts = { Green: 0, Yellow: 0, Red: 0 };
    act.forEach(a => counts[a.risk]++);
    dispatch({ type: "SET_SNAPSHOTS", snapshots: [...snaps.filter(s => s.month !== month),
      { month, totalARR: Math.round(act.reduce((s, a) => s + a.arrUSD, 0)), accounts: act.length,
        nrr: r.nrr, grr: r.grr, churnedARR: Math.round(r.churnedARR), ...counts }].slice(-24) });
  }, [loaded, scored]);
```

with:

```js
  useEffect(() => { // one aggregate snapshot per calendar month (whole book) for trend lines
    if (!loaded || !scored.length) return;
    const month = iso(Date.now()).slice(0, 7);
    const snaps = st.settings.snapshots || [];
    // re-take this month's snapshot once if it predates forecast recording
    if (snaps.some(s => s.month === month && s.commit90 !== undefined)) return;
    const act = scored.filter(a => !a.churn);
    const r = retentionStats(scored, st.settings.rates);
    const counts = { Green: 0, Yellow: 0, Red: 0 };
    act.forEach(a => counts[a.risk]++);
    const due90 = act.filter(a => { const d = daysUntil(a.renewalDate); return d >= 0 && d <= 90; });
    const s90 = list => Math.round(list.reduce((s, a) => s + a.arrUSD, 0));
    dispatch({ type: "SET_SNAPSHOTS", snapshots: [...snaps.filter(s => s.month !== month),
      { month, totalARR: Math.round(act.reduce((s, a) => s + a.arrUSD, 0)), accounts: act.length,
        nrr: r.nrr, grr: r.grr, churnedARR: Math.round(r.churnedARR), ...counts,
        due90: s90(due90), commit90: s90(due90.filter(a => renewalStageOf(a) === "Committed")),
        atRisk90: s90(due90.filter(a => renewalStageOf(a) === "At risk")), due90Count: due90.length }].slice(-24) });
  }, [loaded, scored]);
```

The changed guard makes the effect re-take the *current* month's snapshot exactly once (replacing it via the existing `filter(s => s.month !== month)`), so forecast tracking starts this month rather than next. Older months are never touched.

- [ ] **Step 2: Self-review the diff**

`git diff` — only this effect changed; existing fields still produced identically.

- [ ] **Step 3: Commit**

```bash
git add crm.html
git commit -m "feat: record 90d forecast (due/commit/at-risk) in monthly snapshots"
```

---

### Task 3: RenewalOutcomes table on the Renewals page

**Files:**
- Modify: `crm.html` — component after `quarterKey` consumer `ChurnAnalysis` (~after its closing brace), `Renewals` signature + JSX (~lines 1615–1661), App's Renewals render (~line 2028)

**Interfaces:**
- Consumes: `quarterKey` (Task 1), snapshot `commit90` (Task 2), account fields `renewals[] {completedOn, arr}`, `churn {date, arr, currency}`, `renewalDate`, `currency`, `arrUSD`.
- Produces: `RenewalOutcomes({ accounts, rates, snapshots })` component. `Renewals` gains optional props `allBook`, `rates`, `snapshots`.

- [ ] **Step 1: Add the RenewalOutcomes component**

Directly after the closing brace of the `ChurnAnalysis` function, insert:

```jsx
/* ----------------------- renewal outcomes by quarter ----------------------- */
function RenewalOutcomes({ accounts, rates, snapshots }) {
  const rows = useMemo(() => [4, 3, 2, 1, 0].map(off => {
    const now = new Date();
    const startMonth = Math.floor(now.getMonth() / 3) * 3 - off * 3;
    const start = new Date(now.getFullYear(), startMonth, 1);
    const end = new Date(now.getFullYear(), startMonth + 3, 1);
    const inQ = d => { const t = new Date(d); return t >= start && t < end; };
    let renewed = 0, renewedN = 0, churned = 0, churnedN = 0, slipped = 0;
    accounts.forEach(a => {
      (a.renewals || []).forEach(r => { if (r.completedOn && inQ(r.completedOn)) { renewed += toUSD(r.arr || 0, a.currency, rates); renewedN++; } });
      if (a.churn && inQ(a.churn.date)) { churned += toUSD(a.churn.arr || 0, a.churn.currency || a.currency, rates); churnedN++; }
      if (!a.churn && inQ(a.renewalDate) && daysUntil(a.renewalDate) < 0
          && !(a.renewals || []).some(r => r.completedOn && r.completedOn >= a.renewalDate)) slipped++;
    });
    const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
    const snap = (snapshots || []).find(s => s.month === monthKey && s.commit90 !== undefined);
    const wr = renewed + churned > 0 ? renewed / (renewed + churned) : null;
    return { key: quarterKey(start), renewed, renewedN, churned, churnedN, slipped, wr,
      forecast: snap ? snap.commit90 : null, current: off === 0 };
  }), [accounts, rates, snapshots]);
  const firstForecast = (snapshots || []).find(s => s.commit90 !== undefined);
  const anyForecast = rows.some(r => r.forecast !== null);
  const wrChip = wr => wr === null ? <span className="text-slate-400">—</span>
    : <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${wr >= 0.9 ? "bg-emerald-100 text-emerald-700" : wr >= 0.75 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-600"}`}>{Math.round(100 * wr)}%</span>;
  return (
    <Card title="Renewal outcomes by quarter" className="!p-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-widest text-slate-500">
            <th className="px-2 py-1.5 text-left">Quarter</th>
            <th className="px-2 py-1.5 text-right">Renewed</th>
            <th className="px-2 py-1.5 text-right">Churned</th>
            <th className="px-2 py-1.5 text-right">Slipped</th>
            <th className="px-2 py-1.5 text-right">Win rate</th>
            {anyForecast && <th className="px-2 py-1.5 text-right">Forecast (commit)</th>}
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b border-slate-100 last:border-0">
                <td className="px-2 py-1.5 font-semibold text-slate-700">{r.key}{r.current && <span className="ml-1 text-[11px] font-normal text-slate-400">(so far)</span>}</td>
                <td className="px-2 py-1.5 text-right">{r.renewedN ? <span className="text-emerald-700">{fmtMoney(r.renewed)} <span className="text-xs text-slate-500">· {r.renewedN}</span></span> : "—"}</td>
                <td className="px-2 py-1.5 text-right">{r.churnedN ? <span className="text-rose-600">{fmtMoney(r.churned)} <span className="text-xs text-slate-500">· {r.churnedN}</span></span> : "—"}</td>
                <td className="px-2 py-1.5 text-right">{r.slipped || "—"}</td>
                <td className="px-2 py-1.5 text-right">{wrChip(r.wr)}</td>
                {anyForecast && <td className="px-2 py-1.5 text-right text-xs">{r.forecast === null ? "—"
                  : <span>{fmtMoney(r.forecast)} <span className={r.renewed >= r.forecast ? "text-emerald-600" : "text-rose-600"}>({r.renewed >= r.forecast ? "+" : "−"}{fmtMoney(Math.abs(r.renewed - r.forecast))})</span></span>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!anyForecast && <p className="mt-2 text-xs text-slate-500">
        Forecast tracking started {firstForecast ? new Date(firstForecast.month + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "this month"} — accuracy appears after a full quarter.</p>}
    </Card>
  );
}
```

- [ ] **Step 2: Extend `Renewals` to render it**

Change the `Renewals` signature (~line 1615) from:

```js
function Renewals({ scored, openAccount, dispatch }) {
```

to:

```js
function Renewals({ scored, openAccount, dispatch, allBook = [], rates = {}, snapshots = [] }) {
```

Then, inside its returned JSX, directly after the closing `</div>` of the months rail (`<div className="flex gap-3 overflow-x-auto pb-3">…</div>`, ~line 1658) and before the component's final `</div>`, insert:

```jsx
      <RenewalOutcomes accounts={allBook} rates={rates} snapshots={snapshots} />
```

- [ ] **Step 3: Pass the props from App**

Change the render line (~line 2028) from:

```jsx
{view === "Renewals" && <Renewals scored={active} openAccount={openAccount} dispatch={dispatch} />}
```

to:

```jsx
{view === "Renewals" && <Renewals scored={active} openAccount={openAccount} dispatch={dispatch} allBook={scored} rates={st.settings.rates} snapshots={st.settings.snapshots || []} />}
```

(`scored` in App is the full scored book including churned accounts; `active` remains what the existing UI uses.)

- [ ] **Step 4: Self-review the diff**

`git diff` — three edits only; the existing forecast stats and month rail untouched.

- [ ] **Step 5: Commit**

```bash
git add crm.html
git commit -m "feat: renewal outcomes by quarter with win rate and forecast accuracy"
```

---

### Task 4: E2E verification via the Playwright harness

**Files:**
- Modify (scratchpad, NOT committed): `…\scratchpad\e2e\crm-test.html` (rebuilt), `…\scratchpad\e2e\drive2.js` (new driver)

**Interfaces:**
- Consumes: everything above; the harness pattern from this session.

- [ ] **Step 1: Rebuild the harness copy**

Copy the current `crm.html` over `crm-test.html`, then re-apply the mock: replace the line

```js
const sb = CONFIGURED ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
```

with the full `__mockSb` block that already exists in the old `crm-test.html` (copy it from there — it defines `TEST_PROFILE`, `__mkSnaps`, `__mockSb`, `const sb = __mockSb();` and includes `channel`/`removeChannel` stubs). Also re-add, before `const emptyData = …`:

```js
window.__seed = seedData(); // E2E harness: demo data served by the Supabase mock
```

Then extend `__mkSnaps` so exactly the oldest snapshot carries forecast fields (simulating an aged forecast): inside `__mkSnaps`, after the `out.push({ … })` loop completes, add:

```js
  Object.assign(out[0], { due90: 500000, commit90: 300000, atRisk90: 50000, due90Count: 4 });
```

And seed churn + renewal history: directly after the `window.__seed = seedData();` line, add:

```js
/* E2E: churn + renewal history for analytics checks */
(() => {
  const A = window.__seed.accounts, q = d => d.toISOString().slice(0, 10);
  const now = new Date(), qs = off => new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 - off * 3, 15);
  A[5].churn = { date: q(qs(1)), reason: "Price", arr: A[5].arr, currency: A[5].currency, by: "Tester" };       // Helio, last quarter
  A[5].contractStatus = "Churned";
  A[6].churn = { date: q(qs(2)), reason: "Champion left", arr: A[6].arr, currency: A[6].currency, by: "Tester" }; // Trellis, 2 quarters back
  A[6].contractStatus = "Churned";
  A[0].renewals = [{ completedOn: q(qs(1)), prevArr: 220000, arr: 240000, by: "Tester" }];                      // Northwind renewed last quarter
  A[3].renewals = [{ completedOn: q(qs(2)), prevArr: 70000, arr: 72000, by: "Tester" }];                        // Fernwood, 2 quarters back
})();
```

- [ ] **Step 2: Write the driver**

Create `drive2.js` in the e2e folder (same skeleton as `drive.js`: launch msedge headless, `page.on("pageerror")`, load `crm-test.html`, wait for `text=Total ARR`, `check()` helper, exit code by failures):

```js
/* Checks for churn analysis + renewal outcomes. */
const { chromium } = require("playwright");
const path = require("path");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } });
  page.on("pageerror", e => console.log("PAGEERROR:", e.message));
  await page.goto("file://" + path.join(__dirname, "crm-test.html").replace(/\\/g, "/"));
  await page.waitForSelector("text=Total ARR", { timeout: 30000 });

  // Churn analysis card (Dashboard)
  check("Churn analysis card renders", await page.locator("text=Churn analysis").count() >= 1);
  const cardText = () => page.locator("text=Churn analysis").locator("xpath=ancestor::*[contains(@class,'nm')][1]").innerText();
  let t = await cardText();
  check("Reason mode shows Price", t.includes("Price"));
  check("Reason mode shows Champion left", t.includes("Champion left"));
  for (const dimName of ["CSM", "Tier", "Quarterly"]) {
    await page.locator(`button:has-text('${dimName}')`).last().click();
    await page.waitForTimeout(200);
    t = await cardText();
    if (dimName === "CSM") check("CSM mode shows Sana and Marco", t.includes("Sana") && t.includes("Marco"));
    if (dimName === "Tier") check("Tier mode shows SMB", t.includes("SMB"));
    if (dimName === "Quarterly") check("Quarterly mode shows quarter keys", /\d{4}-Q\d/.test(t));
  }
  await page.screenshot({ path: "shot-4-churn.png", fullPage: true });

  // Renewal outcomes (Renewals page)
  await page.locator("text=Renewals").first().click();
  await page.waitForSelector("text=Renewal outcomes by quarter", { timeout: 10000 });
  const tbl = await page.locator("text=Renewal outcomes by quarter").locator("xpath=ancestor::*[contains(@class,'nm')][1]").innerText();
  check("Outcomes table shows renewed money", /\$2\d\dK/.test(tbl) || tbl.includes("$240K"));
  check("Win rate chip present", /\d+%/.test(tbl));
  check("Quarter keys listed", /\d{4}-Q\d/.test(tbl));
  check("Forecast column present (aged snapshot)", tbl.includes("Forecast (commit)"));
  await page.screenshot({ path: "shot-5-outcomes.png", fullPage: true });

  const fails = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error("DRIVER ERROR:", e.message); process.exit(2); });
```

- [ ] **Step 3: Run it**

```bash
cd "<scratchpad>/e2e" && node drive2.js
```

Expected: all checks PASS, no PAGEERROR lines. Also re-run `node drive.js` (the previous suite) to confirm no regression — expect 25/25. If drive.js fails because its harness copy is stale relative to the new checks, that is expected only for the copy step — the rebuilt `crm-test.html` serves both drivers.

- [ ] **Step 4: Screenshot review**

Read `shot-4-churn.png` and `shot-5-outcomes.png`; confirm the churn bars and the outcomes table render sensibly (no overlapping/blank sections).

- [ ] **Step 5: Commit (product file only — the harness is scratch)**

Nothing to commit if Tasks 1–3 are already committed; this task produces no repo changes. Record the run results in the task report instead.

---

## Self-Review Notes

- Spec §1 (churn card: 4 dims, sorting, empty state, currency fallback) → Task 1.
- Spec §2 (outcomes table: renewed/churned/slipped/win rate, 5 quarters, "—" cells) → Task 3.
- Spec §3 (snapshot fields, current-month re-take, accuracy column + footer note) → Tasks 2 and 3.
- Types consistent: `quarterKey` produced in Task 1, consumed in Task 3; `commit90` produced in Task 2, consumed in Task 3; `Renewals` props threaded in Task 3 Step 3 match Step 2's signature.
