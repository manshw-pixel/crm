function Dashboard({ st, scored, all, allAccounts, scope, setScopeSel, myCount, renewalsDue, user, dispatch, openAccount, openAccounts }) {
  const totalARR = scored.reduce((s, a) => s + a.arrUSD, 0);
  // `today` is in the deps so the card re-bases itself when the year turns, even in a
  // session that was left open over New Year -- without it the memo would hold last
  // year's cohorts and opening balances until something else forced a recompute.
  const today = iso(Date.now());
  const amBook = useMemo(() => amBookMovement(allAccounts, st.settings.rates, today), [allAccounts, st.settings.rates, today]);
  const atRisk = scored.filter(a => a.risk === "Red");
  const arrAtRisk = atRisk.reduce((s, a) => s + a.arrUSD, 0);
  const weekTasks = st.tasks.filter(t => t.status !== "Done" && daysUntil(t.due) <= 7 && (scope !== "mine" || t.owner === user.name));
  const buckets = [30, 60, 90].map(n => scored.filter(a => { const d = daysUntil(a.renewalDate); return d >= 0 && d <= n && (n === 30 || d > n - 30); }));
  const counts = { Green: 0, Yellow: 0, Red: 0 };
  scored.forEach(a => counts[a.risk]++);
  const flagged = scored.filter(a => a.flags.length);
  const declines = scored
    .flatMap(a => (a.healthEvents || [])
      .filter(e => BAND_RANK[e.to] > BAND_RANK[e.from] && daysSince(e.date) <= 30)
      .map(e => ({ a, e })))
    .sort((x, y) => daysSince(x.e.date) - daysSince(y.e.date));
  // when "All" is selected retention always spans every account, regardless of other scoping
  const rates = st.settings.rates;
  const retAccounts = scope === "all" ? allAccounts : all;
  const { churnedARR, grr, nrr, lost } = retentionStats(retAccounts, rates);
  const bridge = arrBridge(retAccounts, rates);
  const pct = x => (100 * x).toFixed(0) + "%";
  // expansion pipeline: open opportunities on non-churned in-scope accounts
  const openOpps = st.opportunities
    .map(o => ({ ...o, acct: scored.find(a => a.id === o.accountId) }))
    .filter(o => o.acct && !["Won", "Lost"].includes(o.stage))
    .map(o => ({ ...o, valueUSD: toUSD(o.value, o.acct.currency, rates) }))
    .sort((x, y) => y.valueUSD - x.valueUSD);
  const pipeTotal = openOpps.reduce((s, o) => s + o.valueUSD, 0);
  const pipeWeighted = openOpps.reduce((s, o) => s + o.valueUSD * (OPP_STAGE_WEIGHT[o.stage] ?? 0.2), 0);
  const snaps = st.settings.snapshots || [];
  const qSnaps = useMemo(() => quarterlySnaps(snaps), [snaps]);
  // per-person open-task rollup (whole team, regardless of scope)
  const byOwner = {};
  st.tasks.filter(t => t.status !== "Done").forEach(t => {
    const o = t.owner || "Unassigned";
    byOwner[o] = byOwner[o] || { open: 0, overdue: 0, next: null };
    byOwner[o].open++;
    if (daysUntil(t.due) < 0) byOwner[o].overdue++;
    if (!byOwner[o].next || t.due < byOwner[o].next) byOwner[o].next = t.due;
  });
  const owners = Object.entries(byOwner).sort((x, y) => y[1].overdue - x[1].overdue || y[1].open - x[1].open);
  const qbrAccts = scored.map(a => ({ a, s: qbrStatus(a) })).filter(x => x.s && (x.s.kind === "due" || x.s.kind === "overdue"));
  const qbrOverdue = qbrAccts.filter(x => x.s.kind === "overdue").length;
  return (
    <div className="space-y-3">
      {scored.length === 0 && <div className="nm-sm p-4 text-sm text-indigo-500">
        {scope === "mine" ? <>No accounts assigned to you yet — switch to <b>All</b> (top right) or assign yourself as CSM on an account.</>
          : <>Fresh start — no accounts yet. Head to <b>Accounts</b> (press <kbd className="rounded border border-indigo-300 px-1">2</kbd>) and click <b>+ New account</b>, import a JSON backup, or load sample data from Settings.</>}
      </div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat size="hero" label={`Total ARR (USD)${scope === "mine" ? " · my book" : ""}`} value={fmtMoney(totalARR)} sub={`${scored.length} active accounts`} onClick={() => openAccounts()} />
        <Stat size="hero" label="ARR at risk (USD)" value={fmtMoney(arrAtRisk)} tone="text-rose-600" sub={`${atRisk.length} red accounts`} onClick={() => openAccounts({ risk: "Red" })} />
        <Stat label="At-risk accounts" value={atRisk.length} tone="text-rose-600" sub="health score below 40" onClick={() => openAccounts({ risk: "Red" })} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat size="hero" label="GRR (12m)" value={grr === null ? "—" : pct(grr)} tone={grr !== null && grr < 0.9 ? "text-rose-600" : "text-emerald-600"} sub="gross revenue retention" onClick={() => openAccounts()} />
        <Stat size="hero" label="NRR (12m)" value={nrr === null ? "—" : pct(nrr)} tone={nrr !== null && nrr < 1 ? "text-amber-600" : "text-emerald-600"} sub={`existing customers: +${fmtMoney(bridge.expansion)} exp · −${fmtMoney(bridge.contraction)} contr`} onClick={() => openAccounts()} />
        <Stat size="hero" label="Churned ARR (12m)" value={fmtMoney(churnedARR)} tone={churnedARR ? "text-rose-600" : undefined} sub={`${lost} account(s) lost`}
          onClick={retAccounts.some(a => a.churn) ? () => openAccounts({ showChurned: true, onlyChurned: true }) : undefined} />
      </div>
      <ArrBridgeCard b={bridge} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat size="sm" label="QBRs due (30d)" value={qbrAccts.length}
          tone={qbrOverdue ? "text-rose-600" : qbrAccts.length ? "text-amber-600" : undefined}
          sub={qbrOverdue ? `${qbrOverdue} overdue` : "on schedule"} onClick={() => openAccounts({ qbrDue: true })} />
        <Stat size="sm" label="Billing completed" value={`${scored.filter(a => a.billingCompleted).length} / ${scored.length}`}
          tone={scored.some(a => !a.billingCompleted) ? "text-amber-600" : "text-emerald-600"}
          sub={`${scored.filter(a => !a.billingCompleted).length} pending this term`} onClick={() => openAccounts({ billing: "Completed" })} />
        <Stat size="sm" label="Tasks due 7d" value={weekTasks.length} tone={weekTasks.length ? "text-amber-600" : undefined} sub={`${weekTasks.some(t => daysUntil(t.due) < 0) ? `${weekTasks.filter(t => daysUntil(t.due) < 0).length} overdue · ` : ""}${scope === "mine" ? "owned by you" : "whole team"}`} onClick={() => document.getElementById("week-tasks")?.scrollIntoView({ behavior: "smooth" })} />
        <Card title="Health distribution" className="!p-3"><DistBar counts={counts} /></Card>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Card title="Renewals due" className="!p-3">
          <ScrollList label="Renewals due">
          {[["0–30 days", buckets[0]], ["31–60 days", buckets[1]], ["61–90 days", buckets[2]]].map(([label, list]) => (
            <div key={label} className="mb-2">
              <div className="text-xs font-semibold tabular-nums text-slate-500">{label} · {fmtMoney(list.reduce((s, a) => s + a.arrUSD, 0))} USD</div>
              {list.length === 0 && <div className="text-xs text-slate-500 italic">none</div>}
              {list.map(a => (
                <button key={a.id} data-row onClick={() => openAccount(a.id)} className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-slate-50">
                  <span>{a.name}</span>
                  <span className="flex items-center gap-2 text-xs tabular-nums text-slate-700">{fmtMoney(a.arrUSD)} <HealthChip score={a.score} /> <DaysChip days={daysUntil(a.renewalDate)} /></span>
                </button>
              ))}
            </div>
          ))}
          </ScrollList>
        </Card>
        <Card title="Alerts & flags" className="!p-3">
          <ScrollList label="Alerts & flags">
          {flagged.length === 0 && <div className="text-sm text-slate-500">No flags. 🎉</div>}
          {flagged.map(a => (
            <button key={a.id} data-row onClick={() => openAccount(a.id)} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-slate-50">
              <span className="text-sm">{a.name} <HealthChip score={a.score} /></span>
              <span className="flex flex-wrap justify-end gap-1">{a.flags.map(f => <span key={f} className="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-600 border border-rose-200">{f}</span>)}</span>
            </button>
          ))}
          </ScrollList>
        </Card>
      <Card title="Team tasks by owner" className="!p-3">
        <ScrollList label="Team tasks by owner" className="max-h-40">
        {owners.length === 0 && <div className="text-sm text-slate-500">No open tasks anywhere. 🎉</div>}
        {owners.map(([name, o]) => (
          <div key={name} data-row className="flex items-center gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0">
            <span className="w-24 shrink-0 font-bold text-slate-700 max-lg:truncate lg:w-40">{name}{name === user.name && <span className="font-normal text-slate-400"> (you)</span>}</span>
            <span className="tabular-nums text-slate-600">{o.open} open</span>
            {o.overdue > 0
              ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-600">{o.overdue} overdue</span>
              : <span className="text-xs text-emerald-600">on track</span>}
            <span className="ml-auto text-xs tabular-nums text-slate-500">next due {fmtDate(o.next)}</span>
          </div>
        ))}
        </ScrollList>
      </Card>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      <Card title={`Expansion pipeline · ${fmtMoney(pipeTotal)}`} className="!p-3" right={<span className="text-xs font-semibold tabular-nums text-indigo-600">{fmtMoney(pipeWeighted)} weighted</span>}>
        <ScrollList label="Expansion pipeline">
        {openOpps.length === 0 && <div className="text-sm text-slate-500">No open opportunities — add them from an account page.</div>}
        {openOpps.map(o => (
          <button key={o.id} data-row onClick={() => openAccount(o.accountId)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50">
            <span className="min-w-0 truncate">{o.acct.name} <span className="text-xs text-slate-500">· {o.type}</span></span>
            <span className="flex shrink-0 items-center gap-2 text-xs">
              <span className={`rounded px-1.5 py-0.5 font-semibold ${o.stage === "Stalled" ? "bg-amber-100 text-amber-700" : "bg-indigo-50 text-indigo-600"}`}>{o.stage}</span>
              <span className="font-bold tabular-nums text-slate-700">{fmtMoney(o.valueUSD)}</span>
            </span>
          </button>
        ))}
        </ScrollList>
      </Card>
      {snaps.length >= 2 && <Card title="Trends (monthly)" className="!p-3">
        <div className="space-y-2">
          <TrendLine label="Total ARR (USD)" points={snaps.map(s => s.totalARR)} months={snaps.map(s => s.month)} fmt={fmtMoney} />
          <TrendLine label="NRR" points={snaps.map(s => s.nrr)} months={snaps.map(s => s.month)} fmt={x => x === null ? "—" : (100 * x).toFixed(0) + "%"} />
          <TrendLine label="GRR" points={snaps.map(s => s.grr)} months={snaps.map(s => s.month)} fmt={x => x === null ? "—" : (100 * x).toFixed(0) + "%"} />
        </div>
      </Card>}
      <Card title={scope === "mine" ? "My tasks due this week" : "Tasks due this week"} className={`!p-3 ${snaps.length < 2 ? "lg:col-span-2" : ""}`} id="week-tasks">
        <ScrollList label="Tasks due this week" className="max-h-40">
        {weekTasks.length === 0 && <div className="text-sm text-slate-500">Nothing due.</div>}
        {weekTasks.sort((a, b) => a.due.localeCompare(b.due)).map(t => {
          const a = scored.find(x => x.id === t.accountId);
          return (
            <div key={t.id} data-row className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b sm:flex-nowrap border-slate-100 py-1.5 last:border-0 text-sm">
              <input type="checkbox" checked={t.status === "Done"} onChange={() => dispatch({ type: "TOGGLE_TASK", id: t.id })} />
              <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-2rem)]">{t.title}</span>
              <button className="text-indigo-600 hover:underline text-xs" onClick={() => openAccount(t.accountId)}>{a?.name}</button>
              <span className={`text-xs tabular-nums ${daysUntil(t.due) < 0 ? "text-rose-600 font-semibold" : "text-slate-700"}`}>{fmtDate(t.due)}</span>
              <span className="w-14 text-xs text-slate-500">{t.priority}</span>
            </div>
          );
        })}
        </ScrollList>
      </Card>
      </div>
      {snaps.length < 2 && <p data-trends-note className="-mt-1 text-xs text-slate-500">Trend lines appear once a second monthly snapshot exists (one is taken each month).</p>}
      <AnalyticsSection user={user}>
      <AmBookCard book={amBook} openAccount={openAccount} />
      <Card title="Recently declined" className="!p-3">
        <ScrollList label="Recently declined">
        {declines.length === 0 && <div className="text-sm text-slate-500">No recent declines. 🎉</div>}
        {declines.map(({ a, e }) => (
          <button key={a.id + e.date + e.to} data-row onClick={() => openAccount(a.id)} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-slate-50">
            <span className="text-sm">{a.name}</span>
            <span className="flex items-center gap-2 text-xs">
              <span className="font-semibold" style={{ color: RISK_HEX[e.from] }}>{e.from}</span>
              <span className="text-slate-400">→</span>
              <span className="font-semibold" style={{ color: RISK_HEX[e.to] }}>{e.to}</span>
              <span className="text-slate-500">{fmtDate(e.date)}</span>
            </span>
          </button>
        ))}
        </ScrollList>
      </Card>
      {snaps.length >= 2 && <Card title="Trends & health mix" className="!p-3">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {qSnaps.length < 2 && <div className="text-sm text-slate-500 md:col-span-2 xl:col-span-3">ARR, NRR and GRR are shown by quarter (average of the months in it) — the lines appear once a second quarter has snapshots.</div>}
          {qSnaps.length >= 2 && <>
          <LineChart title="Total ARR (USD) · quarterly avg" points={qSnaps.map(s => s.totalARR)} months={qSnaps.map(s => s.quarter)} fmt={fmtMoney} />
          <LineChart title="NRR · quarterly avg" points={qSnaps.map(s => s.nrr)} months={qSnaps.map(s => s.quarter)} fmt={x => x === null || x === undefined ? "—" : (100 * x).toFixed(0) + "%"} color="#10b981" />
          <LineChart title="GRR · quarterly avg" points={qSnaps.map(s => s.grr)} months={qSnaps.map(s => s.quarter)} fmt={x => x === null || x === undefined ? "—" : (100 * x).toFixed(0) + "%"} color="#f59e0b" />
          </>}
          <StackedBars months={snaps.map(s => s.month)} series={[
            { label: "Green", values: snaps.map(s => s.Green || 0), color: RISK_HEX.Green },
            { label: "Yellow", values: snaps.map(s => s.Yellow || 0), color: RISK_HEX.Yellow },
            { label: "Red", values: snaps.map(s => s.Red || 0), color: RISK_HEX.Red }]} />
        </div>
      </Card>}
      <CohortGrid accounts={scope === "all" ? allAccounts : all} />
      <ChurnAnalysis accounts={scope === "all" ? allAccounts : all} rates={rates} />
      </AnalyticsSection>
    </div>
  );
}


