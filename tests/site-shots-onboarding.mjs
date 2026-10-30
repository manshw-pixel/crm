// Onboarding (Implementation) screenshots for onevio.in. Renders the built CRM (dist/crm.html)
// against an ENTIRELY FICTIONAL book and writes 2x PNGs to site-shots/, next to the ones
// tests/site-shots.mjs makes. Run `npm run build` first.
//   npm run build && node tests/site-shots-onboarding.mjs
// All names, people and figures below are invented. Nothing here comes from live data.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildMockedHtml, seedAccount } from "./health/harness.mjs";

const OUT = fileURLToPath(new URL("../site-shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const CHANNEL = process.env.CRM_TEST_CHANNEL ?? "msedge";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const at = n => new Date(Date.now() + n * 864e5).toISOString();

// ---- accounts (fictional) ----
const NAMES = [
  ["Northwind Logistics", "Priya"], ["Brightline Health", "Rahul"], ["Kestrel Analytics", "Ananya"], ["Harbor & Pine", "Priya"],
  ["Lumen Freight", "Rahul"], ["Corvid Labs", "Ananya"], ["Meridian Textiles", "Priya"], ["Tidewater Energy", "Ananya"],
  ["Zephyr Payments", "Rahul"], ["Ostrava Robotics", "Ananya"], ["Marigold Foods", "Rahul"], ["Juniper Labs", "Priya"],
];
const accounts = NAMES.map(([name, csm], i) => seedAccount({ id: `a${i + 1}`, accountNo: i + 1, name, csm, arr: 60000 + i * 17000 }));

// ---- people: CSMs, an implementation lead and two implementers ----
const profiles = [
  { id: "u1", name: "Priya", role: "user", org_id: "org-a", platform_admin: false },
  { id: "u2", name: "Rahul", role: "user", org_id: "org-a", platform_admin: false },
  { id: "u3", name: "Ananya", role: "user", org_id: "org-a", platform_admin: false },
  { id: "u4", name: "Lena", role: "impl_lead", org_id: "org-a", platform_admin: false },
  { id: "u5", name: "Ivan", role: "impl_user", org_id: "org-a", platform_admin: false },
  { id: "u6", name: "Maya", role: "impl_user", org_id: "org-a", platform_admin: false },
];

const CHECKLIST = [
  { id: "order_form", label: "Signed order form attached", kind: "check", required: true },
  { id: "go_live_target", label: "Go-live target date", kind: "date", required: true },
  { id: "customer_contact", label: "Customer project contact", kind: "text", required: true },
  { id: "modules_scope", label: "Modules / scope purchased", kind: "text", required: true },
  { id: "licences", label: "Licences sold", kind: "text", required: false },
  { id: "commitments", label: "Special commitments made in the sale", kind: "text", required: false },
  { id: "integrations", label: "Integrations required", kind: "text", required: false },
  { id: "kickoff", label: "Kickoff call scheduled", kind: "check", required: false },
];
const STEPS = ["handover", "queued", "planning", "in_progress", "csm_review", "live"];
const hist = (stage, ago) => {
  const to = STEPS.indexOf(stage), out = [];
  for (let k = 1; k <= to; k++) out.push({ at: at(-ago + (k - 1) * 4), by: k === 1 ? "Priya" : k === 2 ? "Lena" : k === 5 ? "Priya" : "Ivan", from: STEPS[k - 1], to: STEPS[k], note: k === 1 ? "Handover submitted" : "" });
  return out;
};
const proj = (id, acc, stage, impl, goLive, ago, o = {}) => ({
  id, accountId: acc, type: "onboarding", stage, implementerId: impl, createdBy: "Priya",
  checklistTemplate: CHECKLIST, checklist: { order_form: true, go_live_target: day(goLive), customer_contact: "Project lead", modules_scope: "Core + Analytics", licences: "250", kickoff: true },
  targetGoLive: day(goLive), startedAt: STEPS.indexOf(stage) >= 3 ? at(-ago + 8) : null, liveAt: stage === "live" ? at(-3) : null,
  history: hist(stage === "on_hold" ? "planning" : stage, ago).concat(stage === "on_hold" ? [{ at: at(-5), by: "Lena", from: "planning", to: "on_hold", note: "Customer paused for a re-org" }] : []),
  holdReason: stage === "on_hold" ? "Customer paused for a re-org" : "", assignedAt: impl ? at(-ago + 4) : undefined, ...o,
});
const projects = [
  proj("p1", "a2", "queued", null, 70, 3), proj("p2", "a5", "queued", null, 84, 2),
  proj("p3", "a3", "planning", "u6", 60, 10), proj("p4", "a9", "planning", "u5", 75, 8),
  proj("p5", "a1", "in_progress", "u5", 28, 40), proj("p6", "a8", "in_progress", "u6", 35, 30), proj("p7", "a10", "in_progress", "u6", 45, 26, { type: "expansion" }),
  proj("p8", "a4", "csm_review", "u5", 6, 55),
  proj("p9", "a6", "live", "u6", -4, 80), proj("p10", "a11", "live", "u5", -12, 95),
  proj("p11", "a7", "on_hold", "u6", 90, 20),
];

// ---- plan tasks with logged hours ----
const tasks = [];
const T = (projectId, title, ownerId, est, logged, status, o = {}) => {
  const p = projects.find(x => x.id === projectId);
  tasks.push({ id: `k${tasks.length + 1}`, projectId, accountId: p.accountId, title, ownerId, due: day(o.due ?? 10), estHours: est,
    timeLog: logged.map((h, j) => ({ id: `l${tasks.length}-${j}`, hours: h, by: ownerId === "u6" ? "Maya" : ownerId === "u4" ? "Lena" : "Ivan", at: at(-20 + j * 3), note: "" })),
    status, signoff: o.signoff || "pending", signoffNote: o.note || "", signedBy: o.signoff === "signed" ? "Priya" : null, signedAt: o.signoff === "signed" ? at(-1) : null, order: tasks.length + 1 });
};
// p5 Northwind: the plan we showcase, mid-flight
T("p5", "Kickoff call and success criteria", "u5", 3, [3], "done", { due: -24 });
T("p5", "Configure depots and user roles", "u5", 8, [4, 3.5], "done", { due: -12 });
T("p5", "Import historic shipments", "u5", 10, [4, 2], "doing", { due: 4 });
T("p5", "Build dispatch dashboards", "u5", 6, [1.5], "doing", { due: 9 });
T("p5", "SSO and API integration", "u5", 5, [], "todo", { due: 14 });
T("p5", "Admin training for 3 regions", "u5", 4, [], "todo", { due: 21 });
// p8 Harbor & Pine: in CSM review
T("p8", "Kickoff call and success criteria", "u5", 2, [2], "done", { due: -40, signoff: "signed" });
T("p8", "Configure stores and roles", "u5", 6, [3, 3.5], "done", { due: -26, signoff: "signed" });
T("p8", "Point-of-sale data import", "u5", 8, [5, 2.5], "done", { due: -14 });
T("p8", "Store manager training", "u5", 4, [4], "done", { due: -5 });
// a few tasks elsewhere so the board counts look real
T("p6", "Kickoff call", "u6", 2, [2], "done"); T("p6", "Configure field teams", "u6", 6, [3], "doing"); T("p6", "Data import", "u6", 8, [], "todo");
T("p7", "Scope new business unit", "u6", 3, [3], "done"); T("p7", "Add 120 seats", "u6", 2, [], "todo");
for (const pid of ["p9", "p10"]) { T(pid, "Kickoff call", "u6", 2, [2], "done", { signoff: "signed" }); T(pid, "Configure and import", "u6", 8, [8], "done", { signoff: "signed" }); T(pid, "Training", "u6", 4, [4], "done", { signoff: "signed" }); }

const settings = { implPlanTemplates: [{ name: "Standard onboarding", tasks: [{ title: "Kickoff call", estHours: 2 }, { title: "Configure", estHours: 6 }, { title: "Training", estHours: 4 }] }] };

const wrap = r => ({ id: r.id, data: r });
// The mock signs in as profile id "u1", so swap ids to sign in as `me` (references swap with them).
const asMe = (json, id) => id === "u1" ? json : json.replace(new RegExp(`"(u1|${id})"`, "g"), (_, m) => m === "u1" ? `"${id}"` : '"u1"');
const seed = me => `window.__seedRows = ${asMe(JSON.stringify({
  accounts: accounts.map(wrap), contacts: [], activities: [], tasks: [], opportunities: [], team: [],
  projects: projects.map(wrap), project_tasks: tasks.map(wrap),
  settings: [{ id: "settings", data: settings }], profiles,
  orgs: [{ id: "org-a", name: "Acme Analytics", max_accounts: null, max_users: null }],
}), me.id)};`;

const browser = await chromium.launch({ channel: CHANNEL || undefined, headless: true });
const results = [], errors = [];
const open = async (me, collapsed = false) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce", colorScheme: "light", bypassCSP: true });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(String(e)));
  await page.addInitScript(c => { try { localStorage.setItem("onevio.theme", "light"); localStorage.setItem("crm-nav", c ? "1" : "0"); } catch (e) {} }, collapsed);
  await page.goto(buildMockedHtml(seed(me)));
  await page.waitForFunction(n => window.__store && window.__store.getState().accounts.length === n, accounts.length, { timeout: 20000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  return page;
};
const settle = async page => {
  await page.waitForTimeout(400);
  const bad = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map(e => e.textContent).filter(t => /fail|error|could not|rolled back/i.test(t)));
  if (bad.length) throw new Error("error toast on screen: " + bad.join(" | "));
};
const shot = async (page, name) => { await settle(page); await page.screenshot({ path: OUT + name + ".png" }); results.push(name + ".png"); };
const openImpl = async page => { await page.click('button[title="Implementation"]'); await page.waitForSelector('[data-impl-tab="Board"]'); };
const openProject = async (page, id) => { await page.click(`[data-board-project="${id}"]`); await page.waitForSelector(`[data-project-detail="${id}"]`); };
const top = page => page.evaluate(() => window.scrollTo(0, 0));

try {
  // 1. Board, as the implementation lead
  // sidebar collapsed so all five stage columns fit at 1440
  let page = await open(profiles[3], true);
  await openImpl(page); await top(page);
  await shot(page, "customer-onboarding-board");
  // 3. Project plan with logged hours, as the implementer
  await page.context().close();
  page = await open(profiles[4]);
  await openImpl(page); await openProject(page, "p5"); await top(page);
  await shot(page, "onboarding-project-plan");
  await page.context().close();

  // 2. Handover checklist with one required item missing, as the CSM
  page = await open(profiles[0]);
  await page.click('button[title="Accounts"]');
  await page.waitForSelector("[data-account-row]");
  await page.click('[data-account-row]:has-text("Juniper Labs")');
  await page.waitForSelector("[data-header-card]");
  await page.click("[data-new-project]");
  const f = page.locator("[data-handover-form]");
  await f.locator('[data-checklist-item="order_form"] input').check();
  await f.locator('[data-checklist-item="go_live_target"] input').fill(day(60));
  await f.locator('[data-checklist-item="customer_contact"] input').fill("Head of Operations");
  await f.locator('[data-checklist-item="licences"] input').fill("70");
  await f.locator('[data-checklist-item="integrations"] input').fill("SSO, data warehouse export");
  await page.click('[data-handover-form] button[type="submit"]');
  await page.waitForSelector("[data-handover-error]");
  await page.evaluate(() => { const r = document.querySelector("[data-handover-form]").getBoundingClientRect(); window.scrollBy(0, r.top - 160); });
  await shot(page, "onboarding-handover-checklist");

  // 4. CSM sign-off on a project in CSM review (Priya is the account's CSM)
  await openImpl(page); await openProject(page, "p8"); await top(page);
  await shot(page, "onboarding-csm-signoff");
  await page.context().close();
  if (errors.length) console.warn("page errors:", errors);
} finally {
  await browser.close();
}
console.log("wrote", results.length, "files to", OUT + "\n" + results.join("\n"));
