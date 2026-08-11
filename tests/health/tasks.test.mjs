import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

export const TODAY = "2026-08-11";
const mkTask = (o = {}) => ({
  id: o.id || "t" + Math.random().toString(36).slice(2, 7), accountId: o.accountId || "a1",
  title: o.title || "Some task", due: o.due, priority: o.priority || "Medium",
  status: o.status || "Open", owner: o.owner || "Priya", ...o,
});

// Boot the app once just to reach the pure helpers on window.__health.
export const bootHelpers = async () => {
  const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
  const h = await launch(seed);
  await h.page.waitForFunction(() => window.__health && window.__health.bucketTasks);
  return h;
};

test("bucketTasks splits on the day boundaries", async () => {
  const { page, browser } = await bootHelpers();
  const r = await page.evaluate(t => {
    const b = window.__health.bucketTasks(t.tasks, t.today);
    return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.map(x => x.id)]));
  }, { today: TODAY, tasks: [
    mkTask({ id: "yesterday", due: "2026-08-10" }), mkTask({ id: "today", due: "2026-08-11" }),
    mkTask({ id: "tomorrow", due: "2026-08-12" }), mkTask({ id: "day7", due: "2026-08-18" }),
    mkTask({ id: "day8", due: "2026-08-19" }),
  ] });
  assert(r.overdue.join() === "yesterday", "overdue wrong: " + r.overdue);
  assert(r.today.join() === "today", "today wrong: " + r.today);
  assert(r.week.join() === "tomorrow,day7", "week wrong: " + r.week);
  assert(r.later.join() === "day8", "later wrong: " + r.later);
  await browser.close();
});

test("bucketTasks puts Done tasks in done regardless of due date", async () => {
  const { page, browser } = await bootHelpers();
  const r = await page.evaluate(t => {
    const b = window.__health.bucketTasks(t.tasks, t.today);
    return { done: b.done.map(x => x.id), overdue: b.overdue.map(x => x.id) };
  }, { today: TODAY, tasks: [
    mkTask({ id: "d1", due: "2026-07-01", status: "Done" }), mkTask({ id: "o1", due: "2026-07-01" }),
  ] });
  assert(r.done.join() === "d1", "done wrong: " + r.done);
  assert(r.overdue.join() === "o1", "a Done task must not appear in overdue: " + r.overdue);
  await browser.close();
});

test("bucketTasks sorts by due date then priority", async () => {
  const { page, browser } = await bootHelpers();
  const r = await page.evaluate(t => window.__health.bucketTasks(t.tasks, t.today).week.map(x => x.id),
    { today: TODAY, tasks: [
      mkTask({ id: "later-high", due: "2026-08-14", priority: "High" }),
      mkTask({ id: "soon-low", due: "2026-08-12", priority: "Low" }),
      mkTask({ id: "soon-high", due: "2026-08-12", priority: "High" }),
      mkTask({ id: "soon-med", due: "2026-08-12", priority: "Medium" }),
    ] });
  assert(r.join() === "soon-high,soon-med,soon-low,later-high", "sort wrong: " + r.join());
  await browser.close();
});

const ACCTS = { a1: { id: "a1", name: "Northwind Analytics", risk: "Red" },
                a2: { id: "a2", name: "Bluepeak Logistics", risk: "Green" } };
const FTASKS = [
  { id: "h1", accountId: "a1", title: "♥ Escalate", owner: "Priya", healthPlaybook: true },
  { id: "r1", accountId: "a1", title: "▶ Send quote", owner: "Marco", playbook: true },
  { id: "m1", accountId: "a2", title: "Call champion", owner: "Priya" },
];
const ids = arr => arr.map(x => x.id).join();

test("filterTasks scope keeps only the user's tasks when mine", async () => {
  const { page, browser } = await bootHelpers();
  const r = await page.evaluate(a => ({
    mine: window.__health.filterTasks(a.tasks, a.accts, { scope: "mine", userName: "Priya" }).map(x => x.id).join(),
    all: window.__health.filterTasks(a.tasks, a.accts, { scope: "all", userName: "Priya" }).map(x => x.id).join(),
  }), { tasks: FTASKS, accts: ACCTS });
  assert(r.mine === "h1,m1", "mine wrong: " + r.mine);
  assert(r.all === "h1,r1,m1", "all wrong: " + r.all);
  await browser.close();
});

