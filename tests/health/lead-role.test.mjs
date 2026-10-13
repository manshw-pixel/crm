import { test, assert } from "./framework.mjs";
import { launchFinance, gotoSettings } from "./harness.mjs";

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
