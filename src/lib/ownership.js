// Who may set an account's owners (spec 2026-10-13, PR 2). Admins only; the database trigger
// guard_account_owner enforces the same rule, this keeps the normal client path from tripping it.
export const OWNER_KEYS = ["csm", "csmSince", "leadId"];
export const isAdminUser = user => !!user && user.role === "admin";

export function stripOwnerKeys(patch, user) {
  if (isAdminUser(user)) return patch;
  const out = { ...patch };
  for (const k of OWNER_KEYS) delete out[k];
  return out;
}

export function csmChangeSummary(from, to, by) {
  const a = from || "", b = to || "";
  if (a === b) return null;
  return a ? `CSM changed from ${a} to ${b || "(none)"} by ${by}` : `CSM set to ${b} by ${by}`;
}
