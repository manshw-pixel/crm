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

test("phone: notification panel fits inside the screen", async () => {
  const { page, browser } = await launch(seed);
  await page.setViewportSize({ width: 375, height: 800 });
  // Wait for load and the phone reflow before opening: clicking straight after the resize
  // measured the panel against the desktop bell position (seen once in a full run:
  // left -204). Then poll, so a panel that is genuinely off-screen still fails.
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length > 0);
  await page.waitForFunction(() => !document.querySelector('button[aria-label*="enu"]') || document.querySelector('button[aria-label*="enu"]').offsetParent);
  await page.click('button[title="Renewal & contract alerts"]');
  const box = await page.waitForFunction(() => {
    const el = [...document.querySelectorAll("main .nm.absolute")][0];
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return b.left >= 0 && b.right <= 375 ? { left: b.left, right: b.right } : null;
  }, null, { timeout: 3000 }).then(h => h.jsonValue()).catch(() => page.evaluate(() => {
    const b = document.querySelector("main .nm.absolute")?.getBoundingClientRect(); return b ? { left: b.left, right: b.right } : null;
  }));
  assert(box && box.left >= 0 && box.right <= 375, `panel spills off screen: ${JSON.stringify(box)}`);
  await browser.close();
});
