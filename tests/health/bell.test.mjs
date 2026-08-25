import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

// Account with a recent decline event already recorded (so no dependence on seeder timing).
const acct = seedAccount({ healthBand: "Yellow",
  healthEvents: [{ date: new Date(Date.now() - 3*864e5).toISOString().slice(0,10), from: "Green", to: "Yellow" }],
  inputs: { usage: 55, sentiment: 55, tickets: 3, nps: 0 } });
const seed = `window.__seedRows = { accounts: [${JSON.stringify(acct)}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("bell shows recent health-decline item", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForSelector("#root");
  await page.click('button[title="Renewal & contract alerts"]');
  const txt = await rootText(page);
  assert(/health dropped to Yellow/i.test(txt), "decline alert text missing");
  await browser.close();
});

// --- expiry windowing + read-row hiding -------------------------------------
// Contract alerts are windowed on BOTH sides: within EXPIRY_WARN_DAYS (60) of expiry, and no
// more than EXPIRED_GRACE_DAYS (30) past it. Green health + a far-off renewalDate keep the
// other two alert sources out of the bell so these assertions are about contracts alone.
const iso = offsetDays => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);
const contractAcct = (id, name, docId, docTitle, expiryOffset) => seedAccount({
  id, name, renewalDate: iso(400), healthBand: "Green",
  inputs: { usage: 90, sentiment: 90, tickets: 0, nps: 60 },
  documents: [{ id: docId, category: "Contract", title: docTitle, expiryDate: iso(expiryOffset) }],
});
const contractSeed = accts =>
  `window.__seedRows = { accounts: ${JSON.stringify(accts)}.map(d => ({ id: d.id, data: d })), `
  + `contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("contract expired inside the grace window still alerts; long-expired one does not", async () => {
  const { page, browser } = await launch(contractSeed([
    contractAcct("g1", "Grace Co", "d1", "Recently Lapsed", -10),
    contractAcct("g2", "Stale Co", "d2", "Ancient Lapsed", -45),
  ]));
  await page.click('button[title="Renewal & contract alerts"]');
  const txt = await rootText(page);
  assert(/Recently Lapsed/.test(txt), "contract expired 10d ago should still alert");
  assert(!/Ancient Lapsed/.test(txt), "contract expired 45d ago should have aged out");
  assert(/expired/.test(txt), "in-grace expired contract should carry the 'expired' badge");
  await browser.close();
});

test("reading an alert hides the row until 'Show read' is toggled", async () => {
  const { page, browser } = await launch(contractSeed([
    contractAcct("r1", "Readable Co", "d1", "Expiring Soon", 10),
  ]));
  const bell = 'button[title="Renewal & contract alerts"]';
  await page.click(bell);
  assert(/Expiring Soon/.test(await rootText(page)), "alert should start visible");

  // "Mark all read" empties the panel without destroying anything.
  await page.click('text=Mark all read');
  assert(!/Expiring Soon/.test(await rootText(page)), "read alert should be hidden");
  const afterRead = await rootText(page);
  assert(/All caught up/.test(afterRead), "all-read empty state expected, not 'Nothing due soon'");
  assert(/Show 1 read/.test(afterRead), "toggle should offer to reveal the read row");

  await page.click('text=Show 1 read');
  assert(/Expiring Soon/.test(await rootText(page)), "toggle should reveal the read row");
  await browser.close();
});
