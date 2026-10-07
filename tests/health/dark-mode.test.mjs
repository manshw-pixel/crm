import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// Dark mode E2E. Asserts COMPUTED colours, not class names: a class can be present while
// the variables behind it are wrong.
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const A = [seedAccount({ id: "r1", name: "Risky Co", csm: "Test User", renewalDate: day(10), healthBand: "Red",
  inputs: { usage: 5, sentiment: 5, tickets: 9, nps: -80 } })];
const seed = (pre = "") => `${pre}window.__seedRows = { accounts: ${JSON.stringify(A.map(d => ({ id: d.id, data: d })))},
  contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
const store = v => `try { localStorage.setItem("onevio.theme", ${JSON.stringify(v)}); } catch (e) {}`;
const bg = (page, sel) => page.$eval(sel, e => getComputedStyle(e).backgroundColor);
const isDark = page => page.evaluate(() => document.documentElement.classList.contains("dark"));
const ready = page => page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
const DARK_PAGE = "rgb(11, 17, 32)";
// The harness injects the seed script right after <body> -- AFTER the <head> theme script --
// so a value stored by the seed is only seen by the head script on the NEXT load. Store, then
// reload: exactly how a returning user arrives.
async function launchStored(v, extra = "") {
  const r = await launch(seed(store(v) + extra));
  await r.page.reload();
  return r;
}

test("stored dark: <html> is dark before any app script runs (no flash)", async () => {
  // the seed runs after the head script but before any app script, so it records what the
  // head script did on its own
  const { page, browser } = await launchStored("dark", `window.__darkAtBoot = document.documentElement.classList.contains("dark");`);
  try {
    await ready(page);
    assert(await page.evaluate(() => window.__darkAtBoot) === true, "dark class must be set by the <head> script, before the app");
    assert(await bg(page, "body") === DARK_PAGE, "body background: " + await bg(page, "body"));
  } finally { await browser.close(); }
});

test("garbage stored value + dark device paints dark (head script and React agree)", async () => {
  const { page, browser } = await launch(seed(store("Dark")));
  try {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload(); await ready(page);
    assert(await isDark(page), "unknown value must mean auto -> dark device -> dark");
  } finally { await browser.close(); }
});

test("dark: card, body text and a Red badge use dark colours; the dialog overlay stays dark", async () => {
  const { page, browser } = await launchStored("dark");
  try {
    await ready(page);
    assert(await bg(page, ".nm") !== "rgb(255, 255, 255)", "cards must not be white in dark");
    const text = await page.$eval("body", e => getComputedStyle(e).color);
    assert(text === "rgb(203, 213, 225)", "body text: " + text);
    await page.keyboard.press("Control+k");
    await page.waitForSelector(".bg-scrim\\/40");
    const scrim = await bg(page, ".bg-scrim\\/40");
    assert(/^rgba\(15, 23, 42, 0\.4\)$/.test(scrim), "overlay must stay dark: " + scrim);
  } finally { await browser.close(); }
});

test("print renders the light palette even in dark mode", async () => {
  const { page, browser } = await launchStored("dark");
  try {
    await ready(page);
    await page.emulateMedia({ media: "print" });
    const v = await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(246, 248, 251)", null, { timeout: 3000 }).then(() => true).catch(() => false);
    assert(v, "print background: " + await bg(page, "body"));
  } finally { await browser.close(); }
});

// launch() signs in as an admin; __seedProfile makes a non-admin (Settings is admin-only)
const MEMBER = `window.__seedProfile = { id: "u1", name: "Test User", role: "member", org_id: "org-a", platform_admin: false };`;

test("non-admin: the sidebar button cycles Light -> Dark -> Auto and the choice survives reload", async () => {
  const { page, browser } = await launch(seed(MEMBER + `try { if (localStorage.getItem("onevio.theme") === null) localStorage.setItem("onevio.theme", "light"); } catch (e) {}`)); // seed only once: init scripts re-run on reload and would overwrite the choice
  try {
    await ready(page);
    assert(!(await isDark(page)), "starts light");
    await page.click("[data-theme-toggle]");
    assert(await isDark(page), "light -> dark");
    assert(await page.evaluate(() => localStorage.getItem("onevio.theme")) === "dark", "stored");
    await page.emulateMedia({ colorScheme: "light" });
    await page.click("[data-theme-toggle]");
    assert(await page.evaluate(() => localStorage.getItem("onevio.theme")) === "auto", "dark -> auto");
    assert(!(await isDark(page)), "auto on a light device is light");
    await page.click("[data-theme-toggle]");
    assert(await page.evaluate(() => localStorage.getItem("onevio.theme")) === "light", "auto -> light");
    await page.click("[data-theme-toggle]");
    await page.reload(); await ready(page);
    assert(await isDark(page), "dark survives reload");
    const label = await page.getAttribute("[data-theme-toggle]", "aria-label");
    assert(/Dark/.test(label) && /Auto/.test(label), "accessible name states current and next: " + label);
  } finally { await browser.close(); }
});

test("auto follows a live device change; admin Settings card switches too", async () => {
  const { page, browser } = await launch(seed(store("auto")));
  try {
    await page.emulateMedia({ colorScheme: "light" });
    await ready(page);
    assert(!(await isDark(page)), "light device");
    await page.emulateMedia({ colorScheme: "dark" });
    assert(await page.waitForFunction(() => document.documentElement.classList.contains("dark"), null, { timeout: 3000 }).then(() => true).catch(() => false), "auto must follow the device live");
    await page.click('button[title="Settings"]');
    await page.click('[data-theme-choice="light"]');
    assert(!(await isDark(page)), "Settings: Light");
    assert(await page.getAttribute('[data-theme-choice="light"]', "aria-pressed") === "true", "current choice marked");
  } finally { await browser.close(); }
});

test("another tab's change is followed (storage event)", async () => {
  const { page, browser } = await launch(seed(store("light")));
  try {
    await ready(page);
    await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "onevio.theme", newValue: "dark" })));
    assert(await page.waitForFunction(() => document.documentElement.classList.contains("dark"), null, { timeout: 3000 }).then(() => true).catch(() => false), "must follow the other tab");
  } finally { await browser.close(); }
});

test("storage that throws: the app loads, auto works, the toggle works for the session", async () => {
  const blocked = `Storage.prototype.getItem = () => { throw new Error("blocked"); }; Storage.prototype.setItem = () => { throw new Error("blocked"); };`;
  const { page, browser } = await launch(seed(blocked));
  try {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload(); await ready(page);
    assert(await isDark(page), "auto from a dark device despite blocked storage");
    await page.click("[data-theme-toggle]"); // auto -> light
    assert(!(await isDark(page)), "toggle still works without storage");
  } finally { await browser.close(); }
});
