import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { test, assert } from "./framework.mjs";
import { launch, launchFinance, gotoSettings, routeExcelJS, seedAccount } from "./harness.mjs";

// Integrations -- Excel. Both feed folders read .xlsx as well as .csv (converted to CSV text before the
// importers see it), and every template downloads as .xlsx with list dropdowns. The fake folder
// (window.__folder.files = [{ name, text | b64, lastModified }]) is mutable between syncs.
const folderSeed = key => `
window.__folder = { files: [] };
const mkFile = f => new File([f.b64 ? Uint8Array.from(atob(f.b64), c => c.charCodeAt(0)) : f.text || ""], f.name, { lastModified: f.lastModified || 1 });
const mk = f => ({ kind: "file", getFile: async () => mkFile(f) });
window.__handle = {
  kind: "directory", name: "Feed", async queryPermission() { return "granted"; }, async requestPermission() { return "granted"; },
  async *entries() { for (const f of window.__folder.files) yield [f.name, mk(f)]; },
  async getFileHandle(n) { const f = window.__folder.files.find(x => x.name === n); if (!f) throw new DOMException("nf", "NotFoundError"); return mk(f); },
};
window.showDirectoryPicker = async () => window.__handle;
(() => {
  const store = new Map([["${key}", window.__handle]]);
  const later = f => setTimeout(f, 0);
  const db = { createObjectStore() {}, transaction() { const tx = { objectStore: () => ({
    put(v, k) { store.set(k, v); later(() => tx.oncomplete && tx.oncomplete()); },
    delete(k) { store.delete(k); later(() => tx.oncomplete && tx.oncomplete()); },
    get(k) { const rq = {}; later(() => { rq.result = store.get(k); rq.onsuccess && rq.onsuccess(); }); return rq; },
  }) }; return tx; } };
  Object.defineProperty(window, "indexedDB", { value: { open() { const r = {}; later(() => { r.result = db; r.onsuccess && r.onsuccess(); }); return r; } } });
})();
`;
const EMPTY = { accounts: [], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };
const xlsxB64 = async rows => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Sheet1");
  rows.forEach(r => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
};
const openSales = async () => {
  const ctx = await launch(`window.__seedRows = ${JSON.stringify(EMPTY)};\n${folderSeed("sales")}`);
  await routeExcelJS(ctx.page);
  await ctx.page.click('button[title="Settings"]', { timeout: 15000 });
  await ctx.page.waitForSelector("[data-files='sales']", { timeout: 10000 });
  return ctx;
};
const acct = seedAccount({ id: "b1", name: "Billco", accountNo: "1001" });
const openFinance = async () => {
  const ctx = await launchFinance({ user: {}, tables: { ...EMPTY, accounts: [{ id: "b1", data: acct }] }, seed: folderSeed("finance") });
  await routeExcelJS(ctx.page);
  await gotoSettings(ctx.page);
  await ctx.page.waitForSelector("[data-files='finance']", { timeout: 10000 });
  return ctx;
};
const setFolder = (page, files) => page.evaluate(f => { window.__folder.files = f; }, files);
const syncNow = async (page, feed) => {
  await page.click(`[data-feed=${feed}] button:has-text("Sync now")`);
  await page.waitForFunction(f => !/Syncing/.test(document.querySelector(`[data-feed=${f}]`).innerText), feed, { timeout: 15000 });
  await page.waitForTimeout(400);
};
const state = page => page.evaluate(() => { const s = window.__store.getState(); return { projects: s.projects || [], accounts: s.accounts, log: (s.settings.integrations || {}).log || [] }; });
const fileRow = (page, name) => page.evaluate(n => { const li = [...document.querySelectorAll("[data-file]")].find(l => l.dataset.file === n); return li ? li.innerText : null; }, name);

