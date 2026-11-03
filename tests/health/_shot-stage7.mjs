// Stage 7 screenshots: Finance (inline PO review open) and Settings (Integrations in view) in light, dark and 390 phone (dev aid, not a test).
// Usage: node tests/health/_shot-stage7.mjs <out-dir>
import { mkdirSync } from "node:fs";
import { launchFinance, gotoSettings, seedAccount } from "./harness.mjs";
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const DAY = 86400000;
const day = n => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const ACCT = (id, name) => ({ id, data: { id, name, tier: "Mid", arr: 0, currency: "INR", industry: "Tech", csm: "", startDate: "2025-01-01", renewalDate: `${new Date().getFullYear() + 2}-01-01`, contractStatus: "Active", inputs: { usage: 80, sentiment: 80, tickets: 0, nps: 40 }, history: [], inputsUpdatedAt: "2026-07-01" } });
const EMPTY = { contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };
const ENT = (id, name, cur, prefix) => ({ id, org_id: "org-a", name, country: cur === "INR" ? "IN" : "US", currency: cur, invoice_prefix: prefix, next_number: 9, default_tax_pct: 0, state: "", address: "", tax_id: "", tax_id_label: "", bank_details: "", lut_number: null, created_at: "2026-01-01T00:00:00Z" });
const INV = o => ({ account_id: "a1", account_name: "Acme Ltd", currency: "USD", subtotal: 1000, total: 1000, status: "pending", sent_at: "2026-10-01T00:00:00Z", issue_date: day(-40), due_date: day(20), entity_id: "e2", pdf_path: "org-a/x.pdf", paid_date: null, payment_ref: null, waive_reason: null, ...o });
const INVOICES = [
  INV({ id: "i-ovd", number: "IN-0001", currency: "INR", subtotal: 236000, total: 236000, due_date: day(-31), issue_date: day(-60), entity_id: "e1" }),
  INV({ id: "u-p1", number: "US-0001", status: "paid", paid_date: day(-5), total: 2000, subtotal: 2000 }),
  INV({ id: "u-p2", number: "US-0002", status: "paid", paid_date: day(-4), total: 1500, subtotal: 1500 }),
  INV({ id: "u-pe", number: "US-0003", total: 700, subtotal: 700 }),
  INV({ id: "u-wa", number: "US-0004", status: "waived", waive_reason: "goodwill", total: 300, subtotal: 300 }),
  INV({ id: "u-un", number: "US-0005", sent_at: null, total: 450, subtotal: 450 }),
];
const PO = (id, acct, name, num, status, extra = {}) => ({ id, org_id: "org-a", account_id: acct, account_name: name, po_number: num, po_date: day(-30), po_value: 400000, currency: "INR", years: 1,
  billing_cycle: "quarterly", billing_start: day(-30), file_path: "org-a/x.pdf", status, submitted_by: "u1", reviewed_by: null, reviewed_at: null, reject_reason: null, created_at: "2026-10-01T00:00:00Z", ...extra });
const POS = [PO("po-a", "a1", "Acme Ltd", "4500001", "submitted"), PO("po-b", "a2", "Other Co", "4500002", "submitted"), PO("po-c", "a1", "Acme Ltd", "4500003", "approved")];
const SCHED = [1, 2, 3].map(i => ({ id: "s" + i, org_id: "org-a", po_id: "po-c", seq: i, invoice_id: null, amount: 100000, period_start: day(-100 + i * 10), period_end: day(-10 + i) }));
const TABLES = { ...EMPTY, accounts: [ACCT("a1", "Acme Ltd"), ACCT("a2", "Other Co")], invoices: INVOICES, billing_entities: [ENT("e1", "OneVio India", "INR", "IN-"), ENT("e2", "OneVio Inc", "USD", "US-")],
  purchase_orders: POS, po_schedule: SCHED };

