/* ------------------------------ invoices ------------------------------ */
const invToday = () => iso(Date.now());
// Module-level helpers cannot call useToast(); the provider publishes its pusher on window.
const invToast = (text, tone = "info") => window.__toast && window.__toast({ text, tone });

function useInvoices(filter) {
  const [state, setState] = useState({ invoices: [], entities: [], loading: true, error: "" });
  const accountId = filter && filter.accountId;
  const reload = useCallback(async () => {
    let q = sb.from("invoices").select("*").order("issue_date", { ascending: false }).order("number", { ascending: false });
    if (accountId) q = q.eq("account_id", accountId);
    const [inv, ent] = await Promise.all([q, sb.from("billing_entities").select("*")]);
    setState({ invoices: inv.data || [], entities: ent.data || [], loading: false, error: (inv.error || ent.error)?.message || "" });
  }, [accountId]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

const STATUS_PILL = { paid: ["Paid", "bg-emerald-50 text-emerald-700"], waived: ["Waived", "bg-slate-100 text-slate-600"],
  overdue: ["Overdue", "bg-rose-50 text-rose-700"], pending: ["Pending", "bg-amber-50 text-amber-700"], unsent: ["Unsent", "bg-indigo-50 text-indigo-700"] };

async function setStatus(inv, status, extra = {}) {
  const { error } = await sb.rpc("set_invoice_status", { p_id: inv.id, p_status: status,
    p_paid_date: extra.paidDate || null, p_ref: extra.ref || null, p_reason: extra.reason || null });
  if (error) { invToast(error.message, "error"); throw error; }
}

function blobToBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
}
async function downloadInvoice(inv) {
  const { data, error } = await sb.storage.from("invoices").createSignedUrl(inv.pdf_path, 60);
  if (error) return invToast(error.message, "error");
  window.open(data.signedUrl, "_blank", "noopener");
}
async function resendInvoice(inv) {
  const { data, error } = await sb.storage.from("invoices").download(inv.pdf_path);
  if (error) throw error;
  const r = await sb.rpc("send_invoice", { p_id: inv.id, p_pdf_base64: await blobToBase64(data) });
  if (r.error) throw r.error;
  return r.data;
}

function MarkPaidDialog({ inv, onDone, onClose }) {
  const [date, setDate] = useState(invToday());
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal label={`Mark ${inv.number} paid`} onClose={onClose}>
      <h3 className="mb-2 text-sm font-bold text-slate-800">Mark {inv.number} as paid</h3>
      <label className="block text-xs text-slate-700">Payment date<Input type="date" data-paid-date value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="mt-2 block text-xs text-slate-700">Reference (UTR / cheque no.)<Input data-paid-ref value={ref} onChange={e => setRef(e.target.value)} /></label>
      <div className="mt-4 flex gap-2">
        <Btn kind="primary" data-paid-confirm disabled={!date || busy} onClick={async () => {
          setBusy(true);
          try { await setStatus(inv, "paid", { paidDate: date, ref: ref.trim() }); onDone(); } catch { setBusy(false); }
        }}>Mark paid</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}

function WaiveDialog({ inv, onDone, onClose }) {
  const unsent = !inv.sent_at;
  const [reason, setReason] = useState(unsent ? "Discarded before sending" : "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal label={`${unsent ? "Discard" : "Waive"} ${inv.number}`} onClose={onClose}>
      <h3 className="mb-2 text-sm font-bold text-slate-800">{unsent ? "Discard" : "Waive"} {inv.number}</h3>
      <label className="block text-xs text-slate-700">Reason (required)
        <textarea data-waive-reason rows={3} value={reason} onChange={e => setReason(e.target.value)} className="nm-inset w-full border-0 px-3 py-1.5 text-sm text-slate-800 outline-none" /></label>
      <div className="mt-4 flex gap-2">
        <Btn kind="primary" data-waive-confirm disabled={!reason.trim() || busy} onClick={async () => {
          setBusy(true);
          try { await setStatus(inv, "waived", { reason: reason.trim() }); onDone(); } catch { setBusy(false); }
        }}>{unsent ? "Discard" : "Waive"}</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}

function InvoiceTable({ invoices, entities, user, onChanged, showAccount, openAccount, error }) {
  const fin = canFinance(user);
  const [paying, setPaying] = useState(null), [waiving, setWaiving] = useState(null), [reverting, setReverting] = useState(null);
  const today = invToday();
  if (error) return <div className="p-4 text-sm text-rose-600" data-invoices-error>Could not load invoices: {error}</div>;
  if (!invoices.length) return <div className="p-4 text-sm text-slate-500" data-invoices-empty>No invoices yet.</div>;
  return <div className="overflow-x-auto"><table className="w-full text-sm">
    <thead><tr className="text-left text-xs text-slate-500">
      {fin && <th className="p-2">Paid</th>}<th className="p-2">Number</th>{showAccount && <th className="p-2">Account</th>}
      <th className="p-2">Issued</th><th className="p-2">Due</th><th className="p-2 text-right">Amount</th><th className="p-2">Status</th><th className="p-2"></th></tr></thead>
    <tbody>{invoices.map(inv => {
      const st = invoiceStatus(inv, today), [label, cls] = STATUS_PILL[st];
      return <tr key={inv.id} data-invoice-row={inv.number} className="border-t border-slate-100">
        {fin && <td className="p-2"><input type="checkbox" data-paid-checkbox aria-label={`Paid ${inv.number}`}
          checked={inv.status === "paid"} disabled={inv.status === "waived" || !inv.sent_at}
          onChange={e => e.target.checked ? setPaying(inv) : setReverting(inv)} /></td>}
        <td className="p-2 font-medium">{inv.number}</td>
        {showAccount && <td className="p-2"><button className="text-indigo-600 hover:underline" onClick={() => openAccount(inv.account_id)}>{inv.account_name}</button></td>}
        <td className="p-2 tabular-nums">{inv.issue_date}</td><td className="p-2 tabular-nums">{inv.due_date}</td>
        <td className="p-2 text-right tabular-nums">{inv.currency} {Number(inv.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
        <td className="p-2"><span data-invoice-status className={`rounded px-1.5 py-0.5 text-xs font-semibold ${cls}`} title={inv.waive_reason || inv.payment_ref || ""}>{label}</span></td>
        <td className="p-2 whitespace-nowrap text-xs">
          {inv.pdf_path && <button data-download className="text-indigo-600 hover:underline" onClick={() => downloadInvoice(inv)}>PDF</button>}
          {fin && inv.status === "pending" && inv.pdf_path && <button data-resend className="ml-2 text-indigo-600 hover:underline"
            onClick={async () => { try { await resendInvoice(inv); invToast(`${inv.number} sent`, "success"); onChanged(); } catch (e) { invToast(e.message, "error"); } }}>
            {inv.sent_at ? "Re-send" : "Retry send"}</button>}
          {fin && inv.status === "pending" && <button data-waive className="ml-2 text-rose-500 hover:underline" onClick={() => setWaiving(inv)}>{inv.sent_at ? "Waive" : "Discard"}</button>}
        </td></tr>; })}</tbody></table>
    {paying && <MarkPaidDialog inv={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); onChanged(); }} />}
    {waiving && <WaiveDialog inv={waiving} onClose={() => setWaiving(null)} onDone={() => { setWaiving(null); onChanged(); }} />}
    {reverting && <ConfirmDialog title={`Mark ${reverting.number} as not paid?`} body="It goes back to Pending and the payment date and reference are cleared."
      confirmLabel="Mark unpaid" tone="normal" onClose={() => setReverting(null)}
      onConfirm={async () => { try { await setStatus(reverting, "pending"); onChanged(); } catch {} }} />}
  </div>;
}

function AccountInvoices({ account, user }) {
  const { invoices, entities, reload, error } = useInvoices({ accountId: account.id });
  return <InvoiceTable invoices={invoices} entities={entities} user={user} onChanged={reload} error={error} />;
}
