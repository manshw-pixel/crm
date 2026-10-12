/* ------------------------------ finance page ------------------------------ */
// Minimal Finance view: approved POs' un-raised periods that have started, and the invoice list.
// The PO approval queue and the rest of the page are added in a later task.
function DueToRaise({ account, user, entities, onSent }) {
  const { pos, schedule, reload, error } = usePurchaseOrders({ status: "approved" });
  const [raising, setRaising] = useState(null);
  const today = invToday();
  const due = pos.flatMap(po => dueItems(schedule.filter(s => s.po_id === po.id), today).map(item => ({ po, item })));
  if (error) return <div className="p-4 text-sm text-rose-600" data-due-error>Could not load purchase orders: {error}</div>;
  return <div data-due-list>
    {due.length === 0 && <div className="p-4 text-sm text-slate-500" data-due-empty>Nothing to invoice right now.</div>}
    {due.map(({ po, item }) => <div key={item.id} data-due-item={item.id} className="flex items-center gap-3 border-t border-slate-100 p-2 text-sm">
      <span className="flex-1">{po.account_name} — PO {po.po_number}, {periodLabel(po, item)} ({item.period_start} – {item.period_end})</span>
      <span className="tabular-nums">{po.currency} {Number(item.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
      <Btn kind="primary" data-raise disabled={!account(po.account_id)} onClick={() => setRaising({ po, item })}>Raise invoice</Btn>
    </div>)}
    {raising && <InvoiceForm po={raising.po} item={raising.item} account={account(raising.po.account_id)} entities={entities} user={user}
      onClose={() => setRaising(null)} onSent={inv => { reload(); onSent(); if (inv) setRaising(null); }} />}
  </div>;
}

function FinancePage({ st, user, openAccount }) {
  const { invoices, entities, reload, error } = useInvoices();
  const account = id => (st.accounts || []).find(a => a.id === id) || null;
  return <div data-finance-page className="space-y-6">
    <section><h2 className="mb-1 text-sm font-bold text-slate-800">Due to raise</h2>
      <DueToRaise account={account} user={user} entities={entities} onSent={reload} /></section>
    <section><h2 className="mb-1 text-sm font-bold text-slate-800">Invoices</h2>
      <InvoiceTable invoices={invoices} entities={entities} user={user} onChanged={reload} showAccount openAccount={openAccount} error={error} /></section>
  </div>;
}
