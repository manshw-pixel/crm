import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const seedOf = (accts, extra = {}) => `window.__seedRows = { accounts: ${JSON.stringify(accts)}.map(d => ({ id: d.id, data: d })), contacts: [], activities: ${JSON.stringify(extra.activities || [])}, tasks: [], opportunities: [], team: [], settings: [] };`;

// Account JSON is writable by any member via merge_row, and React 18 renders javascript:
// hrefs verbatim. A planted link must render inert; a real storage link must survive.
// Positive control (the https link keeps its href) proves the selector finds real anchors.
test("document and attachment links never render a javascript: href", async () => {
  const A = seedAccount({ id: "x1", name: "Link Co", renewalDate: day(20), documents: [
    { id: "d1", title: "Evil", name: "e.pdf", category: "Contract", url: "javascript:alert(document.cookie)", uploadedAt: day(-1) },
    { id: "d2", title: "Good", name: "g.pdf", category: "Contract", url: "https://x.supabase.co/storage/v1/object/public/attachments/g.pdf", uploadedAt: day(-1) }] });
  const { page, browser } = await launch(seedOf([A], { activities: [{ id: "v1", data: { id: "v1", accountId: "x1", type: "Call", date: day(-2), note: "hi",
    attachments: [{ name: "bad.txt", url: "  JavaScript:alert(1)", path: "p1" }] } }] }));
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    await page.click('button[title="Accounts"]');
    await page.getByText("Link Co").first().click();
    await page.getByText("Documents (2)").waitFor({ timeout: 8000 });
    const hrefs = await page.$$eval("#root a", as => as.map(a => a.getAttribute("href")).filter(Boolean));
    assert(hrefs.some(h => h.startsWith("https://x.supabase.co")), "positive control: good link missing: " + JSON.stringify(hrefs));
    const bad = hrefs.filter(h => /^\s*javascript:/i.test(h));
    assert(bad.length === 0, "javascript: href rendered: " + JSON.stringify(bad));
  } finally { await browser.close(); }
});
