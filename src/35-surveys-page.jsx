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

// ---- Responses tab ----
const SV_PAGE_SIZE = 25;
const svDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${+m[3]} ${svMonths[+m[2] - 1]} ${m[1]}` : ""; };
// First rating or NPS answer as pill text and severity, plus the first text answer.
function svAnswerCells(s) {
  const qs = (s.template && Array.isArray(s.template.questions) ? s.template.questions : []).filter(Boolean);
  const ans = s.answers || {};
  const blank = v => v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
  let pill = null;
  const sc = qs.find(q => (q.type === "nps" || q.type === "rating") && typeof ans[q.id] === "number");
  if (sc) {
    const v = ans[sc.id];
    if (sc.type === "nps") pill = { text: `NPS ${v} · ${v >= 9 ? "Promoter" : v >= 7 ? "Passive" : "Detractor"}`, sev: v >= 9 ? "green" : v >= 7 ? undefined : "red" };
    else { const r = v / (sc.scale || 5); pill = { text: `Rating ${answerLabel(sc, v)}`, sev: r <= 0.4 ? "red" : r < 0.75 ? "amber" : "green" }; }
  }
  const tq = qs.find(q => q.type === "text" && !blank(ans[q.id]));
  return { pill, text: tq ? String(ans[tq.id]) : "" };
}

function SvSelect({ k, label, v, all, set, children }) {
  return (
    <label className="fn-flabel sv-flabel">{label}
      <select className="fn-field" data-sv-filter={k} value={v} onChange={e => set(k, e.target.value)}><option value="">{all}</option>{children}</select>
    </label>);
}

function SurveysResponses({ surveys, accountsById, openAccount }) {
  const [f, setF] = useState({ templateId: "", csm: "", tier: "", role: "", from: "", to: "", source: "" });
  const [page, setPage] = useState(0);
  const set = (k, v) => { setF(o => ({ ...o, [k]: v })); setPage(0); };
  const done = useMemo(() => (surveys || []).filter(s => s && s.submittedAt).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt))), [surveys]);
  const opts = useMemo(() => {
    const tpl = new Map(), csm = new Set(), tier = new Set(), role = new Set();
    let noRole = false;
    for (const s of done) {
      const a = accountsById[s.accountId] || {};
      tpl.set(s.templateId, (s.template && s.template.name) || s.templateId);
      if (a.csm) csm.add(a.csm);
      if (a.tier) tier.add(a.tier);
      const r = String(s.contactRole || "").trim();
      if (r) role.add(r); else noRole = true;
    }
    const srt = x => [...x].sort((p, q) => String(p).localeCompare(String(q)));
    return { tpl: [...tpl].sort((p, q) => String(p[1]).localeCompare(String(q[1]))), csm: srt(csm), tier: srt(tier), role: srt(role), noRole };
  }, [done, accountsById]);
  const list = useMemo(() => filterSurveys(done, accountsById, f), [done, accountsById, f]);
  const nSent = list.filter(s => s.source === "sent").length, nImp = list.filter(s => s.source === "import").length;
  const pages = Math.max(1, Math.ceil(list.length / SV_PAGE_SIZE));
  const cur = Math.min(page, pages - 1);
  const shown = list.slice(cur * SV_PAGE_SIZE, (cur + 1) * SV_PAGE_SIZE);
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([responsesCSV(list, accountsById)], { type: "text/csv" }));
    const el = Object.assign(document.createElement("a"), { href: url, download: "survey-responses.csv" });
    el.click(); URL.revokeObjectURL(url);
  };
  const opt = c => <option key={c} value={c}>{c}</option>;
  return (
    <div data-sv-responses className="sv-stack">
      <div className="sv-filters">
        <SvSelect k="templateId" label="Template" v={f.templateId} all="All templates" set={set}>{opts.tpl.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</SvSelect>
        <SvSelect k="csm" label="CSM" v={f.csm} all="All CSMs" set={set}>{opts.csm.map(opt)}</SvSelect>
        <SvSelect k="tier" label="Segment" v={f.tier} all="All segments" set={set}>{opts.tier.map(opt)}</SvSelect>
        <SvSelect k="role" label="Role" v={f.role} all="All roles" set={set}>{opts.role.map(opt)}{opts.noRole && <option value="(none)">No role</option>}</SvSelect>
        <label className="fn-flabel sv-flabel">Date from<input type="date" className="fn-field fn-date-in" data-sv-filter="from" value={f.from} onChange={e => set("from", e.target.value)} /></label>
        <label className="fn-flabel sv-flabel">to<input type="date" className="fn-field fn-date-in" data-sv-filter="to" value={f.to} onChange={e => set("to", e.target.value)} /></label>
        <SvSelect k="source" label="Source" v={f.source} all="All" set={set}><option value="sent">Sent</option><option value="import">Imported</option></SvSelect>
        <span className="sv-meta sv-count-line" data-sv-count>{list.length} response{list.length === 1 ? "" : "s"} · {nSent} sent, {nImp} imported</span>
        <button type="button" className="nm-btn sv-export" data-sv-export onClick={exportCsv} disabled={!list.length}>Export CSV</button>
      </div>
      {!list.length ? <div data-sv-resp-empty className="sv-note">No responses match these filters. Clear a filter to see more.</div> : (
        <section aria-label="Responses" className="sv-panel">
          <div className="sv-scroll">
            <table className="sv-table sv-resp">
              <thead><tr><th scope="col">Date</th><th scope="col">Account</th><th scope="col">Contact</th><th scope="col">Template</th><th scope="col">Answers</th><th scope="col">Source</th><th scope="col">CSM</th></tr></thead>
              <tbody>{shown.map(s => {
                const a = accountsById[s.accountId], c = svAnswerCells(s);
                return (
                  <tr key={s.id} data-sv-resp-row={s.id}>
                    <td className="sv-nowrap">{svDate(s.submittedAt)}</td>
                    <td>{a ? <button type="button" className="fn-link" onClick={() => openAccount(s.accountId)}>{a.name}</button> : <span className="sv-meta">Account removed</span>}</td>
                    <td><div className="sv-bold">{s.contactName || "Unnamed contact"}</div><div className="sv-meta">{s.contactRole || "No role"}</div></td>
                    <td className="sv-nowrap">{(s.template && s.template.name) || s.templateId}</td>
                    <td className="sv-ans">{c.pill && <span className="ad-pill ad-pill-sm" data-sev={c.pill.sev}>{c.pill.text}</span>}<div className="sv-ans-text">{c.text || "No comment"}</div></td>
                    <td><span className="sv-src" data-sv-source>{s.source === "import" ? "Imported" : "Sent"}</span></td>
                    <td>{(a && a.csm) || ""}</td>
                  </tr>);
              })}</tbody>
            </table>
          </div>
          <div className="sv-paging" data-sv-paging>
            <span>Showing {cur * SV_PAGE_SIZE + 1}–{cur * SV_PAGE_SIZE + shown.length} of {list.length}</span>
            <button type="button" className="nm-btn sv-pg" data-sv-prev disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</button>
            <button type="button" className="nm-btn sv-pg" data-sv-next disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button>
          </div>
        </section>)}
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
        {tab === "responses" && (m.state === "ok" ? <SurveysResponses surveys={st.surveys} accountsById={m.byId} openAccount={openAccount} />
          : <div data-sv-responses className="sv-note">{m.state === "failed" ? "Survey data could not be loaded. Reload the page, or try again in a moment. Nothing has been lost." : "No survey responses yet. Send a survey from an account, or import past answers, and the results will show here."}</div>)}
        {tab === "reports" && <div data-sv-reports className="sv-note">Reports will appear here.</div>}
      </div>
    </div>);
}
