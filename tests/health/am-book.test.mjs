// amBookMovement(accounts, rates, now): the AM book split by handover cohort, with each
// cohort's current-year ARR movement. The cohorts come from `transitionDate`; the money
// comes from the same ledger replay arrAsOf uses, so this card and Analytics cannot drift.
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { scored, bookSeed, RATES } from "./money-fixture.mjs";

const NOW = "2026-08-27";
const PRIOR_CLOSE = "2025-12-31";

// Analytics take rates as an argument, so a bare book is enough to exercise the maths.
const call = (page, accounts, now = NOW) => page.evaluate(
  ([a, r, n]) => window.__health.amBookMovement(a, r, n), [accounts, RATES, now]);

const boot = async accounts => {
  const { page, browser } = await launch(bookSeed(accounts));
  await page.waitForFunction(() => window.__health);
  return { page, browser };
};

const ids = section => section.accounts.map(a => a.id).sort();

/* ------------------------------- cohorts ------------------------------- */

test("cohorts split on the prior-year close, not on today", async () => {
  const book = [
    scored({ id: "old", name: "Old Co", arr: 100000, transitionDate: "2024-05-01" }),
    // exactly ON the prior close: the year had not turned, so this is still prior-year AM
    scored({ id: "edge-dec", name: "Edge Dec", arr: 100000, transitionDate: PRIOR_CLOSE }),
    // the first day of the current year belongs to the "moved this year" cohort
    scored({ id: "edge-jan", name: "Edge Jan", arr: 100000, transitionDate: "2026-01-01" }),
    scored({ id: "mid", name: "Mid Co", arr: 100000, transitionDate: "2026-06-01" }),
    scored({ id: "none", name: "No Date Co", arr: 100000 }),
  ];
  const { page, browser } = await boot(book);
  const r = await call(page, book);
  assert(ids(r.owned).join() === "edge-dec,old", `owned cohort wrong: ${ids(r.owned)}`);
  assert(ids(r.moved).join() === "edge-jan,mid", `moved cohort wrong: ${ids(r.moved)}`);
  assert(ids(r.scheduled).join() === "none", `scheduled cohort wrong: ${ids(r.scheduled)}`);
  await browser.close();
});

test("a future transition date is a scheduled handover, not part of the AM book", async () => {
  const book = [scored({ id: "future", name: "Future Co", arr: 100000, transitionDate: "2026-12-01" })];
  const { page, browser } = await boot(book);
  const r = await call(page, book);
  assert(ids(r.scheduled).length === 1, `expected the future handover in scheduled: ${JSON.stringify(r.scheduled)}`);
  assert(r.owned.accounts.length === 0 && r.moved.accounts.length === 0,
    "a future handover must not count as AM-owned");
  await browser.close();
});

test("a churned account is never listed as a scheduled handover", async () => {
  const book = [scored({ id: "dead", name: "Dead Co", arr: 100000, churn: { date: "2026-03-01", arr: 100000 } })];
  const { page, browser } = await boot(book);
  const r = await call(page, book);
  assert(r.scheduled.accounts.length === 0,
    `a churned account cannot be handed over: ${JSON.stringify(r.scheduled)}`);
  await browser.close();
});

/* ------------------------------ the money ------------------------------ */

// The load-bearing invariant: opening + expansion - reduction === current. If this fails
// the card is showing numbers that do not reconcile, which is worse than showing nothing.
const checkInvariant = section => section.accounts.concat([section.totals]).forEach(b => {
  const closed = b.opening + b.expansion - b.reduction;
  assert(closed === b.current,
    `invariant broken for ${b.id || "totals"}: ${b.opening} + ${b.expansion} - ${b.reduction}`
    + ` = ${closed}, current ${b.current}`);
});

