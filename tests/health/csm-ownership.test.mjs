// Admin-only CSM assignment, CSM since, timeline entry (spec 2026-10-13 PR 2).
import { launch, seedAccount } from "./harness.mjs";
import { test, assert } from "./framework.mjs";

const seed = (accounts, role) => `window.__seedRows = { accounts: ${JSON.stringify(accounts)}.map(d => ({ id: d.id, data: d })),`
  + ` contacts: [], activities: [], tasks: [], opportunities: [], settings: [],`
  + ` profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "${role}" }, { id: "u2", org_id: "org-a", name: "Ravi", role: "user" }] };`;
const acct = (page, id) => page.evaluate(i => window.__store.getState().accounts.find(a => a.id === i), id);
const acts = (page, id) => page.evaluate(i => window.__store.getState().activities.filter(x => x.accountId === i).map(x => x.summary), id);
const openEdit = async (page, name) => {
  await page.click('button[title="Accounts"]');
  await page.getByText(name).first().click();
  await page.waitForSelector("[data-header-card]");
  await page.click("text=✎ Edit account");
  await page.waitForSelector("[data-csm-select]");
};

test("a CSM sees the CSM owner locked", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "a1", name: "Acme", csm: "Ravi" })], "user"));
  try {
    await openEdit(page, "Acme");
    assert(await page.locator("[data-csm-select]").isDisabled(), "CSM select editable for a non-admin");
    assert(/Only admins can change this/.test(await page.textContent("[data-csm-lock]")), "lock note missing");
  } finally { await browser.close(); }
});

test("admin changes CSM: csmSince saved, timeline entry added, header shows since", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "a1", name: "Acme", csm: "Test User" })], "admin"));
  try {
    await openEdit(page, "Acme");
    assert(await page.locator("[data-csm-select]").isEnabled(), "CSM select locked for an admin");
    assert(await page.locator("[data-csm-since]").count() === 0, "CSM since shown before any change");
    await page.selectOption("[data-csm-select]", "Ravi");
    await page.fill("[data-csm-since]", "2026-10-01");
    await page.click("text=Save changes");
    const a = await acct(page, "a1");
    assert(a.csm === "Ravi" && a.csmSince === "2026-10-01", "saved: " + JSON.stringify({ csm: a.csm, csmSince: a.csmSince }));
    assert((await acts(page, "a1")).includes("CSM changed from Test User to Ravi by Test User"), "timeline: " + JSON.stringify(await acts(page, "a1")));
    assert(/since Oct 1, 2026/.test(await page.textContent("[data-csm-since-label]")), "header since label");
  } finally { await browser.close(); }
});

test("admin edits other fields, or changes CSM and back: no csmSince, no timeline entry", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "a1", name: "Acme", csm: "Test User" })], "admin"));
  try {
    await openEdit(page, "Acme");
    await page.selectOption("[data-csm-select]", "Ravi");
    await page.selectOption("[data-csm-select]", "Test User");
    await page.fill('label:has-text("ARR") input', "999");
    await page.click("text=Save changes");
    const a = await acct(page, "a1");
    assert(a.arr === 999 && a.csm === "Test User" && !a.csmSince, "unexpected: " + JSON.stringify({ arr: a.arr, csm: a.csm, csmSince: a.csmSince }));
    assert(!(await acts(page, "a1")).some(s => /^CSM /.test(s)), "timeline entry written without a change");
  } finally { await browser.close(); }
});

test("a CSM's new account is owned by them", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "a1", name: "Acme" })], "user"));
  try {
    await page.click('button[title="Accounts"]');
    await page.click("text=+ New account");
    await page.waitForSelector("[data-csm-select]");
    await page.fill('label:has-text("Name") input', "Brand New");
    await page.click("text=Create account");
    const made = await page.evaluate(() => window.__store.getState().accounts.find(a => a.name === "Brand New"));
    assert(made && made.csm === "Test User", "new account csm: " + (made && made.csm));
  } finally { await browser.close(); }
});

test("bulk Reassign CSM is admin-only", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "a1", name: "Acme" })], "user"));
  try {
    await page.click('button[title="Accounts"]');
    await page.locator("[data-account-row] input[type=checkbox]").first().check();
    assert(await page.getByRole("button", { name: "Reassign CSM" }).count() === 0, "CSM sees Reassign CSM");
  } finally { await browser.close(); }
  const adm = await launch(seed([seedAccount({ id: "a1", name: "Acme" })], "admin"));
  try {
    await adm.page.click('button[title="Accounts"]');
    await adm.page.locator("[data-account-row] input[type=checkbox]").first().check();
    assert(await adm.page.getByRole("button", { name: "Reassign CSM" }).count() === 1, "control: admin lost Reassign CSM");
  } finally { await adm.browser.close(); }
});

test("CSV import by a CSM ignores the csm column and owns new rows", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "a1", name: "Acme", csm: "Ravi" })], "user"));
  try {
    await page.click('button[title="Accounts"]');
    const csv = "name,csm,industry\nAcme,Test User,Retail\nFresh Co,Ravi,Tech\n";
    await page.setInputFiles('input[type=file][accept*="csv"]', { name: "a.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.waitForFunction(() => window.__store.getState().accounts.some(a => a.name === "Fresh Co"));
    const s = await page.evaluate(() => window.__store.getState().accounts.map(a => ({ name: a.name, csm: a.csm, industry: a.industry })));
    const acme = s.find(a => a.name === "Acme"), fresh = s.find(a => a.name === "Fresh Co");
    assert(acme.csm === "Ravi" && acme.industry === "Retail", "existing row: " + JSON.stringify(acme));
    assert(fresh.csm === "Test User", "new row: " + JSON.stringify(fresh));
  } finally { await browser.close(); }
});
