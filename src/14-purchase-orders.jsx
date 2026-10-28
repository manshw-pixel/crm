/* --------------------------- purchase orders --------------------------- */
// Integer-cent sums, shifting the decimal as text so 1.005 does not drift (same trick as lib/invoice.js).
const poCents = n => { const x = Number(n); const c = Math.round(Number(x + "e2")); return Number.isFinite(c) ? c : Math.round((x || 0) * 100); };
const PO_CYCLES = ["quarterly", "half_yearly", "annual"];
const PO_CYCLE_LABEL = { quarterly: "Quarterly", half_yearly: "Half-yearly", annual: "Annual" };
const PO_PILL = { submitted: "bg-amber-50 text-amber-700", approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700", cancelled: "bg-slate-100 text-slate-600" };
const poStatusLabel = po => po.status === "submitted" ? "Awaiting approval" : po.status === "approved" ? "Approved"
  : po.status === "rejected" ? `Rejected — ${po.reject_reason || "no reason given"}` : "Cancelled";
const poMoney = (cur, n) => `${cur} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

function usePurchaseOrders(filter) {
  const [state, setState] = useState({ pos: [], schedule: [], loading: true, error: "" });
  const accountId = filter && filter.accountId, status = filter && filter.status;
  const reload = useCallback(async () => {
    let q = sb.from("purchase_orders").select("*").order("created_at", { ascending: false });
    if (accountId) q = q.eq("account_id", accountId);
    if (status) q = q.eq("status", status);
    const po = await q;
    const pos = po.data || [];
    let schedule = [], serr = null;
    if (pos.length) {
      const s = await sb.from("po_schedule").select("*").in("po_id", pos.map(p => p.id)).order("seq", { ascending: true });
      schedule = s.data || []; serr = s.error;
    }
    setState({ pos, schedule, loading: false, error: (po.error || serr)?.message || "" });
  }, [accountId, status]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

async function viewPOFile(po) {
  const { data, error } = await sb.storage.from("purchase-orders").createSignedUrl(po.file_path, 60);
  if (error) return invToast(error.message, "error");
  window.open(data.signedUrl, "_blank", "noopener");
}

async function savePO({ account, existing, file, v, orgId }) {
  let file_path = existing?.file_path;
  if (file) {
    if (file.size > 10 * 1024 * 1024) throw new Error("PO file is over 10 MB.");
    if (!orgId) throw new Error("No workspace: cannot upload");
    file_path = `${orgId}/${account.id}/${crypto.randomUUID()}.${(file.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf"}`;
    const up = await sb.storage.from("purchase-orders").upload(file_path, file, { contentType: file.type || "application/pdf" });
    if (up.error) throw up.error;
  }
  const row = { account_id: account.id, account_name: account.name, po_number: v.po_number.trim(), po_date: v.po_date,
    po_value: Number(v.po_value), currency: v.currency, years: Number(v.years), billing_cycle: v.billing_cycle,
    billing_start: v.billing_start, file_path, status: "submitted", reviewed_by: null, reject_reason: null };
  const q = existing ? sb.from("purchase_orders").update(row).eq("id", existing.id) : sb.from("purchase_orders").insert(row);
  const { data, error } = await q.select().single();
  if (error) throw new Error(/purchase_orders_live_number/.test(error.message) ? `PO ${row.po_number} already exists on this account.` : error.message);
  return data;
}

function POForm({ account, user, existing, onClose, onSaved }) {
  const today = invToday();
  const [file, setFile] = useState(null);
  const [v, setV] = useState(() => existing ? { po_number: existing.po_number, po_date: existing.po_date, po_value: String(existing.po_value),
      currency: existing.currency, years: String(existing.years), billing_cycle: existing.billing_cycle, billing_start: existing.billing_start }
    : { po_number: "", po_date: today, po_value: "", currency: ["INR", "USD", "PHP"].includes(account.currency) ? account.currency : "INR",
      years: "1", billing_cycle: "annual", billing_start: today });
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const set = k => e => setV(p => ({ ...p, [k]: e.target.value }));
  const yrs = Number(v.years), yearsOk = Number.isInteger(yrs) && yrs >= 1 && yrs <= 10;
  const preview = yearsOk ? buildSchedule(v) : [];
  const ok = (file || existing) && v.po_number.trim() && v.po_date && preview.length > 0;
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const saved = await savePO({ account, existing, file, v, orgId: (user && user.org_id) || CURRENT_ORG });
      invToast(existing ? `PO ${saved.po_number} resubmitted` : `PO ${saved.po_number} submitted for approval`, "success");
      onSaved && onSaved(saved); onClose();
    } catch (e) { setErr(e.message || String(e)); setBusy(false); }
  };
  return (
    <Modal label={existing ? "Edit purchase order" : "Submit purchase order"} onClose={onClose}>
      <h3 className="mb-2 text-sm font-bold text-slate-800">{existing ? `Edit PO ${existing.po_number}` : "Submit a purchase order"}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-slate-700 sm:col-span-2">PO document (PDF or image, max 10 MB){existing && !file ? " — leave empty to keep the current file" : ""}
          <input type="file" data-po-file accept=".pdf,image/*" onChange={e => setFile(e.target.files[0] || null)} className="mt-1 block w-full text-xs" /></label>
        <label className="block text-xs text-slate-700">PO number<Input name="po_number" value={v.po_number} onChange={set("po_number")} /></label>
        <label className="block text-xs text-slate-700">PO date<Input type="date" name="po_date" value={v.po_date} onChange={set("po_date")} /></label>
        <label className="block text-xs text-slate-700">PO value<Input type="number" min="0" step="0.01" name="po_value" value={v.po_value} onChange={set("po_value")} /></label>
        <label className="block text-xs text-slate-700">Currency<Select name="currency" options={["INR", "USD", "PHP"]} value={v.currency} onChange={set("currency")} className="w-full" /></label>
        <label className="block text-xs text-slate-700">Years<Input type="number" min="1" max="10" step="1" name="years" value={v.years} onChange={set("years")} /></label>
        <label className="block text-xs text-slate-700">Billing cycle<Select name="billing_cycle" options={PO_CYCLES} labels={PO_CYCLE_LABEL} value={v.billing_cycle} onChange={set("billing_cycle")} className="w-full" /></label>
        <label className="block text-xs text-slate-700">First billing date<Input type="date" name="billing_start" value={v.billing_start} onChange={set("billing_start")} /></label>
      </div>
      <div data-po-preview className="mt-3 max-h-48 overflow-auto text-xs">
        {preview.length === 0 ? <div className="text-slate-500">Enter value, years, cycle and start date{v.years !== "" && !yearsOk ? " (years must be a whole number from 1 to 10)" : ""}</div>
          : <table className="w-full"><thead><tr className="text-left text-slate-500"><th className="p-1">Period</th><th className="p-1">From</th><th className="p-1">To</th><th className="p-1 text-right">Amount</th></tr></thead>
            <tbody>{preview.map(r => <tr key={r.seq} data-period={r.seq} className="border-t border-slate-100">
              <td className="p-1">{periodLabel(v, r)}</td><td className="p-1 tabular-nums">{r.period_start}</td><td className="p-1 tabular-nums">{r.period_end}</td>
              <td className="p-1 text-right tabular-nums">{poMoney(v.currency, r.amount)}</td></tr>)}</tbody></table>}
      </div>
      {err && <div className="mt-2 text-xs text-rose-600" data-po-error>{err}</div>}
      <div className="mt-4 flex gap-2">
        <Btn kind="primary" data-po-submit-confirm disabled={!ok || busy} onClick={submit}>{existing ? "Resubmit" : "Submit for approval"}</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}

