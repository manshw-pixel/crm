/* ------------------------------ audit trail ------------------------------ */
import { uid } from "./ids.js";
import { iso } from "./dates.js";

export const AUDIT_FIELDS = ["arr", "renewalDate", "csm", "tier", "contractStatus", "renewalStage", "currency"];
/* one entry per audited field the patch really changes (numbers normalized) */
export function auditChanges(a, patch, by, source) {
  const out = [];
  AUDIT_FIELDS.forEach(f => {
    if (!(f in patch)) return;
    const from = f === "arr" ? (+a[f] || 0) : (a[f] ?? "");
    const to = f === "arr" ? (+patch[f] || 0) : (patch[f] ?? "");
    if (from !== to) out.push({ id: uid(), date: iso(Date.now()), field: f, from, to, by: by || "unknown", source: source || "edit form" });
  });
  return out;
}
export const withAudit = (a, entries) => entries.length ? { ...a, audit: [...(a.audit || []), ...entries] } : a;

/* Prior-state capture for undo. `ids` are account ids; the snapshot also carries every
   cascaded row DELETE_ACCOUNT would remove, plus the original parentId of each sub whose
   parent is being deleted (DELETE_ACCOUNT nulls those out). */
export function snapshotFor(state, ids) {
  const set = new Set(ids);
  const touches = r => set.has(r.accountId);
  const parentIds = {};
  state.accounts.filter(a => a.parentId && set.has(a.parentId)).forEach(a => { parentIds[a.id] = a.parentId; });
  return {
    accounts: state.accounts.filter(a => set.has(a.id) || parentIds[a.id]).map(a => ({ ...a })),
    contacts: state.contacts.filter(touches).map(r => ({ ...r })),
    activities: state.activities.filter(touches).map(r => ({ ...r })),
    tasks: state.tasks.filter(touches).map(r => ({ ...r })),
    opportunities: state.opportunities.filter(touches).map(r => ({ ...r })),
    parentIds,
  };
}
