// Stage 6 screenshots: Tasks, Renewals board, Renewals table (+ board with 0-30 active) in light, dark and 390 phone (dev aid, not a test).
// Usage: node tests/health/_shot-stage6.mjs <out-dir>
import { mkdirSync } from "node:fs";
import { launch, seedAccount } from "./harness.mjs";
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const d = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const rows = list => JSON.stringify(list.map(x => ({ id: x.id, data: x })));
const first = new Date(); first.setDate(1);
const pastDue = (() => { const p = new Date(first.getFullYear(), first.getMonth(), -4); return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}-${String(p.getDate()).padStart(2, "0")}`; })();
const accts = [
  seedAccount({ id: "r15", name: "Soylent Foods", arr: 38000, renewalDate: d(15), renewalStage: "Quote sent", csm: "Priya", inputs: { usage: 10, sentiment: 10, tickets: 9, nps: -50 } }),
  seedAccount({ id: "r25", name: "Globex Corporation", arr: 240000, renewalDate: d(25), renewalStage: "Negotiating", csm: "Priya" }),
  seedAccount({ id: "r50", name: "Initech Software", arr: 90000, renewalDate: d(50), renewalStage: "Outreach", csm: "Marco", inputs: { usage: 40, sentiment: 40, tickets: 3, nps: 0 } }),
  seedAccount({ id: "r65", name: "Wayne Logistics", arr: 118000, renewalDate: d(65), renewalStage: "Committed", csm: "Priya" }),
  seedAccount({ id: "r80", name: "Umbrella Health", arr: 150000, renewalDate: d(80), renewalStage: "At risk", csm: "Marco" }),
  seedAccount({ id: "r115", name: "Acme Retail India", arr: 74000, renewalDate: d(115), csm: "Priya" }),
  seedAccount({ id: "r195", name: "Hooli Media", arr: 60000, renewalDate: d(195), csm: "Marco" }),
  seedAccount({ id: "rpast", name: "Overdue Renewal Co", arr: 55000, renewalDate: pastDue, csm: "Priya" }),
];
const tasks = [
  { id: "t1", accountId: "r15", title: "▶ Send renewal quote", due: d(-19), priority: "High", status: "Open", owner: "Priya", playbook: true, renewalFor: d(15) },
  { id: "t2", accountId: "r50", title: "♥ Escalate to exec", due: d(-2), priority: "Medium", status: "Open", owner: "Priya", healthPlaybook: true },
  { id: "t3", accountId: "r25", title: "Call the champion", due: d(0), priority: "Medium", status: "Open", owner: "Priya" },
  { id: "t4", accountId: "r65", title: "Weekly check-in", due: d(3), priority: "Low", status: "Open", owner: "Marco" },
  { id: "t5", accountId: "r80", title: "Plan expansion", due: d(20), priority: "Low", status: "Open", owner: "Priya" },
  { id: "t6", accountId: "r115", title: "Old finished thing", due: d(-9), priority: "Low", status: "Done", owner: "Priya" },
];
const seed = theme => `try { localStorage.setItem("onevio.theme", "${theme}"); localStorage.setItem("onevio.renewals.view", "board"); } catch (e) {}
  window.__seedRows = { accounts: ${rows(accts)}, contacts: [], activities: [], tasks: ${rows(tasks)}, opportunities: [], team: [], settings: [] };
  window.__seedProfile = { id: "u1", org_id: "org-a", name: "Priya", role: "admin" };`;
const settle = page => page.waitForTimeout(700);
for (const [w, h, theme, tag] of [[1440, 900, "light", "light"], [1440, 900, "dark", "dark"], [390, 844, "light", "phone"]]) {
  const { page, browser } = await launch(seed(theme));
  try {
    if (theme !== "light") await page.reload();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => window.__store && window.__store.getState().tasks.length >= 6);
    await page.click('button[title="Tasks"]');
    await page.waitForSelector("[data-task-row]");
    if (w !== 1440) await page.setViewportSize({ width: w, height: h });
    await settle(page);
    await page.screenshot({ path: `${out}/tasks-${tag}.png`, fullPage: true });
    if (w !== 1440) await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('button[title="Renewals"]');
    await page.waitForSelector("[data-col-month]");
    if (w !== 1440) await page.setViewportSize({ width: w, height: h });
    await settle(page);
    await page.screenshot({ path: `${out}/renewals-board-${tag}.png`, fullPage: true });
    if (tag === "light") {
      await page.click('[data-renewal-window="0-30"]');
      await page.waitForSelector("[data-window-filter]");
      await settle(page);
      await page.screenshot({ path: `${out}/renewals-board-0-30-${tag}.png`, fullPage: true });
      await page.click('[data-renewal-window="0-30"]');
    }
    await page.click('[data-renewals-view="table"]');
    await page.waitForSelector("[data-renewals-table]");
    await settle(page);
    await page.screenshot({ path: `${out}/renewals-table-${tag}.png`, fullPage: true });
    console.log("shot", tag);
  } finally { await browser.close(); }
}
