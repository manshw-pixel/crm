import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// Responsive shell + dashboard. The rule under test: at lg (>=1024px) the layout is exactly
// what it was before -- fixed sidebar rail, 3/4-column stat rows, no menu button -- and below
// lg the sidebar becomes a drawer and nothing scrolls sideways. Every "hidden" assertion is
// paired with its "shown" counterpart at the other width, so neither can pass vacuously.
const today = new Date().toISOString().slice(0, 10);
const accts = [
  seedAccount({ id: "m1", name: "Northwind Very Long Customer Name Holdings", arr: 125000, csm: "Alexandra Montgomery-Smith" }),
  seedAccount({ id: "m2", name: "Contoso", arr: 48000, healthBand: "Red", inputs: { usage: 10, sentiment: 10, tickets: 8, nps: -60 } }),
];
const seed = `window.__seedRows = { accounts: ${JSON.stringify(accts)}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [],
  tasks: [{ id: "t1", data: { id: "t1", title: "Prepare an unusually long quarterly business review deck for the steering committee", accountId: "m1", owner: "Alexandra Montgomery-Smith", due: "${today}", status: "Open", priority: "High" } }],
  opportunities: [], team: [], settings: [] };`;

const layout = page => page.evaluate(() => {
  const aside = document.querySelector("aside").getBoundingClientRect();
  const main = document.querySelector("main").getBoundingClientRect();
  const toggle = document.querySelector("[data-nav-toggle]");
  const statRow = [...document.querySelectorAll("main .grid")][0];
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    asideRight: aside.right, mainLeft: main.left,
    toggleShown: !!toggle && toggle.offsetParent !== null,
    statCols: statRow ? getComputedStyle(statRow).gridTemplateColumns.split(" ").length : 0,
  };
});

test("desktop (1280px): fixed sidebar, no menu button, 3-column stat row -- unchanged layout", async () => {
  const { page, browser } = await launch(seed);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForSelector("main .grid");
  const l = await layout(page);
  assert(l.asideRight > 100, `sidebar should be on screen, right edge ${l.asideRight}`);
  assert(l.mainLeft >= l.asideRight - 1, `main should start where the rail ends: main ${l.mainLeft}, rail ${l.asideRight}`);
  assert(!l.toggleShown, "menu button must be hidden on desktop");
  assert(l.statCols === 3, `stat row should be 3 columns, got ${l.statCols}`);
  assert(l.overflow <= 0, `no horizontal scroll, overflow ${l.overflow}`);
  await browser.close();
});

test("phone (375px): sidebar is an off-screen drawer, 2-column stats, no sideways scroll", async () => {
  const { page, browser } = await launch(seed);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForSelector("main .grid");
  await page.waitForTimeout(300); // let the drawer transition settle
  const l = await layout(page);
  assert(l.asideRight <= 0, `sidebar should be off-screen, right edge ${l.asideRight}`);
  assert(l.mainLeft < 20, `main should use the full width, left ${l.mainLeft}`);
  assert(l.toggleShown, "menu button must show on a phone");
  assert(l.statCols === 2, `stat row should be 2 columns, got ${l.statCols}`);
  assert(l.overflow <= 0, `page scrolls sideways by ${l.overflow}px`);
  await browser.close();
});

test("phone: menu opens the drawer, choosing a view closes it, backdrop also closes it", async () => {
  const { page, browser } = await launch(seed);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.click("[data-nav-toggle]");
  await page.waitForTimeout(300);
  let r = await page.evaluate(() => document.querySelector("aside").getBoundingClientRect().left);
  assert(r === 0, `drawer should slide in, left ${r}`);
  await page.click('nav[aria-label="Main"] button[aria-label="Tasks"]');
  await page.waitForTimeout(300);
  r = await page.evaluate(() => document.querySelector("aside").getBoundingClientRect().right);
  assert(r <= 0, `drawer should close after navigating, right ${r}`);
  assert(await page.textContent("main h1") === "Tasks", "navigation should have happened");
  await page.click("[data-nav-toggle]");
  await page.click("[data-nav-backdrop]", { position: { x: 360, y: 400 } });
  await page.waitForTimeout(300);
  r = await page.evaluate(() => document.querySelector("aside").getBoundingClientRect().right);
  assert(r <= 0, `backdrop tap should close the drawer, right ${r}`);
  await browser.close();
});

