/* ------------------------------ bulk actions ------------------------------ */
const BULK_TITLE = { csm: "Reassign CSM", tier: "Change tier", task: "Add task to each", churn: "Churn accounts", delete: "Delete accounts" };
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

// The modal shell, extracted from BulkDialog so ConfirmDialog cannot drift from it.
// Both the focus-on-open behavior and the capture-phase Escape handling below fix real
// bugs; a second hand-written copy is how one of them silently regresses.
function Modal({ label, onClose, initialFocusRef, children, ...rest }) {
  const dlgRef = useRef(null);
  // Focus the first control from the container rather than a ref on each input: <Select>
  // is a plain function component and does not forward refs, so per-input refs silently
  // did nothing for three of the five bulk kinds.
  useEffect(() => {
    const first = dlgRef.current?.querySelector(FOCUSABLE);
    (initialFocusRef?.current || first)?.focus();
  }, [initialFocusRef]);
  useEffect(() => {
    const h = e => {
      // stopPropagation is required: App registers a window-level Escape that closes the
      // account detail view, so an unguarded Escape would close the dialog AND navigate.
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      // trap Tab inside the modal: without this it walks into the table behind the
      // overlay, which is inert to the eye but not to the keyboard
      const items = [...(dlgRef.current?.querySelectorAll(FOCUSABLE) || [])];
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (!dlgRef.current.contains(active)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", h, true); // capture phase: runs before App's handler
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-scrim/40 pt-[15vh]" onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={label}
           className="nm w-full max-w-md p-4" onClick={e => e.stopPropagation()} {...rest}>
        {children}
      </div>
    </div>
  );
}

// Guards actions in proportion to how reversible they are. Reversible actions do not use
// this at all -- they act immediately and offer an Undo toast, which is safer than a
// dialog people click through reflexively.
function ConfirmDialog({ title, body, confirmLabel = "Confirm", tone = "danger", typedWord, onConfirm, onClose }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef();
  const ready = !typedWord || typed === typedWord;
  const go = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try { await onConfirm(); } finally { onClose(); }
  };
  return (
    <Modal label={title} onClose={onClose} initialFocusRef={typedWord ? inputRef : undefined} data-confirmdialog>
      <h3 className="mb-2 text-sm font-bold text-slate-800">{title}</h3>
      <p className={`text-xs ${tone === "danger" ? "text-rose-700" : "text-slate-600"}`}>{body}</p>
      {typedWord && <label className="mt-3 block text-xs text-slate-700">Type {typedWord} to confirm
        <Input ref={inputRef} value={typed} onChange={e => setTyped(e.target.value)} /></label>}
      <div className="mt-4 flex gap-2">
        <Btn kind="primary" disabled={!ready || busy} data-confirm-go onClick={go}>{confirmLabel}</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}
function BulkDialog({ kind, ids, accounts, team, user, dispatch, onClose }) {
  const toast = useToast();
  // Bulk assignment, not an edit of one existing value -- unlike AddTaskForm/AccountForm
  // (crm.html ~1231, ~1297) there is no single "current" CSM/owner to fold back in: each
  // selected account can already have a different one. So this only needs to keep disabled
  // users out of the choices, not preserve anything.
  const names = team.filter(u => !u.disabled).map(t => t.name).filter(Boolean);
  const [csmVal, setCsmVal] = useState(names[0] || user.name);
  const [tierVal, setTierVal] = useState("Mid");
  const [title, setTitle] = useState(""); const [due, setDue] = useState(iso(Date.now()));
  const [owner, setOwner] = useState(user.name);
  const [reason, setReason] = useState(""); const [note, setNote] = useState("");
  const [date, setDate] = useState(iso(Date.now()));
  const [confirmText, setConfirmText] = useState("");
  const ref = useRef();

  const ready = kind === "churn" ? !!reason
    : kind === "delete" ? confirmText === "DELETE"
    : kind === "task" ? !!title.trim()
    : true;

  const submit = () => {
    if (!ready) return;
    // a selection can go stale between when it was made and when this button is clicked
    // (realtime refetch may have dropped a row out from under it) -- never act on ids
    // that no longer exist.
    const state = window.__store.getState();
    const live = new Set(state.accounts.map(a => a.id));
    const liveIds = ids.filter(id => live.has(id));
    const n = liveIds.length;
    // every selected account vanished -- closing silently would look like success
    if (n === 0) { toast({ text: "Those accounts are no longer available.", tone: "error" }); onClose(); return; }
    if (kind === "task") {
      const items = liveIds.map(id => ({ id: uid(), accountId: id, title: title.trim(), due, owner, status: "Open" }));
      dispatch({ type: "BULK_ADD_TASKS", items });
      const created = new Set(items.map(t => t.id));
      toast({ text: `Added a task to ${n} account${n === 1 ? "" : "s"}.`, tone: "success",
        undo: () => dispatch({ type: "BULK_DELETE_TASKS", ids: [...created] }) });
    } else {
      const snapshot = snapshotFor(state, liveIds);
      // built here (not in the reducer) so the undo callback can name the exact rows to
      // delete: RESTORE_SNAPSHOT merges rather than replaces, so it restores the account
      // to Active but leaves any activity added after the snapshot in place.
      const churnActs = kind !== "churn" ? [] : liveIds.map(id => {
        const a = state.accounts.find(x => x.id === id);
        return { id: uid(), accountId: id, type: "churn", date,
          summary: `Account churned (${reason}${note.trim() ? " — " + note.trim() : ""}) · ${fmtMoney(a.arr, a.currency)} ARR lost · by ${user.name}` };
      });
      if (kind === "csm") dispatch({ type: "BULK_PATCH_ACCOUNTS", ids: liveIds, patch: { csm: csmVal }, by: user.name });
      else if (kind === "tier") dispatch({ type: "BULK_PATCH_ACCOUNTS", ids: liveIds, patch: { tier: tierVal }, by: user.name });
      else if (kind === "churn") dispatch({ type: "BULK_CHURN", ids: liveIds, reason, note, date, by: user.name, activities: churnActs });
      else if (kind === "delete") dispatch({ type: "BULK_DELETE", ids: liveIds });
      const verb = { csm: "Reassigned", tier: "Retiered", churn: "Churned", delete: "Deleted" }[kind];
      toast({ text: `${verb} ${n} account${n === 1 ? "" : "s"}.`, tone: "success",
        undo: () => {
          dispatch({ type: "RESTORE_SNAPSHOT", snapshot });
          if (churnActs.length) dispatch({ type: "BULK_DELETE_ACTIVITIES", ids: churnActs.map(v => v.id) });
        } });
    }
    onClose();
  };

  return (
    <Modal label={BULK_TITLE[kind]} onClose={onClose} initialFocusRef={ref} data-bulkdialog>
        <div className="mb-3 flex items-center">
          <h3 className="flex-1 text-sm font-bold text-slate-800">{BULK_TITLE[kind]} · {ids.length} account{ids.length === 1 ? "" : "s"}</h3>
          <button aria-label="Close dialog" className="text-slate-400 hover:text-slate-700" onClick={onClose}>✕</button>
        </div>
        <div className="flex flex-col gap-2">
          {kind === "csm" && <label className="text-xs text-slate-700">New CSM
            <Select value={csmVal} onChange={e => setCsmVal(e.target.value)} options={names.length ? names : [user.name]} /></label>}
          {kind === "tier" && <label className="text-xs text-slate-700">New tier
            <Select value={tierVal} onChange={e => setTierVal(e.target.value)} options={["Enterprise", "Mid", "SMB"]} /></label>}
          {kind === "task" && <>
            <label className="text-xs text-slate-700">Title<Input ref={ref} value={title} onChange={e => setTitle(e.target.value)} /></label>
            <label className="text-xs text-slate-700">Due<Input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
            <label className="text-xs text-slate-700">Owner
              <Select value={owner} onChange={e => setOwner(e.target.value)} options={names.length ? names : [user.name]} /></label>
          </>}
          {kind === "churn" && <>
            <label className="text-xs text-slate-700">Reason (required)
              <Select value={reason} onChange={e => setReason(e.target.value)} options={["", ...CHURN_REASONS]} /></label>
            <label className="text-xs text-slate-700">Date<Input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
            <label className="text-xs text-slate-700">Note<Input value={note} onChange={e => setNote(e.target.value)} /></label>
            <p className="text-[11px] text-slate-500">One shared reason is written to all {ids.length} accounts.</p>
          </>}
          {kind === "delete" && <>
            <p className="text-xs text-rose-700">This deletes {ids.length} account{ids.length === 1 ? "" : "s"} and all their contacts, activities, tasks and opportunities. Sub-accounts survive but lose their parent.</p>
            <label className="text-xs text-slate-700">Type DELETE to confirm
              <Input ref={ref} value={confirmText} onChange={e => setConfirmText(e.target.value)} /></label>
          </>}
        </div>
        <div className="mt-4 flex gap-2">
          <Btn kind="primary" disabled={!ready} data-bulk-confirm onClick={submit}>Apply</Btn>
          <Btn onClick={onClose}>Cancel</Btn>
        </div>
    </Modal>
  );
}

