import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("error toasts persist and info toasts auto-dismiss", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__toast);
  const res = await page.evaluate(async () => {
    window.__toast({ text: "boom", tone: "error" });
    window.__toast({ text: "hello", tone: "info" });
    await new Promise(r => setTimeout(r, 100));
    const both = document.querySelectorAll("[data-toast]").length;
    await new Promise(r => setTimeout(r, 5400));
    const after = [...document.querySelectorAll("[data-toast]")].map(n => n.getAttribute("data-tone"));
    return { both, after };
  });
  assert(res.both === 2, `expected 2 toasts, got ${res.both}`);
  assert(res.after.length === 1 && res.after[0] === "error", `error toast should survive, got ${JSON.stringify(res.after)}`);
  await browser.close();
});

test("undo toast exposes an Undo button that fires the callback", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__toast);
  const fired = await page.evaluate(async () => {
    window.__undoFired = false;
    window.__toast({ text: "did a thing", tone: "success", undo: () => { window.__undoFired = true; } });
    await new Promise(r => setTimeout(r, 100));
    document.querySelector("[data-toast-undo]").click();
    await new Promise(r => setTimeout(r, 100));
    return { flag: window.__undoFired, gone: document.querySelectorAll("[data-toast]").length };
  });
  assert(fired.flag === true, "undo callback did not fire");
  assert(fired.gone === 0, "toast should dismiss after undo");
  await browser.close();
});

test("error toast is announced assertively", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__toast);
  const role = await page.evaluate(async () => {
    window.__toast({ text: "boom", tone: "error" });
    await new Promise(r => setTimeout(r, 100));
    return document.querySelector("[data-toast]").getAttribute("role");
  });
  assert(role === "alert", `expected role=alert, got ${role}`);
  await browser.close();
});
