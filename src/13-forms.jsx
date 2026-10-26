/* ------------------------- account documents ------------------------- */
const DOC_CATEGORIES = ["Contract", "PO", "Advisory", "QBR", "Others"];
const DOC_CATEGORY_PLURAL = { "Contract": "Contracts", "PO": "POs", "Advisory": "Advisories", "QBR": "QBRs", "Others": "Others" };
const EXPIRY_WARN_DAYS = 60;
const EXPIRED_GRACE_DAYS = 30;              // how long an already-expired contract keeps alerting
function DocumentForm({ acct, dispatch, user, onDone, existing }) {
  const fileRef = useRef(null);
  const [category, setCategory] = useState(existing ? existing.category : "");
  const [title, setTitle] = useState(existing ? existing.title || "" : "");
  const [amount, setAmount] = useState(existing && existing.amount != null ? String(existing.amount) : "");
  const [effectiveDate, setEffectiveDate] = useState(existing ? existing.effectiveDate || "" : "");
  const [expiryDate, setExpiryDate] = useState(existing ? existing.expiryDate || "" : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async e => {
    e.preventDefault();
    if (busy) return;
    const files = fileRef.current?.files;
    const hasNewFile = files && files.length;
    if (!category) { setErr("Choose a category."); return; }
    if (!existing && !hasNewFile) { setErr("Choose a file."); return; }
    setBusy(true); setErr("");
    try {
      const meta = { category, title: title.trim(),
        amount: Number.isFinite(+amount) && amount !== "" ? +amount : null, effectiveDate: effectiveDate || null, expiryDate: expiryDate || null };
      if (existing) {
        const patch = { ...meta };
        if (hasNewFile) {
          const [uploaded] = await uploadFiles(files, acct.id);
          patch.name = uploaded.name; patch.url = uploaded.url; patch.path = uploaded.path;
          if (sb && existing.path && existing.path !== uploaded.path) { try { await sb.storage.from("attachments").remove([existing.path]); } catch {} }
        }
        dispatch({ type: "EDIT_DOCUMENT", id: acct.id, docId: existing.id, patch, by: user?.name, source: "edit" });
      } else {
        const [uploaded] = await uploadFiles(files, acct.id);
        const doc = { id: uid(), ...meta, name: uploaded.name, url: uploaded.url, path: uploaded.path,
          uploadedBy: user?.name || "unknown", uploadedAt: iso(Date.now()) };
        dispatch({ type: "ADD_DOCUMENT", id: acct.id, doc, by: user?.name, source: "upload" });
      }
      onDone();
    } catch (ex) { setErr(ex.message || String(ex)); setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={category} onChange={e => setCategory(e.target.value)} required
          className="nm-inset border-0 px-3 py-1.5 text-sm text-slate-800 outline-none">
          <option value="" disabled>Select category…</option>
          {DOC_CATEGORIES.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <Input placeholder="Title (optional)" value={title} onChange={e => setTitle(e.target.value)} />
        <Input type="number" placeholder="Amount (optional)" value={amount} onChange={e => setAmount(e.target.value)} />
        <label className="text-xs text-slate-500">{existing ? `Replace file (optional) — current: ${existing.name}` : "File"}<input ref={fileRef} type="file" className="mt-0.5 block text-xs text-slate-700" /></label>
        <label className="text-xs text-slate-500">Effective<Input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} /></label>
        <label className="text-xs text-slate-500">Expiry<Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></label>
      </div>
      {err && <div className="text-xs font-semibold text-rose-600">{err}</div>}
      <div className="flex gap-2">
        <Btn kind="primary" type="submit">{busy ? (existing ? "Saving…" : "Uploading…") : (existing ? "Save changes" : "Upload document")}</Btn>
        <Btn onClick={onDone}>Cancel</Btn>
      </div>
    </form>
  );
}
function docExpiryBadge(doc) {
  if (doc.category !== "Contract" || !doc.expiryDate) return null;
  const d = daysUntil(doc.expiryDate);
  if (d < 0) return <span className="nm-inset !rounded-full px-2 py-0.5 text-[10px] font-bold text-rose-600">Expired</span>;
  if (d <= EXPIRY_WARN_DAYS) return <span className="nm-inset !rounded-full px-2 py-0.5 text-[10px] font-bold text-amber-600">Expires in {d}d</span>;
  return null;
}
function DocumentsCard({ a, dispatch, user, readOnly }) {
  const toast = useToast();
  const docs = a.documents || [];
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [confirmDoc, setConfirmDoc] = useState(null);
  return (
    <Card title={`Documents (${docs.length})`} right={readOnly ? null : <button className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => { setEditId(null); setAdding(v => !v); }}>{adding ? "Close" : "＋ Add document"}</button>}>
      {adding && <div className="nm-inset mb-3 rounded-xl p-3"><DocumentForm acct={a} user={user} dispatch={dispatch} onDone={() => setAdding(false)} /></div>}
      {docs.length === 0 && !adding && <div className="text-sm text-slate-500">No documents yet.</div>}
      {DOC_CATEGORIES.map(cat => {
        const group = docs.filter(d => d.category === cat);
        if (!group.length) return null;
        return (
          <div key={cat} className="mb-2">
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{DOC_CATEGORY_PLURAL[cat]}</div>
            {group.map(d => (
              <div key={d.id} className="border-b border-slate-100 py-1.5 last:border-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <a data-attachment href={safeUrl(d.url)} target="_blank" rel="noreferrer" onClick={attachmentClick(d)} className="font-medium text-indigo-600 hover:text-indigo-800">📎 {d.title || d.name}</a>
                  {docExpiryBadge(d)}
                  {d.amount != null && <span className="text-xs font-semibold text-slate-700">{fmtMoney(d.amount, a.currency)}</span>}
                  {(d.effectiveDate || d.expiryDate) && <span className="text-xs text-slate-500">{d.effectiveDate ? fmtDate(d.effectiveDate) : "—"} → {d.expiryDate ? fmtDate(d.expiryDate) : "—"}</span>}
                  {!readOnly && <button title="Edit document" aria-label="Edit document" className="ml-auto text-xs text-indigo-500 hover:text-indigo-700"
                    onClick={() => { setAdding(false); setEditId(id => id === d.id ? null : d.id); }}>✎</button>}
                  {!readOnly && <button title="Delete document" aria-label="Delete document" className="text-xs text-rose-500 hover:text-rose-700"
                    onClick={() => setConfirmDoc(d)}>✕</button>}
                </div>
                {editId === d.id && <div className="nm-inset mt-2 rounded-xl p-3"><DocumentForm acct={a} user={user} dispatch={dispatch} existing={d} onDone={() => setEditId(null)} /></div>}
              </div>
            ))}
          </div>
        );
      })}
      {confirmDoc && <ConfirmDialog
        title="Delete document"
        body={`Delete "${confirmDoc.title || confirmDoc.name}"? This permanently removes the file and cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (sb) {
            const { error } = await sb.storage.from("attachments").remove([confirmDoc.path]);
            if (error) { toast({ text: "Could not delete file: " + error.message, tone: "error" }); return; }
          }
          dispatch({ type: "DELETE_DOCUMENT", id: a.id, docId: confirmDoc.id, by: user?.name, source: "delete" });
        }}
        onClose={() => setConfirmDoc(null)} />}
    </Card>
  );
}

function LogActivityForm({ acct, dispatch, onDone, existing }) {
  const toast = useToast();
  const [type, setType] = useState(existing ? existing.type : "call");
  const [summary, setSummary] = useState(existing ? existing.summary : "");
  const [details, setDetails] = useState(existing ? existing.details || "" : "");
  const [kept, setKept] = useState(existing ? existing.attachments || [] : []);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  return (
    <form className="space-y-2" onSubmit={async e => {
      e.preventDefault(); if (!summary.trim() || busy) return;
      setBusy(true);
      try {
        const uploaded = await uploadFiles(fileRef.current.files, acct.id);
        const attachments = [...kept, ...uploaded];
        if (existing) dispatch({ type: "EDIT_ACTIVITY", id: existing.id, patch: { type, summary: summary.trim(), details: details.trim(), attachments } });
        else dispatch({ type: "ADD_ACTIVITY", item: { id: uid(), accountId: acct.id, type, date: iso(Date.now()), summary: summary.trim(), details: details.trim(), attachments } });
        onDone();
      } catch (ex) { toast({ text: "Upload failed: " + ex.message, tone: "error" }); setBusy(false); }
    }}>
      <div className="flex flex-wrap items-center gap-2">
        {existing && <span className="text-xs font-bold text-slate-500">Editing activity from {fmtDate(existing.date)}</span>}
        <Select value={type} onChange={e => setType(e.target.value)} options={["call", "email", "QBR", "ticket", "note", "renewal", "churn"]} />
        <Input autoFocus placeholder="Summary…" value={summary} onChange={e => setSummary(e.target.value)} className="flex-1 min-w-[200px]" />
      </div>
      <KeptAttachments kept={kept} setKept={setKept} />
      <textarea placeholder="Detailed comment (optional)…" value={details} onChange={e => setDetails(e.target.value)} rows={3}
        className="nm-inset w-full border-0 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-500" />
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" multiple className="text-xs text-slate-700 file:nm-btn file:mr-2 file:cursor-pointer file:border-0 file:px-3 file:py-1 file:text-xs file:font-bold file:text-slate-700" />
        <span className="text-[11px] text-slate-500">max {MAX_FILE_MB} MB each</span>
        <span className="ml-auto flex gap-2"><Btn kind="primary" type="submit">{busy ? "Uploading…" : existing ? "Save changes" : "Log"}</Btn><Btn onClick={onDone}>Cancel</Btn></span>
      </div>
    </form>
  );
}
function AddTaskForm({ acct, dispatch, onDone, team = [], user, existing }) {
  const toast = useToast();
  const [title, setTitle] = useState(existing ? existing.title : "");
  const [due, setDue] = useState(existing ? existing.due : addDays(7));
  const [priority, setPriority] = useState(existing ? existing.priority : "Medium");
  const [owner, setOwner] = useState(existing ? existing.owner : user ? user.name : acct.csm);
  const [details, setDetails] = useState(existing ? existing.details || "" : "");
  const [kept, setKept] = useState(existing ? existing.attachments || [] : []);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const owners = [...new Set([user ? user.name : null, ...team.filter(u => !u.disabled).map(u => u.name), acct.csm, existing ? existing.owner : null].filter(Boolean))];
  return (
    <form className="space-y-2" onSubmit={async e => {
      e.preventDefault(); if (!title.trim() || busy) return;
      setBusy(true);
      try {
        const uploaded = await uploadFiles(fileRef.current.files, acct.id);
        const attachments = [...kept, ...uploaded];
        if (existing) dispatch({ type: "EDIT_TASK", id: existing.id, patch: { title: title.trim(), due, priority, owner, details: details.trim(), attachments } });
        else dispatch({ type: "ADD_TASK", item: { id: uid(), accountId: acct.id, title: title.trim(), due, priority, status: "Open", owner, details: details.trim(), attachments } });
        onDone();
      } catch (ex) { toast({ text: "Upload failed: " + ex.message, tone: "error" }); setBusy(false); }
    }}>
      <div className="flex flex-wrap items-center gap-2">
        {existing && <span className="text-xs font-bold text-slate-500">Editing task</span>}
        <Input autoFocus placeholder="Task title…" value={title} onChange={e => setTitle(e.target.value)} className="flex-1 min-w-[200px]" />
        <Input type="date" value={due} onChange={e => setDue(e.target.value)} className="w-auto" />
        <Select value={priority} onChange={e => setPriority(e.target.value)} options={["High", "Medium", "Low"]} />
        <Select value={owner} onChange={e => setOwner(e.target.value)} options={owners} />
      </div>
      <KeptAttachments kept={kept} setKept={setKept} />
      <textarea placeholder="Detailed comment (optional)…" value={details} onChange={e => setDetails(e.target.value)} rows={3}
        className="nm-inset w-full border-0 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-500" />
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" multiple className="text-xs text-slate-700 file:nm-btn file:mr-2 file:cursor-pointer file:border-0 file:px-3 file:py-1 file:text-xs file:font-bold file:text-slate-700" />
        <span className="text-[11px] text-slate-500">max {MAX_FILE_MB} MB each</span>
        <span className="ml-auto flex gap-2"><Btn kind="primary" type="submit">{busy ? "Uploading…" : existing ? "Save changes" : "Add"}</Btn><Btn onClick={onDone}>Cancel</Btn></span>
      </div>
    </form>
  );
}
const CHURN_REASONS = ["Price", "Product fit", "Champion left", "Competitor", "Business closed", "Other"];
function ChurnForm({ acct, user, dispatch, onDone }) {
  const [date, setDate] = useState(iso(Date.now()));
  const [reason, setReason] = useState("Price");
  const [note, setNote] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => {
      e.preventDefault();
      dispatch({ type: "CHURN_ACCOUNT", id: acct.id,
        entry: { date, reason, note: note.trim(), arr: acct.arr, currency: acct.currency, by: user.name } });
      dispatch({ type: "ADD_ACTIVITY", item: { id: uid(), accountId: acct.id, type: "churn", date,
        summary: `Account churned (${reason}${note.trim() ? " — " + note.trim() : ""}) · ${fmtMoney(acct.arr, acct.currency)} ARR lost · by ${user.name}` } });
      onDone();
    }}>
      <label className="text-xs text-slate-700">Churn date<Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" /></label>
      <label className="text-xs text-slate-700">Reason<Select value={reason} onChange={e => setReason(e.target.value)} options={CHURN_REASONS} /></label>
      <Input placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} className="w-56" />
      <button type="submit" className="rounded-full bg-rose-500 px-3.5 py-1.5 text-xs font-bold text-white shadow-md hover:bg-rose-600">Confirm churn — {fmtMoney(acct.arr, acct.currency)} lost</button>
      <Btn onClick={onDone}>Cancel</Btn>
    </form>
  );
}
function UpdateHealthForm({ acct, dispatch, onDone }) {
  const [v, setV] = useState({ ...DEFAULT_INPUTS, ...clampInputs(acct.inputs) });
  const num = (k, min, max) => <label className="text-xs text-slate-700">{k} ({min}–{max})<Input type="number" min={min} max={max} value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })} className="w-20" /></label>;
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); dispatch({ type: "UPDATE_INPUTS", id: acct.id, inputs: { ...v, value: Object.fromEntries(VALUE_ITEMS.map(([k]) => [k, !!(v.value || {})[k]])) } }); onDone(); }}>
      {num("usage", 0, 100)}{num("sentiment", 0, 100)}{num("tickets", 0, 50)}{num("nps", -100, 100)}
      <fieldset className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
        <legend className="mb-1 font-semibold">Value</legend>
        {VALUE_ITEMS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="checkbox" data-value-check={k} checked={!!(v.value || {})[k]}
              onChange={e => setV({ ...v, value: { ...(v.value || {}), [k]: e.target.checked } })} />{label}
          </label>
        ))}
      </fieldset>
      <Btn kind="primary" type="submit">Save</Btn><Btn onClick={onDone}>Cancel</Btn>
    </form>
  );
}

const F = ({ label, children }) => <label className="text-xs text-slate-700">{label}<div>{children}</div></label>;
function AccountForm({ dispatch, onDone, existing, team = [], accounts = [], user, customFields = [] }) {
  const admin = isAdminUser(user);
  const csmOptions = [...new Set(["", ...team.filter(u => !u.disabled).map(u => u.name), ...(existing && existing.csm ? [existing.csm] : []), ...(!admin && !existing && user && user.name ? [user.name] : [])])];
  const leadOptions = team.filter(u => u.role === "lead" && (!u.disabled || (existing && existing.leadId === u.id)));
  const [leadId, setLeadId] = useState(existing && existing.leadId || "");
  const leadChanged = admin && leadId !== (existing && existing.leadId || "");
  const hasSubs = existing && accounts.some(x => x.parentId === existing.id);
  // eligible parents: top-level accounts only (one level deep), never itself
  const parentOptions = accounts.filter(x => !x.parentId && (!existing || x.id !== existing.id));
  const [v, setV] = useState(existing
    ? { name: existing.name, tier: existing.tier, arr: existing.arr, currency: existing.currency || "USD", industry: existing.industry, csm: existing.csm, startDate: existing.startDate, transitionDate: existing.transitionDate || "", renewalDate: existing.renewalDate, contractStatus: existing.contractStatus, modules: existing.modules || "", licenses: existing.licenses || 0, deployedLicenses: existing.deployedLicenses ?? "", dedicatedSupport: !!existing.dedicatedSupport, billingCompleted: !!existing.billingCompleted, billingCompletedDate: existing.billingCompletedDate || "", parentId: existing.parentId || "", qbrFrequency: existing.qbrFrequency || "None", nextQbrDate: existing.nextQbrDate || "", country: existing.country || "", billingEntityId: existing.billingEntityId || "", billingEmail: existing.billingEmail || "", billingAddress: existing.billingAddress || "", customerTaxId: existing.customerTaxId || "", customerState: existing.customerState || "", taxExempt: !!existing.taxExempt, taxExemptNote: existing.taxExemptNote || "" }
    : { name: "", tier: "Enterprise", arr: 0, currency: "USD", industry: "", csm: admin ? "" : (user ? user.name : ""), startDate: iso(Date.now()), transitionDate: "", renewalDate: addDays(365), contractStatus: "Active", modules: "", licenses: 0, deployedLicenses: "", dedicatedSupport: false, billingCompleted: false, billingCompletedDate: "", parentId: "", qbrFrequency: "None", nextQbrDate: "", country: "", billingEntityId: "", billingEmail: "", billingAddress: "", customerTaxId: "", customerState: "", taxExempt: false, taxExemptNote: "" });
  const cfs = activeCustomFields(customFields);
  const initialCv = useRef(null);
  if (!initialCv.current) initialCv.current = Object.fromEntries(cfs.map(d => [d.id, editorValue(d.type, existing && existing.custom ? existing.custom[d.id] : null)]));
  const [cv, setCv] = useState(() => ({ ...initialCv.current }));
  const [csmSince, setCsmSince] = useState(iso(Date.now()));
  const csmChanged = admin && v.csm && v.csm !== (existing ? existing.csm || "" : "");
  const [limitErr, setLimitErr] = useState("");
  const [entities, setEntities] = useState([]);
  const [billingOpen, setBillingOpen] = useState(false);
  useEffect(() => { let live = true; Promise.resolve(sb.from("billing_entities").select("*")).then(r => { if (live && r && r.data) setEntities(r.data); }).catch(() => {}); return () => { live = false; }; }, []);
  const set = (k, val) => setV(s => ({ ...s, [k]: val }));
  return (
    <form className="grid grid-cols-2 gap-3 md:grid-cols-4" onSubmit={e => {
      e.preventDefault(); if (!v.name.trim()) return;
      const clean = { ...v, name: v.name.trim(), arr: +v.arr || 0, modules: v.modules.trim(), licenses: +v.licenses || 0,
        deployedLicenses: v.deployedLicenses === "" || v.deployedLicenses == null ? null : Math.max(0, Math.round(+v.deployedLicenses) || 0),
        billingCompleted: !!v.billingCompleted, billingCompletedDate: v.billingCompleted ? (v.billingCompletedDate || iso(Date.now())) : null,
        transitionDate: v.transitionDate || null,
        parentId: hasSubs ? null : (v.parentId || null), nextQbrDate: v.qbrFrequency === "None" ? "" : v.nextQbrDate,
        billingEmail: v.billingEmail.trim(), billingAddress: v.billingAddress.trim(), customerTaxId: v.customerTaxId.trim(),
        customerState: v.country === "IN" ? v.customerState.trim() : "", taxExemptNote: v.taxExempt ? v.taxExemptNote.trim() : "" };
      // Only fields the user actually changed: a stored value that does not fit the field's type must survive a save.
      const changed = cfs.filter(d => cv[d.id] !== initialCv.current[d.id]);
      if (changed.length) clean.custom = buildCustomPatch(existing && existing.custom, Object.fromEntries(changed.map(d => [d.id, coerceCustomValue(d.type, cv[d.id])])));
      if (csmChanged) clean.csmSince = csmSince || iso(Date.now());
      else if (admin && existing && existing.csm && !v.csm) clean.csmSince = null;
      if (leadChanged) clean.leadId = leadId || null;
      const summary = admin && existing ? csmChangeSummary(existing.csm, clean.csm, user.name) : null;
      const safe = stripOwnerKeys(clean, user);
      if (existing) {
        dispatch({ type: "EDIT_ACCOUNT", id: existing.id, patch: safe, by: user?.name, source: "edit form" });
        if (summary) dispatch({ type: "ADD_ACTIVITY", item: { id: uid(), accountId: existing.id, type: "note", date: iso(Date.now()), summary, system: true } });
      }
      else {
        // `accounts` is every account in the org (churned included), which is what the server counts.
        if (roomLeft(ORG_LIMITS.maxAccounts, accounts.length) < 1) return setLimitErr(limitMessage("accounts", ORG_LIMITS.maxAccounts));
        dispatch({ type: "ADD_ACCOUNT", item: { ...safe, ...(admin ? {} : { csm: user ? user.name : "" }), id: uid(), inputs: { ...DEFAULT_INPUTS }, history: [], inputsUpdatedAt: iso(Date.now()) } });
      }
      onDone();
    }}>
      <F label="Name *"><Input autoFocus value={v.name} onChange={e => set("name", e.target.value)} /></F>
      <F label="Tier"><Select value={v.tier} onChange={e => set("tier", e.target.value)} options={["Enterprise", "Mid", "SMB"]} className="w-full" /></F>
      <F label="ARR"><Input type="number" min="0" value={v.arr} onChange={e => set("arr", e.target.value)} /></F>
      <F label="Billing currency"><Select value={v.currency} onChange={e => set("currency", e.target.value)} options={CURRENCIES} className="w-full" /></F>
      <F label="Industry"><Input value={v.industry} onChange={e => set("industry", e.target.value)} /></F>
      <F label="CSM owner"><select data-csm-select value={v.csm} disabled={!admin} onChange={e => set("csm", e.target.value)}
          className="nm-inset w-full border-0 px-3 py-1.5 text-sm text-slate-800 outline-none disabled:opacity-60">
          {csmOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {!admin && <div data-csm-lock className="mt-0.5 text-[11px] text-slate-500">🔒 Only admins can change this</div>}
      </F>
      <F label="Lead"><select data-lead-select value={leadId} disabled={!admin} onChange={e => setLeadId(e.target.value)}
          className="nm-inset w-full border-0 px-3 py-1.5 text-sm text-slate-800 outline-none disabled:opacity-60">
          <option value=""></option>
          {leadOptions.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {!admin && <div data-lead-lock className="mt-0.5 text-[11px] text-slate-500">🔒 Only admins can change this</div>}
      </F>
      {csmChanged && <F label="CSM since"><Input type="date" data-csm-since value={csmSince} onChange={e => setCsmSince(e.target.value)} /></F>}
      <F label="Start date"><Input type="date" value={v.startDate} onChange={e => set("startDate", e.target.value)} /></F>
      <F label="Transition date (sales → AM)"><Input type="date" data-field="transitionDate" value={v.transitionDate} onChange={e => set("transitionDate", e.target.value)} /></F>
      <F label="Renewal date"><Input type="date" value={v.renewalDate} onChange={e => set("renewalDate", e.target.value)} /></F>
      <F label="Contract status"><Select value={v.contractStatus} onChange={e => set("contractStatus", e.target.value)} options={["Active", "Auto-renew", "In negotiation", "Churn risk"]} className="w-full" /></F>
      <F label="QBR cadence"><Select value={v.qbrFrequency} onChange={e => set("qbrFrequency", e.target.value)} options={QBR_FREQS} className="w-full" /></F>
      {v.qbrFrequency !== "None" && <F label="Next QBR"><Input type="date" value={v.nextQbrDate} onChange={e => set("nextQbrDate", e.target.value)} /></F>}
      <F label="Modules"><Input value={v.modules} onChange={e => set("modules", e.target.value)} placeholder="comma-separated" /></F>
      <F label="Total licenses"><Input type="number" min="0" value={v.licenses} onChange={e => set("licenses", e.target.value)} /></F>
      <F label="Deployed licenses"><Input data-deployed-licenses type="number" min="0" value={v.deployedLicenses} onChange={e => set("deployedLicenses", e.target.value)} /></F>
      {+v.licenses > 0 && v.deployedLicenses !== "" && +v.deployedLicenses > +v.licenses &&
        <div data-overdeployed className="col-span-2 text-xs text-amber-600 md:col-span-4">Deployed is higher than total.</div>}
      <F label="Dedicated support"><Select value={v.dedicatedSupport ? "Yes" : "No"} onChange={e => set("dedicatedSupport", e.target.value === "Yes")} options={["No", "Yes"]} className="w-full" /></F>
      <F label="Billing completed"><Select value={v.billingCompleted ? "Yes" : "No"} onChange={e => set("billingCompleted", e.target.value === "Yes")} options={["No", "Yes"]} className="w-full" /></F>
      {v.billingCompleted && <F label="Billing date"><Input type="date" value={v.billingCompletedDate} onChange={e => set("billingCompletedDate", e.target.value)} /></F>}
      <F label="Parent account">{hasSubs
        ? <div className="py-1.5 text-xs text-slate-500">Has sub-accounts — can't also be a sub.</div>
        : <select value={v.parentId} onChange={e => set("parentId", e.target.value)} className="nm-inset w-full border-0 px-3 py-1.5 text-sm text-slate-800 outline-none">
            <option value="">None (top-level)</option>
            {parentOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>}
      </F>
      {cfs.length > 0 && <div className="col-span-2 mt-1 text-xs font-bold text-slate-700 md:col-span-4">Custom fields</div>}
      {cfs.map(d => {
        const setC = val => setCv(s => ({ ...s, [d.id]: val }));
        const cls = "nm-inset w-full border-0 px-3 py-1.5 text-sm text-slate-800 outline-none";
        if (d.type === "bool") return <label key={d.id} className="flex items-center gap-1 text-xs text-slate-700">
          <input type="checkbox" data-custom-field={d.id} checked={!!cv[d.id]} onChange={e => setC(e.target.checked)} />{d.label}</label>;
        if (d.type === "select") {
          const opts = d.options || [], cur = cv[d.id];
          return <F key={d.id} label={d.label}><select data-custom-field={d.id} value={cur} onChange={e => setC(e.target.value)} className={cls}>
            <option value="">—</option>
            {cur && !opts.includes(cur) && <option value={cur}>{cur}</option>}
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select></F>;
        }
        return <F key={d.id} label={d.label}><Input data-custom-field={d.id} type={d.type === "number" ? "number" : d.type === "date" ? "date" : "text"}
          value={cv[d.id]} onChange={e => setC(e.target.value)} /></F>;
      })}
      <details data-billing-fieldset open={billingOpen} onToggle={e => setBillingOpen(e.currentTarget.open)} className="col-span-2 md:col-span-4">
        <summary className="cursor-pointer text-xs font-bold text-slate-700">Billing</summary>
        <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
          <F label="Country"><Select name="country" value={v.country} onChange={e => set("country", e.target.value)} options={["", "IN", "US", "PH"]} className="w-full" /></F>
          <F label="Billing entity"><select name="billingEntityId" value={v.billingEntityId} onChange={e => set("billingEntityId", e.target.value)} className="nm-inset w-full border-0 px-3 py-1.5 text-sm text-slate-800 outline-none">
            <option value="">Auto from country</option>
            {entities.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
          </select></F>
          <F label="Billing email"><Input name="billingEmail" type="email" onInvalid={() => setBillingOpen(true)} value={v.billingEmail} onChange={e => set("billingEmail", e.target.value)} /></F>
          <F label="Customer tax ID"><Input name="customerTaxId" value={v.customerTaxId} onChange={e => set("customerTaxId", e.target.value)} /></F>
          {v.country === "IN" && <F label="Customer state"><Input name="customerState" value={v.customerState} onChange={e => set("customerState", e.target.value)} /></F>}
          <F label="Billing address"><textarea name="billingAddress" rows={2} value={v.billingAddress} onChange={e => set("billingAddress", e.target.value)} className="nm-inset w-full border-0 px-3 py-1.5 text-sm text-slate-800 outline-none" /></F>
          <label className="flex items-center gap-1 text-xs text-slate-700"><input type="checkbox" name="taxExempt" checked={v.taxExempt} onChange={e => set("taxExempt", e.target.checked)} />Tax exempt</label>
          {v.taxExempt && <F label="Exemption note"><Input name="taxExemptNote" value={v.taxExemptNote} onChange={e => set("taxExemptNote", e.target.value)} /></F>}
        </div>
      </details>
      <div className="col-span-2 flex items-center gap-2 md:col-span-4">
        <Btn kind="primary" type="submit">{existing ? "Save changes" : "Create account"}</Btn><Btn onClick={onDone}>Cancel</Btn>
        {!existing && <span className="text-xs text-slate-500">Health inputs start at usage 70 · sentiment 70 · tickets 0 · NPS 0 — tune them from the account page.</span>}
      </div>
      {limitErr && <div data-limit-error className="col-span-2 text-xs text-rose-600 md:col-span-4">{limitErr}</div>}
    </form>
  );
}
function AddContactForm({ acct, existing, dispatch, onDone }) {
  const [v, setV] = useState(existing
    ? { name: existing.name || "", role: existing.role || "", email: existing.email || "", isChampion: !!existing.isChampion, sentiment: existing.sentiment || "Neutral" }
    : { name: "", role: "", email: "", isChampion: false, sentiment: "Neutral" });
  const set = (k, val) => setV(s => ({ ...s, [k]: val }));
  return (
    <form data-contact-form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); if (!v.name.trim()) return;
      const fields = { ...v, name: v.name.trim(), email: v.email.trim() };
      if (existing) dispatch({ type: "EDIT_CONTACT", id: existing.id, patch: fields });
      else dispatch({ type: "ADD_CONTACT", item: { ...fields, id: uid(), accountId: acct.id } });
      onDone(); }}>
      <Input autoFocus placeholder="Name *" value={v.name} onChange={e => set("name", e.target.value)} className="w-36" />
      <Input placeholder="Role" value={v.role} onChange={e => set("role", e.target.value)} className="w-32" />
      <Input placeholder="Email" type="email" value={v.email} onChange={e => set("email", e.target.value)} className="w-44" />
      <Select value={v.sentiment} onChange={e => set("sentiment", e.target.value)} options={["Positive", "Neutral", "Negative"]} />
      <label className="flex items-center gap-1 text-xs text-slate-700"><input type="checkbox" checked={v.isChampion} onChange={e => set("isChampion", e.target.checked)} />Champion</label>
      <Btn kind="primary" type="submit">{existing ? "Save changes" : "Add"}</Btn><Btn onClick={onDone}>Cancel</Btn>
    </form>
  );
}
function AddOppForm({ acct, dispatch, onDone }) {
  const [v, setV] = useState({ type: "upsell", value: 0, stage: "Discovery", closeDate: addDays(90) });
  const set = (k, val) => setV(s => ({ ...s, [k]: val }));
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault();
      dispatch({ type: "ADD_OPP", item: { ...v, value: +v.value || 0, id: uid(), accountId: acct.id } }); onDone(); }}>
      <Select value={v.type} onChange={e => set("type", e.target.value)} options={["upsell", "cross-sell"]} />
      <Input type="number" min="0" placeholder="Value $" value={v.value} onChange={e => set("value", e.target.value)} className="w-28" />
      <Select value={v.stage} onChange={e => set("stage", e.target.value)} options={["Discovery", "Proposal", "Negotiation", "Stalled", "Won", "Lost"]} />
      <Input type="date" value={v.closeDate} onChange={e => set("closeDate", e.target.value)} className="w-auto" />
      <Btn kind="primary" type="submit">Add</Btn><Btn onClick={onDone}>Cancel</Btn>
    </form>
  );
}

function CompleteRenewalForm({ acct, user, dispatch, onDone }) {
  // addMonths clamps month-ends and is leap-safe; +365*DAY lands a day early whenever the
  // span crosses a leap day (a 2027-03-01 renewal defaulted to 2028-02-29).
  const [newDate, setNewDate] = useState(() => addMonths(acct.renewalDate, 12));
  const [newArr, setNewArr] = useState(acct.arr);
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => {
      e.preventDefault();
      const arr = +newArr || 0;
      dispatch({ type: "COMPLETE_RENEWAL", id: acct.id, newDate, newArr: arr,
        entry: { id: uid(), completedOn: iso(Date.now()), from: acct.renewalDate, to: newDate, prevArr: acct.arr, arr, by: user.name,
          billingCompleted: !!acct.billingCompleted, billingCompletedDate: acct.billingCompletedDate || null } });
      dispatch({ type: "ADD_ACTIVITY", item: { id: uid(), accountId: acct.id, type: "renewal", date: iso(Date.now()),
        summary: `Renewal completed by ${user.name} — ${fmtMoney(arr, acct.currency)} · next renewal ${fmtDate(newDate)}` } });
      onDone();
    }}>
      <label className="text-xs text-slate-700">Renewed until<Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-auto" /></label>
      <label className="text-xs text-slate-700">ARR for new term ({acct.currency})<Input type="number" min="0" value={newArr} onChange={e => setNewArr(e.target.value)} className="w-32" /></label>
      <Btn kind="primary" type="submit">Mark renewed</Btn><Btn onClick={onDone}>Cancel</Btn>
      <span className="text-xs text-slate-500">Logs this renewal, moves the renewal date forward and updates ARR.</span>
    </form>
  );
}

function BillingForm({ acct, user, dispatch, onDone }) {
  const [date, setDate] = useState(iso(Date.now()));
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => {
      e.preventDefault();
      dispatch({ type: "EDIT_ACCOUNT", id: acct.id, patch: { billingCompleted: true, billingCompletedDate: date } });
      dispatch({ type: "ADD_ACTIVITY", item: { id: uid(), accountId: acct.id, type: "note", date, summary: `Billing completed for current term · by ${user.name}` } });
      onDone();
    }}>
      <label className="text-xs text-slate-700">Billing completed on<Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" /></label>
      <Btn kind="primary" type="submit">Mark completed</Btn><Btn onClick={onDone}>Cancel</Btn>
      <span className="text-xs text-slate-500">Resets to pending automatically when the next renewal is completed.</span>
    </form>
  );
}

const ADJUST_REASONS = ["Seat reduction", "Downgrade", "Discount", "Mid-term upsell", "Price increase", "Other"];
function AdjustArrForm({ acct, user, dispatch, onDone }) {
  const [newArr, setNewArr] = useState(acct.arr);
  const [reason, setReason] = useState("Seat reduction");
  const [note, setNote] = useState("");
  const delta = (+newArr || 0) - acct.arr;
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => {
      e.preventDefault();
      if (delta === 0) return onDone();
      const kind = delta > 0 ? "expansion" : "contraction";
      dispatch({ type: "ADJUST_ARR", id: acct.id, newArr: +newArr || 0,
        entry: { id: uid(), date: iso(Date.now()), delta, kind, source: "adjustment", reason, note: note.trim(), by: user.name } });
      dispatch({ type: "ADD_ACTIVITY", item: { id: uid(), accountId: acct.id, type: "note", date: iso(Date.now()),
        summary: `ARR ${delta > 0 ? "increased" : "reduced"} ${fmtMoney(Math.abs(delta), acct.currency)} (${reason}${note.trim() ? " — " + note.trim() : ""}) · now ${fmtMoney(+newArr || 0, acct.currency)} · by ${user.name}` } });
      onDone();
    }}>
      <label className="text-xs text-slate-700">New ARR ({acct.currency})<Input type="number" min="0" value={newArr} onChange={e => setNewArr(e.target.value)} className="w-36" /></label>
      <label className="text-xs text-slate-700">Reason<Select value={reason} onChange={e => setReason(e.target.value)} options={ADJUST_REASONS} /></label>
      <Input placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} className="w-56" />
      <Btn kind="primary" type="submit">{delta === 0 ? "No change" : delta > 0 ? `Book +${fmtMoney(delta, acct.currency)} expansion` : `Book −${fmtMoney(-delta, acct.currency)} reduction`}</Btn>
      <Btn onClick={onDone}>Cancel</Btn>
      <span className="text-xs text-slate-500">Counts toward NRR/GRR immediately (renewals and won opportunities are booked automatically).</span>
    </form>
  );
}

