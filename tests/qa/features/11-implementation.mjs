import assert from "node:assert/strict";
import { openUsersCard, nav, MAIN } from "./_users-card.mjs";
import { openAccount, searchCount, isoPlus } from "./_accounts.mjs";
import { EXPECTED } from "../fixtures/expected.mjs";
import { SkipScenario } from "../core.mjs";
import { waitForSaved } from "../reset.mjs";
import { signIn } from "../session.mjs";

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
  // The app keeps the open project across navigation: return to the Board first when a detail is showing.
  const back = page.locator("[data-project-back]");
  if (await back.count() && await back.first().isVisible()) await back.first().click();
  await page.locator("[data-board-column=queued]").waitFor({ timeout: 15000 });
  const name = fixtureName(runId);
  // The columns render before the projects load on a fresh sign-in: wait for a card of the account in a wanted column.
  await page.locator(stages.map(s => `[data-board-column=${s}] [data-board-project]`).join(", ")).filter({ hasText: name })
    .first().waitFor({ timeout: 15000 }).catch(() => {});
  for (const stage of stages) {
    const cards = page.locator(`[data-board-column=${stage}] [data-board-project]`).filter({ hasText: name });
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      await cards.nth(i).click();
      const detail = page.locator("[data-project-detail]");
      await detail.waitFor({ timeout: 15000 });
      if (await detail.getByText(new RegExp(`^QA ${thisRunId} (?!${EXPECTED.adminOwned}$)`)).count()) return detail; // a handover value, not the account name in the header
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

// ---- PR 3 helpers (sign-off, go-live, workload, dashboard). They continue the PR 2 project of this run. ----
// The fixture account is owned by the QA admin (fixtures/accounts.csv Orchid Bank = {ADMIN}), and only the account's CSM or an
// admin may sign off (src/30-project-detail.jsx `reviewer`). The csm user is NOT this account's CSM, so the reviewer here is admin.
const RETURN_NOTE = thisRunId => `QA ${thisRunId} please fix the plan task`;
const ALL_STAGES = ["in_progress", "csm_review", "live"];
// Runs fn(reviewerPage) as the QA admin in its own signed-in context (the scenario's own page is the impl user's).
async function asAdmin(ctx, fn) {
  const admin = await signIn(ctx.context.browser(), ctx.env, "admin");
  try { return await fn(admin.page); } finally { await admin.close(); }
}
// Impl side: mark the run's plan task Done and Send for sign-off. No-op when the project is already in CSM review or Live.
async function implSendForSignoff(page, runId, thisRunId) {
  const detail = await openRunProject(page, runId, thisRunId, ALL_STAGES, "did the earlier 11-implementation scenarios run?");
  if (await detail.getAttribute("data-stage") !== "in_progress") return;
  const task = detail.locator("[data-task-row]").filter({ hasText: planTask(thisRunId) });
  await task.first().waitFor({ timeout: 15000 }).catch(() => { throw new Error(`plan task "${planTask(thisRunId)}" not found in the project (did ${F}/assign-and-plan run first?)`); });
  const status = task.first().locator("[data-task-status]");
  if (await status.inputValue() !== "done") { await status.selectOption("done"); await waitForSaved(page); }
  await page.waitForFunction(() => { const b = document.querySelector('[data-stage-action="review"]'); return !!b && !b.disabled; }, null, { timeout: 15000 })
    .catch(() => { throw new Error("'Send for sign-off' stayed disabled although the only task is Done"); });
  await watchSaveFailed(page);
  await detail.locator('[data-stage-action="review"]').click();
  await page.locator('[data-project-detail][data-stage="csm_review"]').waitFor({ timeout: 15000 });
  await implSaved(page, "Send for sign-off");
}
// After an impl user's stage change: the whole write (project AND its system activity) must persist. waitForSaved fails on
// the queue's "error"; the toast/header checks also catch a refusal the queue already rolled back (an RLS-denied
// activity once did exactly that, and the retry -- which no-ops in CSM review -- hid it).
// Call watchSaveFailed just before the action: it records only "Save failed" toasts added after it (toasts from earlier
// actions are ignored), so a toast that was shown and dismissed is still caught.
async function watchSaveFailed(page) {
  await page.evaluate(() => {
    window.__qaSaveFailed = [];
    window.__qaToastObs?.disconnect();
    window.__qaToastObs = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      const t = n.nodeType === 1 && (n.matches("[data-toast]") ? [n] : [...n.querySelectorAll("[data-toast]")]);
      (t || []).forEach(e => { if (/Save failed/.test(e.textContent)) window.__qaSaveFailed.push(e.textContent); });
    })));
    window.__qaToastObs.observe(document.body, { childList: true, subtree: true });
  });
}
async function implSaved(page, what) {
  await waitForSaved(page);
  // Bounded grace window: a refusal's toast can land just after the queue settles.
  await page.waitForFunction(() => (window.__qaSaveFailed || []).length > 0, null, { timeout: 2000, polling: 100 }).catch(() => {});
  const failed = await page.evaluate(() => { window.__qaToastObs?.disconnect(); return window.__qaSaveFailed || []; });
  assert.equal(failed.length, 0, `${what}: a write was refused -- ${failed[0]}`);
  assert.equal(await page.getByText("Not saved", { exact: true }).count(), 0, `${what}: the header reads "Not saved"`);
}

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
      await page.locator("[data-scope-toggle] button").filter({ hasText: /^Whole team$/ }).click();
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

  // PR 3. Return and go-live share the run's project: Done + Send for sign-off (impl) -> Send back (reviewer) -> again -> Sign off.
  { id: `${F}/signoff-return`, feature: F, title: "Impl sends for sign-off; the reviewer sends it back with a note", role: "impl",
    run: async ctx => {
      const { page, runId, thisRunId, env } = ctx;
      if (!env?.users?.impl) throw new SkipScenario("no impl user configured");
      const note = RETURN_NOTE(thisRunId);
      const probe = await openRunProject(page, runId, thisRunId, ALL_STAGES, "", true);
      if (!probe) throw new Error(`no in-progress/CSM-review/live project of the run on the board (did ${F}/log-time run first?)`);
      const stage0 = await probe.getAttribute("data-stage");
      // Retry-safe: Live means an earlier run went through the return; In progress with a returned task means this step is done.
      if (stage0 === "live") return;
      if (stage0 === "in_progress" && await probe.locator("[data-task-returned]").count()) {
        assert.ok((await probe.locator("[data-task-returned]").first().innerText()).includes(note), "task is returned but not with this run's note");
        return;
      }
      await implSendForSignoff(page, runId, thisRunId);
      await asAdmin(ctx, async ap => {
        const detail = await openRunProject(ap, runId, thisRunId, ["csm_review"], "the impl user's Send for sign-off did not reach CSM review");
        const task = detail.locator("[data-task-row]").filter({ hasText: planTask(thisRunId) }).first();
        await task.locator("[data-task-sendback]").click();
        await task.locator("[data-sendback-note]").fill(note);
        await task.locator("[data-sendback-confirm]").click();
        await ap.locator('[data-project-detail][data-stage="in_progress"]').waitFor({ timeout: 15000 });
        await waitForSaved(ap);
        assert.equal((await detail.locator("[data-project-stage]").innerText()).trim(), "In progress", "project is not In progress after Send back");
        assert.ok((await task.locator("[data-task-returned]").innerText()).includes(note), "the Send back note is not shown on the task");
        assert.equal(await task.locator("[data-task-status]").inputValue(), "todo", "returned task is not back to To do");
      });
      // The implementer sees the note too. Reload: the impl page still holds the pre-Send-back state the admin changed.
      await page.reload();
      await nav(page, "Implementation").waitFor({ timeout: 20000 });
      const detail = await openRunProject(page, runId, thisRunId, ["in_progress"], "project is not In progress for the impl user after Send back");
      await detail.locator("[data-task-returned]").first().waitFor({ timeout: 15000 });
      assert.ok((await detail.locator("[data-task-returned]").first().innerText()).includes(note), "impl user does not see the return note");
    } },

  { id: `${F}/go-live`, feature: F, title: "Impl re-sends; the reviewer signs off; the project goes Live", role: "impl",
    run: async ctx => {
      const { page, runId, thisRunId, env } = ctx;
      if (!env?.users?.impl) throw new SkipScenario("no impl user configured");
      await page.reload(); // pick up the reviewer's Send back made from the admin session
      await nav(page, "Implementation").waitFor({ timeout: 20000 });
      const probe = await openRunProject(page, runId, thisRunId, ALL_STAGES, "", true);
      if (!probe) throw new Error(`no in-progress/CSM-review/live project of the run on the board (did ${F}/signoff-return run first?)`);
      const stage0 = await probe.getAttribute("data-stage");
      if (stage0 === "in_progress" && !await probe.locator("[data-task-returned]").count())
        throw new Error(`project is In progress but the task was never sent back (did ${F}/signoff-return run first?)`);
      if (stage0 !== "live") {
        await implSendForSignoff(page, runId, thisRunId);
        await asAdmin(ctx, async ap => {
          const detail = await openRunProject(ap, runId, thisRunId, ["csm_review"], "the impl user's Send for sign-off did not reach CSM review");
          const task = detail.locator("[data-task-row]").filter({ hasText: planTask(thisRunId) }).first();
          await task.locator("[data-task-signoff]").click();
          await ap.locator('[data-project-detail][data-stage="live"]').waitFor({ timeout: 15000 });
          await waitForSaved(ap);
        });
      }
      await asAdmin(ctx, async ap => {
        const detail = await openRunProject(ap, runId, thisRunId, ["live"], "project is not in the Live column after sign-off");
        assert.equal((await detail.locator("[data-project-stage]").innerText()).trim(), "Live", "project stage text is not Live");
        await detail.locator("[data-task-signed]").first().waitFor({ timeout: 15000 });
        await ap.locator("[data-project-back]").click();
        await ap.locator("[data-board-column=live] [data-board-project]").filter({ hasText: fixtureName(runId) }).first().waitFor({ timeout: 15000 });
      });
    } },

  // Read-only: the go-live above is a CSM sign-off, so the account header shows an Impl -> CSM handover pill beside Sales -> AM.
  { id: `${F}/csm-handover-pill`, feature: F, title: "After sign-off the account shows an Impl → CSM handover date", role: "admin",
    run: async ({ page, runId }) => {
      await openAccount(page, fixtureName(runId));
      const pills = page.locator("[data-csm-handover-pill]");
      await pills.first().waitFor({ timeout: 15000 });
      assert.match((await pills.first().innerText()).trim(), /^Impl → CSM \S/, "first handover pill text");
      assert.ok(await page.locator("[data-transition-pill]").count() === 1, "Sales → AM pill missing beside the handover pill");
    } },

  { id: `${F}/workload-visible`, feature: F, title: "Admin's Workload tab lists the impl user with active count and hours", role: "admin",
    run: async ({ page, env, implName }) => {
      if (!env?.users?.impl || !implName) throw new SkipScenario("no impl user configured");
      await nav(page, "Implementation").click();
      await page.locator("[data-board-column=queued]").waitFor({ timeout: 15000 });
      await page.locator('[data-impl-tab="Workload"]').click();
      await page.locator("[data-workload-table]").waitFor({ timeout: 15000 });
      const row = page.locator("[data-workload-row]").filter({ hasText: implName });
      assert.equal(await row.count(), 1, `Workload lists ${await row.count()} rows for "${implName}", expected 1`);
      for (const col of ["active", "remaining", "logged30"]) {
        const txt = (await row.locator(`[data-col=${col}]`).innerText()).trim();
        assert.match(txt, col === "active" ? /^\d+$/ : /^\d+(\.\d+)?h$/, `Workload ${col} cell is "${txt}"`);
      }
      // log-time logged 2h within the last 30 days.
      const logged = parseFloat(await row.locator("[data-col=logged30]").innerText());
      assert.ok(logged >= LOG_HOURS, `Logged 30d is ${logged}h, expected at least the ${LOG_HOURS}h logged by log-time`);
    } },

  { id: `${F}/dashboard-chart`, feature: F, title: "Dashboard Implementation projects card: 12 months, Q1-Q4, current period has a Completed project", role: "admin",
    run: async ({ page }) => {
      await nav(page, "Dashboard").click();
      const card = page.locator("[data-impl-chart]");
      await card.waitFor({ timeout: 20000 });
      const labels = () => card.locator("[data-impl-period-label]").allTextContents().then(a => a.map(x => x.trim()));
      const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      assert.deepEqual(await labels(), MONTHS, "Month mode does not show Jan..Dec");
      // The run's project went Live now, so the current month counts it as Completed.
      const bar = card.locator(`[data-impl-bar="${MONTHS[new Date().getUTCMonth()]}"]`);
      assert.ok(+await bar.getAttribute("data-completed") >= 1, `current month shows ${await bar.getAttribute("data-completed")} Completed, expected at least 1 (did ${F}/go-live run?)`);
      await page.locator("[data-impl-mode=quarter]").click();
      await page.waitForFunction(() => document.querySelectorAll("[data-impl-period-label]").length === 4, null, { timeout: 10000 });
      assert.deepEqual(await labels(), ["Q1", "Q2", "Q3", "Q4"], "Quarter mode does not show Q1..Q4");
      const q = card.locator(`[data-impl-bar="Q${Math.floor(new Date().getUTCMonth() / 3) + 1}"]`);
      assert.ok(+await q.getAttribute("data-completed") >= 1, "current quarter shows no Completed project");
    } },
  // The folder picker can't be driven live, so the page's QA hook (window.__syncSalesText, set up by session.mjs) feeds a sales CSV
  // through the same sync path. The account name is run-unique, so a retry finds its own project and only asserts the count.
  { id: `${F}/sales-feed-onboarding`, feature: F, title: "A sales-feed onboarding row creates exactly one queued project, even when re-fed", role: "admin",
    run: async ({ page, thisRunId }) => {
      const name = `QA ${thisRunId} Sales Onboarding`;
      const csv = `name,tier,arr,currency,destination,order_form,go_live_target,customer_contact,modules_scope
${name},Mid,100000,INR,onboarding,yes,15-12-2030,QA Contact,Core
`;
      await nav(page, "Settings").click();
      await page.waitForFunction(() => typeof window.__syncSalesText === "function", null, { timeout: 15000 })
        .catch(() => { throw new Error("window.__syncSalesText missing: Settings > Integrations not mounted or __qaHooks not set"); });
      const cards = async () => {
        await nav(page, "Implementation").click();
        await page.locator("[data-board-column=queued]").waitFor({ timeout: 15000 });
        const back = page.locator("[data-project-back]");
        if (await back.count() && await back.first().isVisible()) await back.first().click();
        await page.locator("[data-board-column=queued]").waitFor({ timeout: 15000 });
        await page.waitForTimeout(500);
        return page.locator("[data-board-project]").filter({ hasText: name }).count();
      };
      const feed = async mtime => {
        await nav(page, "Settings").click();
        await page.waitForFunction(() => typeof window.__syncSalesText === "function", null, { timeout: 15000 });
        const r = await page.evaluate(([n, t, m]) => window.__syncSalesText(n, t, m), [`qa-${thisRunId}-sales.csv`, csv, mtime]);
        assert.ok(!r.err, `sales sync reported an error: ${r.msg}`);
        await waitForSaved(page);
      };
      if (await cards() === 0) await feed(Date.now());
      assert.equal(await cards(), 1, `expected exactly 1 project for "${name}" after the first feed`);
      await feed(Date.now() + 5000); // later timestamp: a new signature, so the file is processed again
      assert.equal(await cards(), 1, `re-feeding the same row created a second project for "${name}"`);
      await page.locator("[data-board-column=queued] [data-board-project]").filter({ hasText: name }).first().waitFor({ timeout: 5000 });
    } },
];
