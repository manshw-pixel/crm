import { launch, seedAccount } from "./harness.mjs";
import { test, assert } from "./framework.mjs";

const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("isoPlus adds days textually", async () => {
  const { page, browser } = await launch(seed);
  const r = await page.evaluate(() => window.__health.isoPlus("2026-07-28", 5));
  assert(r === "2026-08-02", `expected 2026-08-02, got ${r}`);
  await browser.close();
});

test("BAND_RANK orders bands", async () => {
  const { page, browser } = await launch(seed);
  const ranks = await page.evaluate(() => window.__health.BAND_RANK);
  assert(ranks.Green === 0 && ranks.Yellow === 1 && ranks.Red === 2, "band ranks wrong");
  await browser.close();
});

test("healthPlaybookOf falls back to default with Yellow+Red lists", async () => {
  const { page, browser } = await launch(seed);
  const pb = await page.evaluate(() => window.__health.healthPlaybookOf({}));
  assert(Array.isArray(pb.Yellow) && pb.Yellow.length > 0, "Yellow default missing");
  assert(Array.isArray(pb.Red) && pb.Red.length > 0, "Red default missing");
  await browser.close();
});
