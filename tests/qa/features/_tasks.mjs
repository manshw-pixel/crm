// Shared helpers for the Tasks work queue (TasksView, src/22-tasks.jsx). Not a feature:
// `scenarios` is empty so run.mjs can load it.
import { nav } from "./_users-card.mjs";
export const scenarios = [];

// Bucket headers are buttons "Label (n) ▸|▾"; collapsed ones (▸) hide their rows (:78-85).
export async function openAllTaskSections(page) {
  await page.waitForTimeout(300); // let the filter re-render settle
  for (let i = 0; i < 6; i++) {
    const closed = page.locator("button").filter({ hasText: /\(\d+\)\s*▸$/ });
    if (!await closed.count()) return;
    await closed.first().click();
  }
}

// Every rendered task row: title, account, source mark, done styling, and its bucket label.
export const taskTitles = page => page.evaluate(() =>
  [...document.querySelectorAll("[data-task-row]")].map(r => {
    const title = r.querySelector("[data-task-title]");
    const section = r.parentElement?.querySelector(":scope > button span")?.textContent.trim() || "";
    return { title: title.textContent.trim(), account: r.querySelector("button")?.textContent.trim(),
      health: r.querySelector('[aria-label="Health playbook step"]') !== null,
      done: title.className.includes("line-through"), checked: r.querySelector('input[type="checkbox"]').checked, section };
  }));

// Tasks view with scope ("Mine"/"All") and search applied, all buckets open.
export async function openTasks(page, { scope = "All", q = "" } = {}) {
  await nav(page, "Tasks").click();
  await page.getByRole("button", { name: scope, exact: true }).click();
  await page.getByPlaceholder("Search tasks…").fill(q);
  await openAllTaskSections(page);
}
