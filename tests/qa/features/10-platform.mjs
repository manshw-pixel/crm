import assert from "node:assert/strict";
import { MAIN, nav } from "./_users-card.mjs";

const F = "10-platform";
const MOBILE = { width: 390, height: 844 };

// The client console (src/25-auth-admin.jsx:256, data-client-console) replaces the app only for
// platform admins (src/26-app.jsx:584); inside a client they get a "← Clients" back link
// (data-back-to-clients). The QA users are not platform admins, so this is an absence check:
// the console, the back link and any "Clients" nav entry must all be missing once the app has
// fully rendered (main nav visible, so absence is not just "not loaded yet").
async function assertNoConsole(page) {
  await page.locator(MAIN).waitFor({ timeout: 20000 });
  await nav(page, "Dashboard").waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  assert.equal(await page.locator("[data-client-console]").count(), 0, "client console is rendered");
  assert.equal(await page.locator("[data-back-to-clients]").count(), 0, "'← Clients' link is rendered");
  const items = await page.locator(`${MAIN} button`).evaluateAll(bs => bs.map(b => b.getAttribute("aria-label")));
  assert.ok(items.length >= 4, `main nav has only ${items.length} entries`);
  assert.ok(!items.some(x => /client|console/i.test(x || "")), `nav has a console entry: ${items.join(", ")}`);
  assert.equal(await page.evaluate(() => !!window.__store?.getState?.()), true, "app store not mounted");
}

const luminance = rgb => {
  const m = rgb.match(/[\d.]+/g).map(Number);
  const [r, g, b] = m.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const themeChoice = page => page.evaluate(() => { try { return localStorage.getItem("onevio.theme"); } catch { return "unreadable"; } });

export const scenarios = [
  { id: `${F}/console-hidden-for-csm`, feature: F, title: "CSM sees no client-console entry", role: "csm",
    run: async ({ page }) => assertNoConsole(page) },
  { id: `${F}/console-hidden-for-lead`, feature: F, title: "Lead sees no client-console entry", role: "lead",
    run: async ({ page }) => assertNoConsole(page) },

  { id: `${F}/dark-mode`, feature: F, title: "Theme toggle reaches Dark: html.dark set and a dark page background; restored after", role: "csm",
    run: async ({ page }) => {
      const toggle = page.locator("[data-theme-toggle]");
      await toggle.waitFor({ timeout: 20000 });
      // Theme is per-browser localStorage ("onevio.theme"); each scenario has a fresh context,
      // so this only touches the throwaway context -- restored anyway, through the same toggle.
      const original = await themeChoice(page);
      const label = async () => (await toggle.getAttribute("title")).replace("Theme: ", "");
      const startLabel = await label();
      try {
        for (let i = 0; i < 3 && await label() !== "Dark"; i++) await toggle.click();
        assert.equal(await label(), "Dark", "toggle never reached Dark");
        await page.waitForFunction(() => document.documentElement.classList.contains("dark"), null, { timeout: 5000 });
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        const L = luminance(bg);
        assert.ok(L < 0.2, `body background ${bg} luminance ${L.toFixed(3)} is not dark`);
      } finally {
        for (let i = 0; i < 3 && await label() !== startLabel; i++) await toggle.click();
      }
      assert.equal(await label(), startLabel, "theme choice not restored");
      // A never-set choice (null) reads as Auto, and toggling back writes "auto" explicitly.
      const now = await themeChoice(page);
      assert.ok(now === original || (original === null && now === "auto"), `stored theme ${now}, was ${original}`);
    } },

  { id: `${F}/mobile`, feature: F, title: "Phone width: no horizontal scroll; menu button opens the nav", role: "csm", viewport: MOBILE,
    run: async ({ page }) => {
      await page.locator(MAIN).waitFor({ state: "attached", timeout: 20000 });
      await page.locator("[data-stat-value]").first().waitFor({ timeout: 20000 });
      assert.deepEqual(await page.evaluate(() => [window.innerWidth, window.innerHeight]), [MOBILE.width, MOBILE.height], "viewport not applied");
      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.ok(sw[0] <= sw[1], `horizontal scroll: scrollWidth ${sw[0]} > clientWidth ${sw[1]}`);
      // Off-canvas before; the menu button slides it in (translate-x-0) and nav entries become clickable.
      const dash = nav(page, "Dashboard");
      const inView = async () => (await dash.boundingBox())?.x >= 0;
      assert.equal(await inView(), false, "nav already on screen before the menu is opened");
      await page.locator("[data-nav-toggle]").click();
      await page.waitForFunction(sel => document.querySelector(sel).getBoundingClientRect().x >= 0, `${MAIN} button[aria-label="Tasks"]`, { timeout: 5000 });
      await nav(page, "Tasks").click();
      await page.locator("h1", { hasText: /^Tasks$/ }).waitFor({ timeout: 10000 });
    } },

  { id: `${F}/integrations-cards`, feature: F, title: "Settings → Integrations shows the sales and finance cards, three finance templates, and the log filter switches", role: "admin",
    run: async ({ page }) => {
      const errors = [];
      page.on("pageerror", e => errors.push(String(e?.message || e)));
      await page.locator(MAIN).waitFor({ timeout: 20000 });
      await nav(page, "Settings").click();
      const card = page.locator("#set-integrations");
      await card.waitFor({ timeout: 15000 });
      await card.scrollIntoViewIfNeeded();
      assert.equal(await card.locator("[data-feed]").count(), 2, "expected two feed cards");
      await card.locator("[data-feed='sales']").waitFor({ timeout: 5000 });
      const fin = card.locator("[data-feed='finance']");
      await fin.waitFor({ timeout: 5000 });
      const text = await fin.innerText();
      for (const t of ["Purchase orders", "Payments", "Billing completed"]) assert.ok(text.includes(t), `finance card lacks template "${t}"`);
      for (const f of ["All", "Sales", "Finance", "Errors"]) {
        const b = card.locator(`[data-log-filter='${f}']`);
        await b.click();
        assert.equal(await card.locator("[data-synclog]").count(), 1, `activity log gone after filter ${f}`);
      }
      assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
    } },

  { id: `${F}/bell`, feature: F, title: "Bell opens the alerts panel without a crash and closes on Escape", role: "csm",
    run: async ({ page }) => {
      const errors = [];
      page.on("pageerror", e => errors.push(String(e?.message || e)));
      const bell = page.locator("[data-bell]");
      await bell.waitFor({ timeout: 20000 });
      await bell.click();
      const panel = page.locator("[data-notif-panel]");
      await panel.waitFor({ timeout: 5000 });
      assert.equal(await bell.getAttribute("aria-expanded"), "true");
      assert.match(await panel.innerText(), /Alerts/);
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "detached", timeout: 5000 });
      assert.equal(await bell.getAttribute("aria-expanded"), "false");
      await nav(page, "Dashboard").waitFor({ state: "attached", timeout: 5000 });
      assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
    } },
];
