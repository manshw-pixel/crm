// Number keys 1..N open the sidebar items in sidebar order -- every item, not just the first five.
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "a1", name: "Alpha", csm: "Priya" });
const seed = `window.__seedRows = { accounts: ${JSON.stringify([A])}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [],
  profiles: [{ id: "u1", org_id: "org-a", name: "Priya", role: "admin" }] };`;

test("each number key opens the sidebar item at that position, including 6 and 7", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.waitForSelector('button[aria-current="page"]');
    const NAV = ["Dashboard", "Implementation", "Tasks", "Accounts", "Renewals", "Finance", "Settings"];
    const order = await page.$$eval("aside button[title], nav button[title]", (els, nav) =>
      [...new Set(els.map(e => e.getAttribute("title")).filter(t => nav.includes(t)))], NAV);
    assert(order.includes("Finance") && order.includes("Settings") && order.length >= 7, "sidebar " + JSON.stringify(order));
    for (let i = order.length - 1; i >= 0; i--) {
      await page.keyboard.press(String(i + 1));
      await page.waitForSelector(`button[title="${order[i]}"][aria-current="page"]`, { timeout: 5000 }).catch(() => { throw new Error(`key ${i + 1} did not open ${order[i]}; sidebar ${JSON.stringify(order)}`); });
    }
  } finally { await browser.close(); }
});
