/* ------------------------------ contacts import ------------------------------ */
// Bulk-add or update contacts from a .xlsx/.csv. The pure planner (src/lib/contacts-import.js) does the
// matching; this dialog only reads the file, shows the plan and dispatches it. Nothing is saved until Import.
const CI_STATUS = { new: ["green", "New"], update: ["amber", "Update"], same: ["grey", "No change"], error: ["red", "Error"] };
const CI_FILTERS = [["all", "All"], ["new", "New"], ["update", "Update"], ["same", "No change"], ["error", "Errors"]];
const ciSlug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "account";

function ImportContactsDialog({ accounts, contacts, lockAccount, settings, user, dispatch, onClose }) {
  const toast = useToast();
  const [plan, setPlan] = useState(null);
  const [fileName, setFileName] = useState("");
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");
  const fileRef = useRef(null);
  const tplRows = () => contactTemplateRows(lockAccount || undefined);
  const tplName = lockAccount ? `contacts-${ciSlug(lockAccount.name)}` : "contacts";
  const downloadXlsx = () => downloadXlsxTemplate(`${tplName}.xlsx`, tplRows(), CONTACT_DROPDOWNS)
    .catch(e => setErr("Couldn't build the template: " + ((e && e.message) || String(e))));
  const downloadCsv = () => {
    const url = URL.createObjectURL(new Blob([rowsToCSV(tplRows())], { type: "text/csv" }));
    const el = Object.assign(document.createElement("a"), { href: url, download: `${tplName}.csv` });
    el.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const onFile = async f => {
    setErr(""); setPlan(null); setFilter("all"); setFileName(f.name);
    try {
      const csv = await asImportFile(f);
      const rows = parseCSV(await csv.text());
      const p = planContactImport({ rows, accounts, contacts, lockAccountId: lockAccount ? lockAccount.id : null, newId: uid });
      if (p.err) { setErr(p.err); return; }
      if (!p.rows.length) { setErr("No contact rows found in this file."); return; }
      setPlan(p);
    } catch (e) { setErr((e && e.message) || String(e)); }
  };
  const counts = plan ? plan.counts : { new: 0, update: 0, same: 0, error: 0 };
  const total = plan ? plan.rows.length : 0;
  const n = counts.new + counts.update;
  const shown = plan ? plan.rows.filter(r => filter === "all" || r.status === filter).slice(0, 200) : [];
  const step = !plan ? (fileName ? 2 : 1) : 3;
  const doImport = () => {
    if (!plan || n === 0) return;
    dispatch({ type: "IMPORT_CONTACTS", adds: plan.adds, patches: plan.patches });
    const entry = { at: new Date().toISOString(), by: (user && (user.name || user.email)) || "", file: fileName,
      added: counts.new, updated: counts.update, errors: counts.error };
    const log = [...((settings && settings.contactImports) || []), entry].slice(-20);
    dispatch({ type: "SET_CONTACT_IMPORTS", log });
    onClose();
    toast({ text: `Imported ${n} contacts (${counts.new} new, ${counts.update} updated) · ${counts.error} skipped`, tone: "success" });
  };
  const steps = ["Download template", "Upload file", "Check rows", "Import"];
  return (
    <Modal label={lockAccount ? `Import contacts to ${lockAccount.name}` : "Import contacts"} onClose={onClose}
      data-contacts-import style={{ maxWidth: 880 }}>
      <h2 className="ad-h2">Import contacts{lockAccount ? <> · <span className="ad-n">{lockAccount.name}</span></> : null}</h2>
      <ol aria-label="Steps" className="mb-3 flex flex-wrap gap-2 text-xs">
        {steps.map((s, i) => <li key={s} data-step={i + 1} aria-current={step === i + 1 ? "step" : undefined}
          className={`ad-pill ad-pill-sm ${step >= i + 1 ? "" : "opacity-60"}`} data-sev={step > i + 1 ? "green" : step === i + 1 ? "amber" : "grey"}>
          {i + 1}. {s}</li>)}
      </ol>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Btn onClick={downloadXlsx} data-contacts-template>Download template</Btn>
        <button type="button" className="st-link" data-contacts-csv-template onClick={downloadCsv}>Download CSV template</button>
        <Btn kind="primary" onClick={() => fileRef.current && fileRef.current.click()}>Upload file</Btn>
        <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" data-contacts-file
          onChange={e => { const f = e.target.files[0]; e.target.value = ""; if (f) onFile(f); }} />
        {fileName && <span className="ad-xs truncate" title={fileName}>{fileName}</span>}
      </div>
      {err && <div role="alert" data-contacts-error className="mb-3 text-xs text-rose-600">{err}</div>}
      {plan && <>
        <div role="group" aria-label="Filter rows" className="mb-2 flex flex-wrap gap-2">
          {CI_FILTERS.map(([k, label]) => <button key={k} type="button" data-import-filter={k} className="acct-quick"
            aria-pressed={filter === k ? "true" : "false"} onClick={() => setFilter(k)}>
            {label}<span className="acct-quick-n">{k === "all" ? total : counts[k]}</span></button>)}
        </div>
        <div className="mb-3 overflow-auto" style={{ maxHeight: "40vh", border: "1px solid var(--line, rgba(127,127,127,.25))", borderRadius: 8 }}>
          <table className="w-full text-left text-xs">
            <thead><tr>{["Row", "Account", "Name", "Role", "Email", "Send surveys", "Result"].map(h =>
              <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{shown.map(r => { const [sev, word] = CI_STATUS[r.status] || CI_STATUS.error; return (
              <tr key={r.n} data-import-row={r.status}>
                <td className="px-2 py-1">{r.n}</td>
                <td className="px-2 py-1">{r.cells.account}</td>
                <td className="px-2 py-1">{r.cells.name}</td>
                <td className="px-2 py-1">{r.cells.role}</td>
                <td className="px-2 py-1" style={{ overflowWrap: "anywhere" }}>{r.cells.email}</td>
                <td className="px-2 py-1">{r.cells.send}</td>
                <td className="px-2 py-1"><span data-sev={sev} className="ad-pill ad-pill-sm">{word}</span>{r.msg ? <span className="ad-xs"> {r.msg}</span> : null}</td>
              </tr>); })}
              {shown.length === 0 && <tr><td colSpan={7} className="ad-empty px-2 py-2">No rows in this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </>}
      <div className="flex flex-wrap items-center gap-2">
        <p className="ad-xs min-w-0 flex-1">{counts.error} rows with errors will be skipped. Nothing is saved until you import.</p>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" data-import-confirm disabled={n === 0} onClick={doImport}>Import {n} contacts</Btn>
      </div>
    </Modal>
  );
}
