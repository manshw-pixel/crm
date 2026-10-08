import { test, assert } from "./framework.mjs";
import { launch } from "./harness.mjs";

// Total vs deployed licenses on the account form and detail header. Writes are merge_row rpcs;
// seeded rows also get accountNo/healthBand writes at load, so patches are inspected by row_id + field.
const acct = (id, name, extra) => ({ id, data: { id, name, tier: "Mid", arr: 0, currency: "USD", industry: "Tech", csm: "", startDate: "2025-01-01", renewalDate: `${new Date().getFullYear() + 2}-01-01`, contractStatus: "Active", inputs: { usage: 80, sentiment: 80, tickets: 0, nps: 40 }, history: [], inputsUpdatedAt: "2026-07-01", ...extra } });
const seed = rows => `window.__seedRows = { accounts: ${JSON.stringify(rows)}, contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [], orgs: [{ id: "org-a", name: "Acme Corp", max_accounts: null }] };
  window.__seedProfile = { id: "u1", name: "Admin", role: "admin", org_id: "org-a", platform_admin: false };`;
const ready = (page, n) => page.waitForFunction(k => window.__store && window.__store.getState().accounts.length === k, n);
const toAccounts = async page => { await page.waitForFunction(() => window.__orgLimits && window.__orgLimits.loaded === true, null, { timeout: 15000 }); await page.click('button[title="Accounts"]', { timeout: 10000 }); };
const openDetail = async (page, name) => { await page.click(`[data-account-row]:has-text('${name}')`, { timeout: 10000 }); await page.waitForSelector("[data-header-card]", { timeout: 10000 }); };
const openEdit = async page => { await page.click("text=✎ Edit account", { timeout: 10000 }); await page.waitForSelector("form", { timeout: 10000 }); };
const patches = (page, id) => page.evaluate(i => (window.__rpcCalls || []).filter(c => c.fn === "merge_row" && c.args.tbl === "accounts" && c.args.row_id === i).map(c => c.args.patch), id);
const fieldInput = (page, label) => page.locator(`label:has-text("${label}") input`).first();

test("edit form saves total and deployed licenses", async () => {
  const { page, browser } = await launch(seed([acct("a0", "Lic Co", { licenses: 200 })]));
  try {
    await ready(page, 1); await toAccounts(page); await openDetail(page, "Lic Co"); await openEdit(page);
    assert((await fieldInput(page, "Total licenses").inputValue()) === "200", "Total licenses should be 200");
    assert((await fieldInput(page, "Deployed licenses").inputValue()) === "", "Deployed licenses should be empty");
    await fieldInput(page, "Deployed licenses").fill("150");
    await page.click("text=Save changes", { timeout: 10000 });
    await page.waitForFunction(() => window.__store.getState().accounts[0].deployedLicenses === 150, null, { timeout: 15000 });
    await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "merge_row" && c.args.row_id === "a0" && c.args.patch.deployedLicenses === 150), null, { timeout: 15000 });
    const p = (await patches(page, "a0")).find(x => x.deployedLicenses === 150);
    // merge_row patches carry only changed fields, so unchanged Total is absent from the patch;
    // assert it was not clobbered and that the stored account holds both figures.
    assert(!("licenses" in p) || p.licenses === 200, "patch changed licenses: " + JSON.stringify(p));
    const a = await page.evaluate(() => window.__store.getState().accounts[0]);
    assert(a.licenses === 200 && a.deployedLicenses === 150, "store figures wrong: " + a.licenses + "/" + a.deployedLicenses);
  } finally { await browser.close(); }
});

test("empty Deployed stays not recorded when only the name changes", async () => {
  const { page, browser } = await launch(seed([acct("a0", "Lic Co", { licenses: 200 })]));
  try {
    await ready(page, 1); await toAccounts(page); await openDetail(page, "Lic Co"); await openEdit(page);
    await page.fill("form >> input >> nth=0", "Renamed Co");
    await page.click("text=Save changes", { timeout: 10000 });
    await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "merge_row" && c.args.row_id === "a0" && c.args.patch.name === "Renamed Co"), null, { timeout: 15000 });
    const all = await patches(page, "a0");
    assert(!all.some(x => x.deployedLicenses === 0), "deployedLicenses was written as 0: " + JSON.stringify(all));
    const d = await page.evaluate(() => window.__store.getState().accounts[0].deployedLicenses);
    assert(d == null, "store deployedLicenses should be absent/null, got " + d);
  } finally { await browser.close(); }
});

