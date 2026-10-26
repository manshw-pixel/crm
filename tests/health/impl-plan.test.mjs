import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// Task 7: board, project detail, tasks, time logging, plan templates.
const ACCT = seedAccount({ id: "a1", name: "Acme", csm: "Test User" });
const OTHER = seedAccount({ id: "a2", name: "Globex", csm: "Test User" });
const proj = (id, accountId, stage, implementerId) => ({ id, accountId, type: "onboarding", stage, implementerId, createdBy: "Test User",
  checklistTemplate: [{ id: "order_form", label: "Signed order form attached", kind: "check", required: true }], checklist: { order_form: true },
  targetGoLive: "2027-03-01", startedAt: null, liveAt: null, history: [{ at: "2026-10-01T00:00:00.000Z", by: "Test User", from: "handover", to: "queued", note: "" }], holdReason: "" });
const task = (id, projectId, ownerId, title, estHours, status = "todo") => ({ id, projectId, accountId: "a1", title, ownerId, due: "2027-02-01",
  estHours, timeLog: [], status, signoff: "pending", order: 1 });
const rows = list => `${JSON.stringify(list)}.map(d => ({ id: d.id, data: d }))`;
const seed = (role, name, projects, tasks, extra = "") => `window.__seedRows = { accounts: ${rows([ACCT, OTHER])}, settings: [],
  projects: ${rows(projects)}, project_tasks: ${rows(tasks)},
  profiles: [{ id: "u1", org_id: "org-a", name: "${name}", role: "${role}" }, { id: "u3", org_id: "org-a", name: "Ian", role: "impl_user" },
    { id: "u2", org_id: "org-a", name: "Ivy", role: "impl_user" }] };${extra}`;
const state = page => page.evaluate(async () => { await new Promise(r => setTimeout(r, 50)); const s = window.__store.getState();
  return { projects: s.projects, tasks: s.projectTasks, settings: s.settings }; });
const openImpl = async page => { await page.click('button[title="Implementation"]').catch(() => {}); await page.waitForSelector('[data-impl-tab="Board"]'); };
const openProject = async (page, id) => { await page.click(`[data-board-project="${id}"]`); await page.waitForSelector(`[data-project-detail="${id}"]`); };

test("impl board: a column per stage, on hold/cancelled collapsed last; lead assigns from Queued by load, card moves to Planning", async () => {
  // Ian (listed before Ivy in profiles) carries a heavy open task, so he sorts last; the lead herself is an implementer too
  const { page, browser } = await launch(seed("impl_lead", "Lena", [proj("p1", "a1", "queued", null), proj("p0", "a2", "planning", "u3")],
    [task("k0", "p0", "u3", "Heavy", 200)]));
  try {
    await openImpl(page);
    const cols = await page.locator("[data-board-column]").evaluateAll(els => els.map(e => e.dataset.boardColumn));
    assert(cols.join("|") === "queued|planning|in_progress|csm_review|live|on_hold|cancelled", "columns " + cols.join("|"));
    const collapsed = await page.locator("[data-board-collapsed]").evaluateAll(els => els.map(e => e.dataset.boardColumn + ":" + e.open));
    assert(collapsed.join("|") === "on_hold:false|cancelled:false", "collapsed " + collapsed.join("|"));
    assert(await page.locator('[data-board-column="queued"] [data-board-project="p1"]').count() === 1, "p1 not in Queued");
    await openProject(page, "p1");
    await page.click("[data-stage-action=assign]");
    const order = await page.locator("[data-assign-row]").evaluateAll(els => els.map(e => e.dataset.assignRow));
    assert(order.join("|") === "u1|u2|u3", "assign order " + order.join("|"));
    await page.click('[data-assign-row="u2"] button');
    await page.waitForSelector('[data-project-detail="p1"][data-stage="planning"]');
    const s = await state(page);
    const p = s.projects.find(x => x.id === "p1");
    assert(p.implementerId === "u2" && p.stage === "planning", "assigned " + JSON.stringify([p.implementerId, p.stage]));
    await page.click("[data-project-back]");
    assert(await page.locator('[data-board-column="planning"] [data-board-project="p1"]').count() === 1, "card did not move to Planning");
  } finally { await browser.close(); }
});