test("sales .xlsx in the folder imports like a CSV", async () => {
  const { page, browser } = await openSales();
  try {
    const b64 = await xlsxB64([["name", "destination", "order_form", "go_live_target", "customer_contact", "modules_scope"],
      ["  Kestrel ", "onboarding", "Yes", new Date(Date.UTC(2026, 10, 15)), "Asha", "Core"]]);
    await setFolder(page, [{ name: "sales.xlsx", b64, lastModified: 5 }]);
    await syncNow(page, "sales");
    let s = await state(page);
    assert(s.accounts.some(a => a.name === "Kestrel"), "account imported: " + JSON.stringify(s.log));
    assert(s.projects.length === 1 && s.projects[0].stage === "queued", "project queued: " + JSON.stringify(s.projects) + JSON.stringify(s.log));
    const goLive = JSON.stringify(s.projects[0]).match(/2026-11-\d\d/);
    assert(goLive && goLive[0] === "2026-11-15", "go-live date kept its calendar day: " + JSON.stringify(s.projects[0]));
    const last = s.log[s.log.length - 1];
    assert(last.file === "sales.xlsx" && /projects queued 1/.test(last.msg), "log: " + JSON.stringify(last));
    assert(/✓/.test(await fileRow(page, "sales.xlsx")), "file row: " + await fileRow(page, "sales.xlsx"));
    const n = s.log.length;
    await syncNow(page, "sales");
    s = await state(page);
    assert(s.log.length === n && s.projects.length === 1, "unchanged .xlsx re-imported: " + JSON.stringify(s.log));
  } finally { await browser.close(); }
});

test("finance .xlsx PO file imports (number-typed accountNo, typed dates)", async () => {
  const { page, browser } = await openFinance();
  try {
    const b64 = await xlsxB64([["accountNo", "po_number", "po_date", "po_value", "currency", "years", "billing_cycle", "billing_start", "po_file"],
      [1001, "PO-7", new Date(Date.UTC(2026, 9, 1)), 120000, "INR", 1, "annual", new Date(Date.UTC(2026, 10, 1)), "po7.pdf"]]);
    await setFolder(page, [{ name: "pos.xlsx", b64, lastModified: 1 }, { name: "po7.pdf", text: "%PDF-1.4 fake", lastModified: 1 }]);
    await syncNow(page, "finance");
    const rows = await page.evaluate(() => window.__mockDb.purchase_orders);
    assert(rows.length === 1 && rows[0].status === "submitted", "POs: " + JSON.stringify(rows) + JSON.stringify((await state(page)).log));
    assert(String(rows[0].po_date).startsWith("2026-10-01"), "po_date " + rows[0].po_date);
  } finally { await browser.close(); }
});

test("Excel lock file is ignored", async () => {
  const { page, browser } = await openSales();
  try {
    await setFolder(page, [{ name: "~$sales.xlsx", text: "lock", lastModified: 1 }, { name: "a.csv", text: "name\nZed\n", lastModified: 1 }]);
    await syncNow(page, "sales");
    assert(await fileRow(page, "~$sales.xlsx") === null, "lock file listed");
    assert(!(await state(page)).log.some(l => l.file === "~$sales.xlsx"), "lock file imported");
    assert(await fileRow(page, "a.csv") !== null, "csv not listed");
  } finally { await browser.close(); }
});

test("corrupt xlsx is logged and the folder continues", async () => {
  const { page, browser } = await openSales();
  try {
    await setFolder(page, [{ name: "bad.xlsx", text: "not a zip at all", lastModified: 1 }, { name: "good.csv", text: "name\nGoodCo\n", lastModified: 1 }]);
    await syncNow(page, "sales");
    const s = await state(page);
    const bad = s.log.find(l => l.file === "bad.xlsx");
    assert(bad && bad.err && /can't read Excel file/.test(bad.msg), "bad log: " + JSON.stringify(s.log));
    assert(s.accounts.some(a => a.name === "GoodCo"), "csv not imported: " + JSON.stringify(s.log));
  } finally { await browser.close(); }
});

const download = async (page, feed, label) => {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click(`[data-feed=${feed}] button:has-text("${label}")`)]);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(readFileSync(await dl.path()));
  return { name: dl.suggestedFilename(), wb };
};
const listOf = (ws, header) => {
  const col = ws.getRow(1).values.indexOf(header);
  assert(col > 0, "no column " + header);
  const dv = ws.getCell(2, col).dataValidation;
  assert(dv && dv.type === "list", header + " validation: " + JSON.stringify(dv));
  assert(dv.showErrorMessage, header + " showErrorMessage");
  assert(JSON.stringify(ws.getCell(500, col).dataValidation) === JSON.stringify(dv), header + " not applied to row 500");
  return dv.formulae[0];
};

