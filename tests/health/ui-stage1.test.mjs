import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// UI refresh Stage 1: the approved frame + primitives. Computed styles, both themes.
const A = [seedAccount({ id: "s1", name: "Stage Co", csm: "Test User" })];
const rows = `window.__seedRows = { accounts: ${JSON.stringify(A.map(d => ({ id: d.id, data: d })))},
  contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
const store = v => `try { localStorage.setItem("onevio.theme", ${JSON.stringify(v)}); } catch (e) {}`;
const ready = page => page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
const cs = (page, sel, props) => page.$eval(sel, (e, p) => { const s = getComputedStyle(e); return Object.fromEntries(p.map(k => [k, s[k]])); }, props);
async function open(theme, pre = "") {
  const r = await launch(pre + store(theme) + rows);
  await r.page.reload(); await ready(r.page);
  return r;
}

for (const [theme, page_, card] of [["light", "rgb(244, 245, 251)", "rgb(255, 255, 255)"], ["dark", "rgb(11, 17, 32)", "rgb(19, 27, 44)"]]) {
  test(`stage 1 primitives use the approved tokens in both themes (${theme})`, async () => {
    const { page, browser } = await open(theme);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      const body = await cs(page, "body", ["backgroundColor"]);
      assert(body.backgroundColor === page_, "page bg: " + body.backgroundColor);
      const c = await cs(page, "main .nm", ["borderTopLeftRadius", "borderTopWidth", "backgroundColor"]);
      assert(c.borderTopLeftRadius === "16px", "card radius: " + c.borderTopLeftRadius);
      assert(c.borderTopWidth === "0px", "card border: " + c.borderTopWidth);
      assert(c.backgroundColor === card, "card bg: " + c.backgroundColor);
      await page.click('button[title="Accounts"]');
      await page.waitForSelector("main thead th");
      const b = await cs(page, "main .grad", ["borderTopLeftRadius", "backgroundColor"]);
      assert(b.borderTopLeftRadius === "10px" || b.borderTopLeftRadius === "12px", "primary radius: " + b.borderTopLeftRadius);
      assert(b.backgroundColor === "rgb(79, 70, 229)", "primary bg: " + b.backgroundColor);
      const th = await cs(page, "main thead th", ["textTransform", "backgroundColor"]);
      assert(th.textTransform === "uppercase", "th case: " + th.textTransform);
      const band = theme === "light" ? "rgb(248, 250, 252)" : "rgb(24, 33, 52)";
      assert(th.backgroundColor === band, "th bg: " + th.backgroundColor);
      // keyboard focus shows the 2px ring
      await page.keyboard.press("Tab");
      const o = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return [document.activeElement.tagName, s.outlineWidth, s.outlineStyle]; });
      assert(o[1] === "2px" && o[2] === "solid", "focus ring: " + o);
    } finally { await browser.close(); }
  });
}

// frame-level primary button (outside cards) is 40px tall, radius 12
test("stage 1: a frame-level button is 40px with a 12px radius", async () => {
  const { page, browser } = await open("light");
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const b = await page.$eval("[data-bell]", e => { const s = getComputedStyle(e); return [e.getBoundingClientRect().height, s.borderTopLeftRadius]; });
    assert(b[0] === 40 && b[1] === "12px", "bell button: " + b);
  } finally { await browser.close(); }
});
