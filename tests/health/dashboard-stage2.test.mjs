// Dashboard stage 2: header (date line, greeting, "Whole team", quiet Saved, 42px bell).
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const A = [seedAccount({ id: "s1", name: "Stage Co", csm: "Priya Shah" })];
const rows = `window.__seedRows = { accounts: ${JSON.stringify(A.map(d => ({ id: d.id, data: d })))},
  contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };
  window.__seedProfile = { id: "u1", name: "Priya Shah", role: "admin", org_id: "org-a", platform_admin: false };`;
const ready = page => page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; }, sel);

test("dashboard header: date line, greeting, scope labels, no search, 42px bell", async () => {
  const { page, browser } = await launch(rows);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ready(page);
    await page.waitForSelector("[data-dash-greeting]");
    const date = (await page.textContent("[data-dash-date]")).trim();
    assert(/^[A-Z][a-z]+day, \d{1,2} [A-Z][a-z]+$/.test(date), "date line: " + date);
    const greet = (await page.textContent("[data-dash-greeting]")).trim();
    assert(/^Good (morning|afternoon|evening), Priya$/.test(greet), "greeting: " + greet);
    const labels = await page.$$eval("[data-scope-toggle] button", bs => bs.map(b => b.textContent.trim()));
    assert(labels.length === 2 && /^My book/.test(labels[0]) && labels[1] === "Whole team", "scope labels: " + labels);
    assert(!(await visible(page, '[data-sync-status="saved"]')), "Saved must be hidden on Dashboard");
    assert(await page.$('[data-sync-status="saved"]'), "saved status still in the DOM for assistive tech");
    const search = await page.$$eval('main > div:first-child input[placeholder^="Search"]', e => e.length);
    assert(search === 0, "no search box in the Dashboard header: " + search);
    const h = await page.$eval("[data-bell]", e => e.getBoundingClientRect().height);
    assert(h === 42, "bell height: " + h);
  } finally { await browser.close(); }
});

test("Saved stays visible on Accounts (hidden only on Dashboard)", async () => {
  const { page, browser } = await launch(rows);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ready(page);
    await page.waitForSelector("[data-dash-greeting]");
    await page.locator("aside").getByText("Accounts", { exact: true }).first().click();
    await page.waitForSelector('[data-sync-status="saved"]');
    assert(!(await page.$("[data-dash-greeting]")), "greeting only on Dashboard");
    assert(await visible(page, '[data-sync-status="saved"]'), "Saved visible on Accounts");
  } finally { await browser.close(); }
});

const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rgb = s => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);

for (const theme of ["light", "dark"]) test(`bell badge text contrast >= 4.5:1 (${theme})`, async () => {
  const { page, browser } = await launch(`try { localStorage.setItem("onevio.theme", "${theme}"); } catch (e) {}` + rows);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload(); await ready(page);
    await page.waitForSelector("[data-dash-greeting]");
    // the badge only renders with unread alerts: force one in the DOM if none is derived from the seed
    const c = await page.evaluate(() => {
      const b = document.querySelector("[data-bell]");
      let s = b.querySelector(":scope > span");
      if (!s) { s = document.createElement("span"); s.className = "absolute"; s.textContent = "1"; b.appendChild(s); }
      const cs = getComputedStyle(s); return [cs.color, cs.backgroundColor, cs.fontSize];
    });
    const r = ratio(rgb(c[0]), rgb(c[1]));
    assert(r >= 4.5, `badge contrast ${r.toFixed(2)} (${c})`);
    assert(c[2] === "10.5px", "badge font: " + c[2]);
  } finally { await browser.close(); }
});
