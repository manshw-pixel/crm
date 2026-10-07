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
const DARK_CARD = "rgb(19, 27, 44)"; // --white in dark
// Per the suite rule, a state change caused by a click is polled for, never read immediately.
const darkIs = (page, want) => page.waitForFunction(w => document.documentElement.classList.contains("dark") === w, want, { timeout: 3000 }).then(() => true).catch(() => false);
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

test("garbage stored value + light device paints light", async () => {
  const { page, browser } = await launch(seed(store("Dark")));
  try {
    await page.emulateMedia({ colorScheme: "dark" }); // start dark so a light result is a real change, not the default
    await page.reload(); await ready(page);
    assert(await isDark(page), "precondition: dark device -> dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload(); await ready(page);
    assert(!(await isDark(page)), "unknown value must mean auto -> light device -> light");
    assert(await bg(page, "body") === "rgb(246, 248, 251)", "body: " + await bg(page, "body"));
  } finally { await browser.close(); }
});

test("dark: card, body text and a Red badge use dark colours; the dialog overlay stays dark", async () => {
  const { page, browser } = await launchStored("dark");
  try {
    await ready(page);
    assert(await bg(page, ".nm") === DARK_CARD, "card: " + await bg(page, ".nm"));
    // Risky Co is Red: its health Chip in the accounts list is the rose-100 / rose-700 badge
    await page.click('button[title="Accounts"]');
    await page.waitForSelector("span.rounded-full.bg-rose-100.border-rose-300");
    const badge = await page.$eval("span.rounded-full.bg-rose-100.border-rose-300", e => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]);
    assert(badge, "a Red badge must render");
    assert(badge[0] === "rgb(70, 22, 38)" && badge[1] === "rgb(253, 164, 175)", "Red badge fill/text: " + badge);
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
    // native controls too: no colour-scheme may leak into print (an inline style would)
    const cs = await page.evaluate(() => { const i = document.createElement("input"); document.body.appendChild(i);
      const r = [getComputedStyle(i).colorScheme, getComputedStyle(document.documentElement).colorScheme]; i.remove(); return r; });
    assert(cs.every(x => x !== "dark"), "print colour-scheme must not be dark: " + cs);
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
    assert(await darkIs(page, true), "light -> dark");
    assert(await page.evaluate(() => localStorage.getItem("onevio.theme")) === "dark", "stored");
    await page.emulateMedia({ colorScheme: "light" });
    await page.click("[data-theme-toggle]");
    assert(await page.evaluate(() => localStorage.getItem("onevio.theme")) === "auto", "dark -> auto");
    assert(await darkIs(page, false), "auto on a light device is light");
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
    await ready(page);
    // light is the headless default, so go dark first: each step is then a real live change
    await page.emulateMedia({ colorScheme: "dark" });
    assert(await darkIs(page, true), "auto must follow the device live (to dark)");
    await page.emulateMedia({ colorScheme: "light" });
    assert(await darkIs(page, false), "auto must follow the device live (back to light)");
    await page.emulateMedia({ colorScheme: "dark" });
    assert(await darkIs(page, true), "dark again before switching in Settings");
    await page.click('button[title="Settings"]');
    await page.click('[data-theme-choice="light"]');
    assert(await darkIs(page, false), "Settings: Light");
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

test("another tab clearing storage (key null) resets to auto", async () => {
  const { page, browser } = await launchStored("dark");
  try {
    await ready(page);
    assert(await isDark(page), "starts dark");
    await page.evaluate(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null })); });
    assert(await darkIs(page, false), "cleared -> auto -> light device -> light");
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
    assert(await darkIs(page, false), "toggle still works without storage");
  } finally { await browser.close(); }
});

// WCAG relative-luminance contrast of each pair the app actually renders, read from computed
// styles in dark mode. Badge pairs are the likeliest misses. (Every text shade and every
// co-occurring bg/text pair in src/ was screened; these are the representative and tightest ones.)
const PAIRS = [
  ["body text on page", "text-slate-700", "page"], ["muted text on card", "text-slate-500", "white"],
  ["faint text on card", "text-slate-400", "white"],
  ["heading on card", "text-slate-900", "white"], ["link on card", "text-indigo-600", "white"],
  ["red badge", "text-rose-700", "rose-100"], ["amber badge", "text-amber-700", "amber-100"],
  ["green badge", "text-emerald-700", "emerald-100"], ["sky badge", "text-sky-700", "sky-100"],
  ["indigo chip", "text-indigo-700", "indigo-50"], ["primary button", "text-white", "indigo-600"],
  ["danger button", "text-white", "rose-500"], ["low win-rate chip", "text-rose-600", "rose-100"],
  ["risk number", "text-rose-600", "white"], ["declined-from/to Red text", "text-rose-600", "white"], ["declined Yellow text", "text-amber-600", "white"], ["declined Green text", "text-emerald-600", "white"], ["warning number", "text-amber-600", "white"],
  ["good number", "text-emerald-600", "white"], ["remove-step cross", "text-rose-400", "white"],
];
test("dark: every text/background pair the app uses meets WCAG AA (4.5:1)", async () => {
  const { page, browser } = await launchStored("dark");
  try {
    await ready(page);
    const res = await page.evaluate(pairs => {
      const rgb = s => s.match(/\d+/g).slice(0, 3).map(Number);
      const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const probe = cls => { const e = document.createElement("span"); e.className = cls; document.body.appendChild(e); const s = getComputedStyle(e); const out = { c: s.color, b: s.backgroundColor }; e.remove(); return out; };
      const bgOf = name => name === "page" ? getComputedStyle(document.body).backgroundColor : probe("bg-" + name).b;
      return pairs.map(([label, fg, bgName]) => {
        const c = probe(fg).c, b = bgOf(bgName);
        const a = lum(rgb(c)), bl = lum(rgb(b));
        return { label, c, b, ratio: Math.round(((Math.max(a, bl) + 0.05) / (Math.min(a, bl) + 0.05)) * 100) / 100 };
      });
    }, PAIRS);
    console.log("    " + res.map(r => `${r.label} ${r.ratio}`).join(" | "));
    // a purged class probes as the inherited body colour / transparent fill: that is not a pass
    const purged = res.filter(r => r.b === "rgba(0, 0, 0, 0)");
    assert(purged.length === 0, "purged background class: " + JSON.stringify(purged));
    const bad = res.filter(r => r.ratio < 4.5);
    assert(bad.length === 0, "below 4.5:1: " + JSON.stringify(bad));
  } finally { await browser.close(); }
});
