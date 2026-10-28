import { test, assert } from "./framework.mjs";
import { launchFinance, seedAccount, gotoSettings } from "./harness.mjs";

// Integrations -- finance folder feed. Purchase-order CSVs (+ their PDFs), payment CSVs and the
// legacy billing CSV are told apart by header. The fake folder is mutable (window.__folder) so a test
// can drop files in between syncs; it serves CSVs and PDFs through entries() and getFileHandle().
const acct = seedAccount({ id: "b1", name: "Billco", accountNo: "ACC-1" });
const tables = { accounts: [{ id: "b1", data: acct }], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };
const PO_HEAD = "accountNo,po_number,po_date,po_value,currency,years,billing_cycle,billing_start,po_file";
const poRow = (n, pdf) => `ACC-1,${n},2026-10-01,120000,INR,1,annual,2026-11-01,${pdf}`;
const seed = `
window.__folder = { files: [] };
const mk = f => ({ kind: "file", getFile: async () => new File([f.text], f.name, { lastModified: f.lastModified || 1 }) });
window.__handle = {
  kind: "directory", name: "Finance", async queryPermission() { return "granted"; }, async requestPermission() { return "granted"; },
  async *entries() { for (const f of window.__folder.files) yield [f.name, mk(f)]; },
  async getFileHandle(n) { const f = window.__folder.files.find(x => x.name === n); if (!f) throw new DOMException("nf", "NotFoundError"); return mk(f); },
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
// Settings (and so this card) is admin-only and admins always pass canFinance, so the default admin is the finance user.
const FIN = {};

const open = async (opts = {}) => {
  const ctx = await launchFinance({ user: FIN, ...opts, tables: { ...tables, ...(opts.tables || {}) }, seed });
  const { page } = ctx;
  await gotoSettings(page);
  await page.waitForFunction(() => [...document.querySelectorAll("h3")].some(h => /shared drive/i.test(h.textContent)), null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector("[data-files=finance]") || document.body.innerText.includes("Only finance users"), null, { timeout: 10000 });
  return ctx;
};
const setFolder = (page, files) => page.evaluate(f => { window.__folder.files = f; }, files);
const syncNow = async page => {
  await page.evaluate(() => { window.__n0 = document.body.textContent.length; });
  await page.click('button:has-text("Sync now")');
  await page.waitForFunction(() => /Sync now/.test(document.body.innerText) && !/Syncing/.test(document.body.innerText), null, { timeout: 10000 });
  await page.waitForTimeout(300);
};
const text = page => page.evaluate(() => document.body.innerText);
const pos = page => page.evaluate(() => window.__mockDb.purchase_orders);

test("finance feed: PO CSV with its PDF lands as a submitted PO", async () => {
  const { page, browser } = await open();
  await setFolder(page, [
    { name: "pos.csv", text: PO_HEAD + "\n" + poRow("PO-7", "po7.pdf") + "\n", lastModified: 1 },
    { name: "po7.pdf", text: "%PDF-1.4 fake", lastModified: 1 }]);
  await syncNow(page);
  const rows = await pos(page);
  assert(rows.length === 1, "expected 1 PO, got " + rows.length);
  assert(rows[0].status === "submitted", "status " + rows[0].status);
  assert(Number(rows[0].po_value) === 120000, "value " + rows[0].po_value);
  const keys = await page.evaluate(() => [...window.__mockStorage["purchase-orders"].keys()]);
  assert(keys.length === 1 && keys[0].startsWith("org-a/b1/"), "storage key " + keys);
  assert(/POs submitted 1/.test(await text(page)), "log: " + (await text(page)).slice(-400));
  await browser.close();
});

test("finance feed: PO row whose PDF is missing is refused", async () => {
  const { page, browser } = await open();
  await setFolder(page, [{ name: "pos.csv", text: PO_HEAD + "\n" + poRow("PO-7", "nope.pdf") + "\n", lastModified: 1 }]);
  await syncNow(page);
  assert((await pos(page)).length === 0, "PO written without a PDF");
  assert(/PDF nope\.pdf not found/.test(await text(page)), "log: " + (await text(page)).slice(-400));
  await browser.close();
});

test("finance feed: edited PO file re-syncs without duplicates", async () => {
  const { page, browser } = await open();
  const pdf = n => ({ name: n, text: "%PDF-1.4 fake", lastModified: 1 });
  await setFolder(page, [{ name: "pos.csv", text: PO_HEAD + "\n" + poRow("PO-7", "po7.pdf") + "\n", lastModified: 1 }, pdf("po7.pdf")]);
  await syncNow(page);
  assert((await pos(page)).length === 1, "first sync should add 1");
  await setFolder(page, [{ name: "pos.csv", text: PO_HEAD + "\n" + poRow("PO-7", "po7.pdf") + "\n" + poRow("PO-8", "po8.pdf") + "\n", lastModified: 2 }, pdf("po7.pdf"), pdf("po8.pdf")]);
  await syncNow(page);
  assert((await pos(page)).length === 2, "expected 2 POs, got " + (await pos(page)).length);
  const t = await text(page);
  assert(/already imported 1/.test(t) && /POs submitted 1/.test(t), "second log: " + t.slice(-500));
  // same po_number twice inside one file
  await setFolder(page, [{ name: "dup.csv", text: PO_HEAD + "\n" + poRow("PO-9", "po9.pdf") + "\n" + poRow("PO-9", "po9.pdf") + "\n", lastModified: 3 }, pdf("po9.pdf")]);
  await syncNow(page);
  assert((await pos(page)).length === 3, "duplicate row inserted twice");
  assert(/POs submitted 1 · already imported 1/.test(await text(page)), "dup log: " + (await text(page)).slice(-500));
  await browser.close();
});

test("finance feed: payment CSV marks an invoice paid", async () => {
  const { page, browser } = await open({ tables: { invoices: [{ id: "i1", number: "INV-0001", status: "pending" }] } });
  await setFolder(page, [{ name: "pay.csv", lastModified: 1, text:
    "invoice_number,status,paid_date,payment_ref\nINV-0001,paid,2026-10-30,UTR123\nINV-9999,paid,2026-10-30,X\n" }]);
  await syncNow(page);
  const c = await page.evaluate(() => window.__rpcCalls.filter(x => x.fn === "set_invoice_status"));
  assert(c.length === 1, "expected 1 rpc, got " + c.length);
  assert(c[0].args.p_status === "paid" && c[0].args.p_paid_date === "2026-10-30" && c[0].args.p_ref === "UTR123", JSON.stringify(c[0].args));
  const t = await text(page);
  assert(/invoices paid 1/.test(t), "log: " + t.slice(-400));
  assert(/unknown invoice/.test(t), "unknown invoice not logged: " + t.slice(-400));
  await browser.close();
});

test("finance feed: legacy billing CSV still works", async () => {
  const { page, browser } = await open();
  await setFolder(page, [{ name: "finance-billing.csv", lastModified: 1, text: "accountNo,name,billingCompletedDate\nACC-1,Billco,2026-09-30\n" }]);
  await syncNow(page);
  assert(/billing updated 1/.test(await text(page)), "log: " + (await text(page)).slice(-400));
  assert((await pos(page)).length === 0, "billing file wrote POs");
  await browser.close();
});

test("finance feed: a non-finance user never reaches the finance folder", async () => {
  // The card lives in Settings, which only admins see, and admins always pass canFinance -- so the
  // "Only finance users can sync this folder" notice is a belt-and-braces guard that no signed-in
  // role can currently render. What we can assert: a plain user has no Settings, hence no sync, no PO writes.
  const { page, browser } = await launchFinance({ user: { role: "user", finance: false }, tables, seed });
  await page.waitForSelector("#root", { timeout: 15000 });
  await page.waitForTimeout(500);
  assert(!(await page.$("text=Settings")), "a non-admin should have no Settings entry");
  assert(!/shared drive/i.test(await text(page)), "integrations card visible to a non-admin");
  assert((await pos(page)).length === 0, "PO written by a non-finance user");
  await browser.close();
});
