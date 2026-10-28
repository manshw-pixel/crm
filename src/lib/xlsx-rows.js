// Excel (ExcelJS) cell values -> the string rows / CSV text the importers already take.
import { csvCell } from "./csv.js";

const pad = n => String(n).padStart(2, "0");
export function cellText(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isNaN(v) ? "" : `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text ?? "").join("");
    if ("formula" in v || "sharedFormula" in v) return cellText(v.result);
    if ("error" in v) return "";
    if ("text" in v) return cellText(v.text);
  }
  return String(v);
}
export function sheetRows(rowValues) {
  const rows = (rowValues || []).map(r => Array.from(r || [], cellText));
  const width = rows.length ? rows[0].length : 0;
  const out = rows.map(r => { while (r.length < width) r.push(""); return r; });
  while (out.length > 1 && out[out.length - 1].every(c => c.trim() === "")) out.pop();
  return out;
}
export const rowsToCSV = rows => rows.map(r => r.map(csvCell).join(",")).join("\n");