test("impl plan: implementer adds tasks, starts, logs time; sign-off waits for every task Done; My tasks lists own open tasks", async () => {
  const { page, browser } = await launch(seed("impl_user", "Ivy", [proj("p1", "a1", "planning", "u1"), proj("p9", "a2", "in_progress", "u2")],
    [task("x1", "p9", "u2", "Not mine", 5)]));
  try {
    await openImpl(page);
    await openProject(page, "p1");
    const start = page.locator("[data-stage-action=start]");
    assert(await start.isDisabled() && (await start.getAttribute("title")) === "Add at least one task first", "start not gated");
    for (const [t, h] of [["Kickoff", "3"], ["Configure", "5"]]) {
      await page.fill("[data-new-task-title]", t);
      await page.fill("[data-new-task-hours]", h);
      await page.click("[data-new-task-add]");
    }
    await page.waitForFunction(() => document.querySelectorAll("[data-task-row]").length === 2);
    let s = await state(page);
    const mine = s.tasks.filter(t => t.projectId === "p1");
    assert(mine.length === 2 && mine.every(t => t.ownerId === "u1" && t.accountId === "a1" && t.status === "todo" && t.signoff === "pending"), "task defaults " + JSON.stringify(mine));
    assert(mine.map(t => t.estHours).join("|") === "3|5", "est hours");
    await start.click();
    await page.waitForSelector('[data-project-detail="p1"][data-stage="in_progress"]');
    const first = page.locator("[data-task-row]").first();
    await first.locator("[data-task-log-hours]").fill("2");
    await first.locator("[data-task-log]").click();
    await page.waitForFunction(() => document.querySelector("[data-task-row] [data-task-logged]")?.textContent.includes("2h"));
    s = await state(page);
    const logged = s.tasks.find(t => t.title === "Kickoff").timeLog;
    assert(logged.length === 1 && logged[0].hours === 2 && logged[0].by === "Ivy", "time log " + JSON.stringify(logged));
    const send = page.locator("[data-stage-action=review]");
    assert(await send.isDisabled() && (await send.getAttribute("title")) === "Every task must be done", "send not gated");

    await page.click("[data-project-back]");
    await page.click('[data-impl-tab="My tasks"]');
    const my = await page.locator("[data-my-task]").allTextContents();
    assert(my.length === 2 && my.some(t => t.includes("Kickoff")) && !my.some(t => t.includes("Not mine")), "my tasks " + my.join("|"));
    await page.click('[data-impl-tab="Board"]');
    await openProject(page, "p1");
    for (const r of await page.locator("[data-task-row] [data-task-status]").all()) await r.selectOption("done");
    await page.waitForFunction(() => !document.querySelector("[data-stage-action=review]").disabled);
  } finally { await browser.close(); }
});

test("impl templates: admin saves a plan as a template; a new planning project applies it and gets the tasks", async () => {
  const { page, browser } = await launch(seed("admin", "Test User", [proj("p1", "a1", "planning", "u2"), proj("p2", "a2", "planning", "u3")],
    [task("t1", "p1", "u2", "Kickoff", 3), { ...task("t2", "p1", "u2", "Configure", 5), order: 2 }]));
  try {
    await openImpl(page);
    await openProject(page, "p1");
    await page.click("[data-save-template]");
    await page.fill("[data-template-name]", "Standard");
    await page.click("[data-template-save]");
    let s = await state(page);
    const tpl = s.settings.implPlanTemplates;
    assert(tpl.length === 1 && tpl[0].name === "Standard" && JSON.stringify(tpl[0].tasks) === JSON.stringify([{ title: "Kickoff", estHours: 3 }, { title: "Configure", estHours: 5 }]), "template " + JSON.stringify(tpl));
    await page.click("[data-project-back]");
    await openProject(page, "p2");
    await page.locator("[data-template-pick]").selectOption("Standard");
    await page.click("[data-template-apply]");
    await page.waitForFunction(() => document.querySelectorAll("[data-task-row]").length === 2);
    s = await state(page);
    const got = s.tasks.filter(t => t.projectId === "p2");
    assert(got.length === 2 && got.every(t => t.ownerId === "u3" && t.accountId === "a2"), "applied " + JSON.stringify(got));
    assert(await page.locator("[data-template-apply]").count() === 0, "template picker still offered on a project with tasks");
  } finally { await browser.close(); }
});

