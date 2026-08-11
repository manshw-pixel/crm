import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// Score inputs chosen to land in each band (same values the crossing tests rely on).
const GREEN  = { usage: 90, sentiment: 90, tickets: 0,  nps: 60 };
const YELLOW = { usage: 55, sentiment: 55, tickets: 3,  nps: 0 };
const RED    = { usage: 15, sentiment: 15, tickets: 20, nps: -80 };

// A mixed book covering every candidate/non-candidate case in the spec.
export const MIXED = [
  seedAccount({ id: "a1", name: "Never Red",   inputs: RED,    healthBand: "Red" }),
  seedAccount({ id: "a2", name: "Never Yellow", inputs: YELLOW, healthBand: "Yellow" }),
  seedAccount({ id: "a3", name: "Seeded Yellow", inputs: YELLOW, healthBand: "Yellow", healthPlaybookBand: "Yellow" }),
  seedAccount({ id: "a4", name: "Churned Red",  inputs: RED,    healthBand: "Red", churn: true }),
  seedAccount({ id: "a5", name: "Healthy",      inputs: GREEN,  healthBand: "Green" }),
];

export function seedBook(accts) {
  return `window.__seedRows = { accounts: ${JSON.stringify(accts)}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
}
export const wait = page => page.waitForFunction(() => window.__store && window.__store.getState().accounts.length);

test("backfillCandidates selects non-churned Yellow/Red only", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  const ids = await page.evaluate(() => {
    const scored = [
      { id: "a1", risk: "Red",    churn: false },
      { id: "a2", risk: "Yellow", churn: false },
      { id: "a3", risk: "Yellow", churn: false },
      { id: "a4", risk: "Red",    churn: true },
      { id: "a5", risk: "Green",  churn: false },
    ];
    return window.__health.backfillCandidates(scored).map(a => a.id);
  });
  assert(ids.join(",") === "a1,a2,a3", "wrong candidates: " + ids.join(","));
  await browser.close();
});
