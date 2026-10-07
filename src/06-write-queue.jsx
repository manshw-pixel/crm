/* ------------------------------ write queue ------------------------------
   persist() used to be fire-and-forget: a failed write showed one toast and stopped, local
   state kept the change, and the user carried on editing a view the server never received
   (D1). Operations now go through this queue, which retries with backoff and -- if it
   finally gives up -- rolls the local state back by REFETCHING. Rollback by refetch rather
   than by inverting the reducer is deliberate: a refetch is unconditionally correct, while
   an undo-patch has to be right about what it is undoing, and would be a second chance to
   corrupt the same data. */
// The queue itself is src/lib/write-queue.js (unit-tested in Node); this wires it to
// Supabase, error reporting and the app's refetch/status hooks.
const writeQueue = createWriteQueue({
  send: op => op.kind === "delete"
    ? sb.from(op.table).delete().eq(op.column, op.value)
    : sb.rpc("merge_row", { tbl: op.table, row_id: op.rowId, patch: op.patch, appends: op.appends }),
  onRetry: (op, error) => reportError("retry", error, { table: op.table, rowId: op.rowId, attempt: op.attempts }),
  onGiveUp: (op, error) => { dbError(op.table, error); if (window.__refetch) window.__refetch(); },
  onChange: st => window.__onQueueChange && window.__onQueueChange(st),
});

const accountNoBackfilled = new Set();
async function fetchAll() {
  const res = await Promise.all([
    ...ENTITY_TABLES.map(t => sb.from(t).select("data")),
    sb.from("settings").select("data"),
    sb.from("profiles").select("id,name,role,disabled"),
  ]);
  const bad = res.find(r => r.error);
  if (bad) throw bad.error;
  const [ac, co, act, ta, op, se] = res.slice(0, 6).map(r => r.data.map(x => x.data));
  ac.forEach(a => { if (!a.currency) a.currency = "USD"; });
  // one-time migration: give every account a stable numeric account # (used by CSV import to dedupe)
  let maxNo = ac.reduce((m, a) => Math.max(m, +a.accountNo || 0), 0);
  // Write ONLY the number, through the queue: this was a raw whole-row upsert -- no retry,
  // and it could overwrite a teammate's concurrent edit with this client's copy. Attempted
  // once per row per session: a give-up refetches, and re-queuing here would then loop.
  ac.filter(a => !a.accountNo).forEach(a => {
    a.accountNo = ++maxNo;
    if (accountNoBackfilled.has(a.id)) return;
    accountNoBackfilled.add(a.id);
    writeQueue.enqueue({ table: "accounts", rowId: a.id, patch: { accountNo: a.accountNo }, appends: {} });
  });
  const saved = (se && se[0]) || {};
  return {
    accounts: ac, contacts: co, activities: act, tasks: ta, opportunities: op,
    team: res[6].data || [],
    settings: { ...mergeSettings(saved), rates: { ...DEFAULT_RATES, ...(saved.rates || {}) },
      integrations: { processed: {}, log: [], ...(saved.integrations || {}) }, snapshots: saved.snapshots || [], playbook: saved.playbook, healthPlaybook: saved.healthPlaybook,
      segments: saved.segments || [] },
  };
}
