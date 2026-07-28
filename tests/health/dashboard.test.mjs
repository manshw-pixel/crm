import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

const acct = seedAccount({ healthBand: "Red",
  healthEvents: [{ date: new Date(Date.now() - 2*864e5).toISOString().slice(0,10), from: "Yellow", to: "Red" }],
  inputs: { usage: 20, sentiment: 20, tickets: 10, nps: -60 } });
const seed = `window.__seedRows = { accounts: [${JSON.stringify(acct)}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("dashboard shows Recently declined card with account", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForSelector("#root");
  const txt = await rootText(page);
  assert(/Recently declined/.test(txt), "card title missing");
  assert(new RegExp(acct.name).test(txt), "account name missing from Recently declined card");
  // "Test Co" also renders in the "Alerts & flags" card, so the account name alone doesn't prove
  // this is the declines card. Assert the unique band-transition markup this card renders: a row
  // button containing the account name plus the from/to band spans (e.g. Yellow -> Red).
  const bands = await page.evaluate((name) => {
    const btns = Array.from(document.querySelectorAll("#root button"));
    const btn = btns.find(b => Array.from(b.querySelectorAll("span")).some(s => s.textContent === name));
    if (!btn) return null;
    return Array.from(btn.querySelectorAll("span.font-semibold")).map(s => s.textContent);
  }, acct.name);
  assert(bands && bands.includes("Yellow") && bands.includes("Red"),
    "decline row band transition (Yellow -> Red) missing for " + acct.name + ": " + JSON.stringify(bands));
  await browser.close();
});