// The panel used to hang off the bell (absolute right-0). Below ~375px the header wraps,
// the bell drops to the LEFT edge, and the panel opened at x = -231. An earlier version of
// the test below was "de-flaked" with a wait when it was really catching this at the wrap
// point -- so this one checks the widths on both sides of it, with no settle-wait excuse.
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const alertSeed = n => `window.__seedRows = { accounts: ${JSON.stringify(Array.from({ length: n }, (_, i) =>
  seedAccount({ id: "r" + i, name: "Renewing Customer With A Long Name " + i, csm: "Test User", renewalDate: day(2 + i * 2) })))}.map(d => ({ id: d.id, data: d })),
  contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
for (const w of [360, 375, 390]) test(`phone ${w}px: notification panel is on screen, full width, and scrolls a long list`, async () => {
  const { page, browser } = await launch(alertSeed(14));
  try {
    await page.setViewportSize({ width: w, height: 700 });
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 14);
    await page.click("[data-bell]");
    const p = await page.$eval("[data-notif-panel]", e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width, bottom: b.bottom, scrolls: e.scrollHeight > e.clientHeight }; });
    assert(p.l >= 0 && p.r <= w, `panel off screen at ${w}px: ${JSON.stringify(p)}`);
    assert(p.w >= w - 32, `panel should use the phone's width (${w}px), got ${p.w}`);
    assert(p.bottom <= 700, `panel runs off the bottom: ${p.bottom}`);
    assert(p.scrolls, "a 14-alert list should scroll inside the panel");
  } finally { await browser.close(); }
});

test("notification panel closes on Escape and on a tap outside", async () => {
  const { page, browser } = await launch(alertSeed(3));
  try {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 3);
    await page.click("[data-bell]");
    await page.waitForSelector("[data-notif-panel]");
    await page.keyboard.press("Escape");
    assert(!(await page.$("[data-notif-panel]")), "Escape should close the panel");
    await page.click("[data-bell]");
    await page.waitForSelector("[data-notif-panel]");
    await page.mouse.click(30, 650);
    assert(!(await page.$("[data-notif-panel]")), "a tap outside should close the panel");
  } finally { await browser.close(); }
});

test("phone: toasts span the screen with even margins; desktop keeps the corner stack", async () => {
  const { page, browser } = await launch(alertSeed(1));
  try {
    await page.setViewportSize({ width: 360, height: 700 });
    await page.waitForFunction(() => window.__store && window.__toast);
    await page.evaluate(() => window.__toast({ text: "Saved", tone: "success" }));
    const t = await page.$eval("[data-toast]", e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right }; });
    assert(t.l >= 8 && t.l <= 16 && 360 - t.r >= 8 && 360 - t.r <= 16, "phone toast should be full width with ~12px margins: " + JSON.stringify(t));
    await page.setViewportSize({ width: 1280, height: 800 });
    // poll: right after a resize the old (phone) layout can still be measured
    const d = await page.waitForFunction(() => { const b = document.querySelector("[data-toast]").getBoundingClientRect();
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize); return Math.abs(b.width - 20 * rem) < 2 ? { w: b.width, r: b.right, want: 20 * rem } : null; }, null, { timeout: 3000 })
      .then(h => h.jsonValue()).catch(() => page.$eval("[data-toast]", e => { const b = e.getBoundingClientRect(); return { w: b.width, r: b.right }; }));
    assert(d.want && 1280 - d.r <= 20, "desktop toast should stay the w-80 (20rem) bottom-right stack: " + JSON.stringify(d));
  } finally { await browser.close(); }
});
