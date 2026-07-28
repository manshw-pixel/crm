import { launch, seedAccount } from "./harness.mjs";
import { test, assert } from "./framework.mjs";

test("app renders with seeded account", async () => {
  const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
  const { page, browser } = await launch(seed);
  const txt = await page.textContent("body");
  assert(/Test Co/.test(txt), "seeded account name should appear");
  await browser.close();
});
