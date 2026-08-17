import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { scored, bookSeed } from "./money-fixture.mjs";

const A = scored({ id: "a1", name: "Alpha Corp", arr: 100000, renewalDate: "2027-01-01",
  billingCompleted: true, billingCompletedDate: "2026-02-01", renewalStage: "In negotiation" });
const seed = bookSeed([A]);

// getState() returns the LAST COMMITTED RENDER's state, so a dispatch is not visible
// until React has re-rendered. Every evaluate below awaits a tick after dispatching before
// it reads, matching the idiom in bulk.test.mjs and reducer.test.mjs. Reading synchronously
// returns the pre-dispatch account and silently asserts against stale state.

// Waits for the seeded account to be in the store before a test touches it.
const ready = page => page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);

// Mirrors what CompleteRenewalForm dispatches (crm.html:1173).
const complete = (page, { newDate, newArr }) => page.evaluate(async ([d, arr]) => {
  const a = window.__store.getState().accounts.find(x => x.id === "a1");
  window.__store.dispatch({ type: "COMPLETE_RENEWAL", id: "a1", newDate: d, newArr: arr,
    entry: { id: "e1", completedOn: "2026-08-14", from: a.renewalDate, to: d, prevArr: a.arr, arr, by: "Tester",
      billingCompleted: !!a.billingCompleted, billingCompletedDate: a.billingCompletedDate || null } });
  await new Promise(r => setTimeout(r, 50));
  const u = window.__store.getState().accounts.find(x => x.id === "a1");
  return { renewalDate: u.renewalDate, arr: u.arr, contractStatus: u.contractStatus,
    billingCompleted: u.billingCompleted, billingCompletedDate: u.billingCompletedDate,
    renewalStage: u.renewalStage, renewals: u.renewals, audit: u.audit || [] };
}, [newDate, newArr]);

test("COMPLETE_RENEWAL moves the date, updates ARR and records the renewal", async () => {
  const { page, browser } = await launch(seed);
  await ready(page);
  const u = await complete(page, { newDate: "2028-01-01", newArr: 120000 });
  assert(u.renewalDate === "2028-01-01", `renewalDate expected 2028-01-01, got ${u.renewalDate}`);
  assert(u.arr === 120000, `arr expected 120000, got ${u.arr}`);
  assert(u.contractStatus === "Active", `contractStatus expected Active, got ${u.contractStatus}`);
  assert(u.renewals.length === 1, `expected 1 renewals entry, got ${u.renewals.length}`);
  assert(u.renewals[0].prevArr === 100000 && u.renewals[0].arr === 120000,
    `renewals entry should carry both ARR values, got ${JSON.stringify(u.renewals[0])}`);
  await browser.close();
});

test("COMPLETE_RENEWAL resets billing and the renewal stage for the new term", async () => {
  const { page, browser } = await launch(seed);
  await ready(page);
  const u = await complete(page, { newDate: "2028-01-01", newArr: 120000 });
  assert(u.billingCompleted === false, `billingCompleted should reset to false, got ${u.billingCompleted}`);
  assert(u.billingCompletedDate === null, `billingCompletedDate should clear, got ${u.billingCompletedDate}`);
  assert(u.renewalStage === "Not started", `renewalStage should reset, got ${u.renewalStage}`);
  await browser.close();
});

test("COMPLETE_RENEWAL stores the renewal entry verbatim, losing no fields", async () => {
  const { page, browser } = await launch(seed);
  await ready(page);
  // The reducer must append action.entry whole. The account's live billing flags reset
  // for the new term, so the entry is the ONLY record of what was true for the term that
  // just ended — a reducer that rebuilt it field-by-field would silently drop history.
  // The reducer additionally stamps the booking currency (see currency-history.test.mjs),
  // so "verbatim" means every supplied field survives byte-for-byte -- not that the stored
  // entry is field-for-field identical. Adding a field keeps the guarantee; rewriting or
  // dropping one breaks it, and that is what this asserts.
  const r = await page.evaluate(async () => {
    const entry = { id: "e9", completedOn: "2026-08-14", from: "2027-01-01", to: "2028-01-01",
      prevArr: 100000, arr: 120000, by: "Tester", billingCompleted: true, billingCompletedDate: "2026-02-01" };
    window.__store.dispatch({ type: "COMPLETE_RENEWAL", id: "a1", newDate: "2028-01-01", newArr: 120000, entry });
    await new Promise(r => setTimeout(r, 50));
    const stored = window.__store.getState().accounts.find(x => x.id === "a1").renewals[0];
    const changed = Object.keys(entry).filter(k => JSON.stringify(stored[k]) !== JSON.stringify(entry[k]));
    const added = Object.keys(stored).filter(k => !(k in entry));
    return { stored, changed, added };
  });
  assert(r.changed.length === 0,
    `no supplied field may be altered, but these were: ${r.changed.join(", ")} — got ${JSON.stringify(r.stored)}`);
  assert(r.added.length === 1 && r.added[0] === "currency",
    `the currency stamp should be the only addition, got: ${r.added.join(", ")}`);
  await browser.close();
});

