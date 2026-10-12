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

// An invoice whose PDF never reached storage: rebuild it from the stored fields, upload, attach, then send.
async function rebuildAndSendInvoice(inv, entities, account) {
  const entity = entities.find(e => e.id === inv.entity_id);
  if (!entity) throw new Error("Billing entity not found for this invoice.");
  const { data: po, error: pe } = await sb.from("purchase_orders").select("po_number").eq("id", inv.po_id).maybeSingle();
  if (pe || !po) throw new Error(pe ? pe.message : "Purchase order not found for this invoice.");
  const blob = renderInvoicePdf({ inv, entity, account: account || {}, po });
  const path = `${inv.org_id}/${inv.id}.pdf`;
  const up = await sb.storage.from("invoices").upload(path, blob, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(`PDF upload failed: ${up.error.message}`);
  const at = await sb.rpc("attach_invoice_pdf", { p_id: inv.id, p_path: path });
  if (at.error) throw new Error(`Attaching the PDF failed: ${at.error.message}`);
  const r = await sb.rpc("send_invoice", { p_id: inv.id, p_pdf_base64: await blobToBase64(blob) });
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

// Small bordered action button, shared by the invoice and PO tables. tone "danger" for destructive actions.
const MiniBtn = ({ tone, className = "", ...p }) => <button type="button" {...p}
  className={`rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 ${tone === "danger" ? "text-rose-600" : "text-indigo-600"} ${className}`} />;
const invDate = d => d ? fmtDate(d) : "—";
const invMoney = n => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 });
// Below sm the table collapses to one card per row: number + status, account, amount + due, then actions.
const IT_CELL = "block p-0 sm:table-cell sm:p-2";

function InvoiceTable({ invoices, entities, user, onChanged, showAccount, openAccount, error, accountOf }) {
  const fin = canFinance(user);
  const [paying, setPaying] = useState(null), [waiving, setWaiving] = useState(null), [reverting, setReverting] = useState(null);
  const today = invToday();
  if (error) return <div className="p-4 text-sm text-rose-600" data-invoices-error>Could not load invoices: {error}</div>;
  if (!invoices.length) return <div className="p-4 text-sm text-slate-500" data-invoices-empty>No invoices yet.</div>;
  return <div className="sm:overflow-x-auto"><table className="block w-full text-sm sm:table">
    <thead className="hidden sm:table-header-group"><tr className="border-b border-slate-200 text-left text-xs text-slate-500">
      <th className="p-2 font-semibold">Number</th>{showAccount && <th className="p-2 font-semibold">Account</th>}
      <th className="p-2 font-semibold">Issued</th><th className="p-2 font-semibold">Due</th><th className="p-2 text-right font-semibold">Amount</th>
      <th className="p-2 font-semibold">Status</th>{fin && <th className="p-2 text-center font-semibold">Paid</th>}<th className="p-2 text-right font-semibold"><span className="sr-only">Actions</span></th></tr></thead>
    <tbody className="block sm:table-row-group">{invoices.map(inv => {
      const st = invoiceStatus(inv, today), [label, cls] = STATUS_PILL[st];
      return <tr key={inv.id} data-invoice-row={inv.number} className="grid grid-cols-2 items-center gap-x-3 gap-y-1.5 border-t border-slate-100 py-3 first:border-t-0 sm:table-row sm:py-0 sm:first:border-t-0">
        <td className={`${IT_CELL} order-1 font-medium text-slate-800`}>{inv.number}</td>
        {showAccount && <td className={`${IT_CELL} order-3 col-span-2 min-w-0 truncate`}><button className="text-indigo-600 hover:underline" onClick={() => openAccount(inv.account_id)}>{inv.account_name}</button></td>}
        <td className={`${IT_CELL} hidden whitespace-nowrap tabular-nums text-slate-600`}>{invDate(inv.issue_date)}</td>
        <td className={`${IT_CELL} order-5 whitespace-nowrap text-right text-xs tabular-nums text-slate-600 sm:text-left sm:text-sm`}><span className="sm:hidden">Due </span>{invDate(inv.due_date)}</td>
        <td className={`${IT_CELL} order-4 whitespace-nowrap tabular-nums sm:text-right`}><span className="mr-1 text-xs text-slate-400">{inv.currency}</span>{invMoney(inv.total)}</td>
        <td className={`${IT_CELL} order-2 text-right sm:text-left`}><span data-invoice-status className={`rounded px-1.5 py-0.5 text-xs font-semibold ${cls}`} title={inv.waive_reason || inv.payment_ref || ""}>{label}</span></td>
        {fin && <td className={`${IT_CELL} order-6 sm:text-center`}><label className="inline-flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" data-paid-checkbox aria-label={`Paid ${inv.number}`}
          checked={inv.status === "paid"} disabled={inv.status === "waived" || !inv.sent_at}
          onChange={e => e.target.checked ? setPaying(inv) : setReverting(inv)} /><span className="sm:hidden">Paid</span></label></td>}
        <td className={`${IT_CELL} order-7 ${fin ? "" : "col-span-2"}`}><div className="flex flex-wrap justify-end gap-1.5 whitespace-nowrap">
          {inv.pdf_path && <MiniBtn data-download onClick={() => downloadInvoice(inv)}>PDF</MiniBtn>}
          {fin && inv.status === "pending" && <MiniBtn data-resend
            onClick={async () => { try { if (inv.pdf_path) await resendInvoice(inv); else await rebuildAndSendInvoice(inv, entities, accountOf && accountOf(inv.account_id)); invToast(`${inv.number} sent`, "success"); onChanged(); } catch (e) { invToast(e.message, "error"); } }}>{inv.sent_at ? "Re-send" : "Retry send"}</MiniBtn>}
          {fin && inv.status === "pending" && <MiniBtn data-waive tone="danger" onClick={() => setWaiving(inv)}>{inv.sent_at ? "Waive" : "Discard"}</MiniBtn>}
        </div></td></tr>; })}</tbody></table>
    {paying && <MarkPaidDialog inv={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); onChanged(); }} />}
    {waiving && <WaiveDialog inv={waiving} onClose={() => setWaiving(null)} onDone={() => { setWaiving(null); onChanged(); }} />}
    {reverting && <ConfirmDialog title={`Mark ${reverting.number} as not paid?`} body="It goes back to Pending and the payment date and reference are cleared."
      confirmLabel="Mark unpaid" tone="normal" onClose={() => setReverting(null)}
      onConfirm={async () => { try { await setStatus(reverting, "pending"); onChanged(); } catch {} }} />}
  </div>;
}

function AccountInvoices({ account, user }) {
  const { invoices, entities, reload, error } = useInvoices({ accountId: account.id });
  return <InvoiceTable invoices={invoices} entities={entities} user={user} onChanged={reload} error={error} accountOf={() => account} />;
}
