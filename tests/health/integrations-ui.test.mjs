import { test, assert } from "./framework.mjs";
import { launchFinance, seedAccount, gotoSettings } from "./harness.mjs";

// Integrations -- the two feed cards, per-feed templates, filtered activity log and help note.
// Finance folder is restored from IndexedDB at permission "prompt" (as after a reload); sales is not set.
const acct = seedAccount({ id: "b1", name: "Billco", accountNo: "ACC-1" });
const mkTables = integrations => ({ accounts: [{ id: "b1", data: acct }], contacts: [], activities: [], tasks: [], opportunities: [], team: [],
  settings: integrations ? [{ id: "1", data: { integrations } }] : [] });
const seed = `
window.__handle = {
  kind: "directory", name: "Finance", state: "prompt",
  async queryPermission() { return this.state; },
  async requestPermission() { this.state = "granted"; return "granted"; },
  async *entries() {},
};
window.showDirectoryPicker = async () => window.__handle;
(() => {
  const store = new Map([["finance", window.__handle]]);
  const later = f => setTimeout(f, 0);
  const db = { createObjectStore() {}, transaction() { const tx = { objectStore: () => ({
    put(v, k) { store.set(k, v); later(() => tx.oncomplete && tx.oncomplete()); },
    delete(k) { store.delete(k); later(() => tx.oncomplete && tx.oncomplete()); },
    get(k) { const rq = {}; later(() => { rq.result = store.get(k); rq.onsuccess && rq.onsuccess(); }); return rq; },
  }) }; return tx; } };
  Object.defineProperty(window, "indexedDB", { value: { open() { const r = {}; later(() => { r.result = db; r.onsuccess && r.onsuccess(); }); return r; } } });
})();
`;
const open = async (opts = {}) => {
  const ctx = await launchFinance({ tables: mkTables(opts.integrations), seed: (opts.pre || "") + seed });
  await gotoSettings(ctx.page);
  await ctx.page.waitForSelector("[data-feed=finance]", { timeout: 10000 });
  await ctx.page.waitForFunction(() => document.querySelector("[data-feed=finance]").innerText.includes("Finance feed") && !/Not set/.test(document.querySelector("[data-feed=finance]").innerText), null, { timeout: 10000 });
  return ctx;
};
const feedText = (page, f) => page.evaluate(f => document.querySelector(`[data-feed=${f}]`).innerText, f);

test("integrations ui: each feed card shows its folder status", async () => {
  const { page, browser } = await open();
  assert(/Not set/.test(await feedText(page, "sales")), "sales: " + await feedText(page, "sales"));
  assert(/Needs access/.test(await feedText(page, "finance")), "finance: " + await feedText(page, "finance"));
  assert(await page.$("[data-feed=finance] [data-grant] button"), "Grant button missing on a lapsed folder");
  await page.click("[data-feed=finance] [data-grant] button");
  await page.waitForFunction(() => /Connected/.test(document.querySelector("[data-feed=finance]").innerText), null, { timeout: 10000 });
  await browser.close();
});

test("integrations ui: finance card offers three templates", async () => {
  const { page, browser } = await open();
  const t = await feedText(page, "finance");
  for (const n of ["Purchase orders", "Payments", "Billing completed"]) assert(t.includes(n), "missing template " + n);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.click('[data-feed=finance] [data-csv-template="Purchase orders"]')]);
  assert(dl.suggestedFilename() === "finance-purchase-orders.csv", dl.suggestedFilename());
  const s = await feedText(page, "sales");
  assert(s.includes("Accounts → CSM") && s.includes("Onboarding"), "sales templates: " + s);
  await browser.close();
});

const LOG = { log: [{ t: "2026-10-27T10:00:00.000Z", folder: "sales", file: "a.csv", msg: "all good", err: false },
  { t: "2026-10-28T10:00:00.000Z", folder: "finance", file: "b.csv", msg: "boom", err: true }] };
const logText = page => page.evaluate(() => document.querySelector("[data-synclog] .max-h-48").innerText);
test("integrations ui: log filter narrows to errors", async () => {
  const { page, browser } = await open({ integrations: LOG });
  await page.click('[data-log-filter="Errors"]');
  assert(await page.$$eval("[data-synclog] .max-h-48 > div", e => e.length) === 1, "errors rows");
  assert(await page.$$eval("[data-log-err]", e => e.length) === 1, "data-log-err");
  await page.click('[data-log-filter="Sales"]');
  const t = await logText(page);
  assert(await page.$$eval("[data-synclog] .max-h-48 > div", e => e.length) === 1 && /a\.csv/.test(t), "sales rows: " + t);
  await browser.close();
  const b = await open({ integrations: { log: [LOG.log[0]] } });
  await b.page.click('[data-log-filter="Errors"]');
  assert(/No errors/.test(await logText(b.page)), "no-errors message: " + await logText(b.page));
  await b.browser.close();
});

test("integrations ui: last sync time per feed", async () => {
  const { page, browser } = await open({ integrations: { log: [LOG.log[1]] } });
  assert(/Last sync/.test(await feedText(page, "finance")), "finance: " + await feedText(page, "finance"));
  assert(/Never synced/.test(await feedText(page, "sales")), "sales: " + await feedText(page, "sales"));
  await browser.close();
});

test("integrations ui: non-finance user sees the notice and no Sync button", async () => {
  // Settings is admin-only and admins always pass canFinance (bundled, not overridable), so the finance gate is
  // forced through the QA-only window.__qaNoFinance flag that IntegrationsCard reads next to window.__qaHooks.
  const { page, browser } = await open({ pre: "window.__qaHooks = true; window.__qaNoFinance = true;\n" });
  const t = await feedText(page, "finance");
  assert(/Only finance users can sync this folder/.test(t), "notice: " + t);
  assert(!/Sync now/.test(t), "finance card must not offer Sync now");
  await browser.close();
});

test("integrations ui: how-this-works note", async () => {
  const { page, browser } = await open();
  const t = await page.evaluate(() => document.querySelector("#set-integrations").innerText);
  assert(t.includes("only while a OneVio tab is open"), "note missing");
  await browser.close();
});

test("integrations ui: fits a phone", async () => {
  const { page, browser } = await open();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(300);
  // The Settings page as a whole is already wider than a phone (every card, not just this one), so assert on
  // this section: it must not overflow its own box, and nothing in it may poke out past the card's right edge.
  const r = await page.evaluate(() => { const sec = document.querySelector("#set-integrations"); const card = sec.firstElementChild;
    const edge = card.getBoundingClientRect().right;
    return { over: sec.scrollWidth - sec.clientWidth, out: [...sec.querySelectorAll("*")].filter(e => e.getBoundingClientRect().right > edge + 1).length }; });
  assert(r.over <= 1 && r.out === 0, "integrations section overflows: " + JSON.stringify(r));
  await browser.close();
});
