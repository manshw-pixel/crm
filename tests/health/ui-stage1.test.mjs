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

// ---- Task 2: sidebar shell ----
// the mock returns the whole seeded profile row, so an email on it stands in for the session email
const asUser = (name, email) => `window.__seedProfile = { id: "u1", name: ${JSON.stringify(name)}, role: "admin", org_id: "org-a", platform_admin: false${email ? `, email: ${JSON.stringify(email)}` : ""} };`;
for (const [name, want] of [["Priya Shah", "PS"], ["Rahul", "R"], ["", "Z"]]) {
  test(`sidebar shows the logo tile and the signed-in user's initials (${JSON.stringify(name)} -> ${want})`, async () => {
    const pre = asUser(name, name ? "" : "z@x.io");
    const { page, browser } = await open("light", pre);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      const tile = await page.$eval("[data-logo-tile]", e => [e.innerText.trim(), getComputedStyle(e).width, getComputedStyle(e).backgroundColor]);
      assert(tile[0] === "O" && tile[1] === "32px" && tile[2] === "rgb(99, 102, 241)", "logo tile: " + tile);
      const av = await page.$eval("[data-avatar]", e => [e.innerText.trim(), getComputedStyle(e).width]);
      assert(av[0] === want && av[1] === "34px", "avatar: " + av);
      const side = await page.$eval("[data-sidebar]", e => [getComputedStyle(e).backgroundColor, e.getBoundingClientRect().width]);
      assert(side[0] === "rgb(17, 24, 39)" && side[1] === 248, "sidebar: " + side);
    } finally { await browser.close(); }
  });
}

test("active nav item is highlighted", async () => {
  const { page, browser } = await open("light");
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('nav[aria-label="Main"] button[title="Tasks"]');
    await page.waitForSelector('nav[aria-label="Main"] button[title="Tasks"][aria-current="page"]');
    const bgc = await page.$eval('nav[aria-label="Main"] [aria-current="page"]', e => getComputedStyle(e).backgroundColor);
    assert(bgc === "rgb(31, 41, 55)", "active bg: " + bgc);
    const other = await page.$eval('nav[aria-label="Main"] button[title="Accounts"]', e => getComputedStyle(e).backgroundColor);
    assert(other === "rgba(0, 0, 0, 0)", "inactive bg: " + other);
  } finally { await browser.close(); }
});

test("collapsed sidebar shows icons only and still navigates", async () => {
  const { page, browser } = await open("dark");
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('[aria-label="Collapse sidebar"]');
    await page.waitForFunction(() => document.querySelector("[data-sidebar]").getBoundingClientRect().width === 56, null, { timeout: 3000 }).catch(() => {}); // width transitions
    const t = await page.$eval('nav[aria-label="Main"]', e => e.innerText.trim());
    assert(t === "", "collapsed nav must show no labels: " + JSON.stringify(t));
    const s = await page.$eval("[data-sidebar]", e => [e.getBoundingClientRect().width, getComputedStyle(e).backgroundColor]);
    assert(s[0] === 56 && s[1] === "rgb(7, 11, 22)", "collapsed sidebar: " + s);
    await page.click('nav[aria-label="Main"] button[title="Accounts"]');
    await page.waitForSelector('nav[aria-label="Main"] button[title="Accounts"][aria-current="page"]');
    const h = await page.$eval("main h1", e => e.innerText.trim());
    assert(h === "Accounts", "navigated: " + h);
  } finally { await browser.close(); }
});

test("phone menu opens and closes at 390px", async () => {
  const { page, browser } = await open("light");
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const x = () => page.$eval("[data-sidebar]", e => e.getBoundingClientRect().right);
    const startClosed = await page.waitForFunction(() => document.querySelector("[data-sidebar]").getBoundingClientRect().right <= 0, null, { timeout: 3000 }).then(() => true).catch(() => false);
    assert(startClosed, "menu starts closed: right=" + await x());
    await page.click("[data-nav-toggle]");
    const opened = await page.waitForFunction(() => document.querySelector("[data-sidebar]").getBoundingClientRect().left >= 0, null, { timeout: 3000 }).then(() => true).catch(() => false);
    assert(opened, "menu opens");
    const label = await page.$eval('nav[aria-label="Main"] button[title="Tasks"]', e => [e.innerText.trim(), getComputedStyle(e).color]);
    assert(label[0] === "Tasks" && label[1] === "rgb(203, 213, 225)", "readable label: " + label);
    await page.click('nav[aria-label="Main"] button[title="Tasks"]');
    const closed = await page.waitForFunction(() => document.querySelector("[data-sidebar]").getBoundingClientRect().right <= 0, null, { timeout: 3000 }).then(() => true).catch(() => false);
    assert(closed, "menu closes after navigating");
  } finally { await browser.close(); }
});

// ---- Task 3: page frame ----
test("page title and card titles use the stage 1 type", async () => {
  const { page, browser } = await open("light");
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const h = await cs(page, "main h1", ["fontSize", "fontWeight"]);
    assert(h.fontSize === "26px" && h.fontWeight === "800", "h1: " + JSON.stringify(h));
    const t = await cs(page, "main .nm > div.mb-3 > h3", ["fontSize", "fontWeight", "textTransform"]);
    assert(t.fontSize === "16px" && t.fontWeight === "700" && t.textTransform === "none", "card title: " + JSON.stringify(t));
    const m = await cs(page, "main[data-main]", ["paddingTop", "paddingLeft"]);
    assert(m.paddingTop === "28px" && m.paddingLeft === "36px", "main padding: " + JSON.stringify(m));
  } finally { await browser.close(); }
});
