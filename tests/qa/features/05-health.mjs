import assert from "node:assert/strict";
import { waitForSaved } from "../reset.mjs";
import { SkipScenario } from "../core.mjs";
import { EXPECTED } from "../fixtures/expected.mjs";
import { searchCount, openAccount } from "./_accounts.mjs";
import { nav } from "./_users-card.mjs";
import { waitForRunAccounts, runAccounts } from "./_store.mjs";
import { openAllTaskSections, taskTitles } from "./_tasks.mjs";

const F = "05-health";

// Name -> Health-cell text for every listed row. The Health column is the th with
// data-sort-key="score" (src/20-account-list.jsx:186,287); its cell is a HealthChip (:316).
const listScores = page => page.evaluate(() => {
  const ths = [...document.querySelectorAll("thead tr th")];
  const col = ths.findIndex(th => th.getAttribute("data-sort-key") === "score");
  const nameCol = ths.findIndex(th => th.getAttribute("data-sort-key") === "name");
  if (col < 0 || nameCol < 0) return null;
  return [...document.querySelectorAll("tr[data-account-row]")].map(tr => ({
    // Stage 3: the name cell also holds avatar initials + industry, and the health cell reads "43 Watch".
    name: (tr.children[nameCol].querySelector("[data-account-name]") || tr.children[nameCol]).textContent.trim(),
    score: (t => (t.match(/^\d+/) || [t])[0])(tr.children[col].textContent.trim()) }));
});

// Stage 4: the detail page's score is the number inside the health ring ([data-health-ring]).
const detailScore = async (page, name) => {
  await page.getByRole("heading", { level: 1, name, exact: true }).waitFor({ timeout: 15000 });
  return (await page.locator("[data-header-card] [data-health-ring]").textContent()).trim();
};