/* ARR bridge (12m): how today's ARR was built from a year ago. New customers are shown as
   new business here -- they are deliberately NOT in NRR/GRR, which measure existing
   customers only. Rows carry data-bridge-* so tests target them, not page copy. */
function ArrBridgeCard({ b }) {
  const rows = [
    ["opening", "ARR 12 months ago", b.opening, "existing customers", "base"],
    ["new", "+ New customers", b.newARR, `${b.newLogos - b.newLost} signed in the last 12m${b.newLost ? ` (${b.newLost} more signed and already lost)` : ""}`, "up"],
    ["expansion", "+ Expansion", b.expansion, "upsells, existing customers", "up"],
    ["contraction", "− Contraction", -b.contraction, "downgrades, existing customers", "down"],
    ["churn", "− Churn", -b.churn, "existing customers lost", "down"],
    ["closing", "= ARR today", b.closing, "", "base"],
  ];
  const max = Math.max(b.opening, b.closing, 1);
  const tone = { base: "bg-indigo-400", up: "bg-emerald-500", down: "bg-rose-500" };
  return (
    <Card title="ARR bridge (12m, USD)" className="!p-3" right={<span className="text-[11px] text-slate-500">NRR/GRR use existing customers only</span>}>
      <div data-arr-bridge className="space-y-1.5">
        {rows.map(([k, label, v, sub, kind]) => (
          <div key={k} data-bridge-row={k} title={sub} className={`grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-2 text-sm ${kind === "base" ? "font-semibold" : ""}`}>
            <span className="truncate text-slate-700">{label}</span>
            <span className="h-2 rounded bg-slate-100"><span className={`block h-2 rounded ${tone[kind]}`} style={{ width: `${Math.min(100, (Math.abs(v) / max) * 100)}%` }} /></span>
            <span data-bridge-value className="text-right tabular-nums text-slate-800">{kind === "up" && v > 0 ? "+" : ""}{fmtMoney(v)}</span>
          </div>
        ))}
        {b.newLogos > 0 && <p data-bridge-note className="pt-1 text-[11px] text-slate-500">{b.newLogos - b.newLost} new customer(s) signed in the last 12 months{b.newLost ? `; ${b.newLost} more signed and already lost` : ""}. Their revenue is new business, not retention.</p>}
      </div>
    </Card>
  );
}
