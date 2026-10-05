import { test, assert } from "./framework.mjs";
import { launch } from "./harness.mjs";

// The tab title and icon live in <head>; build.mjs rewrites <head>, and an earlier build
// silently ate head edits. So check the BUILT page, and that the icon actually decodes.
test("tab: title is OneVio CRM and the OV icon decodes as an image", async () => {
  const { page, browser } = await launch(`window.__seedRows = { accounts: [], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`);
  assert(await page.title() === "OneVio CRM", "title was " + await page.title());
  const w = await page.evaluate(() => new Promise(res => {
    const href = document.querySelector('link[rel="icon"]')?.href;
    if (!href) return res(-1);
    const img = new Image(); img.onload = () => res(img.naturalWidth); img.onerror = () => res(0); img.src = href;
  }));
  assert(w > 0, w === -1 ? "no <link rel=icon> in the built page" : "icon failed to decode");
  await browser.close();
});
