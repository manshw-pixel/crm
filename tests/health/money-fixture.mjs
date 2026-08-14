// Fixtures for the money-math suite.
//
// IMPORTANT: `arrUSD` is NOT a stored account field — the scoring pass at crm.html:3082
// adds it as toUSD(a.arr, a.currency, rates) before any analytics function sees it.
// retentionStats and cohortData read a.arrUSD directly, so every fixture account states
// it explicitly. Leaving it off yields undefined and every sum becomes NaN.
import { seedAccount } from "./harness.mjs";

export const DAY = 86400000;

// Relative ISO date. Seeding by offset keeps quarter-bucketing tests from breaking on a
// calendar boundary — see the spec's "central risk" section.
export const rel = days => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

// crm.html:78. USD is always 1; anything unlisted resolves to 0.
export const RATES = { INR: 0.012, PHP: 0.018 };

// A scored account: seedAccount's defaults plus arrUSD, which callers usually set to arr
// (USD) or to arr * rate for a foreign-currency account.
export function scored(o = {}) {
  const a = seedAccount(o);
  return { ...a, arrUSD: o.arrUSD !== undefined ? o.arrUSD : a.arr };
}

// Seed script for launch(). Analytics functions take rates and snapshots as arguments
// rather than reading them from state, so no settings row is needed here.
export function bookSeed(accounts) {
  return `window.__seedRows = { accounts: ${JSON.stringify(accounts)}.map(d => ({ id: d.id, data: d })),`
    + ` contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
}
