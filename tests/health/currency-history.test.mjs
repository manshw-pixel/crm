// Historical money must convert at the currency the entry was BOOKED in, not at whatever
// the account is billed in today. An account that moved from INR to USD had its old INR
// renewal deltas and ARR events read as USD, inflating NRR/GRR by ~83x on those rows.
//
// Churn already got this right (`a.churn.currency || a.currency`); renewals and arrEvents
// did not. These tests cover both the readers and the writers that stamp the field.
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { rel, RATES, scored, bookSeed } from "./money-fixture.mjs";

// Billed in USD TODAY, but both historical entries were booked while on INR.
// 1,000,000 INR at 0.012 = 12,000 USD. Read as USD it would count as 1,000,000.
const SWITCHED = [
  scored({ id: "s1", name: "Switched Co", arr: 200000, currency: "USD", arrUSD: 200000,
    renewals: [{ id: "r1", completedOn: rel(-180), prevArr: 0, arr: 1000000, currency: "INR", by: "Priya" }],
    arrEvents: [{ id: "e1", date: rel(-100), delta: -1000000, kind: "contraction", currency: "INR", source: "adjustment" }] }),
];

const evalHealth = async (page, fn, args) => page.evaluate(fn, args);

test("renewal deltas convert at the currency stamped on the entry", async () => {
  const { page, browser } = await launch(bookSeed(SWITCHED));
  await page.waitForFunction(() => window.__health);
  const s = await evalHealth(page, ([book, rates]) => window.__health.retentionStats(book, rates), [SWITCHED, RATES]);
  assert(Math.abs(s.expansion - 12000) < 1e-6,
    `expansion should be 1,000,000 INR = 12,000 USD, got ${s.expansion} (reading the entry as USD gives 1000000)`);
  await browser.close();
});

test("ARR event deltas convert at the currency stamped on the entry", async () => {
  const { page, browser } = await launch(bookSeed(SWITCHED));
  await page.waitForFunction(() => window.__health);
  const s = await evalHealth(page, ([book, rates]) => window.__health.retentionStats(book, rates), [SWITCHED, RATES]);
  assert(Math.abs(s.contraction - 12000) < 1e-6,
    `contraction should be 1,000,000 INR = 12,000 USD, got ${s.contraction}`);
  await browser.close();
});

// Existing stored history has no currency field. It must keep behaving exactly as before
// -- we cannot know what currency a past entry was really in, so today's is the only
// defensible guess, and silently changing historical numbers would be worse.
test("entries without a stamped currency fall back to the account's current currency", async () => {
  const LEGACY = [
    scored({ id: "l1", name: "Legacy Co", arr: 1000000, currency: "INR", arrUSD: 12000,
      renewals: [{ id: "r1", completedOn: rel(-180), prevArr: 0, arr: 1000000, by: "Priya" }] }),
  ];
  const { page, browser } = await launch(bookSeed(LEGACY));
  await page.waitForFunction(() => window.__health);
  const s = await evalHealth(page, ([book, rates]) => window.__health.retentionStats(book, rates), [LEGACY, RATES]);
  assert(Math.abs(s.expansion - 12000) < 1e-6,
    `unstamped entry should fall back to the account currency (INR), got ${s.expansion}`);
  await browser.close();
});

test("quarterly renewed ARR converts at the stamped currency", async () => {
  const { page, browser } = await launch(bookSeed(SWITCHED));
  await page.waitForFunction(() => window.__health);
  const rows = await evalHealth(page, ([book, rates]) => window.__health.renewalOutcomeRows(book, rates), [SWITCHED, RATES]);
  const total = rows.reduce((t, r) => t + (r.renewed || 0), 0);
  assert(Math.abs(total - 12000) < 1e-6,
    `renewed ARR should be 1,000,000 INR = 12,000 USD, got ${total}`);
  await browser.close();
});

// --- writers -------------------------------------------------------------------------
// Stamping happens in the reducer rather than at each dispatch site, so every caller --
// the renewal form, the ARR adjust form, opportunity-won, and any future one -- is
// covered by construction.

const WRITER_SEED = [scored({ id: "w1", name: "Writer Co", arr: 1000000, currency: "INR", arrUSD: 12000 })];

test("COMPLETE_RENEWAL stamps the account currency onto the renewal entry", async () => {
  const { page, browser } = await launch(bookSeed(WRITER_SEED));
  await page.waitForFunction(() => window.__store);
  const cur = await page.evaluate(() => {
    window.__store.dispatch({ type: "COMPLETE_RENEWAL", id: "w1", newDate: "2028-01-01", newArr: 1200000,
      entry: { id: "r9", completedOn: "2026-08-17", from: "2027-01-01", to: "2028-01-01", prevArr: 1000000, arr: 1200000, by: "Tester" } });
    return new Promise(r => setTimeout(() => {
      const a = window.__store.getState().accounts.find(x => x.id === "w1");
      r(a.renewals[a.renewals.length - 1].currency);
    }, 50));
  });
  assert(cur === "INR", `renewal entry should be stamped INR, got ${cur}`);
  await browser.close();
});

test("ADJUST_ARR stamps the account currency onto the ARR event", async () => {
  const { page, browser } = await launch(bookSeed(WRITER_SEED));
  await page.waitForFunction(() => window.__store);
  const cur = await page.evaluate(() => {
    window.__store.dispatch({ type: "ADJUST_ARR", id: "w1", newArr: 900000,
      entry: { id: "e9", date: "2026-08-17", delta: -100000, kind: "contraction", source: "adjustment", reason: "Downgrade", note: "", by: "Tester" } });
    return new Promise(r => setTimeout(() => {
      const a = window.__store.getState().accounts.find(x => x.id === "w1");
      r(a.arrEvents[a.arrEvents.length - 1].currency);
    }, 50));
  });
  assert(cur === "INR", `ARR event should be stamped INR, got ${cur}`);
  await browser.close();
});

test("an explicit currency on the entry is not overwritten by the reducer", async () => {
  const { page, browser } = await launch(bookSeed(WRITER_SEED));
  await page.waitForFunction(() => window.__store);
  const cur = await page.evaluate(() => {
    window.__store.dispatch({ type: "ADJUST_ARR", id: "w1", newArr: 900000,
      entry: { id: "e8", date: "2026-08-17", delta: -100000, kind: "contraction", source: "adjustment", currency: "PHP", reason: "x", note: "", by: "Tester" } });
    return new Promise(r => setTimeout(() => {
      const a = window.__store.getState().accounts.find(x => x.id === "w1");
      r(a.arrEvents[a.arrEvents.length - 1].currency);
    }, 50));
  });
  assert(cur === "PHP", `an explicitly supplied currency should win, got ${cur}`);
  await browser.close();
});
