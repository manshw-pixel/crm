import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "a1", name: "Alpha", csm: "Priya" });
const B = seedAccount({ id: "a2", name: "Beta", csm: "Dana" });
const seed = `window.__seedRows = { accounts: ${JSON.stringify([A, B])}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [{ id: "u1", data: { name: "Priya" } }, { id: "u2", data: { name: "Dana" } }], settings: [] };`;

test("nav items expose labels and mark the current view", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const res = await page.evaluate(() => {
    const navs = [...document.querySelectorAll("nav button, [data-nav] button")];
    return { count: navs.length, labelled: navs.every(b => b.getAttribute("aria-label")),
      current: navs.filter(b => b.getAttribute("aria-current") === "page").length };
  });
  assert(res.count >= 4, `expected nav buttons, got ${res.count}`);
  assert(res.labelled, "every nav button needs an aria-label");
  assert(res.current === 1, `exactly one nav item should be aria-current, got ${res.current}`);
  await browser.close();
});

test("sortable account columns expose aria-sort", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(() => {
    const ths = [...document.querySelectorAll("thead th[aria-sort]")];
    return { any: ths.length, ascending: ths.filter(t => t.getAttribute("aria-sort") === "ascending").length };
  });
  assert(res.any >= 8, `expected aria-sort on sortable headers, got ${res.any}`);
  assert(res.ascending === 1, `exactly one column should be the active sort, got ${res.ascending}`);
  await browser.close();
});

test("aria-sort follows the active column and direction", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(async () => {
    // `Th` is declared inside AccountList, so every render produces a new component
    // type and React remounts the header cells. A reference captured before a click is
    // detached afterwards and still reports its old attribute -- always re-query.
    const ths = () => [...document.querySelectorAll("thead th[aria-sort]")];
    const idx = ths().findIndex(t => t.textContent.trim().startsWith("CSM"));
    ths()[idx].click();
    await new Promise(r => setTimeout(r, 150));
    const asc = ths()[idx].getAttribute("aria-sort");
    ths()[idx].click();
    await new Promise(r => setTimeout(r, 150));
    const desc = ths()[idx].getAttribute("aria-sort");
    const others = ths().filter((_, i) => i !== idx);
    return { idx, asc, desc, othersNone: others.every(t => t.getAttribute("aria-sort") === "none") };
  });
  assert(res.idx >= 0, "could not find the CSM column header");
  assert(res.asc === "ascending", `first click should sort ascending, got ${res.asc}`);
  assert(res.desc === "descending", `second click should reverse, got ${res.desc}`);
  assert(res.othersNone, "inactive columns should report aria-sort=none");
  await browser.close();
});

test("the command palette is a labelled modal dialog", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("Control+k");
  await page.waitForSelector('[role="dialog"]');
  const res = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return { modal: d.getAttribute("aria-modal"), label: d.getAttribute("aria-label") };
  });
  assert(res.modal === "true", "palette should be aria-modal");
  assert(!!res.label, "palette needs an aria-label");
  await browser.close();
});

test("every icon-only button carries an accessible name", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const bare = await page.evaluate(() => {
    // a button whose visible text is only a glyph is unreadable to a screen reader
    // unless it has an aria-label or a title
    const glyphOnly = /^[\s✕▲▼×·—–]*$/;
    return [...document.querySelectorAll("button")]
      .filter(b => glyphOnly.test(b.textContent || ""))
      .filter(b => !b.getAttribute("aria-label") && !b.getAttribute("title"))
      .map(b => b.outerHTML.slice(0, 120));
  });
  assert(bare.length === 0, `icon-only buttons without an accessible name:\n${bare.join("\n")}`);
  await browser.close();
});

// ROUTED FROM TASK 5: autofocus was wired only for the `task` and `delete` dialog
// kinds, because the ref was attached only to those two inputs. `csm` and `tier` open
// with focus left on the body, so a keyboard user lands nowhere.
test("every bulk dialog kind moves focus into the dialog on open", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(async () => {
    const out = {};
    for (const label of ["Reassign CSM", "Change tier", "Add task", "Churn", "Delete"]) {
      document.querySelector("[data-select-all]").click();
      await new Promise(r => setTimeout(r, 100));
      const btn = [...document.querySelectorAll("[data-bulkbar] button")].find(b => b.textContent === label);
      if (!btn) { out[label] = "NO BUTTON"; continue; }
      btn.click();
      await new Promise(r => setTimeout(r, 150));
      const dlg = document.querySelector("[data-bulkdialog]");
      out[label] = dlg && dlg.contains(document.activeElement) ? "inside" : "outside";
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
    }
    return out;
  });
  const bad = Object.entries(res).filter(([, v]) => v !== "inside");
  assert(bad.length === 0, `focus should start inside the dialog for every kind: ${JSON.stringify(res)}`);
  await browser.close();
});

// ROUTED FROM TASK 5: the dialog had no focus trap, so Tab walked out into the account
// table behind the overlay while the modal was still up.
test("Tab is trapped inside the bulk dialog", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  await page.evaluate(async () => {
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    [...document.querySelectorAll("[data-bulkbar] button")].find(b => b.textContent === "Delete").click();
    await new Promise(r => setTimeout(r, 150));
  });
  // walk forward past the end of the dialog's focusable set, then backward past the start
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  const afterFwd = await page.evaluate(() => document.querySelector("[data-bulkdialog]").contains(document.activeElement));
  for (let i = 0; i < 14; i++) await page.keyboard.press("Shift+Tab");
  const afterBack = await page.evaluate(() => document.querySelector("[data-bulkdialog]").contains(document.activeElement));
  assert(afterFwd, "Tab cycling should stay inside the dialog");
  assert(afterBack, "Shift+Tab cycling should stay inside the dialog");
  await browser.close();
});

// Written as a sweep rather than five assertions so a newly added select cannot
// regress it, matching the icon-only-button sweep above.
test("every select in the account list has an accessible name", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const bare = await page.evaluate(() => [...document.querySelectorAll("select")]
    .filter(s => !s.getAttribute("aria-label") && !s.getAttribute("aria-labelledby") && !s.closest("label"))
    .map(s => s.outerHTML.slice(0, 100)));
  assert(bare.length === 0, `selects without an accessible name:\n${bare.join("\n")}`);
  await browser.close();
});
