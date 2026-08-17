// Changing an account's billing currency restates the same revenue in another unit -- it
// is not expansion or contraction. EDIT_ACCOUNT used to compute `delta = to - from` across
// two different currencies, so INR 1,000,000 -> USD 12,000 booked a 988,000 "contraction".
//
// Two cases, and the second is the sneakier one:
//   a) currency AND arr change together -> the delta straddles two units
//   b) ONLY the currency changes        -> no arrEvent was written at all, yet arrUSD
//      (and with it retARR and the NRR/GRR base) swings by the FX factor, unexplained.
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { RATES, scored, bookSeed } from "./money-fixture.mjs";

const SEED = [scored({ id: "r1", name: "Redenom Co", arr: 1000000, currency: "INR", arrUSD: 12000 })];

// Dispatch an EDIT_ACCOUNT and read back the account once the store has committed.
async function edit(page, patch) {
  return page.evaluate(async p => {
    window.__store.dispatch({ type: "EDIT_ACCOUNT", id: "r1", patch: p, by: "Tester", source: "edit form" });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().accounts.find(x => x.id === "r1");
  }, patch);
}

const boot = async () => {
  const h = await launch(bookSeed(SEED));
  await h.page.waitForFunction(() => window.__store);
  return h;
};

test("changing currency and ARR together books a redenomination, not a contraction", async () => {
  const { page, browser } = await boot();
  const a = await edit(page, { currency: "USD", arr: 12000 });
  const ev = (a.arrEvents || []);
  assert(ev.length === 1, `expected exactly one arrEvent, got ${ev.length}: ${JSON.stringify(ev)}`);
  assert(ev[0].kind === "redenomination", `kind should be redenomination, got ${ev[0].kind}`);
  assert(ev[0].delta === 0, `delta should be 0, got ${ev[0].delta} (the old bug booked -988000)`);
  await browser.close();
});

test("changing only the currency still records a redenomination", async () => {
  const { page, browser } = await boot();
  const a = await edit(page, { currency: "USD" });
  const ev = (a.arrEvents || []);
  assert(ev.length === 1, `a currency-only change must not be silent, got ${ev.length} events`);
  assert(ev[0].kind === "redenomination", `kind should be redenomination, got ${ev[0].kind}`);
  await browser.close();
});

test("the redenomination entry records both currencies and both amounts", async () => {
  const { page, browser } = await boot();
  const a = await edit(page, { currency: "USD", arr: 12000 });
  const ev = a.arrEvents[0];
  assert(ev.fromCurrency === "INR" && ev.toCurrency === "USD",
    `expected INR -> USD, got ${ev.fromCurrency} -> ${ev.toCurrency}`);
  assert(ev.fromArr === 1000000 && ev.toArr === 12000,
    `expected 1000000 -> 12000, got ${ev.fromArr} -> ${ev.toArr}`);
  await browser.close();
});

test("an ARR change without a currency change is unaffected", async () => {
  const { page, browser } = await boot();
  const a = await edit(page, { arr: 1200000 });
  const ev = a.arrEvents;
  assert(ev.length === 1 && ev[0].kind === "expansion",
    `a plain ARR rise should still book an expansion, got ${JSON.stringify(ev)}`);
  assert(ev[0].delta === 200000, `delta should be 200000, got ${ev[0].delta}`);
  assert(ev[0].currency === "INR", `should be stamped INR, got ${ev[0].currency}`);
  await browser.close();
});

test("a redenomination moves neither expansion nor contraction in retentionStats", async () => {
  const { page, browser } = await boot();
  const a = await edit(page, { currency: "USD", arr: 12000 });
  const s = await page.evaluate(([book, rates]) => window.__health.retentionStats(book, rates),
    [[{ ...a, arrUSD: 12000 }], RATES]);
  assert(s.expansion === 0, `expansion should be 0 across a redenomination, got ${s.expansion}`);
  assert(s.contraction === 0, `contraction should be 0 across a redenomination, got ${s.contraction}`);
  await browser.close();
});

test("the currency field change is written to the audit trail", async () => {
  const { page, browser } = await boot();
  const a = await edit(page, { currency: "USD", arr: 12000 });
  const cur = (a.audit || []).find(x => x.field === "currency");
  assert(cur, `currency change should be audited, got fields: ${(a.audit || []).map(x => x.field).join(", ")}`);
  assert(cur.from === "INR" && cur.to === "USD", `expected INR -> USD, got ${cur.from} -> ${cur.to}`);
  await browser.close();
});

test("the redenomination renders in the ARR timeline rather than as a blank row", async () => {
  const { page, browser } = await boot();
  await edit(page, { currency: "USD", arr: 12000 });
  // open the account so the ARR history timeline renders
  await page.click('button[title="Accounts"]');
  await page.getByText("Redenom Co").first().waitFor({ timeout: 8000 });
  await page.getByText("Redenom Co").first().click();
  await page.waitForFunction(() => /Industry/.test(document.getElementById("root").textContent), { timeout: 8000 });
  const txt = await page.textContent("#root");
  assert(/redenominated/i.test(txt), "the timeline should label the entry as redenominated");
  assert(!/▼ reduction/.test(txt), "a redenomination must not be shown as a reduction");
  await browser.close();
});
