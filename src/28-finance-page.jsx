/* ------------------------------ finance page ------------------------------ */
// Finance view: PO approval queue, approved POs' periods due to raise, per-currency summary, and every invoice.
function DueToRaise({ account, user, entities, onSent, onCount }) {
  const { pos, schedule, reload, error } = usePurchaseOrders({ status: "approved" });
  const [raising, setRaising] = useState(null);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const today = invToday();
  const forPO = po => schedule.filter(s => s.po_id === po.id);
  const due = pos.flatMap(po => dueItems(forPO(po), today).map(item => ({ po, item })));
  const upcoming = pos.flatMap(po => forPO(po).filter(s => !s.invoice_id && String(s.period_start) > today).map(item => ({ po, item })))
    .sort((a, b) => String(a.item.period_start).localeCompare(String(b.item.period_start)));
  useEffect(() => { onCount && onCount(due.length); }, [due.length]);
  if (error) return <div className="p-4 text-sm text-rose-600" data-due-error>Could not load purchase orders: {error}</div>;
  const money = (po, item) => <><span className="mr-1 text-xs text-slate-400">{po.currency}</span>{Number(item.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</>;
  return <div data-due-list>
    {due.length === 0 && <div className="p-4 text-sm text-slate-500" data-due-empty>Nothing to invoice right now.</div>}
    {due.map(({ po, item }) => <div key={item.id} data-due-item={item.id} className="flex items-center gap-3 border-t border-slate-100 px-4 py-2.5 text-sm first:border-t-0">
      <div className="min-w-0 flex-1"><div className="truncate font-medium text-slate-800">{po.account_name}</div>
        <div className="text-xs text-slate-500">PO {po.po_number} · {periodLabel(po, item)} · {fmtDate(item.period_start)} – {fmtDate(item.period_end)}</div></div>
      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="whitespace-nowrap tabular-nums">{money(po, item)}</span>
        {canFinance(user) && <Btn kind="primary" data-raise disabled={!account(po.account_id)} onClick={() => setRaising({ po, item })}>Raise invoice</Btn>}</div>
    </div>)}
    {upcoming.length > 0 && <div className="border-t border-slate-100 px-4 py-2">
      <button data-upcoming-toggle className="text-xs text-indigo-600 hover:underline" onClick={() => setShowUpcoming(v => !v)}>
        {showUpcoming ? "Hide" : "Show"} upcoming ({upcoming.length})</button>
      {showUpcoming && upcoming.map(({ po, item }) => <div key={item.id} data-upcoming-item={item.id} className="flex items-center gap-3 py-2 text-sm text-slate-400">
        <div className="min-w-0 flex-1"><div className="truncate">{po.account_name}</div>
          <div className="text-xs">PO {po.po_number} · {periodLabel(po, item)} · starts {fmtDate(item.period_start)}</div></div>
        <span className="shrink-0 whitespace-nowrap tabular-nums">{money(po, item)}</span></div>)}
    </div>}
    {raising && <InvoiceForm po={raising.po} item={raising.item} account={account(raising.po.account_id)} entities={entities} user={user}
      onClose={() => setRaising(null)} onSent={inv => { reload(); onSent(); if (inv) setRaising(null); }} />}
  </div>;
}

// One card per currency, never summed across currencies. Currencies with no invoices in scope are left out.
function FinanceSummary({ invoices }) {
  const s = summarizeInvoices(invoices, invToday());
  const curs = Object.keys(s).sort().filter(cur => invoices.some(i => i.currency === cur));
  if (!curs.length) return <div className="nm p-6 text-center text-sm text-slate-500" data-fin-summary data-fin-summary-empty>No invoices in this range yet.</div>;
  const fmt = n => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fig = (cur, k, label, cls, sub) => <div className="min-w-0"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div {...{ [`data-fin-summary-${cur}-${k}`]: "" }} className={`truncate text-base font-semibold tabular-nums ${cls}`} title={`${cur} ${fmt(s[cur][k])}`}>{fmtFinance(s[cur][k])}</div>
    {sub && <div className="text-[11px] text-slate-500">{sub}</div>}</div>;
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-fin-summary>{curs.map(cur => {
    const c = s[cur], base = c.paid + c.pending, paidPct = base > 0 ? (c.paid / base) * 100 : 0;
    return <div key={cur} className="nm p-4" data-fin-summary-card={cur}>
      <div className="mb-3 flex items-baseline justify-between"><h3 className="text-sm font-bold text-slate-800">{cur}</h3>
        <span className="text-[11px] text-slate-500">{base > 0 ? `${Math.round(paidPct)}% paid` : ""}</span></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {fig(cur, "paid", "Paid", "text-emerald-700")}{fig(cur, "pending", "Pending", "text-amber-700", "incl. overdue")}
        {fig(cur, "overdue", "Overdue", "text-rose-700", `${c.overdueCount} invoice${c.overdueCount === 1 ? "" : "s"}`)}{fig(cur, "waived", "Waived", "text-slate-600")}</div>
      <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-amber-100" role="img" aria-label={`${cur}: ${Math.round(paidPct)}% of paid plus pending is paid`}>
        <div className="h-full bg-emerald-500" style={{ width: `${paidPct}%` }} /></div>
    </div>; })}</div>;
}

// A bordered Finance panel: title, count badge, body.
const FinPanel = ({ title, count, children }) => <section className="nm min-w-0 overflow-hidden">
  <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3"><h2 className="text-sm font-bold text-slate-800">{title}</h2>
    {count != null && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">{count}</span>}</div>
  {children}</section>;

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
  const [poCount, setPoCount] = useState(null), [dueCount, setDueCount] = useState(null);
  const account = id => (st.accounts || []).find(a => a.id === id) || null;
  const today = invToday();
  // The summary follows the entity and date filters only, not the status or search filter.
  const scoped = invoices.filter(i => (ent === "all" || i.entity_id === ent) && (!from || i.issue_date >= from) && (!to || i.issue_date <= to));
  const rows = scoped.filter(i => (status === "all" || invoiceStatus(i, today) === status)
    && (!q || `${i.number} ${i.account_name}`.toLowerCase().includes(q.toLowerCase())));
  const entLabels = Object.fromEntries(entities.map(e => [e.id, e.name]));
  const lbl = "flex shrink-0 items-center gap-1.5 text-xs font-semibold text-slate-500";
  return <div data-finance-page className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-500">Purchase orders, invoices to raise, and every invoice by currency.</p>
      <Btn data-fin-export disabled={!rows.length} onClick={() => exportInvoicesCSV(rows, entities, today)}>Export CSV</Btn>
    </div>
    <FinanceSummary invoices={scoped} />
    <div className="grid gap-5 lg:grid-cols-2">
      <FinPanel title="POs awaiting approval" count={poCount}><div className="px-4 sm:px-2"><POQueue user={user} openAccount={openAccount} onCount={setPoCount} /></div></FinPanel>
      <FinPanel title="Due to raise" count={dueCount}><DueToRaise account={account} user={user} entities={entities} onSent={reload} onCount={setDueCount} /></FinPanel>
    </div>
    <FinPanel title="Invoices" count={rows.length}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 [&_input]:h-8 [&_input]:py-0 [&_select]:h-8 [&_select]:py-0">
        <div className="min-w-[12rem] flex-1"><Input data-fin-search placeholder="Search number or account" aria-label="Search invoices" value={q} onChange={e => setQ(e.target.value)} /></div>
        <label className={lbl}>Status<Select data-fin-filter-status aria-label="Status" value={status} onChange={e => setStatus(e.target.value)} options={["all", "pending", "overdue", "paid", "waived", "unsent"]} labels={{ all: "All", pending: "pending (not yet due)" }} /></label>
        <label className={lbl}>Entity<Select data-fin-filter-entity aria-label="Entity" value={ent} onChange={e => setEnt(e.target.value)} options={["all", ...entities.map(e => e.id)]} labels={{ all: "All entities", ...entLabels }} className="max-w-[14rem]" /></label>
        <div className={lbl}>Issued<Input type="date" aria-label="Issued from" value={from} onChange={e => setFrom(e.target.value)} className="!w-36" />
          <span className="font-normal">–</span><Input type="date" aria-label="Issued to" value={to} onChange={e => setTo(e.target.value)} className="!w-36" /></div>
      </div>
      <div className="px-4 sm:px-2"><InvoiceTable invoices={rows} entities={entities} user={user} onChanged={reload} showAccount openAccount={openAccount} error={error} accountOf={account} /></div>
    </FinPanel>
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
      <Card title="Finance this quarter" className="!p-3"
        right={<button data-fin-card-link type="button" className="text-[13px] font-semibold text-indigo-600 hover:underline" onClick={goFinance}>Open Finance</button>}>
        {err && <div className="mb-2 text-sm text-rose-600" data-fin-card-error>Could not load finance data: {err}</div>}
        {top && <div className="mb-2 flex items-center gap-3">
          <Donut data-fin-card-donut parts={[{ label: "Paid", value: s[top].paid, color: "#10b981" }, { label: "Pending", value: s[top].pending, color: "#f59e0b" },
            { label: "Waived", value: s[top].waived, color: "#94a3b8" }]} centre={top} />
          <div className="text-xs text-slate-500">{top} · {plural(count(top), "invoice")}</div></div>}
        {curs.map(cur => <div key={cur} {...{ [`data-fin-card-${cur}`]: "" }} className="mb-2 space-y-1 text-[13.5px]">
          <div className="font-semibold text-slate-900">{cur}</div>
          {[["Paid", "paid", "bg-emerald-500"], ["Pending (incl. overdue)", "pending", "bg-amber-500"], ["Waived", "waived", "bg-slate-400"]].map(([label, k, dot]) => (
            <div key={k} className="flex items-center gap-2.5"><span aria-hidden="true" className={`dash-dot ${dot}`} />
              <span className="min-w-0 flex-1 truncate text-slate-500">{label}</span>
              <b className="shrink-0 whitespace-nowrap tabular-nums text-slate-900" title={`${cur} ${amt(cur, k)}`}>{cur} {fmtFinance(s[cur][k])}</b></div>))}
          {s[cur].overdueCount > 0 && <div className="text-rose-700">{s[cur].overdueCount} overdue</div>}</div>)}
        {awaiting > 0 && <div data-fin-card-pos className="border-t border-slate-100 pt-2 text-[12.5px] text-slate-500">{plural(awaiting, "PO")} awaiting approval</div>}
        {due > 0 && <div data-fin-card-due className="border-t border-slate-100 pt-2 text-[12.5px] text-slate-500">{plural(due, "invoice")} due to raise</div>}
      </Card>
    </div>
  );
}
