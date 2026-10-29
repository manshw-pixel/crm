// Whole class strings so the Tailwind scanner sees them; themed for dark mode. 700 shades: the 600s were
// under 4.5:1 on a white card (emerald 3.77, amber 3.19).
const RISK_TEXT = { Green: "text-emerald-700", Yellow: "text-amber-700", Red: "text-rose-700" };
// Status in words, so no row or bar relies on colour alone (same words as the health pills).
const RISK_WORD = { Green: "Healthy", Yellow: "Watch", Red: "At risk" };

// Tiny NRR trend: stored snapshot values only, null points skipped, scaled to their own min/max.
function KpiSpark({ points, label }) {
  const v = points.map((p, i) => [i, p]).filter(([, p]) => p !== null && p !== undefined);
  if (v.length < 2) return null;
  const lo = Math.min(...v.map(x => x[1])), hi = Math.max(...v.map(x => x[1])), span = hi - lo || 1;
  const xs = v.map(([i, p]) => [i * (200 / (points.length - 1)), 34 - ((p - lo) / span) * 28]);
  const line = "M" + xs.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
  return (
    <svg data-kpi-trend role="img" aria-label={`${label} trend, last ${points.length} months`} viewBox="0 0 200 40" preserveAspectRatio="none" className="mt-1 h-10 w-full text-emerald-600">
      <path d={line + ` L${xs[xs.length - 1][0].toFixed(1)} 40 L${xs[0][0].toFixed(1)} 40 Z`} fill="currentColor" fillOpacity="0.15" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Dashboard({ st, scored, all, allAccounts, scope, setScopeSel, myCount, renewalsDue, user, dispatch, openAccount, openAccounts, goFinance, goTasks, openProject, goRenewals }) {
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
  const ren90 = scored.filter(a => { const d = daysUntil(a.renewalDate); return d >= 0 && d <= 90; });
  const ren90ARR = ren90.reduce((s, a) => s + a.arrUSD, 0);
  const ren30 = ren90.filter(a => daysUntil(a.renewalDate) <= 30).length;
  const openMine = st.tasks.filter(t => t.status !== "Done" && (scope !== "mine" || t.owner === user.name));
  const overdueTasks = openMine.filter(t => daysUntil(t.due) < 0);
  const due7 = openMine.filter(t => { const d = daysUntil(t.due); return d >= 0 && d <= 7; });
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
  const nrrSub = `existing customers: +${fmtMoney(bridge.expansion)} exp · −${fmtMoney(bridge.contraction)} contr`;
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
    if (!isNaN(daysUntil(t.due)) && (!byOwner[o].next || t.due < byOwner[o].next)) byOwner[o].next = t.due; // an unparseable due never becomes "next"
  });
  const owners = Object.entries(byOwner).sort((x, y) => y[1].overdue - x[1].overdue || y[1].open - x[1].open);
  const teamDue7 = st.tasks.filter(t => t.status !== "Done" && daysUntil(t.due) >= 0 && daysUntil(t.due) <= 7).length;
  // open implementation projects for the panel: progress = share of the project's tasks done (as the board card shows)
  const implOpen = (st.projects || []).filter(p => p.stage !== "live" && p.stage !== "cancelled")
    .map(p => {
      const name = ((st.accounts || []).find(a => a.id === p.accountId) || {}).name || "Unknown account";
      const tasks = (st.projectTasks || []).filter(t => t.projectId === p.id);
      const pct = tasks.length ? 100 * tasks.filter(t => t.status === "done").length / tasks.length : Math.min(100, 100 * Math.max(0, STAGES.indexOf(p.stage)) / 5);
      return { p, name, pct };
    })
    .sort((x, y) => String(x.p.targetGoLive || "9999").localeCompare(String(y.p.targetGoLive || "9999")) || x.name.localeCompare(y.name))
    .slice(0, 5);
  const qbrAccts = scored.map(a => ({ a, s: qbrStatus(a) })).filter(x => x.s && (x.s.kind === "due" || x.s.kind === "overdue"));
  const qbrOverdue = qbrAccts.filter(x => x.s.kind === "overdue").length;
  return (
    <div data-dash className="space-y-3">
      {scored.length === 0 && <div className="nm-sm p-4 text-sm text-indigo-500">
        {user.role === "lead" ? "No accounts are assigned to you yet."
          : scope === "mine" ? <>No accounts assigned to you yet — switch to <b>All</b> (top right) or assign yourself as CSM on an account.</>
          : <>Fresh start — no accounts yet. Head to <b>Accounts</b> (press <kbd className="rounded border border-indigo-300 px-1">4</kbd>) and click <b>+ New account</b>, import a JSON backup, or load sample data from Settings.</>}
      </div>}
      {/* Headline: four cards that each lead somewhere. */}
      <section aria-label="Headline numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat kpi size="hero" icon="!" iconTone="bg-rose-100 text-rose-600" label="ARR at risk" statKey="ARR at risk (USD)" value={fmtMoney(arrAtRisk)} tone="text-rose-700"
          sub={`${atRisk.length} accounts in red health`} onClick={() => openAccounts({ risk: "Red" })} />
        <Stat kpi size="hero" icon="R" iconTone="bg-orange-100 text-orange-600" label="Renewals · 90 days" value={ren90.length}
          sub={`${fmtMoney(ren90ARR)} ARR · ${ren30} within 30 days`} onClick={() => goRenewals()} />
        <Stat kpi size="hero" icon="%" iconTone="bg-emerald-100 text-emerald-600" label="Net revenue retention" statKey="NRR (12m)" value={nrr === null ? "—" : pct(nrr)}
          tone={nrr !== null && nrr < 1 ? "text-amber-700" : "text-emerald-700"} sub={<><div>{`Gross retention ${grr === null ? "—" : pct(grr)}`}</div>
            <div data-nrr-sub className="truncate" title={nrrSub}>{nrrSub}</div></>} onClick={() => openAccounts()}
          trend={snaps.length >= 2 ? <KpiSpark label="NRR" points={snaps.map(s => s.nrr)} /> : null} />
        <Stat kpi size="hero" icon="✓" iconTone="bg-indigo-100 text-indigo-600" label="Overdue tasks" value={overdueTasks.length}
          sub={`${due7.length} due in the next 7 days`} onClick={() => goTasks({ overdue: true, ...(scope === "mine" ? { owner: user.name } : {}) })} />
      </section>
      {snaps.length < 2 && <p data-trends-note className="-mt-1 text-xs text-slate-500">Trend lines appear once a second monthly snapshot exists (one is taken each month).</p>}
      {/* Health strip: where the book stands. */}
      <section aria-label="Team health" className="flex flex-wrap gap-2.5">
        {[
          ["Total ARR", "Total ARR (USD)", fmtMoney(totalARR), "bg-indigo-500", () => openAccounts(), undefined],
          ["Healthy", "Healthy", counts.Green, "bg-emerald-500", () => openAccounts({ risk: "Green" }), undefined],
          ["Watch", "Watch", counts.Yellow, "bg-amber-500", () => openAccounts({ risk: "Yellow" }), undefined],
          ["At risk", "At risk", counts.Red, "bg-red-500", () => openAccounts({ risk: "Red" }), undefined],
          ["QBRs due (30d)", "QBRs due (30d)", qbrAccts.length, "bg-sky-500", () => openAccounts({ qbrDue: true }), qbrOverdue ? `${qbrOverdue} overdue` : undefined],
          ["Billing completed", "Billing completed", `${scored.filter(a => a.billingCompleted).length} / ${scored.length}`, "bg-slate-400", () => openAccounts({ billing: "Completed" }), undefined],
        ].map(([label, key, value, dot, go, title]) => (
          <button key={key} type="button" data-health-pill={key} data-stat={key} title={title} onClick={go} className="dash-pill">
            <span aria-hidden="true" className={`dash-dot ${dot}`} />
            <span className="text-slate-500">{label}</span>
            <b data-stat-value data-size="pill" className="tabular-nums text-slate-900">{value}</b>
          </button>
        ))}
      </section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Renewals in the next 90 days" className="!p-3 lg:col-span-2"
          right={<span className="flex items-center gap-3"><span className="text-[13px] text-slate-500">{ren90.length} accounts · {fmtMoney(ren90ARR)} ARR</span>
            <button data-view-all="renewals" onClick={() => goRenewals()} className="text-[13px] font-semibold text-indigo-600 hover:underline">View all</button></span>}>
          <ScrollList label="Renewals in the next 90 days" className="max-h-80">
            {ren90.length === 0 && <div className="text-sm text-slate-500">No renewals in the next 90 days.</div>}
            {[...ren90].sort((x, y) => daysUntil(x.renewalDate) - daysUntil(y.renewalDate)).map(a => (
              <button key={a.id} data-row data-renewal-row={a.id} onClick={() => openAccount(a.id)}
                className="flex w-full items-center gap-3.5 border-t border-slate-100 px-1 py-2.5 text-start first:border-0 hover:bg-slate-50">
                <span aria-hidden="true" className="dash-av"><span>{initialsOf(a.name)}</span></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-900" title={a.name}>{a.name}</span>
                  <span className="block truncate text-[12.5px] text-slate-500" title={`${a.tier || "—"} · CSM ${a.csm || "—"}`}>{a.tier || "—"} · CSM {a.csm || "—"}</span></span>
                <span className="w-[70px] shrink-0 truncate whitespace-nowrap text-end text-sm font-semibold tabular-nums text-slate-900" title={fmtMoney(a.arrUSD)}>{fmtMoney(a.arrUSD)}</span>
                <span className="min-w-0 shrink-0" title={`Health ${a.score} · ${RISK_WORD[riskOf(a.score)]}`}><Chip risk={riskOf(a.score)}><span data-health-word className="max-w-[110px] truncate whitespace-nowrap">{a.score} · {RISK_WORD[riskOf(a.score)]}</span></Chip></span>
                <span className="hidden w-[110px] shrink-0 whitespace-nowrap text-end text-[13px] text-slate-600 sm:inline">{fmtDate(a.renewalDate)}</span>
                <span className="shrink-0"><DaysChip days={daysUntil(a.renewalDate)} /></span>
              </button>
            ))}
          </ScrollList>
        </Card>
        <Card title="Needs attention" className="!p-3"
          right={<button data-view-all="attention" onClick={() => openAccounts()} className="text-[13px] font-semibold text-indigo-600 hover:underline">View all {flagged.length}</button>}>
          <ScrollList label="Needs attention" className="max-h-80">
            {flagged.length === 0 && <div className="text-sm text-slate-500">No accounts need attention.</div>}
            {[...flagged].sort((x, y) => (y.risk === "Red") - (x.risk === "Red") || x.score - y.score).map(a => (
              <button key={a.id} data-row data-attention-row={a.id} onClick={() => openAccount(a.id)} className="flex w-full gap-3 border-t border-slate-100 py-3 text-start first:border-0 hover:bg-slate-50">
                <span aria-hidden="true" data-sev-bar className={`w-1 shrink-0 rounded ${a.risk === "Red" ? "bg-rose-600" : "bg-amber-500"}`} />
                <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900" title={a.name}>{a.name}</span>
                  <span className="block truncate text-[12.5px] text-slate-500" title={`${RISK_WORD[a.risk]} · ${a.flags.join(" · ")}`}><span data-sev={a.risk} className={`font-semibold ${a.risk === "Red" ? "text-rose-700" : "text-amber-700"}`}>{RISK_WORD[a.risk]}</span> · {a.flags.join(" · ")}</span></span>
              </button>
            ))}
          </ScrollList>
        </Card>
        <Card title={<>{scope === "mine" ? "My tasks this week" : "Tasks this week"}{overdueTasks.length > 0 && <span className="ms-2.5 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">{overdueTasks.length} overdue</span>}</>}
          className={`!p-3 ${implOpen.length ? "lg:col-span-2" : "lg:col-span-3"}`} id="week-tasks"
          right={<button data-view-all="tasks" onClick={() => goTasks(scope === "mine" ? { owner: user.name } : {})} className="text-[13px] font-semibold text-indigo-600 hover:underline">Open Tasks</button>}>
          <ScrollList label="Tasks this week" className="max-h-72">
            {weekTasks.length === 0 && <div className="text-sm text-slate-500">Nothing due.</div>}
            <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
            {[...weekTasks].sort((x, y) => x.due.localeCompare(y.due)).map(t => {
              const a = scored.find(x => x.id === t.accountId), d = daysUntil(t.due);
              return (
                <div key={t.id} data-row data-week-task={t.id} className="flex items-center gap-3 border-t border-slate-100 px-1 py-2.5 text-sm">
                  <label className="dash-check"><input type="checkbox" aria-label={`Complete ${t.title}`} className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-indigo-600" checked={t.status === "Done"} onChange={() => dispatch({ type: "TOGGLE_TASK", id: t.id })} /></label>
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900" title={t.title}>{t.title}</span>
                  <button className="min-w-0 max-w-[40%] truncate text-[12.5px] font-semibold text-indigo-600 hover:underline" title={a?.name} onClick={() => openAccount(t.accountId)}>{a?.name}</button>
                  <span className={`w-[88px] shrink-0 whitespace-nowrap text-end text-[12.5px] tabular-nums ${d < 0 ? "font-semibold text-rose-700" : d === 0 ? "text-orange-700" : "text-slate-600"}`}>{d < 0 ? "Overdue" : d === 0 ? "Today" : fmtDate(t.due)}</span>
                </div>
              );
            })}
            </div>
          </ScrollList>
        </Card>
        {implOpen.length > 0 && <Card title="Implementation" className="!p-3">
          {implOpen.map(({ p, name, pct }) => (
            <button key={p.id} data-impl-row={p.id} onClick={() => openProject(p.id)} className="block w-full rounded px-1 py-1.5 text-start hover:bg-slate-50">
              <span className="flex text-[13.5px]"><b className="min-w-0 truncate font-semibold text-slate-900" title={name}>{name}</b><span className="ms-auto shrink-0 whitespace-nowrap ps-2 text-slate-500">{STAGE_LABEL[p.stage] || p.stage}</span></span>
              <span role="progressbar" aria-label={`${name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="dash-bar mt-1.5 block h-2 rounded-full bg-indigo-50"><span className="block h-2 rounded-full bg-indigo-500" style={{ width: pct + "%" }} /></span>
            </button>
          ))}
        </Card>}
      </div>
      <div data-dash-more className="mt-1.5 flex items-center gap-3"><h2 className="text-[13px] font-bold uppercase tracking-[.06em] text-slate-500">More detail</h2><span aria-hidden="true" className="h-px flex-1 bg-slate-200" /></div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:[&>*:last-child:nth-child(2)]:col-span-2">
        <Card title={<>Team tasks<span className="ms-2.5 text-[12.5px] font-normal text-slate-500">{teamDue7} due in 7 days</span></>} className="!p-3">
          <ScrollList label="Team tasks" className="max-h-60">
            {owners.length === 0 && <div className="text-sm text-slate-500">No open tasks.</div>}
            {owners.map(([name, o]) => (
              <button key={name} data-row data-team-row={name} onClick={() => goTasks({ owner: name })}
                className="flex w-full items-center gap-2.5 border-t border-slate-100 px-1 py-2.5 text-start first:border-0 hover:bg-slate-50">
                <span aria-hidden="true" className="dash-av !h-[30px] !w-[30px] !rounded-full !text-[11.5px]"><span>{initialsOf(name)}</span></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-semibold text-slate-900" title={name === user.name ? name + " (you)" : name}>{name}{name === user.name && " (you)"}</span>
                  <span className="block truncate text-xs text-slate-500" title={`${o.open} open · next ${o.next ? fmtDate(o.next) : "—"}`}>{o.open} open · next {o.next ? fmtDate(o.next) : "—"}</span></span>
                {o.overdue > 0
                  ? <span className="shrink-0 whitespace-nowrap rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700">{o.overdue} overdue</span>
                  : <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-emerald-700">on track</span>}
              </button>
            ))}
          </ScrollList>
        </Card>
        <Card title="Expansion pipeline" className="!p-3" right={<span className="min-w-0 truncate text-[13px] font-semibold tabular-nums text-indigo-600" title={`${fmtMoney(pipeWeighted)} weighted`}>{fmtMoney(pipeWeighted)} weighted</span>}>
          <div className="mb-1 truncate text-[26px] font-extrabold tabular-nums text-slate-900" title={fmtMoney(pipeTotal)}>{fmtMoney(pipeTotal)}</div>
          <ScrollList label="Expansion pipeline">
            {openOpps.length === 0 && <div className="text-sm text-slate-500">No open opportunities — add them from an account page.</div>}
            {openOpps.map(o => (
              <button key={o.id} data-row onClick={() => openAccount(o.accountId)} className="flex w-full items-center gap-2.5 border-t border-slate-100 px-1 py-2 text-start text-[13.5px] first:border-0 hover:bg-slate-50">
                <span className="min-w-0 flex-1 truncate" title={`${o.acct.name} · ${o.type}`}><b className="font-semibold text-slate-900">{o.acct.name}</b> <span className="text-slate-500">· {o.type}</span></span>
                <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${o.stage === "Stalled" ? "bg-amber-100 text-amber-700" : "bg-indigo-50 text-indigo-700"}`}>{o.stage}</span>
                <b className="min-w-0 max-w-[40%] shrink-0 truncate whitespace-nowrap tabular-nums text-slate-900" title={fmtMoney(o.valueUSD)}>{fmtMoney(o.valueUSD)}</b>
              </button>
            ))}
          </ScrollList>
        </Card>
        <FinanceCard goFinance={goFinance} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ArrBridgeCard b={bridge} grr={grr} churnedARR={churnedARR} lost={lost} pct={pct} onAccounts={() => openAccounts()}
          onChurned={retAccounts.some(a => a.churn) ? () => openAccounts({ showChurned: true, onlyChurned: true }) : undefined} />
        <div data-license-card><LicenseCard accounts={scored} openAccount={openAccount} /></div>
      </div>
      <ImplProjectsCard projects={st.projects || []} accounts={st.accounts || []} />
      <AnalyticsSection user={user}>
      {snaps.length >= 2 && <Card title="Trends (monthly)" className="!p-3">
        <div className="space-y-2">
          <TrendLine label="Total ARR (USD)" points={snaps.map(s => s.totalARR)} months={snaps.map(s => s.month)} fmt={fmtMoney} />
          <TrendLine label="NRR" points={snaps.map(s => s.nrr)} months={snaps.map(s => s.month)} fmt={x => x === null ? "—" : (100 * x).toFixed(0) + "%"} />
          <TrendLine label="GRR" points={snaps.map(s => s.grr)} months={snaps.map(s => s.month)} fmt={x => x === null ? "—" : (100 * x).toFixed(0) + "%"} />
        </div>
      </Card>}
      <AmBookCard book={amBook} openAccount={openAccount} />
      <Card title="Recently declined" className="!p-3">
        <ScrollList label="Recently declined">
        {declines.length === 0 && <div className="text-sm text-slate-500">No recent declines. 🎉</div>}
        {declines.map(({ a, e }) => (
          <button key={a.id + e.date + e.to} data-row onClick={() => openAccount(a.id)} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-slate-50">
            <span className="text-sm">{a.name}</span>
            <span className="flex items-center gap-2 text-xs">
              <span className={`font-semibold ${RISK_TEXT[e.from]}`}>{e.from}</span>
              <span className="text-slate-400">→</span>
              <span className={`font-semibold ${RISK_TEXT[e.to]}`}>{e.to}</span>
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


/* Total vs deployed licenses over the in-scope active accounts. Totals and % use only
   accounts with both figures (see licenseSummary); accounts missing a deployed count are
   named separately so missing data is not mistaken for low deployment. */
function LicenseCard({ accounts, openAccount }) {
  const s = licenseSummary(accounts);
  const n = x => x.toLocaleString("en-IN");
  return (
    <Card title="License deployment" className="!p-3" right={s.pct != null ? <span className="text-[13px] tabular-nums text-slate-500">{n(s.total)} total · {n(s.deployed)} deployed</span> : undefined}>
      {s.counted === 0
        ? <div className="text-sm text-slate-500">No accounts have licenses yet. Add Total licenses on an account's Edit form.</div>
        : <div className="space-y-2">
            {s.pct == null
              ? <div className="text-sm text-slate-500">No deployed counts recorded yet.</div>
              : <>
                  <div className="flex items-baseline gap-2.5"><span className="text-[26px] font-extrabold tabular-nums text-slate-900">{s.pct}%</span><span className="text-[12.5px] text-slate-500">deployed across the book</span></div>
                  <div data-license-summary className="text-xs tabular-nums text-slate-500">{n(s.total)} total · {n(s.deployed)} deployed · {s.pct}%</div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div data-license-bar className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, s.pct)}%` }} />
                  </div>
                </>}
            {s.missingDeployed > 0 && <div data-license-missing className="text-xs text-slate-500">
              {s.missingDeployed === 1 ? "1 account has no deployed count yet." : `${s.missingDeployed} accounts have no deployed count yet.`}</div>}
            {s.lowest.length > 0 && <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lowest deployment</div>
              {s.lowest.map(x => (
                <button key={x.id} data-license-row={x.id} onClick={() => openAccount(x.id)}
                  className="flex w-full items-center gap-2 border-b border-slate-100 py-1 text-left text-sm last:border-0 hover:bg-slate-50">
                  <span className="min-w-0 flex-1 truncate" title={x.name}>{x.name}</span>
                  <span className="tabular-nums text-slate-500">{n(x.deployed)} / {n(x.total)}</span>
                  <span data-low={x.pct < 50 ? "" : undefined} className={`w-12 text-right tabular-nums font-semibold ${x.pct < 50 ? "text-amber-700" : ""}`}>{x.pct}%</span>
                </button>))}
            </div>}
          </div>}
    </Card>
  );
}


/* ARR bridge (12m): how today's ARR was built from a year ago. New customers are shown as
   new business here -- they are deliberately NOT in NRR/GRR, which measure existing
   customers only. Rows carry data-bridge-* so tests target them, not page copy. */
function ArrBridgeCard({ b, grr, churnedARR, lost, pct, onAccounts, onChurned }) {
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
    <Card title="ARR bridge · 12 months" className="!p-3" right={<span className="text-xs text-slate-500">USD</span>}>
      <div data-bridge-head className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-slate-500">
        <button type="button" data-stat="GRR (12m)" onClick={onAccounts} className="hover:underline">GRR <b data-stat-value className="tabular-nums text-slate-900">{grr === null ? "—" : pct(grr)}</b></button>
        <button type="button" data-stat="Churned ARR (12m)" onClick={onChurned} disabled={!onChurned} className="enabled:hover:underline">Churned ARR <b data-stat-value className={`tabular-nums ${churnedARR ? "text-rose-700" : "text-slate-900"}`}>{fmtMoney(churnedARR)}</b></button>
        <span>{lost} account(s) lost</span>
      </div>
      <div data-arr-bridge className="space-y-1.5">
        {rows.map(([k, label, v, sub, kind]) => (
          <div key={k} data-bridge-row={k} title={sub} className={`grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-2 text-sm ${kind === "base" ? "font-semibold" : ""}`}>
            <span className="truncate text-slate-700">{label}</span>
            <span className="h-2 rounded bg-slate-100"><span className={`block h-2 rounded ${tone[kind]}`} style={{ width: `${Math.min(100, (Math.abs(v) / max) * 100)}%` }} /></span>
            <span data-bridge-value className="text-right tabular-nums text-slate-800">{kind === "up" && v > 0 ? "+" : ""}{fmtMoney(v)}</span>
          </div>
        ))}
        {b.newLogos > 0 && <p data-bridge-note className="pt-1 text-[11px] text-slate-500">{b.newLogos - b.newLost} new customer(s) signed in the last 12 months{b.newLost ? `; ${b.newLost} more signed and already lost` : ""}. Their revenue is new business, not retention.</p>}
        <p className="text-[11px] text-slate-500">NRR/GRR use existing customers only</p>
      </div>
    </Card>
  );
}


/* Implementation projects per period: stacked Active / Completed / On hold bars for one year
   (chartCounts in src/lib/implementation.js), plus a tier x status table for one period.
   st.projects is already RLS-scoped, so a restricted lead sees only their accounts' projects. */
var IMPL_STATUSES = [["active", "Active"], ["completed", "Completed"], ["onHold", "On hold"]];
function ImplProjectsCard({ projects, accounts }) {
  const today = iso(Date.now()); // UTC day; every "now" below derives from it
  const thisYear = +today.slice(0, 4), thisMonth = +today.slice(5, 7) - 1;
  const [year, setYear] = useState(thisYear);
  const [mode, setMode] = useState("month");
  const [tier, setTier] = useState("All");
  const [pick, setPick] = useState(null); // tier-table period index; null = the default
  const [hov, setHov] = useState(null);
  const tierById = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a.tier || "—"])), [accounts]);
  // chartCounts replays history to each period end, so a period still in the future would
  // repeat today's stages as if they were known: blank those periods instead.
  const data = useMemo(() => {
    const d = chartCounts(projects, year, mode, id => tierById[id], tier);
    const future = d.periods.map((_, i) => `${year}-${String(mode === "quarter" ? i * 3 + 1 : i + 1).padStart(2, "0")}-01` > today);
    const blank = s => { IMPL_STATUSES.forEach(([k]) => { s[k] = s[k].map((v, i) => future[i] ? 0 : v); }); };
    blank(d.series); Object.values(d.byTier).forEach(blank);
    return d;
  }, [projects, year, mode, tierById, tier, today]);
  const years = [...new Set([thisYear, ...projects.flatMap(p => (p.history || []).map(e => +String(e.at).slice(0, 4)).filter(Boolean))])].sort((a, b) => b - a);
  const tiers = [...new Set([...accounts.map(a => a.tier || "—"), ...Object.keys(data.byTier)])].sort();
  const { periods, series } = data;
  const totals = periods.map((_, i) => series.active[i] + series.completed[i] + series.onHold[i]);
  // default table period: the latest with any data (every tier), else the current period
  const any = i => Object.values(data.byTier).some(t => t.active[i] + t.completed[i] + t.onHold[i] > 0);
  let latest = -1; periods.forEach((_, i) => { if (any(i)) latest = i; });
  const nowIdx = year === thisYear ? (mode === "quarter" ? Math.floor(thisMonth / 3) : thisMonth) : periods.length - 1;
  const sel = pick !== null && pick < periods.length ? pick : latest >= 0 ? latest : nowIdx;
  const w = 520, h = 170, padL = 28, padR = 8, padT = 12, padB = 22;
  const max = Math.max(...totals, 1);
  const slot = (w - padL - padR) / periods.length;
  const bw = Math.min(28, slot * 0.6);
  const X = i => padL + (i + 0.5) * slot;
  const H = v => (v / max) * (h - padT - padB);
  const tipX = i => Math.min(Math.max(X(i) - 55, padL), w - padR - 110);
  const shownTiers = tiers.filter(t => data.byTier[t]);
  return (
    <Card title="Implementation projects" className="!p-3" right={
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg-toggle" role="group" aria-label="Period">
          {[["month", "Month"], ["quarter", "Quarter"]].map(([k, l]) => <button key={k} data-impl-mode={k} aria-pressed={mode === k} onClick={() => { setPick(null); setMode(k); }}>{l}</button>)}
        </div>
        <Select data-impl-year aria-label="Year" value={String(year)} onChange={e => { setPick(null); setYear(+e.target.value); }} options={years.map(String)} />
        <Select data-impl-tier-filter aria-label="Tier" value={tier} onChange={e => setTier(e.target.value)} options={["All", ...tiers]} labels={{ All: "All tiers" }} />
      </div>}>
      <div data-impl-chart>
        <div className="mb-1 flex flex-wrap items-center gap-3 text-xs text-slate-600">
          {IMPL_STATUSES.map(([k, l]) => <span key={k} className="flex items-center gap-1"><span className={`inline-block h-2 w-2 rounded-sm impl-key-${k}`} />{l}</span>)}
          <span className="text-slate-500">Active / On hold at period end · Completed = went live in the period</span>
        </div>
        {/* Chart and tier table side by side on wide screens, so a full-width card has no empty half. */}
        <div className="xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start xl:gap-6">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-2xl" role="img" aria-label={`Implementation projects by ${mode}, ${year}`} onMouseLeave={() => setHov(null)}>
          <text x={padL - 4} y={padT + 3} textAnchor="end" fontSize="9" style={{ fill: "rgb(var(--slate-500))" }}>{max}</text>
          <line x1={padL} x2={w - padR} y1={padT} y2={padT} style={{ stroke: "rgb(var(--slate-100))" }} />
          <line x1={padL} x2={w - padR} y1={h - padB} y2={h - padB} style={{ stroke: "rgb(var(--slate-200))" }} />
          {periods.map((p, i) => {
            let y = h - padB;
            const segs = IMPL_STATUSES.map(([k]) => {
              const v = series[k][i]; if (!v) return null;
              const bh = H(v); y -= bh;
              // 2px surface gap between stacked segments
              return <rect key={k} data-seg={k} className={`impl-seg-${k}`} x={X(i) - bw / 2} y={y + 1} width={bw} height={Math.max(bh - 2, 1)} rx="2"
                opacity={hov === null || hov === i ? 1 : 0.45} />;
            });
            return (
              <g key={p} data-impl-bar={p} data-active={series.active[i]} data-completed={series.completed[i]} data-on-hold={series.onHold[i]}
                onMouseEnter={() => setHov(i)} onClick={() => setPick(i)} style={{ cursor: "pointer" }}>
                <rect x={X(i) - slot / 2} y={padT} width={slot} height={h - padT - padB} fill="transparent" />
                {segs}
                <text data-impl-period-label x={X(i)} y={h - 8} textAnchor="middle" fontSize="9" fontWeight={i === sel ? 700 : 400} style={{ fill: "rgb(var(--slate-500))" }}>{p}</text>
              </g>
            );
          })}
          {hov !== null && <g pointerEvents="none">
            <rect x={tipX(hov)} y={padT} width="110" height="50" rx="4" style={{ fill: "rgb(var(--slate-900))" }} opacity="0.9" />
            <text x={tipX(hov) + 6} y={padT + 12} fontSize="9" fontWeight="700" style={{ fill: "rgb(var(--slate-100))" }}>{periods[hov]} {year} · {totals[hov]}</text>
            {IMPL_STATUSES.map(([k, l], si) => <text key={k} x={tipX(hov) + 6} y={padT + 24 + si * 11} fontSize="9" style={{ fill: "rgb(var(--slate-200))" }}>{l}: {series[k][hov]}</text>)}
          </g>}
        </svg>
        <div>
        <div className="mt-2 text-xs text-slate-500">By tier · <span data-impl-tier-period className="font-bold text-slate-700">{periods[sel]}</span> {year} (click a bar to change)</div>
        <table data-impl-tier-table className="mt-1 w-full max-w-2xl text-sm">
          <thead><tr className="border-b border-slate-200 text-left text-xs font-bold uppercase text-slate-500">
            <th className="py-1">Tier</th>{IMPL_STATUSES.map(([k, l]) => <th key={k} className="py-1 text-right">{l}</th>)}</tr></thead>
          <tbody>{shownTiers.length === 0
            ? <tr><td colSpan="4" className="py-1.5 text-slate-500">No implementation projects yet.</td></tr>
            : shownTiers.map(t => { const b = data.byTier[t];
              return <tr key={t} data-impl-tier-row={t} data-counts={IMPL_STATUSES.map(([k]) => b[k][sel]).join(",")} className="border-b border-slate-100 last:border-0">
                <td className="py-1 font-medium text-slate-700">{t}</td>
                {IMPL_STATUSES.map(([k]) => <td key={k} className="py-1 text-right tabular-nums text-slate-700">{b[k][sel]}</td>)}</tr>; })}</tbody>
        </table>
        </div>
        </div>
      </div>
    </Card>
  );
}