test("opening plus expansion minus reduction equals the current balance", async () => {
  const book = [
    scored({ id: "grew", arr: 140000, transitionDate: "2024-01-01",
      arrEvents: [{ id: "e1", date: "2026-03-01", delta: 40000, kind: "expansion", source: "adjustment" }] }),
    scored({ id: "shrank", arr: 80000, transitionDate: "2024-01-01",
      arrEvents: [{ id: "e2", date: "2026-04-01", delta: -20000, kind: "contraction", source: "adjustment" }] }),
    scored({ id: "renewed", arr: 110000, transitionDate: "2026-02-01",
      renewals: [{ id: "r1", completedOn: "2026-05-01", arr: 110000, prevArr: 100000 }] }),
  ];
  const { page, browser } = await boot(book);
  const r = await call(page, book);
  checkInvariant(r.owned);
  checkInvariant(r.moved);
  await browser.close();
});

test("expansion and reduction are reported separately, not netted", async () => {
  const book = [scored({ id: "both", arr: 100000, transitionDate: "2024-01-01",
    arrEvents: [
      { id: "e1", date: "2026-03-01", delta: 30000, kind: "expansion", source: "adjustment" },
      { id: "e2", date: "2026-04-01", delta: -30000, kind: "contraction", source: "adjustment" },
    ] })];
  const { page, browser } = await boot(book);
  const r = await call(page, book);
  const t = r.owned.totals;
  assert(t.expansion === 30000, `expected 30000 expansion, got ${t.expansion}`);
  assert(t.reduction === 30000, `expected 30000 reduction, got ${t.reduction}`);
  assert(t.opening === t.current, `a wash should end flat: ${t.opening} -> ${t.current}`);
  await browser.close();
});

test("an account churned during the year books its whole opening ARR as reduction", async () => {
  const book = [scored({ id: "dead", arr: 100000, transitionDate: "2024-01-01",
    churn: { date: "2026-03-01", arr: 100000 } })];
  const { page, browser } = await boot(book);
  const r = await call(page, book);
  const t = r.owned.totals;
  assert(t.opening === 100000, `expected a 100000 opening, got ${t.opening}`);
  assert(t.reduction === 100000, `expected the churn as a 100000 reduction, got ${t.reduction}`);
  assert(t.current === 0, `a churned account holds no ARR today, got ${t.current}`);
  checkInvariant(r.owned);
  await browser.close();
});

test("an account churned before the year contributes nothing at all", async () => {
  const book = [scored({ id: "long-dead", arr: 100000, transitionDate: "2024-01-01",
    churn: { date: "2025-03-01", arr: 100000 } })];
  const { page, browser } = await boot(book);
  const r = await call(page, book);
  const t = r.owned.totals;
  assert(t.opening === 0 && t.expansion === 0 && t.reduction === 0 && t.current === 0,
    `a pre-year churn must not move this year's numbers: ${JSON.stringify(t)}`);
  await browser.close();
});

test("a redenomination is not counted as expansion or reduction", async () => {
  const book = [scored({ id: "fx", arr: 8400000, currency: "INR", arrUSD: 100800,
    transitionDate: "2024-01-01",
    arrEvents: [{ id: "e1", date: "2026-03-01", delta: 0, kind: "redenomination",
      fromCurrency: "USD", toCurrency: "INR", fromArr: 100000, toArr: 8400000 }] })];
  const { page, browser } = await boot(book);
  const r = await call(page, book);
  const t = r.owned.totals;
  assert(t.expansion === 0 && t.reduction === 0, `FX restatement leaked into movement: ${JSON.stringify(t)}`);
  await browser.close();
});

test("scheduled handovers report ARR but no year movement", async () => {
  const book = [scored({ id: "none", arr: 250000 })];
  const { page, browser } = await boot(book);
  const r = await call(page, book);
  assert(r.scheduled.totals.current === 250000,
    `expected 250000 pending ARR, got ${JSON.stringify(r.scheduled.totals)}`);
  assert(r.scheduled.totals.count === 1, `expected a count of 1, got ${r.scheduled.totals.count}`);
  await browser.close();
});

