/* ------------------------------ surveys page ------------------------------ */
// Surveys PR 4a: the admin-only Surveys sidebar page. Three tabs: Overview (this task), Responses
// and Reports (stubs here, replaced by the next two tasks). All numbers come from the pure
// functions in src/lib/survey-reports.js; this file only lays them out.
const SV_TAB_KEY = "onevio.surveys.tab";
const SV_TABS = [["overview", "Overview"], ["responses", "Responses"], ["reports", "Reports"]];
const SV_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const readSvTab = () => { try { const v = localStorage.getItem(SV_TAB_KEY); return SV_TABS.some(t => t[0] === v) ? v : "overview"; } catch (e) { return "overview"; } };
const svSign = n => (n == null ? "—" : (n > 0 ? "+" : "") + n);
const svPct = n => (n == null ? "—" : n + "%");

// Everything the Overview shows, from the store. `state` is "failed" (surveys never read), "empty" or "ok".
function svOverviewModel(st, accounts) {
  const surveys = st.surveys;
  if (surveys === null || surveys === undefined) return { state: "failed" };
  if (!surveys.length) return { state: "empty" };
  const cfg = (st.settings && st.settings.surveys) || {};
  const month = Number.isInteger(cfg.npsCampaignMonth) ? cfg.npsCampaignMonth : 3;
  const today = iso(Date.now());
  const tasks = st.tasks || [];
  const byId = {};
  for (const a of accounts || []) byId[a.id] = a;
  const years = npsByYear(surveys, month, today);
  const latest = years.length ? years[years.length - 1] : null;
  const prev = latest ? years.find(y => +y.start.slice(0, 4) === +latest.start.slice(0, 4) - 1) : null;
  const fu = followUpStats(surveys, tasks);
  const awaiting = detractorsAwaiting(surveys, tasks);
  const csms = surveyStatsByCsm(surveys, byId, tasks, latest ? { start: latest.start } : undefined);
  return { state: "ok", month, years, latest, prev, fu, awaiting, csms, byId };
}

function SvKpi({ k, label, value, sub, tone }) {
  return (
    <section data-sv-kpi={k} aria-label={label} className="sv-kpi">
      <div className="sv-kpi-label">{label}</div>
      <div className="sv-kpi-val" data-tone={tone}>{value}</div>
      <div className="sv-kpi-sub">{sub}</div>
    </section>);
}

function SvYearRow({ y }) {
  const t = y.n || 0;
  const w = c => (t ? (c / t) * 100 : 0) + "%";
  const label = `${svMonths[+y.start.slice(5, 7) - 1]} ${y.start.slice(0, 4)}`;
  return (
    <div data-sv-year={y.start.slice(0, 4)} className="sv-year">
      <span className="sv-year-label">{label}</span>
      <span role="img" aria-label={t ? `${y.promoters} promoters, ${y.passives} passives, ${y.detractors} detractors` : "No scored answers"} className="sv-split">
        <span style={{ width: w(y.promoters) }} data-k="pro" /><span style={{ width: w(y.passives) }} data-k="pas" /><span style={{ width: w(y.detractors) }} data-k="det" />
      </span>
      <span className="sv-year-nps">{svSign(y.nps)}</span>
      <span className="sv-year-n">n={t}</span>
    </div>);
}

