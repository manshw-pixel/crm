/* write-through: mirror a just-reduced action into Supabase. WHAT to write is decided by
   persistOps (src/lib/reducer.js, unit-tested); this only hands the ops to the queue. */
function persist(action, next, prev) {
  persistOps(action, next, prev).forEach(op => op.kind === "delete"
    ? writeQueue.enqueueDelete({ table: op.table, column: op.column, value: op.value })
    : writeQueue.enqueue({ table: op.table, rowId: op.rowId, patch: op.patch, appends: op.appends }));
}

/* bulk replace (sample data / clear / JSON import) — admin only, RLS enforced.
   One RPC, therefore one transaction: the deletes and inserts commit together or not at
   all. This previously deleted all five tables client-side and only then inserted, so any
   failure in between emptied the team's database with no backup. */
async function replaceAllRemote(state) {
  const payload = { settings: state.settings };
  for (const t of ENTITY_TABLES) {
    // Deliberately NOT `state[t] || []`. The old client threw a TypeError here on a
    // malformed import, which surfaced as a visible "Import failed" toast; defaulting to
    // an empty array instead would silently EMPTY that table on an irreversible operation.
    if (!Array.isArray(state[t])) throw new Error(`${t} is missing from the imported data`);
    payload[t] = state[t];
  }
  const { error } = await sb.rpc("replace_all", { payload });
  if (error) throw error;
}
