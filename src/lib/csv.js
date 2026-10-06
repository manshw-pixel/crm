import { daysUntil } from "./dates.js";

/* sub-account display numbers: parentNo.1, parentNo.2, … ordered by the subs' own account # */
export function subNumbers(accounts) {
  const m = new Map(), byP = new Map();
  accounts.forEach(a => { if (a.parentId) byP.set(a.parentId, [...(byP.get(a.parentId) || []), a]); });
  byP.forEach((list, pid) => {
    const p = accounts.find(x => x.id === pid); if (!p) return;
    [...list].sort((x, y) => (+x.accountNo || 0) - (+y.accountNo || 0)).forEach((s, i) => m.set(s.id, `${p.accountNo}.${i + 1}`));
  });
  return m;
}
export const VALUE_COL = { caseStudy: "caseStudy", approvedSavings: "savings", approvedRoi: "roi" };
export function accountsCSVText(rows) {
  const cols = ["accountNo", "name", "tier", "arr", "currency", "arrUSD", "industry", "csm", "startDate", "transitionDate", "renewalDate", "daysToRenewal", "score", "risk", "contractStatus", "modules", "licenses", "dedicatedSupport", "billingCompleted", "billingCompletedDate", "caseStudy", "approvedSavings", "approvedRoi"];
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const cell = (a, c) => c === "daysToRenewal" ? daysUntil(a.renewalDate) : c === "arrUSD" ? Math.round(a.arrUSD) : c === "dedicatedSupport" ? (a.dedicatedSupport ? "Yes" : "No") : c === "billingCompleted" ? (a.billingCompleted ? "Yes" : "No") : VALUE_COL[c] ? ((a.inputs && a.inputs.value && a.inputs.value[VALUE_COL[c]]) ? "yes" : "no") : a[c];
  return [cols.join(","), ...rows.map(a => cols.map(c => esc(cell(a, c))).join(","))].join("\n");
}
/* ---- CSV dates ----
 * The app exports YYYY-MM-DD, but a CSV re-saved in Excel on an Indian-locale machine comes
 * back as DD-MM-YYYY. new Date() reads "05-07-2026" US-style (7 May, not 5 July) and rejects
 * "26-08-2026" outright, so imports silently swapped day/month or dropped the date.
 *
 * Numeric d-m-y dates are read by ONE order per file, decided from the file itself: a first
 * part over 12 proves day-first, a second part over 12 proves month-first. A file proving
 * both is refused rather than half-misread. A file with no proof either way (every date
 * <= 12/12) is read day-first, the Indian Excel default -- the import message says so.
 * Dates are built as text (never via toISOString) so no timezone can shift them a day. */
export const CSV_DMY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/;
export function csvDateOrder(values) {
  let dayFirst = false, monthFirst = false;
  values.forEach(v => { const m = CSV_DMY.exec(String(v || "").trim()); if (!m) return;
    if (+m[1] > 12) dayFirst = true; if (+m[2] > 12) monthFirst = true; });
  if (dayFirst && monthFirst) return null;
  return monthFirst ? "mdy" : "dmy";
}
// -> "YYYY-MM-DD", "" for an empty cell, or null when the cell is not a readable date
export function parseCsvDate(v, order = "dmy") {
  const t = String(v || "").trim();
  if (!t) return "";
  const out = (y, mo, d) => {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(t);
  if (m) return out(+m[1], +m[2], +m[3]);
  if ((m = CSV_DMY.exec(t))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return order === "mdy" ? out(y, +m[1], +m[2]) : out(y, +m[2], +m[1]);
  }
  if (/[a-z]/i.test(t)) { // "5 Jul 2026", "Jul 5, 2026": the month is a word, so no ambiguity
    const d = new Date(t);
    return isNaN(d) ? null : out(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}
// one-line summary of an accounts import, for the folder sync log
export function importSummary(r) {
  if (r.err) return r.err;
  const bits = [`imported ${r.ok} new · updated ${r.updated} · skipped ${r.skipped}`];
  if (r.badDate) bits.push(`⚠ ${r.badDate} unreadable date(s) left unchanged${r.badDateRows?.length ? ` (${r.badDateRows.join(", ")})` : ""}`);
  if (r.badValue) bits.push(`⚠ ${r.badValue} unreadable Value answer(s) left unchanged (use yes/no)`);
  if (r.churnSkipped?.length) bits.push(`⚠ not imported, marked Churned in the file: ${r.churnSkipped.join(", ")} — churn them from the account page`);
  if (r.badTier) bits.push(`⚠ ${r.badTier} unrecognized tier(s) set to Mid`);
  if (r.badStatus) bits.push(`⚠ ${r.badStatus} unrecognized status(es) set to Active`);
  if (r.dateOrder === "dmy-assumed") bits.push("dates read as DD-MM-YYYY");
  return bits.join(" · ");
}
export function parseCSV(text) {
  const rows = []; let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}