function POReview({ po, user, schedule, onClose, onDone }) {
  const fin = canFinance(user);
  const base = useMemo(() => buildSchedule(po), [po]);
  const [amounts, setAmounts] = useState(() => base.map(r => String(r.amount)));
  const [mismatchOk, setMismatchOk] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [cancelling, setCancelling] = useState(false);
  const total = amounts.reduce((s, a) => s + poCents(a), 0);
  const mismatch = total !== poCents(po.po_value);
  const edited = amounts.some((a, i) => poCents(a) !== poCents(base[i].amount));
  const twoDp = a => /^\d+(\.\d{1,2})?$/.test(String(a).trim());
  const badDp = amounts.some(a => String(a).trim() !== "" && !twoDp(a));
  const valid = !badDp && amounts.every(a => poCents(a) > 0);
  const act = async (fn, args, msg) => {
    setBusy(true);
    const { error } = await sb.rpc(fn, args);
    if (error) { invToast(error.message, "error"); setBusy(false); return false; }
    invToast(msg, "success"); onDone && onDone(); onClose(); return true;
  };
  const mine = (schedule || []).filter(s => s.po_id === po.id), unraised = mine.filter(s => !s.invoice_id).length;
  return (
    <Modal label={`Review PO ${po.po_number}`} onClose={onClose}>
      <h3 className="mb-1 text-sm font-bold text-slate-800">PO {po.po_number} — {po.account_name}</h3>
      <div className="mb-2 text-xs text-slate-600">{poMoney(po.currency, po.po_value)} · {po.years} yr · {PO_CYCLE_LABEL[po.billing_cycle]} from {po.billing_start}
        {" "}<button data-po-view-file className="text-indigo-600 hover:underline" onClick={() => viewPOFile(po)}>View PO file</button></div>
      {po.status === "submitted" && fin && <>
        <div className="max-h-56 overflow-auto text-xs"><table className="w-full"><thead><tr className="text-left text-slate-500"><th className="p-1">Period</th><th className="p-1">From</th><th className="p-1">To</th><th className="p-1 text-right">Amount</th></tr></thead>
          <tbody>{base.map((r, i) => <tr key={r.seq} className="border-t border-slate-100">
            <td className="p-1">{periodLabel(po, r)}</td><td className="p-1 tabular-nums">{r.period_start}</td><td className="p-1 tabular-nums">{r.period_end}</td>
            <td className="p-1 text-right"><input data-po-amount type="number" step="0.01" min="0" aria-label={`Amount ${periodLabel(po, r)}`} value={amounts[i]}
              onChange={e => { const x = e.target.value; setAmounts(a => a.map((y, j) => j === i ? x : y)); setMismatchOk(false); }}
              className="nm-inset w-28 px-2 py-1 text-right text-xs tabular-nums outline-none" /></td></tr>)}</tbody></table></div>
        <div className="mt-2 text-xs text-slate-700">Total <span data-po-amount-total className="font-semibold tabular-nums">{poMoney(po.currency, total / 100)}</span> of {poMoney(po.currency, po.po_value)}</div>
        {badDp && <div data-po-amount-error className="mt-1 text-xs text-rose-600">Amounts can have at most 2 decimal places.</div>}
        {mismatch && !badDp && <label data-po-mismatch className="mt-1 block rounded bg-amber-50 p-2 text-xs text-amber-800">
          The amounts do not add up to the PO value ({poMoney(po.currency, (total - poCents(po.po_value)) / 100)} difference).
          <span className="mt-1 flex items-center gap-2"><input type="checkbox" data-po-mismatch-ok checked={mismatchOk} onChange={e => setMismatchOk(e.target.checked)} /> Approve anyway</span></label>}
        <div className="mt-3 flex gap-2">
          <Btn kind="primary" data-po-approve disabled={busy || !valid || (mismatch && !mismatchOk)}
            onClick={() => act("approve_po", { p_id: po.id, p_amounts: edited ? amounts.map(a => Number(String(a).trim())) : null, p_confirm_mismatch: mismatch && mismatchOk }, `PO ${po.po_number} approved`)}>Approve</Btn>
        </div>
        <div className="mt-4 border-t border-slate-100 pt-3">
          <label className="block text-xs text-slate-700">Reject reason (required)
            <textarea data-po-reject-reason rows={2} value={reason} onChange={e => setReason(e.target.value)} className="nm-inset w-full px-3 py-1.5 text-sm text-slate-800 outline-none" /></label>
          <Btn data-po-reject disabled={busy || !reason.trim()} onClick={() => act("reject_po", { p_id: po.id, p_reason: reason.trim() }, `PO ${po.po_number} rejected`)}>Reject</Btn>
        </div></>}
      {po.status !== "submitted" && <div className="text-xs text-slate-600">{poStatusLabel(po)}</div>}
      {fin && po.status === "approved" && <div className="mt-3"><Btn data-po-cancel onClick={() => setCancelling(true)}>Cancel PO</Btn></div>}
      <div className="mt-4"><Btn onClick={onClose}>Close</Btn></div>
      {cancelling && <ConfirmDialog title={`Cancel PO ${po.po_number}?`} body={`Removes ${unraised} un-raised period${unraised === 1 ? "" : "s"}. Invoices already raised are kept.`}
        confirmLabel="Cancel PO" onClose={() => setCancelling(false)}
        onConfirm={async () => { await act("cancel_po", { p_id: po.id }, `PO ${po.po_number} cancelled`); }} />}
    </Modal>
  );
}

