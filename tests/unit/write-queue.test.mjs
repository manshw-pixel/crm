// The write queue (src/lib/write-queue.js) with a fake backend and a fake clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWriteQueue, BACKOFF_MS } from "../../src/lib/write-queue.js";

// script: one entry per send call -- "ok", "err" (resolves {error}), "throw" (rejects),
// or a Promise to hold the call open
function harness(script = []) {
  const log = { sent: [], slept: [], retries: [], gaveUp: [], states: [], inFlight: 0, maxInFlight: 0 };
  let i = 0;
  const q = createWriteQueue({
    send: async op => {
      log.sent.push(op.rowId ?? op.value); log.inFlight++; log.maxInFlight = Math.max(log.maxInFlight, log.inFlight);
      const step = script[i++] ?? "ok";
      try {
        if (step && typeof step.then === "function") await step;
        if (step === "throw") throw new Error("network down");
        return step === "err" ? { error: { message: "rls says no" } } : { error: null };
      } finally { log.inFlight--; }
    },
    sleep: async ms => { log.slept.push(ms); },
    onRetry: (op, e) => log.retries.push([op.rowId, op.attempts, e.message]),
    onGiveUp: (op, e) => log.gaveUp.push([op.rowId, e.message]),
    onChange: s => log.states.push(s.status),
  });
  return { q, log };
}
// waits for the queue to leave "saving"; FAILS (never hangs) if it is stuck there --
// a stuck queue is exactly the bug the rejection handling exists to prevent
const idle = (q, ms = 2000) => new Promise((resolve, reject) => {
  const until = Date.now() + ms;
  const t = () => q.queueState().status !== "saving" ? resolve()
    : Date.now() > until ? reject(new Error("write queue stuck at saving")) : setImmediate(t);
  t();
});

test("ops are sent in order and the queue settles to saved", async () => {
  const { q, log } = harness();
  q.enqueue({ table: "accounts", rowId: "a", patch: {}, appends: {} });
  q.enqueue({ table: "accounts", rowId: "b", patch: {}, appends: {} });
  q.enqueueDelete({ table: "tasks", column: "id", value: "t" });
  await idle(q);
  assert.deepEqual(log.sent, ["a", "b", "t"]);
  assert.deepEqual(q.queueState(), { status: "saved", pending: 0 });
  assert.equal(log.states[0], "saving"); assert.equal(log.states.at(-1), "saved");
});

test("strictly serial: never two writes in flight, even when enqueued during a slow write", async () => {
  let release; const slow = new Promise(r => { release = r; });
  const { q, log } = harness([slow, "ok", "ok"]);
  q.enqueue({ rowId: "a" }); q.enqueue({ rowId: "b" });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(log.sent, ["a"], "b must wait for a");
  q.enqueue({ rowId: "c" });
  release(); await idle(q);
  assert.deepEqual(log.sent, ["a", "b", "c"]);
  assert.equal(log.maxInFlight, 1);
});

test("a transient error is retried with backoff, reported, then succeeds", async () => {
  const { q, log } = harness(["err", "err", "ok"]);
  q.enqueue({ rowId: "a" });
  await idle(q);
  assert.deepEqual(log.sent, ["a", "a", "a"]);
  assert.deepEqual(log.slept, [BACKOFF_MS[0], BACKOFF_MS[1]]);
  assert.deepEqual(log.retries.map(r => r[1]), [0, 1], "attempt number reported before the wait");
  assert.deepEqual(log.gaveUp, []);
  assert.equal(q.queueState().status, "saved");
});

test("a REJECTED send (network/CORS) is treated as an error, not a stuck queue", async () => {
  const { q, log } = harness(["throw", "ok"]);
  q.enqueue({ rowId: "a" });
  await idle(q);
  assert.deepEqual(log.retries.map(r => r[2]), ["network down"]);
  assert.equal(q.queueState().status, "saved");
  q.enqueue({ rowId: "b" }); await idle(q);
  assert.deepEqual(log.sent, ["a", "a", "b"], "queue still works afterwards");
});

test("after all retries it gives up once: status error, queue cleared, onGiveUp called", async () => {
  const { q, log } = harness(["err", "err", "err", "err"]);
  q.enqueue({ rowId: "a" }); q.enqueue({ rowId: "b" });
  await idle(q);
  assert.deepEqual(log.sent, ["a", "a", "a", "a"], "1 try + 3 retries, and b is never sent");
  assert.deepEqual(log.slept, BACKOFF_MS);
  assert.deepEqual(log.gaveUp, [["a", "rls says no"]]);
  assert.deepEqual(q.queueState(), { status: "error", pending: 0 });
});

test("the queue recovers after a give-up: the next write runs and saves", async () => {
  const { q, log } = harness(["err", "err", "err", "err", "ok"]);
  q.enqueue({ rowId: "a" }); await idle(q);
  q.enqueue({ rowId: "c" }); await idle(q);
  assert.equal(log.sent.at(-1), "c");
  assert.equal(q.queueState().status, "saved");
});

test("enqueue copies the op and stamps kind; caller's object is not mutated", async () => {
  const sent = [];
  const q = createWriteQueue({ send: async op => { sent.push(op); return { error: null }; }, sleep: async () => {} });
  const op = Object.freeze({ table: "accounts", rowId: "a", patch: { x: 1 }, appends: {} });
  q.enqueue(op); q.enqueueDelete({ table: "tasks", column: "id", value: "t" });
  await idle(q);
  assert.deepEqual(sent.map(o => o.kind), ["merge", "delete"]);
  assert.notEqual(sent[0], op);
});
