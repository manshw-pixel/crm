import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { scored, bookSeed } from "./money-fixture.mjs";

const seed = bookSeed([scored({ id: "a1", name: "Alpha Corp", arr: 100000 })]);

// getState() returns the LAST COMMITTED RENDER's state, so every evaluate that dispatches
// awaits a tick before reading. Reading synchronously returns the pre-dispatch account.
const ready = page => page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);

// Mirrors what AdjustArrForm dispatches (crm.html:1215).
const adjust = (page, { newArr, reason = "Discount", source = "adjustment" }) =>
  page.evaluate(async ([arr, rsn, src]) => {
    const a = window.__store.getState().accounts.find(x => x.id === "a1");
    const delta = arr - a.arr;
    window.__store.dispatch({ type: "ADJUST_ARR", id: "a1", newArr: arr,
      entry: { id: "ev" + arr, date: "2026-08-14", delta, kind: delta > 0 ? "expansion" : "contraction",
        source: src, reason: rsn, note: "", by: "Tester" } });
    await new Promise(r => setTimeout(r, 50));
    const u = window.__store.getState().accounts.find(x => x.id === "a1");
    return { arr: u.arr, arrEvents: u.arrEvents || [], audit: u.audit || [] };
  }, [newArr, reason, source]);

test("ADJUST_ARR books an increase as expansion", async () => {
  const { page, browser } = await launch(seed);
  await ready(page);
  const u = await adjust(page, { newArr: 130000, reason: "Mid-term upsell" });
  assert(u.arr === 130000, `arr expected 130000, got ${u.arr}`);
  assert(u.arrEvents.length === 1, `expected 1 arrEvent, got ${u.arrEvents.length}`);
  assert(u.arrEvents[0].delta === 30000, `delta expected 30000, got ${u.arrEvents[0].delta}`);
  assert(u.arrEvents[0].kind === "expansion", `kind expected expansion, got ${u.arrEvents[0].kind}`);
  await browser.close();
});

test("ADJUST_ARR books a decrease as contraction with a negative delta", async () => {
  const { page, browser } = await launch(seed);
  await ready(page);
  const u = await adjust(page, { newArr: 70000, reason: "Seat reduction" });
  assert(u.arrEvents[0].delta === -30000, `delta expected -30000, got ${u.arrEvents[0].delta}`);
  assert(u.arrEvents[0].kind === "contraction", `kind expected contraction, got ${u.arrEvents[0].kind}`);
  assert(u.arrEvents[0].reason === "Seat reduction", `reason should be carried, got ${u.arrEvents[0].reason}`);
  await browser.close();
});

test("ADJUST_ARR writes an audit entry recording the ARR move", async () => {
  const { page, browser } = await launch(seed);
  await ready(page);
  const u = await adjust(page, { newArr: 130000 });
  const e = u.audit.find(x => x.field === "arr");
  assert(e, `expected an arr audit entry, got ${JSON.stringify(u.audit)}`);
  assert(e.from === 100000 && e.to === 130000, `audit should record 100000 -> 130000, got ${JSON.stringify(e)}`);
  assert(e.source === "adjustment", `source expected adjustment, got ${e.source}`);
  await browser.close();
});

test("an ARR change sourced from an opportunity is audited as such", async () => {
  const { page, browser } = await launch(seed);
  await ready(page);
  // crm.html:2396 dispatches ADJUST_ARR when an opportunity is won; the audit source
  // must distinguish that from a manual adjustment.
  const u = await adjust(page, { newArr: 150000, source: "opportunity" });
  const e = u.audit.find(x => x.field === "arr");
  assert(e.source === "opportunity", `source expected opportunity, got ${e.source}`);
  await browser.close();
});

test("successive adjustments append rather than replace", async () => {
  const { page, browser } = await launch(seed);
  await ready(page);
  await adjust(page, { newArr: 130000 });
  const u = await adjust(page, { newArr: 110000 });
  assert(u.arr === 110000, `arr expected 110000, got ${u.arr}`);
  assert(u.arrEvents.length === 2, `expected 2 arrEvents, got ${u.arrEvents.length}`);
  assert(u.arrEvents[1].delta === -20000, `second delta expected -20000, got ${u.arrEvents[1].delta}`);
  assert(u.audit.filter(e => e.field === "arr").length === 2,
    `expected 2 arr audit entries, got ${u.audit.filter(e => e.field === "arr").length}`);
  await browser.close();
});

test("editing ARR through EDIT_ACCOUNT derives an arrEvent with the right kind", async () => {
  const { page, browser } = await launch(seed);
  await ready(page);
  // auditChanges (crm.html:386) turns a plain ARR edit into an arrEvent so it still
  // reaches NRR/GRR. Without it, edits would silently bypass retention.
  const u = await page.evaluate(async () => {
    window.__store.dispatch({ type: "EDIT_ACCOUNT", id: "a1", patch: { arr: 140000 }, by: "Tester", source: "edit" });
    await new Promise(r => setTimeout(r, 50));
    const a = window.__store.getState().accounts.find(x => x.id === "a1");
    return { arrEvents: a.arrEvents || [], audit: a.audit || [] };
  });
  assert(u.arrEvents.length === 1, `expected a derived arrEvent, got ${JSON.stringify(u.arrEvents)}`);
  assert(u.arrEvents[0].delta === 40000, `delta expected 40000, got ${u.arrEvents[0].delta}`);
  assert(u.arrEvents[0].kind === "expansion", `kind expected expansion, got ${u.arrEvents[0].kind}`);
  assert(u.arrEvents[0].source === "edit", `source expected edit, got ${u.arrEvents[0].source}`);
  await browser.close();
});

test("submitting the adjust form without changing ARR writes nothing", async () => {
  // The zero-delta guard lives in the FORM (crm.html:1213 returns early), not the reducer,
  // so this has to go through the UI. Asserting it at the reducer level would prove
  // nothing — ADJUST_ARR has no such guard.
  const { page, browser } = await launch(seed);
  await ready(page);
  await page.click('button[title="Accounts"]');
  await page.getByText("Alpha Corp").first().click();
  await page.getByText("Adjust ARR").first().click();
  const before = await page.evaluate(() =>
    JSON.stringify(window.__store.getState().accounts.find(x => x.id === "a1")));
  // The submit button reads "No change" while the delta is zero.
  await page.getByText("No change").first().click();
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  const after = await page.evaluate(() =>
    JSON.stringify(window.__store.getState().accounts.find(x => x.id === "a1")));
  assert(before === after, "a zero-delta submit must leave the account untouched");
  await browser.close();
});

test("a CSV-sourced ARR edit is tagged import, not edit", async () => {
  const { page, browser } = await launch(seed);
  await ready(page);
  const u = await page.evaluate(async () => {
    window.__store.dispatch({ type: "EDIT_ACCOUNT", id: "a1", patch: { arr: 90000 }, by: "Tester", source: "csv import" });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().accounts.find(x => x.id === "a1").arrEvents || [];
  });
  assert(u[0].source === "import", `source expected import, got ${u[0].source}`);
  assert(u[0].kind === "contraction", `kind expected contraction, got ${u[0].kind}`);
  await browser.close();
});
