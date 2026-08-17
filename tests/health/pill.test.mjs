import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

// One account (Yellow band, so the seeder records no crossing) plus pre-seeded ♥ tasks.
// seedAccount default inputs → composite score lands in Yellow, so healthBand:"Yellow"
// means cur===prev and the crossing seeder stays idle (no surprise transitions).
function seedWith(tasks) {
  const acct = seedAccount({ id: "t1", name: "Pill Co", healthBand: "Yellow" });
  return `window.__seedRows = { accounts: [${JSON.stringify(acct)}].map(d => ({ id: d.id, data: d })),`
    + ` tasks: ${JSON.stringify(tasks)}.map(d => ({ id: d.id, data: d })),`
    + ` contacts: [], activities: [], opportunities: [], team: [], settings: [] };`;
}

// The default due date must stay in the FUTURE, or the "on pace" case silently becomes the
// "behind pace" case. Hardcoding it made this a time bomb: written against 2026-08-15, it
// went red on 2026-08-16 when the calendar caught up. Compute it relative to today instead.
// Built from LOCAL date parts, not toISOString(), which shifts the day for UTC-behind zones.
const isoInDays = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const hTask = (id, o) => ({ id, accountId: "t1", healthPlaybook: true, healthBand: "Yellow",
  healthFor: "2026-07-25", title: "♥ step " + id, due: isoInDays(30), priority: "Medium", status: "Open", ...o });

async function openAccount(page) {
  await page.click('button[title="Accounts"]');
  await page.getByText("Pill Co").first().waitFor({ timeout: 8000 });
  await page.getByText("Pill Co").first().click();
  // wait until the account-detail header (meta panel) has actually rendered
  await page.waitForFunction(() => /Industry/.test(document.getElementById("root").textContent), { timeout: 8000 });
}

// Reads the pill element's text + className from the rendered account header.
async function pill(page) {
  return page.evaluate(() => {
    const root = document.getElementById("root");
    const el = [...root.querySelectorAll("span")].find(s => /♥\s*\d+\/\d+/.test(s.textContent) && /rounded-full/.test(s.className));
    return el ? { text: el.textContent.trim(), cls: el.className } : null;
  });
}

test("pill shows done/total for the latest episode", async () => {
  const { page, browser } = await launch(seedWith([
    hTask("hpb-t1-Yellow-2026-07-25-hy1", { status: "Done" }),
    hTask("hpb-t1-Yellow-2026-07-25-hy2"),
    hTask("hpb-t1-Yellow-2026-07-25-hy3"),
  ]));
  await openAccount(page);
  const p = await pill(page);
  assert(p, "pill should render when health tasks exist");
  assert(/♥\s*1\/3/.test(p.text), `expected ♥ 1/3, got "${p && p.text}"`);
  // 1 done of 3, none past due (all due 30 days out) → on-pace rose, not amber
  assert(/bg-rose-100/.test(p.cls) && !/bg-amber-100/.test(p.cls), "in-progress on-pace pill should be rose: " + p.cls);
  await browser.close();
});

test("pill turns amber when an open step is past due (behind pace)", async () => {
  const { page, browser } = await launch(seedWith([
    hTask("hpb-t1-Yellow-2026-07-25-hy1", { due: "2026-07-01" }), // past due, open
    hTask("hpb-t1-Yellow-2026-07-25-hy2"),
    hTask("hpb-t1-Yellow-2026-07-25-hy3", { status: "Done" }),
  ]));
  await openAccount(page);
  const p = await pill(page);
  assert(p && /♥\s*1\/3/.test(p.text), `expected ♥ 1/3, got "${p && p.text}"`);
  assert(/bg-amber-100/.test(p.cls), "behind-pace pill should be amber: " + (p && p.cls));
  await browser.close();
});

test("pill turns emerald when all steps done", async () => {
  const { page, browser } = await launch(seedWith([
    hTask("hpb-t1-Yellow-2026-07-25-hy1", { status: "Done" }),
    hTask("hpb-t1-Yellow-2026-07-25-hy2", { status: "Done" }),
  ]));
  await openAccount(page);
  const p = await pill(page);
  assert(p && /♥\s*2\/2/.test(p.text), `expected ♥ 2/2, got "${p && p.text}"`);
  assert(/bg-emerald-100/.test(p.cls), "all-done pill should be emerald: " + (p && p.cls));
  await browser.close();
});

test("no pill when the account has no health tasks", async () => {
  const { page, browser } = await launch(seedWith([]));
  await openAccount(page);
  const p = await pill(page);
  assert(p === null, "pill must not render without health tasks");
  await browser.close();
});

test("header meta panel renders labeled facts", async () => {
  const { page, browser } = await launch(seedWith([]));
  await openAccount(page);
  const txt = await rootText(page);
  // labels are uppercased via CSS (class "uppercase"), so DOM text is title-case
  for (const label of ["Tier", "Industry", "ARR", "CSM"]) {
    assert(txt.includes(label), `meta label ${label} should render in the account header`);
  }
  await browser.close();
});
