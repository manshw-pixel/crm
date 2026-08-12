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

const P = seedAccount({ id: "p1", name: "Parent" });
const S = seedAccount({ id: "s1", name: "Sub", parentId: "p1" });
const cascadeSeed = `window.__seedRows = {
  accounts: ${JSON.stringify([P, S])}.map(d => ({ id: d.id, data: d })),
  contacts: [{ id: "c1", data: { id: "c1", accountId: "p1", name: "Ann" } },
    { id: "c2", data: { id: "c2", accountId: "s1", name: "Bea" } }],
  activities: [{ id: "v1", data: { id: "v1", accountId: "p1", date: "2026-07-01", type: "call", summary: "hi" } }],
  tasks: [{ id: "k1", data: { id: "k1", accountId: "p1", title: "T", status: "Open", due: "2026-09-01" } },
    { id: "k2", data: { id: "k2", accountId: "s1", title: "T2", status: "Open", due: "2026-09-02" } }],
  opportunities: [{ id: "o1", data: { id: "o1", accountId: "p1", stage: "Open", amount: 10 } }],
  team: [], settings: [] };`;

test("BULK_CHURN churns every account with a shared reason and an audit entry", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const res = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_CHURN", ids: ["a1", "a2"], reason: "Price", note: "batch", date: "2026-08-12", by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().accounts.map(a => ({
      status: a.contractStatus, reason: a.churn && a.churn.reason, date: a.churn && a.churn.date,
      audit: (a.audit || []).map(e => [e.field, e.to, e.source]) }));
  });
  assert(res.every(a => a.status === "Churned"), "not all churned");
  assert(res.every(a => a.reason === "Price"), "shared reason not written");
  assert(res.every(a => a.date === "2026-08-12"), "churn date wrong");
  assert(res.every(a => a.audit.length === 1 && a.audit[0][0] === "contractStatus" && a.audit[0][1] === "Churned"), "audit entry missing");
  await browser.close();
});

test("BULK_DELETE removes accounts and cascades to all four collections", async () => {
  const { page, browser } = await launch(cascadeSeed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const after = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_DELETE", ids: ["p1"] });
    await new Promise(r => setTimeout(r, 50));
    const s = window.__store.getState();
    return { accounts: s.accounts.map(a => a.id), subParent: s.accounts.find(a => a.id === "s1").parentId,
      contacts: s.contacts.map(c => c.id), activities: s.activities.length, tasks: s.tasks.map(t => t.id), opps: s.opportunities.length };
  });
  assert(after.accounts.length === 1 && after.accounts[0] === "s1", `expected only the sub to survive, got ${JSON.stringify(after.accounts)}`);
  assert(after.subParent === null, "sub should be orphaned (parentId null)");
  assert(after.activities === 0 && after.opps === 0, "cascade incomplete for p1-only collections");
  assert(after.contacts.length === 1 && after.contacts[0] === "c2", `p1's contact should be gone, s1's should survive: ${JSON.stringify(after.contacts)}`);
  assert(after.tasks.length === 1 && after.tasks[0] === "k2", `p1's task should be gone, s1's should survive: ${JSON.stringify(after.tasks)}`);
  await browser.close();
});

test("RESTORE_SNAPSHOT undoes a bulk delete including cascades and sub parentId", async () => {
  const { page, browser } = await launch(cascadeSeed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const after = await page.evaluate(async () => {
    const snap = window.__snapshotFor(window.__store.getState(), ["p1"]);
    window.__store.dispatch({ type: "BULK_DELETE", ids: ["p1"] });
    await new Promise(r => setTimeout(r, 50));
    window.__store.dispatch({ type: "RESTORE_SNAPSHOT", snapshot: snap });
    await new Promise(r => setTimeout(r, 50));
    const s = window.__store.getState();
    return { accounts: s.accounts.map(a => a.id).sort(), subParent: s.accounts.find(a => a.id === "s1").parentId,
      contacts: s.contacts.map(c => c.id).sort(), activities: s.activities.length, tasks: s.tasks.map(t => t.id).sort(), opps: s.opportunities.length };
  });
  assert(after.accounts.join() === "p1,s1", `accounts not restored: ${JSON.stringify(after.accounts)}`);
  assert(after.subParent === "p1", `sub parentId not restored, got ${after.subParent}`);
  assert(after.activities === 1 && after.opps === 1, "cascaded p1-only rows not restored");
  assert(after.contacts.join() === "c1,c2", `p1's contact not restored (s1's should have survived throughout): ${JSON.stringify(after.contacts)}`);
  assert(after.tasks.join() === "k1,k2", `p1's task not restored (s1's should have survived throughout): ${JSON.stringify(after.tasks)}`);
  await browser.close();
});

test("RESTORE_SNAPSHOT undoes a bulk churn back to Active", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const after = await page.evaluate(async () => {
    const snap = window.__snapshotFor(window.__store.getState(), ["a1", "a2"]);
    window.__store.dispatch({ type: "BULK_CHURN", ids: ["a1", "a2"], reason: "Price", note: "", date: "2026-08-12", by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    window.__store.dispatch({ type: "RESTORE_SNAPSHOT", snapshot: snap });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().accounts.map(a => ({ s: a.contractStatus, churn: a.churn, audit: (a.audit || []).length }));
  });
  assert(after.every(a => a.s === "Active"), "status not restored");
  assert(after.every(a => !a.churn), "churn entry not cleared");
  assert(after.every(a => a.audit === 0), "audit entries should be rolled back with the snapshot");
  await browser.close();
});
