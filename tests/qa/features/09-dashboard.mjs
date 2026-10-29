import assert from "node:assert/strict";
import { EXPECTED } from "../fixtures/expected.mjs";
import { nav } from "./_users-card.mjs";
import { waitForRunAccounts } from "./_store.mjs";
import { fmtMoney } from "../../../src/lib/money.js";
import { SkipScenario } from "../core.mjs";

const F = "09-dashboard";
const stat = (page, label) => page.locator(`[data-stat="${label}"] [data-stat-value]`);

// Dashboard on the "All" scope (the run's admin-owned row is outside the csm's book, and the
// admin's "My book" is one row), once the store holds this run's accounts.
async function openDashboard(page, runId) {
  await nav(page, "Dashboard").waitFor({ timeout: 20000 });
  await waitForRunAccounts(page, runId);
  await nav(page, "Dashboard").click();
  await page.locator("[data-scope-toggle] button", { hasText: /^Whole team$/ }).click();
  await stat(page, "Total ARR (USD)").waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
}

// Unabbreviates fmtMoney output ("$1.23M", "$450K", "$12") to dollars.
const parseMoney = s => {
  const m = /^(-?)\$([\d.]+)([KM]?)$/.exec(s.trim());
  assert.ok(m, `not a money value: "${s}"`);
  return (m[1] ? -1 : 1) * +m[2] * ({ K: 1e3, M: 1e6, "": 1 })[m[3]];
};

