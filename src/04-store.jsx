/* ------------------------------ store (Supabase) ------------------------------ */
const ENTITY_TABLES = ["accounts", "contacts", "activities", "tasks", "opportunities"];
const dbError = (where, error) => {
  console.error(where, error);
  reportError("write_failed", error, { table: where, code: error && error.code });
  const text = `Save failed (${where}): ${error.message}\nYour last change may not be shared — reload to resync.`;
  // alert() is the fallback, not the primary path: this helper can fire before
  // ToastProvider mounts, and losing a failed-save warning entirely would be worse than
  // an unstyled dialog. Deliberately kept — see the UX robustness spec.
  if (window.__toast) window.__toast({ text, tone: "error" }); else alert(text);
};

