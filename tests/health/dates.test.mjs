import { launch, seedAccount } from "./harness.mjs";
import { test, assert } from "./framework.mjs";

const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

// addMonths drives nextQbrDate when a QBR is logged. Month-end dates must clamp to the
// target month's last day rather than overflowing into the following month, and the
// result must not shift with the viewer's timezone (crm.html mixes UTC parsing with
// local-time date math elsewhere — this helper must stay purely textual).
test("addMonths clamps month-end dates instead of overflowing", async () => {
  const { page, browser } = await launch(seed);
  const cases = [
    ["2026-01-31", 1, "2026-02-28"],  // short month, non-leap
    ["2024-01-31", 1, "2024-02-29"],  // short month, leap year
    ["2026-08-31", 3, "2026-11-30"],  // 31 -> 30-day month
    ["2026-11-30", 3, "2027-02-28"],  // crosses year boundary
    ["2026-08-31", 6, "2027-02-28"],  // semi-annual cadence
    ["2026-02-28", 12, "2027-02-28"], // annual cadence, exact
    ["2026-07-15", 3, "2026-10-15"],  // ordinary mid-month case
  ];
  for (const [from, m, want] of cases) {
    const got = await page.evaluate(([f, mm]) => window.__health.addMonths(f, mm), [from, m]);
    assert(got === want, `addMonths(${from}, ${m}) expected ${want}, got ${got}`);
  }
  await browser.close();
});
