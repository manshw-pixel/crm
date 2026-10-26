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
    <form data-handover-form className="space-y-2" onSubmit={submit}>
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

function ProjectsCard({ account, st, dispatch, user, open, setOpen }) {
  const projects = (st.projects || []).filter(p => p.accountId === account.id);
  const canCreate = !isImplRole(user);
  return (
    <Card title={`Projects (${projects.length})`} right={canCreate && !open
      ? <Btn data-new-project onClick={() => setOpen(true)}>+ New project</Btn> : null}>
      {open && canCreate && <div className="mb-3"><HandoverForm account={account} st={st} dispatch={dispatch} user={user} onDone={() => setOpen(false)} /></div>}
      {projects.length === 0 && <div className="text-sm text-slate-500">No implementation projects.</div>}
      {projects.map(p => (
        <div key={p.id} data-project-row={p.id} data-stage={p.stage} data-type={p.type} className="flex items-center gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0">
          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-600">{IMPL_TYPE_LABEL[p.type] || p.type}</span>
          <span className="flex-1 font-medium">{STAGE_LABEL[p.stage] || p.stage}</span>
          {p.targetGoLive && <span className="text-xs text-slate-500">go-live {fmtDate(p.targetGoLive)}</span>}
        </div>
      ))}
    </Card>
  );
}

function ImplementationPage({ st, dispatch, user }) {
  const [tab, setTab] = useState("Board");
  const projects = st.projects || [];
  const acctName = id => ((st.accounts || []).find(a => a.id === id) || {}).name || "Unknown account";
  const myTasks = (st.projectTasks || []).filter(t => t.ownerId === user.id && t.status !== "done");
  return (
    <Card title="Implementation projects">
      <div className="mb-3 flex gap-2" role="tablist">
        {["Board", "Workload", "My tasks"].map(t => <button key={t} role="tab" aria-selected={tab === t} data-impl-tab={t}
          className={`nm-btn px-3 py-1.5 text-xs font-bold ${tab === t ? "text-indigo-700" : "text-slate-600"}`} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      {tab === "Board" && (projects.length === 0 ? <div className="text-sm text-slate-500">No projects yet.</div>
        : STAGES.map(s => {
          const rows = projects.filter(p => p.stage === s);
          if (!rows.length) return null;
          return <div key={s} data-board-stage={s} className="mb-3">
            <div className="text-xs font-bold uppercase text-slate-500">{STAGE_LABEL[s]} ({rows.length})</div>
            {rows.map(p => <div key={p.id} data-board-project={p.id} className="flex gap-3 py-1 text-sm">
              <span className="flex-1 font-medium">{acctName(p.accountId)}</span>
              <span className="text-xs text-slate-500">{IMPL_TYPE_LABEL[p.type] || p.type}</span></div>)}
          </div>;
        }))}
      {tab === "Workload" && <div className="text-sm text-slate-500">Workload view — coming soon.</div>}
      {tab === "My tasks" && (myTasks.length === 0 ? <div className="text-sm text-slate-500">No open tasks assigned to you.</div>
        : myTasks.map(t => <div key={t.id} className="py-1 text-sm">{t.title}</div>))}
    </Card>
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
          <button title="Remove item" aria-label="Remove item" className="text-xs text-rose-600" onClick={() => save(items.filter(x => x.id !== it.id))}>✕</button>
        </div>
      ))}
      <Btn data-impl-add-item onClick={() => save([...items, { id: uid(), label: "New item", kind: "check", required: false }])}>+ Add item</Btn>
    </Card>
  );
}