test("a foreign-currency account is measured in USD", async () => {
  const book = [scored({ id: "inr", arr: 10000000, currency: "INR", arrUSD: 120000, transitionDate: "2024-01-01" })];
  const { page, browser } = await boot(book);
  const r = await call(page, book);
  assert(r.owned.totals.current === 120000, `expected the USD figure, got ${r.owned.totals.current}`);
  await browser.close();
});

/* --------------------------------- UI --------------------------------- */

// bookSeed omits `profiles`, which is fine for calling __health directly but leaves the
// app with no signed-in user, so no view renders. Anything asserting on the DOM needs it.
const seedWithUser = accounts => bookSeed(accounts).replace("settings: [] };",
  `settings: [], profiles: [{ id: "u1", name: "Test User", role: "admin" }] };`);

test("the dashboard card shows the three section totals and expands to accounts", async () => {
  const book = [
    scored({ id: "old", name: "Oldbook Co", arr: 500000, transitionDate: "2024-01-01" }),
    scored({ id: "new", name: "Newbook Co", arr: 400000, transitionDate: "2026-02-01" }),
    scored({ id: "pending", name: "Pending Co", arr: 250000 }),
  ];
  const { page, browser } = await launch(seedWithUser(book));
  await page.waitForSelector("[data-am-book]");
  const collapsed = await page.textContent("[data-am-book]");
  assert(/Owned before/i.test(collapsed), `no section 1 header: ${collapsed}`);
  assert(/Moved to AM/i.test(collapsed), `no section 2 header: ${collapsed}`);
  assert(/Scheduled handover/i.test(collapsed), `no section 3 header: ${collapsed}`);
  // collapsed shows totals only -- no account rows
  assert(!/Oldbook Co/.test(collapsed), `collapsed card leaked account rows: ${collapsed}`);
  await page.click("[data-am-book-toggle]");
  await page.waitForFunction(() => /Oldbook Co/.test(document.querySelector("[data-am-book]").textContent));
  const open = await page.textContent("[data-am-book]");
  ["Oldbook Co", "Newbook Co", "Pending Co"].forEach(n =>
    assert(open.includes(n), `expanded card missing ${n}: ${open}`));
  await browser.close();
});

test("the card sits above Recently declined", async () => {
  const book = [scored({ id: "old", name: "Oldbook Co", arr: 500000, transitionDate: "2024-01-01" })];
  const { page, browser } = await launch(seedWithUser(book));
  await page.waitForSelector("[data-am-book]");
  const declinedFollows = await page.evaluate(() => {
    const card = document.querySelector("[data-am-book]");
    const declined = [...document.querySelectorAll("*")].find(el => el.textContent.trim() === "Recently declined");
    if (!declined) return null;
    return (card.compareDocumentPosition(declined) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
  });
  assert(declinedFollows === true,
    `the AM book card should precede Recently declined (got ${declinedFollows})`);
  await browser.close();
});

test("a scheduled handover shows an ARR figure only under Today, never under 1 Jan", async () => {
  const book = [scored({ id: "pending", name: "Pending Co", arr: 250000 })];
  const { page, browser } = await launch(seedWithUser(book));
  await page.waitForSelector("[data-am-book]");
  await page.click("[data-am-book-toggle]");
  await page.waitForFunction(() => /Pending Co/.test(document.querySelector("[data-am-book]").textContent));
  // The account row's five cells: name, 1 Jan, expansion, reduction, today.
  const cells = await page.evaluate(() => {
    const row = [...document.querySelectorAll("[data-am-book] div")]
      .find(d => d.children.length === 5 && d.textContent.includes("Pending Co"));
    return [...row.children].map(c => c.textContent.trim());
  });
  assert(cells[4].includes("250"), `Today should carry the ARR, got ${JSON.stringify(cells)}`);
  assert(!/\d/.test(cells[1]), `1 Jan must hold no figure for a pending handover, got ${JSON.stringify(cells)}`);
  assert(!/\d/.test(cells[2]) && !/\d/.test(cells[3]),
    `movement columns must stay empty for a pending handover, got ${JSON.stringify(cells)}`);
  await browser.close();
});
