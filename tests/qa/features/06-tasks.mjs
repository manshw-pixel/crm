import assert from "node:assert/strict";
import { waitForSaved } from "../reset.mjs";
import { SkipScenario } from "../core.mjs";
import { openAccount } from "./_accounts.mjs";
import { nav } from "./_users-card.mjs";
import { openTasks, taskTitles } from "./_tasks.mjs";

const F = "06-tasks";
const ACCT = runId => `QA ${runId} Birch Labs`; // CSM-owned fixture row

// "+ Add task" on the account page (AddTaskForm, src/13-forms.jsx:162-197). The form has two
// <select>s, priority then owner, so the owner is select #2. The owner list is checked before
// anything is typed, so a missing owner skips with no UI write.
async function addTask(page, acct, title, owner) {
  await openAccount(page, acct);
  await page.getByRole("button", { name: "+ Add task" }).click();
  const form = page.locator("form").filter({ has: page.getByPlaceholder("Task title…") });
  const sel = form.locator("select").nth(1);
  const opts = await sel.locator("option").allTextContents();
  if (!opts.includes(owner)) throw new SkipScenario(`task owner "${owner}" is not offered in the owner list (${opts.join(", ")})`);
  await form.getByPlaceholder("Task title…").fill(title);
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