test("filterTasks source splits health, renewal and manual", async () => {
  const { page, browser } = await bootHelpers();
  const r = await page.evaluate(a => ({
    health: window.__health.filterTasks(a.tasks, a.accts, { source: "health" }).map(x => x.id).join(),
    renewal: window.__health.filterTasks(a.tasks, a.accts, { source: "renewal" }).map(x => x.id).join(),
    manual: window.__health.filterTasks(a.tasks, a.accts, { source: "manual" }).map(x => x.id).join(),
  }), { tasks: FTASKS, accts: ACCTS });
  assert(r.health === "h1", "health wrong: " + r.health);
  assert(r.renewal === "r1", "renewal wrong: " + r.renewal);
  assert(r.manual === "m1", "manual wrong: " + r.manual);
  await browser.close();
});

test("filterTasks band matches the task's account risk", async () => {
  const { page, browser } = await bootHelpers();
  const r = await page.evaluate(a => window.__health.filterTasks(a.tasks, a.accts, { band: "Red" }).map(x => x.id).join(),
    { tasks: FTASKS, accts: ACCTS });
  assert(r === "h1,r1", "band wrong: " + r);
  await browser.close();
});

test("filterTasks q matches task title and account name", async () => {
  const { page, browser } = await bootHelpers();
  const r = await page.evaluate(a => ({
    byTitle: window.__health.filterTasks(a.tasks, a.accts, { q: "escal" }).map(x => x.id).join(),
    byAccount: window.__health.filterTasks(a.tasks, a.accts, { q: "bluepeak" }).map(x => x.id).join(),
    none: window.__health.filterTasks(a.tasks, a.accts, { q: "zzzz" }).length,
  }), { tasks: FTASKS, accts: ACCTS });
  assert(r.byTitle === "h1", "title search wrong: " + r.byTitle);
  assert(r.byAccount === "m1", "account-name search wrong: " + r.byAccount);
  assert(r.none === 0, "unmatched query should return nothing, got " + r.none);
  await browser.close();
});

// A book with tasks spread across every bucket. Dates are relative so the test never ages out.
const rel = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
export const QUEUE_SEED = () => {
  const accts = [
    seedAccount({ id: "a1", name: "Northwind Analytics", csm: "Priya", inputs: { usage: 15, sentiment: 15, tickets: 20, nps: -80 }, healthBand: "Red", healthPlaybookBand: "Red" }),
    seedAccount({ id: "a2", name: "Bluepeak Logistics", csm: "Marco", inputs: { usage: 90, sentiment: 90, tickets: 0, nps: 60 }, healthBand: "Green" }),
  ];
  const tasks = [
    { id: "q-over", accountId: "a1", title: "Escalate to exec", due: rel(-4), priority: "High", status: "Open", owner: "Priya", healthPlaybook: true },
    { id: "q-today", accountId: "a1", title: "Call the champion", due: rel(0), priority: "High", status: "Open", owner: "Priya" },
    { id: "q-week", accountId: "a2", title: "Send renewal quote", due: rel(3), priority: "Medium", status: "Open", owner: "Marco", playbook: true },
    { id: "q-later", accountId: "a2", title: "Plan expansion", due: rel(20), priority: "Low", status: "Open", owner: "Priya" },
    { id: "q-done", accountId: "a1", title: "Old finished thing", due: rel(-9), priority: "Low", status: "Done", owner: "Priya" },
  ];
  return `window.__seedRows = { accounts: ${JSON.stringify(accts)}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: ${JSON.stringify(tasks)}.map(d => ({ id: d.id, data: d })), opportunities: [], team: [], settings: [] };
window.__seedProfile = { id: "u1", name: "Priya", role: "admin" };`;
};
export const openTasks = async page => {
  await page.getByRole("button", { name: "Tasks" }).first().click();
  await page.waitForFunction(() => /Overdue/.test(document.querySelector("#root")?.textContent || ""));
};

