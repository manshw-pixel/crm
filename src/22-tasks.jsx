/* ------------------------------ tasks view ------------------------------ */
// Playbook tasks are stored with a glyph title prefix; the UI shows a word tag instead.
const SOURCE_TAG = { renewal: "Renewal", health: "Health" };
const SOURCE_NAME = { health: "Health playbook step", renewal: "Renewal playbook step" };
const TASK_PRI_SEV = { High: "red", Medium: "amber", Low: "grey" };
const TkChevron = ({ open }) => (
  <svg className="tk-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={open ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6"} />
  </svg>
);
function TaskRow({ t, a, dispatch, openAccount }) {
  const [custom, setCustom] = useState(false);
  const done = t.status === "Done";
  const src = taskSource(t);
  const title = SOURCE_TAG[src] ? t.title.replace(/^[▶♥]\s*/, "") : t.title;
  const days = t.due ? daysUntil(t.due) : null;
  const late = !done && t.due && days < 0;
  const dueText = late ? `Overdue · ${-days}d` : !t.due ? "No due date" : days === 0 ? "Today" : fmtDate(t.due);
  return (
    <div data-task-row className="tk-row" data-done={done ? "true" : undefined}>
      <label data-task-check-hit className="tk-hit"><input type="checkbox" className="tk-check" checked={done} title="Complete" aria-label={`Complete ${title}`}
        onChange={() => dispatch({ type: "TOGGLE_TASK", id: t.id })} /></label>
      <div className="tk-main">
        <div className="tk-title-line">
          <span data-task-title className={`tk-title${done ? " line-through" : ""}`}>{title}</span>
          {SOURCE_TAG[src] && <span data-task-source={src} className="tk-tag" data-src={src} title={SOURCE_NAME[src]} aria-label={SOURCE_NAME[src]}>{SOURCE_TAG[src]}</span>}
        </div>
        <button data-task-account className="tk-acct" onClick={() => openAccount(t.accountId)}>{a ? a.name : "—"}</button>
      </div>
      <div className="tk-cluster">
        <select value="" title="Reschedule" aria-label="Reschedule task" className="tk-sel tk-resched"
          onChange={e => {
            const v = e.target.value;
            if (v === "custom") { setCustom(true); return; }
            if (v !== "") dispatch({ type: "EDIT_TASK", id: t.id, patch: { due: isoPlus(iso(Date.now()), +v) } });
          }}>
          <option value="">Reschedule</option>
          <option value="0">Today</option>
          <option value="1">Tomorrow</option>
          <option value="7">+1 week</option>
          <option value="custom">Pick date…</option>
        </select>
        {custom && <input type="date" className="tk-sel tk-date" aria-label="New due date" autoFocus
          onChange={e => { if (e.target.value) { dispatch({ type: "EDIT_TASK", id: t.id, patch: { due: e.target.value } }); setCustom(false); } }}
          onBlur={() => setCustom(false)} />}
        <span data-task-due data-sev={late ? "red" : "grey"} data-days-chip={late ? "overdue" : undefined} className="ad-pill tk-due">{dueText}</span>
        <span data-task-priority data-sev={TASK_PRI_SEV[t.priority] || "grey"} className="tk-pri">{t.priority}</span>
      </div>
    </div>
  );
}
function TasksView({ st, scored, dispatch, user, openAccount, initialFilter }) {
  const [scope, setScope] = useState("all");
  const [source, setSource] = useState("all");
  const [band, setBand] = useState("all");
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("");
  const [open, setOpen] = useState({ overdue: true, today: true, week: false, later: false, done: false });
  // Hand-off from a dashboard card/row: pre-apply an owner filter and/or open only Overdue.
  useEffect(() => {
    if (!initialFilter) return;
    if (initialFilter.owner !== undefined) { setOwner(initialFilter.owner); setScope("all"); }
    setOpen(initialFilter.overdue ? { overdue: true, today: false, week: false, later: false, done: false }
      : { overdue: true, today: true, week: false, later: false, done: false });
  }, [initialFilter]);
  const byId = useMemo(() => Object.fromEntries(scored.map(a => [a.id, a])), [scored]);
  const filtered = filterTasks(st.tasks, byId, { scope, userName: user.name, source, band, q, owner });
  const todayIso = iso(Date.now()); // one date source for the buckets AND the Today hint
  const buckets = bucketTasks(filtered, todayIso);
  const total = Object.values(buckets).reduce((n, list) => n + list.length, 0);
  const openCount = buckets.overdue.length + buckets.today.length + buckets.week.length + buckets.later.length;
  const todayHint = fmtDayHint(todayIso);
  const SECTIONS = [
    ["overdue", "Overdue", "oldest first"], ["today", "Today", todayHint], ["week", "This week", "next 7 days"], ["later", "Later", ""], ["done", "Done", ""],
  ];
  return (
    <div className="tk-page">
      <div className="tk-head">
        <p data-tasks-subtitle className="tk-sub">{`${openCount} open · ${buckets.overdue.length} overdue · ${buckets.today.length} due today · ${buckets.week.length} this week`}</p>
        <div role="group" aria-label="Scope" className="tk-seg">
          <button className="tk-seg-btn" aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>Mine</button>
          <button className="tk-seg-btn" aria-pressed={scope === "all"} onClick={() => setScope("all")}>All</button>
        </div>
      </div>
      <div className="tk-filters">
        {/* plain <select>s: the option values feed filterTasks, so they must stay as-is */}
        <label className="tk-flabel">Source
          <select value={source} title="Source" onChange={e => setSource(e.target.value)} className="tk-sel">
            <option value="all">All sources</option>
            <option value="renewal">Renewal playbook</option>
            <option value="health">Health playbook</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        <label className="tk-flabel">Health
          <select value={band} title="Health band" onChange={e => setBand(e.target.value)} className="tk-sel">
            <option value="all">All health</option>
            <option value="Red">Red</option>
            <option value="Yellow">Yellow</option>
            <option value="Green">Green</option>
          </select>
        </label>
        <label className="tk-flabel tk-search"><span className="tk-sr">Search tasks</span>
          <input value={q} placeholder="Search tasks…" onChange={e => setQ(e.target.value)} className="tk-sel tk-input" />
        </label>
        {owner && <button data-task-owner-filter onClick={() => setOwner("")} className="tk-chip" aria-label={`Clear owner filter ${owner}`} title={`Owner: ${owner}`}>Owner: <span className="inline-block max-w-[16rem] truncate align-bottom">{owner}</span> ×</button>}
        <span className="tk-spacer" />
        <p data-source-legend className="tk-legend">Tags: <b>Renewal</b> / <b>Health</b> = playbook step · untagged = added by hand</p>
      </div>
      {st.tasks.length === 0 && <p className="tk-empty">Nothing in the queue — tasks appear here as playbooks seed them.</p>}
      {st.tasks.length > 0 && total === 0 && <p className="tk-empty">No tasks match these filters.</p>}
      {SECTIONS.map(([key, label, hint]) => buckets[key].length > 0 && (
        <section key={key} data-task-section={key} aria-label={label} className="tk-sec">
          <h2 className="tk-sec-h"><button className="tk-sec-head" aria-expanded={!!open[key]} onClick={() => setOpen(o => ({ ...o, [key]: !o[key] }))}>
            <span className="tk-dot" data-sec={key} aria-hidden="true" />
            <span data-section-title className="tk-sec-title" data-sec={key}>{label}</span>
            <span data-section-count className="tk-count" data-sec={key}>{buckets[key].length}</span>
            {hint && <span data-section-hint className="tk-hint">{hint}</span>}
            <span className="tk-chev-wrap"><TkChevron open={!!open[key]} /></span>
          </button></h2>
          {open[key] && <div className="tk-rows">{buckets[key].map(t => <TaskRow key={t.id} t={t} a={byId[t.accountId]} dispatch={dispatch} openAccount={openAccount} />)}</div>}
        </section>
      ))}
    </div>
  );
}