function SurveysOverview({ m, openAccount }) {
  if (m.state === "failed") return <div data-sv-overview data-sv-failed className="sv-note" role="alert">Survey data could not be loaded. Reload the page, or try again in a moment. Nothing has been lost.</div>;
  if (m.state === "empty") return <div data-sv-overview data-sv-empty className="sv-note">No survey responses yet. Send a survey from an account, or import past answers, and the results will show here.</div>;
  const { latest, prev, fu, awaiting, csms, years, byId } = m;
  const ly = latest ? latest.start.slice(0, 4) : "";
  const delta = latest && prev && latest.nps != null && prev.nps != null ? latest.nps - prev.nps : null;
  const npsSub = !latest || latest.nps == null ? "No scored answers yet"
    : `n=${latest.n} · ${delta == null ? "no earlier campaign to compare" : `${svSign(delta)} vs ${prev.start.slice(0, 4)}`}`;
  return (
    <div data-sv-overview className="sv-stack">
      <div className="sv-kpis">
        <SvKpi k="nps" label="Customer NPS" value={latest ? svSign(latest.nps) : "—"} sub={ly ? `Campaign ${ly} · ${npsSub}` : npsSub} />
        <SvKpi k="rate" label="Response rate" value={latest ? svPct(latest.responseRate) : "—"} sub={latest && latest.sent ? `${latest.submitted} of ${latest.sent} sent` : "No surveys sent in this campaign"} />
        <SvKpi k="awaiting" label="Detractors awaiting follow-up" value={awaiting.length} sub={awaiting.length ? "Open follow-up tasks" : "Nothing waiting"} tone={awaiting.length ? "bad" : undefined} />
        <SvKpi k="followup" label="Followed up within 7 days" value={svPct(fu.rate)} sub={fu.total ? `${fu.onTime} of ${fu.total} detractors` : "No follow-ups yet"} />
      </div>
      <div className="sv-two">
        <section data-sv-years aria-label="NPS by year" className="sv-panel">
          <div className="sv-panel-head"><h2 className="sv-h2">NPS by year</h2><span className="sv-meta">one campaign each {SV_MONTH_NAMES[m.month - 1]}</span></div>
          <div className="sv-years">{years.length ? [...years].reverse().map(y => <SvYearRow key={y.start} y={y} />) : <p className="sv-meta">No scored answers yet.</p>}</div>
          <div className="sv-legend">
            <span><i aria-hidden="true" data-k="pro" />Promoters 9–10</span><span><i aria-hidden="true" data-k="pas" />Passives 7–8</span><span><i aria-hidden="true" data-k="det" />Detractors 0–6</span>
          </div>
        </section>
        <section data-sv-awaiting aria-label="Detractors awaiting follow-up" className="sv-panel">
          <div className="sv-panel-head"><h2 className="sv-h2">Detractors awaiting follow-up</h2><span className="sv-count" data-sev={awaiting.length ? "red" : undefined}>{awaiting.length}</span></div>
          {awaiting.length === 0 ? <p className="sv-meta sv-pad">Every detractor has been followed up.</p>
            : <ul className="sv-list">{awaiting.map(({ survey: s, task: t, score, comment }) => {
              const a = byId[s.accountId];
              return (
                <li key={t.id} data-sv-awaiting-row={s.id} className="sv-aw">
                  <div className="sv-aw-top">
                    <button type="button" className="fn-link" onClick={() => openAccount(s.accountId)}>{a ? a.name : "Account"}</button>
                    <span className="sv-meta">{s.contactName || "Unnamed contact"}{s.contactRole ? ` · ${s.contactRole}` : ""}</span>
                    <span className="ad-pill ad-pill-sm sv-score" data-sev="red">NPS {score} · Detractor</span>
                  </div>
                  {comment && <div className="sv-aw-comment">“{comment}”</div>}
                  <div className="sv-meta">CSM {(a && a.csm) || t.owner || "Unassigned"} · answered {svDMon(s.submittedAt)}</div>
                </li>);
            })}</ul>}
        </section>
      </div>
      <section data-sv-csm aria-label="By CSM" className="sv-panel">
        <div className="sv-panel-head"><h2 className="sv-h2">By CSM</h2><span className="sv-meta">{latest ? `Campaign ${ly}` : ""}</span></div>
        <div className="sv-scroll">
          <table className="sv-table">
            <thead><tr><th scope="col">CSM</th><th scope="col" className="r">Sent</th><th scope="col" className="r">Answered</th><th scope="col" className="r">Response rate</th><th scope="col" className="r">NPS</th><th scope="col">Detractors followed up in 7 days</th></tr></thead>
            <tbody>{csms.map(c => {
              const f = c.followUp;
              const text = f.total ? `${f.onTime} of ${f.total} · ${f.rate}%` : "No follow-ups";
              return (
                <tr key={c.csm} data-sv-csm-row={c.csm}>
                  <th scope="row">{c.csm}</th>
                  <td className="r">{c.sent}</td><td className="r">{c.answered}</td><td className="r">{svPct(c.rate)}</td><td className="r sv-bold">{svSign(c.nps)}</td>
                  <td aria-label={f.total ? `Detractors followed up within 7 days: ${f.onTime} of ${f.total} (${f.rate}%)` : "Detractors followed up within 7 days: none to follow up"}>
                    <span className="ad-pill ad-pill-sm" data-sev={f.total ? (f.rate >= 80 ? "green" : f.rate >= 50 ? "amber" : "red") : undefined}>{text}</span>
                  </td>
                </tr>);
            })}</tbody>
          </table>
        </div>
      </section>
    </div>);
}

function SurveysPage({ st, user, accounts, openAccount }) {
  const [tab, setTab] = useState(readSvTab);
  const pick = k => { setTab(k); try { localStorage.setItem(SV_TAB_KEY, k); } catch (e) { /* storage blocked: the tab just is not remembered */ } };
  const m = useMemo(() => svOverviewModel(st, accounts), [st.surveys, st.tasks, st.settings, accounts]);
  const onTabKey = e => {
    const i = SV_TABS.findIndex(([k]) => k === tab), n = SV_TABS.length;
    const j = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    const k = SV_TABS[j][0];
    pick(k);
    const el = document.getElementById(`sv-tab-${k}`); if (el) el.focus();
  };
  const sub = m.state === "ok" && m.latest
    ? [`Customer NPS ${svSign(m.latest.nps)} (${svMonths[+m.latest.start.slice(5, 7) - 1]} ${m.latest.start.slice(0, 4)})`, m.latest.responseRate != null && `${m.latest.responseRate}% response rate`,
      `${m.awaiting.length} detractor${m.awaiting.length === 1 ? "" : "s"} awaiting follow-up`, "admins only"].filter(Boolean).join(" · ")
    : "Survey results across all accounts · admins only";
  return (
    <div data-surveys-page className="fn-page sv-page">
      <div className="fn-head"><p className="fn-sub" data-sv-subtitle>{sub}</p></div>
      <div role="tablist" aria-label="Surveys views" className="sv-seg" onKeyDown={onTabKey}>
        {SV_TABS.map(([k, l]) => (
          <button key={k} id={`sv-tab-${k}`} type="button" role="tab" data-sv-tab={k} aria-selected={tab === k} aria-controls="sv-panel" tabIndex={tab === k ? 0 : -1}
            className="sv-seg-btn" onClick={() => pick(k)}>{l}</button>
        ))}
      </div>
      <div role="tabpanel" id="sv-panel" aria-labelledby={`sv-tab-${tab}`} className="sv-stack">
        {tab === "overview" && <SurveysOverview m={m} openAccount={openAccount} />}
        {tab === "responses" && <div data-sv-responses className="sv-note">Responses will appear here.</div>}
        {tab === "reports" && <div data-sv-reports className="sv-note">Reports will appear here.</div>}
      </div>
    </div>);
}
