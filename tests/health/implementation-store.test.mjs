import { test, assert } from "./framework.mjs";
import { launchPersistent, launch, seedAccount, rootText } from "./harness.mjs";

// The implementation tables and settings keys must survive a fetchAll round trip, and the
// new write path (merge_row, with appends for history/timeLog) must reach the stateful store.

const A = seedAccount({ id: "a1", name: "Impl Co", csm: "Test User" });
const CHECKLIST = [{ id: "x", label: "Custom item", kind: "text", required: true }];
const PROJECT = { id: "p1", accountId: "a1", type: "onboarding", stage: "csm_review", implementerId: "u1", createdBy: "u1",
  checklistTemplate: CHECKLIST, checklist: {}, targetGoLive: "2027-03-01", startedAt: "2026-09-01T00:00:00.000Z", liveAt: null, history: [], holdReason: null };
const TASK = (id, signoff) => ({ id, projectId: "p1", accountId: "a1", title: id, ownerId: "u1", due: "2027-02-01", estHours: 4,
  timeLog: [], status: "done", signoff, signoffNote: "", signedBy: null, signedAt: null, order: 1 });
const seed = `window.__seedRows = {
  accounts: ${JSON.stringify([A])}.map(d => ({ id: d.id, data: d })),
  contacts: [], activities: [], tasks: [], opportunities: [],
  projects: ${JSON.stringify([PROJECT])}.map(d => ({ id: d.id, data: d })),
  project_tasks: ${JSON.stringify([TASK("k1", "signed"), TASK("k2", "pending")])}.map(d => ({ id: d.id, data: d })),
  settings: [{ id: "1", data: ${JSON.stringify({ implChecklist: CHECKLIST, implPlanTemplates: [{ name: "Std" }], implCapacity: { u1: 20 } })} }],
  team: [], profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "admin" }] };`;

const read = page => page.evaluate(() => {
  const s = window.__store.getState();
  return { projects: s.projects, tasks: s.projectTasks, settings: s.settings, activities: s.activities };
});

test("projects, project tasks and the three impl settings keys survive load and reload", async () => {
  const { page, browser, reload } = await launchPersistent(seed);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    const first = await read(page);
    assert(first.projects.length === 1 && first.projects[0].id === "p1", "project loaded");
    assert(first.tasks.map(t => t.id).sort().join() === "k1,k2", "tasks loaded");
    assert(first.settings.implChecklist[0].id === "x", "implChecklist survives fetchAll");
    assert(first.settings.implCapacity.u1 === 20 && first.settings.implPlanTemplates[0].name === "Std", "capacity + templates survive");
    await reload();
    await page.waitForFunction(() => window.__store && window.__store.getState().projects.length === 1);
    const again = await read(page);
    assert(again.settings.implChecklist[0].id === "x", "implChecklist survives a reload");
  } finally { await browser.close(); }
});

test("settings default to the 8-item checklist, empty templates and capacity when nothing is saved", async () => {
  const bare = seed.replace(/ settings: \[\{ id: "1".*\n/, " settings: [],\n");
  assert(bare !== seed, "the bare seed must drop the saved settings row");
  const { page, browser } = await launchPersistent(bare);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    const s = (await read(page)).settings;
    assert(s.implChecklist.length === 8, `default checklist has 8 items, got ${s.implChecklist.length}`);
    assert(Array.isArray(s.implPlanTemplates) && s.implPlanTemplates.length === 0, "templates default []");
    assert(Object.keys(s.implCapacity).length === 0, "capacity default {}");
  } finally { await browser.close(); }
});

test("SIGNOFF_TASK and LOG_TASK_TIME persist: task, project stage, history append, timeLog append, system activity", async () => {
  const { page, browser, reload } = await launchPersistent(seed);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().projects.length === 1);
    await page.evaluate(async () => {
      const { dispatch } = window.__store;
      dispatch({ type: "LOG_TASK_TIME", id: "k2", entry: { by: "Test User", at: "2026-10-01", hours: 3 } });
      dispatch({ type: "SIGNOFF_TASK", taskId: "k2", verdict: "returned", note: "redo", actor: { id: "u1", name: "Test User", role: "admin" }, now: "2026-10-02T09:00:00.000Z" });
      await new Promise(r => setTimeout(r, 300));
    });
    await reload();
    await page.waitForFunction(() => window.__store && window.__store.getState().projects.length === 1);
    const s = await read(page);
    const k1 = s.tasks.find(t => t.id === "k1"), k2 = s.tasks.find(t => t.id === "k2");
    assert(k1.signoff === "signed", "the already-signed task stays signed");
    assert(k2.signoff === "returned" && k2.status === "todo" && k2.signoffNote === "redo", `k2 returned, got ${JSON.stringify(k2)}`);
    assert(k2.timeLog.length === 1 && k2.timeLog[0].hours === 3, "timeLog entry persisted");
    assert(s.projects[0].stage === "in_progress", `project back to in_progress, got ${s.projects[0].stage}`);
    assert(s.projects[0].history.length === 1 && s.projects[0].history[0].to === "in_progress", "history appended once");
    assert(s.activities.some(a => a.accountId === "a1" && a.system === true), "system activity persisted on the account");
  } finally { await browser.close(); }
});

test("DELETE_ACCOUNT removes the account's projects and tasks from the store", async () => {
  const { page, browser } = await launchPersistent(seed);
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().projects.length === 1);
    const db = await page.evaluate(async () => {
      window.__store.dispatch({ type: "DELETE_ACCOUNT", id: "a1" });
      await new Promise(r => setTimeout(r, 300));
      const d = window.__dump();
      return { projects: d.projects.length, tasks: d.project_tasks.length };
    });
    assert(db.projects === 0 && db.tasks === 0, `cascade reached the store, got ${JSON.stringify(db)}`);
  } finally { await browser.close(); }
});

const plain = pre => `${pre}window.__seedRows = { accounts: ${JSON.stringify([seedAccount({ name: "Loaded Co" })])}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("a missing projects table (SQL not re-run) loads the CRM with empty projects", async () => {
  for (const err of [{ code: "42P01", message: 'relation "public.projects" does not exist' }, { code: "PGRST205", message: "Could not find the table in the schema cache" }]) {
    const { page, browser } = await launch(plain(`window.__tableError = { projects: ${JSON.stringify(err)}, project_tasks: ${JSON.stringify(err)} };`));
    try {
      await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1, null, { timeout: 8000 });
      const s = await read(page);
      assert(s.projects.length === 0 && s.tasks.length === 0, "projects and tasks empty");
      assert(/Loaded Co/.test(await rootText(page)), "the CRM data rendered");
    } finally { await browser.close(); }
  }
});

test("any other error on the projects table fails the load like the other tables", async () => {
  const { page, browser } = await launch(plain('window.__tableError = { projects: { code: "42501", message: "permission denied for table projects" } };'));
  try {
    await page.waitForFunction(() => /Fresh start/.test(document.getElementById("root").textContent), null, { timeout: 8000 });
    const n = await page.evaluate(() => window.__store.getState().accounts.length);
    assert(n === 0, `a hard error must not load partial data, got ${n} accounts`);
  } finally { await browser.close(); }
});
