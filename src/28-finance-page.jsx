/* ------------------------------ finance page ------------------------------ */
// Finance view: PO approval queue, approved POs' periods due to raise, per-currency summary, and every invoice.
function DueToRaise({ account, user, entities, onSent }) {
  const { pos, schedule, reload, error } = usePurchaseOrders({ status: "approved" });
  const [raising, setRaising] = useState(null);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const today = invToday();
  const forPO = po => schedule.filter(s => s.po_id === po.id);
  const due = pos.flatMap(po => dueItems(forPO(po), today).map(item => ({ po, item })));
  const upcoming = pos.flatMap(po => forPO(po).filter(s => !s.invoice_id && String(s.period_start) > today).map(item => ({ po, item })))
    .sort((a, b) => String(a.item.period_start).localeCompare(String(b.item.period_start)));
  if (error) return <div className="p-4 text-sm text-rose-600" data-due-error>Could not load purchase orders: {error}</div>;
  const money = (po, item) => `${po.currency} ${Number(item.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  return <div data-due-list>
    {due.length === 0 && <div className="p-4 text-sm text-slate-500" data-due-empty>Nothing to invoice right now.</div>}
    {due.map(({ po, item }) => <div key={item.id} data-due-item={item.id} className="flex flex-wrap items-center gap-3 border-t border-slate-100 p-2 text-sm">
      <span className="min-w-0 flex-1">{po.account_name} — PO {po.po_number}, {periodLabel(po, item)} ({item.period_start} – {item.period_end})</span>
      <span className="tabular-nums">{money(po, item)}</span>
      {canFinance(user) && <Btn kind="primary" data-raise disabled={!account(po.account_id)} onClick={() => setRaising({ po, item })}>Raise invoice</Btn>}
    </div>)}
    {upcoming.length > 0 && <div className="p-2">
      <button data-upcoming-toggle className="text-xs text-indigo-600 hover:underline" onClick={() => setShowUpcoming(v => !v)}>
        {showUpcoming ? "Hide" : "Show"} upcoming ({upcoming.length})</button>
      {showUpcoming && upcoming.map(({ po, item }) => <div key={item.id} data-upcoming-item={item.id} className="flex flex-wrap items-center gap-3 p-2 text-sm text-slate-400">
        <span className="min-w-0 flex-1">{po.account_name} — PO {po.po_number}, {periodLabel(po, item)} (starts {item.period_start})</span>
        <span className="tabular-nums">{money(po, item)}</span></div>)}
    </div>}
    {raising && <InvoiceForm po={raising.po} item={raising.item} account={account(raising.po.account_id)} entities={entities} user={user}
      onClose={() => setRaising(null)} onSent={inv => { reload(); onSent(); if (inv) setRaising(null); }} />}
  </div>;
}

function FinanceSummary({ invoices }) {
  const s = summarizeInvoices(invoices, invToday());
  const curs = Object.keys(s).sort();
  if (!curs.length) return null;
  const cell = (cur, k, label, cls) => <div className="nm-inset p-3"><div className="text-xs text-slate-500">{label}</div>
    <div {...{ [`data-fin-summary-${cur}-${k}`]: "" }} className={`text-lg font-semibold tabular-nums ${cls}`}>
      {cur} {s[cur][k].toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
    {k === "pending" && <div className="text-xs text-slate-500">includes overdue</div>}
    {k === "overdue" && <div className="text-xs text-slate-500">{s[cur].overdueCount} invoice(s)</div>}</div>;
  return <div className="space-y-2" data-fin-summary>{curs.map(cur => <div key={cur} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {cell(cur, "paid", "Paid", "text-emerald-700")}{cell(cur, "pending", "Pending", "text-amber-700")}
    {cell(cur, "overdue", "Overdue", "text-rose-700")}{cell(cur, "waived", "Waived", "text-slate-600")}</div>)}</div>;
}

function invoicesCSVText(rows, entities, today) {
  const cols = ["Number", "Account", "Entity", "Currency", "Issue date", "Due date", "Subtotal", "Tax", "Total", "Status", "Paid date", "Payment ref", "Waive reason"];
  const ent = id => (entities.find(e => e.id === id) || {}).name || "";
  const lines = rows.map(i => [i.number, i.account_name, ent(i.entity_id), i.currency, i.issue_date, i.due_date, i.subtotal, fromCents(toCents(i.total) - toCents(i.subtotal)), i.total,
    invoiceStatus(i, today), i.paid_date, i.payment_ref, i.waive_reason].map(csvCell).join(","));
  return [cols.map(csvCell).join(","), ...lines].join("\n");
}
function exportInvoicesCSV(rows, entities, today) {
  const url = URL.createObjectURL(new Blob([invoicesCSVText(rows, entities, today)], { type: "text/csv" }));
  const el = Object.assign(document.createElement("a"), { href: url, download: "invoices.csv" });
  el.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

function FinancePage({ st, user, openAccount }) {
  const { invoices, entities, reload, error } = useInvoices();
  const [q, setQ] = useState(""), [status, setStatus] = useState("all"), [ent, setEnt] = useState("all");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const account = id => (st.accounts || []).find(a => a.id === id) || null;
  const today = invToday();
  // The summary follows the entity and date filters only, not the status or search filter.
  const scoped = invoices.filter(i => (ent === "all" || i.entity_id === ent) && (!from || i.issue_date >= from) && (!to || i.issue_date <= to));
  const rows = scoped.filter(i => (status === "all" || invoiceStatus(i, today) === status)
    && (!q || `${i.number} ${i.account_name}`.toLowerCase().includes(q.toLowerCase())));
  const entLabels = Object.fromEntries(entities.map(e => [e.id, e.name]));
  return <div data-finance-page className="space-y-6">
    <h1 className="text-lg font-bold text-slate-800">Finance</h1>
    <section><h2 className="mb-1 text-sm font-bold text-slate-800">POs awaiting approval</h2>
      <POQueue user={user} openAccount={openAccount} /></section>
    <section><h2 className="mb-1 text-sm font-bold text-slate-800">Due to raise</h2>
      <DueToRaise account={account} user={user} entities={entities} onSent={reload} /></section>
    <section className="space-y-3"><h2 className="text-sm font-bold text-slate-800">Invoices</h2>
      <FinanceSummary invoices={scoped} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[10rem] flex-1"><Input data-fin-search placeholder="Search number or account" aria-label="Search invoices" value={q} onChange={e => setQ(e.target.value)} /></div>
        <Select data-fin-filter-status aria-label="Status" value={status} onChange={e => setStatus(e.target.value)} options={["all", "pending", "overdue", "paid", "waived", "unsent"]} labels={{ pending: "pending (not yet due)" }} />
        <Select data-fin-filter-entity aria-label="Entity" value={ent} onChange={e => setEnt(e.target.value)} options={["all", ...entities.map(e => e.id)]} labels={{ all: "all", ...entLabels }} />
        <label className="text-xs text-slate-500">From <Input type="date" aria-label="Issued from" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-xs text-slate-500">To <Input type="date" aria-label="Issued to" value={to} onChange={e => setTo(e.target.value)} /></label>
        <Btn data-fin-export disabled={!rows.length} onClick={() => exportInvoicesCSV(rows, entities, today)}>Export CSV</Btn>
      </div>
      <InvoiceTable invoices={rows} entities={entities} user={user} onChanged={reload} showAccount openAccount={openAccount} error={error} />
    </section>
  </div>;
}
