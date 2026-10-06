/* ---------------------------- cohort retention ---------------------------- */
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

/* ---------------------------- churn analysis ---------------------------- */
function ChurnAnalysis({ accounts, rates }) {
  const [dim, setDim] = useState("Reason");
  const rows = useMemo(() => churnRows(accounts, rates, dim), [accounts, rates, dim]);
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

/* ----------------------- renewal outcomes by quarter ----------------------- */
function RenewalOutcomes({ accounts, rates, snapshots }) {
  const rows = useMemo(() => renewalOutcomeRows(accounts, rates, snapshots), [accounts, rates, snapshots]);
  const firstForecast = (snapshots || []).find(s => s.commit90 !== undefined);
  const anyForecast = rows.some(r => r.forecast !== null);
  const wrChip = wr => wr === null ? <span className="text-slate-400">—</span>
    : <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${wr >= 0.9 ? "bg-emerald-100 text-emerald-700" : wr >= 0.75 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-600"}`}>{Math.round(100 * wr)}%</span>;
  return (
    <Card title="Renewal outcomes by quarter" className="!p-3">
      {rows.every(r => !r.renewedN && !r.churnedN && !r.slipped)
        ? <p data-outcomes-empty className="text-sm text-slate-500">No renewals closed yet — outcomes appear here as renewals complete.</p>
        : <div className="overflow-x-auto">
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
                <td className="px-2 py-1.5 font-semibold text-slate-700">{r.key}{r.current && <span className="ml-1 text-[11px] font-normal text-slate-500">(so far)</span>}</td>
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
      </div>}
      {!anyForecast && <p className="mt-2 text-xs text-slate-500">
        Forecast tracking started {firstForecast ? new Date(firstForecast.month + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "this month"} — accuracy appears after a full quarter.</p>}
    </Card>
  );
}

const OPP_STAGE_WEIGHT = { Discovery: 0.2, Proposal: 0.5, Negotiation: 0.7, Stalled: 0.1 };
// The AM book card. Collapsed it shows one totals row per handover cohort; expanded it
// shows the accounts behind each. Deliberately NOT filtered by the dashboard's mine/all
// scope toggle -- this is a book-level reconciliation, not a personal work list.
function AmBookCard({ book, openAccount }) {
  const [open, setOpen] = useState(false);
  const money = n => fmtMoney(n);
  const GRID = "grid grid-cols-[minmax(0,1fr)_repeat(4,minmax(5rem,7rem))] items-center gap-x-6";
  const SECTIONS = [
    ["owned", `Owned before ${book.year}`],
    ["moved", `Moved to AM in ${book.year}`],
    ["scheduled", "Scheduled handover"],
  ];
  // Section 3 holds accounts that are not AM's book yet, so year movement on them would
  // be misleading -- it shows the ARR waiting to move across and nothing else.
  const Row = ({ label, r, pending, onClick, indent }) => (
    <div onClick={onClick} role={onClick ? "button" : undefined}
      className={`${GRID} py-1 text-sm ${indent ? "pl-4 text-slate-600" : "font-semibold text-slate-800"} ${onClick ? "cursor-pointer rounded hover:bg-slate-50" : ""}`}>
      <span className="truncate">{label}</span>
      <span className="text-right tabular-nums">{pending ? "—" : money(r.opening)}</span>
      <span className="text-right tabular-nums text-emerald-600">{pending ? "—" : (r.expansion ? "+" + money(r.expansion) : "—")}</span>
      <span className="text-right tabular-nums text-rose-600">{pending ? "—" : (r.reduction ? "-" + money(r.reduction) : "—")}</span>
      <span className="text-right tabular-nums">{money(r.current)}</span>
    </div>
  );
  return (
    <Card title="AM book by handover" className="!p-3"
      right={<button data-am-book-toggle onClick={() => setOpen(o => !o)}
        className="text-xs text-slate-500 hover:text-slate-800">{open ? "▾ Hide accounts" : "▸ Show accounts"}</button>}>
      {/* below lg the five-column table scrolls inside the card instead of crushing the labels */}
      <div className="max-lg:-mx-1 max-lg:overflow-x-auto max-lg:px-1">
      <div data-am-book className="max-lg:min-w-[36rem]">
        <div className={`${GRID} border-b border-slate-200 pb-1 text-[11px] font-bold uppercase tracking-widest text-slate-500`}>
          <span></span><span className="text-right">1 Jan</span><span className="text-right">Expansion</span>
          <span className="text-right">Reduction</span><span className="text-right">Today</span>
        </div>
        {SECTIONS.map(([key, label]) => {
          const sec = book[key], pending = key === "scheduled";
          return (
            <div key={key} className="mt-2">
              <Row label={`${label} (${sec.totals.count})`} r={sec.totals} pending={pending} />
              {open && sec.accounts.length === 0 && <div className="pl-4 py-1 text-xs text-slate-500">None.</div>}
              {open && sec.accounts.map(r => (
                <Row key={r.id} indent onClick={() => openAccount(r.id)} label={r.name} pending={pending} r={r} />
              ))}
            </div>
          );
        })}
      </div>
      </div>
    </Card>
  );
}