// Below sm each row is a card (PO + status, account, value + term, then actions), as InvoiceTable does.
// compact (the Finance queue): account over PO number, value, term and actions only; status stays as a hidden hook.
function PORow({ po, schedule, user, account, showAccount, openAccount, onEdit, onReview, compact }) {
  const fin = canFinance(user);
  const mine = schedule.filter(s => s.po_id === po.id), raised = mine.filter(s => s.invoice_id).length;
  const canEdit = po.submitted_by === user.id && (po.status === "submitted" || po.status === "rejected");
  const acct = <button className="text-left text-indigo-600 hover:underline" onClick={() => openAccount(po.account_id)}>{po.account_name}</button>;
  const value = <><span className="mr-1 text-xs text-slate-400">{po.currency}</span>{Number(po.po_value).toLocaleString(undefined, { minimumFractionDigits: 2 })}</>;
  const actions = <div className="flex flex-wrap justify-end gap-1.5 whitespace-nowrap">
    <MiniBtn data-po-file-link onClick={() => viewPOFile(po)}>File</MiniBtn>
    {canEdit && onEdit && <MiniBtn data-po-edit onClick={() => onEdit(po)}>Edit</MiniBtn>}
    {fin && (po.status === "submitted" || po.status === "approved") && <MiniBtn data-po-review onClick={() => onReview(po)}>{po.status === "submitted" ? "Review" : "Manage"}</MiniBtn>}
  </div>;
  const status = <span data-po-status className={`rounded px-1.5 py-0.5 text-xs font-semibold ${PO_PILL[po.status]}`}>{poStatusLabel(po)}</span>;
  const invoiced = po.status === "approved" ? `${raised} of ${mine.length} raised` : "";
  if (compact) return <tr data-po-row={po.po_number} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-t border-slate-100 py-2.5 first:border-t-0 sm:table-row sm:py-0">
    <td className={`${IT_CELL} col-span-2 min-w-0`}><div className="truncate font-medium">{showAccount ? acct : po.po_number}</div>
      <div className="text-xs text-slate-500">PO {po.po_number}</div><span className="sr-only">{status}<span data-po-invoiced>{invoiced}</span></span></td>
    <td className={`${IT_CELL} whitespace-nowrap tabular-nums sm:text-right`}>{value}</td>
    <td className={`${IT_CELL} whitespace-nowrap text-right text-xs text-slate-500 sm:text-left`}>{po.years} yr · {PO_CYCLE_LABEL[po.billing_cycle]}</td>
    <td className={`${IT_CELL} col-span-2`}>{actions}</td></tr>;
  return <tr data-po-row={po.po_number} className="grid grid-cols-2 items-center gap-x-3 gap-y-1.5 border-t border-slate-100 py-3 first:border-t-0 sm:table-row sm:py-0">
    <td className={`${IT_CELL} order-1 font-medium text-slate-800`}>{po.po_number}</td>
    {showAccount && <td className={`${IT_CELL} order-3 col-span-2 min-w-0 truncate`}>{acct}</td>}
    <td className={`${IT_CELL} hidden whitespace-nowrap tabular-nums text-slate-600`}>{invDate(po.po_date)}</td>
    <td className={`${IT_CELL} order-4 whitespace-nowrap tabular-nums sm:text-right`}>{value}</td>
    <td className={`${IT_CELL} order-5 whitespace-nowrap text-right text-xs text-slate-500 sm:text-left`}>{po.years} yr · {PO_CYCLE_LABEL[po.billing_cycle]}</td>
    <td className={`${IT_CELL} order-2 min-w-0 text-right sm:text-left`}>{status}</td>
    <td className={`${IT_CELL} order-6 text-xs text-slate-500`} data-po-invoiced>{invoiced}</td>
    <td className={`${IT_CELL} order-7`}>{actions}</td></tr>;
}

