import assert from "node:assert/strict";
import { openUsersCard, nav, MAIN } from "./_users-card.mjs";
import { EXPECTED } from "../fixtures/expected.mjs";

const F = "02-users";
const OK = ".bg-emerald-50.text-emerald-700", ERR = "div.bg-rose-50.text-rose-600"; // UsersCard :467-468

// Accounts list, search for this run's rows, return the visible names (default scope unless `scope`).
async function runRowNames(page, runId, scope) {
  await nav(page, "Accounts").click();
  if (scope) await page.locator("[data-scope-toggle]").getByRole("button", { name: scope }).click();
  await page.getByPlaceholder(/^Search/).fill(`QA ${runId} `);
  const rows = page.locator("tr[data-account-row]");
  await rows.first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  return rows.evaluateAll(trs => trs.map(tr => tr.children[2]?.textContent.trim()));
}

export const scenarios = [
  // USER DECISION: this scenario must NEVER create a real user. It submits only when the submit
  // is provably rejected: client-side validation, or the org already full by its own user list.
  { id: `${F}/add-user-form`, feature: F, title: "Add user validates input and enforces the plan's user limit", role: "admin",
    run: async ({ page, runId }) => {
      // Backstop: no sign-up request may leave this page, whatever the app decides.
      await page.route("**/auth/v1/signup**", r => r.abort());
      await openUsersCard(page);
      const form = page.locator("form").filter({ has: page.getByPlaceholder("Temp password") });
      const err = page.locator(ERR);
      const email = `qa-${runId}@example.invalid`;
      const submit = () => form.getByRole("button", { name: "Add user" }).click();

      // 1. Missing name (src/25-auth-admin.jsx:420).
      await form.getByPlaceholder("Email").fill(email);
      await form.getByPlaceholder("Temp password").fill("abcdefgh");
      await submit();
      await err.filter({ hasText: "Name and email are required." }).waitFor({ timeout: 10000 });
      // 2. Short password (:421).
      await form.getByPlaceholder("Name").fill(`QA ${runId} Limit`);
      await form.getByPlaceholder("Temp password").fill("abc");
      await submit();
      await err.filter({ hasText: "Temporary password must be at least 6 characters." }).waitFor({ timeout: 10000 });

      // 3. The plan limit, only if the org is provably full. Enabled rows in the admin's list are a
      // LOWER bound on seats (open invites also count; the platform admin is excluded from both).
      const enabled = await page.locator("div[data-user-id]:not(:has([data-user-disabled-badge]))").count();
      const lim = await page.evaluate(async () => {
        const { data, error } = await sb.from("orgs").select("max_users");
        return error || !data || data.length !== 1 ? null : data[0].max_users;
      });
      if (lim == null || enabled < lim) {
        console.log(`  note: limit message not exercised: org has free seats (enabled ${enabled}, limit ${lim ?? "unlimited/unknown"})`);
        return;
      }
      await form.getByPlaceholder("Temp password").fill("abcdefgh");
      await submit();
      await err.or(page.locator(OK)).first().waitFor({ timeout: 30000 });
      if (await page.locator(OK).count()) throw new Error(`org looked full (${enabled}/${lim}) but add user was accepted: an invite for ${email} may now exist`);
      await err.filter({ hasText: `Your plan allows ${lim} users` }).waitFor({ timeout: 5000 });
    } },

  // CSMs can read every account in their org by RLS; the app narrows them to "My book" by
  // default (src/26-app.jsx:343-344). Fixture: one run row (EXPECTED.adminOwned) is the admin's.
  { id: `${F}/role-csm-sees-own`, feature: F, title: "CSM's default book hides the admin's account; All shows it", role: "csm",
    run: async ({ page, runId }) => {
      await page.locator(MAIN).waitFor({ timeout: 15000 });
      assert.equal(await nav(page, "Settings").count(), 0, "CSM sees the Settings nav");
      const adminRow = `QA ${runId} ${EXPECTED.adminOwned}`;
      const mine = await runRowNames(page, runId);
      assert.equal(mine.length, EXPECTED.countByOwner.csm, `CSM's book shows ${mine.length} run rows`);
      assert.ok(!mine.includes(adminRow), "CSM's default book shows the admin-owned account");
      const all = await runRowNames(page, runId, "All");
      assert.ok(all.includes(adminRow), "admin-owned account missing from the CSM's All view");
    } },

  { id: `${F}/admin-sees-admin-row`, feature: F, title: "Admin sees the admin-owned run account", role: "admin",
    run: async ({ page, runId }) => {
      const names = await runRowNames(page, runId);
      assert.equal(names.length, EXPECTED.accounts, `admin sees ${names.length} run rows`);
      assert.ok(names.includes(`QA ${runId} ${EXPECTED.adminOwned}`), "admin-owned account missing for the admin");
    } },

  { id: `${F}/role-lead-restricted`, feature: F, title: "Lead has no Settings nav and no scope toggle", role: "lead",
    // src/26-app.jsx:134 hides Settings for every non-admin and :443 hides the scope toggle for Lead.
    // Finance is in EVERY role's nav (:134 concat), so it is not asserted absent.
    run: async ({ page }) => {
      await page.locator(MAIN).waitFor({ timeout: 15000 });
      assert.equal(await nav(page, "Settings").count(), 0, "Lead sees the Settings nav");
      await nav(page, "Accounts").click();
      // The toggle's parent is the header row holding the "Accounts" h1 and the sync status.
      const header = page.locator("div:has(> h1)").filter({ has: page.getByRole("heading", { name: "Accounts", exact: true }) });
      await header.first().waitFor({ timeout: 15000 });
      assert.equal(await header.first().locator("[data-scope-toggle]").count(), 0, "Lead sees the scope toggle");
      assert.equal(await page.locator("[data-scope-toggle]").count(), 0, "Lead sees the scope toggle");
    } },

  { id: `${F}/user-limit`, feature: F, title: "Org user limit blocks add-user", role: "admin",
    skip: "limits are set from the client console (platform admin only); the limit message is covered by add-user-form when the org is full",
    run: async () => {} },
];
