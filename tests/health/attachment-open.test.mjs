import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const LEGACY = "https://x.supabase.co/storage/v1/object/public/attachments/x1/1-old%20doc.pdf";
const seed = `window.__seedRows = { accounts: ${JSON.stringify([seedAccount({ id: "x1", name: "Link Co", renewalDate: day(20), documents: [
  { id: "d1", title: "Legacy", name: "old doc.pdf", category: "Contract", url: LEGACY, uploadedAt: day(-1) }] })])}.map(d => ({ id: d.id, data: d })),`
  + ` contacts: [], activities: [{ id: "v1", data: { id: "v1", accountId: "x1", type: "Call", date: "${day(-2)}", summary: "call",`
  + ` attachments: [{ name: "notes.txt", url: "https://x.supabase.co/whatever", path: "org-a/x1/2-notes.txt" }] } }], tasks: [], opportunities: [], settings: [] };`;

const openAcct = async page => {
  await page.click('button[title="Accounts"]');
  await page.getByText("Link Co").first().click();
  await page.getByText("Documents (1)").waitFor({ timeout: 8000 });
};

// The bucket is private, so a click must mint a signed URL from the stored path (or, for
// legacy items, the path inside the old public URL) and open that, never the raw link.
test("attachments open through a signed URL, legacy public links included", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.context().route("https://signed.test/**", r => r.fulfill({ status: 200, contentType: "text/plain", body: "ok" }));
    await openAcct(page);
    const [tab] = await Promise.all([page.context().waitForEvent("page"), page.locator("[data-attachment]", { hasText: "notes.txt" }).click()]);
    await tab.waitForURL(/signed\.test/, { timeout: 5000 }).catch(() => {});
    assert(tab.url().startsWith("https://signed.test/org-a/x1/2-notes.txt"), "activity attachment opened: " + tab.url());
    const [tab2] = await Promise.all([page.context().waitForEvent("page"), page.locator("[data-attachment]", { hasText: "Legacy" }).click()]);
    await tab2.waitForURL(/signed\.test/, { timeout: 5000 }).catch(() => {});
    assert(tab2.url().startsWith("https://signed.test/x1/1-old doc.pdf") || tab2.url().startsWith("https://signed.test/x1/1-old%20doc.pdf"), "legacy doc opened: " + tab2.url());
    const calls = await page.evaluate(() => window.__signedCalls);
    assert(JSON.stringify(calls) === JSON.stringify(["org-a/x1/2-notes.txt", "x1/1-old doc.pdf"]), "signed paths: " + JSON.stringify(calls));
  } finally { await browser.close(); }
});

test("attachment that cannot be signed shows an error toast", async () => {
  const { page, browser } = await launch(seed + ` window.__signedError = "Object not found";`);
  try {
    await openAcct(page);
    await page.locator("[data-attachment]", { hasText: "notes.txt" }).click();
    await page.getByText("Could not open notes.txt: Object not found").waitFor({ timeout: 5000 });
  } finally { await browser.close(); }
});
