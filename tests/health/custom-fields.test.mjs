// Custom account fields: admin defines them in Settings, they persist to settings, archive/restore keeps them.
import { launch, seedAccount, gotoSettings } from "./harness.mjs";
import { test, assert } from "./framework.mjs";

export const seedCF = (accounts, customFields = [], role = "admin") => `window.__seedRows = { accounts: ${JSON.stringify(accounts)}.map(d => ({ id: d.id, data: d })),`
  + ` contacts: [], activities: [], tasks: [], opportunities: [], team: [],`
  + ` settings: [{ id: 1, data: { customFields: ${JSON.stringify(customFields)} } }],`
  + ` profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "${role}" }] };`;
const storedFields = page => page.evaluate(() => window.__store.getState().settings.customFields || []);

test("admin adds, renames and archives/restores a custom field in Settings", async () => {
  const { page, browser } = await launch(seedCF([seedAccount({ id: "a1", name: "Acme" })]));
  try {
    await gotoSettings(page);
    await page.waitForSelector("#set-custom-fields");
    assert(await page.locator("#set-custom-fields [data-cf-builtin]").count() > 5, "built-in fields not listed");
    assert(await page.locator("[data-cf-add]").isDisabled(), "Add should be disabled with a blank label");
    await page.fill("[data-cf-new-label]", "Region");
    await page.selectOption("[data-cf-new-type]", "select");
    await page.click("[data-cf-add]");
    let f = await storedFields(page);
    assert(f.length === 1 && f[0].label === "Region" && f[0].type === "select" && /^cf_/.test(f[0].id), "field not stored: " + JSON.stringify(f));
    const id = f[0].id;
    await page.fill(`[data-cf-options="${id}"]`, "North, South");
    await page.locator(`[data-cf-options="${id}"]`).blur();
    f = await storedFields(page);
    assert(JSON.stringify(f[0].options) === '["North","South"]', "options not stored: " + JSON.stringify(f));
    await page.click(`[data-cf-archive="${id}"]`);
    f = await storedFields(page);
    assert(f[0].archived === true, "archive should flag, not remove");
    assert(await page.locator(`[data-cf-row="${id}"]`).count() === 0, "archived field still in the active list");
    await page.click("text=Archived (1)");
    await page.click(`[data-cf-restore="${id}"]`);
    f = await storedFields(page);
    assert(f[0].archived === false && f[0].id === id, "restore lost the field id");
  } finally { await browser.close(); }
});

const FIELDS = [
  { id: "cf_t", label: "Region", type: "text", archived: false },
  { id: "cf_n", label: "Seats sold", type: "number", archived: false },
  { id: "cf_d", label: "Go-live", type: "date", archived: false },
  { id: "cf_s", label: "Segment", type: "select", options: ["Gold", "Silver"], archived: false },
  { id: "cf_b", label: "Reference", type: "bool", archived: false },
  { id: "cf_x", label: "Old field", type: "text", archived: true },
];
const openEdit = async (page, name) => {
  await page.click('button[title="Accounts"]');
  await page.getByText(name).first().click();
  await page.waitForSelector("[data-header-card]");
  await page.click("text=✎ Edit account");
  await page.waitForSelector("form");
};
const custom = (page, id) => page.evaluate(i => window.__store.getState().accounts.find(a => a.id === i).custom || {}, id);

test("Edit account renders each custom field type and saves them; archived fields are hidden", async () => {
  const { page, browser } = await launch(seedCF([seedAccount({ id: "a1", name: "Acme" })], FIELDS));
  try {
    await openEdit(page, "Acme");
    assert(await page.locator('[data-custom-field="cf_x"]').count() === 0, "archived field shown in the form");
    await page.fill('[data-custom-field="cf_t"]', "  EMEA ");
    await page.fill('[data-custom-field="cf_n"]', "40");
    await page.fill('[data-custom-field="cf_d"]', "2026-12-01");
    await page.selectOption('[data-custom-field="cf_s"]', "Gold");
    await page.check('[data-custom-field="cf_b"]');
    await page.click("text=Save changes");
    const c = await custom(page, "a1");
    assert(c.cf_t === "EMEA" && c.cf_n === 40 && c.cf_d === "2026-12-01" && c.cf_s === "Gold" && c.cf_b === true, "saved: " + JSON.stringify(c));
    const details = await page.textContent("[data-custom-details]");
    assert(/Region/.test(details) && /EMEA/.test(details) && /Gold/.test(details) && /Yes/.test(details), "details row: " + details);
  } finally { await browser.close(); }
});

test("saving one custom field keeps the others, including an archived field's value", async () => {
  const acct = seedAccount({ id: "a1", name: "Acme", custom: { cf_t: "APAC", cf_n: 5, cf_x: "kept" } });
  const { page, browser } = await launch(seedCF([acct], FIELDS));
  try {
    await openEdit(page, "Acme");
    await page.fill('[data-custom-field="cf_n"]', "9");
    await page.click("text=Save changes");
    const c = await custom(page, "a1");
    assert(c.cf_t === "APAC" && c.cf_n === 9 && c.cf_x === "kept", "lost a value: " + JSON.stringify(c));
  } finally { await browser.close(); }
});

test("a dropdown value whose option was removed still shows and stays selected", async () => {
  const acct = seedAccount({ id: "a1", name: "Acme", custom: { cf_s: "Bronze" } });
  const { page, browser } = await launch(seedCF([acct], FIELDS));
  try {
    await page.click('button[title="Accounts"]');
    await page.getByText("Acme").first().click();
    await page.waitForSelector("[data-custom-details]");
    assert(/Bronze/.test(await page.textContent('[data-custom-value="cf_s"]')), "removed option not displayed");
    await page.click("text=✎ Edit account");
    assert(await page.inputValue('[data-custom-field="cf_s"]') === "Bronze", "editor dropped the removed option");
  } finally { await browser.close(); }
});

test("no custom fields: no section in the form, no details row", async () => {
  const { page, browser } = await launch(seedCF([seedAccount({ id: "a1", name: "Acme" })], []));
  try {
    await openEdit(page, "Acme");
    assert(await page.locator("[data-custom-field]").count() === 0, "inputs rendered with no fields");
    assert(await page.locator("[data-custom-details]").count() === 0, "details row rendered with no fields");
  } finally { await browser.close(); }
});
