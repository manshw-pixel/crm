import { test, assert } from "./framework.mjs";
import { launch, launchFinance, gotoSettings, seedAccount } from "./harness.mjs";

const LENA = { id: "u2", name: "Lena", role: "user", disabled: false, finance: false, email: "l@x.test" };

test("lead role: admin assigns lead from the Users card", async () => {
  const { page, browser } = await launchFinance({ users: [LENA] });
  await gotoSettings(page);
  const sel = page.locator('[data-role-select="u2"]');
  await sel.waitFor({ timeout: 10000 });
  await sel.selectOption("lead");
  await page.waitForFunction(() => window.__mockDb.profiles.find(p => p.id === "u2")?.role === "lead", null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('[data-user-id="u2"]')?.innerText.includes("lead"), null, { timeout: 5000 });
  await browser.close();
});

test("lead role: invite form offers lead", async () => {
  const { page, browser } = await launchFinance({ users: [LENA] });
  await gotoSettings(page);
  await page.locator('[data-user-id="u2"]').waitFor({ timeout: 10000 });
  const opts = await page.locator('form:has(input[placeholder="Temp password"]) select option').allTextContents();
  assert(opts.includes("lead"), "invite options: " + opts.join(","));
  await browser.close();
});

const seedLead = (accounts, role) => `window.__seedRows = { accounts: ${JSON.stringify(accounts)}.map(d => ({ id: d.id, data: d })),`
  + ` contacts: [], activities: [], tasks: [], opportunities: [], settings: [],`
  + ` profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "${role}" }, { id: "u2", org_id: "org-a", name: "Ravi", role: "user" }, { id: "u3", org_id: "org-a", name: "Lena Lead", role: "lead" }] };`;
const openEditAcct = async (page, name) => {
  await page.click('button[title="Accounts"]');
  await page.getByText(name).first().click();
  await page.waitForSelector("[data-header-card]");
  await page.click("text=✎ Edit account");
  await page.waitForSelector("[data-lead-select]");
};

test("lead picker: admin sets Lead, store has leadId, header shows Lead meta", async () => {
  const { page, browser } = await launch(seedLead([seedAccount({ id: "a1", name: "Acme", csm: "Ravi" })], "admin"));
  try {
    await openEditAcct(page, "Acme");
    const opts = await page.locator("[data-lead-select] option").allTextContents();
    assert(opts.join("|") === "|Lena Lead", "lead options: " + opts.join("|"));
    await page.selectOption("[data-lead-select]", "u3");
    await page.click("text=Save changes");
    const a = await page.evaluate(() => window.__store.getState().accounts.find(x => x.id === "a1"));
    assert(a.leadId === "u3", "leadId: " + a.leadId);
    assert(/Lena Lead/.test(await page.textContent("[data-lead-meta]")), "lead meta missing");
  } finally { await browser.close(); }
});

test("lead picker: admin edit without touching Lead sends no leadId", async () => {
  const { page, browser } = await launch(seedLead([seedAccount({ id: "a1", name: "Acme", csm: "Ravi" })], "admin"));
  try {
    await openEditAcct(page, "Acme");
    await page.fill('label:has-text("ARR") input', "777");
    await page.click("text=Save changes");
    const a = await page.evaluate(() => window.__store.getState().accounts.find(x => x.id === "a1"));
    assert(a.arr === 777 && !("leadId" in a), "unexpected leadId key: " + JSON.stringify(a.leadId));
  } finally { await browser.close(); }
});

test("lead picker: non-admin sees it disabled with a lock note", async () => {
  const { page, browser } = await launch(seedLead([seedAccount({ id: "a1", name: "Acme", csm: "Ravi" })], "user"));
  try {
    await openEditAcct(page, "Acme");
    assert(await page.locator("[data-lead-select]").isDisabled(), "lead select editable for a non-admin");
    assert(/Only admins can change this/.test(await page.textContent("[data-lead-lock]")), "lock note missing");
  } finally { await browser.close(); }
});

test("signed-in lead: no New account, no Import CSV, no My book toggle", async () => {
  const { page, browser } = await launch(seedLead([seedAccount({ id: "a1", name: "Acme", csm: "Ravi" })], "lead"));
  try {
    await page.click('button[title="Accounts"]');
    await page.getByText("Acme").first().waitFor({ timeout: 10000 });
    const txt = await page.textContent("#root");
    assert(!/\+ New account/.test(txt), "New account shown to a lead");
    assert(!/Import CSV/.test(txt), "Import CSV shown to a lead");
    assert(await page.locator("[data-scope-toggle]").count() === 0, "scope toggle shown to a lead");
  } finally { await browser.close(); }
});
