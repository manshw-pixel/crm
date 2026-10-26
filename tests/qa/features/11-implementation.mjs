import assert from "node:assert/strict";
import { openUsersCard, nav, MAIN } from "./_users-card.mjs";
import { openAccount, searchCount } from "./_accounts.mjs";
import { EXPECTED } from "../fixtures/expected.mjs";
import { SkipScenario } from "../core.mjs";

const F = "11-implementation";

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

  // Needs a QA user already set to impl_user by the org admin; this scenario never creates users or changes roles.
  { id: `${F}/impl-read-only`, feature: F, title: "Impl user sees only Implementation + Accounts, and accounts are read-only", role: "impl",
    run: async ({ page, runId, env }) => {
      if (!env?.users?.impl) throw new SkipScenario("no impl user configured");
      await page.locator(MAIN).waitFor({ timeout: 15000 });
      const labels = await page.locator(`${MAIN} button[aria-label]`).evaluateAll(bs => bs.map(b => b.getAttribute("aria-label")));
      assert.deepEqual([...labels].sort(), ["Accounts", "Implementation"], `sidebar shows ${labels.join(", ")}`);
      const name = `QA ${runId} ${EXPECTED.adminOwned}`;
      assert.equal(await searchCount(page, name), 1, "fixture account not listed for the impl user");
      assert.equal(await page.getByRole("button", { name: "+ New account" }).count(), 0, "impl user sees + New account");
      await openAccount(page, name);
      await page.getByRole("heading", { level: 2, name, exact: true }).waitFor({ timeout: 15000 });
      for (const label of ["✎ Edit account", "+ Log activity"])
        assert.equal(await page.getByRole("button", { name: label }).count(), 0, `impl user sees "${label}"`);
      // Per-row buttons can only be proven absent where rows exist: the section title carries the row count.
      const sections = [["Open tasks", "Edit task"], ["Contacts", "Edit contact"], ["Contacts", "Delete contact"], ["Activity timeline", "Edit activity"]];
      const empty = new Set();
      for (const [title, label] of sections) {
        const t = await page.getByText(new RegExp(String.raw`^${title} \(\d+\)$`)).first().textContent();
        if (+/\d+/.exec(t)[0] === 0) { empty.add(title); continue; }
        assert.equal(await page.getByRole("button", { name: label }).count(), 0, `impl user sees "${label}"`);
      }
      assert.equal(await page.locator("[data-more-actions]").count(), 0, "impl user sees the more-actions menu");
      if (empty.size) throw new SkipScenario(`fixture account has no rows in: ${[...empty].join(", ")} -- their edit buttons were not proven absent (other checks passed)`);
    } },
];
