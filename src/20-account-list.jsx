/* ------------------------------ list windowing ------------------------------ */
// At or below this many rows the list renders exactly as it always has -- no spacers, no
// measurement, no scroll listener. Windowing only earns its keep on long lists, and the
// health suite seeds small ones, so small lists keep taking the original path.
const WINDOW_MIN_ROWS = 100;
// Rows rendered beyond each edge of the viewport, so a fast scroll does not show a gap
// before React commits the next slice.
const WINDOW_OVERSCAN = 10;
// Slice rendered on the very first paint, before a real row exists to measure. Big
// enough to fill a tall viewport, small enough that 2000 rows never hit the DOM.
const WINDOW_FIRST_PAINT = 60;

// Pure arithmetic: which slice of `total` rows intersects the viewport, and how much
// blank space stands in for the rows above and below it. No DOM, no React -- readable
// (and checkable) on its own.
function windowRange(total, rowHeight, scrollTop, viewportH, overscan) {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(total, start + Math.ceil(viewportH / rowHeight) + overscan * 2);
  return { start, end, padTop: start * rowHeight, padBottom: Math.max(0, (total - end) * rowHeight) };
}

// Owns the DOM plumbing windowRange deliberately does not: where we are scrolled, how
// tall the viewport is, and -- the part that is easy to get wrong -- how tall one row
// ACTUALLY is. Row height is measured from a rendered row and re-measured on resize; it
// is 28px at a 1440px viewport and near 50px at 1100px, so any hardcoded constant would
// misplace every row the first time someone resizes the window.
function useWindowedRows(items, overscan = WINDOW_OVERSCAN) {
  const scrollRef = useRef(null);
  const rowRef = useRef(null);
  const [metrics, setMetrics] = useState({ scrollTop: 0, viewportH: 0 });
  const [rowHeight, setRowHeight] = useState(0);
  const total = items.length;
  const windowed = total > WINDOW_MIN_ROWS;

  useEffect(() => {
    const el = scrollRef.current;
    if (!windowed || !el) return;
    const read = () => setMetrics(m => (m.scrollTop === el.scrollTop && m.viewportH === el.clientHeight
      ? m : { scrollTop: el.scrollTop, viewportH: el.clientHeight }));
    read();
    el.addEventListener("scroll", read, { passive: true });
    let ro = null;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(read); ro.observe(el); }
    window.addEventListener("resize", read);
    return () => {
      el.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
      if (ro) ro.disconnect();
    };
  }, [windowed]);

  // Measured, never assumed. Re-runs on mount, on resize, and whenever the row set
  // changes shape (a new column appears with the QBR filter, for instance).
  useEffect(() => {
    if (!windowed) return;
    const measure = () => {
      const el = rowRef.current;
      if (!el) return;
      const h = el.getBoundingClientRect().height;
      // Only commit a real change, or measure -> setState -> measure would never settle.
      if (h > 0) setRowHeight(prev => (Math.abs(prev - h) > 0.5 ? h : prev));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [windowed, total, metrics.viewportH]);

  if (!windowed) return { scrollRef, rowRef, windowed: false, start: 0, end: total, padTop: 0, padBottom: 0 };
  // First paint: nothing has been measured yet, so render a small head slice rather than
  // the whole list. The measure effect fires immediately afterwards.
  if (!(rowHeight > 0) || !(metrics.viewportH > 0)) {
    return { scrollRef, rowRef, windowed: true, start: 0, end: Math.min(total, WINDOW_FIRST_PAINT), padTop: 0, padBottom: 0 };
  }
  return { scrollRef, rowRef, windowed: true, ...windowRange(total, rowHeight, metrics.scrollTop, metrics.viewportH, overscan) };
}

function AccountList({ scored, allAccounts, openAccount, searchRef, dispatch, team, initialFilter, user, settings }) {
  const [adding, setAdding] = useState(false);
  const [showChurned, setShowChurned] = useState(false);
  const churnedCount = scored.filter(a => a.churn).length;
  const [q, setQ] = useState(""); const [tier, setTier] = useState("All"); const [risk, setRisk] = useState("All");
  const [csm, setCsm] = useState("All"); const [renew, setRenew] = useState("All");
  const [billing, setBilling] = useState("All");
  const [onlyChurned, setOnlyChurned] = useState(false);
  const [qbrDue, setQbrDue] = useState(false);
  // in-memory only, like every other filter; saved into segments with the rest
  const [noActivity, setNoActivity] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const toggleOne = id => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [bulkAction, setBulkAction] = useState(null); // "csm" | "tier" | "task" | "churn" | "delete"
  const [sort, setSort] = useState({ k: "accountNo", dir: 1 });
  const [activeSeg, setActiveSeg] = useState("");
  const [pendingSeg, setPendingSeg] = useState(null);
  const segments = (settings && settings.segments) || [];
  // Applies ONLY the keys the caller actually supplied. Dashboard cards pass a partial
  // filter and must leave everything else -- notably the user's typed `q` -- untouched;
  // a saved segment carries all ten keys, so applying one sets every field. Same code
  // path, different payloads. Do NOT turn this into a full reset.
  const applyFilter = useCallback(f => {
    const has = k => Object.prototype.hasOwnProperty.call(f, k);
    if (has("q")) setQ(f.q);
    if (has("tier")) setTier(f.tier);
    if (has("risk")) setRisk(f.risk);
    if (has("csm")) setCsm(f.csm);
    if (has("renew")) setRenew(f.renew);
    if (has("billing")) setBilling(f.billing);
    if (has("showChurned")) setShowChurned(!!f.showChurned);
    if (has("onlyChurned")) setOnlyChurned(!!f.onlyChurned);
    if (has("qbrDue")) setQbrDue(!!f.qbrDue);
    if (has("noActivity")) setNoActivity(!!f.noActivity);
    if (has("sort")) setSort(f.sort);
  }, []);
  // layout effect: a dashboard hand-off filters before the first paint, so the list never flashes unfiltered
  React.useLayoutEffect(() => { if (initialFilter) applyFilter(initialFilter); }, [initialFilter, applyFilter]);
  useEffect(() => { if (pendingSeg) applyFilter(pendingSeg); }, [pendingSeg, applyFilter]);
  const fileRef = useRef(null);
  const [importMsg, setImportMsg] = useState(null);
  const csms = ["All", ...new Set(scored.map(a => a.csm))];
  // Retention is a property of the ACCOUNT, not of the current sort or filter. Computing
  // it inside the rows memo made every sort replay all 2000 ledgers -- measured at 476ms
  // against a <300ms budget, undoing the windowing from #34. Keyed on scored+rates, it is
  // computed once and reused across every sort and filter change.
  const retById = useMemo(() => {
    const rates = (settings && settings.rates) || {};
    const m = new Map();
    scored.forEach(a => m.set(a.id, accountRetention(a, rates)));
    return m;
  }, [scored, settings]);
  const rows = useMemo(() => {
    let r = scored.filter(a => (showChurned || !a.churn) && (!onlyChurned || a.churn) &&
      (!q || (a.name + a.industry).toLowerCase().includes(q.toLowerCase())) &&
      (tier === "All" || a.tier === tier) && (risk === "All" || a.risk === risk) && (csm === "All" || a.csm === csm) &&
      (billing === "All" || (billing === "Completed") === !!a.billingCompleted) &&
      (!noActivity || a.flags.includes("No activity 30d+")) &&
      (!qbrDue || ["due", "overdue"].includes(qbrStatus(a)?.kind || "")) &&
      (renew === "All" || (daysUntil(a.renewalDate) >= 0 && daysUntil(a.renewalDate) <= +renew)));
    r = r.map(a => ({ ...a, _ret: retById.get(a.id) }));
    const get = a => sort.k === "renewalDate" ? daysUntil(a.renewalDate)
      : sort.k === "arr" ? a.arrUSD
      : sort.k === "nrr" ? (a._ret.nrr ?? -1)
      : sort.k === "grr" ? (a._ret.grr ?? -1)
      : sort.k === "movement" ? (a._ret.pct ?? -Infinity)
      : a[sort.k];
    const sorted = [...r].sort((a, b) => (get(a) > get(b) ? 1 : get(a) < get(b) ? -1 : 0) * sort.dir);
    // group: each top-level row followed by its (filter-surviving) subs; subs whose
    // parent is filtered out appear at their own sorted position
    const byParent = new Map();
    sorted.forEach(a => { if (a.parentId) byParent.set(a.parentId, [...(byParent.get(a.parentId) || []), a]); });
    const topIds = new Set(sorted.filter(a => !a.parentId).map(a => a.id));
    const out = [];
    sorted.forEach(a => {
      if (a.parentId && topIds.has(a.parentId)) return; // rendered under its parent
      out.push(a);
      (byParent.get(a.id) || []).forEach(s => out.push({ ...s, _sub: true }));
    });
    return out;
  }, [scored, q, tier, risk, csm, renew, billing, sort, showChurned, onlyChurned, qbrDue, noActivity, retById]);
  // a selection must never outlive the rows that produced it
  useEffect(() => { setSelected(new Set()); }, [q, tier, risk, csm, renew, billing, showChurned, onlyChurned, qbrDue, noActivity]);
  // teammates' edits arrive via a ~800ms realtime refetch and can change the visible
  // row set underneath a selection -- prune ids that no longer exist, but never wipe
  // the rest of an in-progress selection just because something elsewhere changed.
  useEffect(() => {
    const live = new Set(scored.map(a => a.id));
    setSelected(s => {
      const n = new Set([...s].filter(id => live.has(id)));
      return n.size === s.size ? s : n;
    });
  }, [scored]);
  const allVisibleSelected = rows.length > 0 && rows.every(a => selected.has(a.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(rows.map(a => a.id)));
  // rollup: sum of non-churned sub ARR (USD) per parent, over the whole book
  const subArr = useMemo(() => {
    const m = new Map();
    scored.forEach(a => { if (a.parentId && !a.churn) m.set(a.parentId, (m.get(a.parentId) || 0) + a.arrUSD); });
    return m;
  }, [scored]);
  const subNo = useMemo(() => subNumbers(scored), [scored]);
  // Windowing acts ONLY on the render slice. `rows` stays the full filtered, sorted,
  // parent/sub-grouped list, and everything that reasons about the list -- the count in
  // the title, Export CSV, allVisibleSelected, toggleAll -- keeps reading `rows`.
  // Select-all must mean "all filtered rows", which is the whole reason this is
  // virtualization and not pagination.
  const win = useWindowedRows(rows);
  const visibleRows = win.windowed ? rows.slice(win.start, win.end) : rows;
  // +3 for NRR, GRR and movement. Drives the empty-state row AND the windowing spacer
  // rows -- if this is wrong the table misaligns, but only above the 100-row windowing
  // threshold, so the virtualization tests are what catch it.
  const colCount = qbrDue ? 15 : 14;
  const Th = ({ k, children, className = "" }) => (
    <th data-sort-key={k} aria-sort={sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
        className={`cursor-pointer select-none px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-800 ${className}`}
        onClick={() => setSort(s => ({ k, dir: s.k === k ? -s.dir : 1 }))}>
      {children}{sort.k === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
  // Quick pills only SET existing filter state; their pressed state is derived from that
  // state on every render (never stored), so a dropdown change un-presses a pill.
  const live = scored.filter(a => showChurned || !a.churn);
  const hasMine = !!user.name && scored.some(a => !a.churn && a.csm === user.name);
  const allOn = tier === "All" && risk === "All" && csm === "All" && renew === "All" && billing === "All" && !noActivity;
  const quick = [
    { k: "all", label: "All", on: allOn, n: live.length,
      go: () => { setTier("All"); setRisk("All"); setCsm("All"); setRenew("All"); setBilling("All"); setNoActivity(false); } },
    { k: "risk", label: "At risk", on: risk === "Red", n: live.filter(a => a.risk === "Red").length, go: () => setRisk(risk === "Red" ? "All" : "Red") },
    { k: "renew", label: "Renewing ≤ 90d", on: renew === "90", n: live.filter(a => daysUntil(a.renewalDate) >= 0 && daysUntil(a.renewalDate) <= 90).length,
      go: () => setRenew(renew === "90" ? "All" : "90") },
    { k: "noActivity", label: "No activity 30d+", on: noActivity, n: live.filter(a => a.flags.includes("No activity 30d+")).length, go: () => setNoActivity(v => !v) },
    ...(hasMine ? [{ k: "mine", label: "My book", on: csm === user.name, n: live.filter(a => a.csm === user.name).length,
      go: () => setCsm(csm === user.name ? "All" : user.name) }] : []),
  ];
  const book = scored.filter(a => !a.churn);
  const canEdit = user.role !== "lead" && !isImplRole(user);
  return (
    <div className="acct-page flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <p data-accounts-summary className="acct-meta min-w-0 flex-1 basis-[240px] text-[13.5px]">
          {book.length} accounts · {fmtMoney(book.reduce((t, a) => t + (a.arrUSD || 0), 0))} ARR · {book.filter(a => a.risk === "Red").length} at risk
          {churnedCount > 0 && !showChurned ? ` · ${churnedCount} churned hidden` : ""}</p>
        {canEdit && <Btn onClick={() => fileRef.current && fileRef.current.click()}>Import CSV</Btn>}
        <Btn onClick={() => exportCSV(rows, settings && settings.customFields)}>Export CSV</Btn>
        {canEdit && <Btn kind="primary" onClick={() => setAdding(a => !a)}>+ New account</Btn>}
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={e => { const f = e.target.files[0]; e.target.value = ""; if (f) importAccountsCSV(f, allAccounts, dispatch, setImportMsg, user, settings && settings.customFields); }} />
      </div>
      <div role="group" aria-label="Quick filters" className="flex flex-wrap gap-2">
        {quick.map(p => <button key={p.k} type="button" data-quick={p.k} aria-pressed={p.on ? "true" : "false"} className="acct-quick" onClick={p.go}>
          {p.label}<span data-quick-count className="acct-quick-n">{p.n}</span></button>)}
      </div>
      <section aria-label="Accounts" className="nm acct-card min-w-0">
        {/* A visually-hidden live region announces the filtered count (the visible count is in
            the summary line above). */}
        <span data-live="results" aria-live="polite" className="sr-only">{rows.length} accounts</span>
        {/* A live region must already be in the DOM when its content changes, or the change is
            frequently not announced. This sr-only region is permanent and mirrors a short form
            of the result; the visual banner below is left structurally untouched, because
            csv.test.mjs locates it as "the first div whose text starts with Imported". */}
        <span data-live="import" aria-live="polite" className="sr-only">
          {importMsg ? (importMsg.err || `Imported ${importMsg.ok} new, updated ${importMsg.updated} existing`) : ""}
        </span>
        {importMsg && <div className={`nm-sm mb-3 flex items-center gap-2 p-3 text-sm ${importMsg.err ? "text-rose-600" : (importMsg.badTier || importMsg.badStatus || importMsg.badValue || importMsg.badNumber || importMsg.badCurrency || importMsg.badDate || importMsg.badCustom || importMsg.churnSkipped?.length) ? "text-amber-700" : "text-emerald-700"}`}>
          {importMsg.err ? importMsg.err : <>Imported {importMsg.ok} new · updated {importMsg.updated} existing (matched by account # or name){importMsg.skipped ? ` · skipped ${importMsg.skipped} row(s) without a name` : ""}. Columns: accountNo, name (required), tier, arr, currency, industry, csm, startDate, transitionDate, renewalDate, contractStatus, modules, licenses, dedicatedSupport, billingCompleted, billingCompletedDate, usage, sentiment, tickets, nps, caseStudy, approvedSavings, approvedRoi, plus a column per custom field (headed by its label).
            {/* coercions last and bold: buried mid-sentence ahead of the column list, a silently
                rewritten row looked identical to a clean import */}
            {(importMsg.badTier || importMsg.badStatus || importMsg.badValue || importMsg.badNumber || importMsg.badCurrency || importMsg.badDate || importMsg.badCustom || importMsg.churnSkipped?.length) && <span className="font-bold">
              {importMsg.badValue ? ` ⚠ ${importMsg.badValue} unreadable Value answer(s) left unchanged (use yes/no).` : ""}
              {importMsg.badNumber ? ` ⚠ ${importMsg.badNumber} unreadable number(s) in arr/licenses/deployedLicenses left unchanged (${importMsg.badNumberRows.join(", ")}).` : ""}
              {importMsg.badCurrency ? ` ⚠ ${importMsg.badCurrency} unrecognized currency value(s) left unchanged (use USD, INR or PHP).` : ""}
              {importMsg.badDate ? ` ⚠ ${importMsg.badDate} unreadable date(s) left unchanged (${importMsg.badDateRows.join(", ")}).` : ""}
              {importMsg.badCustom ? ` ⚠ ${importMsg.badCustom} custom field value(s) didn't fit the field type and were left unchanged (${importMsg.badCustomRows.join(", ")}).` : ""}
              {importMsg.churnSkipped?.length ? ` ⚠ Not imported, marked Churned in the file: ${importMsg.churnSkipped.join(", ")} — churn them from the account page.` : ""}
              {importMsg.badTier ? ` ⚠ ${importMsg.badTier} row(s) had an unrecognized tier (set to Mid).` : ""}
              {importMsg.badStatus ? ` ⚠ ${importMsg.badStatus} row(s) had an unrecognized status (set to Active).` : ""}
            </span>}</>}
          <button className="ml-auto text-xs font-semibold text-slate-500 hover:text-slate-800" onClick={() => setImportMsg(null)} aria-label="Dismiss import message">✕</button>
        </div>}
        {adding && <div className="nm-inset mb-4 p-4"><AccountForm dispatch={dispatch} onDone={() => setAdding(false)} team={team} accounts={allAccounts} user={user} customFields={settings && settings.customFields} /></div>}
        <div data-acct-toolbar className="acct-toolbar flex flex-wrap items-center gap-2">
          <Select data-segment-select value={activeSeg} className="w-40" aria-label="Saved segment"
            onChange={e => {
              const id = e.target.value; setActiveSeg(id);
              const s = segments.find(x => x.id === id);
              // stamp with `t` so re-picking the same segment is still a new object and
              // the effect re-applies it after the user has hand-edited the filters
              // a segment saved before noActivity existed lacks the key: treat it as off
              if (s) setPendingSeg({ ...s.filter, noActivity: !!s.filter.noActivity, t: Date.now() });
            }}
            options={["", ...segments.map(s => s.id)]}
            labels={{ "": "— segment —", ...Object.fromEntries(segments.map(s => [s.id, s.name])) }} />
          {/* Segments live in the `settings` row, whose RLS policy is admin-only
              (settings_write ... using (is_admin())). Showing these to a CSM would give
              them an optimistic segment, a rejected write and a "Save failed (settings)"
              toast, with nothing left after a reload. Everyone can still APPLY a segment
              an admin saved -- reads are open to all authenticated users. */}
          {user.role === "admin" && <Btn data-save-segment onClick={() => {
            const name = window.prompt("Name this segment");
            if (!name) return;
            const seg = { id: uid(), name, filter: { q, tier, risk, csm, renew, billing, showChurned, onlyChurned, qbrDue, noActivity, sort } };
            dispatch({ type: "SET_SEGMENTS", segments: [...segments, seg] });
          }}>Save view</Btn>}
          {user.role === "admin" && activeSeg && <Btn data-delete-segment onClick={() => {
            dispatch({ type: "SET_SEGMENTS", segments: segments.filter(s => s.id !== activeSeg) });
            setActiveSeg("");
          }}>Delete segment</Btn>}
          <Input placeholder="Search  ( / )" aria-label="Search accounts" value={q} onChange={e => setQ(e.target.value)} className="acct-search" ref={searchRef} />
          <Select aria-label="Filter by tier" value={tier} onChange={e => setTier(e.target.value)} options={["All", "Enterprise", "Mid", "SMB"]} labels={{ All: "Tier: All" }} />
          <Select aria-label="Filter by health risk" value={risk} onChange={e => setRisk(e.target.value)} options={["All", "Green", "Yellow", "Red"]} labels={{ All: "Health: All" }} />
          <Select aria-label="Filter by CSM" value={csm} onChange={e => setCsm(e.target.value)} options={csms} labels={{ All: "CSM: All" }} />
          <Select aria-label="Filter by renewal window in days" value={renew} onChange={e => setRenew(e.target.value)} options={["All", "30", "60", "90"]} labels={{ All: "Renewal: any", 30: "Renewal ≤ 30d", 60: "Renewal ≤ 60d", 90: "Renewal ≤ 90d" }} />
          <Select aria-label="Filter by billing status" value={billing} onChange={e => setBilling(e.target.value)} options={["All", "Completed", "Pending"]} labels={{ All: "Billing: All", Completed: "Billing: Completed", Pending: "Billing: Pending" }} />
          {churnedCount > 0 && <label className="ml-2 flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={showChurned} onChange={e => { setShowChurned(e.target.checked); if (!e.target.checked) setOnlyChurned(false); }} />show churned ({churnedCount})</label>}
          {onlyChurned && <button className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-600" onClick={() => setOnlyChurned(false)} title="Remove churned-only filter">churned only ✕</button>}
          {qbrDue && <button className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700" onClick={() => setQbrDue(false)} title="Remove QBR-due filter">QBR due ✕</button>}
        </div>
        {selected.size > 0 && !isImplRole(user) && (
          <div data-bulkbar className="acct-bulk flex flex-wrap items-center gap-2">
            <span data-live="selection" aria-live="polite" className="acct-bulk-n text-sm font-bold">{selected.size} selected</span>
            {isAdminUser(user) && <Btn onClick={() => setBulkAction("csm")}>Reassign CSM</Btn>}
            <Btn onClick={() => setBulkAction("tier")}>Change tier</Btn>
            <Btn onClick={() => setBulkAction("task")}>Add task</Btn>
            <Btn onClick={() => setBulkAction("churn")}>Churn</Btn>
            <Btn onClick={() => setBulkAction("delete")}>Delete</Btn>
            <button className="ml-auto text-xs font-semibold text-slate-500 hover:text-slate-800"
              onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
        )}
        {bulkAction && <BulkDialog kind={bulkAction} ids={[...selected]} accounts={allAccounts}
          team={team} user={user} dispatch={dispatch}
          onClose={() => { setBulkAction(null); setSelected(new Set()); }} />}
        <div ref={win.scrollRef} data-account-scroll className="max-h-[65vh] overflow-auto">
          <table className="acct-table w-full text-[13.5px]">
            <thead className="sticky top-0 z-10 bg-white"><tr className="border-b border-slate-200">
              <th className="w-8 px-2 py-1.5">
                {!isImplRole(user) && <input type="checkbox" data-select-all aria-label="Select all filtered accounts"
                  checked={allVisibleSelected} onChange={toggleAll} />}
              </th>
              <Th k="accountNo">#</Th><Th k="name">Account</Th><Th k="tier">Tier</Th><Th k="arr">ARR</Th><Th k="industry">Industry</Th>
              <Th k="csm">CSM</Th><Th k="score">Health</Th><Th k="nrr">NRR</Th><Th k="grr">GRR</Th><Th k="movement">vs {rows[0]?._ret?.baselineKey || "Dec"}</Th><Th k="renewalDate">Renewal</Th>{qbrDue && <Th k="nextQbrDate">Next QBR</Th>}<Th k="billingCompletedDate">Billing</Th><th className="px-2 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Flags</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={colCount} className="px-2 py-8 text-center text-sm text-slate-500">
                {scored.length === 0 ? (user.role === "lead" ? "No accounts are assigned to you yet." : isImplRole(user) ? "No accounts yet." : <>No accounts yet — click <b>+ New account</b> to add your first, or load sample data from Settings.</>) : "No accounts match the current filters."}
              </td></tr>}
              {/* Spacers stand in for the rows that are not rendered, so the scrollbar and
                  every row's position match the FULL list. aria-hidden: they carry no
                  content, and a screen reader should not meet two empty rows. */}
              {win.padTop > 0 && <tr data-row-spacer="top" aria-hidden="true" style={{ height: win.padTop }}>
                <td colSpan={colCount} style={{ height: win.padTop, padding: 0, border: 0 }} /></tr>}
              {visibleRows.map((a, i) => {
                const d = daysUntil(a.renewalDate);
                return (
                  <tr key={a.id} data-account-row ref={i === 0 ? win.rowRef : null} data-selected={selected.has(a.id) ? "" : undefined} className={`acct-row cursor-pointer ${a.churn ? "opacity-50" : ""}`} onClick={() => openAccount(a.id)}>
                    <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                      {!isImplRole(user) && <input type="checkbox" data-select={a.id} aria-label={`Select ${a.name}`}
                        checked={selected.has(a.id)} onChange={() => toggleOne(a.id)} />}
                    </td>
                    <td className="px-2 py-1.5 text-xs tabular-nums text-slate-500">{subNo.get(a.id) || a.accountNo || "—"}</td>
                    {/* Account cell: avatar + name + industry line. Name and industry both truncate:
                        a wrapped row is a taller row, which would break the single measured row
                        height windowing depends on. */}
                    <td className="acct-name-cell max-w-[160px] px-2 py-1.5" title={a.name}>
                      <span className="flex min-w-0 items-center gap-2.5">
                        {a._sub && <span className="acct-meta shrink-0"><span aria-hidden="true">↳</span><span className="sr-only">Sub-account: </span></span>}
                        <span aria-hidden="true" data-avatar className="acct-av" data-av={avatarSlot(a.id)}>{initialsOf(a.name)}</span>
                        <span className="min-w-0">
                          <span data-account-name className="block truncate font-semibold acct-fg">{a.name}{a.churn && <span className="acct-churned ml-2">churned</span>}</span>
                          <span data-industry-sub className="block truncate text-xs acct-meta">{a.industry || " "}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-2 acct-label">{a.tier}</td>
                    <td className="px-2 text-right tabular-nums"><b className="font-bold">{fmtMoney(a.arr, a.currency)}</b>
                      {subArr.has(a.id)
                        ? <span className="acct-sigma block text-[11.5px] font-semibold" title="Own + sub-accounts (USD)">Σ {fmtMoney(a.arrUSD + subArr.get(a.id))}</span>
                        : a.currency !== "USD" && <span className="block text-[11.5px] acct-meta">≈{fmtMoney(a.arrUSD)}</span>}</td>
                    <td className="max-w-[92px] truncate px-2 acct-label" title={a.industry}>{a.industry}</td>
                    <td className="px-2">{a.csm && <span className="relative inline-flex items-center gap-1.5" title={a.csm}><span aria-hidden="true" className="acct-csm-av">{initialsOf(a.csm)}</span><span aria-hidden="true" className="acct-label">{a.csm.split(" ")[0]}</span><span className="sr-only">{a.csm}</span></span>}</td>
                    <td className="px-2">{(() => { const rk = riskOf(a.score); return <span className="inline-flex items-center gap-1.5" data-risk={rk} title={`Health ${a.score} · ${RISK_WORD[rk]}`}>
                      <span aria-hidden="true" className="acct-track"><span className="acct-bar" style={{ width: `${Math.max(0, Math.min(100, a.score))}%` }} /></span>
                      <b className="acct-h text-[13px] tabular-nums">{a.score}</b><span data-health-word className="acct-h text-xs">{RISK_WORD[rk]}</span></span>; })()}</td>
                    <td className="px-2 text-right text-[12.5px] tabular-nums acct-label" data-nrr>{a._ret.nrr === null ? "—" : `${Math.round(a._ret.nrr * 100)}%`}</td>
                    <td className="px-2 text-right text-[12.5px] tabular-nums acct-label" data-grr>{a._ret.grr === null ? "—" : `${Math.round(a._ret.grr * 100)}%`}</td>
                    <td className="px-2 text-xs" data-movement>
                      {a._ret.isNew
                        ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">new</span>
                        : a._ret.delta === 0
                          ? <span className="text-slate-400" title="No change since the prior-year close">—</span>
                          : <span className={a._ret.delta > 0 ? "text-emerald-600" : "text-rose-600"}>
                              {a._ret.delta > 0 ? "▲" : "▼"} {a._ret.pct === null ? "—" : `${a._ret.pct > 0 ? "+" : ""}${a._ret.pct.toFixed(1)}%`}
                            </span>}
                    </td>
                    <td className="px-2"><span className="block acct-label">{fmtDate(a.renewalDate)}</span><span className="mt-0.5 inline-block"><DaysChip days={d} /></span></td>
                    {qbrDue && <td className="px-2">{(() => { const qd = a.nextQbrDate ? daysUntil(a.nextQbrDate) : null;
                      return qd === null ? <span className="text-xs text-slate-500">—</span>
                        : <span className={`text-xs font-semibold ${qd < 0 ? "text-rose-600" : "text-amber-600"}`}>{fmtDate(a.nextQbrDate)} · {qd < 0 ? `${-qd}d overdue` : `in ${qd}d`}</span>; })()}</td>}
                    <td className="px-2 text-xs">{a.billingCompleted
                      ? <span data-billing-pill="done" className="whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">✓ {fmtDate(a.billingCompletedDate)}</span>
                      : <span data-billing-pill="pending" className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">Pending</span>}</td>
                    <td className="acct-flags-cell px-2" title={a.flags.join(" · ") || undefined}><span className="flex max-h-[43px] flex-wrap gap-[3px] overflow-hidden">{a.flags.map(f => <FlagPill key={f} flag={f} />)}</span></td>
                  </tr>
                );
              })}
              {win.padBottom > 0 && <tr data-row-spacer="bottom" aria-hidden="true" style={{ height: win.padBottom }}>
                <td colSpan={colCount} style={{ height: win.padBottom, padding: 0, border: 0 }} /></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

