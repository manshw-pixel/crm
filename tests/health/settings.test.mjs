import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("Settings shows Health playbook editor with Yellow & Red sections", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForSelector("#root");
  // navigate to Settings view
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForFunction(() => document.querySelector("#root")?.textContent.includes("Health playbook"));
  const txt = await rootText(page);
  assert(/Health playbook/.test(txt), "Health playbook card missing");
  assert(/Yellow/.test(txt) && /Red/.test(txt), "band sections missing");
  await browser.close();
});

test("Users card shows each user's email and a disable control", async () => {
  const { page, browser } = await launch(
    `window.__seedUsers = [
       { id: "u1", name: "Test User", role: "admin", disabled: false, email: "admin@test.dev" },
       { id: "u2", name: "Priya", role: "user", disabled: false, email: "priya@test.dev" }
     ];`);
  await page.click('text=Settings');
  const txt = await rootText(page);
  assert(/priya@test\.dev/.test(txt), "user email should be listed");
  // Scoped to the per-row control itself, not the static footer copy (which also
  // contains the word "disable") -- deleting the button must fail this assertion.
  await page.waitForSelector("[data-user-disable-btn]", { timeout: 10000 });
  const disableBtnCount = await page.evaluate(() => document.querySelectorAll("[data-user-disable-btn]").length);
  assert(disableBtnCount > 0, "disable control missing");
  await browser.close();
});

test("a disabled user is marked as such and offers re-enable", async () => {
  const { page, browser } = await launch(
    `window.__seedUsers = [
       { id: "u1", name: "Test User", role: "admin", disabled: false, email: "admin@test.dev" },
       { id: "u2", name: "Priya", role: "user", disabled: true, email: "priya@test.dev" }
     ];`);
  await page.click('text=Settings');
  await page.waitForSelector("[data-user-disabled-badge]", { timeout: 10000 });
  const badgeText = await page.evaluate(() => document.querySelector("[data-user-disabled-badge]")?.textContent || "");
  assert(/disabled/i.test(badgeText), "disabled badge missing");
  const enableBtnCount = await page.evaluate(() => document.querySelectorAll("[data-user-enable-btn]").length);
  assert(enableBtnCount > 0, "re-enable control missing");
  await browser.close();
});
