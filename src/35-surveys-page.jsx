/* ------------------------------ surveys page ------------------------------ */
// Surveys PR 4a: the admin-only Surveys sidebar page. Three tabs: Overview (this task), Responses
// and Reports. All numbers come from the pure
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

// ---- Reports tab ----
const SV_TEXT_FIRST = 5;
const SV_TYPE_LABEL = { rating: q => `RATING 1–${q.scale || 5}`, nps: () => "NPS 0–10", single: () => "PICK ONE", multi: () => "PICK ANY", text: () => "TEXT" };
const svValidDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z"));

// Rating: one column per score, with the count printed under each bar and the average beside it.
function SvRating({ r }) {
  const max = Math.max(1, ...r.dist);
  return (
    <div className="sv-rating">
      <div className="sv-avg"><span className="sv-avg-num">{r.avg == null ? "—" : r.avg}</span>{r.avg != null && <span className="sv-meta"> / {r.scale}</span>}<span className="sv-meta sv-n">n={r.n}</span></div>
      <div role="img" aria-label={`Answers by score: ${r.dist.map((c, i) => `${i + 1}: ${c}`).join(", ")}`} className="sv-bars">
        {r.dist.map((c, i) => (
          <div key={i} className="sv-bar-col"><span className="sv-bar-count">{c}</span><div className="sv-bar-track"><div className="sv-bar" style={{ height: (c / max) * 100 + "%" }} /></div><span className="sv-bar-label">{i + 1}</span></div>
        ))}
      </div>
    </div>);
}

function SvNpsBar({ y }) {
  const t = y.n || 0, w = c => (t ? (c / t) * 100 : 0) + "%";
  return (
    <span role="img" aria-label={t ? `${y.promoters} promoters, ${y.passives} passives, ${y.detractors} detractors` : "No scored answers"} className="sv-split">
      <span style={{ width: w(y.promoters) }} data-k="pro" /><span style={{ width: w(y.passives) }} data-k="pas" /><span style={{ width: w(y.detractors) }} data-k="det" />
    </span>);
}

function SvChoices({ r }) {
  const max = Math.max(1, ...r.counts.map(c => c.n));
  return (
    <div className="sv-choices">
      <span className="sv-meta">n={r.n}</span>
      {r.counts.map(c => (
        <div key={c.label} className="sv-choice"><span className="sv-choice-label">{c.label}</span>
          <span aria-hidden="true" className="sv-choice-track"><span style={{ width: (c.n / max) * 100 + "%" }} /></span>
          <span className="sv-choice-n">{c.n}</span></div>
      ))}
    </div>);
}

function SvTexts({ r, accountsById }) {
  const [all, setAll] = useState(false);
  const shown = all ? r.items : r.items.slice(0, SV_TEXT_FIRST);
  return (
    <div>
      <span className="sv-meta">n={r.n}</span>
      <ul className="sv-texts">{shown.map((x, i) => {
        const a = accountsById[x.accountId];
        return (
          <li key={i} data-sv-text-item className="sv-text">“{x.text}”
            <div className="sv-meta">{[a && a.name, x.contactName, svDate(x.date)].filter(Boolean).join(" · ")}{x.source === "import" && <span className="sv-src sv-imp"> imported</span>}</div>
          </li>);
      })}</ul>
      {!all && r.items.length > SV_TEXT_FIRST && <button type="button" className="fn-link sv-showall" data-sv-show-all onClick={() => setAll(true)}>Show all {r.items.length} text answers</button>}
    </div>);
}

// A result in one scale, compact. Used for the current period, the previous period and each role.
function SvResultBody({ r, accountsById }) {
  if (!r || !r.n) return <p className="sv-meta sv-dash">—</p>;
  if (r.type === "rating") return <SvRating r={r} />;
  if (r.type === "single" || r.type === "multi") return <SvChoices r={r} />;
  if (r.type === "text") return <SvTexts r={r} accountsById={accountsById} />;
  return null;
}

function SvQuestionCard({ r, index, prev, roles, split, years, accountsById, compare }) {
  const label = (SV_TYPE_LABEL[r.type] || (() => String(r.type).toUpperCase()))(r);
  const isNps = r.type === "nps";
  return (
    <section data-sv-question={r.id} aria-label={`Question ${index + 1}`} className="sv-panel sv-q">
      <div className="sv-q-head"><span className="sv-q-kind">Q{index + 1} · {label}</span><h2 className="sv-h2">{r.text}</h2></div>
      {isNps ? (
        <div className="sv-years">
          <span className="sv-meta">Filtered answers: {r.n ? `${svSign(r.nps)} · n=${r.n}` : "—"}</span>
          {years.length ? [...years].reverse().map(y => (
            <div key={y.start} className="sv-year"><span className="sv-year-label">{svMonths[+y.start.slice(5, 7) - 1]} {y.start.slice(0, 4)}</span><SvNpsBar y={y} /><span className="sv-year-nps">{svSign(y.nps)}</span><span className="sv-year-n">n={y.n || 0}</span></div>
          )) : <span className="sv-meta">No scored answers yet.</span>}
        </div>
      ) : (
        <div className={compare ? "sv-cmp" : ""}>
          <div className="sv-period" data-sv-current>{compare && <div className="sv-period-k">Selected period</div>}<SvResultBody r={r} accountsById={accountsById} /></div>
          {compare && <div className="sv-period" data-sv-prev><div className="sv-period-k">Previous period</div><SvResultBody r={prev} accountsById={accountsById} /></div>}
        </div>
      )}
      {split && (
        <div className="sv-roles">{roles.map(({ role, r: rr }) => (
          <div key={role} data-sv-role={role} className="sv-role"><div className="sv-period-k">{role}</div>
            {rr && rr.n ? (isNps ? <span className="sv-meta">{svSign(rr.nps)} · n={rr.n}</span> : r.type === "text" ? <span className="sv-meta">{rr.n} text answer{rr.n === 1 ? "" : "s"}</span> : <SvResultBody r={rr} accountsById={accountsById} />) : <p className="sv-meta sv-dash">—</p>}
          </div>))}
        </div>)}
    </section>);
}