export const scenarios = [
  { id: `${F}/cards-render`, feature: F, title: "ARR, NRR, GRR, ARR bridge and licenses cards show numbers; no NaN/undefined", role: "admin",
    run: async ({ page, runId }) => {
      await openDashboard(page, runId);
      const bridge = page.locator("[data-arr-bridge]");
      await bridge.waitFor({ timeout: 10000 });
      const bval = async k => (await bridge.locator(`[data-bridge-row="${k}"] [data-bridge-value]`).textContent()).trim();
      for (const k of ["opening", "new", "closing"]) assert.match(await bval(k), /^[+-]?\$\d/, `bridge row ${k} has no money value`);
      assert.match((await stat(page, "Total ARR (USD)").textContent()).trim(), /^\$\d/, "Total ARR shows no number");
      // GRR/NRR are "—" by design exactly when no ARR existed 12 months ago (src/lib/retention.js:42),
      // which the bridge shows as an opening of $0. Anything else must be a percentage.
      const opening = await bval("opening");
      for (const label of ["GRR (12m)", "NRR (12m)"]) {
        const v = (await stat(page, label).textContent()).trim();
        if (opening === "$0") assert.equal(v, "—", `${label} with a $0 opening should be "—", got "${v}"`);
        else assert.match(v, /^\d+%$/, `${label} shows no percentage: "${v}" (opening ${opening})`);
      }
      // License card: either the summary line with numbers or the explicit empty state.
      const lic = page.locator("[data-license-card]");
      await lic.waitFor({ timeout: 10000 });
      const licText = await lic.innerText();
      if (await lic.locator("[data-license-summary]").count())
        assert.match(await lic.locator("[data-license-summary]").textContent(), /[\d,]+ total · [\d,]+ deployed · \d+%/);
      else assert.match(licText, /No accounts have licenses yet/);
      const body = await page.locator("main").innerText();
      assert.doesNotMatch(body, /\bNaN\b|\bundefined\b|Infinity/, "dashboard text contains NaN/undefined/Infinity");
    } },

  { id: `${F}/arr-includes-run`, feature: F, title: "Total ARR (USD) is at least this run's ARR (delta-safe lower bound)", role: "admin",
    run: async ({ page, runId }) => {
      await openDashboard(page, runId);
      // READ-ONLY exact figures with the app's own rates (the card rounds via fmtMoney).
      const s = await page.evaluate(p => {
        const st = window.__store.getState(), r = st.settings.rates || {};
        const usd = a => (a.currency === "USD" || !a.currency) ? a.arr : a.arr * (r[a.currency] ?? 0);
        const act = st.accounts.filter(a => !a.churn), run = act.filter(a => a.name.startsWith(p));
        return { total: act.reduce((t, a) => t + usd(a), 0), runUSD: run.reduce((t, a) => t + usd(a), 0),
          runUsdOnly: run.filter(a => a.currency === "USD").reduce((t, a) => t + a.arr, 0), runCount: run.length };
      }, `QA ${runId} `);
      assert.equal(s.runCount, EXPECTED.accounts, "all run accounts are active in the store");
      assert.equal(s.runUsdOnly, EXPECTED.arrByCurrency.USD, "store holds this run's USD ARR exactly");
      assert.ok(s.runUSD >= EXPECTED.arrByCurrency.USD, "run ARR in USD >= its USD-denominated rows");
      assert.ok(s.total >= s.runUSD, `org ARR ${s.total} < run ARR ${s.runUSD}`);
      // What the UI shows: exactly the app's formatting of the exact total, and (allowing for
      // the card's rounding: up to $500 at K, $5,000 at M) not below the run's own ARR.
      const shown = (await stat(page, "Total ARR (USD)").textContent()).trim();
      assert.equal(shown, fmtMoney(s.total), "card shows fmtMoney(total of active accounts)");
      const slack = shown.endsWith("M") ? 5000 : 500;
      assert.ok(parseMoney(shown) + slack >= EXPECTED.arrByCurrency.USD, `card ${shown} < run USD ARR ${EXPECTED.arrByCurrency.USD}`);
      assert.ok(parseMoney(shown) + slack >= s.runUSD, `card ${shown} < run ARR in USD ${s.runUSD}`);
    } },

  { id: `${F}/no-console-errors`, feature: F, title: "Dashboard load raises no page errors or console errors", role: "admin",
    run: async ({ page, runId }) => {
      const errors = [];
      // Explicit allowlist of known-benign messages. Empty: nothing is ignored today.
      const BENIGN = [];
      const keep = m => !BENIGN.some(re => re.test(m));
      page.on("pageerror", e => { if (keep(String(e?.message || e))) errors.push(`pageerror: ${e?.message || e}`); });
      page.on("console", m => { if (m.type() === "error" && keep(m.text())) errors.push(`console.error: ${m.text()}`); });
      // signIn already loaded the app before these listeners existed: reload so the whole
      // dashboard load (session restore, first fetch, render) is observed.
      await page.reload();
      await openDashboard(page, runId);
      await page.locator("[data-arr-bridge]").waitFor({ timeout: 10000 });
      await page.waitForTimeout(2000); // late fetches / realtime subscribe
      assert.deepEqual(errors, [], `errors during dashboard load:\n${errors.join("\n")}`);
    } },
  // ---- UI refresh stage 2: the new headline cards, pills and panels (read-only: clicks navigate, nothing is written). ----
  { id: `${F}/headline-cards`, feature: F, title: "Four headline cards show numbers; Renewals count = its rows; Overdue sub reads 'N due in the next 7 days'", role: "admin",
    run: async ({ page, runId }) => {
      await openDashboard(page, runId);
      const kpis = page.locator("[data-kpi]");
      assert.equal(await kpis.count(), 4, "headline cards");
      for (const v of await page.locator("[data-kpi] [data-stat-value]").allTextContents())
        assert.match(v.trim(), /^(\$?[\d.]+[KM]?%?|—)$/, `headline value "${v}"`);
      const ren = (await page.locator('[data-kpi][data-stat="Renewals · 90 days"] [data-stat-value]').textContent()).trim();
      assert.equal(+ren, await page.locator("[data-renewal-row]").count(), "Renewals card count vs panel rows");
      const sub = (await page.locator('[data-kpi][data-stat="Overdue tasks"] [data-stat-value] + div').textContent()).trim();
      assert.match(sub, /^\d+ due in the next 7 days$/, "Overdue card sub");
      assert.doesNotMatch(await page.locator("[data-dash]").innerText(), /\bNaN\b|\bundefined\b|Infinity|Invalid Date/, "junk token on the dashboard");
    } },

  { id: `${F}/risk-card-filters-red`, feature: F, title: "ARR at risk card opens Accounts showing only Red accounts", role: "admin",
    run: async ({ page, runId }) => {
      await openDashboard(page, runId);
      // the card's own count ("N accounts in red health") is the Red set the list must show
      const sub = (await page.locator('[data-kpi][data-stat="ARR at risk (USD)"] [data-stat-value] + div').textContent()).trim();
      const m = /^(\d+) accounts in red health$/.exec(sub);
      assert.ok(m, `ARR at risk sub "${sub}"`);
      await page.locator('[data-kpi][data-stat="ARR at risk (USD)"]').click();
      await page.locator("main h1", { hasText: /^Accounts$/ }).waitFor({ timeout: 10000 });
      assert.equal(await page.locator('select[aria-label="Filter by health risk"]').inputValue(), "Red", "risk filter");
      await page.waitForTimeout(500);
      const n = await page.locator("[data-account-row]").count();
      // the list is windowed for long books: every rendered row is Red, so never more than the card's count
      if (+m[1] <= 20) assert.equal(n, +m[1], "rows vs the card's Red count");
      else assert.ok(n > 0 && n <= +m[1], `rows ${n} vs Red ${m[1]}`);
    } },

  { id: `${F}/pills-navigate`, feature: F, title: "Healthy pill opens Accounts filtered to Green; Total ARR pill equals the Total ARR stat", role: "admin",
    run: async ({ page, runId }) => {
      await openDashboard(page, runId);
      const total = (await stat(page, "Total ARR (USD)").textContent()).trim();
      assert.equal((await page.locator('[data-health-pill="Total ARR (USD)"] [data-stat-value]').textContent()).trim(), total, "Total ARR pill value");
      await page.locator('[data-health-pill="Healthy"]').click();
      await page.locator("main h1", { hasText: /^Accounts$/ }).waitFor({ timeout: 10000 });
      assert.equal(await page.locator('select[aria-label="Filter by health risk"]').inputValue(), "Green", "risk filter");
      await openDashboard(page, runId);
      assert.equal((await stat(page, "Total ARR (USD)").textContent()).trim(), total, "Total ARR after returning");
    } },

  { id: `${F}/renewals-card-opens-renewals`, feature: F, title: "Renewals · 90 days card opens Renewals", role: "admin",
    run: async ({ page, runId }) => {
      await openDashboard(page, runId);
      await page.locator('[data-kpi][data-stat="Renewals · 90 days"]').click();
      await page.locator("main h1", { hasText: /^Renewals$/ }).waitFor({ timeout: 10000 });
    } },

  { id: `${F}/overdue-card-opens-tasks`, feature: F, title: "Overdue tasks card opens Tasks with the Overdue section expanded", role: "admin",
    run: async ({ page, runId }) => {
      await openDashboard(page, runId);
      await page.locator('[data-kpi][data-stat="Overdue tasks"]').click();
      await page.locator("main h1", { hasText: /^Tasks$/ }).waitFor({ timeout: 10000 });
      const head = page.locator("main button", { hasText: /^Overdue/ });
      if (!(await head.count())) return; // no overdue tasks in the org: nothing to expand
      assert.match(await head.first().innerText(), /▾/, "Overdue section collapsed");
    } },

  { id: `${F}/team-row-filters-tasks`, feature: F, title: "First Team tasks row opens Tasks filtered to that owner", role: "admin",
    run: async ({ page, runId }) => {
      await openDashboard(page, runId);
      const row = page.locator("[data-team-row]").first();
      if (!(await page.locator("[data-team-row]").count())) throw new SkipScenario("no open tasks in the org, so no Team tasks rows");
      const name = await row.getAttribute("data-team-row");
      await row.click();
      await page.locator("[data-task-owner-filter]").waitFor({ timeout: 10000 });
      assert.equal(await page.locator("[data-task-owner-filter]").getAttribute("title"), `Owner: ${name}`, "owner chip");
    } },

  { id: `${F}/impl-row-opens-project`, feature: F, title: "An Implementation panel row opens that project's detail", role: "admin",
    run: async ({ page, runId }) => {
      await openDashboard(page, runId);
      if (!(await page.locator("[data-impl-row]").count())) throw new SkipScenario("no open implementation projects in the org");
      await page.locator("[data-impl-row]").first().click();
      await page.locator("main h1", { hasText: /^Implementation$/ }).waitFor({ timeout: 10000 });
      await page.locator("[data-project-stage]").waitFor({ timeout: 10000 });
      assert.equal(await page.locator("[data-board-project]").count(), 0, "board shown instead of the project");
    } },

  { id: `${F}/phone-no-overflow`, feature: F, title: "Dashboard at 390px has no horizontal overflow", role: "admin",
    run: async ({ page, runId }) => {
      const before = page.viewportSize();
      try {
        await page.setViewportSize({ width: 390, height: 844 });
        await openDashboard(page, runId);
        await page.locator("[data-kpi]").first().waitFor({ timeout: 10000 });
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 0, `horizontal overflow ${over}px at 390`);
      } finally { if (before) await page.setViewportSize(before); }
    } },
];
