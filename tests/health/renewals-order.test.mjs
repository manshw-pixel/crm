import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// Two renewals in the same month column, seeded latest-first. The board must list them by
// renewal date regardless of the order the scored list hands them over in.
const next = new Date(); next.setDate(1); next.setMonth(next.getMonth() + 1);
const inNextMonth = d => `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const accts = [
  seedAccount({ id: "late", name: "Late Renewal Co", renewalDate: inNextMonth(25) }),
  seedAccount({ id: "early", name: "Early Renewal Co", renewalDate: inNextMonth(3) }),
];
const seed = `window.__seedRows = { accounts: ${JSON.stringify(accts)}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("Renewals board orders cards by renewal date within a month", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.click('button[title="Renewals"]');
    const col = page.locator("[data-col]", { hasText: "Late Renewal Co" });
    await col.waitFor({ timeout: 8000 });
    const text = await col.textContent();
    assert(text.indexOf("Early Renewal Co") < text.indexOf("Late Renewal Co"),
      "within-month order is not by renewal date: " + text.slice(0, 200));
  } finally { await browser.close(); }
});
