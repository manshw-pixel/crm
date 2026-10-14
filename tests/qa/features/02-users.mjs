import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openUsersCard, nav } from "./_users-card.mjs";

const F = "02-users";
const MAIN = 'nav[aria-label="Main"]';

export const scenarios = [
  { id: `${F}/add-user-form`, feature: F, title: "Admin adds a CSM; the sign-up message names them", role: "admin",
    run: async ({ page, runId }) => {
      const name = `QA ${runId} User`;
      const email = `manshw+qa-${runId}@gmail.com`;
      const pass = randomBytes(12).toString("base64url"); // throwaway; never logged
      await openUsersCard(page);
      const form = page.locator("form").filter({ has: page.getByPlaceholder("Temp password") });
      await form.getByPlaceholder("Name").fill(name);
      await form.getByPlaceholder("Email").fill(email);
      await form.getByPlaceholder("Temp password").fill(pass);
      await form.locator("select").selectOption("user"); // "user" is the CSM role
      await form.getByRole("button", { name: "Add user" }).click();
      // signUpMessage (src/25-auth-admin.jsx:114-117) always names the user; errors render rose (:468).
      const ok = page.locator(".bg-emerald-50.text-emerald-700").filter({ hasText: name });
      const err = page.locator("div.bg-rose-50.text-rose-600");
      await Promise.race([ok.first().waitFor({ timeout: 30000 }), err.first().waitFor({ timeout: 30000 })]);
      if (!(await ok.count())) throw new Error(`add user failed: ${await err.first().textContent()}`);
      await page.locator("div[data-user-id]").filter({ hasText: email }).first().waitFor({ timeout: 15000 });
    } },

  { id: `${F}/role-csm-sees-own`, feature: F, title: "CSM sees only own accounts and no Settings", role: "csm",
    run: async ({ page, runId, csmName }) => {
      await page.locator(MAIN).waitFor({ timeout: 15000 });
      assert.equal(await nav(page, "Settings").count(), 0, "CSM sees the Settings nav");
      await nav(page, "Accounts").click();
      await page.getByPlaceholder(/^Search/).fill(`QA ${runId} `);
      const rows = page.locator("tr[data-account-row]");
      await rows.first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(300);
      // CSM column is the 7th cell (src/20-account-list.jsx:301-315).
      const owners = await rows.evaluateAll(trs => trs.map(tr => tr.children[6]?.textContent.trim()));
      assert.ok(owners.length > 0, "no QA rows visible to the CSM");
      assert.deepEqual([...new Set(owners)], [csmName], "CSM sees accounts owned by someone else");
    } },

  { id: `${F}/role-lead-restricted`, feature: F, title: "Lead has no Settings nav and no scope toggle", role: "lead",
    // src/26-app.jsx:134 hides Settings for every non-admin and :443 hides the scope toggle for Lead.
    // Finance is in EVERY role's nav (:134 concat), so it is not asserted absent.
    run: async ({ page }) => {
      await page.locator(MAIN).waitFor({ timeout: 15000 });
      assert.equal(await nav(page, "Settings").count(), 0, "Lead sees the Settings nav");
      await nav(page, "Accounts").click();
      await page.getByPlaceholder(/^Search/).waitFor({ timeout: 15000 });
      assert.equal(await page.locator("[data-scope-toggle]").count(), 0, "Lead sees the scope toggle");
    } },

  { id: `${F}/user-limit`, feature: F, title: "Org user limit blocks add-user", role: "admin",
    skip: "limits are set from the client console (platform admin only)",
    run: async () => {} },
];
