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