test("over-deployed shows a warning and still saves", async () => {
  const { page, browser } = await launch(seed([acct("a0", "Lic Co", { licenses: 100 })]));
  try {
    await ready(page, 1); await toAccounts(page); await openDetail(page, "Lic Co"); await openEdit(page);
    assert(!(await page.$("[data-overdeployed]")), "warning shown before over-deploying");
    await fieldInput(page, "Deployed licenses").fill("130");
    await page.waitForSelector("[data-overdeployed]", { timeout: 10000 });
    assert((await page.textContent("[data-overdeployed]")).includes("Deployed is higher than total."), "warning text missing");
    await page.click("text=Save changes", { timeout: 10000 });
    await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "merge_row" && c.args.row_id === "a0" && c.args.patch.deployedLicenses === 130), null, { timeout: 15000 });
  } finally { await browser.close(); }
});

test("detail header shows deployed-of-total, total only, or nothing", async () => {
  const { page, browser } = await launch(seed([
    acct("a0", "Both Co", { licenses: 200, deployedLicenses: 150 }),
    acct("a1", "TotalOnly Co", { licenses: 200 }),
    acct("a2", "None Co", {}),
  ]));
  try {
    await ready(page, 3); await toAccounts(page);
    const header = async name => { await openDetail(page, name); const t = await page.textContent("[data-header-card]"); await page.click('button[title="Accounts"]', { timeout: 10000 }); await page.waitForSelector("[data-account-row]", { timeout: 10000 }); return t; };
    const t0 = await header("Both Co");
    assert(t0.includes("150 deployed of 200 (75%)"), "expected deployed line, got: " + t0);
    const t1 = await header("TotalOnly Co");
    assert(/Licenses\s*200/i.test(t1) && !t1.includes("deployed of"), "expected total only, got: " + t1);
    const t2 = await header("None Co");
    assert(!/Licenses/i.test(t2), "expected no Licenses meta, got: " + t2);
  } finally { await browser.close(); }
});

// ---- CSV import ----
const importCsv = (page, text) => page.evaluate(async t => {
  const file = new File([t], "a.csv", { type: "text/csv" });
  return await new Promise(done => window.__health.importAccountsCSV(file, window.__store.getState().accounts, window.__store.dispatch, done, { name: "T" }));
}, text);
const waitAcct = (page, cond) => page.waitForFunction(c => { const a = window.__store.getState().accounts[0]; return a && new Function("a", "return " + c)(a); }, cond, { timeout: 15000 });

test("CSV import sets total and deployed licenses", async () => {
  const { page, browser } = await launch(seed([acct("a0", "Acct 0", { licenses: 100 })]));
  try {
    await ready(page, 1);
    await importCsv(page, "name,licenses,deployedLicenses\nAcct 0,300,120\n");
    await waitAcct(page, "a.licenses === 300 && a.deployedLicenses === 120");
    await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "merge_row" && c.args.row_id === "a0" && c.args.patch.deployedLicenses === 120 && c.args.patch.licenses === 300), null, { timeout: 15000 });
  } finally { await browser.close(); }
});

test("CSV headers 'Total licenses' and 'Deployed licenses' are recognised", async () => {
  const { page, browser } = await launch(seed([acct("a0", "Acct 0", { licenses: 100 })]));
  try {
    await ready(page, 1);
    await importCsv(page, "name,Total licenses,Deployed licenses\nAcct 0,250,90\n");
    await waitAcct(page, "a.licenses === 250 && a.deployedLicenses === 90");
  } finally { await browser.close(); }
});

test("CSV empty deployed cell leaves the value unchanged", async () => {
  const { page, browser } = await launch(seed([acct("a0", "Acct 0", { licenses: 100, deployedLicenses: 80 })]));
  try {
    await ready(page, 1);
    const res = await importCsv(page, "name,licenses,deployedLicenses\nAcct 0,300,\n");
    await waitAcct(page, "a.licenses === 300");
    const a = await page.evaluate(() => window.__store.getState().accounts[0]);
    assert(a.deployedLicenses === 80, "deployed changed to " + a.deployedLicenses);
    assert(!res.badNumber, "empty cell counted as unreadable");
    assert(!(await patches(page, "a0")).some(p => "deployedLicenses" in p), "a patch touched deployedLicenses");
  } finally { await browser.close(); }
});

test("CSV unreadable deployed value is left unchanged and reported", async () => {
  const { page, browser } = await launch(seed([acct("a0", "Acct 0", { licenses: 100, deployedLicenses: 80 })]));
  try {
    await ready(page, 1);
    const res = await importCsv(page, "name,deployedLicenses\nAcct 0,abc\n");
    assert(res.badNumber === 1, "badNumber should be 1, got " + res.badNumber);
    const a = await page.evaluate(() => window.__store.getState().accounts[0]);
    assert(a.deployedLicenses === 80, "deployed changed to " + a.deployedLicenses);
  } finally { await browser.close(); }
});

