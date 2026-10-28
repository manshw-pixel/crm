/* ---------------------- shared-drive folder sync ---------------------- */
const FS_SUPPORTED = "showDirectoryPicker" in window;
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open("crm-sync", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("handles");
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const idbSet = async (k, v) => { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction("handles", "readwrite"); tx.objectStore("handles").put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
const idbGet = async k => { const db = await idb(); return new Promise((res, rej) => { const rq = db.transaction("handles").objectStore("handles").get(k); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); };
const idbDel = async k => { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction("handles", "readwrite"); tx.objectStore("handles").delete(k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
// Chrome only lets requestPermission run inside a user gesture (a click). A folder handle
// restored from IndexedDB after a reload is back at "prompt", so the 5-minute auto-scan must
// only QUERY: asking from a timer throws "User activation is required", which used to land
// in the sync log every 5 minutes while the folder silently stopped syncing.
async function ensurePermission(handle, mode = "read", interactive = true) {
  if (await handle.queryPermission({ mode }) === "granted") return true;
  if (!interactive) return false;
  return (await handle.requestPermission({ mode })) === "granted";
}
// Every .csv and .xlsx directly in the folder (Excel's ~$ lock files skipped). A file that cannot be read
// (typically an online-only OneDrive / Google Drive placeholder) comes back as { name, err } instead of
// aborting the whole folder, so the card can say which file and why.
async function listFeedFiles(dirHandle) {
  const out = [];
  for await (const [name, h] of dirHandle.entries()) {
    if (h.kind !== "file" || !/\.(csv|xlsx)$/i.test(name) || name.startsWith("~$")) continue;
    try { out.push(await h.getFile()); } catch (e) { out.push({ name, err: e.message || String(e) }); }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
// ExcelJS is only fetched when a template is downloaded or an .xlsx is synced -- never on app start.
const EXCELJS_URL = "https://unpkg.com/exceljs@4.4.0/dist/exceljs.min.js";
const EXCELJS_SRI = "sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz";
let excelJsPromise = null;
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!excelJsPromise) excelJsPromise = new Promise((res, rej) => {
    const el = Object.assign(document.createElement("script"), { src: EXCELJS_URL, integrity: EXCELJS_SRI, crossOrigin: "anonymous" });
    el.onload = () => window.ExcelJS ? res(window.ExcelJS) : rej(new Error("Excel library did not load"));
    el.onerror = () => { el.remove(); rej(new Error("Excel library could not be downloaded")); };
    document.head.appendChild(el);
  }).catch(e => { excelJsPromise = null; throw e; }); // a failed load can be retried
  return excelJsPromise;
}
// An .xlsx becomes the CSV File the importers already take; its name keeps .csv so CSV-only code paths
// stay unchanged, and lastModified is carried over. The caller keeps the original name for the signature.
async function xlsxToCsvFile(file) {
  let rows;
  try {
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets.find(w => !w.state || w.state === "visible");
    if (!ws) throw new Error("no visible worksheet");
    rows = sheetRows(Array.from(ws.getSheetValues().slice(1), r => r ? Array.from(r).slice(1) : []));
  } catch (e) { throw new Error("can't read Excel file: " + ((e && e.message) || String(e))); }
  return new File([rowsToCSV(rows)], file.name.replace(/\.xlsx$/i, ".csv"), { lastModified: file.lastModified });
}
const asImportFile = f => /\.xlsx$/i.test(f.name) ? xlsxToCsvFile(f) : Promise.resolve(f);
const colLetter = n => { let s = ""; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
// rows[0] is the header. dropdowns maps a header to its allowed values (list validation on rows 2-500);
// a list that can't go inline (over Excel's 255-char limit, or containing a comma/quote) goes on a hidden Lists sheet.
async function downloadXlsxTemplate(name, rows, dropdowns = {}) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1 }] });
  rows.forEach(r => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  let lists = null, listCol = 0;
  const lastRow = Math.max(500, rows.length + 500); // prefilled templates keep room for new rows below the data
  rows[0].forEach((h, i) => {
    const vals = (dropdowns[h] || []).map(String).filter(v => v !== "");
    if (!vals.length) return;
    const inline = vals.join(",");
    let formula;
    if (inline.length <= 250 && !/[,"]/.test(vals.join(""))) formula = `"${inline}"`;
    else {
      lists = lists || wb.addWorksheet("Lists", { state: "hidden" });
      const c = ++listCol, L = colLetter(c - 1);
      vals.forEach((v, j) => { lists.getCell(j + 1, c).value = v; });
      formula = `Lists!$${L}$1:$${L}$${vals.length}`;
    }
    const L = colLetter(i);
    ws.dataValidations.add(`${L}2:${L}${lastRow}`, { type: "list", allowBlank: true, formulae: [formula], showErrorMessage: true,
      errorStyle: "stop", errorTitle: h, error: "Pick a value from the list" });
  });
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const el = Object.assign(document.createElement("a"), { href: url, download: name });
  el.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// processed[sig] was `true` in older data; it now holds the import date
function fileSyncStatus(f, processed) {
  if (f.err) return { kind: "error", text: "can't read — if it's online-only, set it to “Always keep on this device”" };
  const done = processed[`${f.name}|${f.lastModified}`];
  if (done) return { kind: "done", text: typeof done === "string" ? `imported ${fmtDate(done)}` : "imported" };
  const older = Object.keys(processed).some(k => k.startsWith(f.name + "|"));
  return { kind: "new", text: older ? "changed — imports on next sync" : "new — imports on next sync" };
}
// One folder's card: status, folder controls, file list, last sync, template downloads. Presentation only --
// IntegrationsCard owns the state and the single shared sync.
function FeedCard({ feed, label, hint, handle, needsGrant, files, processed, busy, lastSync, onPick, onClear, onSync, templates, notice, children }) {
  const status = !handle ? "Not set" : needsGrant ? "Needs access" : "Connected";
  const tone = status === "Connected" ? "text-emerald-600" : status === "Needs access" ? "text-amber-700" : "text-slate-500";
  return (
    <section data-feed={feed} className="nm-inset min-w-0 space-y-2 !rounded-xl p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-semibold">{label}</h4>
        <span data-status className={`text-xs font-semibold ${tone}`}>{status}</span>
      </div>
      <div className="text-xs text-slate-500">{notice || hint}</div>
      <div className="flex flex-wrap items-center gap-2">
        {handle ? <><span className="nm-inset !rounded-full px-2 py-0.5 text-xs">📁 {handle.name}</span>
          {needsGrant && !notice && <span data-grant={feed} className="flex items-center gap-1.5 text-xs text-amber-700">Access expired —
            <Btn onClick={onSync}>Grant access</Btn></span>}
          <button className="text-xs text-rose-500 hover:underline" onClick={onClear}>disconnect</button></>
          : <Btn onClick={onPick}>Choose folder…</Btn>}
        {handle && !notice && <Btn kind="primary" onClick={onSync}>{busy ? "Syncing…" : "Sync now"}</Btn>}
      </div>
      <div className="text-xs text-slate-500">{lastSync ? `Last sync ${fmtDate(lastSync)}` : "Never synced"}</div>
      {files && <ul data-files={feed} className="space-y-0.5 text-xs">
        {files.length === 0 && <li className="text-slate-500">No .csv or .xlsx files directly in this folder (subfolders aren't read).</li>}
        {files.map(f => { const s = fileSyncStatus(f, processed); return (
          <li key={f.name} data-file={f.name} className="flex items-center gap-2">
            <span className={s.kind === "done" ? "text-emerald-600" : s.kind === "new" ? "text-amber-600" : "text-rose-600"}>{s.kind === "done" ? "✓" : s.kind === "new" ? "⏳" : "⚠"}</span>
            <span className="truncate font-medium text-slate-700">{f.name}</span>
            <span className="shrink-0 text-slate-500">{s.text}</span>
          </li>); })}
      </ul>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Templates</span>
        {templates.map(([name, xlsx, csv, attr]) => <span key={name} className="inline-flex items-center gap-1">
          <Btn onClick={xlsx} {...(attr ? { [attr]: true } : {})}>{name}</Btn>
          <button type="button" data-csv-template={name} className="text-xs text-slate-500 hover:underline" onClick={csv}>CSV</button></span>)}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </section>
  );
}
function SyncLog({ log }) {
  const [filter, setFilter] = useState("All");
  const rows = [...log].reverse().filter(l => filter === "All" ? true : filter === "Errors" ? l.err : l.folder === filter.toLowerCase());
  return (
    <div data-synclog className="mt-3 border-t border-slate-100 pt-2 text-xs">
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <span className="mr-1 font-semibold text-slate-600">Activity</span>
        {["All", "Sales", "Finance", "Errors"].map(f => <button key={f} type="button" data-log-filter={f} onClick={() => setFilter(f)}
          className={`rounded-full px-2 py-0.5 ${filter === f ? "grad font-bold text-white" : "nm-btn text-slate-700"}`}>{f}</button>)}
      </div>
      <div className="max-h-48 overflow-y-auto">
        {rows.length === 0 && <div className="py-0.5 text-slate-500">{log.length === 0 ? "No activity yet" : filter === "Errors" ? "No errors" : "No entries"}</div>}
        {rows.map((l, i) => <div key={i} {...(l.err ? { "data-log-err": true } : {})} className={`py-0.5 ${l.err ? "text-rose-600" : "text-slate-600"}`}>{fmtDate(l.t)} · <b>{l.folder}</b> · {l.file}: {l.msg}</div>)}
      </div>
    </div>
  );
}
function IntegrationsCard({ st, dispatch, user }) {
  const [handles, setHandles] = useState({ sales: null, finance: null });
  const [busy, setBusy] = useState(false);
  // folders whose access lapsed (e.g. after a reload) and need one click to re-grant
  const [needsGrant, setNeedsGrant] = useState({ sales: false, finance: false });
  const integ = { processed: {}, log: [], ...(st.settings.integrations || {}) };
  const [files, setFiles] = useState({ sales: null, finance: null }); // what is in each folder right now
  const refreshFiles = async (key, h) => {
    if (!h || await h.queryPermission({ mode: "read" }) !== "granted") return setFiles(s => ({ ...s, [key]: null }));
    try { const list = await listFeedFiles(h); setFiles(s => ({ ...s, [key]: list })); } catch (e) { setFiles(s => ({ ...s, [key]: null })); }
  };
  useEffect(() => { (async () => {
    try {
      const h = { sales: await idbGet("sales") || null, finance: await idbGet("finance") || null };
      setHandles(h);
      const lapsed = {};
      for (const key of ["sales", "finance"]) lapsed[key] = !!h[key] && !(await ensurePermission(h[key], "read", false));
      setNeedsGrant(lapsed);
      for (const key of ["sales", "finance"]) await refreshFiles(key, h[key]);
    } catch (e) {}
  })(); }, []);
  const pick = async key => {
    try { const h = await window.showDirectoryPicker({ mode: "read" }); await idbSet(key, h); setHandles(s => ({ ...s, [key]: h })); setNeedsGrant(s => ({ ...s, [key]: false })); refreshFiles(key, h); }
    catch (e) { /* user cancelled */ }
  };
  // template downloads prefilled with current data — drop into the shared-drive folder, edit, sync picks it up
  const download = (name, text) => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const el = Object.assign(document.createElement("a"), { href: url, download: name });
    el.click(); URL.revokeObjectURL(url);
  };
  // Each template is built once as CSV text; the Excel version is the same rows plus dropdowns.
  const xlsx = (name, csvText, dropdowns) => downloadXlsxTemplate(name.replace(/\.csv$/i, ".xlsx"), parseCSV(csvText), dropdowns)
    .catch(e => window.alert("Couldn't make the Excel template: " + ((e && e.message) || e) + ". Use the CSV link instead."));
  const YES_NO = ["Yes", "No"];
  const checklist = () => (st.settings && st.settings.implChecklist) || DEFAULT_IMPL_CHECKLIST;
  // The values the accounts importer accepts (src/17-csv.jsx). Churned is left out on purpose: the import refuses it.
  // csm is skipped when there is no active team member, so the template never carries an empty list.
  const accountDropdowns = () => {
    const csms = [...new Set((st.team || []).filter(u => !u.disabled && u.name).map(u => u.name))];
    return { tier: ["Enterprise", "Mid", "SMB"], contractStatus: ["Active", "Auto-renew", "In negotiation", "Churn risk"], currency: CURRENCIES,
      ...(csms.length ? { csm: csms } : {}), dedicatedSupport: YES_NO, billingCompleted: YES_NO, caseStudy: YES_NO, approvedSavings: YES_NO, approvedRoi: YES_NO };
  };
  const salesCSV = () => accountsCSVText(st.accounts.map(a => { const score = healthScore(a, st.activities, st.settings.weights, st.settings);
    return { ...a, score, risk: riskOf(score), arrUSD: toUSD(a.arr, a.currency, st.settings.rates) }; }));
  const onboardingCSV = () => {
    const head = accountsCSVText([]).split("\n")[0].split(",");
    const cols = [...head, "destination", ...checklist().map(i => i.id)];
    const ex = cols.map(c => c === "name" ? "Example Co (delete this row)" : c === "destination" ? "onboarding" : "");
    return [cols.join(","), ex.map(c => c === "Example Co (delete this row)" ? csvCell(c) : c).join(",")].join("\n");
  };
  const onboardingDropdowns = () => ({ ...accountDropdowns(), destination: ["onboarding", "accounts"],
    ...Object.fromEntries(checklist().filter(i => i.kind === "check").map(i => [i.id, YES_NO])) });
  const billingCSV = () => ["accountNo,name,billingCompletedDate",
    ...st.accounts.map(a => [a.accountNo, a.name, a.billingCompletedDate || ""].map(csvCell).join(","))].join("\n");
  const PO_DROPDOWNS = { currency: ["INR", "USD", "PHP"], billing_cycle: ["quarterly", "half_yearly", "annual"], years: Array.from({ length: 10 }, (_, i) => String(i + 1)) };
  // [label, Excel download, CSV download, extra attribute for the Excel button]
  const templateSet = (label, name, csvText, dropdowns, attr) => [label, () => xlsx(name, csvText(), dropdowns()), () => download(name, csvText()), attr];
  const clear = async key => { await idbDel(key); setHandles(s => ({ ...s, [key]: null })); setNeedsGrant(s => ({ ...s, [key]: false })); setFiles(s => ({ ...s, [key]: null })); };
  // interactive = started by a click (Sync now / Grant access), so it may ask for permission;
  // the timer passes false and skips a lapsed folder quietly -- the card shows it instead.
  // One sales CSV: import the accounts, then turn rows marked destination=onboarding into
  // implementation projects. f is File-like ({ name, lastModified, ... }, readable by FileReader).
  // plannedProjects carries projects planned earlier in the same sync pass (the store has not
  // re-rendered yet), so two files can't both queue a project for one account.
  const syncSalesFile = async (f, plannedProjects = [], fileName = f.name) => {
    const r = await new Promise(res => importAccountsCSV(f, st.accounts, dispatch, res, user, st.settings && st.settings.customFields));
    let msg = importSummary(r);
    if (r.err) return { msg, err: true };
    const cells = r.cells || [];
    const dflt = integ.salesDefault || "accounts";
    const hasCol = cells.some(c => c && Object.prototype.hasOwnProperty.call(c, "destination"));
    if (!hasCol && dflt !== "onboarding") return { msg, err: false };
    const template = (st.settings && st.settings.implChecklist) || DEFAULT_IMPL_CHECKLIST;
    let queued = 0, drafts = 0, skipped = 0; const missingSet = new Set(); const reasons = {};
    const skip = why => { skipped++; reasons[why] = (reasons[why] || 0) + 1; };
    (r.rowAccounts || []).forEach((ra, i) => {
      if (!ra || !ra.name) return;
      const dest = rowDestination(cells[i] && cells[i].destination, ra.created ? dflt : "accounts");
      if (dest === "accounts") return;
      if (dest && dest.unknown !== undefined) return skip(`unknown destination "${dest.unknown}"`);
      const plan = planOnboardingRow({ accountId: ra.id, cells: cells[i] || {}, template, order: r.order,
        projects: [...(st.projects || []), ...plannedProjects], user, now: iso(Date.now()), file: fileName, newId: uid() });
      if (plan.kind === "skip") return skip(plan.reason);
      plannedProjects.push(plan.project);
      dispatch({ type: "ADD_PROJECT", item: plan.project });
      if (plan.kind === "queued") queued++; else { drafts++; (plan.project.missing || []).forEach(l => missingSet.add(l)); }
    });
    msg += ` · projects queued ${queued} · drafts ${drafts}${drafts ? ` (missing: ${template.map(it => it.label || it.id).filter(l => missingSet.has(l)).join(", ")})` : ""} · skipped ${skipped}`;
    if (skipped) msg += ` (${Object.entries(reasons).map(([k, n]) => `${k}: ${n}`).join(", ")})`;
    return { msg, err: false };
  };
  // One finance CSV, recognised by its header: purchase orders (+ their PDFs from the same folder),
  // invoice payments, or the legacy billing-completed-date file. Row problems are counted, never thrown.
  const syncFinanceFile = async (f, dirHandle) => {
    const rows = parseCSV(await f.text());
    const kind = financeFileKind(rows[0] || []);
    if (!kind) return { msg: "unrecognised finance file (needs po_number, invoice_number or billingCompletedDate columns)", err: true };
    if (kind === "billing") {
      const r = importBillingCSV(await f.text(), st.accounts, dispatch);
      return { msg: r.err || `billing updated ${r.updated} · skipped ${r.skipped}${r.badDate ? ` · ⚠ ${r.badDate} unreadable date(s)` : ""}`, err: !!r.err };
    }
    const reasons = {}; let refused = 0;
    const refuse = why => { refused++; reasons[why] = (reasons[why] || 0) + 1; };
    const tail = () => `refused ${refused}${refused ? ` (${Object.entries(reasons).map(([k, n]) => `${k}: ${n}`).join(", ")})` : ""}`;
    if (kind === "po") {
      const plan = planPORows(rows, st.accounts);
      if (plan.err) return { msg: plan.err, err: true };
      const findPdf = async name => {
        try { return await (await dirHandle.getFileHandle(name)).getFile(); } catch (e) { /* fall through to a case-insensitive scan */ }
        for await (const [n, h] of dirHandle.entries()) if (h.kind === "file" && n.toLowerCase() === name.toLowerCase()) return await h.getFile();
        return null;
      };
      let submitted = 0, already = 0;
      for (const it of plan.items) {
        if (!it.ok) { refuse(it.reason); continue; }
        let file = null;
        try { file = await findPdf(it.poFile); } catch (e) { refuse(`PDF ${it.poFile} can't be read`); continue; }
        if (!file) { refuse(`PDF ${it.poFile} not found`); continue; }
        try { await savePO({ account: it.account, file, v: it.v, orgId: (user && user.org_id) || CURRENT_ORG }); submitted++; }
        catch (e) { const m = (e && e.message) || String(e); if (/already exists on this account/.test(m)) already++; else refuse(m); }
      }
      const missingPdf = Object.keys(reasons).some(k => /^PDF .* not found$/.test(k));
      return { msg: `POs submitted ${submitted} · already imported ${already} · ${tail()}${missingPdf ? " — add the missing PDF(s) and re-save the CSV to retry" : ""}`, err: plan.items.length > 0 && refused === plan.items.length };
    }
    const inv = await sb.from("invoices").select("id,number,status");
    if (inv.error) return { msg: inv.error.message, err: true };
    const plan = planPaymentRows(rows, inv.data || []);
    if (plan.err) return { msg: plan.err, err: true };
    let paid = 0, waived = 0;
    for (const it of plan.items) {
      if (!it.ok) { refuse(it.reason); continue; }
      let r;
      try { r = await sb.rpc("set_invoice_status", { p_id: it.invoiceId, p_status: it.status, p_paid_date: it.paidDate, p_ref: it.ref, p_reason: it.reason }); }
      catch (e) { r = { error: { message: (e && e.message) || String(e) } }; }
      if (r.error) refuse(r.error.message); else if (it.status === "paid") paid++; else waived++;
    }
    return { msg: `invoices paid ${paid} · waived ${waived} · ${tail()}`, err: plan.items.length > 0 && refused === plan.items.length };
  };
  // QA only: the File System Access picker can't be driven by the live QA runner, so this feeds one sales CSV through the
  // same syncSalesFile + processed/log path as a real sync. Exposed only when the runner sets window.__qaHooks (addInitScript).
  const qaSync = useRef(null);
  qaSync.current = async (name, text, lastModified) => {
    const sig = `${name}|${lastModified}`;
    if (integ.processed[sig]) return { skipped: true };
    const o = await syncSalesFile(new File([text], name, { lastModified }));
    const log = [...integ.log, { t: iso(Date.now()), folder: "sales", file: name, msg: o.msg, err: !!o.err }];
    dispatch({ type: "SET_INTEGRATIONS", integrations: { processed: { ...integ.processed, [sig]: iso(Date.now()) }, log: log.slice(-20) } });
    return { msg: o.msg, err: !!o.err };
  };
  useEffect(() => {
    if (!window.__qaHooks) return;
    window.__syncSalesText = (name, text, lastModified) => qaSync.current(name, text, lastModified);
    return () => { delete window.__syncSalesText; };
  }, []);
  // QA only: files = [{ name, text | bytes (base64), lastModified }]. CSVs go through syncFinanceFile; every file
  // (PDFs included) is served by an in-memory dir whose getFileHandle(name) the PO import reads PDFs from.
  const qaFinance = useRef(null);
  qaFinance.current = async files => {
    const mk = x => new File([x.bytes ? Uint8Array.from(atob(x.bytes), c => c.charCodeAt(0)) : x.text || ""], x.name, { lastModified: x.lastModified || 0 });
    const made = files.map(mk);
    const dir = {
      async getFileHandle(n) { const f = made.find(m => m.name === n); if (!f) throw new DOMException("not found", "NotFoundError"); return { kind: "file", getFile: async () => f }; },
      async *entries() { for (const f of made) yield [f.name, { kind: "file", getFile: async () => f }]; },
    };
    const processed = { ...integ.processed }; const log = [...integ.log]; const out = [];
    for (const f of made.filter(m => /\.csv$/i.test(m.name))) {
      const sig = `${f.name}|${f.lastModified}`;
      if (processed[sig]) { out.push({ skipped: true }); continue; }
      const o = await syncFinanceFile(f, dir);
      log.push({ t: iso(Date.now()), folder: "finance", file: f.name, msg: o.msg, err: !!o.err });
      processed[sig] = iso(Date.now());
      out.push({ msg: o.msg, err: !!o.err });
    }
    dispatch({ type: "SET_INTEGRATIONS", integrations: { processed, log: log.slice(-20) } });
    return out;
  };
  useEffect(() => {
    if (!window.__qaHooks) return;
    window.__syncFinanceFiles = files => qaFinance.current(files);
    return () => { delete window.__syncFinanceFiles; };
  }, []);
  const sync = useCallback(async (interactive = true) => {
    if (busy) return; setBusy(true);
    const plannedProjects = [];
    const processed = { ...integ.processed }; const log = [...integ.log];
    const note = (folder, file, msg, err) => log.push({ t: iso(Date.now()), folder, file, msg, err: !!err });
    for (const key of ["sales", "finance"]) {
      const h = handles[key]; if (!h) continue;
      if (key === "finance" && !canFinance(user)) continue;
      try {
        if (!await ensurePermission(h, "read", interactive)) {
          setNeedsGrant(s => ({ ...s, [key]: true }));
          if (interactive) note(key, "—", "permission denied", true);
          continue;
        }
        setNeedsGrant(s => ({ ...s, [key]: false }));
        const list = await listFeedFiles(h);
        for (const f of list) {
          if (f.err) { note(key, f.name, fileSyncStatus(f, processed).text, true); continue; }
          const sig = `${f.name}|${f.lastModified}`;
          if (processed[sig]) continue;
          try {
            const imp = await asImportFile(f); // an .xlsx arrives as CSV text; f.name stays the log name and signature
            if (key === "sales") { const o = await syncSalesFile(imp, plannedProjects, f.name); note(key, f.name, o.msg, o.err); }
            else { const o = await syncFinanceFile(imp, h); note(key, f.name, o.msg, o.err); }
            processed[sig] = iso(Date.now());
          } catch (ex) { // still retried next sync, but an unchanged failure is not re-logged (it would flush the 20-entry log)
            const prev = [...log].reverse().find(l => l.folder === key && l.file === f.name);
            if (!(prev && prev.err && prev.msg === ex.message)) note(key, f.name, ex.message, true); }
        }
        setFiles(s => ({ ...s, [key]: list }));
      } catch (ex) { note(key, "—", ex.message, true); }
    }
    dispatch({ type: "SET_INTEGRATIONS", integrations: { processed, log: log.slice(-20) } });
    setBusy(false);
  }, [handles, st, busy, dispatch, user]);
  useEffect(() => { // auto-scan every 5 minutes while a folder is connected
    if (!handles.sales && !handles.finance) return;
    const t = setInterval(() => sync(false), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [handles, sync]);
  if (!FS_SUPPORTED) return <Card title="Integrations — shared drive"><p className="text-sm text-slate-500">Folder sync needs Chrome or Edge (File System Access API).</p></Card>;
  const lastSync = feed => integ.log.filter(l => l.folder === feed).reduce((m, l) => (!m || l.t > m ? l.t : m), null);
  const finAllowed = !(window.__qaHooks && window.__qaNoFinance) && canFinance(user); // __qaNoFinance: QA only, renders the finance-only notice
  const common = key => ({ handle: handles[key], needsGrant: needsGrant[key], files: files[key], processed: integ.processed, busy,
    lastSync: lastSync(key), onPick: () => pick(key), onClear: () => clear(key), onSync: () => sync(true) });
  return (
    <Card title="Integrations — shared drive">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <FeedCard feed="sales" label="Sales feed" hint="new-account CSVs (same columns as Accounts → Import CSV)" {...common("sales")}
          templates={[templateSet("Accounts → CSM", "sales-accounts.csv", salesCSV, accountDropdowns),
            templateSet("Onboarding", "sales-onboarding.csv", onboardingCSV, onboardingDropdowns, "data-onboarding-template")]}>
          <label className="flex flex-wrap items-center gap-1 text-xs text-slate-600">Sales rows go to
            <select data-sales-default className="nm-inset rounded px-1 py-0.5 text-xs" value={integ.salesDefault || "accounts"}
              onChange={e => dispatch({ type: "SET_INTEGRATIONS", integrations: { salesDefault: e.target.value } })}>
              <option value="accounts">Accounts (straight to CSM)</option>
              <option value="onboarding">Onboarding (implementation project)</option>
            </select></label>
          <span className="text-xs text-slate-500">Onboarding applies to new accounts only. To start a project for an existing account, put onboarding in its destination column.</span>
        </FeedCard>
        <FeedCard feed="finance" label="Finance feed" hint="purchase orders, payments or billing CSVs — recognised by their columns" {...common("finance")}
          notice={finAllowed ? null : "Only finance users can sync this folder"}
          templates={[templateSet("Purchase orders", "finance-purchase-orders.csv", poTemplateCSV, () => PO_DROPDOWNS),
            templateSet("Payments", "finance-payments.csv", paymentTemplateCSV, () => ({ status: ["paid", "waived"] })),
            templateSet("Billing completed", "finance-billing.csv", billingCSV, () => ({}))]} />
      </div>
      <SyncLog log={integ.log} />
      <p className="mt-2 text-xs text-slate-500">Works in Chrome or Edge, and only while a OneVio tab is open (checks every 5 minutes). Each file is imported once per saved version; editing and re-saving a file imports it again, and duplicate projects and POs are refused, so that's safe. Finance files are recognised by their columns, not their names; put each PO's PDF in the same folder.</p>
    </Card>
  );
}
