/* ------------------------- invoice PDF and raise form ------------------------- */
// jsPDF's built-in Helvetica only has WinAnsi glyphs; anything else would print as mojibake.
const pdfText = s => String(s == null ? "" : s).replace(/[^\t\n\x20-\x7E\xA0-\xFF–—‘’“”•€]/g, "?");

function renderInvoicePdf({ inv, entity, account, po }) {
  const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
  const money = n => `${inv.currency} ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const wrap = (s, w) => doc.splitTextToSize(pdfText(s), w);
  let y = 50;
  doc.setFont("helvetica", "bold").setFontSize(16).text(pdfText(entity.name), 40, y);
  doc.setFont("helvetica", "normal").setFontSize(9);
  const addr = wrap(entity.address || "", 260);
  doc.text(addr, 40, (y += 16));
  y += Math.max(addr.length, 1) * 11 + 4;
  if (entity.tax_id) doc.text(pdfText(`${entity.tax_id_label || "Tax ID"}: ${entity.tax_id}`), 40, y);
  doc.setFont("helvetica", "bold").setFontSize(20).text("INVOICE", 555, 50, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(10)
    .text([`No. ${inv.number}`, `Date ${inv.issue_date}`, `Due ${inv.due_date}`, `PO ${pdfText(po.po_number)}`], 555, 70, { align: "right" });
  y = Math.max(y + 30, 150);
  doc.setFont("helvetica", "bold").text("Bill to", 40, y);
  const bill = wrap([inv.account_name, account.billingAddress || "", account.customerTaxId ? `Tax ID: ${account.customerTaxId}` : ""].filter(Boolean).join("\n"), 300);
  doc.setFont("helvetica", "normal").text(bill, 40, (y += 14));
  y += Math.max(bill.length, 1) * 12 + 20;
  doc.setFont("helvetica", "bold").text("Description", 40, y).text("Qty", 360, y, { align: "right" })
    .text("Rate", 450, y, { align: "right" }).text("Amount", 555, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  for (const l of inv.line_items) {
    const desc = wrap(l.description, 290);
    y += 18; if (y > 720) { doc.addPage(); y = 60; }
    doc.text(desc, 40, y).text(String(l.qty), 360, y, { align: "right" })
      .text(money(l.rate), 450, y, { align: "right" }).text(money(l.amount), 555, y, { align: "right" });
    y += (desc.length - 1) * 12;
  }
  y += 24;
  const row = (label, val, bold) => { if (y > 760) { doc.addPage(); y = 60; }
    doc.setFont("helvetica", bold ? "bold" : "normal").text(label, 450, y, { align: "right" }).text(val, 555, y, { align: "right" }); y += 16; };
  row("Subtotal", money(inv.subtotal));
  for (const t of inv.tax_lines) row(pdfText(`${t.label} ${t.pct}%`), money(t.amount));
  row("Total", money(inv.total), true);
  doc.setFont("helvetica", "normal").setFontSize(9);
  if (inv.tax_note) { y += 10; const n = wrap(inv.tax_note, 515); doc.text(n, 40, y); y += n.length * 11 + 10; }
  if (entity.bank_details) {
    if (y > 700) { doc.addPage(); y = 60; }
    doc.setFont("helvetica", "bold").text("Payment details", 40, (y += 10));
    doc.setFont("helvetica", "normal").text(wrap(entity.bank_details, 515), 40, (y += 12));
  }
  return doc.output("blob");
}

function InvoiceForm({ po, item, account, entities, user, onClose, onSent }) {
  const [entityId, setEntityId] = useState(() => defaultEntityFor(account, entities)?.id || "");
  const entity = entities.find(e => e.id === entityId) || null;
  const today = invToday();
  const plus30 = new Date(Date.parse(today + "T00:00:00Z") + 30 * 864e5).toISOString().slice(0, 10);
  // The CC defaults blank: team rows carry no email, and admins can type one.
  const [f, setF] = useState({ issue_date: today, due_date: plus30, sent_to: account.billingEmail || "", sent_cc: "", lines: [scheduleLineItem(po, item)] });
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [created, setCreated] = useState(false);
  const [applyTax, setApplyTax] = useState(!account.taxExempt);
  const totals = entity ? computeTotals(f.lines, entity, account, { exempt: !applyTax }) : null;
  const block = !canFinance(user) ? "You need finance access to create invoices."
    : !entity ? "No billing entity for this account. Set Billing entity or Country on the account, or add an entity in Settings → Billing."
    : entity.currency !== po.currency ? `This PO is in ${po.currency} but ${entity.name} bills in ${entity.currency}. Pick a ${po.currency} entity.`
    : !f.sent_to.trim() ? "This account has no billing email. Add one on the account's Billing section or type it here."
    : !totals.lines.length || totals.total <= 0 ? "Add at least one line with an amount above 0."
    : f.due_date < f.issue_date ? "Due date is before the issue date."
    : created ? "This invoice is already saved. Close this form and use Retry send in the list." : "";
  const setLine = (i, k, v) => setF({ ...f, lines: f.lines.map((l, j) => j === i ? { ...l, [k]: v } : l) });
  const fmt = n => `${entity?.currency || ""} ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const send = async () => {
    setBusy(true); setMsg("");
    let inv = null;
    try {
      const c = await sb.rpc("create_invoice", { p: { schedule_id: item.id, entity_id: entity.id,
        issue_date: f.issue_date, due_date: f.due_date, line_items: totals.lines, subtotal: totals.subtotal,
        tax_lines: totals.taxLines, tax_note: totals.taxNote, tax_exempt: !applyTax, total: totals.total, sent_to: f.sent_to.trim(), sent_cc: f.sent_cc.trim() || null } });
      if (c.error) throw c.error;
      inv = c.data; setCreated(true);
      const blob = renderInvoicePdf({ inv, entity, account, po });
      const path = `${inv.org_id}/${inv.id}.pdf`;
      const up = await sb.storage.from("invoices").upload(path, blob, { contentType: "application/pdf", upsert: true });
      if (up.error) throw new Error(`${inv.number} was created but the PDF upload failed: ${up.error.message}. Use Retry send in the list.`);
      const at = await sb.rpc("attach_invoice_pdf", { p_id: inv.id, p_path: path });
      if (at.error) throw new Error(`${inv.number} was created but attaching the PDF failed: ${at.error.message}. Use Retry send in the list.`);
      const s = await sb.rpc("send_invoice", { p_id: inv.id, p_pdf_base64: await blobToBase64(blob) });
      if (s.error) throw new Error(`${inv.number} was saved but not sent: ${s.error.message}. It shows as Unsent; use Retry send.`);
      invToast(`${inv.number} sent to ${f.sent_to.trim()}`, "success");
      onSent(s.data);
    } catch (e) {
      setMsg(e.message || String(e)); invToast(e.message || String(e), "error");
      if (inv) onSent(null);   // the invoice exists: let the parent reload so the Unsent row shows
    } finally { setBusy(false); }
  };

  return (
    <Modal label="Raise invoice" data-invoice-form className="nm w-full max-w-2xl p-4" onClose={onClose}>
      <h3 className="mb-2 text-sm font-bold text-slate-800">Raise invoice — {account.name}, PO {po.po_number}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-slate-700">Billing entity
          <Select value={entityId} onChange={e => setEntityId(e.target.value)} options={["", ...entities.map(e => e.id)]}
            labels={{ "": "— choose —", ...Object.fromEntries(entities.map(e => [e.id, `${e.name} (${e.currency})`])) }} className="w-full" /></label>
        <label className="block text-xs text-slate-700">Issue date<Input type="date" value={f.issue_date} onChange={e => setF({ ...f, issue_date: e.target.value })} /></label>
        <label className="block text-xs text-slate-700">Due date<Input type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} /></label>
        <label className="block text-xs text-slate-700">To<Input type="email" value={f.sent_to} onChange={e => setF({ ...f, sent_to: e.target.value })} /></label>
        <label className="block text-xs text-slate-700">CC<Input type="email" value={f.sent_cc} onChange={e => setF({ ...f, sent_cc: e.target.value })} /></label>
      </div>
      <div className="mt-3 space-y-1.5">
        {f.lines.map((l, i) => <div key={i} className="flex items-center gap-1.5">
          <Input data-line-desc aria-label="Description" value={l.description} onChange={e => setLine(i, "description", e.target.value)} />
          <Input data-line-qty aria-label="Quantity" type="number" min="0" step="any" className="!w-16" value={l.qty} onChange={e => setLine(i, "qty", e.target.value)} />
          <Input data-line-rate aria-label="Rate" type="number" min="0" step="any" className="!w-28" value={l.rate} onChange={e => setLine(i, "rate", e.target.value)} />
          <span className="w-28 shrink-0 text-right text-xs tabular-nums">{entity ? fmt((Number(l.qty) || 0) * (Number(l.rate) || 0)) : ""}</span>
          {f.lines.length > 1 && <button type="button" aria-label="Remove line" className="text-rose-500" onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })}>×</button>}
        </div>)}
        <Btn data-add-line onClick={() => setF({ ...f, lines: [...f.lines, { description: "", qty: 1, rate: 0 }] })}>Add line</Btn>
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" data-apply-tax checked={applyTax} onChange={e => setApplyTax(e.target.checked)} />
        <span>Apply tax{account.taxExempt && <span className="text-slate-500"> — account is tax exempt{account.taxExemptNote ? ` (${account.taxExemptNote})` : ""}</span>}</span>
      </label>
      {totals && <div className="mt-2 space-y-0.5 text-right text-xs tabular-nums text-slate-700">
        <div>Subtotal {fmt(totals.subtotal)}</div>
        {totals.taxLines.map(t => <div key={t.label}>{t.label} {t.pct}% {fmt(t.amount)}</div>)}
        <div data-inv-total className="text-sm font-bold text-slate-900">Total {fmt(totals.total)}</div>
        {totals.taxNote && <div className="text-left text-[11px] text-slate-500">{totals.taxNote}</div>}
      </div>}
      {block && <div data-inv-block className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{block}</div>}
      {msg && <div className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-600">{msg}</div>}
      <div className="mt-4 flex gap-2">
        <Btn kind="primary" data-inv-send disabled={!!block || busy} onClick={send}>{busy ? "Sending…" : "Send invoice"}</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}
