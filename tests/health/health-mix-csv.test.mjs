import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const A = seedAccount({ id: "c1", name: "Csv Co", accountNo: 7, inputs: { usage: 80, sentiment: 80, tickets: 0, nps: 40, value: { caseStudy: true, savings: true, roi: false } } });
const seed = `window.__seedRows = { accounts: ${rows([A])}, contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
async function importText(page, text) {
  return page.evaluate(async t => {
    const file = new File([t], "a.csv", { type: "text/csv" });
    const res = await new Promise(done => window.__health.importAccountsCSV(file, window.__store.getState().accounts, window.__store.dispatch, done, { name: "T" }));
    await new Promise(r => setTimeout(r, 80));
    return { res, a: window.__store.getState().accounts.find(x => x.name === "Csv Co") };
  }, text);
}

test("export writes the three Value columns as yes/no", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    const csv = await page.evaluate(() => window.__health.accountsCSVText(window.__store.getState().accounts));
    const [head, row] = csv.split("\n");
    const cols = head.split(","), vals = row.split(",").map(v => v.replace(/"/g, ""));
    const at = c => vals[cols.indexOf(c)];
    assert(at("caseStudy") === "yes" && at("approvedSavings") === "yes" && at("approvedRoi") === "no", "export: " + row);
  } finally { await browser.close(); }
});

test("a CSV setting one Value column leaves the other two unchanged", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    const { a } = await importText(page, "accountNo,name,approvedRoi\n7,Csv Co,YES\n");
    assert(JSON.stringify(a.inputs.value) === JSON.stringify({ caseStudy: true, savings: true, roi: true }), "value: " + JSON.stringify(a.inputs.value));
  } finally { await browser.close(); }
});

test("blank leaves a value alone; an unreadable value is counted for the banner", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    const { res, a } = await importText(page, "accountNo,name,caseStudy,approvedSavings\n7,Csv Co,,maybe\n");
    assert(a.inputs.value.caseStudy === true && a.inputs.value.savings === true, "changed: " + JSON.stringify(a.inputs.value));
    assert(res.badValue === 1, "badValue: " + res.badValue);
  } finally { await browser.close(); }
});

test("re-importing our own export adds no history point and keeps inputsUpdatedAt", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    const before = await page.evaluate(() => { const a = window.__store.getState().accounts[0]; return { h: (a.history || []).length, u: a.inputsUpdatedAt, v: JSON.stringify(a.inputs.value) }; });
    const csv = await page.evaluate(() => window.__health.accountsCSVText(window.__store.getState().accounts));
    const { a } = await importText(page, csv);
    assert((a.history || []).length === before.h, "history " + before.h + " -> " + (a.history || []).length);
    assert(a.inputsUpdatedAt === before.u, "inputsUpdatedAt " + before.u + " -> " + a.inputsUpdatedAt);
    assert(JSON.stringify(a.inputs.value) === before.v, "value: " + JSON.stringify(a.inputs.value));
  } finally { await browser.close(); }
});

test("a CSV that changes one answer updates it and logs exactly one history point", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    const h0 = await page.evaluate(() => (window.__store.getState().accounts[0].history || []).length);
    const { a } = await importText(page, "accountNo,name,approvedSavings\n7,Csv Co,no\n");
    assert(JSON.stringify(a.inputs.value) === JSON.stringify({ caseStudy: true, savings: false, roi: false }), "value: " + JSON.stringify(a.inputs.value));
    assert((a.history || []).length === h0 + 1, "history " + h0 + " -> " + (a.history || []).length);
  } finally { await browser.close(); }
});

test("a new account from a CSV with one Value column stores all three booleans", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    await importText(page, "name,approvedRoi\nBrand New,yes\n");
    const v = await page.evaluate(() => window.__store.getState().accounts.find(x => x.name === "Brand New").inputs.value);
    assert(JSON.stringify(v) === JSON.stringify({ caseStudy: false, savings: false, roi: true }), "value: " + JSON.stringify(v));
  } finally { await browser.close(); }
});
