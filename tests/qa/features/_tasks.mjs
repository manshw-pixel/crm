// Shared helpers for the Tasks work queue (TasksView, src/22-tasks.jsx). Not a feature:
// `scenarios` is empty so run.mjs can load it.
import { nav } from "./_users-card.mjs";
export const scenarios = [];

// Bucket sections are <section data-task-section> with a header button[aria-expanded];
// collapsed ones hide their rows.
export async function openAllTaskSections(page) {
  await settled(page);
  for (let i = 0; i < 6; i++) {
    const closed = page.locator('[data-task-section] > button[aria-expanded="false"]');
    if (!await closed.count()) return;
    await closed.first().click();
  }
}

// Waits until the [data-tasks-subtitle] counts and the row count read the same twice, 250ms
// apart, so a filter/search change has re-rendered before rows are read.
async function settled(page, timeoutMs = 10000) {
  const read = () => page.evaluate(() => `${document.querySelector("[data-tasks-subtitle]")?.textContent}|${document.querySelectorAll("[data-task-row]").length}`);
  const until = Date.now() + timeoutMs;
  let prev = await read();
  while (Date.now() < until) {
    await page.waitForTimeout(250);
    const cur = await read();
    if (cur === prev && !cur.startsWith("undefined")) return;
    prev = cur;
  }
  throw new Error("Tasks view did not settle");
}

// Every rendered task row: title, account, source mark, done styling, and its bucket label.
export const taskTitles = page => page.evaluate(() =>
  [...document.querySelectorAll("[data-task-row]")].map(r => {
    const title = r.querySelector("[data-task-title]");
    const section = r.closest("[data-task-section]")?.getAttribute("aria-label") || "";
    return { title: title.textContent.trim(), account: r.querySelector("[data-task-account]")?.textContent.trim(),
      health: r.querySelector('[aria-label="Health playbook step"]') !== null,
      done: title.className.includes("line-through"), checked: r.querySelector('input[type="checkbox"]').checked, section };
  }));

// Tasks view with scope ("Mine"/"All") and search applied, all buckets open.
export async function openTasks(page, { scope = "All", q = "" } = {}) {
  await nav(page, "Tasks").click();
  await page.getByRole("button", { name: scope, exact: true }).click();
  await page.getByPlaceholder("Search tasks…").fill(q);
  await openAllTaskSections(page);
  await settled(page);
}
