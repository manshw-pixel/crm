/* ------------------------------- Renewals ------------------------------- */
const RENEWAL_STAGES = ["Not started", "Outreach", "Quote sent", "Negotiating", "Committed", "At risk"];
const RENEWAL_STAGE_STYLE = {
  "Not started": "bg-slate-100 text-slate-600", Outreach: "bg-sky-100 text-sky-700", "Quote sent": "bg-indigo-100 text-indigo-700",
  Negotiating: "bg-amber-100 text-amber-700", Committed: "bg-emerald-100 text-emerald-700", "At risk": "bg-rose-100 text-rose-700",
};
const renewalStageOf = a => a.renewalStage || "Not started";
function Renewals({ scored, openAccount, dispatch, allBook = [], rates = {}, snapshots = [], tasks = [], user }) {
  const months = [];
  const now = new Date(); now.setDate(1);
  for (let i = 0; i < 12; i++) {
    const m = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`; // local, not toISOString — UTC shifts the month
    months.push({ key, label: m.toLocaleDateString("en-US", { month: "short", year: "numeric" }), items: scored.filter(a => a.renewalDate.slice(0, 7) === key) });
  }
  // 90-day forecast by renewal stage (USD)
  const due90 = scored.filter(a => { const d = daysUntil(a.renewalDate); return d >= 0 && d <= 90; });
  const sum = list => list.reduce((s, a) => s + a.arrUSD, 0);
  const commit = sum(due90.filter(a => renewalStageOf(a) === "Committed"));
  const atRisk = sum(due90.filter(a => renewalStageOf(a) === "At risk"));
  const best = sum(due90) - atRisk;
  const notStarted = due90.filter(a => renewalStageOf(a) === "Not started");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Due next 90d" value={fmtMoney(sum(due90))} sub={`${due90.length} renewal(s)`} />
        <Stat label="Commit (90d)" value={fmtMoney(commit)} tone="text-emerald-600" sub="stage: Committed" />
        <Stat label="Best case (90d)" value={fmtMoney(best)} sub="everything except At risk" />
        <Stat label="At risk (90d)" value={fmtMoney(atRisk)} tone={atRisk ? "text-rose-600" : undefined} sub={`${notStarted.length} not started yet`} />
      </div>
      <HScroll className="flex gap-3 overflow-x-auto pb-3">
      {months.map(m => (
        <div key={m.key} data-col className="nm w-56 shrink-0 p-4">
          <div className="mb-2 flex justify-between text-xs font-semibold text-slate-700">
            <span>{m.label}</span><span>{m.items.length ? fmtMoney(m.items.reduce((s, a) => s + a.arrUSD, 0)) + " USD" : ""}</span>
          </div>
          {m.items.length === 0 && <div className="text-xs italic text-slate-400">—</div>}
          {m.items.map(a => (
            <div key={a.id} onClick={() => openAccount(a.id)} className="nm-sm mb-3 w-full cursor-pointer p-2.5 text-left hover:bg-slate-50">
              <div className="flex items-center justify-between text-sm font-medium">{a.name}<HealthChip score={a.score} /></div>
              <div className="mt-0.5 text-xs text-slate-700">{fmtMoney(a.arr, a.currency)} · {a.contractStatus}</div>
              <div className="mt-1"><DaysChip days={daysUntil(a.renewalDate)} /></div>
              <select value={renewalStageOf(a)} onClick={e => e.stopPropagation()}
                onChange={e => dispatch({ type: "EDIT_ACCOUNT", id: a.id, patch: { renewalStage: e.target.value }, by: user?.name, source: "inline" })}
                className={`mt-1.5 w-full cursor-pointer rounded border-0 px-1.5 py-0.5 text-xs font-semibold outline-none ${RENEWAL_STAGE_STYLE[renewalStageOf(a)]}`}>
                {RENEWAL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {(() => {
                const pt = tasks.filter(t => t.accountId === a.id && t.playbook && t.renewalFor === a.renewalDate);
                if (!pt.length) return null;
                const done = pt.filter(t => t.status === "Done").length;
                const behind = pt.some(t => t.status !== "Done" && t.due < iso(Date.now())); // textual ISO compare
                return <span title={behind ? "Playbook behind pace — an open step is past due" : "Playbook on pace"}
                  data-playbook-progress className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${behind ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>Playbook {done}/{pt.length}</span>;
              })()}
            </div>
          ))}
        </div>
      ))}
      </HScroll>
      <RenewalOutcomes accounts={allBook} rates={rates} snapshots={snapshots} />
    </div>
  );
}

