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

function StageButton({ project, tasks, to, actor, account, onGo, label, action, kind }) {
  const r = canTransition(project, tasks, to, actor, account);
  return <Btn data-stage-action={action} kind={kind} disabled={!r.ok} title={r.ok ? label : r.reason} onClick={onGo}>{label}</Btn>;
}

function ProjectDetail({ st, dispatch, user, projectId, onBack, openAccount }) {
  const project = (st.projects || []).find(p => p.id === projectId);
  const [assignOpen, setAssignOpen] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", estHours: "", due: "" });
  const [logHours, setLogHours] = useState({});
  const [tplName, setTplName] = useState(null);
  const [tplPick, setTplPick] = useState("");
  const [applying, setApplying] = useState(false);
  const [draftVals, setDraftVals] = useState(null); // handover draft edits, null until touched
  const [draftErr, setDraftErr] = useState("");
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
  const sb = (to, action, label, onGo, kind) => <StageButton key={action} project={project} tasks={tasks} to={to} actor={actor} account={account}
    action={action} label={label} kind={kind} onGo={onGo || (() => move(to))} />;

  const assign = id => {
    const prev = project.implementerId || null;
    dispatch({ type: "EDIT_PROJECT", id: project.id, patch: { implementerId: id, assignedAt: now() } });
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

  // header / stat card values (display only)
  const today = iso(Date.now());
  // the board's go-live date rule (Constraint 3), owner-independent: an unassigned project still shows its date severity
  const gTag = boardTag({ ...project, implementerId: project.implementerId || "_" }, today);
  const gSev = gTag && /^Go-live/.test(gTag.text) ? gTag.sev : undefined;
  const gDays = project.targetGoLive ? Math.round((Date.parse(String(project.targetGoLive).slice(0, 10)) - Date.parse(today)) / 86400000) : null;
  const gSub = gDays === null ? "no date set" : project.stage === "live" ? "went live" : gDays < 0 ? `${-gDays}d overdue` : `in ${gDays}d`;
  const estTotal = tasks.reduce((s, t) => s + (Number(t.estHours) || 0), 0);
  const loggedTotal = tasks.reduce((s, t) => s + loggedHours(t), 0);
  const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  const acctName = account ? account.name : "Unknown account";
  const implName = project.implementerId ? teamName(st, project.implementerId) : "Unassigned";
  const csm = account && account.csm ? account.csm : "";
  const subParts = [
    account && <span key="a">Account {openAccount
      ? <button type="button" data-project-account className="ad-link im-link" onClick={() => openAccount(account.id)}>{account.name}</button>
      : <b data-project-account className="ad-link">{account.name}</b>}</span>,
    csm && <span key="c">CSM {csm}</span>,
  ].filter(Boolean);
  const SEV_OF_STATUS = { done: "green", doing: "amber" };

  return (
    <div data-project-detail={project.id} data-stage={project.stage} className="ad-page im-page im-detail">
      <div><button type="button" data-project-back className="ad-back" onClick={onBack}>← Implementation</button></div>

      <section aria-label="Project header" className="ad-card ad-head">
        <span aria-hidden="true" data-avatar className="acct-av ad-av" data-av={avatarSlot(project.accountId)}>{account ? initialsOf(account.name) : "?"}</span>
        <div className="ad-ident">
          <div className="im-title-row">
            <h1 className="ad-h1">{acctName}</h1>
            <span className="im-type">{IMPL_TYPE_LABEL[project.type] || project.type}</span>
            <span data-project-stage className="im-stage"><span aria-hidden="true" className="im-dot" style={{ background: BOARD_DOT[project.stage] }} />{STAGE_LABEL[project.stage] || project.stage}</span>
          </div>
          {subParts.length > 0 && <p data-project-sub className="ad-sub">{subParts.map((p, i) => <React.Fragment key={i}>{i > 0 && " · "}{p}</React.Fragment>)}</p>}
          {project.stage === "on_hold" && project.holdReason && <p className="im-hold">On hold: {project.holdReason}</p>}
        </div>
        {canWorkProject(user, project) && !closed && <div className="ad-actions im-actions">
          {project.stage === "queued" && (() => {
            const r = canTransition({ ...project, implementerId: project.implementerId || "_" }, tasks, "planning", actor, account);
            return <Btn data-stage-action="assign" kind="primary" disabled={!r.ok} title={r.ok ? "Assign" : r.reason} onClick={() => setAssignOpen(true)}>Assign</Btn>;
          })()}
          {project.stage === "planning" && sb("in_progress", "start", "Start", undefined, "primary")}
          {project.stage === "in_progress" && sb("csm_review", "review", "Send for sign-off", undefined, "primary")}
          {project.stage === "on_hold" && resume && sb(resume, "resume", "Resume", undefined, "primary")}
          {manager && project.stage !== "queued" && project.stage !== "on_hold" && <Btn data-stage-action="reassign" onClick={() => setAssignOpen(true)}>Reassign</Btn>}
          {OPEN_STAGES.includes(project.stage) && sb("on_hold", "hold", "Put on hold", () => {
            const reason = window.prompt("Reason for putting on hold?", ""); if (reason !== null) move("on_hold", reason);
          })}
          {manager && sb("cancelled", "cancel", "Cancel", () => { if (window.confirm("Cancel this project?")) move("cancelled"); })}
        </div>}
      </section>
      {assignOpen && <AssignDialog st={st} project={project} onAssign={assign} onClose={() => setAssignOpen(false)} />}

      <section aria-label="Key dates" className="ad-stats">
        <div data-project-stat="implementer" className="ad-card ad-stat">
          <span aria-hidden="true" className="ad-stat-tile">{project.implementerId ? initialsOf(implName) : "—"}</span>
          <div className="im-stat-body"><div className="ad-stat-label">Implementer</div>
            <div className="ad-stat-value im-stat-value" data-project-implementer>{implName}</div>
            <div className="ad-stat-sub">{project.assignedAt ? `assigned ${imMonthDay(project.assignedAt)}` : "not assigned yet"}</div></div>
        </div>
        <div data-project-stat="golive" data-sev={gSev} className="ad-card ad-stat">
          <span aria-hidden="true" className="ad-stat-tile">G</span>
          <div className="im-stat-body"><div className="ad-stat-label">Target go-live</div>
            <div className="ad-stat-value im-stat-value">{project.targetGoLive ? fmtDate(String(project.targetGoLive).slice(0, 10) + "T00:00:00") : "Not set"}</div>
            <div className="ad-stat-sub">{gSub}</div></div>
        </div>
        <div data-project-stat="progress" className="ad-card ad-stat">
          <span aria-hidden="true" className="ad-stat-tile">✓</span>
          <div className="im-stat-body"><div className="ad-stat-label">Progress</div>
            <div className="ad-stat-value im-stat-value">{done}/{tasks.length} tasks</div>
            <div className="ad-stat-sub">{loggedTotal}h logged of {estTotal}h est.</div>
            <span role="img" aria-label={`${pct}% of tasks done`} className="im-bar im-stat-bar"><span style={{ width: pct + "%" }} /></span></div>
        </div>
        <div data-project-stat="started" className="ad-card ad-stat">
          <span aria-hidden="true" className="ad-stat-tile">S</span>
          <div className="im-stat-body"><div className="ad-stat-label">Started</div>
            <div className="ad-stat-value im-stat-value">{project.startedAt ? fmtDate(project.startedAt) : "Not started"}</div>
            <div className="ad-stat-sub">{project.liveAt ? `Live ${fmtDate(project.liveAt)}` : "not live yet"}</div></div>
        </div>
      </section>

      <div className="im-cols">
        <section aria-label="Plan" data-project-plan className="ad-card im-dcard im-plan">
          <div className="im-dcard-head">
            <h2 className="im-h2">Plan <span className="im-h2-meta">({done}/{tasks.length} done · {loggedTotal}h / {estTotal}h)</span></h2>
            {manager && tasks.length > 0 && tplName === null && <Btn data-save-template onClick={() => setTplName("")}>Save as template</Btn>}
          </div>
          {manager && tasks.length > 0 && tplName !== null && <div className="mb-2 flex flex-wrap gap-2">
            <Input data-template-name placeholder="Template name" aria-label="Template name" className="!w-56" value={tplName} onChange={e => setTplName(e.target.value)} />
            <Btn data-template-save kind="primary" disabled={!tplName.trim()} onClick={saveTemplate}>Save</Btn><Btn onClick={() => setTplName(null)}>Cancel</Btn>
          </div>}
          {tasks.length === 0 && <div className="im-empty">No tasks yet.</div>}
          {tasks.map(t => {
            const lg = loggedHours(t), est = Number(t.estHours) || 0, over = est > 0 && lg > est;
            return (
              <div key={t.id} data-task-row={t.id} className="im-task">
                <span data-task-pill data-st={t.status} data-sev={SEV_OF_STATUS[t.status]} className="ad-pill ad-pill-sm im-task-pill">{TASK_STATUS_LABEL[t.status] || t.status}</span>
                <div className="im-task-main">
                  <div className="im-task-title">{t.title}</div>
                  <div className="im-task-meta">{teamName(st, t.ownerId)}{t.due ? ` · due ${imMonthDay(t.due)}` : ""}</div>
                  {t.signoff === "returned" && t.signoffNote && <div data-task-returned className="im-task-note">Returned by CSM: {t.signoffNote}</div>}
                </div>
                <span data-task-logged data-over={over ? "true" : undefined} className="im-hours">{lg}h / {est}h</span>
                {canEdit && <>
                  <Select data-task-status value={t.status} aria-label="Task status" options={["todo", "doing", "done"]} labels={TASK_STATUS_LABEL}
                    onChange={e => dispatch({ type: "EDIT_PROJECT_TASK", id: t.id, patch: { status: e.target.value } })} />
                  <Input data-task-log-hours type="number" min="0" step="0.5" aria-label="Hours to log" className="!w-16" value={logHours[t.id] || ""}
                    onChange={e => setLogHours(s => ({ ...s, [t.id]: e.target.value }))} />
                  <Btn data-task-log onClick={() => log(t)}>+ hours</Btn>
                  <button data-task-delete title="Delete task" aria-label={`Delete task ${t.title}`} className="im-del"
                    onClick={() => { if (window.confirm(`Delete "${t.title}"?`)) dispatch({ type: "DELETE_PROJECT_TASK", id: t.id }); }}>✕</button>
                </>}
                {t.signoff === "signed" && <span data-task-signed data-sev="green" className="ad-pill ad-pill-sm">Signed off{t.signedBy ? ` by ${t.signedBy}` : ""}</span>}
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
              </div>
            );
          })}
          {canEdit && <form className="im-addtask" onSubmit={submitTask}>
            <Input data-new-task-title placeholder="New task" aria-label="Task title" className="im-addtask-title" value={newTask.title} onChange={e => setNewTask(s => ({ ...s, title: e.target.value }))} />
            <Input data-new-task-hours type="number" min="0" placeholder="Est. h" aria-label="Estimated hours" className="!w-20" value={newTask.estHours} onChange={e => setNewTask(s => ({ ...s, estHours: e.target.value }))} />
            <Input type="date" aria-label="Due date" className="!w-40" value={newTask.due} onChange={e => setNewTask(s => ({ ...s, due: e.target.value }))} />
            <Btn data-new-task-add kind="primary" type="submit">Add task</Btn>
          </form>}
          {canEdit && project.stage === "planning" && tasks.length === 0 && templates.length > 0 && <div className="im-tplpick mt-2 flex flex-wrap gap-2">
            <Select data-template-pick aria-label="Plan template" value={tplPick} onChange={e => setTplPick(e.target.value)}
              options={["", ...templates.map(x => x.name)]} labels={{ "": "Start from template…" }} />
            <Btn data-template-apply disabled={!tplPick || applying} onClick={applyTemplate}>Apply</Btn>
          </div>}
        </section>

        <div className="im-side">
          <section aria-label="Handover checklist" data-project-checklist className="ad-card im-dcard">
            <h2 className="im-h2 im-h2-gap">Handover checklist</h2>
            {project.stage === "handover" && canCreateHandover(user) ? (() => {
              const template = project.checklistTemplate || [];
              const values = draftVals || project.checklist || {};
              const dateItem = template.find(it => it.kind === "date" && it.id === "go_live_target") || template.find(it => it.kind === "date");
              const patchOf = () => ({ checklist: values, targetGoLive: (dateItem && values[dateItem.id]) || null,
                missing: checklistFilled({ ...project, checklist: values }).map(m => m.label || m.id) });
              const submit = () => {
                const r = canTransition({ ...project, checklist: values }, tasks, "queued", actor, account);
                if (!r.ok) { setDraftErr(r.reason); return; }
                setDraftErr("");
                dispatch({ type: "EDIT_PROJECT", id: project.id, patch: { ...patchOf(), missing: [] } });
                move("queued", "Handover submitted");
              };
              return <div data-draft-checklist className="space-y-2">
                <ChecklistFields template={template} values={values} set={(k, v) => { setDraftErr(""); setDraftVals({ ...values, [k]: v }); }} />
                {draftErr && <div data-submit-handover-reason role="alert" className="text-sm font-semibold text-rose-600">{draftErr}</div>}
                <div className="flex flex-wrap gap-2">
                  <Btn data-save-draft onClick={() => dispatch({ type: "EDIT_PROJECT", id: project.id, patch: patchOf() })}>Save draft</Btn>
                  <Btn data-submit-handover kind="primary" onClick={submit}>Submit handover</Btn>
                </div>
              </div>;
            })() : (project.checklistTemplate || []).length === 0 ? <div className="im-empty">No checklist items.</div>
              : (project.checklistTemplate || []).map(it => {
                const v = (project.checklist || {})[it.id];
                return <div key={it.id} className="im-kv"><span className="im-kv-k">{it.label}</span>
                  <b className="im-kv-v">{it.kind === "check" ? (v ? "✓ Yes" : "—") : (it.kind === "date" && v ? fmtDate(v) : v || "—")}</b></div>;
              })}
          </section>
          <section aria-label="History" className="ad-card im-dcard">
            <h2 className="im-h2 im-h2-gap">History</h2>
            {(project.history || []).length === 0 && <div className="im-empty">No history yet.</div>}
            {(project.history || []).slice().reverse().map((h, i) => (
              <div key={i} data-history-row className="im-hist">
                <span aria-hidden="true" className="im-hist-dot" />
                <div className="im-hist-body"><div className="im-hist-move">{STAGE_LABEL[h.from] || h.from} → {STAGE_LABEL[h.to] || h.to}</div>
                  <div className="im-hist-meta">{[fmtDate(h.at), h.by, h.note].filter(Boolean).join(" · ")}</div></div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
