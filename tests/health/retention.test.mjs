import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { rel, RATES, scored, bookSeed } from "./money-fixture.mjs";

// Hand-computed expectations for BOOK:
//   retARR (non-churned arrUSD)  = 100000 + 120000 + 80000 + 50000 = 350000
//   churnedARR (last 12mo)       = 50000
//   expansion (last 12mo)        = 20000   (B's renewal: 120000 - 100000)
//   contraction (last 12mo)      = 20000   (C's arrEvent: -20000, stored positive)
//   base = retARR + churnedARR - expansion + contraction = 400000
//        (i.e. the ARR this book started the year with)
//   grr = (400000 - 50000 - 20000) / 400000 = 0.825
//   nrr = (400000 - 50000 - 20000 + 20000) / 400000 = 0.875
const BOOK = [
  scored({ id: "a", name: "Steady Co", arr: 100000 }),
  scored({ id: "b", name: "Grew Co", arr: 120000,
    renewals: [{ id: "r1", completedOn: rel(-180), prevArr: 100000, arr: 120000, by: "Priya" }] }),
  scored({ id: "c", name: "Shrank Co", arr: 80000,
    arrEvents: [{ id: "e1", date: rel(-100), delta: -20000, kind: "contraction", source: "adjustment" }] }),
  scored({ id: "d", name: "Lost Co", arr: 50000, arrUSD: 0,
    churn: { date: rel(-60), arr: 50000, reason: "Price" } }),
  // outside the 12-month window: must be ignored entirely
  scored({ id: "e", name: "Old News Co", arr: 50000,
    renewals: [{ id: "r2", completedOn: rel(-400), prevArr: 10000, arr: 50000, by: "Priya" }] }),
];

test("retentionStats computes NRR and GRR from churn, renewals and ARR events", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const s = await page.evaluate(([book, rates]) => window.__health.retentionStats(book, rates), [BOOK, RATES]);
  assert(s.churnedARR === 50000, `churnedARR expected 50000, got ${s.churnedARR}`);
  assert(s.expansion === 20000, `expansion expected 20000, got ${s.expansion}`);
  assert(s.contraction === 20000, `contraction expected 20000, got ${s.contraction}`);
  assert(s.lost === 1, `lost expected 1, got ${s.lost}`);
  assert(Math.abs(s.grr - 0.825) < 1e-9, `grr expected 0.825, got ${s.grr}`);
  assert(Math.abs(s.nrr - 0.875) < 1e-9, `nrr expected 0.875, got ${s.nrr}`);
  await browser.close();
});

test("retentionStats ignores events older than twelve months", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // Old News Co's +40000 renewal sits at rel(-400). If the window leaked, expansion
  // would be 60000 rather than 20000.
  const s = await page.evaluate(([book, rates]) => window.__health.retentionStats(book, rates), [BOOK, RATES]);
  assert(s.expansion === 20000, `the 400-day-old renewal leaked into expansion: ${s.expansion}`);
  await browser.close();
});

test("retentionStats returns null ratios for an empty book rather than NaN", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const s = await page.evaluate(rates => window.__health.retentionStats([], rates), RATES);
  assert(s.grr === null, `grr should be null on an empty book, got ${s.grr}`);
  assert(s.nrr === null, `nrr should be null on an empty book, got ${s.nrr}`);
  assert(s.churnedARR === 0 && s.lost === 0, `empty book should report no loss: ${JSON.stringify(s)}`);
  await browser.close();
});

test("a completed renewal is counted once, from renewals and not also from arrEvents", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // COMPLETE_RENEWAL writes a renewals entry and deliberately no arrEvent (crm.html:392).
  // If that ever changes, every renewal counts twice toward expansion. Pin the invariant.
  const s = await page.evaluate(([book, rates]) => window.__health.retentionStats(book, rates), [BOOK, RATES]);
  assert(s.expansion === 20000, `renewal double-counted into expansion: ${s.expansion}`);
  await browser.close();
});

test("an account in an unrecognized currency contributes zero revenue, silently", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // toUSD falls back to `rates?.[cur] ?? 0`, so an unknown currency zeroes the account
  // instead of failing. Documented here so the behavior is a decision, not a surprise.
  const book = [scored({ id: "x", name: "Zloty Co", arr: 100000, currency: "PLN", arrUSD: 0,
    churn: { date: rel(-30), arr: 100000, reason: "Price" } })];
  const s = await page.evaluate(([b, rates]) => window.__health.retentionStats(b, rates), [book, RATES]);
  assert(s.churnedARR === 0, `unknown currency should convert to 0, got ${s.churnedARR}`);
  assert(s.lost === 1, `the logo should still count as lost, got ${s.lost}`);
  await browser.close();
});

test("a foreign-currency churn converts at the configured rate", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const book = [scored({ id: "y", name: "Rupee Co", arr: 1000000, currency: "INR", arrUSD: 12000,
    churn: { date: rel(-30), arr: 1000000, currency: "INR", reason: "Fit" } })];
  const s = await page.evaluate(([b, rates]) => window.__health.retentionStats(b, rates), [book, RATES]);
  assert(Math.abs(s.churnedARR - 12000) < 1e-6, `1,000,000 INR at 0.012 should be 12000, got ${s.churnedARR}`);
  await browser.close();
});
