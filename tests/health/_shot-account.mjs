// Screenshot of the account detail header at desktop and phone width (dev aid, not a test).
// Usage: node tests/health/_shot-account.mjs <out-dir>
import { launch } from "./harness.mjs";
const out = process.argv[2];
const acct = { id: "a1", data: { id: "a1", name: "Acme Retail India Ltd", tier: "Enterprise", arr: 480000, currency: "INR", industry: "Retail", csm: "Priya Shah",
  startDate: "2024-01-01", renewalDate: "2026-11-30", contractStatus: "Active", licenses: 200, deployedLicenses: 150, modules: "Core, Analytics",
  inputs: { usage: 60, sentiment: 50, tickets: 3, nps: 20 }, history: [], inputsUpdatedAt: "2026-09-01", transitionDate: "2025-02-01", nextQbrDate: "2026-11-01", qbrFrequency: "Quarterly" } };
const seed = `window.__seedRows = { accounts: ${JSON.stringify([acct])}, contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [], orgs: [{ id: "org-a", name: "Acme Corp", max_accounts: null }] };
  window.__seedProfile = { id: "u1", name: "Admin", role: "admin", org_id: "org-a", platform_admin: false };`;
for (const [w, h, name] of [[1440, 900, "desktop"], [390, 844, "mobile"]]) {
  const { page, browser } = await launch(seed);
  await page.setViewportSize({ width: w, height: h });
  await page.waitForFunction(() => window.__orgLimits && window.__orgLimits.loaded === true, null, { timeout: 15000 });
  if (name === "mobile") { const m = page.locator('button[aria-label*="menu" i]'); if (await m.count()) await m.first().click(); }
  await page.click('button[title="Accounts"]', { timeout: 10000 });
  await page.click("[data-account-row]:has-text('Acme')", { timeout: 10000 });
  await page.waitForSelector("[data-header-card]");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/account-${name}.png` });
  await browser.close();
}
