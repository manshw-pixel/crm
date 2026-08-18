import { test, assert } from "./framework.mjs";
import { launch } from "./harness.mjs";

const SEED = `window.__seedRows = { accounts: [], contacts: [], activities: [], tasks: [],
  opportunities: [], team: [], settings: [],
  profiles: [{ id: "u1", name: "Test User", role: "admin" }] };`;

let page, browser;
const boot = async () => { if (!page) ({ page, browser } = await launch(SEED)); };
const logCalls = () => page.evaluate(() =>
  (window.__rpcCalls || []).filter(c => c.fn === "log_error").map(c => c.args));

test("reportError sends one log_error with the level and message", async () => {
  await boot();
  await page.evaluate(() => {
    window.__rpcCalls = [];
    window.__health.reportError("crash", new Error("kaboom"), { view: "Accounts" });
  });
  await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "log_error"));
  const [args] = await logCalls();
  assert(args.level === "crash", `level was ${args.level}`);
  assert(/kaboom/.test(args.message), `message was ${args.message}`);
  assert(args.context.view === "Accounts", `context was ${JSON.stringify(args.context)}`);
  assert(typeof args.fingerprint === "string" && args.fingerprint.length > 0,
    "no fingerprint was sent");
});

test("reportError NEVER throws, even when the RPC rejects", async () => {
  await boot();
  // The reporter runs when the app is already broken. If it can throw, it converts a
  // handled error into an unhandled one -- strictly worse than not reporting at all.
  const threw = await page.evaluate(() => {
    window.__logErrorFails = true;
    try { window.__health.reportError("crash", new Error("x"), {}); return false; }
    catch (e) { return true; }
    finally { window.__logErrorFails = false; }
  });
  assert(!threw, "reportError threw — it must swallow its own failure");
});

test("a rejected report surfaces nothing to the user", async () => {
  await boot();
  await page.evaluate(async () => {
    window.__logErrorFails = true;
    window.__toastCount = 0;
    const realToast = window.__toast;
    window.__toast = (...a) => { window.__toastCount++; return realToast && realToast(...a); };
    window.__health.reportError("crash", new Error("y"), {});
    await new Promise(r => setTimeout(r, 300));
    window.__logErrorFails = false;
  });
  const toasts = await page.evaluate(() => window.__toastCount);
  assert(toasts === 0, `the failed report raised ${toasts} toast(s) — a meta-error must stay silent`);
});

test("identical errors are throttled into one call", async () => {
  await boot();
  await page.evaluate(async () => {
    window.__rpcCalls = [];
    for (let i = 0; i < 25; i++) window.__health.reportError("retry", new Error("same"), { table: "accounts" });
    await new Promise(r => setTimeout(r, 200));
  });
  const calls = await logCalls();
  assert(calls.length === 1,
    `expected the burst to coalesce into 1 call, got ${calls.length} — Postgres dedupes anyway, but a tight failure loop must not emit a request per occurrence`);
});

test("different errors are NOT throttled together", async () => {
  await boot();
  await page.evaluate(async () => {
    window.__rpcCalls = [];
    window.__health.reportError("crash", new Error("first"), {});
    window.__health.reportError("crash", new Error("second"), {});
    await new Promise(r => setTimeout(r, 200));
  });
  const calls = await logCalls();
  assert(calls.length === 2, `distinct errors must each report, got ${calls.length}`);
});

test("the fingerprint is stable for the same error and differs across errors", async () => {
  await boot();
  const [a, b, c] = await page.evaluate(() => [
    window.__health.fingerprintOf("crash", "boom", "Accounts"),
    window.__health.fingerprintOf("crash", "boom", "Accounts"),
    window.__health.fingerprintOf("crash", "boom", "Tasks"),
  ]);
  assert(a === b, "the same error produced two fingerprints — rows would never collapse");
  assert(a !== c, "different views produced the same fingerprint — distinct bugs would merge");
});

test("reportError does NOT enqueue onto the write queue", async () => {
  await boot();
  // The queue's own failure is one of the things reportError reports. Routing reports
  // through the queue would mean a failing queue reports its failure by enqueuing another
  // operation onto the failing queue. Assert on shape, not just pending===0 -- the mock
  // drains fast enough that pending would read 0 even if the report HAD been enqueued.
  await page.evaluate(() => { window.__rpcCalls = []; });
  const calls = await page.evaluate(async () => {
    window.__health.reportError("write_failed", new Error("z"), { table: "accounts" });
    await new Promise(r => setTimeout(r, 100));
    return (window.__rpcCalls || []).map(c => c.fn);
  });
  assert(!calls.includes("merge_row"), `the report went through the write queue: ${JSON.stringify(calls)}`);
  assert(calls.includes("log_error"), `no log_error call was recorded: ${JSON.stringify(calls)}`);
});

test("a rejected report produces no unhandled rejection", async () => {
  await boot();
  // The async path is the one that matters: reportError's try/catch only covers the
  // SYNCHRONOUS call, so without `p.then(()=>{},()=>{})` the rejection escapes as an
  // unhandled rejection -- which the global handler wired in a later task would then
  // report, making the reporter report its own failure in a loop.
  await page.evaluate(async () => {
    window.__unhandled = 0;
    window.addEventListener("unhandledrejection", () => { window.__unhandled++; });
    window.__logErrorFails = true;
    window.__health.reportError("crash", new Error("async boom"), {});
    await new Promise(r => setTimeout(r, 300));
    window.__logErrorFails = false;
  });
  const n = await page.evaluate(() => window.__unhandled);
  assert(n === 0, `the rejected report escaped as ${n} unhandled rejection(s)`);
  if (browser) await browser.close();
});
