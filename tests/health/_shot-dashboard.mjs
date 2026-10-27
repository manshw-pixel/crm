// Dashboard screenshot at desktop + phone width with a varied book (dev aid, not a test).
// Usage: node tests/health/_shot-dashboard.mjs <out-dir> [tag]
import { launch, seedAccount } from "./harness.mjs";
const out = process.argv[2], tag = process.argv[3] || "before";
const d = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const accts = [
  seedAccount({ id: "a1", name: "Globex", arr: 240000, csm: "Priya", renewalDate: d(25), licenses: 200, deployedLicenses: 150 }),
  seedAccount({ id: "a2", name: "Initech", arr: 90000, csm: "Rahul", renewalDate: d(50), inputs: { usage: 30, sentiment: 30, tickets: 8, nps: -30 } }),
  seedAccount({ id: "a3", name: "Umbrella", arr: 150000, csm: "Priya", renewalDate: d(80), licenses: 100, deployedLicenses: 40 }),
  seedAccount({ id: "a4", name: "Hooli", arr: 60000, csm: "Rahul", renewalDate: d(200), inputs: { usage: 55, sentiment: 55, tickets: 3, nps: 10 } }),
  seedAccount({ id: "a5", name: "Stark Ind", arr: 320000, csm: "Priya", renewalDate: d(300) }),
];
const tasks = [["t1", "a1", "Send QBR deck", 2, "Priya"], ["t2", "a2", "Exec escalation call", -1, "Rahul"], ["t3", "a3", "Usage review", 5, "Priya"]]
  .map(([id, accountId, title, n, owner]) => ({ id, data: { id, accountId, title, due: d(n), owner, status: "Open", createdAt: d(-10) } }));
const opps = [{ id: "o1", data: { id: "o1", accountId: "a1", name: "Analytics add-on", type: "Upsell", value: 40000, stage: "Proposal", probability: 50, closeDate: d(40) } }];
const projects = [{ id: "p1", data: { id: "p1", accountId: "a3", type: "onboarding", stage: "in_progress", implementerId: null, history: [{ at: d(-20) + "T00:00:00Z", from: "handover", to: "queued" }] } }];
const seed = `window.__seedRows = { accounts: ${JSON.stringify(accts.map(a => ({ id: a.id, data: a })))}, contacts: [], activities: [], tasks: ${JSON.stringify(tasks)},
  opportunities: ${JSON.stringify(opps)}, projects: ${JSON.stringify(projects)}, project_tasks: [], team: [{ id: "u1", data: { name: "Priya" } }, { id: "u2", data: { name: "Rahul" } }], settings: [],
  profiles: [{ id: "u1", org_id: "org-a", name: "Priya", role: "admin" }] };`;
for (const [w, h, name] of [[1440, 900, "desktop"], [390, 844, "mobile"]]) {
  const { page, browser } = await launch(seed);
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(1500);
  const t = page.locator("[data-analytics-toggle]"); if (await t.count()) await t.first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: true });
  await browser.close();
}
