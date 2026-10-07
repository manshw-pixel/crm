/* ------------------------------ write queue ------------------------------
   persist() used to be fire-and-forget: a failed write showed one toast and stopped, local
   state kept the change, and the user carried on editing a view the server never received
   (D1). Operations now go through this queue, which retries with backoff and -- if it
   finally gives up -- rolls the local state back by REFETCHING. Rollback by refetch rather
   than by inverting the reducer is deliberate: a refetch is unconditionally correct, while
   an undo-patch has to be right about what it is undoing, and would be a second chance to
   corrupt the same data.

   Everything it touches is injected, so it runs (and is unit-tested) in plain Node:
     send(op)            -> Promise<{ error }>; may also REJECT (network/CORS)
     sleep(ms)           -> Promise, the backoff wait
     onRetry(op, error)  -> a retry is about to wait (reporting)
     onGiveUp(op, error) -> retries exhausted; queue already cleared (toast + refetch)
     onChange(state)     -> { status: "saving"|"saved"|"error", pending } */
export const BACKOFF_MS = [500, 2000, 8000];
export function createWriteQueue({ send, sleep = ms => new Promise(r => setTimeout(r, ms)),
  onRetry = () => {}, onGiveUp = () => {}, onChange = () => {}, backoff = BACKOFF_MS }) {
  const pending = [];
  let running = false, status = "saved";
  const state = () => ({ status, pending: pending.length });
  const set = s => { status = s; onChange(state()); };

  async function run() {
    if (running) return;
    running = true;
    // Strictly serial. Two edits to one account MUST NOT be in flight together, or they can
    // land out of order and the older value wins.
    while (pending.length) {
      const op = pending[0];
      let error;
      try {
        ({ error } = await send(op));
      } catch (e) {
        // supabase-js REJECTS on network/CORS errors rather than resolving { error }. Without
        // this the rejection escapes run(), `running` stays true forever, and every later
        // write silently no-ops at "saving" -- worse than the fire-and-forget code this
        // replaced, which only lost one write.
        error = { message: e && e.message ? e.message : String(e) };
      }
      if (!error) { pending.shift(); continue; }
      if (op.attempts < backoff.length) {
        onRetry(op, error);
        await sleep(backoff[op.attempts++]);
        continue;
      }
      // Given up. Drop everything queued -- the refetch onGiveUp triggers is about to
      // invalidate all of it -- and resync from the server.
      pending.length = 0;
      running = false;
      set("error");
      onGiveUp(op, error);
      return;
    }
    running = false;
    set("saved");
  }
  const push = op => { pending.push({ ...op, attempts: 0 }); set("saving"); run().catch(e => console.error("writeQueue.run failed", e)); };
  return {
    enqueue(op) { push({ ...op, kind: op.kind || "merge" }); },
    enqueueDelete(op) { push({ ...op, kind: "delete" }); },
    queueState: state,
    drain: run,
  };
}
