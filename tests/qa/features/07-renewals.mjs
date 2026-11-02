import assert from "node:assert/strict";
import { waitForSaved } from "../reset.mjs";
import { SkipScenario } from "../core.mjs";
import { openAccount, stat, field, fmtDateIn, fmtMoneyIn, isoPlus } from "./_accounts.mjs";
import { nav } from "./_users-card.mjs";
import { waitForRunAccounts, runAccounts, fixtureRow } from "./_store.mjs";

const F = "07-renewals";

// Renewals board (src/23-renewals.jsx): 12 month lanes [data-col-month] (the leading Past due lane
// [data-col-past-due] is not one of them); lane label in its h2, cards [data-renewal-card] carry the
// name [data-renewal-name] and a days pill [data-days-chip] "Nd" / "Nd overdue".
const board = page => page.evaluate(() => [...document.querySelectorAll("[data-col-month]")].map(col => ({
  month: col.querySelector("h2")?.textContent.trim(),
  cards: [...col.querySelectorAll("[data-renewal-card]")].map(c => {
    const d = c.querySelector("[data-days-chip]").textContent.trim();
    return { name: c.querySelector("[data-renewal-name]").textContent.trim(), days: /overdue/.test(d) ? -parseInt(d) : parseInt(d) };
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
  await page.locator("[data-scope-toggle] button").filter({ hasText: /^Whole team$/ }).click();
  return (await page.locator('[data-stat="Total ARR (USD)"] [data-stat-value]').textContent()).trim();
};

// Reactivate through the UI ("show churned" toggle, then the detail page's ↻ Reactivate) when
// the account is churned in the app's state; a no-op otherwise.
async function reactivateIfChurned(page, name) {
  const churned = await page.evaluate(n => !!window.__store.getState().accounts.find(a => a.name === n)?.churn, name);
  if (!churned) return;
  await nav(page, "Accounts").click();
  await page.getByLabel(/^show churned/).check(); // churned rows are hidden by default (src/20-account-list.jsx:259)
  await page.getByPlaceholder(/^Search/).fill(name);
  await page.locator("tr[data-account-row]").filter({ hasText: name }).first().click({ timeout: 15000 }); // name cell also holds a "churned" badge
  await page.getByRole("button", { name: "↻ Reactivate" }).click();
  await waitForSaved(page);
}

const openRenewals = async page => {
  await nav(page, "Renewals").click();
  await page.locator("[data-renewals-subtitle]").waitFor({ timeout: 15000 });
};
const forecastDue = page => page.locator('[data-forecast="due"] [data-forecast-value]').textContent();
const WIN_RANGE = { "0-30": [0, 30], "31-60": [31, 60], "61-90": [61, 90], "90+": [91, Infinity] };
// Edit an account's renewal date through the account form (same path as change-date).
async function setRenewalDate(page, name, isoDate) {
  await openAccount(page, name);
  await page.getByRole("button", { name: "✎ Edit account" }).click();
  await field(page, "Renewal date").fill(isoDate);
  await page.getByRole("button", { name: "Save changes" }).click();
  await waitForSaved(page);
}

export const scenarios = [
  // Stage 6 window cards: each card with accounts filters the board to that window; a second click
  // restores it; the 90-day forecast never moves. Days come from each card's [data-days-chip]
  // (daysUntil, time-of-day based) while windows use the local calendar day, so the check allows
  // one day of slack at each edge.
  { id: `${F}/window-filter`, feature: F, title: "Window cards filter the board to their window and toggle off; forecast unchanged", role: "admin",
    run: async ({ page, runId }) => {
      await nav(page, "Accounts").waitFor({ timeout: 20000 });
      await waitForRunAccounts(page, runId);
      await openRenewals(page);
      await page.locator('[data-renewals-view="board"]').click();
      await page.locator("[data-col-month]").first().waitFor({ timeout: 15000 });
      const due0 = await forecastDue(page);
      const all = (await board(page)).flatMap(c => c.cards).length;
      let tried = 0;
      for (const key of Object.keys(WIN_RANGE)) {
        const card = page.locator(`[data-renewal-window="${key}"]`);
        const count = parseInt(await card.locator("[data-window-sub]").textContent());
        if (!count) continue;
        tried++;
        await card.click();
        await page.locator(`[data-renewal-window="${key}"][aria-pressed="true"]`).waitFor();
        const shown = (await board(page)).flatMap(c => c.cards);
        const past = await page.locator("[data-col-past-due] [data-renewal-card]").count();
        assert.equal(past, 0, `${key}: Past due cards shown under a window filter`);
        const [lo, hi] = WIN_RANGE[key];
        for (const c of shown) assert.ok(c.days >= lo - 1 && c.days <= hi + 1, `${key}: ${c.name} (${c.days}d) outside the window`);
        assert.equal(await forecastDue(page), due0, `${key}: forecast moved with the window`);
        await card.click();
        await page.locator(`[data-renewal-window="${key}"][aria-pressed="false"]`).waitFor();
        assert.equal((await board(page)).flatMap(c => c.cards).length, all, `${key}: second click did not restore the board`);
      }
      assert.ok(tried > 0, "no window card had accounts (run fixture has renewals 10-120 days out)");
      assert.equal(await forecastDue(page), due0, "forecast moved");
    } },

  // Stage 6 Table view: every run account is a row in date order with ARR, health word and stage; a
  // stage change in the table persists across reload; the original stage is restored.
  { id: `${F}/table-view`, feature: F, title: "Table view lists run accounts in date order; a table stage change persists", role: "admin",
    run: async ({ page, runId }) => {
      await nav(page, "Accounts").waitFor({ timeout: 20000 });
      await waitForRunAccounts(page, runId);
      const horizon = isoPlus(365);
      const expected = (await runAccounts(page, runId)).filter(a => !a.churn && a.renewalDate && a.renewalDate <= horizon)
        .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate) || a.name.localeCompare(b.name));
      await openRenewals(page);
      await page.locator('[data-renewals-view="table"]').click();
      await page.locator("[data-renewals-table]").waitFor({ timeout: 15000 });
      const rows = await page.evaluate(p => [...document.querySelectorAll("[data-renewal-row]")].map(r => ({
        id: r.dataset.renewalRow, name: r.querySelector(".rn-tname")?.textContent.trim(), arr: r.children[1]?.textContent.trim(),
        health: r.querySelector("[data-renewal-health]")?.textContent.trim(), stage: r.querySelector("select")?.value })).filter(r => r.name?.startsWith(p)), `QA ${runId} `);
      assert.deepEqual(rows.map(r => r.name), expected.map(a => a.name), "run accounts in table, date order");
      for (const r of rows) {
        const a = expected.find(e => e.name === r.name);
        assert.equal(r.arr, await fmtMoneyIn(page, a.arr, a.currency), `${r.name}: ARR cell`);
        assert.match(r.health || "", /^\d+ · (Healthy|Watch|At risk)$/, `${r.name}: health pill`);
        assert.ok(r.stage, `${r.name}: stage select`);
      }
      const target = rows[0];
      const orig = target.stage, next = orig === "Outreach" ? "Quote sent" : "Outreach";
      const sel = () => page.locator(`[data-renewal-row="${target.id}"] select`);
      try {
        await sel().selectOption(next);
        await waitForSaved(page);
        await page.reload();
        await nav(page, "Renewals").waitFor({ timeout: 20000 });
        await openRenewals(page);
        await page.locator(`[data-renewal-row="${target.id}"]`).waitFor({ timeout: 15000 }); // view remembered as Table
        assert.equal(await sel().inputValue(), next, "stage after reload");
      } finally {
        await openRenewals(page);
        await page.locator('[data-renewals-view="table"]').click();
        if ((await sel().inputValue()) !== orig) { await sel().selectOption(orig); await waitForSaved(page); }
        await page.locator('[data-renewals-view="board"]').click(); // leave the default view for later scenarios
      }
    } },

  // Owner addition: an account whose renewal date has passed (before this month) appears in the
  // leading Past due lane with an "Nd overdue" pill, and in no month lane. Date restored after.
  { id: `${F}/past-due-lane`, feature: F, title: "A past-due renewal appears in the Past due lane with Nd overdue", role: "admin",
    run: async ({ page, runId }) => {
      const name = `QA ${runId} Delta Logistics`;
      await nav(page, "Accounts").waitFor({ timeout: 20000 });
      await waitForRunAccounts(page, runId);
      const orig = (await runAccounts(page, runId)).find(a => a.name === name);
      if (!orig || orig.churn) throw new SkipScenario(`${name} missing or churned`);
      const past = isoPlus(-45); // always before the current month
      try {
        await setRenewalDate(page, name, past);
        await openRenewals(page);
        await page.locator('[data-renewals-view="board"]').click();
        const lane = page.locator("[data-col-past-due]");
        await lane.waitFor({ timeout: 15000 });
        assert.equal((await lane.locator("h2").textContent()).trim(), "Past due", "lane heading");
        const card = lane.locator("[data-renewal-card]").filter({ has: page.getByText(name, { exact: true }) });
        await card.waitFor({ timeout: 15000 });
        const chip = (await card.locator("[data-days-chip]").textContent()).trim();
        assert.match(chip, /^\d+d overdue$/, "days pill");
        const n = parseInt(chip);
        assert.ok(n >= 44 && n <= 46, `overdue days ${n} (renewal 45 days ago)`);
        const inMonths = (await board(page)).some(c => c.cards.some(x => x.name === name));
        assert.ok(!inMonths, "past-due account also shown in a month lane");
        const first = await page.evaluate(() => document.querySelector("[data-board] [data-col-past-due], [data-board] [data-col-month]")?.hasAttribute("data-col-past-due"));
        assert.ok(first, "Past due is not the leading lane");
      } finally {
        await setRenewalDate(page, name, orig.renewalDate);
      }
    } },

  { id: `${F}/upcoming`, feature: F, title: "Renewals board lists this run's accounts by month, in date order", role: "admin",
    run: async ({ page, runId }) => {
      await nav(page, "Accounts").waitFor({ timeout: 20000 });
      await waitForRunAccounts(page, runId);
      const expected = (await runAccounts(page, runId)).filter(a => !a.churn);
      await nav(page, "Renewals").click();
      await page.locator("[data-col-month]").first().waitFor({ timeout: 15000 });
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
      const before = await exactTotalUSD(page);
      // fmtMoney's step at this total ($X.XXM -> 10K, $NK -> 1K): the churned ARR must be at least
      // one step, or the rounded display could legitimately stay the same.
      const step = Math.round(before / 1e3) >= 1000 ? 1e4 : 1e3;
      const pickName = ["Kestrel Media", "Lumen Energy", "Juniper Cloud", "Maple Health"]
        .find(c => fixtureRow(c).arr >= step && accts.some(a => a.name === `QA ${runId} ${c}` && !a.churn));
      if (!pickName) throw new SkipScenario(`no unchurned USD run account with ARR >= the $${step} display step`);
      const fx = fixtureRow(pickName), name = `QA ${runId} ${pickName}`;
      assert.equal(fx.currency, "USD");
      assert.equal(accts.find(a => a.name === name).arr, fx.arr, `${name}: stored ARR differs from the fixture`);

      const shownBefore = await dashTotal(page);
      assert.equal(shownBefore, await fmtMoneyIn(page, before, "USD"), "dashboard Total ARR before");
      let primaryFailed = true;
      try {
        await openAccount(page, name);
        await page.locator("[data-more-actions]").click();
        await page.getByRole("menuitem", { name: "✖ Mark churned" }).click();
        await page.getByRole("button", { name: /^Confirm churn/ }).click();
        await waitForSaved(page);
        const after = await exactTotalUSD(page);
        assert.equal(before - after, fx.arr, `exact ARR delta should be ${fx.arr} USD`);
        const shownAfter = await dashTotal(page);
        assert.equal(shownAfter, await fmtMoneyIn(page, before - fx.arr, "USD"), "dashboard Total ARR after churn");
        assert.notEqual(shownAfter, shownBefore, "dashboard Total ARR did not change");
        primaryFailed = false;
      } finally {
        // Reactivate only if it is actually churned. Never silent: a cleanup failure fails a
        // passing scenario, and is warned (not thrown, so it can't mask the original) otherwise.
        await reactivateIfChurned(page, name).catch(e => {
          const msg = `cleanup failed: ${name} left churned (${e?.message || e})`;
          if (!primaryFailed) throw new Error(msg);
          console.warn(msg);
        });
      }
    } },
];
