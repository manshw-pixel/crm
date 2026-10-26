/* ------------------------- implementation projects ------------------------- */
// Handover checklist, the account Projects card and the Implementation page.
// Function declarations (not const) so 26-app.jsx and 21-account-detail.jsx, joined earlier,
// can reference them: they hoist across the concatenated script.

function implChecklistOf(st) { return (st.settings && st.settings.implChecklist) || DEFAULT_IMPL_CHECKLIST; }
var IMPL_TYPE_LABEL = { onboarding: "Onboarding", expansion: "Expansion" };

// The first required item left empty, or null when the checklist can be submitted.
function missingRequired(template, values) {
  return template.find(it => it.required && (it.kind === "check" ? !values[it.id] : !String(values[it.id] || "").trim())) || null;
}

function HandoverForm({ account, st, dispatch, user, onDone }) {
  const toast = useToast();
  const template = implChecklistOf(st);
  const type = projectType(account.id, st.projects);
  const [values, setValues] = useState({});
  const [err, setErr] = useState("");
  const set = (k, v) => setValues(s => ({ ...s, [k]: v }));
  const formRef = useRef(null);
  // opened from the "Start onboarding" toast the form may be far below: bring it into view
  useEffect(() => {
    const f = formRef.current; if (!f) return;
    f.scrollIntoView && f.scrollIntoView({ behavior: "smooth", block: "center" });
    const first = f.querySelector("input"); if (first) first.focus({ preventScroll: true });
  }, []);
  const submit = e => {
    e.preventDefault();
    const miss = missingRequired(template, values);
    if (miss) { setErr(`Required: ${miss.label}`); return; }
    const now = new Date().toISOString();
    const dateItem = template.find(it => it.kind === "date" && it.id === "go_live_target") || template.find(it => it.kind === "date");
    dispatch({ type: "ADD_PROJECT", item: {
      id: uid(), accountId: account.id, type, stage: "queued", implementerId: null, createdBy: user.name,
      checklistTemplate: template.map(it => ({ ...it })), checklist: values,
      targetGoLive: (dateItem && values[dateItem.id]) || null, startedAt: null, liveAt: null,
      history: [historyEntry("handover", "queued", user, "Handover submitted", now)], holdReason: "" } });
    toast({ text: `${IMPL_TYPE_LABEL[type]} project queued for ${account.name}.`, tone: "success" });
    onDone();
  };
  return (
    <form ref={formRef} data-handover-form className="space-y-2" onSubmit={submit}>
      <div className="text-sm font-bold text-slate-800">New {IMPL_TYPE_LABEL[type].toLowerCase()} project · handover checklist</div>
      {template.map(it => (
        <label key={it.id} data-checklist-item={it.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
          {it.kind === "check"
            ? <><input type="checkbox" checked={!!values[it.id]} onChange={e => set(it.id, e.target.checked)} /><span>{it.label}{it.required && " *"}</span></>
            : <><span className="w-56">{it.label}{it.required && " *"}</span>
              <Input type={it.kind === "date" ? "date" : "text"} value={values[it.id] || ""} onChange={e => set(it.id, e.target.value)} className="w-auto flex-1" /></>}
        </label>
      ))}
      {err && <div data-handover-error role="alert" className="text-sm font-semibold text-rose-600">{err}</div>}
      <div className="flex gap-2"><Btn kind="primary" type="submit">Submit handover</Btn><Btn onClick={onDone}>Cancel</Btn></div>
    </form>
  );
}

function ProjectsCard({ account, st, dispatch, user, open, setOpen, openProject }) {
  const projects = (st.projects || []).filter(p => p.accountId === account.id);
  const canCreate = !isImplRole(user);
  return (
    <Card title={`Projects (${projects.length})`} right={canCreate && !open
      ? <Btn data-new-project onClick={() => setOpen(true)}>+ New project</Btn> : null}>
      {open && canCreate && <div className="mb-3"><HandoverForm key={account.id} account={account} st={st} dispatch={dispatch} user={user} onDone={() => setOpen(false)} /></div>}
      {projects.length === 0 && <div className="text-sm text-slate-500">No implementation projects.</div>}
      {projects.map(p => (
        <div key={p.id} data-project-row={p.id} data-stage={p.stage} data-type={p.type} role={openProject ? "button" : undefined} tabIndex={openProject ? 0 : undefined}
          onClick={openProject ? () => openProject(p.id) : undefined} onKeyDown={openProject ? e => { if (e.key === "Enter") openProject(p.id); } : undefined}
          className={`flex items-center gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0 ${openProject ? "cursor-pointer hover:bg-slate-50" : ""}`}>
          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-600">{IMPL_TYPE_LABEL[p.type] || p.type}</span>
          <span className="flex-1 font-medium">{STAGE_LABEL[p.stage] || p.stage}</span>
          {p.targetGoLive && <span className="text-xs text-slate-500">go-live {fmtDate(p.targetGoLive)}</span>}
        </div>
      ))}
    </Card>
  );
}

var BOARD_COLUMNS = ["queued", "planning", "in_progress", "csm_review", "live"];
var BOARD_COLLAPSED = ["on_hold", "cancelled"];

function BoardCard({ p, st, onOpen }) {
  const acct = (st.accounts || []).find(a => a.id === p.accountId);
  const tasks = (st.projectTasks || []).filter(t => t.projectId === p.id);
  const done = tasks.filter(t => t.status === "done").length;
  return (
    <button data-board-project={p.id} onClick={() => onOpen(p.id)} className="nm-btn mb-2 block w-full p-2 text-left text-xs">
      <div className="text-sm font-semibold text-slate-800">{acct ? acct.name : "Unknown account"}</div>
      <div className="text-slate-500">{IMPL_TYPE_LABEL[p.type] || p.type} · {p.implementerId ? teamName(st, p.implementerId) : "Unassigned"}</div>
      <div className="text-slate-500">{p.targetGoLive ? `go-live ${fmtDate(p.targetGoLive)} · ` : ""}{done}/{tasks.length} tasks</div>
    </button>
  );
}

function ImplementationPage({ st, dispatch, user, projectId, setProjectId }) {
  const [tab, setTab] = useState("Board");
  const [localId, setLocalId] = useState(null);
  const selId = setProjectId ? projectId : localId;
  const select = setProjectId || setLocalId;
  const [who, setWho] = useState("");
  const [type, setType] = useState("");
  const projects = (st.projects || []).filter(p => (!who || (who === "_mine" ? p.implementerId === user.id : p.implementerId === who)) && (!type || p.type === type));
  const acctName = id => ((st.accounts || []).find(a => a.id === id) || {}).name || "Unknown account";
  const myTasks = (st.projectTasks || []).filter(t => t.ownerId === user.id && t.status !== "done")
    .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")));
  const impls = implementersOf(st);
  if (selId) return <Card title="Implementation project"><ProjectDetail st={st} dispatch={dispatch} user={user} projectId={selId} onBack={() => select(null)} /></Card>;
  const column = s => {
    const rows = projects.filter(p => p.stage === s);
    return rows.map(p => <BoardCard key={p.id} p={p} st={st} onOpen={select} />);
  };
  return (
    <Card title="Implementation projects">
      <div className="mb-3 flex gap-2" role="tablist">
        {["Board", ...(canManageImpl(user) ? ["Workload"] : []), "My tasks"].map(t => <button key={t} role="tab" aria-selected={tab === t} data-impl-tab={t}
          className={`nm-btn px-3 py-1.5 text-xs font-bold ${tab === t ? "text-indigo-700" : "text-slate-600"}`} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      {tab === "Board" && <>
        <div className="mb-3 flex flex-wrap gap-2">
          <Select data-board-filter-who aria-label="Implementer filter" value={who} onChange={e => setWho(e.target.value)}
            options={["", "_mine", ...impls.map(u => u.id)]} labels={{ "": "All implementers", _mine: "Mine", ...Object.fromEntries(impls.map(u => [u.id, u.name])) }} />
          <Select data-board-filter-type aria-label="Type filter" value={type} onChange={e => setType(e.target.value)}
            options={["", "onboarding", "expansion"]} labels={{ "": "All types", ...IMPL_TYPE_LABEL }} />
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {BOARD_COLUMNS.map(s => <div key={s} data-board-column={s} className="w-56 shrink-0">
            <div className="mb-2 text-xs font-bold uppercase text-slate-500">{STAGE_LABEL[s]} ({projects.filter(p => p.stage === s).length})</div>
            {column(s)}
          </div>)}
        </div>
        {BOARD_COLLAPSED.map(s => <details key={s} data-board-column={s} data-board-collapsed className="mt-2">
          <summary className="cursor-pointer text-xs font-bold uppercase text-slate-500">{STAGE_LABEL[s]} ({projects.filter(p => p.stage === s).length})</summary>
          <div className="mt-2 grid grid-cols-1 gap-x-3 sm:grid-cols-3">{column(s)}</div>
        </details>)}
      </>}
      {tab === "Workload" && canManageImpl(user) && <WorkloadTable st={st} dispatch={dispatch} user={user} />}
      {tab === "My tasks" && (myTasks.length === 0 ? <div className="text-sm text-slate-500">No open tasks assigned to you.</div>
        : myTasks.map(t => <button key={t.id} data-my-task={t.id} onClick={() => select(t.projectId)}
          className="flex w-full gap-3 border-b border-slate-100 py-1.5 text-left text-sm last:border-0">
          <span className="flex-1 font-medium">{t.title}</span>
          <span className="text-xs text-slate-500">{acctName(t.accountId)}</span>
          <span className="text-xs text-slate-500">{t.due ? `due ${fmtDate(t.due)}` : "no due date"}</span></button>))}
    </Card>
  );
}

var LOAD_BAND_TEXT = { green: "text-emerald-600", amber: "text-amber-600", red: "text-rose-600" };

// One row per implementer (see workload() in src/lib/implementation.js). Capacity lives in
// settings, which RLS lets only admins write: impl_leads see it read-only.
function WorkloadTable({ st, dispatch, user }) {
  const caps = (st.settings && st.settings.implCapacity) || {};
  const rows = workload(implementersOf(st), st.projects || [], st.projectTasks || [], caps, iso(Date.now()));
  const canEdit = user.role === "admin";
  const hrs = n => `${Math.round(n * 10) / 10}h`;
  const setCap = (id, raw) => {
    const n = Number(raw);
    const next = { ...caps };
    if (!raw || !(n > 0)) delete next[id]; else next[id] = n;
    if ((caps[id] || null) !== (next[id] || null)) dispatch({ type: "SET_IMPL_CAPACITY", map: next });
  };
  if (!rows.length) return <div className="text-sm text-slate-500">No implementers yet. Give a team member the impl_user or impl_lead role.</div>;
  const th = "px-2 py-1.5 text-left text-xs font-bold uppercase text-slate-500";
  return (
    <div className="overflow-x-auto">
      <table data-workload-table className="w-full text-sm">
        <thead><tr className="border-b border-slate-200">
          <th className={th}>Implementer</th><th className={th}>Active projects</th><th className={th}>Remaining</th>
          <th className={th}>Logged 30d</th><th className={th}>Free from</th><th className={th}>Weekly capacity</th><th className={th}>Load</th>
        </tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id} data-workload-row={r.id} className="border-b border-slate-100 last:border-0">
            <td className="px-2 py-1.5 font-medium text-slate-800">{r.name}</td>
            <td data-col="active" className="px-2 py-1.5 tabular-nums">{r.active}</td>
            <td data-col="remaining" className="px-2 py-1.5 tabular-nums">{hrs(r.remainingHours)}</td>
            <td data-col="logged30" className="px-2 py-1.5 tabular-nums">{hrs(r.logged30)}</td>
            <td data-col="freeFrom" className="px-2 py-1.5">{r.freeFrom ? fmtDate(r.freeFrom) : "—"}</td>
            <td data-col="capacity" className="px-2 py-1.5 tabular-nums">{canEdit
              ? <Input key={r.id + "|" + (caps[r.id] || "")} data-capacity-input type="number" min="1" aria-label={`Weekly capacity for ${r.name} (hours)`}
                  defaultValue={caps[r.id] || ""} placeholder="30" className="w-20" onBlur={e => setCap(r.id, e.target.value.trim())} />
              : hrs(caps[r.id] || 30)}</td>
            <td data-col="load" data-band={r.band || ""} className={`px-2 py-1.5 font-bold tabular-nums ${r.band ? LOAD_BAND_TEXT[r.band] : "text-slate-400"}`}>{r.loadPct === null ? "—" : `${r.loadPct}%`}</td>
          </tr>))}</tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">Load = remaining hours ÷ (weekly capacity × weeks until their latest due date). Green below 80%, amber 80–100%, red above 100%. Default capacity 30h.{canEdit ? "" : " Only admins can change capacity."}</p>
    </div>
  );
}

