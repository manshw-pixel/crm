import assert from "node:assert/strict";
import { EXPECTED } from "../fixtures/expected.mjs";
import { nav } from "./_users-card.mjs";
import { waitForRunAccounts } from "./_store.mjs";
import { fmtMoney } from "../../../src/lib/money.js";

const F = "09-dashboard";
const stat = (page, label) => page.locator(`[data-stat="${label}"] [data-stat-value]`);

// Dashboard on the "All" scope (the run's admin-owned row is outside the csm's book, and the
// admin's "My book" is one row), once the store holds this run's accounts.
async function openDashboard(page, runId) {
  await nav(page, "Dashboard").waitFor({ timeout: 20000 });
  await waitForRunAccounts(page, runId);
  await nav(page, "Dashboard").click();
  await page.locator("[data-scope-toggle] button", { hasText: /^All$/ }).click();
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
        assert.match(await lic.locator("[data-license-summary]").textContent(), /\d+ total · \d+ deployed · \d+%/);
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
];
