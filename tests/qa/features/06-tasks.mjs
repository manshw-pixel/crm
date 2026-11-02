import assert from "node:assert/strict";
import { waitForSaved } from "../reset.mjs";
import { SkipScenario } from "../core.mjs";
import { openAccount } from "./_accounts.mjs";
import { nav } from "./_users-card.mjs";
import { openTasks, taskTitles } from "./_tasks.mjs";
import { isoPlus } from "./_accounts.mjs";

const F = "06-tasks";
const ACCT = runId => `QA ${runId} Birch Labs`; // CSM-owned fixture row

// "+ Add task" on the account page (AddTaskForm, src/13-forms.jsx:162-197). The form has two
// <select>s, priority then owner, so the owner is select #2. The owner list is checked before
// anything is typed, so a missing owner skips with no UI write.
async function addTask(page, acct, title, owner, { due, priority } = {}) {
  await openAccount(page, acct);
  await page.getByRole("button", { name: "+ Add task" }).click();
  const form = page.locator("form").filter({ has: page.getByPlaceholder("Task title…") });
  const sel = form.locator("select").nth(1);
  const opts = await sel.locator("option").allTextContents();
  if (!opts.includes(owner)) throw new SkipScenario(`task owner "${owner}" is not offered in the owner list (${opts.join(", ")})`);
  await form.getByPlaceholder("Task title…").fill(title);
  if (due) await form.locator('input[type="date"]').fill(due);
  if (priority) await form.locator("select").nth(0).selectOption(priority);
  await sel.selectOption(owner);
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await waitForSaved(page);
}

export const scenarios = [
  { id: `${F}/create-assign-complete`, feature: F, title: "Create a task assigned to the CSM; it lists; completing moves it to Done", role: "admin",
    run: async ({ page, runId, thisRunId, csmName }) => {
      const title = `QA ${thisRunId} call ${Date.now() % 100000}`;
      await addTask(page, ACCT(runId), title, csmName);
      await openTasks(page, { q: title });
      let rows = (await taskTitles(page)).filter(r => r.title === title);
      assert.equal(rows.length, 1, "new task not listed exactly once");
      assert.notEqual(rows[0].section, "Done", "new task is already in Done");
      assert.equal(rows[0].account, ACCT(runId), "task's account");
      await page.locator("[data-task-row]").filter({ hasText: title }).getByTitle("Complete").click(); // the row re-mounts under Done, so check() cannot confirm
      await waitForSaved(page);
      await page.reload();
      await nav(page, "Tasks").waitFor({ timeout: 20000 });
      await openTasks(page, { q: title });
      rows = (await taskTitles(page)).filter(r => r.title === title);
      assert.equal(rows.length, 1, "completed task not listed after reload");
      assert.equal(rows[0].section, "Done", "completed task is not in the Done bucket");
      assert.ok(rows[0].done && rows[0].checked, "completed task not shown as done");
    } },

  // Stage 6 sections + tags: an overdue High task lands in the expanded Overdue section with a red
  // "Overdue · Nd" due pill and a High priority tag; on a plain visit Today is open, This week closed.
  { id: `${F}/sections-and-tags`, feature: F, title: "Overdue High task shows in the open Overdue section with Overdue · Nd and High tags", role: "admin",
    run: async ({ page, runId, thisRunId, adminName }) => {
      if (!adminName) throw new SkipScenario("admin display name unknown");
      const title = `QA ${thisRunId} overdue ${Date.now() % 100000}`;
      await addTask(page, ACCT(runId), title, adminName, { due: isoPlus(-5), priority: "High" });
      await nav(page, "Tasks").click(); // plain visit: default open state
      await page.locator("[data-tasks-subtitle]").waitFor({ timeout: 15000 });
      const ov = page.locator('[data-task-section="overdue"]');
      await ov.waitFor({ timeout: 15000 });
      assert.equal(await ov.locator("> h2 > button").getAttribute("aria-expanded"), "true", "Overdue section is not expanded");
      for (const [key, want] of [["today", "true"], ["week", "false"]]) {
        const head = page.locator(`[data-task-section="${key}"] > h2 > button`);
        if (await head.count()) assert.equal(await head.getAttribute("aria-expanded"), want, `${key} section aria-expanded`);
      }
      const row = ov.locator("[data-task-row]").filter({ hasText: title });
      await row.waitFor({ timeout: 15000 });
      const due = row.locator("[data-task-due]");
      const dueText = (await due.textContent()).trim();
      assert.match(dueText, /^Overdue · \d+d$/, "due pill text");
      assert.equal(await due.getAttribute("data-sev"), "red", "due pill severity");
      const n = +dueText.match(/(\d+)d$/)[1];
      assert.ok(n >= 4 && n <= 6, `overdue days ${n} (task due 5 days ago)`);
      const pri = row.locator("[data-task-priority]");
      assert.equal((await pri.textContent()).trim(), "High", "priority tag");
      assert.equal(await pri.getAttribute("data-sev"), "red", "priority severity");
      assert.equal(await row.locator("[data-task-source]").count(), 0, "a hand-added task carries no source tag");
      await row.getByTitle("Complete").click(); // tidy: don't leave an overdue run task behind
      await waitForSaved(page);
    } },

  // The work queue's only owner filter is the "Mine" scope (filterTasks, src/08-playbook-engine.jsx:
  // scope "mine" keeps t.owner === user.name). Rows don't show the owner, so the CSM creates one
  // task for itself and one for the admin, then checks Mine shows exactly its own.
  { id: `${F}/filter`, feature: F, title: "Mine (as CSM) shows the CSM's tasks and hides others'", role: "csm",
    run: async ({ page, runId, thisRunId, csmName, adminName }) => {
      if (!adminName || adminName === csmName) throw new SkipScenario("admin display name unknown or equal to the CSM's");
      const tag = `QA ${thisRunId} filter`;
      const mine = `${tag} csm`, theirs = `${tag} admin`;
      await openTasks(page, { q: tag });
      const have = (await taskTitles(page)).map(r => r.title);
      if (!have.includes(mine)) await addTask(page, ACCT(runId), mine, csmName);
      if (!have.includes(theirs)) await addTask(page, ACCT(runId), theirs, adminName);

      await openTasks(page, { scope: "All", q: tag });
      const all = (await taskTitles(page)).map(r => r.title).sort();
      assert.deepEqual(all, [theirs, mine].sort(), "All should show both run tasks");
      await openTasks(page, { scope: "Mine", q: tag });
      const shown = (await taskTitles(page)).map(r => r.title);
      assert.deepEqual(shown, [mine], "Mine should show only the CSM's task");
    } },
];
