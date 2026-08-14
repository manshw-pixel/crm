import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { scored, bookSeed } from "./money-fixture.mjs";

const CHURNED = scored({ id: "a1", name: "Alpha Corp", arr: 100000,
  contractStatus: "Churned", churn: { date: "2026-06-01", arr: 100000, reason: "Price", by: "Priya" } });

// AccountList hides churned accounts behind a "show churned" toggle, so a churned fixture
// is invisible until it is checked. Without this the click times out on an empty list.
const openAccount = async (page, name, churned = false) => {
  await page.click('button[title="Accounts"]');
  if (churned) await page.getByText(/show churned/).first().click();
  await page.getByText(name).first().click();
};

test("reactivating an account acts immediately and offers an Undo", async () => {
  const { page, browser } = await launch(bookSeed([CHURNED]));
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
  await openAccount(page, "Alpha Corp", true);
  await page.getByText("Reactivate").first().click();
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  const after = await page.evaluate(() => {
    const a = window.__store.getState().accounts.find(x => x.id === "a1");
    return { status: a.contractStatus, churn: a.churn, undo: !!document.querySelector("[data-toast-undo]") };
  });
  assert(after.status === "Active", `expected Active, got ${after.status}`);
  assert(after.churn === null, `churn should clear, got ${JSON.stringify(after.churn)}`);
  assert(after.undo, "an Undo toast should be offered");
  await browser.close();
});

test("undoing a reactivation puts the account back to churned", async () => {
  const { page, browser } = await launch(bookSeed([CHURNED]));
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
  await openAccount(page, "Alpha Corp", true);
  await page.getByText("Reactivate").first().click();
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  await page.click("[data-toast-undo]");
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  const a = await page.evaluate(() => {
    const x = window.__store.getState().accounts.find(y => y.id === "a1");
    return { status: x.contractStatus, reason: x.churn?.reason };
  });
  assert(a.status === "Churned", `expected Churned after undo, got ${a.status}`);
  assert(a.reason === "Price", `the original churn reason should return, got ${a.reason}`);
  await browser.close();
});

test("deleting an account no longer asks for confirmation and still restores on Undo", async () => {
  const A = scored({ id: "a1", name: "Alpha Corp", arr: 100000 });
  const { page, browser } = await launch(bookSeed([A]));
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
  await openAccount(page, "Alpha Corp");
  // No confirm() dialog: the click alone deletes. If a native confirm were still present,
  // Playwright would auto-dismiss it and the delete would never happen.
  await page.getByText("Delete account").first().click();
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  const gone = await page.evaluate(() => window.__store.getState().accounts.length);
  assert(gone === 0, `the account should be deleted without a confirm, got ${gone} left`);
  await page.click("[data-toast-undo]");
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  const back = await page.evaluate(() => window.__store.getState().accounts.length);
  assert(back === 1, `Undo should restore the account, got ${back}`);
  await browser.close();
});
