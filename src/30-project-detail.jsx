/* ---------------------------- implementation project detail ---------------------------- */
// Header with stage actions, the assign dialog, read-only checklist, task plan with time
// logging, plan templates and history. Function declarations so 29-implementation.jsx can use them.

var TASK_STATUS_LABEL = { todo: "To do", doing: "Doing", done: "Done" };
function implementersOf(st) { return (st.team || []).filter(u => !u.disabled && (u.role === "impl_user" || u.role === "impl_lead")); }
function teamName(st, id) { return ((st.team || []).find(u => u.id === id) || {}).name || "Unassigned"; }
function actorOf(user) { return { id: user.id, role: user.role, name: user.name }; }
function canManageImpl(user) { return user.role === "admin" || user.role === "impl_lead"; }
function canWorkProject(user, p) { return canManageImpl(user) || (!!p.implementerId && p.implementerId === user.id); }

function AssignDialog({ st, project, onAssign, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  const list = workload(implementersOf(st), st.projects || [], st.projectTasks || [], (st.settings && st.settings.implCapacity) || {}, today);
  return (
    <Modal label="Assign implementer" onClose={onClose}>
      <div className="mb-2 text-sm font-bold text-slate-800">Assign implementer</div>
      {list.length === 0 && <div className="text-sm text-slate-500">No active implementers.</div>}
      {list.map(r => (
        <div key={r.id} data-assign-row={r.id} className="flex items-center gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0">
          <span className="flex-1 font-medium">{r.name}</span>
          <span className="text-xs text-slate-500">{r.active} active · {r.remainingHours}h left{r.loadPct !== null ? ` · ${r.loadPct}%` : ""}</span>
          <Btn kind={r.id === project.implementerId ? "primary" : "default"} onClick={() => onAssign(r.id)}>Assign</Btn>
        </div>
      ))}
      <div className="mt-3 flex justify-end"><Btn onClick={onClose}>Close</Btn></div>
    </Modal>
  );
}

function StageButton({ project, tasks, to, actor, account, onGo, label, action }) {
  const r = canTransition(project, tasks, to, actor, account);
  return <Btn data-stage-action={action} disabled={!r.ok} title={r.ok ? label : r.reason} onClick={onGo}>{label}</Btn>;
}

function ProjectDetail({ st, dispatch, user, projectId, onBack }) {
  const project = (st.projects || []).find(p => p.id === projectId);
  const [assignOpen, setAssignOpen] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", estHours: "", due: "" });
  const [logHours, setLogHours] = useState({});
  const [tplName, setTplName] = useState(null);
  const [tplPick, setTplPick] = useState("");
  const [applying, setApplying] = useState(false);
  const [sendBack, setSendBack] = useState(null); // { taskId, note } while a Send back note is being typed
  if (!project) return <div className="text-sm text-slate-500">Project not found. <Btn data-project-back onClick={onBack}>← Back</Btn></div>;
  const account = (st.accounts || []).find(a => a.id === project.accountId) || null;
  const tasks = (st.projectTasks || []).filter(t => t.projectId === project.id).sort((a, b) => (a.order || 0) - (b.order || 0));
  const actor = actorOf(user);
  const now = () => new Date().toISOString();
  const closed = project.stage === "live" || project.stage === "cancelled";
  const canEdit = canWorkProject(user, project) && !closed;
  const manager = canManageImpl(user);
  const templates = (st.settings && st.settings.implPlanTemplates) || [];
  const move = (to, note = "") => dispatch({ type: "SET_PROJECT_STAGE", id: project.id, to, note, actor, now: now() });
  const sb = (to, action, label, onGo) => <StageButton key={action} project={project} tasks={tasks} to={to} actor={actor} account={account}
    action={action} label={label} onGo={onGo || (() => move(to))} />;

  const assign = id => {
    const prev = project.implementerId || null;
    dispatch({ type: "EDIT_PROJECT", id: project.id, patch: { implementerId: id } });
    // open tasks follow the implementer, unless deliberately owned by someone else
    tasks.filter(t => t.status !== "done" && (!t.ownerId || t.ownerId === prev) && t.ownerId !== id)
      .forEach(t => dispatch({ type: "EDIT_PROJECT_TASK", id: t.id, patch: { ownerId: id } }));
    if (project.stage === "queued") move("planning", `Assigned to ${teamName(st, id)}`);
    setAssignOpen(false);
  };
  const nextOrder = () => tasks.reduce((m, t) => Math.max(m, t.order || 0), 0) + 1;
  const addTask = (title, estHours, due, order) => dispatch({ type: "ADD_PROJECT_TASK", item: { id: uid(), projectId: project.id, accountId: project.accountId,
    title, ownerId: project.implementerId, due: due || null, estHours: Number(estHours) || 0, timeLog: [], status: "todo", signoff: "pending",
    signoffNote: "", signedBy: null, signedAt: null, order } });
  const submitTask = e => {
    e.preventDefault();
    if (!newTask.title.trim()) return;
    addTask(newTask.title.trim(), newTask.estHours, newTask.due, nextOrder());
    setNewTask({ title: "", estHours: "", due: "" });
  };
  const log = t => {
    const h = Number(logHours[t.id]);
    if (!(h > 0)) return;
    dispatch({ type: "LOG_TASK_TIME", id: t.id, entry: { by: user.name, at: now(), hours: h } });
    setLogHours(s => ({ ...s, [t.id]: "" }));
  };
  const saveTemplate = () => {
    const name = (tplName || "").trim(); if (!name) return;
    const item = { name, tasks: tasks.map(t => ({ title: t.title, estHours: Number(t.estHours) || 0 })) };
    dispatch({ type: "SET_IMPL_PLAN_TEMPLATES", items: [...templates.filter(x => x.name !== name), item] });
    setTplName(null);
  };
  const applyTemplate = () => {
    const tpl = templates.find(x => x.name === tplPick); if (!tpl || applying) return;
    setApplying(true);
    tpl.tasks.forEach((t, i) => addTask(t.title, t.estHours, null, i + 1));
    setApplying(false);
  };
  // sign-off: only the account's CSM (or an admin), only while in CSM review
  const reviewer = project.stage === "csm_review" && (user.role === "admin" || (!!account && !!account.csm && user.name === account.csm));
  const signoff = (t, verdict, note = "") => dispatch({ type: "SIGNOFF_TASK", taskId: t.id, verdict, note, actor, now: now() });
  const resume = (() => { const h = (project.history || []).slice().reverse().find(e => e.to === "on_hold"); return h ? h.from : null; })();
  const done = tasks.filter(t => t.status === "done").length;

  return (
    <div data-project-detail={project.id} data-stage={project.stage}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Btn data-project-back onClick={onBack}>← Back</Btn>
        <span className="text-base font-bold text-slate-800">{account ? account.name : "Unknown account"}</span>
        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-600">{IMPL_TYPE_LABEL[project.type] || project.type}</span>
        <span data-project-stage className="text-sm font-semibold text-slate-700">{STAGE_LABEL[project.stage] || project.stage}</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-600">
        <span>Implementer: <b data-project-implementer>{project.implementerId ? teamName(st, project.implementerId) : "Unassigned"}</b></span>
        {project.targetGoLive && <span>Target go-live: {fmtDate(project.targetGoLive)}</span>}
        {project.startedAt && <span>Started: {fmtDate(project.startedAt)}</span>}
        {project.liveAt && <span>Live: {fmtDate(project.liveAt)}</span>}
        <span>Tasks done: {done}/{tasks.length}</span>
      </div>
      {canWorkProject(user, project) && !closed && <div className="mb-3 flex flex-wrap gap-2">
        {project.stage === "queued" && (() => {
          const r = canTransition({ ...project, implementerId: project.implementerId || "_" }, tasks, "planning", actor, account);
          return <Btn data-stage-action="assign" kind="primary" disabled={!r.ok} title={r.ok ? "Assign" : r.reason} onClick={() => setAssignOpen(true)}>Assign</Btn>;
        })()}
        {manager && project.stage !== "queued" && project.stage !== "on_hold" && <Btn data-stage-action="reassign" onClick={() => setAssignOpen(true)}>Reassign</Btn>}
        {project.stage === "planning" && sb("in_progress", "start", "Start")}
        {project.stage === "in_progress" && sb("csm_review", "review", "Send for sign-off")}
        {OPEN_STAGES.includes(project.stage) && sb("on_hold", "hold", "Put on hold", () => {
          const reason = window.prompt("Reason for putting on hold?", ""); if (reason !== null) move("on_hold", reason);
        })}
        {project.stage === "on_hold" && resume && sb(resume, "resume", "Resume")}
        {manager && sb("cancelled", "cancel", "Cancel", () => { if (window.confirm("Cancel this project?")) move("cancelled"); })}
      </div>}
      {project.stage === "on_hold" && project.holdReason && <div className="mb-3 text-xs text-amber-700">On hold: {project.holdReason}</div>}
      {assignOpen && <AssignDialog st={st} project={project} onAssign={assign} onClose={() => setAssignOpen(false)} />}

      <div className="mb-3">
        <div className="mb-1 text-xs font-bold uppercase text-slate-500">Plan</div>
        {tasks.length === 0 && <div className="text-sm text-slate-500">No tasks yet.</div>}
        {tasks.map(t => (
          <div key={t.id} data-task-row={t.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0">
            <span className="flex-1 font-medium">{t.title}</span>
            <span className="text-xs text-slate-500">{teamName(st, t.ownerId)}</span>
            {t.due && <span className="text-xs text-slate-500">due {fmtDate(t.due)}</span>}
            <span data-task-logged className="text-xs text-slate-600">{loggedHours(t)}h / {Number(t.estHours) || 0}h</span>
            {canEdit ? <>
              <Select data-task-status value={t.status} aria-label="Task status" options={["todo", "doing", "done"]} labels={TASK_STATUS_LABEL}
                onChange={e => dispatch({ type: "EDIT_PROJECT_TASK", id: t.id, patch: { status: e.target.value } })} />
              <Input data-task-log-hours type="number" min="0" step="0.5" aria-label="Hours to log" className="!w-16" value={logHours[t.id] || ""}
                onChange={e => setLogHours(s => ({ ...s, [t.id]: e.target.value }))} />
              <Btn data-task-log onClick={() => log(t)}>+ hours</Btn>
              <button data-task-delete title="Delete task" aria-label="Delete task" className="text-xs text-rose-600"
                onClick={() => { if (window.confirm(`Delete "${t.title}"?`)) dispatch({ type: "DELETE_PROJECT_TASK", id: t.id }); }}>✕</button>
            </> : <span className="text-xs text-slate-600">{TASK_STATUS_LABEL[t.status] || t.status}</span>}
            {t.signoff === "signed" && <span data-task-signed className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">Signed off{t.signedBy ? ` by ${t.signedBy}` : ""}</span>}
            {reviewer && t.signoff !== "signed" && <>
              <Btn data-task-signoff kind="primary" onClick={() => signoff(t, "signed")}>Sign off</Btn>
              <Btn data-task-sendback onClick={() => setSendBack({ taskId: t.id, note: "" })}>Send back</Btn>
            </>}
            {reviewer && sendBack && sendBack.taskId === t.id && <form className="flex w-full gap-2" onSubmit={e => {
              e.preventDefault(); const note = sendBack.note.trim(); if (!note) return;
              signoff(t, "returned", note); setSendBack(null); }}>
              <Input data-sendback-note placeholder="What needs fixing?" aria-label="Send back note" className="flex-1" value={sendBack.note}
                onChange={e => setSendBack({ taskId: t.id, note: e.target.value })} />
              <Btn data-sendback-confirm type="submit" disabled={!sendBack.note.trim()}>Send back</Btn><Btn onClick={() => setSendBack(null)}>Cancel</Btn>
            </form>}
            {t.signoff === "returned" && t.signoffNote && <div data-task-returned className="w-full text-xs text-rose-700">Returned by CSM: {t.signoffNote}</div>}
          </div>
        ))}
        {canEdit && <form className="mt-2 flex flex-wrap gap-2" onSubmit={submitTask}>
          <Input data-new-task-title placeholder="New task" aria-label="Task title" className="!w-56" value={newTask.title} onChange={e => setNewTask(s => ({ ...s, title: e.target.value }))} />
          <Input data-new-task-hours type="number" min="0" placeholder="Est. h" aria-label="Estimated hours" className="!w-20" value={newTask.estHours} onChange={e => setNewTask(s => ({ ...s, estHours: e.target.value }))} />
          <Input type="date" aria-label="Due date" className="!w-40" value={newTask.due} onChange={e => setNewTask(s => ({ ...s, due: e.target.value }))} />
          <Btn data-new-task-add type="submit">Add task</Btn>
        </form>}
        {canEdit && project.stage === "planning" && tasks.length === 0 && templates.length > 0 && <div className="mt-2 flex gap-2">
          <Select data-template-pick aria-label="Plan template" value={tplPick} onChange={e => setTplPick(e.target.value)}
            options={["", ...templates.map(x => x.name)]} labels={{ "": "Start from template…" }} />
          <Btn data-template-apply disabled={!tplPick || applying} onClick={applyTemplate}>Apply</Btn>
        </div>}
        {manager && tasks.length > 0 && (tplName === null
          ? <div className="mt-2"><Btn data-save-template onClick={() => setTplName("")}>Save as template</Btn></div>
          : <div className="mt-2 flex gap-2">
            <Input data-template-name placeholder="Template name" aria-label="Template name" className="!w-56" value={tplName} onChange={e => setTplName(e.target.value)} />
            <Btn data-template-save kind="primary" disabled={!tplName.trim()} onClick={saveTemplate}>Save</Btn><Btn onClick={() => setTplName(null)}>Cancel</Btn>
          </div>)}
      </div>

      <div className="mb-3">
        <div className="mb-1 text-xs font-bold uppercase text-slate-500">Handover checklist</div>
        {(project.checklistTemplate || []).map(it => {
          const v = (project.checklist || {})[it.id];
          return <div key={it.id} className="flex gap-2 text-sm text-slate-700"><span className="w-64">{it.label}</span>
            <span>{it.kind === "check" ? (v ? "✓" : "—") : (it.kind === "date" && v ? fmtDate(v) : v || "—")}</span></div>;
        })}
      </div>

      <div>
        <div className="mb-1 text-xs font-bold uppercase text-slate-500">History</div>
        {(project.history || []).slice().reverse().map((h, i) => (
          <div key={i} className="text-xs text-slate-600">{fmtDate(h.at)} · {h.by}: {STAGE_LABEL[h.from] || h.from} → {STAGE_LABEL[h.to] || h.to}{h.note ? ` — ${h.note}` : ""}</div>
        ))}
      </div>
    </div>
  );
}
