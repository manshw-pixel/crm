/* ------------------------------- Renewals ------------------------------- */
const RENEWAL_STAGES = ["Not started", "Outreach", "Quote sent", "Negotiating", "Committed", "At risk"];
const renewalStageOf = a => a.renewalStage || "Not started";
const RENEWALS_VIEW_KEY = "onevio.renewals.view";
const readRenewalsView = () => { try { const v = localStorage.getItem(RENEWALS_VIEW_KEY); return v === "table" ? "table" : "board"; } catch (e) { return "board"; } };
const RN_VIEWS = [["board", "Board"], ["table", "Table"]];
const RN_HEALTH = { Green: ["green", "Healthy"], Yellow: ["amber", "Watch"], Red: ["red", "At risk"] };

// Days pill: keeps DaysChip's data-days-chip band + text; red <= 30 (and overdue), amber <= 60, grey beyond.
const RenewalDays = ({ days }) => {
  const band = days < 0 ? "overdue" : days <= 30 ? "urgent" : days <= 60 ? "soon" : "later";
  const sev = days <= 30 ? "red" : days <= 60 ? "amber" : "grey";
  return <span data-days-chip={band} data-sev={sev} className="ad-pill ad-pill-sm rn-pill">{days < 0 ? `${-days}d overdue` : `${days}d`}</span>;
};
const RenewalHealth = ({ a }) => {
  const [sev, word] = RN_HEALTH[a.risk] || RN_HEALTH.Red;
  return <span data-renewal-health data-sev={sev} className="ad-pill ad-pill-sm rn-pill">{a.score} · {word}</span>;
};
const PlaybookPill = ({ a, tasks }) => {
  const pt = tasks.filter(t => t.accountId === a.id && t.playbook && t.renewalFor === a.renewalDate);
  if (!pt.length) return <span data-playbook-progress data-sev="none" className="rn-pb">No playbook yet</span>;
  const done = pt.filter(t => t.status === "Done").length;
  const behind = pt.some(t => t.status !== "Done" && t.due < iso(Date.now())); // textual ISO compare
  return <span title={behind ? "Playbook behind pace — an open step is past due" : "Playbook on pace"} data-playbook-progress
    data-sev={behind ? "amber" : "green"} className="ad-pill ad-pill-sm rn-pill rn-pb">Playbook {done}/{pt.length} · {behind ? "behind" : "on pace"}</span>;
};
const StageSelect = ({ a, dispatch, user }) => (
  <select value={renewalStageOf(a)} aria-label={`Renewal stage for ${a.name}`} data-stage={renewalStageOf(a)} onClick={e => e.stopPropagation()}
    onChange={e => dispatch({ type: "EDIT_ACCOUNT", id: a.id, patch: { renewalStage: e.target.value }, by: user?.name, source: "inline" })}
    className="rn-stage">
    {RENEWAL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
  </select>
);

function RenewalCard({ a, openAccount, dispatch, user, tasks }) {
  return (
    <div data-renewal-card={a.id} onClick={() => openAccount(a.id)} className="rn-card">
      <button type="button" className="rn-name-btn" onClick={e => { e.stopPropagation(); openAccount(a.id); }}>
        <span aria-hidden="true" data-avatar className="acct-av rn-av" data-av={avatarSlot(a.id)}>{initialsOf(a.name)}</span>
        <b data-renewal-name title={a.name} className="rn-name">{a.name}</b>
      </button>
      <span className="rn-pills"><RenewalHealth a={a} /><RenewalDays days={daysUntil(a.renewalDate)} /></span>
      <span data-renewal-arr className="rn-arr"><b>{fmtMoney(a.arr, a.currency)}</b> · {a.contractStatus}</span>
      <StageSelect a={a} dispatch={dispatch} user={user} />
      <PlaybookPill a={a} tasks={tasks} />
    </div>
  );
}

function RenewalsTable({ items, openAccount, dispatch, user, tasks, filtered }) {
  return (
    <section aria-label="Renewals table" className="rn-tcard">
      <table data-renewals-table className="rn-table">
        <thead><tr><th>Account</th><th className="rn-num">ARR</th><th>Health</th><th>Renewal</th><th>Stage</th><th>Playbook</th><th>CSM</th></tr></thead>
        <tbody>
          {items.length === 0 && <tr><td colSpan={7} className="rn-tempty">{filtered ? "No renewals in this window" : "No renewals in the next 12 months"}</td></tr>}
          {items.map(a => (
            <tr key={a.id} data-renewal-row={a.id}>
              <td><button type="button" className="rn-name-btn rn-wrap" onClick={() => openAccount(a.id)}>
                <span aria-hidden="true" data-avatar className="acct-av" data-av={avatarSlot(a.id)}>{initialsOf(a.name)}</span><b className="rn-tname">{a.name}</b></button></td>
              <td className="rn-num rn-strong">{fmtMoney(a.arr, a.currency)}</td>
              <td><RenewalHealth a={a} /></td>
              <td className="rn-date">{fmtDate(a.renewalDate)} <RenewalDays days={daysUntil(a.renewalDate)} /></td>
              <td><StageSelect a={a} dispatch={dispatch} user={user} /></td>
              <td><PlaybookPill a={a} tasks={tasks} /></td>
              <td className="rn-csm">{a.csm || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Renewals({ scored, openAccount, dispatch, allBook = [], rates = {}, snapshots = [], tasks = [], user }) {
  const [view, setViewRaw] = useState(readRenewalsView);
  const setView = v => { setViewRaw(v); try { localStorage.setItem(RENEWALS_VIEW_KEY, v); } catch (e) {} };
  const [win, setWin] = useState(null); // page-local window filter, not persisted
  // Local calendar day (follow-up 7): month lanes are local, so windows + Past due use the same day.
  const today = localDateKey(new Date());
  const inWin = a => !win || renewalWindowOf(a.renewalDate, today) === win;
  const byDate = (a, b) => (a.renewalDate || "").localeCompare(b.renewalDate || "") || a.name.localeCompare(b.name);
  const months = [];
  const now = new Date(); now.setDate(1);
  const firstKey = today.slice(0, 7);
  for (let i = 0; i < 12; i++) {
    const m = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`; // local, not toISOString — UTC shifts the month
    months.push({ key, label: m.toLocaleDateString("en-US", { month: "short", year: "numeric" }), all: scored.filter(a => (a.renewalDate || "").slice(0, 7) === key).sort(byDate) });
  }
  // Owner addition 2026-11-02: renewals dated before the current month (same population) get a leading Past due lane.
  const pastAll = scored.filter(a => /^\d{4}-\d{2}-\d{2}/.test(a.renewalDate || "") && a.renewalDate.slice(0, 7) < firstKey).sort(byDate);
  const horizon = months.flatMap(m => m.all);
  // 90-day forecast by renewal stage (USD) — maths unchanged, never filtered by the window
  const due90 = scored.filter(a => { const d = daysUntil(a.renewalDate); return d >= 0 && d <= 90; });
  const sum = list => list.reduce((s, a) => s + a.arrUSD, 0);
  const commit = sum(due90.filter(a => renewalStageOf(a) === "Committed"));
  const atRisk = sum(due90.filter(a => renewalStageOf(a) === "At risk"));
  const best = sum(due90) - atRisk;
  const notStarted = due90.filter(a => renewalStageOf(a) === "Not started");
  const windows = renewalWindows(scored, today);
  const winLabel = win && (RENEWAL_WINDOWS.find(w => w.key === win) || {}).label;
  const tableItems = [...pastAll, ...horizon].filter(inWin).sort(byDate);
  const forecast = [
    { k: "due", label: "Due next 90d", value: fmtMoney(sum(due90)), sub: `${due90.length} renewal(s)` },
    { k: "commit", label: "Commit (90d)", value: fmtMoney(commit), sub: "stage: Committed", tone: "green" },
    { k: "best", label: "Best case (90d)", value: fmtMoney(best), sub: "everything except At risk" },
    { k: "risk", label: "At risk (90d)", value: fmtMoney(atRisk), sub: `${notStarted.length} not started yet`, tone: atRisk ? "red" : undefined },
  ];
  const cardProps = { openAccount, dispatch, user, tasks };
  // Roving tabindex tabs: Left/Right (and Home/End) move selection and focus (follow-up 9).
  const onTabKey = e => {
    const i = RN_VIEWS.findIndex(([k]) => k === view), n = RN_VIEWS.length;
    const j = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    const k = RN_VIEWS[j][0];
    setView(k);
    const el = document.getElementById(`rn-tab-${k}`); if (el) el.focus();
  };
  return (
    <div className="rn-page">
      <div className="rn-head">
        <p data-renewals-subtitle className="rn-sub">Next 12 months · {horizon.length} accounts · {fmtMoney(sum(horizon))} ARR up for renewal</p>
        <div role="tablist" aria-label="Renewals view" className="rn-seg" onKeyDown={onTabKey}>
          {RN_VIEWS.map(([k, l]) => (
            <button key={k} id={`rn-tab-${k}`} type="button" role="tab" aria-selected={view === k} aria-controls="rn-view-panel" tabIndex={view === k ? 0 : -1}
              data-renewals-view={k} className="rn-seg-btn" onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
      </div>
      <section aria-label="Renewal windows" className="rn-windows">
        {windows.map(w => (
          <button key={w.key} type="button" data-renewal-window={w.key} aria-pressed={win === w.key} className="rn-win" onClick={() => setWin(win === w.key ? null : w.key)}>
            <span data-window-label className="rn-win-label"><span aria-hidden="true" className="rn-win-dot" data-win={w.key} />{w.label}</span>
            <span data-window-arr className="rn-win-arr">{fmtMoney(w.arrUSD)}</span>
            <span data-window-sub className="rn-win-sub">{w.count} account{w.count === 1 ? "" : "s"}</span>
          </button>
        ))}
      </section>
      {win && <p data-window-filter className="rn-filter">Showing {winLabel} · <button type="button" data-window-clear className="rn-clear" onClick={() => setWin(null)}>Clear</button></p>}
      <section aria-label="90-day forecast" className="rn-forecast">
        <h2 className="rn-fc-title">90-day forecast</h2>
        {forecast.map(f => (
          <div key={f.k} data-forecast={f.k} data-stat={f.label} className="rn-fc">
            <span className="rn-fc-label">{f.label}</span>
            <span data-forecast-value data-tone={f.tone} className="rn-fc-value">{f.value}</span>
            <span className="rn-fc-sub">{f.sub}</span>
          </div>
        ))}
      </section>
      <div role="tabpanel" id="rn-view-panel" aria-labelledby={`rn-tab-${view}`} className="rn-panel">
      {view === "board" ? (
        <HScroll className="rn-lanes">
          {pastAll.length > 0 && (() => { const items = pastAll.filter(inWin); return (
            <section data-col-past-due aria-label="Past due" className="rn-lane rn-lane-past">
              <div className="rn-lane-head">
                <h2 className="rn-lane-title" data-sev="red">Past due</h2>
                <span data-lane-count className="ad-pill ad-pill-sm rn-pill" data-sev="red">{items.length}</span>
                <span data-lane-total className="rn-lane-total">{items.length ? fmtMoney(sum(items)) + " USD" : ""}</span>
              </div>
              {items.length === 0 && <span data-lane-empty className="rn-lane-empty">No renewals</span>}
              {items.map(a => <RenewalCard key={a.id} a={a} {...cardProps} />)}
            </section>); })()}
          {months.map(m => { const items = m.all.filter(inWin); return (
            <section key={m.key} data-col data-col-month={m.key} aria-label={m.label} className="rn-lane">
              <div className="rn-lane-head">
                <h2 className="rn-lane-title">{m.label}</h2>
                <span data-lane-total className="rn-lane-total">{items.length ? fmtMoney(sum(items)) + " USD" : ""}</span>
              </div>
              {items.length === 0 && <span data-lane-empty className="rn-lane-empty">No renewals</span>}
              {items.map(a => <RenewalCard key={a.id} a={a} {...cardProps} />)}
            </section>); })}
        </HScroll>
      ) : <RenewalsTable items={tableItems} filtered={!!win} {...cardProps} />}
      </div>
      <RenewalOutcomes accounts={allBook} rates={rates} snapshots={snapshots} />
    </div>
  );
}
