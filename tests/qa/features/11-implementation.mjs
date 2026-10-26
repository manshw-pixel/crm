import assert from "node:assert/strict";
import { openUsersCard, nav, MAIN } from "./_users-card.mjs";
import { openAccount, searchCount } from "./_accounts.mjs";
import { EXPECTED } from "../fixtures/expected.mjs";
import { SkipScenario } from "../core.mjs";
import { waitForSaved } from "../reset.mjs";

const F = "11-implementation";
// Rows seeded (as admin, through the UI) on the fixture account for the impl scenario to look at.
const seeded = thisRunId => ({ contact: `QA ${thisRunId} Impl Contact`, task: `QA ${thisRunId} impl task`, activity: `QA ${thisRunId} impl call` });

export const scenarios = [
  // Read-only: inspects the role dropdown options of an existing user row; nothing is changed or saved.
  { id: `${F}/team-offers-impl-roles`, feature: F, title: "Team role select offers impl_lead and impl_user", role: "admin",
    run: async ({ page }) => {
      await openUsersCard(page);
      const select = page.locator("select[data-role-select]").first();
      await select.waitFor({ timeout: 15000 });
      const options = await select.locator("option").evaluateAll(os => os.map(o => o.value));
      for (const r of ["impl_lead", "impl_user"]) assert.ok(options.includes(r), `role select lacks ${r} (has ${options.join(", ")})`);
    } },

  // Seeds one contact, task and activity on the fixture account. Scenarios in a run execute in file order,
  // so this runs before impl-read-only; it is a no-op for rows that already exist (retry-safe).
  { id: `${F}/seed-impl-rows`, feature: F, title: "Seed a contact, task and activity on the fixture account for the impl check", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      const name = `QA ${runId} ${EXPECTED.adminOwned}`, rows = seeded(thisRunId);
      await openAccount(page, name);
      const has = t => page.getByText(t, { exact: true }).count();
      if (!await has(rows.contact)) {
        await page.locator("[data-more-actions]").click();
        await page.getByRole("menuitem", { name: "+ Contact" }).click();
        const form = page.locator("[data-contact-form]");
        await form.getByPlaceholder("Name *").fill(rows.contact);
        await form.getByRole("button", { name: "Add", exact: true }).click();
        await waitForSaved(page);
      }
      if (!await has(rows.task)) {
        await page.getByRole("button", { name: "+ Add task" }).click();
        const form = page.locator("form").filter({ has: page.getByPlaceholder("Task title…") });
        await form.getByPlaceholder("Task title…").fill(rows.task);
        await form.getByRole("button", { name: "Add", exact: true }).click();
        await waitForSaved(page);
      }
      if (!await has(rows.activity)) {
        await page.getByRole("button", { name: "+ Log activity" }).click();
        await page.getByPlaceholder("Summary…").fill(rows.activity);
        await page.getByRole("button", { name: "Log", exact: true }).click();
        await waitForSaved(page);
      }
      for (const t of Object.values(rows)) await page.getByText(t, { exact: true }).first().waitFor({ timeout: 10000 });
    } },

  // Needs a QA user already set to impl_user by the org admin; this scenario never creates users or changes roles.
  { id: `${F}/impl-read-only`, feature: F, title: "Impl user sees only Implementation + Accounts, and accounts are read-only", role: "impl",
    run: async ({ page, runId, thisRunId, env }) => {
      if (!env?.users?.impl) throw new SkipScenario("no impl user configured");
      await page.locator(MAIN).waitFor({ timeout: 15000 });
      const labels = await page.locator(`${MAIN} button[aria-label]`).evaluateAll(bs => bs.map(b => b.getAttribute("aria-label")));
      assert.deepEqual([...labels].sort(), ["Accounts", "Implementation"], `sidebar shows ${labels.join(", ")}`);
      const name = `QA ${runId} ${EXPECTED.adminOwned}`, rows = seeded(thisRunId);
      assert.equal(await searchCount(page, name), 1, "fixture account not listed for the impl user");
      assert.equal(await page.getByRole("button", { name: "+ New account" }).count(), 0, "impl user sees + New account");
      await openAccount(page, name);
      // Each section must show the seeded row (so absence below is not vacuous).
      for (const [kind, text] of Object.entries(rows))
        await page.getByText(text, { exact: true }).first().waitFor({ timeout: 15000 }).catch(() => { throw new Error(`seeded ${kind} "${text}" not visible to the impl user (did ${F}/seed-impl-rows run first?)`); });
      for (const label of ["✎ Edit account", "+ Log activity", "+ Add task", "Edit contact", "Delete contact", "Edit task", "Edit activity"])
        assert.equal(await page.getByRole("button", { name: label }).count(), 0, `impl user sees "${label}"`);
      assert.equal(await page.locator("[data-more-actions]").count(), 0, "impl user sees the more-actions menu");
    } },
];
