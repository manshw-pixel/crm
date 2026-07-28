import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const acct = seedAccount({ healthBand: "Red",
  healthEvents: [{ date: new Date(Date.now() - 2*864e5).toISOString().slice(0,10), from: "Yellow", to: "Red" }],
  inputs: { usage: 20, sentiment: 20, tickets: 10, nps: -60 } });
const seed = `window.__seedRows = { accounts: [${JSON.stringify(acct)}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("dashboard shows Recently declined card with account", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForSelector("#root");
  const txt = await page.textContent("body");
  assert(/Recently declined/.test(txt), "card title missing");
  assert(new RegExp(acct.name).test(txt), "account name missing from Recently declined card");
  await browser.close();
});
