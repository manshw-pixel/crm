/* ------------------------------ tasks view ------------------------------ */
const SOURCE_GLYPH = { health: "♥", renewal: "▶", manual: "" };
const SOURCE_NAME = { health: "Health playbook step", renewal: "Renewal playbook step" };
function TaskRow({ t, a, dispatch, openAccount }) {
  const [custom, setCustom] = useState(false);
  const late = t.status !== "Done" && t.due && daysUntil(t.due) < 0;
  return (
    <div data-task-row className="flex items-center gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0">
      <input type="checkbox" checked={t.status === "Done"} title="Complete"
        onChange={() => dispatch({ type: "TOGGLE_TASK", id: t.id })} />
      {/* Playbook tasks are stored with their glyph as a title prefix; show it once, named. */}
      <span className="w-4 text-center text-xs text-slate-500" title={SOURCE_NAME[taskSource(t)]} aria-label={SOURCE_NAME[taskSource(t)]}>{SOURCE_GLYPH[taskSource(t)]}</span>
      <span data-task-title className={t.status === "Done" ? "text-slate-400 line-through" : ""}>{SOURCE_GLYPH[taskSource(t)] ? t.title.replace(/^[▶♥]\s*/, "") : t.title}</span>
      <button className="text-xs text-indigo-600 hover:underline" onClick={() => openAccount(t.accountId)}>{a ? a.name : "—"}</button>
      <span className="flex-1" />
      <select value="" title="Reschedule" aria-label="Reschedule task" className="nm-inset border-0 px-2 py-1 text-xs text-slate-700 outline-none"
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
      {custom && <input type="date" className="nm-inset border-0 px-2 py-1 text-xs" autoFocus
        onChange={e => { if (e.target.value) { dispatch({ type: "EDIT_TASK", id: t.id, patch: { due: e.target.value } }); setCustom(false); } }}
        onBlur={() => setCustom(false)} />}
      {late && <DaysChip days={daysUntil(t.due)} />}
      <span className={`w-24 text-right text-xs ${late ? "font-semibold text-rose-600" : "text-slate-700"}`}>{t.due ? fmtDate(t.due) : "—"}</span>
      <span className="w-14 text-right text-xs text-slate-500">{t.priority}</span>
    </div>
  );
}
function TasksView({ st, scored, dispatch, user, openAccount }) {
  const [scope, setScope] = useState("all");
  const [source, setSource] = useState("all");
  const [band, setBand] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState({ overdue: true, today: true, week: false, later: false, done: false });
  const byId = useMemo(() => Object.fromEntries(scored.map(a => [a.id, a])), [scored]);
  const filtered = filterTasks(st.tasks, byId, { scope, userName: user.name, source, band, q });
  const buckets = bucketTasks(filtered, iso(Date.now()));
  const total = Object.values(buckets).reduce((n, list) => n + list.length, 0);
  const SECTIONS = [
    ["overdue", "Overdue"], ["today", "Today"], ["week", "This week"], ["later", "Later"], ["done", "Done"],
  ];
  return (
    <Card title={`Work queue (${total})`} right={
      <div className="flex flex-wrap items-center gap-2">
        <Btn kind={scope === "mine" ? "primary" : "default"} onClick={() => setScope("mine")}>Mine</Btn>
        <Btn kind={scope === "all" ? "primary" : "default"} onClick={() => setScope("all")}>All</Btn>
        {/* plain <select> rather than the shared Select: these need readable labels with
            short values (the values feed filterTasks, so they must stay as-is) */}
        <select value={source} title="Source" onChange={e => setSource(e.target.value)}
          className="nm-inset border-0 px-3 py-1.5 text-sm text-slate-800 outline-none">
          <option value="all">All sources</option>
          <option value="health">♥ Health</option>
          <option value="renewal">▶ Renewal</option>
          <option value="manual">Manual</option>
        </select>
        <select value={band} title="Health band" onChange={e => setBand(e.target.value)}
          className="nm-inset border-0 px-3 py-1.5 text-sm text-slate-800 outline-none">
          <option value="all">All health</option>
          <option value="Red">Red</option>
          <option value="Yellow">Yellow</option>
          <option value="Green">Green</option>
        </select>
        <Input value={q} placeholder="Search tasks…" onChange={e => setQ(e.target.value)} className="w-44" />
      </div>
    }>
      <p data-source-legend className="mb-2 text-[11px] text-slate-500">▶ renewal playbook step · ♥ health playbook step · unmarked tasks were added by hand</p>
      {st.tasks.length === 0 && <p className="text-sm text-slate-500">Nothing in the queue — tasks appear here as playbooks seed them.</p>}
      {st.tasks.length > 0 && total === 0 && <p className="text-sm text-slate-500">No tasks match these filters.</p>}
      {SECTIONS.map(([key, label]) => buckets[key].length > 0 && (
        <div key={key} className="mb-3">
          <button className="mb-1 flex w-full items-center gap-2 text-left" onClick={() => setOpen(o => ({ ...o, [key]: !o[key] }))}>
            <span className={`text-xs font-bold uppercase tracking-widest ${key === "overdue" ? "text-rose-600" : "text-slate-500"}`}>{label}</span>
            <span className="text-xs text-slate-500">({buckets[key].length})</span>
            <span className="text-xs text-slate-400">{open[key] ? "▾" : "▸"}</span>
          </button>
          {open[key] && buckets[key].map(t => <TaskRow key={t.id} t={t} a={byId[t.accountId]} dispatch={dispatch} openAccount={openAccount} />)}
        </div>
      ))}
    </Card>
  );
}

