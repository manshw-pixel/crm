import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { rel, RATES, scored, bookSeed } from "./money-fixture.mjs";

const BOOK = [
  scored({ id: "c1", name: "Price One", arr: 100000, arrUSD: 0, csm: "Priya", tier: "Enterprise",
    churn: { date: rel(-30), arr: 100000, reason: "Price" } }),
  scored({ id: "c2", name: "Price Two", arr: 50000, arrUSD: 0, csm: "Marco", tier: "Mid",
    churn: { date: rel(-45), arr: 50000, reason: "Price" } }),
  scored({ id: "c3", name: "Fit One", arr: 200000, arrUSD: 0, csm: "Priya", tier: "Enterprise",
    churn: { date: rel(-60), arr: 200000, reason: "Product fit" } }),
  scored({ id: "a1", name: "Still Here", arr: 300000 }),
];

test("churnRows groups by reason and sorts by ARR lost", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(([b, rates]) => window.__health.churnRows(b, rates, "Reason"), [BOOK, RATES]);
  assert(rows.length === 2, `expected 2 reasons, got ${rows.length}: ${rows.map(r => r.k).join()}`);
  assert(rows[0].k === "Product fit", `largest loss should sort first, got ${rows[0].k}`);
  assert(rows[0].arr === 200000, `Product fit ARR expected 200000, got ${rows[0].arr}`);
  assert(rows[1].k === "Price" && rows[1].n === 2, `Price should hold 2 accounts, got ${JSON.stringify(rows[1])}`);
  assert(rows[1].arr === 150000, `Price ARR expected 150000, got ${rows[1].arr}`);
  await browser.close();
});

test("churnRows groups by CSM and by tier", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const r = await page.evaluate(([b, rates]) => ({
    csm: window.__health.churnRows(b, rates, "CSM"),
    tier: window.__health.churnRows(b, rates, "Tier"),
  }), [BOOK, RATES]);
  const priya = r.csm.find(x => x.k === "Priya");
  assert(priya && priya.n === 2 && priya.arr === 300000, `Priya expected 2 accts / 300000, got ${JSON.stringify(priya)}`);
  const ent = r.tier.find(x => x.k === "Enterprise");
  assert(ent && ent.n === 2 && ent.arr === 300000, `Enterprise expected 2 accts / 300000, got ${JSON.stringify(ent)}`);
  await browser.close();
});

test("churnRows falls back to Other and Unassigned for missing fields", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const book = [scored({ id: "m", name: "Mystery", arr: 10000, arrUSD: 0, csm: "",
    churn: { date: rel(-10), arr: 10000 } })];
  const r = await page.evaluate(([b, rates]) => ({
    reason: window.__health.churnRows(b, rates, "Reason")[0].k,
    csm: window.__health.churnRows(b, rates, "CSM")[0].k,
  }), [book, RATES]);
  assert(r.reason === "Other", `missing reason should read Other, got ${r.reason}`);
  assert(r.csm === "Unassigned", `missing CSM should read Unassigned, got ${r.csm}`);
  await browser.close();
});

test("the Quarterly dim returns exactly eight chronological zero-filled quarters", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // Clock injected: an absolute `now` makes the expected keys exact and keeps this test
  // stable on any calendar day. A churn is seeded into the window explicitly so this
  // asserts real bucketing, not just the zero-fill scaffolding.
  const book = [scored({ id: "q", name: "Q Churn", arr: 70000, arrUSD: 0,
    churn: { date: "2026-02-10", arr: 70000, reason: "Price" } })];
  const rows = await page.evaluate(([b, rates]) =>
    window.__health.churnRows(b, rates, "Quarterly", new Date("2026-05-15T12:00:00")), [book, RATES]);
  assert(rows.length === 8, `expected 8 quarters, got ${rows.length}`);
  assert(rows[0].k === "2024-Q3", `oldest quarter expected 2024-Q3, got ${rows[0].k}`);
  assert(rows[7].k === "2026-Q2", `newest quarter expected 2026-Q2, got ${rows[7].k}`);
  const keys = rows.map(r => r.k);
  assert(JSON.stringify(keys) === JSON.stringify([...keys].sort()), `quarters out of order: ${keys.join()}`);
  const q1 = rows.find(r => r.k === "2026-Q1");
  assert(q1.n === 1 && q1.arr === 70000, `the Feb churn should land in 2026-Q1, got ${JSON.stringify(q1)}`);
  assert(rows.filter(r => r.n === 0).length === 7, `the other seven quarters should be zero-filled, got ${JSON.stringify(keys)}`);
  await browser.close();
});

test("the Quarterly window rolls back across a year boundary", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // January is where `now.getMonth() - i * 3` goes negative and must borrow from the
  // previous year. Getting this wrong misfiles every quarter in Q1.
  const rows = await page.evaluate(([b, rates]) =>
    window.__health.churnRows(b, rates, "Quarterly", new Date("2026-01-10T12:00:00")), [BOOK, RATES]);
  assert(rows[0].k === "2024-Q2", `oldest quarter expected 2024-Q2, got ${rows[0].k}`);
  assert(rows[7].k === "2026-Q1", `newest quarter expected 2026-Q1, got ${rows[7].k}`);
  await browser.close();
});

test("a churn keeps its own currency, not the account's current one", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  // The account bills in USD today; it churned while billing in INR. The historical
  // event's currency is the correct one to convert with.
  const book = [scored({ id: "moved", name: "Moved Currency", arr: 100000, currency: "USD", arrUSD: 0,
    churn: { date: rel(-20), arr: 1000000, currency: "INR", reason: "Price" } })];
  const rows = await page.evaluate(([b, rates]) => window.__health.churnRows(b, rates, "Reason"), [book, RATES]);
  assert(Math.abs(rows[0].arr - 12000) < 1e-6, `1,000,000 INR at 0.012 expected 12000, got ${rows[0].arr}`);
  await browser.close();
});

test("churnRows on a book with no churn returns nothing", async () => {
  const { page, browser } = await launch(bookSeed(BOOK));
  await page.waitForFunction(() => window.__health);
  const rows = await page.evaluate(rates =>
    window.__health.churnRows([{ id: "x", name: "Fine", arr: 1, arrUSD: 1 }], rates, "Reason"), RATES);
  assert(rows.length === 0, `expected no rows, got ${JSON.stringify(rows)}`);
  await browser.close();
});