function POTable({ pos, schedule, user, error, showAccount, openAccount, onEdit, onReview, emptyText, compact }) {
  if (error) return <div className="p-4 text-sm text-rose-600" data-po-load-error>Could not load purchase orders: {error}</div>;
  if (!pos.length) return <div className="p-4 text-sm text-slate-500" data-po-empty>{emptyText}</div>;
  const th = "p-2 font-semibold";
  return <div className="sm:overflow-x-auto"><table className="block w-full text-sm sm:table">
    <thead className="hidden sm:table-header-group"><tr className="border-b border-slate-200 text-left text-xs text-slate-500">{compact
      ? <><th className={th}>{showAccount ? "Account / PO" : "PO"}</th><th className={`${th} text-right`}>Value</th><th className={th}>Term</th><th className={th}><span className="sr-only">Actions</span></th></>
      : <><th className={th}>PO</th>{showAccount && <th className={th}>Account</th>}<th className={th}>Date</th>
        <th className={`${th} text-right`}>Value</th><th className={th}>Term</th><th className={th}>Status</th><th className={th}>Invoicing</th><th className={th}><span className="sr-only">Actions</span></th></>}</tr></thead>
    <tbody className="block sm:table-row-group">{pos.map(po => <PORow key={po.id} po={po} schedule={schedule} user={user} showAccount={showAccount} openAccount={openAccount} onEdit={onEdit} onReview={onReview} compact={compact} />)}</tbody></table></div>;
}

