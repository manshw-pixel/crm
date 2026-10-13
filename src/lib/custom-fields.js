// Admin-defined account fields (spec 2026-10-13, PR 1). Definitions live in settings.customFields;
// values live on the account as `custom: { [fieldId]: value }`. A field is never hard-deleted:
// `archived` hides it and keeps every stored value, so restoring brings the data back.
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "bool"];
export const CUSTOM_FIELD_TYPE_LABELS = { text: "Text", number: "Number", date: "Date", select: "Dropdown", bool: "Yes / No" };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = s => {
  if (!ISO_DAY.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const list = defs => (Array.isArray(defs) ? defs : []);

export const activeCustomFields = defs => list(defs).filter(d => d && !d.archived);
export const archivedCustomFields = defs => list(defs).filter(d => d && d.archived);

export function normalizeFieldDef(d) {
  d = d || {};
  const type = CUSTOM_FIELD_TYPES.includes(d && d.type) ? d.type : "text";
  const out = { id: d.id, label: String((d && d.label) || "").trim(), type };
  if (type === "select") out.options = [...new Set(list(d.options).map(o => String(o).trim()).filter(Boolean))];
  out.archived = !!(d && d.archived);
  return out;
}

export function coerceCustomValue(type, raw) {
  if (type === "bool") return raw === true;
  if (type === "number") { if (raw === "" || raw == null) return null; if (typeof raw === "string" && raw.trim() === "") return null; const n = Number(raw); return Number.isFinite(n) ? n : null; }
  const s = raw == null ? "" : String(raw).trim();
  if (type === "date") return realDay(s) ? s : null;
  return s === "" ? null : s;
}

export function editorValue(type, stored) {
  if (type === "bool") return stored === true;
  if (type === "number") return typeof stored === "number" && Number.isFinite(stored) ? String(stored) : "";
  if (type === "date") return typeof stored === "string" && ISO_DAY.test(stored) ? stored : "";
  return stored == null ? "" : String(stored);
}

export function formatCustomValue(type, stored) {
  if (stored == null || stored === "") return "";
  if (type === "bool" && typeof stored === "boolean") return stored ? "Yes" : "No";
  return String(stored);
}

// Shallow merge: merge_row replaces top-level keys, so `custom` must always travel whole.
export function buildCustomPatch(currentCustom, edits) {
  const base = { ...(currentCustom || {}) };
  for (const [k, v] of Object.entries(edits || {})) {
    if ((v == null || v === "") && !(k in base)) continue;
    base[k] = v === "" || v === undefined ? null : v;
  }
  return base;
}

export const newFieldId = () => "cf_" + Math.random().toString(36).slice(2, 10);
