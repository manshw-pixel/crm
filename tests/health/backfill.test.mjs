import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

// Score inputs chosen to land in each band (same values the crossing tests rely on).
const GREEN  = { usage: 90, sentiment: 90, tickets: 0,  nps: 60 };
const YELLOW = { usage: 55, sentiment: 55, tickets: 3,  nps: 0 };
const RED    = { usage: 15, sentiment: 15, tickets: 20, nps: -80 };

// A mixed book covering every candidate/non-candidate case in the spec.
export const MIXED = [
  seedAccount({ id: "a1", name: "Never Red",   inputs: RED,    healthBand: "Red" }),
  seedAccount({ id: "a2", name: "Never Yellow", inputs: YELLOW, healthBand: "Yellow" }),
  seedAccount({ id: "a3", name: "Seeded Yellow", inputs: YELLOW, healthBand: "Yellow", healthPlaybookBand: "Yellow" }),
  seedAccount({ id: "a4", name: "Churned Red",  inputs: RED,    healthBand: "Red", churn: true }),
  seedAccount({ id: "a5", name: "Healthy",      inputs: GREEN,  healthBand: "Green" }),
];

export function seedBook(accts) {
  return `window.__seedRows = { accounts: ${JSON.stringify(accts)}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
}
export const wait = page => page.waitForFunction(() => window.__store && window.__store.getState().accounts.length);

test("backfillCandidates selects non-churned Yellow/Red only", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  const ids = await page.evaluate(() => {
    const scored = [
      { id: "a1", risk: "Red",    churn: false },
      { id: "a2", risk: "Yellow", churn: false },
      { id: "a3", risk: "Yellow", churn: false },
      { id: "a4", risk: "Red",    churn: true },
      { id: "a5", risk: "Green",  churn: false },
    ];
    return window.__health.backfillCandidates(scored).map(a => a.id);
  });
  assert(ids.join(",") === "a1,a2,a3", "wrong candidates: " + ids.join(","));
  await browser.close();
});

const openSettings = async page => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForFunction(() => document.querySelector("#root")?.textContent.includes("Health playbook"));
};

test("backfill card reports the never-seeded / already-seeded split", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  await openSettings(page);
  const txt = await rootText(page);
  assert(/3 at-risk accounts/.test(txt), "candidate count missing: " + txt.slice(0, 400));
  assert(/2 never seeded/.test(txt), "never-seeded count missing");
  assert(/1 already ha(s|ve) a playbook/.test(txt), "already-seeded count missing");
  await browser.close();
});

test("backfill requires confirmation and Cancel writes nothing", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  await openSettings(page);
  await page.getByRole("button", { name: "Seed playbooks now" }).click();
  await page.waitForFunction(() => document.querySelector("#root")?.textContent.includes("Confirm — seed 3 accounts?"));
  const midway = await page.evaluate(() => window.__store.getState().tasks.filter(t => t.healthPlaybook).length);
  assert(midway === 0, "clicking the button must not write before confirmation: " + midway);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForFunction(() => document.querySelector("#root")?.textContent.includes("Seed playbooks now"));
  const after = await page.evaluate(() => window.__store.getState().tasks.filter(t => t.healthPlaybook).length);
  assert(after === 0, "Cancel must not write: " + after);
  await browser.close();
});

test("backfill card disables the button when nothing is at risk", async () => {
  const { page, browser } = await launch(seedBook([seedAccount({ id: "a5", inputs: GREEN, healthBand: "Green" })]));
  await wait(page);
  await openSettings(page);
  const txt = await rootText(page);
  assert(/No at-risk accounts/.test(txt), "empty-state copy missing: " + txt.slice(0, 400));
  const disabled = await page.getByRole("button", { name: "Seed playbooks now" }).isDisabled();
  assert(disabled, "button should be disabled with zero candidates");
  await browser.close();
});

const confirmBackfill = async page => {
  await page.getByRole("button", { name: "Seed playbooks now" }).click();
  await page.getByRole("button", { name: /^Confirm — seed \d+ accounts\?$/ }).click();
  await page.waitForFunction(() => /Seeded \d+ accounts/.test(document.querySelector("#root")?.textContent || ""));
};

test("backfill seeds tasks for every at-risk account and skips the rest", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  await openSettings(page);
  await confirmBackfill(page);
  const r = await page.evaluate(() => {
    const s = window.__store.getState();
    const byAcct = id => s.tasks.filter(t => t.healthPlaybook && t.accountId === id);
    return {
      a1: byAcct("a1").map(t => t.id), a2: byAcct("a2").length, a3: byAcct("a3").length,
      a4: byAcct("a4").length, a5: byAcct("a5").length,
      a1owner: byAcct("a1")[0]?.owner, a1title: byAcct("a1")[0]?.title,
      a1status: byAcct("a1")[0]?.status,
    };
  });
  assert(r.a1.length === 3 && r.a1.every(id => /^hpb-a1-Red-\d{4}-\d{2}-\d{2}-hr\d$/.test(id)), "a1 task ids wrong: " + r.a1);
  assert(r.a2 === 3, "a2 should get 3 Yellow tasks, got " + r.a2);
  assert(r.a3 === 3, "already-seeded a3 should be re-seeded, got " + r.a3);
  assert(r.a4 === 0, "churned a4 must be skipped, got " + r.a4);
  assert(r.a5 === 0, "healthy a5 must be skipped, got " + r.a5);
  assert(r.a1owner === "Priya", "task owner should be the CSM, got " + r.a1owner);
  assert(r.a1title.startsWith("♥ "), "task title not marked: " + r.a1title);
  assert(r.a1status === "Open", "task status should be Open, got " + r.a1status);
  await browser.close();
});

test("backfill writes one synthetic event per candidate, tagged backfill", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  await openSettings(page);
  await confirmBackfill(page);
  const r = await page.evaluate(() => {
    const s = window.__store.getState();
    const ev = id => (s.accounts.find(a => a.id === id).healthEvents || []);
    return { a1: ev("a1"), a3: ev("a3").length, a4: ev("a4").length, a5: ev("a5").length,
      a1pb: s.accounts.find(a => a.id === "a1").healthPlaybookBand };
  });
  assert(r.a1.length === 1, "a1 should have exactly one event, got " + r.a1.length);
  assert(r.a1[0].from === "Green" && r.a1[0].to === "Red", "a1 event bands wrong: " + JSON.stringify(r.a1[0]));
  assert(r.a1[0].source === "backfill", "a1 event not tagged: " + JSON.stringify(r.a1[0]));
  assert(r.a3 === 1, "a3 should gain one event, got " + r.a3);
  assert(r.a4 === 0 && r.a5 === 0, "churned/healthy accounts must gain no events");
  assert(r.a1pb === "Red", "a1 healthPlaybookBand should be Red, got " + r.a1pb);
  await browser.close();
});

test("auto-seeder adds nothing after a backfill, and a same-day re-run is idempotent", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  await openSettings(page);
  await confirmBackfill(page);
  await page.waitForTimeout(600);   // let the auto-seeder effect re-run on the new bands
  const first = await page.evaluate(() => window.__store.getState().tasks.filter(t => t.healthPlaybook).length);
  assert(first === 9, "expected 9 tasks after backfill + settled effects, got " + first);
  await confirmBackfill(page);
  await page.waitForTimeout(600);
  const second = await page.evaluate(() => window.__store.getState().tasks.filter(t => t.healthPlaybook).length);
  assert(second === 9, "same-day re-run must not add tasks, got " + second);
  await browser.close();
});

test("a same-day re-run does not duplicate backfill events", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  await openSettings(page);
  await confirmBackfill(page);
  await page.waitForTimeout(600);
  await confirmBackfill(page);
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const s = window.__store.getState();
    const backfillEvents = id => (s.accounts.find(a => a.id === id).healthEvents || [])
      .filter(ev => ev.source === "backfill");
    return {
      a1: backfillEvents("a1").length, a2: backfillEvents("a2").length, a3: backfillEvents("a3").length,
      tasks: s.tasks.filter(t => t.healthPlaybook).length,
    };
  });
  assert(r.a1 === 1, "a1 should have exactly one backfill event after two same-day runs, got " + r.a1);
  assert(r.a2 === 1, "a2 should have exactly one backfill event after two same-day runs, got " + r.a2);
  assert(r.a3 === 1, "a3 should have exactly one backfill event after two same-day runs, got " + r.a3);
  assert(r.tasks === 9, "total tasks should still be 9, got " + r.tasks);
  await browser.close();
});

test("backfilled accounts appear in the dashboard Recently-declined card", async () => {
  const { page, browser } = await launch(seedBook(MIXED));
  await wait(page);
  await openSettings(page);
  await confirmBackfill(page);
  await page.getByRole("button", { name: "Dashboard" }).click();
  await page.waitForFunction(() => document.querySelector("#root")?.textContent.includes("Recently declined"));
  const txt = await rootText(page);
  assert(/Never Red/.test(txt), "backfilled account missing from Recently declined: " + txt.slice(0, 600));
  assert(!/Churned Red/.test(txt), "churned account must not appear as recently declined");
  await browser.close();
});