export const scenarios = [
  { id: `${F}/score-renders`, feature: F, title: "Every run account shows a numeric 0-100 health score in the list", role: "admin",
    run: async ({ page, runId }) => {
      assert.equal(await searchCount(page, `QA ${runId} `), EXPECTED.accounts, "run accounts listed");
      const rows = await listScores(page);
      assert.ok(rows, "Health/Name columns not found in the account list");
      const mine = rows.filter(r => r.name.startsWith(`QA ${runId} `));
      assert.equal(mine.length, EXPECTED.accounts, "rendered run rows");
      for (const r of mine) {
        assert.match(r.score, /^\d{1,3}$/, `${r.name}: health cell "${r.score}" is not a number`);
        assert.ok(+r.score >= 0 && +r.score <= 100, `${r.name}: score ${r.score} outside 0-100`);
      }
    } },

  // Direction: a fresh activity can only RAISE engagement recency (src/lib/scoring.js
  // scoreComponents: legacy recency is 100 at <=7 days since the last activity; with the
  // per-type mix enabled, a "call" today scores 100 on the call sub-weight). Every other
  // component ignores activities, so a score can only rise -- but only if recency is below 100
  // and carries weight. We therefore ask the app's OWN healthScore what a call today would do
  // and pick an at-risk run account where it must rise; if none can rise (recency weight 0, or
  // every account already at max recency), the org's config makes the claim untestable -> skip.
  // The fixture accounts have no activities and default inputs, so they start Yellow (58 under
  // the default weights) with recency 0.
  { id: `${F}/touchpoint-moves-score`, feature: F, title: "Logging a call raises an at-risk account's health score", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      await nav(page, "Accounts").waitFor({ timeout: 20000 });
      await waitForRunAccounts(page, runId);
      const pick = await page.evaluate(p => {
        const st = window.__store.getState(), H = window.__health;
        const today = new Date(); const pad = n => String(n).padStart(2, "0");
        const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        const out = [];
        for (const a of st.accounts.filter(a => a.name.startsWith(p) && !a.churn)) {
          const before = H.healthScore(a, st.activities, st.settings.weights, st.settings);
          const acts = st.activities.concat([{ id: "qa-probe", accountId: a.id, type: "call", date: iso, summary: "" }]);
          const after = H.healthScore(a, acts, st.settings.weights, st.settings);
          out.push({ name: a.name, before, after });
        }
        return out;
      }, `QA ${runId} `);
      const rising = pick.filter(x => x.after > x.before).sort((x, y) => x.before - y.before); // most at-risk first
      if (!rising.length) throw new SkipScenario("org health config makes scores insensitive to a new call (recency weight 0 or every run account already at max recency)");
      const t = rising[0];
      await openAccount(page, t.name);
      const before = await detailScore(page, t.name);
      assert.equal(+before, t.before, "UI score before differs from the app's own healthScore");
      await page.getByRole("button", { name: "+ Log activity" }).click();
      await page.getByPlaceholder("Summary…").fill(`QA ${thisRunId} health call`);
      await page.getByRole("button", { name: "Log", exact: true }).click();
      await waitForSaved(page);
      await page.reload();
      await nav(page, "Accounts").waitFor({ timeout: 20000 });
      await waitForRunAccounts(page, runId);
      await openAccount(page, t.name);
      const after = +(await detailScore(page, t.name));
      assert.ok(after > +before, `score did not rise after a call: ${before} -> ${after}`);
      assert.equal(after, t.after, `score after the call should be ${t.after} (app's own healthScore)`);
    } },

  // The only playbook action an admin can trigger in the UI is Settings > Health playbook >
  // Backfill "Seed playbooks now" (src/24-settings.jsx:24-86): it seeds ♥ tasks for every live
  // Yellow/Red account (the renewal ▶ playbook and the band-crossing seeder are automatic).
  // It also seeds non-run at-risk accounts in the QA org; harmless there.
  { id: `${F}/playbook-creates-tasks`, feature: F, title: "Seeding health playbooks creates ♥ tasks for an at-risk run account", role: "admin",
    run: async ({ page, runId }) => {
      await nav(page, "Accounts").waitFor({ timeout: 20000 });
      await waitForRunAccounts(page, runId);
      const target = await page.evaluate(p => {
        const st = window.__store.getState(), H = window.__health;
        const hpb = H.healthPlaybookOf(st.settings);
        const riskOf = s => (s >= 70 ? "Green" : s >= 40 ? "Yellow" : "Red");
        for (const a of st.accounts.filter(a => a.name.startsWith(p) && !a.churn)) {
          const band = riskOf(H.healthScore(a, st.activities, st.settings.weights, st.settings));
          const steps = (hpb[band] || []).filter(s => s.title.trim()).length;
          if (band !== "Green" && steps) return { name: a.name, band, steps,
            existing: st.tasks.filter(t => t.accountId === a.id && t.healthPlaybook).length };
        }
        return null;
      }, `QA ${runId} `);
      if (!target) throw new SkipScenario("no at-risk run account with a non-empty health playbook band");
      // The import never seeds ♥ tasks: the band-crossing seeder initialises a new account
      // silently (healthBand undefined -> set, no items, src/26-app.jsx:310-315), so a fresh run
      // account has none. Any existing ones mean an earlier attempt seeded -> skip, which the
      // runner records as a fail when that earlier attempt failed (core.mjs).
      if (target.existing !== 0) throw new SkipScenario(`${target.name} already has ${target.existing} ♥ tasks before seeding`);

      await nav(page, "Settings").click();
      await page.getByRole("button", { name: "Seed playbooks now" }).click();
      await page.getByRole("button", { name: /^Confirm — seed \d+ accounts\?$/ }).click();
      await page.getByText(/^Seeded \d+ accounts \(\d+ tasks\)\.$/).waitFor({ timeout: 10000 });
      await waitForSaved(page);

      await nav(page, "Tasks").click();
      await page.locator('select[title="Source"]').selectOption("health");
      await page.getByPlaceholder("Search tasks…").fill(target.name);
      await openAllTaskSections(page);
      const rows = await taskTitles(page);
      const forAcct = rows.filter(r => r.account === target.name);
      assert.equal(forAcct.length, target.steps, `${target.name} (${target.band}): expected ${target.steps} ♥ tasks in Tasks, saw ${forAcct.length}`);
      assert.ok(forAcct.every(r => r.health), "a listed task is not marked as a health playbook step");
    } },
];