const SACCT = seedAccount({ id: "b1", name: "Billco", accountNo: "ACC-1" });
const INTEG = { processed: { "a.csv|1000": "2026-10-28" }, log: [
  { t: "2026-10-27T10:00:00.000Z", folder: "sales", file: "a.csv", msg: "all good", err: false },
  { t: "2026-10-28T10:00:00.000Z", folder: "finance", file: "b.csv", msg: "boom", err: true }] };
const STABLES = { accounts: [{ id: "b1", data: SACCT }], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [{ id: "1", data: { integrations: INTEG } }] };
// Feed stub (pattern from integrations-ui.test.mjs): sales is granted with 3 files (imported / new / unreadable); finance has lapsed access.
const FEED_SEED = `
const mk = (name, perm, files) => ({ kind: "directory", name, async queryPermission() { return perm; }, async requestPermission() { return "granted"; },
  async *entries() { for (const f of files) yield [f.name, { kind: "file", getFile: async () => { if (f.bad) throw new Error("offline"); return new File(["x"], f.name, { lastModified: 1000 }); } }]; } });
window.__sales = mk("Sales Sync", "granted", [{ name: "a.csv" }, { name: "b.csv" }, { name: "c.csv", bad: true }]);
window.__fin = mk("Finance Sync", "prompt", []);
(() => {
  const store = new Map([["sales", window.__sales], ["finance", window.__fin]]);
  const later = f => setTimeout(f, 0);
  const db = { createObjectStore() {}, transaction() { const tx = { objectStore: () => ({
    put(v, k) { store.set(k, v); later(() => tx.oncomplete && tx.oncomplete()); }, delete(k) { store.delete(k); later(() => tx.oncomplete && tx.oncomplete()); },
    get(k) { const rq = {}; later(() => { rq.result = store.get(k); rq.onsuccess && rq.onsuccess(); }); return rq; } }) }; return tx; } };
  Object.defineProperty(window, "indexedDB", { value: { open() { const r = {}; later(() => { r.result = db; r.onsuccess && r.onsuccess(); }); return r; } } });
  window.showDirectoryPicker = async () => window.__sales;
})();`;

const theme = t => `try { localStorage.setItem("onevio.theme", "${t}"); } catch (e) {}`;
for (const [w, h, th, tag] of [[1440, 900, "light", "light"], [1440, 900, "dark", "dark"], [390, 844, "light", "phone"]]) {
  const f = await launchFinance({ user: { role: "admin" }, tables: TABLES, seed: theme(th) });
  try {
    await f.page.click('button[title="Finance"]', { timeout: 15000 });
    await f.page.waitForSelector("[data-finance-page]"); await f.page.waitForSelector("[data-invoice-row]");
    await f.page.setViewportSize({ width: w, height: h });
    await f.page.click('[data-po-queue] [data-po-row="4500001"] [data-po-review]');
    await f.page.waitForSelector("[data-po-inline-review]"); await f.page.waitForTimeout(700);
    await f.page.screenshot({ path: `${out}/finance-${tag}.png`, fullPage: true });
  } finally { await f.browser.close(); }
  const s = await launchFinance({ user: { role: "admin" }, tables: STABLES, seed: `${theme(th)}
${FEED_SEED}` });
  try {
    await s.page.setViewportSize({ width: 1440, height: 900 });
    await gotoSettings(s.page);
    await s.page.waitForSelector("[data-feed=sales] [data-file]", { timeout: 10000 });
    await s.page.setViewportSize({ width: w, height: h });
    await s.page.evaluate(() => document.getElementById("set-integrations").scrollIntoView());
    await s.page.waitForTimeout(700);
    await s.page.evaluate(() => document.getElementById("set-integrations").scrollIntoView()); await s.page.waitForTimeout(500);
    await s.page.screenshot({ path: `${out}/settings-${tag}.png` });
    console.log("shot", tag);
  } finally { await s.browser.close(); }
}
