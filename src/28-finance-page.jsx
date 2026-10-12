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

/* Dashboard card: this calendar quarter's invoices per currency (never summed across currencies), plus PO and
   due-to-raise counts. "Pending" includes overdue, as in summarizeInvoices. Hidden when there is nothing to show. */
function FinanceCard({ goFinance }) {
  const { invoices, error: invErr } = useInvoices();
  const { pos, schedule, error: poErr } = usePurchaseOrders();
  const today = invToday();
  const [y, m] = today.split("-").map(Number);
  const qStart = `${y}-${String((Math.floor((m - 1) / 3)) * 3 + 1).padStart(2, "0")}-01`;
  const mine = invoices.filter(i => String(i.issue_date) >= qStart && String(i.issue_date) <= today);
  const s = summarizeInvoices(mine, today);
  const curs = Object.keys(s).sort();
  const awaiting = pos.filter(p => p.status === "submitted").length;
  const approvedIds = new Set(pos.filter(p => p.status === "approved").map(p => p.id));
  const due = dueItems(schedule.filter(x => approvedIds.has(x.po_id)), today).length;
  const err = invErr || poErr;
  if (!err && !curs.length && !awaiting && !due) return null;
  const count = cur => mine.filter(i => i.currency === cur && invoiceStatus(i, today) !== "unsent").length;
  const top = curs.slice().sort((a, b) => count(b) - count(a) || a.localeCompare(b))[0];
  const amt = (cur, k) => s[cur][k].toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return (
    <div data-finance-card>
      <Card title="Finance · this quarter" className="!p-3">
        {err && <div className="mb-2 text-sm text-rose-600" data-fin-card-error>Could not load finance data: {err}</div>}
        {top && <div className="mb-2 flex items-center gap-3">
          <Donut data-fin-card-donut parts={[{ label: "Paid", value: s[top].paid, color: "#10b981" }, { label: "Pending", value: s[top].pending, color: "#f59e0b" },
            { label: "Waived", value: s[top].waived, color: "#94a3b8" }]} centre={top} />
          <div className="text-xs text-slate-500">{top} · {plural(count(top), "invoice")}</div></div>}
        {curs.map(cur => <div key={cur} {...{ [`data-fin-card-${cur}`]: "" }} className="mb-2 text-sm">
          <div className="font-semibold">{cur}</div>
          <div className="tabular-nums text-emerald-700">Paid {cur} {amt(cur, "paid")}</div>
          <div className="tabular-nums text-amber-700">Pending (incl. overdue) {cur} {amt(cur, "pending")}</div>
          <div className="tabular-nums text-slate-600">Waived {cur} {amt(cur, "waived")}</div>
          {s[cur].overdueCount > 0 && <div className="text-rose-700">{s[cur].overdueCount} overdue</div>}</div>)}
        {awaiting > 0 && <div data-fin-card-pos className="text-sm">{plural(awaiting, "PO")} awaiting approval</div>}
        {due > 0 && <div data-fin-card-due className="text-sm">{plural(due, "invoice")} due to raise</div>}
        <button data-fin-card-link className="mt-2 text-sm text-indigo-600 hover:underline" onClick={goFinance}>Open Finance →</button>
      </Card>
    </div>
  );
}
