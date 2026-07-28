import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

function seedFor(acct) {
  return `window.__seedRows = { accounts: [${JSON.stringify(acct)}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
}
const wait = page => page.waitForFunction(() => window.__store && window.__store.getState().accounts.length);

test("first run: existing Red account seeds nothing, initializes band", async () => {
  // usage/sentiment low → score < 40 → Red, but no healthBand yet.
  const acct = seedAccount({ inputs: { usage: 20, sentiment: 20, tickets: 10, nps: -60 } });
  const { page, browser } = await launch(seedFor(acct));
  await wait(page);
  const r = await page.evaluate(() => {
    const s = window.__store.getState(); const a = s.accounts.find(x => x.id === "t1");
    return { band: a.healthBand, events: (a.healthEvents || []).length, tasks: s.tasks.filter(t => t.healthPlaybook).length };
  });
  assert(r.band === "Red", "band should initialize to Red");
  assert(r.events === 0, "no events on first run");
  assert(r.tasks === 0, "no tasks on first run");
  await browser.close();
});

test("worsening Green->Yellow seeds Yellow playbook + event", async () => {
  const acct = seedAccount({ healthBand: "Green", inputs: { usage: 55, sentiment: 55, tickets: 3, nps: 0 } }); // ~Yellow
  const { page, browser } = await launch(seedFor(acct));
  await wait(page);
  const r = await page.evaluate(() => {
    const s = window.__store.getState(); const a = s.accounts.find(x => x.id === "t1");
    const t = s.tasks.filter(x => x.healthPlaybook);
    return { band: a.healthBand, pb: a.healthPlaybookBand, ev: a.healthEvents,
      ids: t.map(x => x.id), titles: t.map(x => x.title) };
  });
  assert(r.band === "Yellow" && r.pb === "Yellow", "band/pbBand not Yellow");
  assert(r.ev.length === 1 && r.ev[0].from === "Green" && r.ev[0].to === "Yellow", "event wrong");
  assert(r.ids.length === 3 && r.ids.every(id => /^hpb-t1-Yellow-\d{4}-\d{2}-\d{2}-hy\d$/.test(id)), "task ids wrong: " + r.ids);
  assert(r.titles.every(t => t.startsWith("♥ ")), "titles not marked");
  await browser.close();
});

test("no duplicate seeding on stable band", async () => {
  const acct = seedAccount({ healthBand: "Yellow", healthPlaybookBand: "Yellow", inputs: { usage: 55, sentiment: 55, tickets: 3, nps: 0 } });
  const { page, browser } = await launch(seedFor(acct));
  await wait(page);
  await page.waitForTimeout(500);
  const n = await page.evaluate(() => window.__store.getState().tasks.filter(t => t.healthPlaybook).length);
  assert(n === 0, "should not seed when band unchanged: got " + n);
  await browser.close();
});

test("recovery to Green clears pbBand; later decline re-seeds", async () => {
  const acct = seedAccount({ healthBand: "Red", healthPlaybookBand: "Red", inputs: { usage: 90, sentiment: 90, tickets: 0, nps: 60 } }); // now Green
  const { page, browser } = await launch(seedFor(acct));
  await wait(page);
  const afterRecovery = await page.evaluate(() => {
    const a = window.__store.getState().accounts.find(x => x.id === "t1");
    return { band: a.healthBand, pb: a.healthPlaybookBand };
  });
  assert(afterRecovery.band === "Green" && afterRecovery.pb === undefined, "recovery didn't clear pbBand");
  // now push it back down to Red via UPDATE_INPUTS
  await page.evaluate(() => window.__store.dispatch({ type: "UPDATE_INPUTS", id: "t1", inputs: { usage: 10, sentiment: 10, tickets: 20, nps: -80 } }));
  await page.waitForTimeout(400);
  const reseed = await page.evaluate(() => window.__store.getState().tasks.filter(t => t.healthPlaybook && t.healthBand === "Red").length);
  assert(reseed === 3, "re-decline should seed 3 Red tasks, got " + reseed);
  await browser.close();
});

test("worsening Yellow->Red escalation seeds Red playbook + event", async () => {
  const acct = seedAccount({ healthBand: "Yellow", healthPlaybookBand: "Yellow", inputs: { usage: 15, sentiment: 15, tickets: 20, nps: -80 } }); // ~Red
  const { page, browser } = await launch(seedFor(acct));
  await wait(page);
  const r = await page.evaluate(() => {
    const s = window.__store.getState(); const a = s.accounts.find(x => x.id === "t1");
    const t = s.tasks.filter(x => x.healthPlaybook);
    return { band: a.healthBand, pb: a.healthPlaybookBand, ev: a.healthEvents,
      ids: t.map(x => x.id) };
  });
  assert(r.band === "Red" && r.pb === "Red", "band/pbBand not Red: " + JSON.stringify(r));
  assert(r.ev.length === 1 && r.ev[0].from === "Yellow" && r.ev[0].to === "Red", "event wrong: " + JSON.stringify(r.ev));
  assert(r.ids.length === 3 && r.ids.every(id => /^hpb-t1-Red-\d{4}-\d{2}-\d{2}-hr\d$/.test(id)), "task ids wrong: " + r.ids);
  await browser.close();
});

test("pbBand suppression: crossing that doesn't exceed stored pbBand seeds nothing", async () => {
  // stored healthBand:Green, healthPlaybookBand:Red (was Red previously, recovered to Green w/o clearing pbBand via seed data),
  // current inputs compute to Yellow -> cur=Yellow worsens vs prev=Green, but BAND_RANK[Yellow]=1 is not > BAND_RANK[Red]=2, so no reseed.
  const acct = seedAccount({ healthBand: "Green", healthPlaybookBand: "Red", inputs: { usage: 55, sentiment: 55, tickets: 3, nps: 0 } }); // ~Yellow
  const { page, browser } = await launch(seedFor(acct));
  await wait(page);
  const r = await page.evaluate(() => {
    const s = window.__store.getState(); const a = s.accounts.find(x => x.id === "t1");
    const t = s.tasks.filter(x => x.healthPlaybook);
    return { band: a.healthBand, pb: a.healthPlaybookBand, ev: a.healthEvents, tasks: t.length };
  });
  assert(r.band === "Yellow", "band should be Yellow: " + r.band);
  assert(r.pb === "Red", "pbBand should remain Red (suppressed): " + r.pb);
  assert(r.ev.length === 1 && r.ev[0].from === "Green" && r.ev[0].to === "Yellow", "event wrong: " + JSON.stringify(r.ev));
  assert(r.tasks === 0, "no tasks should be seeded when not exceeding pbBand: got " + r.tasks);
  await browser.close();
});