function SurveysReports({ surveys, accountsById, month }) {
  const [f, setF] = useState({ templateId: "", csm: "", tier: "", from: "", to: "" });
  const [split, setSplit] = useState(false);
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));
  const opts = useMemo(() => {
    const tpl = new Map(), csm = new Set(), tier = new Set();
    let latest = "", latestId = "";
    for (const s of surveys || []) {
      if (!s || !s.templateId) continue;
      if (!tpl.has(s.templateId)) tpl.set(s.templateId, (s.template && s.template.name) || s.templateId);
      const a = accountsById[s.accountId] || {};
      if (a.csm) csm.add(a.csm);
      if (a.tier) tier.add(a.tier);
      if (s.submittedAt && String(s.submittedAt) > latest) { latest = String(s.submittedAt); latestId = s.templateId; }
    }
    const srt = x => [...x].sort((p, q) => String(p).localeCompare(String(q)));
    const list = [...tpl].sort((p, q) => String(p[1]).localeCompare(String(q[1])));
    return { tpl: list, csm: srt(csm), tier: srt(tier), def: latestId || (list[0] && list[0][0]) || "" };
  }, [surveys, accountsById]);
  const tid = f.templateId && opts.tpl.some(t => t[0] === f.templateId) ? f.templateId : opts.def;
  const base = { csm: f.csm, tier: f.tier };
  const range = svValidDay(f.from) && svValidDay(f.to) && f.from <= f.to;
  const model = useMemo(() => {
    const mine = filterSurveys(surveys, accountsById, { ...base, templateId: tid });
    const cur = filterSurveys(mine, accountsById, { from: f.from, to: f.to }).filter(s => s.submittedAt);
    const results = questionResults(cur, tid);
    let prevResults = null;
    if (range) {
      const p = previousPeriod(f.from, f.to);
      prevResults = questionResults(filterSurveys(mine, accountsById, { from: p.from, to: p.to }).filter(s => s.submittedAt), tid);
    }
    const roles = split ? roleSplit(cur, tid) : [];
    const years = npsByYear(mine, month, iso(Date.now()));
    return { results, prevResults, roles, years, cur };
  }, [surveys, accountsById, tid, f.csm, f.tier, f.from, f.to, split, month]);
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([responsesCSV(model.cur, accountsById)], { type: "text/csv" }));
    const el = Object.assign(document.createElement("a"), { href: url, download: "survey-report.csv" });
    el.click(); URL.revokeObjectURL(url);
  };
  const opt = c => <option key={c} value={c}>{c}</option>;
  const hasNps = model.results.some(r => r.type === "nps");
  return (
    <div data-sv-reports className="sv-stack">
      <div className="sv-filters">
        <label className="fn-flabel sv-flabel">Template
          <select className="fn-field" data-sv-filter="report-template" value={tid} onChange={e => set("templateId", e.target.value)}>{opts.tpl.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        </label>
        <label className="fn-flabel sv-flabel">Date from<input type="date" className="fn-field fn-date-in" data-sv-filter="from" value={f.from} onChange={e => set("from", e.target.value)} /></label>
        <label className="fn-flabel sv-flabel">to<input type="date" className="fn-field fn-date-in" data-sv-filter="to" value={f.to} onChange={e => set("to", e.target.value)} /></label>
        <SvSelect k="tier" label="Segment" v={f.tier} all="All segments" set={set}>{opts.tier.map(opt)}</SvSelect>
        <SvSelect k="csm" label="CSM" v={f.csm} all="All CSMs" set={set}>{opts.csm.map(opt)}</SvSelect>
        <label className="sv-check"><input type="checkbox" data-sv-split checked={split} onChange={e => setSplit(e.target.checked)} />Split by role</label>
        <button type="button" className="nm-btn sv-export" data-sv-export onClick={exportCsv} disabled={!model.cur.length}>Export CSV</button>
      </div>
      {f.from && f.to && !range && <div className="sv-meta" role="status">Check the dates: the start must be on or before the end. Showing no previous-period comparison.</div>}
      {!model.results.length ? <div data-sv-resp-empty className="sv-note">No answers match these filters. Clear a filter to see more.</div>
        : model.results.map((r, i) => {
          const prev = model.prevResults && model.prevResults.find(x => x.key === r.key);
          const roles = model.roles.map(g => ({ role: g.role, r: g.results.find(x => x.key === r.key) }));
          return <SvQuestionCard key={r.key} r={r} index={i} prev={prev} roles={roles} split={split} years={model.years} accountsById={accountsById} compare={range && r.type !== "nps"} />;
        })}
      <p className="sv-meta sv-foot">{hasNps ? "NPS questions always compare by yearly campaign. " : ""}Imported answers count and are marked imported in lists.</p>
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
        {tab === "reports" && (m.state === "ok" ? <SurveysReports surveys={st.surveys} accountsById={m.byId} month={m.month} />
          : <div data-sv-reports className="sv-note">{m.state === "failed" ? "Survey data could not be loaded. Reload the page, or try again in a moment. Nothing has been lost." : "No survey responses yet. Send a survey from an account, or import past answers, and the results will show here."}</div>)}
      </div>
    </div>);
}
