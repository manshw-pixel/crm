// One score is a dot, not a trend: the Health breakdown chart needs two points.
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const seed = a => `window.__seedRows = { accounts: ${rows(a)}, contacts: [], activities: [], tasks: [], opportunities: [], settings: [],
  profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "admin" }] };`;
async function sparks(account) {
  const { page, browser } = await launch(seed([account]));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('button[title="Accounts"]');
    await page.getByText(account.name).first().click();
    await page.getByText("Health breakdown").first().waitFor();
    return await page.locator(".ad-spark svg").count();
  } finally { await browser.close(); }
}
test("health spark: an account with no history shows no lone dot", async () => {
  assert(await sparks(seedAccount({ id: "n1", name: "New Co", history: [] })) === 0, "chart drawn for one point");
});
test("health spark: an account with history still shows its trend", async () => {
  assert(await sparks(seedAccount({ id: "o1", name: "Old Co", history: [{ d: "2026-10-01", s: 60 }] })) === 1, "trend missing");
});
