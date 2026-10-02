import { test, assert } from "./framework.mjs";
import { launch, rootText } from "./harness.mjs";

const empty = `window.__seedRows = { accounts: [], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("a user of a disabled client sees the suspended screen, not the app", async () => {
  const { page, browser } = await launch(`${empty}
    window.__seedRows.orgs = [{ id: "org-a", name: "Acme Corp", disabled: true }];
    window.__seedProfile = { id: "u1", name: "Csm", role: "user", org_id: "org-a", platform_admin: false };`);
  await page.waitForSelector("[data-org-suspended]", { timeout: 15000 });
  const txt = await rootText(page);
  assert(txt.includes("Your organisation's access is suspended."), "suspended heading missing");
  assert(txt.includes("Contact your provider to restore it."), "suspended sub-line missing");
  assert(!/Dashboard/.test(txt), "the app rendered for a disabled client's user");
  await browser.close();
});

test("a user of an enabled client gets the app (control for the suspended test)", async () => {
  const { page, browser } = await launch(`${empty}
    window.__seedRows.orgs = [{ id: "org-a", name: "Acme Corp", disabled: false }];
    window.__seedProfile = { id: "u1", name: "Csm", role: "user", org_id: "org-a", platform_admin: false };`);
  await page.waitForSelector("aside >> text=Csm", { timeout: 15000 });
  assert(!(await page.$("[data-org-suspended]")), "suspended screen shown for an enabled client");
  await browser.close();
});
