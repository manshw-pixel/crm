import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "a1", name: "Alpha", csm: "Priya", tier: "Mid" });
const B = seedAccount({ id: "a2", name: "Beta", csm: "Priya", tier: "SMB" });
export const seed = `window.__seedRows = { accounts: ${JSON.stringify([A, B])}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("BULK_PATCH_ACCOUNTS reassigns CSM and writes one audit entry each", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const res = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_PATCH_ACCOUNTS", ids: ["a1", "a2"], patch: { csm: "Dana" }, by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    const s = window.__store.getState();
    return s.accounts.map(a => ({ id: a.id, csm: a.csm, audit: (a.audit || []).map(e => [e.field, e.from, e.to, e.source]) }));
  });
  assert(res.every(a => a.csm === "Dana"), "csm not reassigned on both");
  assert(res.every(a => a.audit.length === 1), "expected exactly one audit entry per account");
  assert(res[0].audit[0][0] === "csm" && res[0].audit[0][1] === "Priya" && res[0].audit[0][2] === "Dana", "audit from/to wrong");
  assert(res[0].audit[0][3] === "bulk", "audit source should be 'bulk'");
  await browser.close();
});

test("BULK_PATCH_ACCOUNTS writes no audit entry when the value is unchanged", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const audits = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_PATCH_ACCOUNTS", ids: ["a1"], patch: { csm: "Priya" }, by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    return (window.__store.getState().accounts.find(a => a.id === "a1").audit || []).length;
  });
  assert(audits === 0, `expected no audit entry for a no-op change, got ${audits}`);
  await browser.close();
});

test("BULK_PATCH_ACCOUNTS ignores ids that do not exist", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const n = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_PATCH_ACCOUNTS", ids: ["a1", "nope"], patch: { tier: "Enterprise" }, by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().accounts.length;
  });
  assert(n === 2, `account count changed, got ${n}`);
  await browser.close();
});

test("BULK_ADD_TASKS appends one task per account", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const tasks = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_ADD_TASKS", items: [
      { id: "bt1", accountId: "a1", title: "Check in", due: "2026-09-01", owner: "Dana", status: "Open" },
      { id: "bt2", accountId: "a2", title: "Check in", due: "2026-09-01", owner: "Dana", status: "Open" },
    ] });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().tasks.map(t => t.id);
  });
  assert(tasks.length === 2 && tasks.includes("bt1") && tasks.includes("bt2"), `tasks not appended: ${JSON.stringify(tasks)}`);
  await browser.close();
});