test("Tasks view groups tasks into due-date sections with counts", async () => {
  const { page, browser } = await launch(QUEUE_SEED());
  await page.waitForFunction(() => window.__store && window.__store.getState().tasks.length);
  await openTasks(page);
  const txt = await rootText(page);
  // Scope defaults to All for admins, so every seeded task is in view.
  assert(/Overdue\s*\(1\)/.test(txt), "overdue count missing: " + txt.slice(0, 500));
  assert(/Escalate to exec/.test(txt), "overdue task not rendered");
  assert(/Call the champion/.test(txt), "today task not rendered");
  assert(/Northwind Analytics/.test(txt), "account name not rendered on the row");
  await browser.close();
});

test("Tasks view shows a distinct empty state when filters match nothing", async () => {
  const { page, browser } = await launch(QUEUE_SEED());
  await page.waitForFunction(() => window.__store && window.__store.getState().tasks.length);
  await openTasks(page);
  await page.getByPlaceholder("Search tasks…").fill("zzzznotathing");
  await page.waitForFunction(() => /No tasks match/.test(document.querySelector("#root")?.textContent || ""));
  const txt = await rootText(page);
  assert(/No tasks match these filters/.test(txt), "filtered empty state missing: " + txt.slice(0, 400));
  assert(!/Nothing in the queue/.test(txt), "should not show the no-tasks-at-all state when tasks exist");
  await browser.close();
});

test("ticking a task completes it and moves it to Done", async () => {
  const { page, browser } = await launch(QUEUE_SEED());
  await page.waitForFunction(() => window.__store && window.__store.getState().tasks.length);
  await openTasks(page);
  await page.locator('input[type="checkbox"]').first().click();
  await page.waitForFunction(() => window.__store.getState().tasks.find(t => t.id === "q-over").status === "Done");
  const status = await page.evaluate(() => window.__store.getState().tasks.find(t => t.id === "q-over").status);
  assert(status === "Done", "task should be Done, got " + status);
  const overdueGone = await page.evaluate(() => !/Escalate to exec/.test(document.querySelector("#root")?.textContent || ""));
  assert(overdueGone, "completed task should leave the Overdue section");
  await browser.close();
});

test("rescheduling an overdue task moves it out of Overdue", async () => {
  const { page, browser } = await launch(QUEUE_SEED());
  await page.waitForFunction(() => window.__store && window.__store.getState().tasks.length);
  await openTasks(page);
  const before = await page.evaluate(() => window.__store.getState().tasks.find(t => t.id === "q-over").due);
  await page.locator('select[title="Reschedule"]').first().selectOption("7");
  await page.waitForFunction(d => window.__store.getState().tasks.find(t => t.id === "q-over").due !== d, before);
  const after = await page.evaluate(() => window.__store.getState().tasks.find(t => t.id === "q-over").due);
  const expected = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  assert(after === expected, `expected due ${expected}, got ${after}`);
  await browser.close();
});

test("the source filter hides health-playbook tasks when set to renewal", async () => {
  const { page, browser } = await launch(QUEUE_SEED());
  await page.waitForFunction(() => window.__store && window.__store.getState().tasks.length);
  await openTasks(page);
  assert(/Escalate to exec/.test(await rootText(page)), "health task should be visible before filtering");
  await page.locator('select[title="Source"]').selectOption("renewal");
  await page.waitForFunction(() => !/Escalate to exec/.test(document.querySelector("#root")?.textContent || ""));
  await page.getByRole("button", { name: /This week/ }).click();
  await page.waitForFunction(() => /Send renewal quote/.test(document.querySelector("#root")?.textContent || ""));
  const txt = await rootText(page);
  assert(!/Escalate to exec/.test(txt), "health task should be hidden under the renewal filter");
  assert(/Send renewal quote/.test(txt), "renewal task should still be visible");
  await browser.close();
});