function AccountPurchaseOrders({ account, user }) {
  const { pos, schedule, reload, error } = usePurchaseOrders({ accountId: account.id });
  const [form, setForm] = useState(null), [review, setReview] = useState(null);
  return <div>
    <div className="mb-2 flex justify-end"><Btn kind="primary" data-po-submit onClick={() => setForm({})}>Submit PO</Btn></div>
    <POTable pos={pos} schedule={schedule} user={user} error={error} onEdit={po => setForm({ existing: po })} onReview={setReview} emptyText="No purchase orders yet." />
    {form && <POForm account={account} user={user} existing={form.existing} onClose={() => setForm(null)} onSaved={reload} />}
    {review && <POReview po={review} user={user} schedule={schedule} onClose={() => setReview(null)} onDone={reload} />}
  </div>;
}

// Submitted POs awaiting a decision, for the Finance page.
function POQueue({ user, openAccount, onCount }) {
  const { pos, schedule, reload, error } = usePurchaseOrders({ status: "submitted" });
  useEffect(() => { onCount && onCount(pos.length); }, [pos.length]);
  const [review, setReview] = useState(null);
  return <div data-po-queue>
    <POTable pos={pos} schedule={schedule} user={user} error={error} showAccount openAccount={openAccount} onReview={setReview} emptyText="No purchase orders awaiting approval." compact />
    {review && <POReview po={review} user={user} schedule={schedule} onClose={() => setReview(null)} onDone={reload} />}
  </div>;
}
