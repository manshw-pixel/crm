// Light-mode regression proof for the dark-mode token change. Screenshots the same seeded
// screens from a BASELINE build and the CURRENT dist/crm.html and compares PNG hashes.
// Identical pixels encode to identical PNGs in the same browser, so equal hashes = no change.
//   node tests/visual/light-diff.mjs capture <dir>   # writes <dir>/<screen>.png from dist
//   node tests/visual/light-diff.mjs compare <dirA> <dirB>
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { launch, seedAccount } from "../health/harness.mjs";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const A = [
  seedAccount({ id: "a1", name: "Acme Holdings", csm: "Test User", renewalDate: day(12), healthBand: "Red", inputs: { usage: 10, sentiment: 10, tickets: 8, nps: -60 } }),
  seedAccount({ id: "a2", name: "Beta Corp", csm: "Test User", renewalDate: day(40), contractStatus: "Churn risk" }),
  seedAccount({ id: "a3", name: "Gamma Ltd", csm: "Priya", arr: 250000, currency: "INR" }),
];
const seed = `window.__seedRows = { accounts: ${JSON.stringify(A.map(d => ({ id: d.id, data: d })))},
  contacts: [], activities: [], tasks: [{ id: "t1", data: { id: "t1", accountId: "a1", title: "Call", due: "${day(1)}", status: "Open", owner: "Test User", priority: "High" } }],
  opportunities: [], team: [], settings: [] };`;
// [name, width, how to reach it]
const SCREENS = [
  ["dashboard-1280", 1280, async () => {}],
  ["accounts-1280", 1280, async p => p.click('button[title="Accounts"]')],
  ["account-1280", 1280, async p => { await p.click('button[title="Accounts"]'); await p.getByText("Acme Holdings").first().click(); }],
  ["tasks-1280", 1280, async p => p.click('button[title="Tasks"]')],
  ["renewals-1280", 1280, async p => p.click('button[title="Renewals"]')],
  ["settings-1280", 1280, async p => p.click('button[title="Settings"]')],
  ["dashboard-390", 390, async () => {}],
];

async function capture(dir) {
  mkdirSync(dir, { recursive: true });
  for (const [name, w, go] of SCREENS) {
    const { page, browser } = await launch(seed);
    try {
      await page.setViewportSize({ width: w, height: 900 });
      await page.clock.setFixedTime(new Date("2026-10-07T12:00:00Z"));
      await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 3);
      await go(page);
      await page.waitForTimeout(800); // let layout, fonts and the skeleton fade settle
      await page.addStyleTag({ content: "*{animation:none!important;transition:none!important;caret-color:transparent!important}" });
      await page.screenshot({ path: join(dir, name + ".png"), fullPage: true });
    } finally { await browser.close(); }
  }
}
function compare(a, b) {
  const h = f => createHash("sha256").update(readFileSync(f)).digest("hex");
  const diff = readdirSync(a).filter(f => f.endsWith(".png")).filter(f => h(join(a, f)) !== h(join(b, f)));
  console.log(diff.length ? "CHANGED: " + diff.join(", ") : "IDENTICAL: all screens");
  process.exit(diff.length ? 1 : 0);
}
const [cmd, x, y] = process.argv.slice(2);
if (cmd === "capture") await capture(x); else if (cmd === "compare") compare(x, y);
else { console.error("usage: capture <dir> | compare <dirA> <dirB>"); process.exit(2); }
