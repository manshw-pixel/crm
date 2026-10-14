import assert from "node:assert/strict";
import { waitForSaved } from "../reset.mjs";
import { SkipScenario } from "../core.mjs";
import { openAccount, stat, field, fmtDateIn, fmtMoneyIn, isoPlus } from "./_accounts.mjs";
import { nav } from "./_users-card.mjs";
import { waitForRunAccounts, runAccounts, fixtureRow } from "./_store.mjs";

const F = "07-renewals";

// Renewals board (src/23-renewals.jsx): 12 month columns [data-col]; each card's first div holds
// the name (text node) + HealthChip, and a DaysChip [data-days-chip] "Nd" / "Nd overdue".
const board = page => page.evaluate(() => [...document.querySelectorAll("[data-col]")].map(col => ({
  month: col.querySelector(":scope > div span")?.textContent.trim(),
  cards: [...col.querySelectorAll(":scope > div.nm-sm")].map(c => {
    const d = c.querySelector("[data-days-chip]").textContent.trim();
    return { name: c.firstElementChild.firstChild.textContent.trim(), days: /overdue/.test(d) ? -parseInt(d) : parseInt(d) };
  }),
})));

// Exact Total ARR (USD) the dashboard formats: sum of toUSD over live accounts (src/16-dashboard.jsx:5,
// scored = active, src/26-app.jsx:345, admin scope "all"). Uses the app's own toUSD and rates.
const exactTotalUSD = page => page.evaluate(() => {
  const st = window.__store.getState(), H = window.__health;
  return st.accounts.filter(a => !a.churn).reduce((s, a) => s + H.toUSD(a.arr, a.currency, st.settings.rates), 0);
});
const dashTotal = async page => {
  await nav(page, "Dashboard").click();
  await page.locator("[data-scope-toggle] button").filter({ hasText: /^All$/ }).click();
  return (await page.locator('[data-stat="Total ARR (USD)"] [data-stat-value]').textContent()).trim();
};

export const scenarios = [
  { id: `${F}/upcoming`, feature: F, title: "Renewals board lists this run's accounts by month, in date order", role: "admin",
    run: async ({ page, runId }) => {
      await nav(page, "Accounts").waitFor({ timeout: 20000 });
      await waitForRunAccounts(page, runId);
      const expected = (await runAccounts(page, runId)).filter(a => !a.churn);
      await nav(page, "Renewals").click();
      await page.locator("[data-col]").first().waitFor({ timeout: 15000 });
      const cols = await board(page);
      assert.equal(cols.length, 12, "month columns");
      const months = cols.map(c => new Date(`1 ${c.month}`).getTime());
      for (let i = 1; i < months.length; i++) assert.ok(months[i] > months[i - 1], `columns out of order: ${cols[i - 1].month} then ${cols[i].month}`);
      const seen = [];
      for (const c of cols) for (const card of c.cards) if (card.name.startsWith(`QA ${runId} `)) seen.push({ ...card, month: c.month });
      assert.deepEqual(seen.map(s => s.name).sort(), expected.map(a => a.name).sort(), "run accounts on the board");
      for (const s of seen) {
        const a = expected.find(e => e.name === s.name);
        const d = new Date(a.renewalDate + "T00:00:00");
        assert.equal(s.month, d.toLocaleDateString("en-US", { month: "short", year: "numeric" }), `${s.name} in the wrong month column`);
      }
      for (let i = 1; i < seen.length; i++)
        assert.ok(seen[i].days >= seen[i - 1].days, `not in date order: ${seen[i - 1].name} (${seen[i - 1].days}d) before ${seen[i].name} (${seen[i].days}d)`);
    } },

  { id: `${F}/change-date`, feature: F, title: "Changing a renewal date persists across reload", role: "admin",
    run: async ({ page, runId }) => {
      const name = `QA ${runId} Granite Infra`;
      const newIso = isoPlus(130 + Math.floor(Math.random() * 100)); // never the fixture's 70
      await openAccount(page, name);
      await page.getByRole("button", { name: "✎ Edit account" }).click();
      await field(page, "Renewal date").fill(newIso);
      await page.getByRole("button", { name: "Save changes" }).click();
      await waitForSaved(page);
      await page.reload();
      await nav(page, "Accounts").waitFor({ timeout: 20000 });
      await openAccount(page, name);
      assert.equal((await stat(page, "Renewal").textContent()).trim(), await fmtDateIn(page, newIso), "renewal date after reload");
    } },

  // Dashboard ARR is USD-only and rounded by fmtMoney ($X.XXM, i.e. $10K steps), and no
  // unrounded figure is shown anywhere. So: churn a USD run account (ARR from the fixture),
  // assert the app's exact total fell by exactly that ARR, and that the dashboard shows
  // fmtMoney(before) then fmtMoney(before - ARR) -- a rounded delta consistent with fmtMoney.
  { id: `${F}/churn-reduces-arr`, feature: F, title: "Churning a run account drops dashboard ARR by exactly its ARR", role: "admin",
    run: async ({ page, runId }) => {
      await nav(page, "Accounts").waitFor({ timeout: 20000 });
      await waitForRunAccounts(page, runId);
      const accts = await runAccounts(page, runId);
      const pickName = ["Juniper Cloud", "Lumen Energy", "Kestrel Media"].find(c => accts.some(a => a.name === `QA ${runId} ${c}` && !a.churn));
      if (!pickName) throw new SkipScenario("every USD run account is already churned");
      const fx = fixtureRow(pickName), name = `QA ${runId} ${pickName}`;
      assert.equal(fx.currency, "USD");
      assert.equal(accts.find(a => a.name === name).arr, fx.arr, `${name}: stored ARR differs from the fixture`);

      const before = await exactTotalUSD(page);
      const shownBefore = await dashTotal(page);
      assert.equal(shownBefore, await fmtMoneyIn(page, before, "USD"), "dashboard Total ARR before");

      await openAccount(page, name);
      await page.locator("[data-more-actions]").click();
      await page.getByRole("menuitem", { name: "✖ Mark churned" }).click();
      await page.getByRole("button", { name: /^Confirm churn/ }).click();
      await waitForSaved(page);
      try {
        const after = await exactTotalUSD(page);
        assert.equal(before - after, fx.arr, `exact ARR delta should be ${fx.arr} USD`);
        const shownAfter = await dashTotal(page);
        assert.equal(shownAfter, await fmtMoneyIn(page, before - fx.arr, "USD"), "dashboard Total ARR after churn");
        assert.notEqual(shownAfter, shownBefore, "dashboard Total ARR did not change");
      } finally {
        // Reactivate: reset's stale-account sweep only sees the list's default (non-churned)
        // rows (reset.mjs, src/20-account-list.jsx:126), so a churned run account would never
        // be deleted by a later reset.
        await nav(page, "Accounts").click();
        await page.getByLabel(/^show churned/).check(); // churned rows are hidden by default (:260)
        await page.getByPlaceholder(/^Search/).fill(name);
        await page.locator("tr[data-account-row]").filter({ hasText: name }).first().click({ timeout: 15000 }); // name cell also holds a "churned" badge
        await page.getByRole("button", { name: "↻ Reactivate" }).click();
        await waitForSaved(page);
      }
    } },
];
