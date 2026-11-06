// Filled buttons stay readable in dark mode; the bell panel never slides under the sidebar.
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const seed = theme => `try { localStorage.setItem("onevio.theme", "${theme}"); } catch (e) {}
window.__seedRows = { accounts: ${rows([seedAccount({ id: "a1", name: "Bell Co" })])}, contacts: [], activities: [], tasks: [], opportunities: [], settings: [],
  profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "admin" }] };`;

test("dark mode: a primary button has white text at 4.5:1 or better", async () => {
  const { page, browser } = await launch(seed("dark"));
  try {
    await page.reload();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('button[title="Accounts"]');
    await page.getByText("Bell Co").first().click();
    const btn = page.getByRole("button", { name: "+ Log activity" });
    await btn.waitFor();
    const c = await btn.evaluate(e => { const s = getComputedStyle(e); return { color: s.color, bg: s.backgroundColor }; });
    assert(c.color === "rgb(255, 255, 255)", "text colour: " + c.color);
    assert(c.bg === "rgb(79, 70, 229)", "background: " + c.bg);
  } finally { await browser.close(); }
});

test("bell panel: stays clear of the sidebar and the screen edge on short and long titled pages", async () => {
  const { page, browser } = await launch(seed("light"));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const view of ["Tasks", "Dashboard", "Accounts"]) {
      await page.locator(`nav[aria-label="Main"] button[title="${view}"]`).click();
      await page.click("[data-bell]");
      await page.waitForSelector("[data-notif-panel]");
      const r = await page.evaluate(() => ({ p: document.querySelector("[data-notif-panel]").getBoundingClientRect().toJSON(), side: document.querySelector('nav[aria-label="Main"]').getBoundingClientRect().right }));
      assert(r.p.left >= r.side, `${view}: panel left ${r.p.left} under sidebar ${r.side}`);
      assert(r.p.right <= 1440, `${view}: panel right ${r.p.right}`);
      await page.keyboard.press("Escape");
    }
  } finally { await browser.close(); }
});