test("onboarding Excel template has dropdowns", async () => {
  const { page, browser } = await openSales();
  try {
    const { name, wb } = await download(page, "sales", "Onboarding");
    assert(name === "sales-onboarding.xlsx", name);
    const ws = wb.worksheets[0];
    assert(ws.getCell(1, 1).font && ws.getCell(1, 1).font.bold, "header bold");
    assert(ws.views[0] && ws.views[0].state === "frozen" && ws.views[0].ySplit === 1, "header frozen " + JSON.stringify(ws.views));
    const dest = listOf(ws, "destination");
    assert(/onboarding/.test(dest) && /accounts/.test(dest), dest);
    assert(listOf(ws, "order_form") === '"Yes,No"', "order_form " + listOf(ws, "order_form"));
    assert(listOf(ws, "tier") === '"Enterprise,Mid,SMB"', listOf(ws, "tier"));
    const team = await page.evaluate(() => (window.__store.getState().team || []).filter(u => !u.disabled && u.name).map(u => u.name));
    assert(team.length > 0, "harness should sign in at least one team member");
    const csm = listOf(ws, "csm");
    assert(team.every(n => csm.includes(n)), `csm list ${csm} lacks ${team}`);
  } finally { await browser.close(); }
});

test("CSM dropdown is skipped when the team is empty", async () => {
  const { page, browser } = await openSales();
  try {
    await page.evaluate(() => { const s = window.__store.getState(); window.__store.dispatch({ type: "REPLACE", state: { ...s, team: [] } }); });
    await page.waitForFunction(() => (window.__store.getState().team || []).length === 0, null, { timeout: 5000 });
    const { wb } = await download(page, "sales", "Onboarding");
    const ws = wb.worksheets[0];
    const csmCol = ws.getRow(1).values.indexOf("csm");
    assert(csmCol > 0 && !ws.getCell(2, csmCol).dataValidation, "no team -> no csm dropdown");
    assert(listOf(ws, "destination"), "other dropdowns still present");
  } finally { await browser.close(); }
});

test("a list over Excel's 255-char limit goes on the hidden Lists sheet", async () => {
  const { page, browser } = await openSales();
  try {
    await page.evaluate(() => { const s = window.__store.getState();
      window.__store.dispatch({ type: "REPLACE", state: { ...s, team: Array.from({ length: 30 }, (_, i) => ({ id: "m" + i, name: "Team Member Number " + i })) } }); });
    await page.waitForFunction(() => (window.__store.getState().team || []).length === 30, null, { timeout: 5000 });
    const { wb } = await download(page, "sales", "Onboarding");
    const f = listOf(wb.worksheets[0], "csm");
    assert(/^Lists!\$[A-Z]+\$1:\$[A-Z]+\$30$/.test(f), "csm formula " + f);
    const lists = wb.getWorksheet("Lists");
    assert(lists && lists.state === "hidden", "Lists sheet hidden");
    const col = f.match(/^Lists!\$([A-Z]+)/)[1];
    assert(lists.getCell(col + "30").value === "Team Member Number 29", "list values " + lists.getCell(col + "30").value);
  } finally { await browser.close(); }
});

test("PO and Payments Excel templates have dropdowns; CSV link still downloads CSV", async () => {
  const { page, browser } = await openFinance();
  try {
    const po = await download(page, "finance", "Purchase orders");
    assert(po.name === "finance-purchase-orders.xlsx", po.name);
    assert(listOf(po.wb.worksheets[0], "billing_cycle") === '"quarterly,half_yearly,annual"', "billing_cycle");
    assert(listOf(po.wb.worksheets[0], "years") === '"1,2,3,4,5,6,7,8,9,10"', "years");
    const pay = await download(page, "finance", "Payments");
    assert(pay.name === "finance-payments.xlsx", pay.name);
    assert(listOf(pay.wb.worksheets[0], "status") === '"paid,waived"', "status");
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.click('[data-feed=finance] [data-csv-template="Purchase orders"]')]);
    assert(dl.suggestedFilename() === "finance-purchase-orders.csv", dl.suggestedFilename());
  } finally { await browser.close(); }
});
