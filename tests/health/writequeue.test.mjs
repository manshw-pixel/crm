import { test, assert } from "./framework.mjs";
import { launchPersistent, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "q1", name: "Queue Co", arr: 100 });
const seed = `window.__seedRows = { accounts: [{ id: "q1", data: ${JSON.stringify(A)} }],
  contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [],
  profiles: [{ id: "u1", name: "Test User", role: "admin" }] };`;

test("a transient failure is retried and then succeeds", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcFailures = 1; window.__rpcCalls = []; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "q1", patch: { arr: 200 }, by: "T" }));
  await page.waitForFunction(
    () => window.__health.writeQueue.queueState().status === "saved", { timeout: 15000 });
  const n = await page.evaluate(() => window.__rpcCalls.length);
  assert(n === 2, `expected one failure plus one retry, got ${n} calls`);
  await browser.close();
});

test("a permanent failure ends in the error status and rolls back by refetching", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcFailures = 99; window.__refetches = 0; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "q1", patch: { arr: 900 }, by: "T" }));
  await page.waitForFunction(
    () => window.__health.writeQueue.queueState().status === "error", { timeout: 30000 });
  const st = await page.evaluate(() => ({
    arr: window.__store.getState().accounts[0].arr, refetches: window.__refetches }));
  assert(st.refetches > 0,
    "no refetch was issued — the local change was left diverged from the server");
  assert(st.arr === 100, `the failed edit was not rolled back: arr=${st.arr}`);
  await browser.close();
});

test("two edits to the same row are sent in order, never concurrently", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcCalls = []; window.__rpcDelay = 120; });
  await page.evaluate(() => {
    window.__store.dispatch({ type: "EDIT_ACCOUNT", id: "q1", patch: { arr: 300 }, by: "T" });
    window.__store.dispatch({ type: "EDIT_ACCOUNT", id: "q1", patch: { arr: 400 }, by: "T" });
  });
  await page.waitForFunction(
    () => window.__health.writeQueue.queueState().status === "saved", { timeout: 15000 });
  const calls = await page.evaluate(() => window.__rpcCalls.map(
    c => ({ arr: c.args.patch.arr, started: c.started, ended: c.ended })));
  assert(calls.length === 2, `expected 2 calls, got ${calls.length}`);
  assert(calls[0].arr === 300 && calls[1].arr === 400,
    `out of order: ${JSON.stringify(calls.map(c => c.arr))}`);
  assert(calls[1].started >= calls[0].ended,
    "the second write overlapped the first — same-row writes must be serial or the older value can win");
  await browser.close();
});

test("the status is 'saving' while work is pending and 'saved' once it drains", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcDelay = 300; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "q1", patch: { arr: 500 }, by: "T" }));
  const mid = await page.evaluate(() => window.__health.writeQueue.queueState());
  assert(mid.status === "saving" && mid.pending > 0, `expected saving, got ${JSON.stringify(mid)}`);
  await page.waitForFunction(
    () => window.__health.writeQueue.queueState().status === "saved", { timeout: 15000 });
  await browser.close();
});
