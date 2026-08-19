import { test, assert } from "./framework.mjs";
import { launchPersistent, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "c1", name: "Capture Co", arr: 100 });
const seed = `window.__seedRows = { accounts: [{ id: "c1", data: ${JSON.stringify(A)} }],
  contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [],
  profiles: [{ id: "u1", name: "Test User", role: "admin" }] };`;

const logCalls = page => page.evaluate(() =>
  (window.__rpcCalls || []).filter(c => c.fn === "log_error").map(c => c.args));

test("a permanently failing write reports write_failed", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcFailures = 99; window.__rpcCalls = []; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "c1", patch: { arr: 555 }, by: "T" }));
  // Wait for the LEVEL, not for "any log_error". With rpcFailures forcing a permanent
  // failure the retry report fires at t≈0, roughly 10.5s before write_failed does (the
  // 0.5+2+8s backoff chain), so waiting for the first report resolves on the retry and
  // asserts against a log that cannot yet contain what it is looking for.
  await page.waitForFunction(
    () => (window.__rpcCalls || []).some(c => c.fn === "log_error" && c.args.p_level === "write_failed"),
    { timeout: 30000 });
  const calls = await logCalls(page);
  assert(calls.some(a => a.p_level === "write_failed"),
    `expected a write_failed report, got ${JSON.stringify(calls.map(c => c.p_level))}`);
  await browser.close();
});

test("a transient failure that later succeeds reports retry", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcFailures = 1; window.__rpcCalls = []; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "c1", patch: { arr: 666 }, by: "T" }));
  await page.waitForFunction(
    () => window.__health.writeQueue.queueState().status === "saved", { timeout: 15000 });
  const calls = await logCalls(page);
  assert(calls.some(a => a.p_level === "retry"),
    `expected a retry report, got ${JSON.stringify(calls.map(c => c.p_level))}`);
  await browser.close();
});

test("an uncaught error is reported as a crash", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcCalls = []; });
  await page.evaluate(() => {
    // Throw asynchronously so it reaches window.onerror rather than this evaluate call.
    setTimeout(() => { throw new Error("uncaught boom"); }, 0);
  });
  await page.waitForFunction(
    () => (window.__rpcCalls || []).some(c => c.fn === "log_error" && c.args.p_level === "crash"),
    { timeout: 10000 });
  const calls = await logCalls(page);
  assert(calls.some(a => /uncaught boom/.test(a.p_message)),
    `the thrown message was not reported: ${JSON.stringify(calls.map(c => c.p_message))}`);
  await browser.close();
});

test("an unhandled promise rejection is reported as a crash", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcCalls = []; });
  await page.evaluate(() => { Promise.reject(new Error("rejected boom")); });
  await page.waitForFunction(
    () => (window.__rpcCalls || []).some(c => c.fn === "log_error" && c.args.p_level === "crash"),
    { timeout: 10000 });
  const calls = await logCalls(page);
  assert(calls.some(a => /rejected boom/.test(a.p_message)),
    `the rejection was not reported: ${JSON.stringify(calls.map(c => c.p_message))}`);
  await browser.close();
});

test("no report carries row data in its context", async () => {
  // The whole point of the "context, never row data" boundary. A regression here copies
  // customer revenue into a table with different access rules.
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcFailures = 99; window.__rpcCalls = []; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "c1", patch: { arr: 987654 }, by: "T" }));
  // Wait for write_failed specifically so this has definitely seen the dbError context, not
  // just the earlier retry context (same reasoning as the write_failed test above).
  await page.waitForFunction(
    () => (window.__rpcCalls || []).some(c => c.fn === "log_error" && c.args.p_level === "write_failed"),
    { timeout: 30000 });
  const calls = await logCalls(page);
  const blob = JSON.stringify(calls.map(c => c.p_context));
  assert(!/987654/.test(blob), `the failed patch's VALUES leaked into context: ${blob}`);
  assert(!/Capture Co/.test(blob), `an account name leaked into context: ${blob}`);
  await browser.close();
});