test("impl detail: an impl_user who is not the implementer sees no edit controls; opens from the account Projects card", async () => {
  const { page, browser } = await launch(seed("impl_user", "Ian", [proj("p1", "a1", "in_progress", "u2")], [task("t1", "p1", "u2", "Kickoff", 3)]));
  try {
    await openImpl(page);
    await openProject(page, "p1");
    await page.waitForSelector("[data-task-row]");
    for (const sel of ["[data-stage-action]", "[data-new-task-title]", "[data-task-log]", "[data-task-status]", "[data-task-delete]", "[data-save-template]"])
      assert(await page.locator(sel).count() === 0, "edit control shown: " + sel);
    await page.click("[data-project-back]");
    await page.click('button[title="Accounts"]');
    await page.getByText("Acme").first().click();
    await page.click('[data-project-row="p1"]');
    await page.waitForSelector('[data-project-detail="p1"]');
  } finally { await browser.close(); }
});

test("impl assign: reassigning moves open tasks owned by the old implementer or nobody; others' and done tasks stay", async () => {
  const { page, browser } = await launch(seed("impl_lead", "Lena", [proj("p1", "a1", "in_progress", "u2"), proj("p3", "a2", "queued", null)],
    [task("t1", "p1", "u2", "Old owner", 3), task("t2", "p1", null, "No owner", 3), task("t3", "p1", "u1", "Lena's own", 3),
      task("t4", "p1", "u2", "Finished", 3, "done"), task("q1", "p3", null, "Queued task", 2)]));
  try {
    await openImpl(page);
    await openProject(page, "p1");
    await page.click("[data-stage-action=reassign]");
    await page.click('[data-assign-row="u3"] button');
    await page.waitForFunction(() => window.__store.getState().projects.find(p => p.id === "p1").implementerId === "u3");
    let s = await state(page);
    const own = id => s.tasks.find(t => t.id === id).ownerId;
    assert([own("t1"), own("t2"), own("t3"), own("t4")].join("|") === "u3|u3|u1|u2", "owners " + [own("t1"), own("t2"), own("t3"), own("t4")].join("|"));
    await page.click("[data-project-back]");
    await openProject(page, "p3");
    await page.click("[data-stage-action=assign]");
    await page.click('[data-assign-row="u2"] button');
    await page.waitForSelector('[data-project-detail="p3"][data-stage="planning"]');
    s = await state(page);
    assert(own("q1") === "u2", "queued task owner not backfilled: " + own("q1"));
    // Task 9a: an impl_lead saves templates, and the save goes through the definer RPC
    await page.click("[data-save-template]");
    await page.fill("[data-template-name]", "Lead plan");
    await page.click("[data-template-save]");
    await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "save_impl_plan_templates"));
    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.fn === "save_impl_plan_templates"));
    assert(call.args.items.length === 1 && call.args.items[0].name === "Lead plan" && call.args.items[0].tasks.length === 1
      && call.args.items[0].tasks[0].title === "Queued task", "rpc args " + JSON.stringify(call.args));
    assert(!(await page.evaluate(() => window.__rpcCalls.some(c => c.fn === "merge_row" && c.args.tbl === "settings"))), "templates also merged into settings");
    // leaving the Implementation view and coming back shows the Board
    await page.click('button[title="Accounts"]');
    await page.click('button[title="Implementation"]');
    await page.waitForSelector("[data-board-column]");
  } finally { await browser.close(); }
});