test("COMPLETE_RENEWAL writes audit entries only for fields that changed", async () => {
  const { page, browser } = await launch(seed);
  await ready(page);
  const u = await complete(page, { newDate: "2028-01-01", newArr: 120000 });
  const fields = u.audit.map(e => e.field).sort();
  assert(JSON.stringify(fields) === JSON.stringify(["arr", "renewalDate"]),
    `expected arr and renewalDate audit entries, got ${JSON.stringify(fields)}`);
  const arrEntry = u.audit.find(e => e.field === "arr");
  assert(arrEntry.from === 100000 && arrEntry.to === 120000,
    `arr audit should record 100000 -> 120000, got ${JSON.stringify(arrEntry)}`);
  assert(arrEntry.source === "renewal", `audit source expected renewal, got ${arrEntry.source}`);
  await browser.close();
});

test("a flat renewal writes no ARR audit entry", async () => {
  const { page, browser } = await launch(seed);
  await ready(page);
  const u = await complete(page, { newDate: "2028-01-01", newArr: 100000 });
  assert(!u.audit.some(e => e.field === "arr"),
    `unchanged ARR should not be audited, got ${JSON.stringify(u.audit)}`);
  assert(u.audit.some(e => e.field === "renewalDate"), "the date change should still be audited");
  await browser.close();
});

test("the renewal form's date field is prefilled one year out, not 365 days out", async () => {
  // Renewing a 2027-03-01 contract must prefill 2028-03-01. Adding 365 days lands on
  // 2028-02-29, a day early, because the span crosses leap day.
  const { page, browser } = await launch(bookSeed([
    scored({ id: "a1", name: "Leap Corp", arr: 100000, renewalDate: "2027-03-01" })]));
  await ready(page);
  await page.click('button[title="Accounts"]');
  await page.getByText("Leap Corp").first().click();
  await page.getByText("Complete renewal").first().click();
  const v = await page.locator('form input[type="date"]').first().inputValue();
  assert(v === "2028-03-01", `the prefilled renewal date should be 2028-03-01, got ${v}`);
  await browser.close();
});

test("addMonths keeps the calendar day when the year it spans contains a leap day", async () => {
  // Pins the helper the form now delegates to, so a future change there cannot silently
  // reintroduce the off-by-one-day defect.
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__health);
  const d = await page.evaluate(() => window.__health.addMonths("2027-03-01", 12));
  assert(d === "2028-03-01", `expected 2028-03-01, got ${d}`);
  await browser.close();
});

test("COMPLETE_RENEWAL writes no arrEvent, so retention counts the renewal once", async () => {
  const { page, browser } = await launch(seed);
  await ready(page);
  const events = await page.evaluate(async () => {
    window.__store.dispatch({ type: "COMPLETE_RENEWAL", id: "a1", newDate: "2028-01-01", newArr: 120000,
      entry: { id: "e2", completedOn: "2026-08-14", from: "2027-01-01", to: "2028-01-01", prevArr: 100000, arr: 120000, by: "Tester" } });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().accounts.find(x => x.id === "a1").arrEvents || [];
  });
  // retentionStats sums renewals AND arrEvents. If a renewal also wrote an arrEvent,
  // every renewal would count twice toward expansion.
  assert(events.length === 0, `COMPLETE_RENEWAL must not write arrEvents, got ${JSON.stringify(events)}`);
  await browser.close();
});
