import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// Task 9: CSM sign-off / send back / Live, and the derived implementation bell alerts.
const ACCT = seedAccount({ id: "a1", name: "Acme", csm: "Cara" });
const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 45 * 86400000).toISOString(); // outside the 30-day bell window
const proj = (id, stage, implementerId, history) => ({ id, accountId: "a1", type: "onboarding", stage, implementerId, createdBy: "Cara",
  checklistTemplate: [], checklist: {}, targetGoLive: null, startedAt: null, liveAt: null, history, holdReason: "" });
const task = (id, projectId, title, o = {}) => ({ id, projectId, accountId: "a1", title, ownerId: "u2", due: null, estHours: 2,
  timeLog: [], status: "done", signoff: "pending", signoffNote: "", signedBy: null, signedAt: null, order: id === "k1" ? 1 : 2, ...o });
const rows = list => `${JSON.stringify(list)}.map(d => ({ id: d.id, data: d }))`;
const seed = (role, name, projects, tasks) => `window.__seedRows = { accounts: ${rows([ACCT])}, settings: [],
  projects: ${rows(projects)}, project_tasks: ${rows(tasks)},
  profiles: [{ id: "u1", org_id: "org-a", name: "${name}", role: "${role}" }, { id: "u2", org_id: "org-a", name: "Ivy", role: "impl_user" }] };`;
const state = page => page.evaluate(async () => { await new Promise(r => setTimeout(r, 50)); const s = window.__store.getState();
  return { projects: s.projects, tasks: s.projectTasks, activities: s.activities }; });
const openImpl = async page => { await page.click('button[title="Implementation"]').catch(() => {}); await page.waitForSelector('[data-impl-tab="Board"]'); };
const openProject = async (page, id) => { await page.click(`[data-board-project="${id}"]`); await page.waitForSelector(`[data-project-detail="${id}"]`); };
const review = [{ at: NOW, by: "Ivy", from: "in_progress", to: "csm_review", note: "" }];
const bellItems = async page => { await page.click("[data-bell]"); await page.waitForSelector("[data-notif-panel]");
  return page.locator("[data-notif-item]").evaluateAll(els => els.map(e => e.dataset.notifItem + "::" + e.textContent)); };

test("impl sign-off: CSM signs one task, sends another back with a note -> In progress, signed task stays signed", async () => {
  const { page, browser } = await launch(seed("user", "Cara", [proj("p1", "csm_review", "u2", review)], [task("k1", "p1", "Kickoff"), task("k2", "p1", "Configure")]));
  try {
    await openImpl(page);
    await openProject(page, "p1");
    assert(await page.locator("[data-task-signoff]").count() === 2 && await page.locator("[data-task-sendback]").count() === 2, "controls per task");
    await page.click('[data-task-row="k2"] [data-task-signoff]');
    await page.waitForSelector('[data-task-row="k2"] [data-task-signed]');
    await page.click('[data-task-row="k1"] [data-task-sendback]');
    assert(await page.locator("[data-sendback-confirm]").isDisabled(), "send back allowed without a note");
    await page.fill("[data-sendback-note]", "Logo missing");
    await page.click("[data-sendback-confirm]");
    await page.waitForSelector('[data-project-detail="p1"][data-stage="in_progress"]');
    const s = await state(page);
    const k1 = s.tasks.find(t => t.id === "k1"), k2 = s.tasks.find(t => t.id === "k2");
    assert(k1.signoff === "returned" && k1.signoffNote === "Logo missing" && k1.status === "todo", "k1 " + JSON.stringify(k1));
    assert(k2.signoff === "signed" && k2.signedBy === "Cara", "k2 " + JSON.stringify(k2));
    assert(await page.locator("[data-task-signoff]").count() === 0, "sign-off controls outside CSM review");
  } finally { await browser.close(); }
});

test("impl sign-off: last task signed -> Live and account activity logged", async () => {
  const { page, browser } = await launch(seed("user", "Cara", [proj("p1", "csm_review", "u2", review)],
    [task("k1", "p1", "Kickoff"), task("k2", "p1", "Configure", { signoff: "signed", signedBy: "Cara" })]));
  try {
    await openImpl(page);
    await openProject(page, "p1");
    assert(await page.locator("[data-task-signoff]").count() === 1, "signed task still offers sign-off");
    await page.click('[data-task-row="k1"] [data-task-signoff]');
    await page.waitForSelector('[data-project-detail="p1"][data-stage="live"]');
    const s = await state(page);
    const p = s.projects.find(x => x.id === "p1");
    assert(p.stage === "live" && p.liveAt && p.history.at(-1).to === "live", "project " + JSON.stringify(p));
    assert(s.activities.some(a => a.accountId === "a1" && a.system && a.summary.includes("Live")), "no account activity");
  } finally { await browser.close(); }
});

test("impl sign-off: only the account CSM sees controls; implementer sees the returned note", async () => {
  const pr = proj("p1", "csm_review", "u1", review);
  const ts = [task("k1", "p1", "Kickoff", { signoff: "returned", signoffNote: "Logo missing", status: "todo" })];
  for (const [role, name] of [["user", "Bob"], ["impl_user", "Ivy"]]) {
    const { page, browser } = await launch(seed(role, name, [pr], ts));
    try {
      await openImpl(page);
      await openProject(page, "p1");
      assert(await page.locator("[data-task-signoff], [data-task-sendback]").count() === 0, name + " sees sign-off controls");
      assert((await page.locator('[data-task-row="k1"] [data-task-returned]').textContent()).includes("Logo missing"), name + " no note");
    } finally { await browser.close(); }
  }
});

test("impl bell: queued to lead, assigned + returned to implementer, ready for sign-off to CSM; 30-day window; click opens project", async () => {
  const projectsFor = impl => [
    proj("p1", "in_progress", impl, [{ at: NOW, by: "Cara", from: "handover", to: "queued", note: "" }, { at: NOW, by: "Lena", from: "queued", to: "planning", note: "" },
      { at: NOW, by: "Ivy", from: "in_progress", to: "csm_review", note: "" }, { at: NOW, by: "Cara", from: "csm_review", to: "in_progress", note: "Fix" }]),
    proj("p2", "csm_review", impl, [{ at: OLD, by: "Cara", from: "handover", to: "queued", note: "" }, { at: OLD, by: "Lena", from: "queued", to: "planning", note: "" },
      { at: OLD, by: "Ivy", from: "in_progress", to: "csm_review", note: "" }]),
  ];
  const tasks = [task("k1", "p1", "Kickoff", { signoff: "returned", signoffNote: "Fix", status: "todo" })];
  const cases = [["impl_lead", "Lena", ["impl-queued-p1"]], ["impl_user", "Ivy", ["impl-assigned-p1", "impl-returned-k1"]], ["user", "Cara", ["impl-review-p1"]]];
  for (const [role, name, want] of cases) {
    const { page, browser } = await launch(seed(role, name, projectsFor(role === "impl_user" ? "u1" : "u2"), tasks));
    try {
      await page.waitForSelector("[data-bell]");
      const items = (await bellItems(page)).filter(x => x.startsWith("impl-"));
      const got = items.map(x => x.split("::")[0].replace(/-\d{4}-.*$/, "")).sort();
      assert(got.join("|") === want.slice().sort().join("|"), name + " bell " + items.join(" | "));
      if (role === "user") assert(items[0].includes("ready for sign-off"), "text " + items[0]);
      await page.click(`[data-notif-item^="${want[0]}"]`);
      await page.waitForSelector('[data-project-detail="p1"]');
    } finally { await browser.close(); }
  }
});
