// Implementation-page screenshots (Stage 5): board, detail, workload, my tasks in light, dark and 390 phone (dev aid, not a test).
// Usage: node tests/health/_shot-implementation.mjs <out-dir>
import { launch, seedAccount } from "./harness.mjs";
const out = process.argv[2];
const d = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const rows = list => JSON.stringify(list.map(x => ({ id: x.id, data: x })));
const accts = [["a1", "Hooli Media"], ["a2", "Acme Retail India"], ["a3", "Stark Industries"], ["a4", "Soylent Foods"], ["a5", "Wayne Logistics"],
  ["a6", "Globex Corporation"], ["a7", "Umbrella Health"], ["a8", "Initech"]].map(([id, name]) => seedAccount({ id, name, csm: "Cara Mehta" }));
const H = (from, to, at, by, note = "") => ({ from, to, at: at + "T09:00:00.000Z", by, note });
const proj = (id, accountId, stage, implementerId, targetGoLive, o = {}) => ({ id, accountId, type: "onboarding", stage, implementerId, createdBy: "Cara Mehta",
  checklistTemplate: [{ id: "go_live_target", label: "Target go-live", kind: "date", required: true }, { id: "scope", label: "Modules in scope", kind: "text", required: true }],
  checklist: { go_live_target: targetGoLive, scope: "Core + Billing" }, targetGoLive, startedAt: null, liveAt: null, history: [], holdReason: "", ...o });
const projects = [
  proj("q1", "a1", "queued", null, d(40), { type: "expansion" }),
  proj("pl1", "a2", "planning", "u2", d(45)),
  proj("ip1", "a3", "in_progress", "u2", d(9), { startedAt: d(-20) + "T09:00:00.000Z", assignedAt: d(-24), history: [
    H("handover", "queued", d(-26), "Cara Mehta", "Handover submitted"), H("queued", "planning", d(-24), "Boss", "Assigned to Kiran Mehta"),
    H("planning", "in_progress", d(-20), "Kiran Mehta")] }),
  proj("ip2", "a4", "in_progress", "u3", d(-4), { type: "expansion" }),
  proj("cr1", "a5", "csm_review", "u4", d(60)),
  proj("lv1", "a6", "live", "u3", d(-30), { liveAt: d(-20) + "T09:00:00.000Z" }),
  proj("oh1", "a7", "on_hold", "u2", d(30), { holdReason: "Waiting on customer" }),
  proj("hd1", "a8", "handover", null, null),
];
const task = (id, projectId, accountId, title, status, est, logged, ownerId, due, order) => ({ id, projectId, accountId, title, ownerId, due, estHours: est,
  timeLog: logged ? [{ by: "Kiran Mehta", at: d(-5) + "T09:00:00.000Z", hours: logged }] : [], status, signoff: "pending", signoffNote: "", signedBy: null, signedAt: null, order });
const tasks = [
  task("t1", "ip1", "a3", "Kickoff call", "done", 2, 2, "u2", d(-18), 1),
  task("t2", "ip1", "a3", "Configure SSO", "doing", 8, 9, "u2", d(-2), 2),
  task("t3", "ip1", "a3", "Admin training", "todo", 4, 0, "u1", d(-3), 3),
  task("t4", "ip1", "a3", "Go-live readiness check", "todo", 3, 0, "u1", d(16), 4),
  task("t5", "ip2", "a4", "Import historical tickets", "todo", 6, 0, "u1", null, 1),
  task("t6", "ip2", "a4", "Data migration", "doing", 20, 4, "u3", d(12), 2),
  task("t7", "cr1", "a5", "Workflow setup", "done", 10, 10, "u4", d(-1), 1),
];
const seed = theme => `try { localStorage.setItem("onevio.theme", "${theme}"); } catch (e) {}
  window.__seedRows = { accounts: ${rows(accts)}, contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [],
    projects: ${rows(projects)}, project_tasks: ${rows(tasks)},
    profiles: [{ id: "u1", org_id: "org-a", name: "Boss", role: "admin" }, { id: "u2", org_id: "org-a", name: "Kiran Mehta", role: "impl_user" },
      { id: "u3", org_id: "org-a", name: "Neha Singh", role: "impl_user" }, { id: "u4", org_id: "org-a", name: "Arjun Joshi", role: "impl_lead" }] };`;
const settle = page => page.waitForTimeout(700);
for (const [w, h, theme, tag] of [[1440, 900, "light", "light"], [1440, 900, "dark", "dark"], [390, 844, "light", "phone"]]) {
  const { page, browser } = await launch(seed(theme));
  try {
    if (theme !== "light") await page.reload();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('button[title="Implementation"]');
    await page.waitForSelector("[data-board-project]");
    if (w !== 1440) await page.setViewportSize({ width: w, height: h });
    await settle(page);
    await page.screenshot({ path: `${out}/board-${tag}.png`, fullPage: true });
    await page.click('[data-impl-tab="Workload"]'); await page.waitForSelector("[data-workload-table]"); await settle(page);
    await page.screenshot({ path: `${out}/workload-${tag}.png`, fullPage: true });
    await page.click('[data-impl-tab="My tasks"]'); await page.waitForSelector("[data-my-task]"); await settle(page);
    await page.screenshot({ path: `${out}/mytasks-${tag}.png`, fullPage: true });
    await page.click('[data-impl-tab="Board"]'); await page.click('[data-board-project="ip1"]'); await page.waitForSelector('[data-project-detail="ip1"]'); await settle(page);
    await page.screenshot({ path: `${out}/detail-${tag}.png`, fullPage: true });
  } finally { await browser.close(); }
}
console.log("shots written to " + out);
