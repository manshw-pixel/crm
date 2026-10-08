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
