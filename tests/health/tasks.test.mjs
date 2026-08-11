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
