import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { scored, bookSeed } from "./money-fixture.mjs";

const seed = bookSeed([scored({ id: "a1", name: "Alpha Corp", arr: 100000 })]);

// Opens Settings and clicks the destructive "Clear all data" button, which is wired to a
// ConfirmDialog with typedWord="DELETE".
const openClearAll = async page => {
  await page.click('button[title="Settings"]');
  await page.getByText("Clear all data").first().click();
};

test("the confirm dialog is a labelled modal and traps focus", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  await openClearAll(page);
  const r = await page.evaluate(() => {
    const d = document.querySelector("[data-confirmdialog]");
    return { modal: d?.getAttribute("aria-modal"), label: d?.getAttribute("aria-label"),
      hasFocus: d?.contains(document.activeElement) };
  });
  assert(r.modal === "true", `dialog should be aria-modal, got ${r.modal}`);
  assert(r.label && r.label.length > 0, `dialog should carry an aria-label, got ${r.label}`);
  assert(r.hasFocus, "focus should move into the dialog on open");
  await browser.close();
});

test("the typed-confirmation button stays disabled until the word matches exactly", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  await openClearAll(page);
  const dis = () => page.evaluate(() => document.querySelector("[data-confirm-go]").disabled);
  assert(await dis() === true, "confirm should start disabled");
  await page.fill("[data-confirmdialog] input", "delete");
  assert(await dis() === true, "lowercase 'delete' must not enable the confirm button");
  await page.fill("[data-confirmdialog] input", "DELETE");
  assert(await dis() === false, "exact 'DELETE' should enable the confirm button");
  await page.fill("[data-confirmdialog] input", "");
  assert(await dis() === true, "clearing the field should re-disable the confirm button");
  await browser.close();
});

test("cancelling the confirm dialog writes nothing", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  const before = await page.evaluate(() => window.__store.getState().accounts.length);
  await openClearAll(page);
  await page.getByText("Cancel").first().click();
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  const after = await page.evaluate(() => ({
    n: window.__store.getState().accounts.length,
    open: !!document.querySelector("[data-confirmdialog]"),
  }));
  assert(after.n === before, `cancel must not change data: ${before} -> ${after.n}`);
  assert(!after.open, "cancel should close the dialog");
  await browser.close();
});

test("Escape closes the confirm dialog", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  await openClearAll(page);
  // Assert it is OPEN first. Without this the test passes vacuously whenever the dialog
  // fails to open at all — querySelector returns null and "not open" is trivially true.
  const opened = await page.evaluate(() => !!document.querySelector("[data-confirmdialog]"));
  assert(opened, "the dialog should be open before Escape is pressed");
  await page.keyboard.press("Escape");
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  const open = await page.evaluate(() => !!document.querySelector("[data-confirmdialog]"));
  assert(!open, "Escape should close the dialog");
  await browser.close();
});
