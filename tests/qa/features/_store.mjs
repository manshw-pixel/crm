// Read-only access to the app's in-memory state (window.__store, src/26-app.jsx:168) and its
// pure scoring/retention functions (window.__health, src/26-app.jsx:608). Used to PICK targets
// and to compute exact expected figures with the app's own code; assertions stay on the UI.
// Not a feature: `scenarios` is empty so run.mjs can load it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export const scenarios = [];

// Waits until the store holds this run's accounts (the first fetch lands after sign-in).
export async function waitForRunAccounts(page, runId, timeoutMs = 20000) {
  await page.waitForFunction(p => {
    const s = window.__store?.getState?.();
    return !!s && s.accounts.some(a => a.name.startsWith(p));
  }, `QA ${runId} `, { timeout: timeoutMs, polling: 250 });
}

// This run's accounts as the app holds them, with the app's own score + USD ARR.
export const runAccounts = (page, runId) => page.evaluate(p => {
  const st = window.__store.getState(), H = window.__health;
  return st.accounts.filter(a => a.name.startsWith(p)).map(a => ({
    id: a.id, name: a.name, arr: a.arr, currency: a.currency, csm: a.csm, renewalDate: a.renewalDate,
    churn: !!a.churn, contractStatus: a.contractStatus,
    score: H.healthScore(a, st.activities, st.settings.weights, st.settings),
  }));
}, `QA ${runId} `);

// Fixture rows by company name -> { arr, currency, status } (the CSV is the source of truth).
const CSV = readFileSync(fileURLToPath(new URL("../fixtures/accounts.csv", import.meta.url)), "utf8");
export const fixtureRow = company => {
  const line = CSV.split(/\r?\n/).find(l => l.startsWith(`QA {RUN} ${company},`));
  if (!line) throw new Error(`fixture has no row for ${company}`);
  const c = line.split(",");
  return { arr: +c[2], currency: c[3], status: c[7] };
};
