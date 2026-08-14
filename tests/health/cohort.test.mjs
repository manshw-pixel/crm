import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { rel, scored, bookSeed } from "./money-fixture.mjs";

// Cohorts key off startDate. Offsets are chosen to sit well inside a quarter so the
// suite cannot break on a quarter boundary: rel(-400) is ~13 months back, rel(-1500)
// is past the 3-year line where cohorts collapse to a bare year.
const BOOK = [
  scored({ id: "n1", name: "New A", arr: 100000, startDate: rel(-40) }),
  scored({ id: "n2", name: "New B", arr: 200000, startDate: rel(-40) }),
  scored({ id: "o1", name: "Old A", arr: 50000, startDate: rel(-1500) }),
];

test("cohortData groups recent accounts by start quarter and old ones by year", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(book => window.__health.cohortData(book), BOOK);
  const recent = rows.find(r => /^\d{4}-Q[1-4]$/.test(r.key));
  const old = rows.find(r => /^\d{4}$/.test(r.key));
  assert(recent, `expected a YYYY-QN cohort, got keys: ${rows.map(r => r.key).join()}`);
  assert(old, `expected a bare YYYY cohort for the 3+ year-old account, got: ${rows.map(r => r.key).join()}`);
  assert(recent.size === 2, `the two same-quarter accounts should share a cohort, got ${recent.size}`);
  assert(recent.arr === 300000, `cohort ARR expected 300000, got ${recent.arr}`);
  await browser.close();
});

test("cohortData skips accounts with a missing or unparseable startDate", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const book = [
    scored({ id: "g", name: "Good", arr: 10000, startDate: rel(-40) }),
    scored({ id: "n", name: "No Date", arr: 10000, startDate: "" }),
    scored({ id: "b", name: "Bad Date", arr: 10000, startDate: "not-a-date" }),
  ];
  const rows = await page.evaluate(b => window.__health.cohortData(b), book);
  const total = rows.reduce((s, r) => s + r.size, 0);
  assert(total === 1, `only the account with a valid startDate should appear, got ${total}`);
  await browser.close();
});

test("a never-churned account stays retained in every quarter column", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const book = [scored({ id: "s", name: "Survivor", arr: 100000, startDate: rel(-400) })];
  const rows = await page.evaluate(b => window.__health.cohortData(b), book);
  assert(rows[0].cells.every(c => c.pct === 1), `survivor dipped below 100%: ${JSON.stringify(rows[0].cells)}`);
  assert(rows[0].cells.length >= 4, `a 400-day-old cohort should span several quarters, got ${rows[0].cells.length}`);
  await browser.close();
});

test("an account that churns in its first quarter still counts as retained at Q0", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // surv = floor(monthsBetween(start, churn) / 3) = 0, and the filter is `surv >= q`,
  // so Q0 counts it. Everyone is alive at Q0 by definition; Q1 is where it drops out.
  const book = [
    scored({ id: "q", name: "Quick Churn", arr: 100000, startDate: rel(-400),
      churn: { date: rel(-380), arr: 100000, reason: "Fit" }, arrUSD: 100000 }),
    scored({ id: "l", name: "Lasted", arr: 100000, startDate: rel(-400) }),
  ];
  const rows = await page.evaluate(b => window.__health.cohortData(b), book);
  assert(rows[0].cells[0].pct === 1, `Q0 should retain everyone, got ${rows[0].cells[0].pct}`);
  assert(rows[0].cells[1].pct === 0.5, `Q1 should show 1 of 2 retained, got ${rows[0].cells[1].pct}`);
  await browser.close();
});

test("logo retention and ARR retention diverge when a large account churns", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const book = [
    scored({ id: "big", name: "Big", arr: 900000, arrUSD: 900000, startDate: rel(-400),
      churn: { date: rel(-380), arr: 900000, reason: "Price" } }),
    scored({ id: "small", name: "Small", arr: 100000, arrUSD: 100000, startDate: rel(-400) }),
  ];
  const rows = await page.evaluate(b => window.__health.cohortData(b), book);
  assert(rows[0].cells[1].pct === 0.5, `logo retention at Q1 expected 0.5, got ${rows[0].cells[1].pct}`);
  assert(Math.abs(rows[0].cells[1].arrPct - 0.1) < 1e-9, `ARR retention at Q1 expected 0.1, got ${rows[0].cells[1].arrPct}`);
  await browser.close();
});

test("a cohort's columns stop at its own age", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const book = [
    scored({ id: "young", name: "Young", arr: 10000, startDate: rel(-40) }),
    scored({ id: "old", name: "Old", arr: 10000, startDate: rel(-400) }),
  ];
  const rows = await page.evaluate(b => window.__health.cohortData(b), book);
  const young = rows[rows.length - 1], old = rows[0];
  assert(young.cells.length < old.cells.length,
    `the younger cohort should have fewer columns: young ${young.cells.length}, old ${old.cells.length}`);
  await browser.close();
});

test("monthsBetween and quarterKey agree on quarter boundaries", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const r = await page.evaluate(() => ({
    span: window.__health.monthsBetween("2026-01-31", "2026-03-01"),
    q1: window.__health.quarterKey("2026-03-31"),
    q2: window.__health.quarterKey("2026-04-01"),
    q4: window.__health.quarterKey("2026-12-31"),
  }));
  // monthsBetween counts calendar months, not elapsed days: Jan 31 -> Mar 1 is 2.
  assert(r.span === 2, `monthsBetween expected 2, got ${r.span}`);
  assert(r.q1 === "2026-Q1", `2026-03-31 should be Q1, got ${r.q1}`);
  assert(r.q2 === "2026-Q2", `2026-04-01 should be Q2, got ${r.q2}`);
  assert(r.q4 === "2026-Q4", `2026-12-31 should be Q4, got ${r.q4}`);
  await browser.close();
});
