import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// Integrations — shared drive. A folder handle restored from IndexedDB after a reload is back
// at permission "prompt", and Chrome rejects requestPermission() outside a click. The 5-minute
// auto-scan used to call it from a timer and log "User activation is required to request
// permissions." forever while the folder silently stopped syncing.
//
// The fake handle below enforces the same rule Chrome does (navigator.userActivation), and the
// IndexedDB fake hands it back as if the page had just been reloaded with a folder connected.
const acct = seedAccount({ id: "b1", name: "Billco", accountNo: "ACC-1" });
const seed = `
window.__seedRows = { accounts: [${JSON.stringify(acct)}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };
window.__handle = {
  kind: "directory", name: "Finance", state: "prompt", requested: 0,
  async queryPermission() { return this.state; },
  async requestPermission() {
    if (!navigator.userActivation.isActive) throw new DOMException("Failed to execute 'requestPermission' on 'FileSystemHandle': User activation is required to request permissions.", "SecurityError");
    this.requested++; this.state = "granted"; return "granted";
  },
  async *entries() {
    yield ["finance-billing.csv", { kind: "file", getFile: async () =>
      new File(["accountNo,name,billingCompletedDate\\nACC-1,Billco,2026-09-30\\n"], "finance-billing.csv", { lastModified: 1 }) }];
  },
};
window.showDirectoryPicker = async () => window.__handle;
(() => { // in-memory IndexedDB holding the previously connected finance folder
  const store = new Map([["finance", window.__handle]]);
  const later = f => setTimeout(f, 0);
  const db = { createObjectStore() {}, transaction() { const tx = { objectStore: () => ({
    put(v, k) { store.set(k, v); later(() => tx.oncomplete && tx.oncomplete()); },
    delete(k) { store.delete(k); later(() => tx.oncomplete && tx.oncomplete()); },
    get(k) { const rq = {}; later(() => { rq.result = store.get(k); rq.onsuccess && rq.onsuccess(); }); return rq; },
  }) }; return tx; } };
  Object.defineProperty(window, "indexedDB", { value: { open() { const r = {}; later(() => { r.result = db; r.onsuccess && r.onsuccess(); }); return r; } } });
})();
// capture the 5-minute auto-scan so a test can fire it without waiting 5 minutes
window.__autoScans = [];
const realSetInterval = window.setInterval;
window.setInterval = (fn, ms, ...a) => { if (ms === 5 * 60 * 1000) window.__autoScans.push(fn); return realSetInterval(fn, ms, ...a); };
`;

const openCard = async page => {
  await page.click('button[title="Settings"]', { timeout: 15000 });
  await page.waitForFunction(() => [...document.querySelectorAll("h3")].some(h => /shared drive/i.test(h.textContent)), null, { timeout: 10000 });
  await page.waitForFunction(() => window.__autoScans.length > 0, null, { timeout: 10000 }); // folder restored, timer armed
};
const cardText = page => page.evaluate(() =>
  [...document.querySelectorAll("h3")].find(h => /shared drive/i.test(h.textContent)).closest(".nm").textContent);

test("drive sync: auto-scan after reload never asks for permission, and flags the folder instead", async () => {
  const { page, browser } = await launch(seed);
  await openCard(page);
  // page.evaluate itself grants user activation (Playwright evaluates with userGesture), so
  // the control and the scan run from a timer set 6s later -- past the ~5s activation window,
  // which is exactly the situation of the real 5-minute interval.
  const r = await page.evaluate(() => new Promise(done => setTimeout(async () => {
    const active = navigator.userActivation.isActive;
    const threw = await window.__handle.requestPermission().then(() => "", e => e.message);
    window.__handle.state = "prompt"; window.__handle.requested = 0; // undo the control, if it granted
    await Promise.all(window.__autoScans.map(f => f()));
    done({ active, threw, scans: window.__autoScans.length });
  }, 6000)));
  assert(!r.active, "timer should run without user activation");
  // positive control: outside a click, the fake handle really does throw Chrome's error
  assert(/User activation is required/.test(r.threw), "fake handle should reject requestPermission without a click");
  assert(r.scans >= 1, "auto-scan interval should be registered for the connected folder");
  await page.waitForTimeout(300);
  const txt = await cardText(page);
  assert(!/User activation is required/.test(txt), "auto-scan logged the user-activation error: " + txt);
  assert(!/permission denied/.test(txt), "auto-scan should skip a lapsed folder quietly: " + txt);
  assert(/Access expired/.test(txt), "card should tell the user access lapsed");
  assert(await page.evaluate(() => window.__handle.requested) === 0, "auto-scan must not request permission");
  await browser.close();
});

test("drive sync: one click on Grant access re-grants and syncs the folder", async () => {
  const { page, browser } = await launch(seed);
  await openCard(page);
  await page.waitForSelector('[data-grant="finance"]', { timeout: 10000 });
  await page.click('[data-grant="finance"] button');
  await page.waitForFunction(() => /billing updated 1/.test(document.body.textContent), null, { timeout: 10000 });
  assert(await page.evaluate(() => window.__handle.requested) === 1, "Grant access should request permission once");
  assert(!(await page.$('[data-grant="finance"]')), "the Access expired prompt should clear once granted");
  await browser.close();
});