// ---- Dashboard card ----
const churned = (id, name, extra) => acct(id, name, { contractStatus: "Churned", churn: { date: "2026-06-01", arr: 0, currency: "USD", reason: "Budget" }, ...extra });
const card = async page => { await page.waitForSelector("[data-license-card]", { timeout: 15000 }); return page.textContent("[data-license-card]"); };

test("dashboard card totals only active accounts with both figures", async () => {
  const { page, browser } = await launch(seed([
    acct("a", "A Co", { licenses: 200, deployedLicenses: 150 }), acct("b", "B Co", { licenses: 100, deployedLicenses: 50 }),
    acct("c", "C Co", { licenses: 400 }), churned("d", "D Co", { licenses: 1000, deployedLicenses: 0 }),
  ]));
  try {
    await ready(page, 4);
    const t = await card(page);
    assert(t.includes("300 total · 200 deployed · 67%"), "summary wrong: " + t);
    assert(t.includes("1 account has no deployed count yet."), "missing note wrong: " + t);
    assert(!t.includes("1,000") && !t.includes("D Co"), "churned account leaked: " + t);
  } finally { await browser.close(); }
});

test("dashboard card lowest list orders, flags amber below 50, and opens the account", async () => {
  const { page, browser } = await launch(seed([
    acct("a", "A Co", { licenses: 200, deployedLicenses: 150 }), acct("b", "B Co", { licenses: 100, deployedLicenses: 50 }),
    acct("e", "E Co", { licenses: 100, deployedLicenses: 40 }),
  ]));
  try {
    await ready(page, 3); await card(page);
    const order = await page.$$eval("[data-license-row]", els => els.map(e => e.getAttribute("data-license-row")));
    assert(order.join() === "e,b,a", "order wrong: " + order);
    const bText = await page.textContent("[data-license-row='b']");
    assert(bText.includes("50 / 100") && bText.includes("50%"), "B row wrong: " + bText);
    assert(await page.$("[data-license-row='b'] [data-low]") === null, "50% must not be amber");
    assert(await page.$("[data-license-row='e'] [data-low]") !== null, "40% should be amber");
    await page.click("[data-license-row='b']");
    await page.waitForSelector("[data-header-card]", { timeout: 10000 });
    assert((await page.textContent("[data-header-card]")).includes("50 deployed of 100"), "B account page not opened");
  } finally { await browser.close(); }
});

test("dashboard card shows over-deployment as 130% with a full bar", async () => {
  const { page, browser } = await launch(seed([acct("a", "Over Co", { licenses: 100, deployedLicenses: 130 })]));
  try {
    await ready(page, 1); await card(page);
    assert((await page.textContent("[data-license-row='a']")).includes("130%"), "130% missing");
    const w = await page.getAttribute("[data-license-bar]", "style");
    assert(/width:\s*100%/.test(w), "bar width should be 100%, got " + w);
  } finally { await browser.close(); }
});

test("dashboard card empty states", async () => {
  let h = await launch(seed([acct("a", "Plain Co", {})]));
  try {
    await ready(h.page, 1);
    assert((await card(h.page)).includes("No accounts have licenses yet. Add Total licenses on an account's Edit form."), "empty state 1 wrong");
  } finally { await h.browser.close(); }
  h = await launch(seed([acct("a", "Tot Co", { licenses: 100 })]));
  try {
    await ready(h.page, 1);
    assert((await card(h.page)).includes("No deployed counts recorded yet."), "empty state 2 wrong");
    assert(await h.page.$("[data-license-row]") === null, "list should be absent");
  } finally { await h.browser.close(); }
});

test("dashboard card follows the My book scope", async () => {
  const { page, browser } = await launch(seed([
    acct("a", "Mine Co", { csm: "Admin", licenses: 100, deployedLicenses: 60 }),
    acct("b", "Theirs Co", { csm: "Other", licenses: 500, deployedLicenses: 100 }),
  ]));
  try {
    await ready(page, 2);
    assert((await card(page)).includes("600 total · 160 deployed"), "all scope wrong");
    await page.click("[data-scope-toggle] button:has-text('My book')");
    await page.waitForFunction(() => (document.querySelector("[data-license-card]") || {}).textContent.includes("100 total · 60 deployed"), null, { timeout: 10000 });
    assert(!(await card(page)).includes("Theirs Co"), "other CSM leaked");
  } finally { await browser.close(); }
});
