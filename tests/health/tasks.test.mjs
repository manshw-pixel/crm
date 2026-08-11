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
