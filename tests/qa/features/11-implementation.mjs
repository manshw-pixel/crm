import assert from "node:assert/strict";
import { openUsersCard, nav, MAIN } from "./_users-card.mjs";
import { openAccount, searchCount, isoPlus } from "./_accounts.mjs";
import { EXPECTED } from "../fixtures/expected.mjs";
import { SkipScenario } from "../core.mjs";
import { waitForSaved } from "../reset.mjs";

const F = "11-implementation";
// Rows seeded (as admin, through the UI) on the fixture account for the impl scenario to look at.
// Locators are substring (non-exact) matches: a contact name shares its element with a "·" line, and long task titles wrap.
const seeded = thisRunId => ({ contact: `QA ${thisRunId} Impl Contact`, task: `QA ${thisRunId} impl task`, activity: `QA ${thisRunId} impl call` });

// ---- PR 2 helpers (handover, board, plan). The last three scenarios share one project per run, found by a marker. ----
const fixtureName = runId => `QA ${runId} ${EXPECTED.adminOwned}`;
const planTask = thisRunId => `QA ${thisRunId} impl plan task`;
const PLAN_HOURS = 4, LOG_HOURS = 2;

// Opens this run's project from the Implementation board: a card of the fixture account, in one of `stages`, whose detail
// shows the run's marker (every text item of the handover is filled with it). Fails loudly when none is found.
async function openRunProject(page, runId, thisRunId, stages, hint, soft = false) {
  await nav(page, "Implementation").click();
  await page.locator("[data-board-column=queued]").waitFor({ timeout: 15000 });
  const name = fixtureName(runId);
  for (const stage of stages) {
    const cards = page.locator(`[data-board-column=${stage}] [data-board-project]`).filter({ hasText: name });
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      await cards.nth(i).click();
      const detail = page.locator("[data-project-detail]");
      await detail.waitFor({ timeout: 15000 });
      if (await detail.getByText(`QA ${thisRunId}`).count()) return detail;
      await page.locator("[data-project-back]").click();
      await page.locator("[data-board-column=queued]").waitFor({ timeout: 15000 });
    }
  }
  if (soft) return null;
  throw new Error(`no ${stages.join("/")} project of "${name}" carrying this run's marker QA ${thisRunId} on the board (${hint})`);
}
const loggedOf = async row => {
  const m = /^(\d+(?:\.\d+)?)h \//.exec((await row.locator("[data-task-logged]").innerText()).trim());
  assert.ok(m, "task row shows no logged-hours figure");
  return Number(m[1]);
};

