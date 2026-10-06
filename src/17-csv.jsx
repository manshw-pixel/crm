/* ------------------------------ Account list ------------------------------ */
function exportCSV(rows) {
  const url = URL.createObjectURL(new Blob([accountsCSVText(rows)], { type: "text/csv" }));
  const el = Object.assign(document.createElement("a"), { href: url, download: "accounts.csv" });
  el.click(); URL.revokeObjectURL(url);
}
function importAccountsCSV(file, accounts, dispatch, done, user) {
  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCSV(String(reader.result));
    if (rows.length < 2) return done({ ok: 0, updated: 0, skipped: 0, badTier: 0, badStatus: 0, err: "No data rows found — the first row must be a header (name, tier, arr, …)." });
    const norm = s => s.toLowerCase().replace(/[^a-z]/g, "");
    const header = rows[0].map(norm);
    const has = key => header.indexOf(key) >= 0;
    const col = (r, key) => { const i = header.indexOf(key); return i >= 0 ? (r[i] || "").trim() : ""; };
    if (!has("name")) return done({ ok: 0, updated: 0, skipped: 0, badTier: 0, badStatus: 0, err: 'The header row needs a "name" column (matching Export CSV format works).' });
    // dedupe: match on accountNo first, then case-insensitive name — matched rows update the existing account
    const byNo = new Map(accounts.filter(a => a.accountNo).map(a => [String(a.accountNo), a]));
    const byName = new Map(accounts.map(a => [a.name.toLowerCase(), a]));
    let ok = 0, updated = 0, skipped = 0, badTier = 0, badStatus = 0, badDate = 0, badValue = 0;
    const badDateRows = [], churnSkipped = [];
    const DATE_COLS = ["startdate", "transitiondate", "renewaldate", "billingcompleteddate"];
    const allDates = rows.slice(1).flatMap(r => DATE_COLS.map(k => col(r, k)));
    const order = csvDateOrder(allDates);
    if (!order) return done({ ok: 0, updated: 0, skipped: 0, badTier: 0, badStatus: 0, err: "Dates in this file mix DD-MM-YYYY and MM-DD-YYYY, so nothing was imported. Use one format (YYYY-MM-DD is safest) and save again." });
    // "dmy-assumed": numeric d-m-y dates present but none proved the order -- say so in the message
    const proven = allDates.some(v => { const m = CSV_DMY.exec(String(v).trim()); return m && (+m[1] > 12 || +m[2] > 12); });
    const dateOrder = proven ? order : allDates.some(v => CSV_DMY.test(String(v).trim())) ? "dmy-assumed" : "iso";
    rows.slice(1).forEach(r => {
      const name = col(r, "name");
      if (!name) { skipped++; return; }
      const num = (key, dflt) => { const v = parseFloat(col(r, key)); return isNaN(v) ? dflt : v; };
      // unreadable dates are counted and reported, never silently dropped
      const date = v => { const d = parseCsvDate(v, order);
        if (d === null) { badDate++; if (badDateRows.length < 5 && !badDateRows.includes(name)) badDateRows.push(name); }
        return d || null; };
      const vals = { name };
      if (has("tier")) {
        const raw = col(r, "tier");
        const match = ["Enterprise", "Mid", "SMB"].find(t => t.toLowerCase() === raw.toLowerCase());
        // an empty cell is a missing value, not a mis-typed one -- don't report it
        if (raw && !match) badTier++;
        vals.tier = match || "Mid";
      }
      if (has("arr")) vals.arr = Math.max(0, num("arr", 0));
      if (has("currency")) vals.currency = CURRENCIES.includes(col(r, "currency").toUpperCase()) ? col(r, "currency").toUpperCase() : "USD";
      if (has("industry")) vals.industry = col(r, "industry");
      if (has("csm")) vals.csm = col(r, "csm");
      if (has("startdate") && date(col(r, "startdate"))) vals.startDate = date(col(r, "startdate"));
      if (has("transitiondate") && date(col(r, "transitiondate"))) vals.transitionDate = date(col(r, "transitiondate"));
      if (has("renewaldate") && date(col(r, "renewaldate"))) vals.renewalDate = date(col(r, "renewaldate"));
      if (has("contractstatus")) {
        const raw = col(r, "contractstatus");
        const match = ["Active", "Auto-renew", "In negotiation", "Churn risk"].find(s => s.toLowerCase() === raw.toLowerCase());
        // "Churned" is not a plain status: churn needs a date and reason and moves ARR, so it
        // only happens from the account page. Coercing it to Active resurrected churned accounts.
        if (raw.toLowerCase() === "churned") vals.churnedInFile = true;
        else { if (raw && !match) badStatus++; vals.contractStatus = match || "Active"; }
      }
      if (has("modules")) vals.modules = col(r, "modules");
      if (has("licenses")) vals.licenses = Math.max(0, num("licenses", 0));
      if (has("dedicatedsupport")) vals.dedicatedSupport = ["yes", "true", "y", "1"].includes(col(r, "dedicatedsupport").toLowerCase());
      if (has("billingcompleted")) vals.billingCompleted = ["yes", "true", "y", "1"].includes(col(r, "billingcompleted").toLowerCase());
      if (has("billingcompleteddate") && date(col(r, "billingcompleteddate"))) vals.billingCompletedDate = date(col(r, "billingcompleteddate"));
      const inputPatch = clampInputs({ usage: col(r, "usage"), sentiment: col(r, "sentiment"), tickets: col(r, "tickets"), nps: col(r, "nps") });
      // Value answers: blank = leave alone, unreadable = count it and leave alone
      const valPatch = {};
      Object.entries(VALUE_COL).forEach(([header, key]) => {
        if (!has(header.toLowerCase())) return;
        const raw = col(r, header.toLowerCase()).trim().toLowerCase();
        if (raw === "") return;
        if (["yes", "true", "1"].includes(raw)) valPatch[key] = true;
        else if (["no", "false", "0"].includes(raw)) valPatch[key] = false;
        else badValue++;
      });
      const hasVal = Object.keys(valPatch).length > 0;
      const no = +col(r, "accountno") || 0;
      const existing = (no && byNo.get(String(no))) || byName.get(name.toLowerCase());
      if (vals.churnedInFile) {
        delete vals.churnedInFile;
        // already churned here: refresh the other fields, leave the churn alone
        if (!existing?.churn) { churnSkipped.push(name); return; }
      }
      if (existing) {
        dispatch({ type: "EDIT_ACCOUNT", id: existing.id, patch: vals, by: user?.name, source: "csv import" });
        // health columns update the score too (recomputes and logs history, like ✎ Update health)
        // keep only answers that differ from the stored one, so re-importing our own export logs nothing
        const stored = existing.inputs?.value || {};
        const changed = Object.fromEntries(Object.entries(valPatch).filter(([k, v]) => v !== !!stored[k]));
        const patchIn = Object.keys(changed).length ? { ...inputPatch, value: { ...stored, ...changed } } : inputPatch;
        if (Object.keys(patchIn).length) dispatch({ type: "UPDATE_INPUTS", id: existing.id, inputs: patchIn });
        updated++;
      } else {
        const item = { id: uid(), tier: "Mid", arr: 0, currency: "USD", industry: "", csm: "",
          startDate: iso(Date.now()), renewalDate: addDays(365), contractStatus: "Active",
          modules: "", licenses: 0, dedicatedSupport: false, ...vals, ...(no ? { accountNo: no } : {}),
          inputs: { ...DEFAULT_INPUTS, ...inputPatch, ...(hasVal ? clampInputs({ value: valPatch }) : {}) },
          history: [], inputsUpdatedAt: iso(Date.now()) };
        dispatch({ type: "ADD_ACCOUNT", item });
        byName.set(name.toLowerCase(), item);
        if (no) byNo.set(String(no), item);
        ok++;
      }
    });
    done({ ok, updated, skipped, badTier, badStatus, badDate, badValue, badDateRows, churnSkipped, dateOrder });
  };
  reader.readAsText(file);
}
/* finance CSV: accountNo and/or name + billingCompletedDate — marks billing completed */
function importBillingCSV(text, accounts, dispatch) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { updated: 0, skipped: 0, err: "no data rows" };
  const norm = s => s.toLowerCase().replace(/[^a-z]/g, "");
  const header = rows[0].map(norm);
  const col = (r, key) => { const i = header.indexOf(key); return i >= 0 ? (r[i] || "").trim() : ""; };
  if (header.indexOf("billingcompleteddate") < 0) return { updated: 0, skipped: 0, err: 'needs a "billingCompletedDate" column' };
  const byNo = new Map(accounts.filter(a => a.accountNo).map(a => [String(a.accountNo), a]));
  const byName = new Map(accounts.map(a => [a.name.toLowerCase(), a]));
  const order = csvDateOrder(rows.slice(1).map(r => col(r, "billingcompleteddate")));
  if (!order) return { updated: 0, skipped: 0, err: "dates mix DD-MM-YYYY and MM-DD-YYYY — use one format (YYYY-MM-DD is safest)" };
  let updated = 0, skipped = 0, badDate = 0;
  rows.slice(1).forEach(r => {
    const d = parseCsvDate(col(r, "billingcompleteddate"), order);
    const acct = (col(r, "accountno") && byNo.get(col(r, "accountno"))) || byName.get(col(r, "name").toLowerCase());
    if (d === null) badDate++;
    if (!acct || !d) { skipped++; return; }
    dispatch({ type: "EDIT_ACCOUNT", id: acct.id, patch: { billingCompleted: true, billingCompletedDate: d } });
    updated++;
  });
  return { updated, skipped, badDate };
}

