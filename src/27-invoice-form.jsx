/* ------------------------- invoice PDF and raise form ------------------------- */
// jsPDF's built-in Helvetica only has WinAnsi glyphs; anything else would print as mojibake.
const pdfText = s => String(s == null ? "" : s).replace(/\u20B9/g, "Rs.").replace(/[^\t\n\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u20AC]/g, "?");

// OneVio brand: navy #0f172a, indigo #4f46e5 (same as onevio.in). The mark is drawn as vectors, so no image asset.
const PDF_NAVY = [15, 23, 42], PDF_INDIGO = [79, 70, 229], PDF_SLATE = [100, 116, 139], PDF_LINE = [226, 232, 240], PDF_TINT = [245, 246, 250];
const pdfDate = iso => { const d = new Date(String(iso) + "T00:00:00Z");
  return isNaN(d) ? pdfText(iso) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }); };

function drawOneVioMark(doc, x, y, s) {
  // 64-unit favicon geometry scaled to s points: an "O" ring and a "V" chevron.
  const k = s / 64;
  doc.setLineWidth(7 * k).setDrawColor(...PDF_NAVY).circle(x + 19 * k, y + 32 * k, 11 * k, "S");
  doc.setDrawColor(...PDF_INDIGO).setLineCap("round").setLineJoin("round")
    .lines([[9 * k, 23.5 * k], [9 * k, -23.5 * k]], x + 38 * k, y + 20.5 * k, [1, 1], "S", false);
  doc.setLineCap("butt").setLineJoin("miter").setLineWidth(1);
}