export const scenarios = [
  // Read-only: inspects the role dropdown options of an existing user row; nothing is changed or saved.
  { id: `${F}/team-offers-impl-roles`, feature: F, title: "Team role select offers impl_lead and impl_user", role: "admin",
    run: async ({ page }) => {
      await openUsersCard(page);
      const select = page.locator("select[data-role-select]").first();
      await select.waitFor({ timeout: 15000 });
      const options = await select.locator("option").evaluateAll(os => os.map(o => o.value));
      for (const r of ["impl_lead", "impl_user"]) assert.ok(options.includes(r), `role select lacks ${r} (has ${options.join(", ")})`);
    } },

  // Seeds one contact, task and activity on the fixture account. Scenarios in a run execute in file order,
  // so this runs before impl-read-only; it is a no-op for rows that already exist (retry-safe).
  { id: `${F}/seed-impl-rows`, feature: F, title: "Seed a contact, task and activity on the fixture account for the impl check", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      const name = `QA ${runId} ${EXPECTED.adminOwned}`, rows = seeded(thisRunId);
      await openAccount(page, name);
      const has = t => page.getByText(t).count();
      if (!await has(rows.contact)) {
        await page.locator("[data-more-actions]").click();
        await page.getByRole("menuitem", { name: "+ Contact" }).click();
        const form = page.locator("[data-contact-form]");
        await form.getByPlaceholder("Name *").fill(rows.contact);
        await form.getByRole("button", { name: "Add", exact: true }).click();
        await waitForSaved(page);
      }
      if (!await has(rows.task)) {
        await page.getByRole("button", { name: "+ Add task" }).click();
        const form = page.locator("form").filter({ has: page.getByPlaceholder("Task title…") });
        await form.getByPlaceholder("Task title…").fill(rows.task);
        await form.getByRole("button", { name: "Add", exact: true }).click();
        await waitForSaved(page);
      }
      if (!await has(rows.activity)) {
        await page.getByRole("button", { name: "+ Log activity" }).click();
        await page.getByPlaceholder("Summary…").fill(rows.activity);
        await page.getByRole("button", { name: "Log", exact: true }).click();
        await waitForSaved(page);
      }
      for (const t of Object.values(rows)) await page.getByText(t).first().waitFor({ timeout: 10000 });
    } },

  // Needs a QA user already set to impl_user by the org admin; this scenario never creates users or changes roles.
  { id: `${F}/impl-read-only`, feature: F, title: "Impl user sees only Implementation + Accounts, and accounts are read-only", role: "impl",
    run: async ({ page, runId, thisRunId, env }) => {
      if (!env?.users?.impl) throw new SkipScenario("no impl user configured");
      await page.locator(MAIN).waitFor({ timeout: 15000 });
      const labels = await page.locator(`${MAIN} button[aria-label]`).evaluateAll(bs => bs.map(b => b.getAttribute("aria-label")));
      assert.deepEqual([...labels].sort(), ["Accounts", "Implementation"], `sidebar shows ${labels.join(", ")}`);
      const name = `QA ${runId} ${EXPECTED.adminOwned}`, rows = seeded(thisRunId);
      assert.equal(await searchCount(page, name), 1, "fixture account not listed for the impl user");
      assert.equal(await page.getByRole("button", { name: "+ New account" }).count(), 0, "impl user sees + New account");
      await openAccount(page, name);
      // Each section must show the seeded row (so absence below is not vacuous).
      for (const [kind, text] of Object.entries(rows))
        await page.getByText(text).first().waitFor({ timeout: 15000 }).catch(() => { throw new Error(`seeded ${kind} "${text}" not visible to the impl user (did ${F}/seed-impl-rows run first?)`); });
      for (const label of ["✎ Edit account", "+ Log activity", "+ Add task", "Edit contact", "Delete contact", "Edit task", "Edit activity"])
        assert.equal(await page.getByRole("button", { name: label }).count(), 0, `impl user sees "${label}"`);
      assert.equal(await page.locator("[data-more-actions]").count(), 0, "impl user sees the more-actions menu");
    } },

  // PR 2. The next three run in file order and share one project: handover -> assign + plan -> log time.
  // Each fails (never skips) when the previous one's project is missing; the only skip is an unconfigured impl user.
  { id: `${F}/handover-required`, feature: F, title: "Handover refuses a missing required item, then queues the project", role: "csm",
    run: async ({ page, runId, thisRunId }) => {
      // Retry-safe: if an earlier attempt already queued this run's project, do not create a second one.
      const existing = await openRunProject(page, runId, thisRunId, ["queued", "planning", "in_progress", "csm_review", "live"], "", true);
      if (existing) {
        const st = await existing.getAttribute("data-stage");
        assert.ok(["queued", "planning", "in_progress", "csm_review", "live"].includes(st), `existing project is in stage ${st}, expected Queued or later`);
        return;
      }
      // The csm defaults to "My book"; the fixture account is admin-owned, so widen the scope first.
      await nav(page, "Accounts").click();
      await page.locator("[data-scope-toggle] button").filter({ hasText: /^All$/ }).click();
      await openAccount(page, fixtureName(runId));
      const rows = page.locator("[data-project-row]");
      await page.getByText(/^Projects \(\d+\)$/).first().waitFor({ timeout: 15000 });
      const before = await rows.count();
      const idsBefore = await rows.evaluateAll(rs => rs.map(r => r.getAttribute("data-project-row")));
      await page.locator("[data-new-project]").click();
      const form = page.locator("[data-handover-form]");
      await form.waitFor({ timeout: 15000 });
      const items = form.locator("[data-checklist-item]");
      const n = await items.count();
      const spec = [];
      for (let i = 0; i < n; i++) {
        const it = items.nth(i), text = (await it.innerText()).trim();
        const kind = await it.locator("input[type=checkbox]").count() ? "check" : (await it.locator("input[type=date]").count() ? "date" : "text");
        spec.push({ i, label: text.replace(/\s*\*$/, ""), required: /\*$/.test(text), kind });
      }
      const req = spec.filter(x => x.required);
      assert.ok(req.length >= 1, "handover checklist has no required item to test (is the org checklist all optional?)");
      assert.ok(spec.some(x => x.kind === "text"), "handover checklist has no text item to carry this run's marker");
      const fill = async x => {
        const it = items.nth(x.i);
        if (x.kind === "check") await it.locator("input[type=checkbox]").check();
        else if (x.kind === "date") await it.locator("input[type=date]").fill(isoPlus(60));
        else await it.locator("input").fill(`QA ${thisRunId} ${x.label}`);
      };
      const submit = () => form.getByRole("button", { name: "Submit handover", exact: true }).click();
      const errBox = page.locator("[data-handover-error]");
      // 1) nothing filled: refused, naming the first required item.
      await submit();
      await errBox.waitFor({ timeout: 10000 });
      await page.waitForFunction(l => document.querySelector("[data-handover-error]")?.textContent.includes(l), req[0].label, { timeout: 10000 });
      assert.ok((await errBox.innerText()).includes(req[0].label), `empty submit error "${await errBox.innerText()}" does not name "${req[0].label}"`);
      // 2) everything required (and every text item) filled except the last required item: refused, naming exactly that one.
      const last = req.at(-1);
      for (const x of spec) if (x !== last && (x.required || x.kind === "text")) await fill(x);
      await submit();
      await page.waitForFunction(l => document.querySelector("[data-handover-error]")?.textContent.includes(l), last.label, { timeout: 10000 });
      assert.equal(await rows.count(), before, "a project was created although a required item was empty");
      // 3) complete it: the project appears in the Projects card as Queued.
      await fill(last);
      await submit();
      await form.waitFor({ state: "detached", timeout: 15000 });
      await waitForSaved(page);
      assert.equal(await rows.count(), before + 1, "Projects card did not gain the new project");
      const idsAfter = await rows.evaluateAll(rs => rs.map(r => r.getAttribute("data-project-row")));
      const newIds = idsAfter.filter(id => !idsBefore.includes(id));
      assert.equal(newIds.length, 1, `expected exactly one new project row, got ${newIds.length}`);
      const fresh = page.locator(`[data-project-row="${newIds[0]}"]`);
      assert.equal(await fresh.getAttribute("data-stage"), "queued", "the new project is not Queued");
      assert.ok((await fresh.innerText()).includes("Queued"), "the new project row does not read Queued");
    } },

  { id: `${F}/assign-and-plan`, feature: F, title: "Admin assigns the project (to Planning), adds a task and starts it", role: "admin",
    run: async ({ page, runId, thisRunId, env, implName }) => {
      let detail = await openRunProject(page, runId, thisRunId, ["queued", "planning", "in_progress"], `did ${F}/handover-required run first?`);
      const stage = () => detail.getAttribute("data-stage");
      if (await stage() === "queued") {
        if (!env?.users?.impl || !implName) throw new SkipScenario("no impl user configured");
        await detail.locator('[data-stage-action="assign"]').click();
        const row = page.locator("[data-assign-row]").filter({ hasText: implName });
        await page.locator("[data-assign-row], :text('No active implementers')").first().waitFor({ timeout: 15000 });
        if (!await row.count()) throw new Error(`impl user "${implName}" is configured but not listed in the assign dialog (disabled, or not role impl_user/impl_lead?)`);
        await row.first().getByRole("button", { name: "Assign", exact: true }).click();
        await page.locator('[data-project-detail][data-stage="planning"]').waitFor({ timeout: 15000 });
        await waitForSaved(page);
      }
      assert.notEqual(await stage(), "queued", "project is still Queued after Assign");
      if (implName) assert.ok((await detail.locator("[data-project-implementer]").innerText()).includes(implName), "implementer on the project is not the impl user");
      // Back on the board it now sits in Planning (or later, on a retry).
      await page.locator("[data-project-back]").click();
      detail = await openRunProject(page, runId, thisRunId, ["planning", "in_progress"], "project is in no Planning/In progress column");
      const title = planTask(thisRunId), task = detail.locator("[data-task-row]").filter({ hasText: title });
      if (!await task.count()) {
        await detail.locator("[data-new-task-title]").fill(title);
        await detail.locator("[data-new-task-hours]").fill(String(PLAN_HOURS));
        await detail.locator("[data-new-task-add]").click();
        await task.first().waitFor({ timeout: 15000 });
        await waitForSaved(page);
      }
      assert.match(await task.first().locator("[data-task-logged]").innerText(), new RegExp(`/ ${PLAN_HOURS}h`), "task does not show its estimate");
      if (await detail.getAttribute("data-stage") === "planning") {
        await detail.locator('[data-stage-action="start"]').click();
        await page.locator('[data-project-detail][data-stage="in_progress"]').waitFor({ timeout: 15000 });
        await waitForSaved(page);
      }
      assert.equal((await detail.locator("[data-project-stage]").innerText()).trim(), "In progress", "project stage text is not In progress after Start");
    } },

  { id: `${F}/log-time`, feature: F, title: "Impl user logs hours on the task; sign-off stays disabled until it is done", role: "impl",
    run: async ({ page, runId, thisRunId, env }) => {
      if (!env?.users?.impl) throw new SkipScenario("no impl user configured");
      const detail = await openRunProject(page, runId, thisRunId, ["in_progress"], `did ${F}/assign-and-plan run first? the impl user must be its implementer`);
      const task = detail.locator("[data-task-row]").filter({ hasText: planTask(thisRunId) });
      await task.first().waitFor({ timeout: 15000 }).catch(() => { throw new Error(`plan task "${planTask(thisRunId)}" not found in the project (did ${F}/assign-and-plan run first?)`); });
      const review = detail.locator('[data-stage-action="review"]');
      assert.equal(await review.count(), 1, "no 'Send for sign-off' button for the implementer");
      assert.equal(await review.isDisabled(), true, "'Send for sign-off' is enabled although the task is not done");
      assert.equal(await task.first().locator("[data-task-status]").inputValue(), "todo", "task is not still To do");
      const before = await loggedOf(task.first());
      // Retry-safe: an earlier attempt may already have logged the hours.
      const target = before >= LOG_HOURS ? before : before + LOG_HOURS;
      if (before < LOG_HOURS) {
        await task.first().locator("[data-task-log-hours]").fill(String(LOG_HOURS));
        await task.first().locator("[data-task-log]").click();
      }
      await page.waitForFunction(([t, want]) => {
        const r = [...document.querySelectorAll("[data-task-row]")].find(e => e.textContent.includes(t));
        const m = r && /^(\d+(?:\.\d+)?)h \//.exec(r.querySelector("[data-task-logged]")?.textContent.trim() || "");
        return !!m && +m[1] === want;
      }, [planTask(thisRunId), target], { timeout: 15000 });
      await waitForSaved(page);
      assert.equal(await loggedOf(task.first()), target, "logged hours do not match");
      assert.equal(await review.isDisabled(), true, "'Send for sign-off' became enabled after logging time");
    } },
];
