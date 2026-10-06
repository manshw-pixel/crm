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
// Every CSV directly in the folder. A file that cannot be read (typically an online-only
// OneDrive / Google Drive placeholder) comes back as { name, err } instead of aborting the
// whole folder, so the card can say which file and why.
async function listCsvFiles(dirHandle) {
  const out = [];
  for await (const [name, h] of dirHandle.entries()) {
    if (h.kind !== "file" || !/\.csv$/i.test(name)) continue;
    try { out.push(await h.getFile()); } catch (e) { out.push({ name, err: e.message || String(e) }); }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
// processed[sig] was `true` in older data; it now holds the import date
function fileSyncStatus(f, processed) {
  if (f.err) return { kind: "error", text: "can't read — if it's online-only, set it to “Always keep on this device”" };
  const done = processed[`${f.name}|${f.lastModified}`];
  if (done) return { kind: "done", text: typeof done === "string" ? `imported ${fmtDate(done)}` : "imported" };
  const older = Object.keys(processed).some(k => k.startsWith(f.name + "|"));
  return { kind: "new", text: older ? "changed — imports on next sync" : "new — imports on next sync" };
}
function IntegrationsCard({ st, dispatch, user }) {
  const [handles, setHandles] = useState({ sales: null, finance: null });
  const [busy, setBusy] = useState(false);
  // folders whose access lapsed (e.g. after a reload) and need one click to re-grant
  const [needsGrant, setNeedsGrant] = useState({ sales: false, finance: false });
  const integ = st.settings.integrations || { processed: {}, log: [] };
  const [files, setFiles] = useState({ sales: null, finance: null }); // what is in each folder right now
  const refreshFiles = async (key, h) => {
    if (!h || await h.queryPermission({ mode: "read" }) !== "granted") return setFiles(s => ({ ...s, [key]: null }));
    try { const list = await listCsvFiles(h); setFiles(s => ({ ...s, [key]: list })); } catch (e) { setFiles(s => ({ ...s, [key]: null })); }
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
  const salesTemplate = () => {
    const rows = st.accounts.map(a => { const score = healthScore(a, st.activities, st.settings.weights, st.settings);
      return { ...a, score, risk: riskOf(score), arrUSD: toUSD(a.arr, a.currency, st.settings.rates) }; });
    download("sales-accounts.csv", accountsCSVText(rows));
  };
  const financeTemplate = () => {
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    download("finance-billing.csv", ["accountNo,name,billingCompletedDate",
      ...st.accounts.map(a => [a.accountNo, a.name, a.billingCompletedDate || ""].map(esc).join(","))].join("\n"));
  };
  const clear = async key => { await idbDel(key); setHandles(s => ({ ...s, [key]: null })); setNeedsGrant(s => ({ ...s, [key]: false })); setFiles(s => ({ ...s, [key]: null })); };
  // interactive = started by a click (Sync now / Grant access), so it may ask for permission;
  // the timer passes false and skips a lapsed folder quietly -- the card shows it instead.
  const sync = useCallback(async (interactive = true) => {
    if (busy) return; setBusy(true);
    const processed = { ...integ.processed }; const log = [...integ.log];
    const note = (folder, file, msg, err) => log.push({ t: iso(Date.now()), folder, file, msg, err: !!err });
    for (const key of ["sales", "finance"]) {
      const h = handles[key]; if (!h) continue;
      try {
        if (!await ensurePermission(h, "read", interactive)) {
          setNeedsGrant(s => ({ ...s, [key]: true }));
          if (interactive) note(key, "—", "permission denied", true);
          continue;
        }
        setNeedsGrant(s => ({ ...s, [key]: false }));
        const list = await listCsvFiles(h);
        for (const f of list) {
          if (f.err) { note(key, f.name, fileSyncStatus(f, processed).text, true); continue; }
          const sig = `${f.name}|${f.lastModified}`;
          if (processed[sig]) continue;
          try {
            if (key === "sales") await new Promise(res => importAccountsCSV(f, st.accounts, dispatch, r =>
              { note(key, f.name, importSummary(r), !!r.err); res(); }, user));
            else { const r = importBillingCSV(await f.text(), st.accounts, dispatch);
              note(key, f.name, r.err || `billing updated ${r.updated} · skipped ${r.skipped}${r.badDate ? ` · ⚠ ${r.badDate} unreadable date(s)` : ""}`, !!r.err); }
            processed[sig] = iso(Date.now());
          } catch (ex) { note(key, f.name, ex.message, true); }
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
  return (
    <Card title="Integrations — shared drive" right={<Btn kind="primary" onClick={() => sync(true)}>{busy ? "Syncing…" : "Sync now"}</Btn>}>
      {[["sales", "Sales folder", "new-account CSVs (same columns as Accounts → Import CSV)"], ["finance", "Finance folder", "billing CSVs: accountNo or name + billingCompletedDate"]].map(([key, label, hint]) => (
        <React.Fragment key={key}>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span className="w-28 font-semibold">{label}</span>
          {handles[key] ? <><span className="nm-inset !rounded-full px-2 py-0.5 text-xs">📁 {handles[key].name}</span>
            {needsGrant[key] && <span data-grant={key} className="flex items-center gap-1.5 text-xs text-amber-700">Access expired —
              <Btn onClick={() => sync(true)}>Grant access</Btn></span>}
            <button className="text-xs text-rose-500 hover:underline" onClick={() => clear(key)}>disconnect</button></>
            : <Btn onClick={() => pick(key)}>Choose folder…</Btn>}
          <span className="ml-auto text-xs text-slate-500">{hint}</span>
        </div>
        {files[key] && <ul data-files={key} className="mb-2 ml-0 space-y-0.5 text-xs sm:ml-[7.5rem]">
          {files[key].length === 0 && <li className="text-slate-500">No .csv files directly in this folder (subfolders aren't read).</li>}
          {files[key].map(f => { const s = fileSyncStatus(f, integ.processed); return (
            <li key={f.name} data-file={f.name} className="flex items-center gap-2">
              <span className={s.kind === "done" ? "text-emerald-600" : s.kind === "new" ? "text-amber-600" : "text-rose-600"}>{s.kind === "done" ? "✓" : s.kind === "new" ? "⏳" : "⚠"}</span>
              <span className="truncate font-medium text-slate-700">{f.name}</span>
              <span className="shrink-0 text-slate-500">{s.text}</span>
            </li>); })}
        </ul>}
        </React.Fragment>
      ))}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Btn onClick={salesTemplate}>Export sales CSV</Btn>
        <Btn onClick={financeTemplate}>Export finance CSV</Btn>
        <span className="text-xs text-slate-500">prefilled with current accounts — save into the OneDrive folder, edit, sync picks it up</span>
      </div>
      <p className="mb-2 text-xs text-slate-500">Point these at folders synced from your shared drive (Google Drive / OneDrive desktop). New CSV files are imported once (re-import by re-saving the file); auto-checks every 5 min while the app is open.</p>
      {integ.log.length > 0 && <div className="max-h-32 overflow-y-auto border-t border-slate-100 pt-2 text-xs">
        {[...integ.log].reverse().map((l, i) => <div key={i} className={`py-0.5 ${l.err ? "text-rose-600" : "text-slate-600"}`}>{fmtDate(l.t)} · <b>{l.folder}</b> · {l.file}: {l.msg}</div>)}
      </div>}
    </Card>
  );
}

