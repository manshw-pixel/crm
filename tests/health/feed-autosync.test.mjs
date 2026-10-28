import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// The shared-drive auto-sync must live outside the Settings page: it used to be owned by
// IntegrationsCard, so leaving Settings killed the 5-minute timer, and every store change
// recreated the interval so its countdown restarted and might never fire.
const acct = seedAccount({ id: "b1", name: "Billco", accountNo: "ACC-1" });
const seed = `
window.__seedRows = { accounts: [${JSON.stringify(acct)}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };
window.__handle = {
  kind: "directory", name: "Sales", state: "granted",
  async queryPermission() { return this.state; },
  async requestPermission() { return this.state; },
  async *entries() {
    yield ["new-accounts.csv", { kind: "file", getFile: async () =>
      new File(["name,tier,arr,currency\\nKestrel,SMB,1000,USD\\n"], "new-accounts.csv", { lastModified: 7 }) }];
  },
};
(() => {
  const store = new Map([["sales", window.__handle]]);
  const later = f => setTimeout(f, 0);
  const db = { createObjectStore() {}, transaction() { const tx = { objectStore: () => ({
    put(v, k) { store.set(k, v); later(() => tx.oncomplete && tx.oncomplete()); },
    delete(k) { store.delete(k); later(() => tx.oncomplete && tx.oncomplete()); },
    get(k) { const rq = {}; later(() => { rq.result = store.get(k); rq.onsuccess && rq.onsuccess(); }); return rq; },
  }) }; return tx; } };
  Object.defineProperty(window, "indexedDB", { value: { open() { const r = {}; later(() => { r.result = db; r.onsuccess && r.onsuccess(); }); return r; } } });
})();
window.__autoScans = []; window.__autoIds = []; window.__autoCleared = 0;
const realSetInterval = window.setInterval, realClear = window.clearInterval;
window.setInterval = (fn, ms, ...a) => { const id = realSetInterval(fn, ms, ...a); if (ms === 5 * 60 * 1000) { window.__autoScans.push(fn); window.__autoIds.push(id); } return id; };
window.clearInterval = id => { if (window.__autoIds.includes(id)) window.__autoCleared++; return realClear(id); };
`;

const fireAndCheck = async page => {
  await page.waitForFunction(() => window.__autoScans.length > 0, null, { timeout: 10000 });
  await page.evaluate(() => window.__autoScans[window.__autoScans.length - 1]());
  await page.waitForFunction(() => window.__store.getState().accounts.some(a => a.name === "Kestrel"), null, { timeout: 10000 });
  const i = await page.evaluate(() => window.__store.getState().settings.integrations);
  assert(i && i.processed["new-accounts.csv|7"], "file should be marked processed");
  assert(i.log.some(l => l.file === "new-accounts.csv" && l.folder === "sales"), "sync should be logged");
};

test("feed auto-sync keeps running after leaving Settings", async () => {
  const { page, browser } = await launch(seed);
  await page.click('button[title="Settings"]', { timeout: 15000 });
  await page.waitForFunction(() => [...document.querySelectorAll("h3")].some(h => /shared drive/i.test(h.textContent)), null, { timeout: 10000 });
  await page.waitForFunction(() => window.__autoScans.length > 0, null, { timeout: 10000 });
  await page.click('button[title="Accounts"]');
  await page.waitForFunction(() => ![...document.querySelectorAll("h3")].some(h => /shared drive/i.test(h.textContent)), null, { timeout: 10000 });
  await fireAndCheck(page);
  assert(await page.evaluate(() => window.__autoCleared) === 0, "leaving Settings must not clear the timer");
  await browser.close();
});

test("feed auto-sync: store changes don't restart the timer", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__autoScans.length > 0, null, { timeout: 15000 });
  for (let n = 0; n < 4; n++) {
    await page.evaluate(n => window.__store.dispatch({ type: "EDIT_ACCOUNT", id: "b1", patch: { notes: "edit " + n }, by: "u1", source: "test" }), n);
    await page.waitForTimeout(100);
  }
  await page.click('button[title="Settings"]', { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__autoScans[0]()); // a sync flips busy and writes the store
  await page.waitForFunction(() => window.__store.getState().accounts.some(a => a.name === "Kestrel"), null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ n: window.__autoScans.length, cleared: window.__autoCleared }));
  assert(r.n === 1, "5-minute interval registered " + r.n + " times, want 1");
  assert(r.cleared === 0, "the interval was cleared " + r.cleared + " times");
  await browser.close();
});

test("feed auto-sync runs without ever opening Settings", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store, null, { timeout: 15000 });
  await fireAndCheck(page);
  await browser.close();
});
