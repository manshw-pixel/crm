import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// Drives the reducer through the app by exposing dispatch on window (added in Step 4).
const seed = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("SEED_HEALTH_PLAYBOOK records event, band, and tasks", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length);
  const res = await page.evaluate(async () => {
    window.__store.dispatch({ type: "SEED_HEALTH_PLAYBOOK", id: "t1",
      healthBand: "Yellow", healthPlaybookBand: "Yellow",
      event: { date: "2026-07-28", from: "Green", to: "Yellow" },
      items: [{ id: "hpb-t1-Yellow-2026-07-28-hy1", accountId: "t1", healthPlaybook: true, title: "♥ x", status: "Open" }] });
    await new Promise(r => setTimeout(r, 50));
    const a = window.__store.getState().accounts.find(x => x.id === "t1");
    return { band: a.healthBand, pbBand: a.healthPlaybookBand, events: a.healthEvents,
      taskCount: window.__store.getState().tasks.filter(t => t.healthPlaybook).length };
  });
  assert(res.band === "Yellow", "healthBand not set");
  assert(res.pbBand === "Yellow", "healthPlaybookBand not set");
  assert(res.events.length === 1 && res.events[0].to === "Yellow", "event not recorded");
  assert(res.taskCount === 1, "task not appended");
  await browser.close();
});

test("SEED_HEALTH_PLAYBOOK with empty items still records transition", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length);
  const res = await page.evaluate(async () => {
    window.__store.dispatch({ type: "SEED_HEALTH_PLAYBOOK", id: "t1",
      healthBand: "Green", healthPlaybookBand: undefined,
      event: { date: "2026-07-29", from: "Yellow", to: "Green" }, items: [] });
    await new Promise(r => setTimeout(r, 0));
    const a = window.__store.getState().accounts.find(x => x.id === "t1");
    return { band: a.healthBand, pbBand: a.healthPlaybookBand, events: a.healthEvents.length,
      tasks: window.__store.getState().tasks.filter(t => t.healthPlaybook).length };
  });
  assert(res.band === "Green", "band not updated");
  assert(res.pbBand === undefined, "pbBand should be cleared");
  assert(res.events === 1 && res.tasks === 0, "empty-items transition mishandled");
  await browser.close();
});
