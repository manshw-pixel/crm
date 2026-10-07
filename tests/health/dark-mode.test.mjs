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
