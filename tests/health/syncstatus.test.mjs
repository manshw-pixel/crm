import { test, assert } from "./framework.mjs";
import { launchPersistent, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "s1", name: "Sync Co", arr: 100 });
const seed = `window.__seedRows = { accounts: [{ id: "s1", data: ${JSON.stringify(A)} }],
  contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [],
  profiles: [{ id: "u1", name: "Test User", role: "admin" }] };`;

test("the header shows a saving indicator that settles to saved", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcDelay = 300; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "s1", patch: { arr: 200 }, by: "T" }));
  await page.waitForFunction(
    () => document.querySelector("[data-sync-status]")?.dataset.syncStatus === "saving");
  await page.waitForFunction(
    () => document.querySelector("[data-sync-status]")?.dataset.syncStatus === "saved",
    { timeout: 15000 });
  await browser.close();
});

test("the error status PERSISTS on screen rather than scrolling away like a toast", async () => {
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcFailures = 99; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "s1", patch: { arr: 300 }, by: "T" }));
  await page.waitForFunction(
    () => document.querySelector("[data-sync-status]")?.dataset.syncStatus === "error",
    { timeout: 30000 });
  await new Promise(r => setTimeout(r, 6000)); // outlive the toast dismissal window
  const still = await page.evaluate(
    () => document.querySelector("[data-sync-status]")?.dataset.syncStatus);
  assert(still === "error",
    `the error indicator disappeared (now ${still}) — it must stay until the user resolves it`);
  await browser.close();
});

test("a teammate's realtime change does NOT refetch while writes are still queued", async () => {
  // Otherwise the user watches their own edit vanish and then reappear: the refetch
  // overwrites local state with a server view that does not contain the queued write yet.
  const { page, browser } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store);
  await page.evaluate(() => { window.__rpcDelay = 1500; window.__refetches = 0; });
  await page.evaluate(() => window.__store.dispatch(
    { type: "EDIT_ACCOUNT", id: "s1", patch: { arr: 400 }, by: "T" }));
  await page.evaluate(() => window.__fireRealtime && window.__fireRealtime());
  await new Promise(r => setTimeout(r, 1000)); // past the 800ms debounce, still mid-write
  const during = await page.evaluate(() => window.__refetches);
  assert(during === 0, `a refetch fired with ${during} writes still queued`);
  await page.waitForFunction(
    () => window.__health.writeQueue.queueState().status === "saved", { timeout: 15000 });
  await page.waitForFunction(() => window.__refetches > 0, { timeout: 5000 });
  await browser.close();
});
