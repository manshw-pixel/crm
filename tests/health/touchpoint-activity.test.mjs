import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

// An ingested email carries two keys the app never writes itself (source, participants).
// This proves the timeline renders such a row as an ordinary email activity rather than
// crashing or hiding it.
const acct = seedAccount({ id: "tp1", name: "Inbox Co", healthBand: "Yellow" });
const act = { id: "em-abc", accountId: "tp1", type: "email", date: "2026-10-01",
  summary: "Renewal chat from inbox", details: "Quote attached.", loggedBy: "Priya",
  source: "email", participants: ["contact@inbox.example"] };
const seed = `window.__seedRows = { accounts: [{ id: "tp1", data: ${JSON.stringify(acct)} }],
  activities: [{ id: "em-abc", data: ${JSON.stringify(act)} }],
  contacts: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("an ingested email activity renders on the account timeline", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.click('button[title="Accounts"]');
    await page.getByText("Inbox Co").first().waitFor({ timeout: 8000 });
    await page.getByText("Inbox Co").first().click();
    await page.waitForFunction(() => /Activity timeline/.test(document.getElementById("root").textContent),
      { timeout: 8000 });
    const text = await rootText(page);
    assert(/Activity timeline \(1\)/.test(text), "timeline count is not 1");
    assert(text.includes("Renewal chat from inbox"), "summary not rendered");
    assert(text.includes("Quote attached."), "details not rendered");
  } finally {
    await browser.close();
  }
});
