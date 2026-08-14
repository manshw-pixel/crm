import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { RATES, scored, bookSeed } from "./money-fixture.mjs";

// now = 2026-05-15 puts us in 2026-Q2, so the five rows are Q2'25 … Q2'26 and the last
// is the current one. Absolute dates are safe here only because the clock is injected.
const NOW = "2026-05-15T12:00:00";

const BOOK = [
  // renewed inside 2026-Q2
  scored({ id: "r", name: "Renewed Co", arr: 120000, renewalDate: "2027-04-10",
    renewals: [{ id: "x1", completedOn: "2026-04-10", from: "2026-04-10", to: "2027-04-10", prevArr: 100000, arr: 120000, by: "Priya" }] }),
  // churned inside 2026-Q2
  scored({ id: "c", name: "Churned Co", arr: 80000, arrUSD: 0,
    churn: { date: "2026-04-20", arr: 80000, reason: "Price" } }),
  // renewal date passed inside 2026-Q2 with no covering renewal: slipped
  scored({ id: "s", name: "Slipped Co", arr: 60000, renewalDate: "2026-04-01" }),
];

const SNAPSHOTS = [{ month: "2026-04", commit90: 100000 }];

test("renewalOutcomeRows returns five quarters, oldest first, current flagged last", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(([b, rates, snaps, now]) =>
    window.__health.renewalOutcomeRows(b, rates, snaps, new Date(now)), [BOOK, RATES, SNAPSHOTS, NOW]);
  assert(rows.length === 5, `expected 5 quarters, got ${rows.length}`);
  assert(rows[0].key === "2025-Q2", `oldest expected 2025-Q2, got ${rows[0].key}`);
  assert(rows[4].key === "2026-Q2", `newest expected 2026-Q2, got ${rows[4].key}`);
  assert(rows[4].current === true, "the newest quarter should be flagged current");
  assert(rows.slice(0, 4).every(r => !r.current), "only the newest quarter may be flagged current");
  await browser.close();
});

test("a renewal lands in the quarter it completed in, not the term it covers", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // Renewed Co completed 2026-04-10 for a term ending 2027-04-10. It belongs to 2026-Q2.
  const rows = await page.evaluate(([b, rates, snaps, now]) =>
    window.__health.renewalOutcomeRows(b, rates, snaps, new Date(now)), [BOOK, RATES, SNAPSHOTS, NOW]);
  const q2 = rows[4];
  assert(q2.renewedN === 1, `expected 1 renewal in 2026-Q2, got ${q2.renewedN}`);
  assert(q2.renewed === 120000, `renewed ARR expected 120000 (the new term), got ${q2.renewed}`);
  await browser.close();
});

test("churn and slippage are counted in the quarter they fall in", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(([b, rates, snaps, now]) =>
    window.__health.renewalOutcomeRows(b, rates, snaps, new Date(now)), [BOOK, RATES, SNAPSHOTS, NOW]);
  const q2 = rows[4];
  assert(q2.churnedN === 1 && q2.churned === 80000, `expected 1 churn / 80000, got ${JSON.stringify(q2)}`);
  assert(q2.slipped === 1, `Slipped Co should count as slipped, got ${q2.slipped}`);
  await browser.close();
});

test("a renewal completed on time clears the slipped flag", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // Same past renewal date as Slipped Co, but with a renewal recorded on or after it.
  const book = [scored({ id: "ok", name: "Handled Co", arr: 60000, renewalDate: "2026-04-01",
    renewals: [{ id: "x2", completedOn: "2026-04-02", prevArr: 60000, arr: 60000, by: "Priya" }] })];
  const rows = await page.evaluate(([b, rates, now]) =>
    window.__health.renewalOutcomeRows(b, rates, [], new Date(now)), [book, RATES, NOW]);
  assert(rows[4].slipped === 0, `a covered renewal must not count as slipped, got ${rows[4].slipped}`);
  await browser.close();
});

test("win rate is renewed over renewed-plus-churned, and null for an empty quarter", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(([b, rates, snaps, now]) =>
    window.__health.renewalOutcomeRows(b, rates, snaps, new Date(now)), [BOOK, RATES, SNAPSHOTS, NOW]);
  // 120000 / (120000 + 80000) = 0.6
  assert(Math.abs(rows[4].wr - 0.6) < 1e-9, `win rate expected 0.6, got ${rows[4].wr}`);
  assert(rows[0].wr === null, `a quarter with no activity should report null, not 0, got ${rows[0].wr}`);
  await browser.close();
});

test("forecast comes from the snapshot for the quarter's first month", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(([b, rates, snaps, now]) =>
    window.__health.renewalOutcomeRows(b, rates, snaps, new Date(now)), [BOOK, RATES, SNAPSHOTS, NOW]);
  assert(rows[4].forecast === 100000, `2026-Q2 forecast expected 100000 from the 2026-04 snapshot, got ${rows[4].forecast}`);
  assert(rows[0].forecast === null, `quarters without a snapshot should report null, got ${rows[0].forecast}`);
  // renewed 120000 vs commit 100000 — the app renders this as a beat
  assert(rows[4].renewed > rows[4].forecast, "120000 renewed should beat a 100000 commit");
  await browser.close();
});

test("a snapshot without commit90 is ignored", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(([b, rates, now]) =>
    window.__health.renewalOutcomeRows(b, rates, [{ month: "2026-04", best: 999 }], new Date(now)), [BOOK, RATES, NOW]);
  assert(rows[4].forecast === null, `a snapshot lacking commit90 should not supply a forecast, got ${rows[4].forecast}`);
  await browser.close();
});

test("the quarter window rolls back across a year boundary", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // In Q1, startMonth goes negative for every earlier quarter and must borrow from the
  // previous year. crm.html relies on new Date(y, -3, 1) normalizing; pin it.
  const rows = await page.evaluate(([b, rates, now]) =>
    window.__health.renewalOutcomeRows(b, rates, [], new Date(now)), [BOOK, RATES, "2026-01-10T12:00:00"]);
  assert(rows[0].key === "2025-Q1", `oldest expected 2025-Q1, got ${rows[0].key}`);
  assert(rows[4].key === "2026-Q1", `newest expected 2026-Q1, got ${rows[4].key}`);
  await browser.close();
});

test("a foreign-currency renewal converts at the configured rate", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const book = [scored({ id: "inr", name: "Rupee Renewal", arr: 1000000, currency: "INR", arrUSD: 12000,
    renewalDate: "2027-04-10",
    renewals: [{ id: "x3", completedOn: "2026-04-10", prevArr: 900000, arr: 1000000, by: "Priya" }] })];
  const rows = await page.evaluate(([b, rates, now]) =>
    window.__health.renewalOutcomeRows(b, rates, [], new Date(now)), [book, RATES, NOW]);
  assert(Math.abs(rows[4].renewed - 12000) < 1e-6, `1,000,000 INR at 0.012 expected 12000, got ${rows[4].renewed}`);
  await browser.close();
});