function renderInvoicePdf({ inv, entity, account, po }) {
  const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
  const W = 595.28, L = 40, R = W - 40, CW = R - L;
  const money = n => `${inv.currency} ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const wrap = (s, w) => doc.splitTextToSize(pdfText(s), w);
  const font = (style, size, color = PDF_NAVY) => doc.setFont("helvetica", style).setFontSize(size).setTextColor(...color);
  const india = entity.country === "IN";
  const title = india && inv.tax_lines && inv.tax_lines.length ? "TAX INVOICE" : "INVOICE";

  // Header: mark + wordmark left, title and number right, indigo rule under.
  drawOneVioMark(doc, L, 34, 34);
  font("bold", 20).text("One", L + 42, 58);
  font("bold", 20, PDF_INDIGO).text("Vio", L + 42 + doc.getTextWidth("One"), 58);
  font("bold", 18).text(title, R, 52, { align: "right" });
  font("normal", 10, PDF_SLATE).text(pdfText(`# ${inv.number}`), R, 68, { align: "right" });
  doc.setFillColor(...PDF_INDIGO).rect(L, 84, CW, 2.5, "F");

  // From / Bill to columns.
  let y = 108;
  const col = (x, label, lines) => {
    font("bold", 8, PDF_SLATE).text(label, x, y);
    font("bold", 11).text(wrap(lines[0], 240), x, y + 15);
    const rest = wrap(lines.slice(1).filter(Boolean).join("\n"), 240);
    font("normal", 9).text(rest, x, y + 29);
    return y + 29 + rest.length * 11.5;
  };
  const fromEnd = col(L, "FROM", [entity.name, entity.address || "", entity.tax_id ? `${entity.tax_id_label || "Tax ID"}: ${entity.tax_id}` : "",
    india && entity.state ? `State: ${entity.state}` : ""]);
  const billEnd = col(L + CW / 2 + 10, "BILL TO", [inv.account_name, account.billingAddress || "",
    account.customerTaxId ? `Tax ID: ${account.customerTaxId}` : "", inv.sent_to || ""]);
  y = Math.max(fromEnd, billEnd) + 14;

  // Details strip.
  const facts = [["Issue date", pdfDate(inv.issue_date)], ["Due date", pdfDate(inv.due_date)], ["PO number", pdfText(po && po.po_number)], ["Currency", inv.currency]];
  doc.setFillColor(...PDF_TINT).setDrawColor(...PDF_LINE).roundedRect(L, y, CW, 42, 4, 4, "FD");
  facts.forEach(([k, v], i) => { const x = L + 14 + i * (CW / 4);
    font("bold", 7.5, PDF_SLATE).text(k.toUpperCase(), x, y + 16); font("bold", 10).text(v || "-", x, y + 31); });
  y += 62;

  // Line items.
  const cQty = 360, cRate = 455, head = () => {
    doc.setFillColor(...PDF_INDIGO).rect(L, y, CW, 22, "F");
    font("bold", 8.5, [255, 255, 255]).text("DESCRIPTION", L + 10, y + 14.5).text("QTY", cQty, y + 14.5, { align: "right" })
      .text("RATE", cRate, y + 14.5, { align: "right" }).text("AMOUNT", R - 10, y + 14.5, { align: "right" });
    y += 22; };
  head();
  inv.line_items.forEach((l, i) => {
    const desc = wrap(l.description, cQty - L - 60), h = Math.max(desc.length, 1) * 12 + 12;
    if (y + h > 740) { doc.addPage(); y = 50; head(); }
    if (i % 2) doc.setFillColor(...PDF_TINT).rect(L, y, CW, h, "F");
    font("normal", 9.5).text(desc, L + 10, y + 15).text(String(l.qty), cQty, y + 15, { align: "right" })
      .text(money(l.rate), cRate, y + 15, { align: "right" }).text(money(l.amount), R - 10, y + 15, { align: "right" });
    y += h; });
  doc.setDrawColor(...PDF_LINE).line(L, y, R, y);
  y += 18;

  // Totals, right-aligned, ending in an indigo "Total due" bar.
  const tx = 330;
  if (y > 680) { doc.addPage(); y = 50; }
  const trow = (label, val) => { font("normal", 9.5, PDF_SLATE).text(label, tx, y); font("normal", 9.5).text(val, R - 10, y, { align: "right" }); y += 16; };
  trow("Subtotal", money(inv.subtotal));
  for (const t of inv.tax_lines || []) trow(pdfText(`${t.label} (${t.pct}%)`), money(t.amount));
  if (inv.tax_exempt) trow("Tax", "Exempt");
  y += 2;
  doc.setFillColor(...PDF_INDIGO).roundedRect(tx - 10, y - 4, R - tx + 10, 28, 3, 3, "F");
  font("bold", 11, [255, 255, 255]).text("Total due", tx, y + 14).text(money(inv.total), R - 10, y + 14, { align: "right" });
  y += 42;

  // Notes, LUT, payment panel.
  const note = t => { const n = wrap(t, CW); if (y + n.length * 11 > 760) { doc.addPage(); y = 50; } font("normal", 8.5, PDF_SLATE).text(n, L, y); y += n.length * 11 + 6; };
  if (inv.tax_note) note(inv.tax_note);
  if (india && entity.lut_number && !(inv.tax_lines || []).length) note(`Supply meant for export under LUT No. ${entity.lut_number}, without payment of IGST.`);
  y += 6;
  const bank = entity.bank_details ? wrap(entity.bank_details, CW - 28) : [];
  const ph = 44 + bank.length * 11.5;
  if (y + ph > 770) { doc.addPage(); y = 50; }
  doc.setDrawColor(...PDF_LINE).setFillColor(255, 255, 255).roundedRect(L, y, CW, ph, 4, 4, "FD");
  font("bold", 8, PDF_SLATE).text("PAYMENT DETAILS", L + 14, y + 17);
  font("bold", 9.5).text(pdfText(`Please pay ${money(inv.total)} by ${pdfDate(inv.due_date)}, quoting ${inv.number}.`), L + 14, y + 31);
  if (bank.length) font("normal", 9).text(bank, L + 14, y + 45);

  // Footer on every page.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...PDF_LINE).line(L, 800, R, 800);
    font("normal", 8, PDF_SLATE).text(pdfText(`Thank you for your business · ${entity.name}`), L, 814)
      .text(`Page ${p} of ${pages}`, R, 814, { align: "right" });
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
      if (up.error) throw new Error(`${inv.number} was created but the PDF upload failed: ${up.error.message}. It shows as Unsent; use Retry send in the list, which rebuilds the PDF.`);
      const at = await sb.rpc("attach_invoice_pdf", { p_id: inv.id, p_path: path });
      if (at.error) throw new Error(`${inv.number} was created but attaching the PDF failed: ${at.error.message}. It shows as Unsent; use Retry send in the list, which rebuilds the PDF.`);
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
