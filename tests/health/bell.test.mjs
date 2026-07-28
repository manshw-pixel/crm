import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

// Account with a recent decline event already recorded (so no dependence on seeder timing).
const acct = seedAccount({ healthBand: "Yellow",
  healthEvents: [{ date: new Date(Date.now() - 3*864e5).toISOString().slice(0,10), from: "Green", to: "Yellow" }],
  inputs: { usage: 55, sentiment: 55, tickets: 3, nps: 0 } });
const seed = `window.__seedRows = { accounts: [${JSON.stringify(acct)}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("bell shows recent health-decline item", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForSelector("#root");
  await page.click('button[title="Renewal & contract alerts"]');
  const txt = await rootText(page);
  assert(/health dropped to Yellow/i.test(txt), "decline alert text missing");
  await browser.close();
});
