/* ------------------------------ write queue ------------------------------
   persist() used to be fire-and-forget: a failed write showed one toast and stopped, local
   state kept the change, and the user carried on editing a view the server never received
   (D1). Operations now go through this queue, which retries with backoff and -- if it
   finally gives up -- rolls the local state back by REFETCHING. Rollback by refetch rather
   than by inverting the reducer is deliberate: a refetch is unconditionally correct, while
   an undo-patch has to be right about what it is undoing, and would be a second chance to
   corrupt the same data. */
const BACKOFF_MS = [500, 2000, 8000];
const writeQueue = (() => {
  const pending = [];
  let running = false, status = "saved";
  const state = () => ({ status, pending: pending.length });
  const notify = () => window.__onQueueChange && window.__onQueueChange(state());
  const set = s => { status = s; notify(); };

  async function run() {
    if (running) return;
    running = true;
    // Strictly serial. Two edits to one account MUST NOT be in flight together, or they can
    // land out of order and the older value wins.
    while (pending.length) {
      const op = pending[0];
      let error;
      try {
        ({ error } = op.kind === "delete"
          ? await sb.from(op.table).delete().eq(op.column, op.value)
          : await sb.rpc("merge_row",
              { tbl: op.table, row_id: op.rowId, patch: op.patch, appends: op.appends }));
      } catch (e) {
        // supabase-js REJECTS on network/CORS errors rather than resolving { error }. Without
        // this the rejection escapes run(), `running` stays true forever, and every later
        // write silently no-ops at "saving" -- worse than the fire-and-forget code this
        // replaced, which only lost one write.
        error = { message: e && e.message ? e.message : String(e) };
      }
      if (!error) { pending.shift(); continue; }
      if (op.attempts < BACKOFF_MS.length) {
        reportError("retry", error, { table: op.table, rowId: op.rowId, attempt: op.attempts });
        await new Promise(r => setTimeout(r, BACKOFF_MS[op.attempts++]));
        continue;
      }
      // Given up. Drop everything queued -- the refetch below is about to invalidate all of
      // it -- and resync from the server.
      pending.length = 0;
      running = false;
      set("error");
      dbError(op.table, error);
      if (window.__refetch) window.__refetch();
      return;
    }
    running = false;
    set("saved");
  }

  return {
    enqueue(op) { pending.push({ ...op, attempts: 0 }); set("saving"); run().catch(e => console.error("writeQueue.run failed", e)); },
    enqueueDelete(op) { pending.push({ ...op, kind: "delete", attempts: 0 }); set("saving"); run().catch(e => console.error("writeQueue.run failed", e)); },
    queueState: state,
    drain: run,
  };
})();

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
  ac.filter(a => !a.accountNo).forEach(a => {
    a.accountNo = ++maxNo;
    sb.from("accounts").upsert({ id: a.id, data: a, updated_at: new Date().toISOString() }).then(({ error }) => error && dbError("accounts", error));
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

/* Compute what actually changed between two versions of one row.
   This exists so that NO form has to diff: dispatch already holds prev and next, and this
   is the one place that sees both. It therefore also covers the appends the reducer makes
   internally -- arrEvents (crm.html:404,410,432) never passes through a form at all, so a
   form-level diff would have missed the entire audit trail. */
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// INVARIANT: no reducer case may mutate a row in place. diffRow compares prev against next,
// so an in-place mutation makes prev === next and the write VANISHES SILENTLY -- no error,
// no failed test. Every reducer case is immutable today; keep it that way.
function diffRow(prev, next) {
  if (!prev) return { patch: { ...next }, appends: {}, sets: {} };
  const patch = {}, appends = {}, sets = {};
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const a = prev[k], b = next[k];
    if (sameJSON(a, b)) continue;
    if (Array.isArray(b)) {
      const base = Array.isArray(a) ? a : [];
      // An append is next == prev + trailing items, and NOTHING else. A reorder, a removal
      // or an in-place edit all break the prefix and fall through to a whole-array set --
      // misreading any of them as an append would duplicate audit entries.
      const isAppend = b.length > base.length && base.every((x, i) => sameJSON(x, b[i]));
      if (isAppend) appends[k] = b.slice(base.length); else sets[k] = b;
    } else {
      // undefined would be dropped from the JSON payload entirely, leaving the old value
      // server-side. A cleared field has to travel as an explicit null.
      patch[k] = b === undefined ? null : b;
    }
  }
  return { patch, appends, sets };
}