function ImplChecklistSettingsCard({ st, dispatch }) {
  const items = implChecklistOf(st);
  const save = next => dispatch({ type: "SET_IMPL_CHECKLIST", items: next });
  const patch = (id, p) => save(items.map(it => it.id === id ? { ...it, ...p } : it));
  const move = (i, d) => { const n = items.slice(); [n[i], n[i + d]] = [n[i + d], n[i]]; save(n); };
  return (
    <Card title="Implementation checklist">
      <p className="mb-2 text-xs text-slate-500">The handover checklist for new projects. Existing projects keep the copy they were created with.</p>
      {items.map((it, i) => (
        <div key={it.id} data-impl-item={it.id} className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <Input key={it.id + "|" + it.label} defaultValue={it.label} aria-label="Item label" className="w-56"
            onBlur={e => { const v = e.target.value.trim(); if (v && v !== it.label) patch(it.id, { label: v }); else e.target.value = it.label; }} />
          <Select value={it.kind} aria-label="Item kind" onChange={e => patch(it.id, { kind: e.target.value })} options={["check", "text", "date"]} />
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!it.required} onChange={e => patch(it.id, { required: e.target.checked })} />Required</label>
          <button title="Move up" aria-label="Move up" disabled={i === 0} className="text-xs text-slate-500 disabled:opacity-30" onClick={() => move(i, -1)}>▲</button>
          <button title="Move down" aria-label="Move down" disabled={i === items.length - 1} className="text-xs text-slate-500 disabled:opacity-30" onClick={() => move(i, 1)}>▼</button>
          <button title="Remove item" aria-label="Remove item" disabled={items.length === 1} className="text-xs text-rose-600 disabled:opacity-30" onClick={() => save(items.filter(x => x.id !== it.id))}>✕</button>
        </div>
      ))}
      <Btn data-impl-add-item onClick={() => save([...items, { id: uid(), label: "New item", kind: "check", required: false }])}>+ Add item</Btn>
    </Card>
  );
}
