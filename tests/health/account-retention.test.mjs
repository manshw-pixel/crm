import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { rel, RATES, scored, bookSeed } from "./money-fixture.mjs";

// A fixed "now" is not available to these functions, so tests pass `now` explicitly
// where the signature allows and use `rel()` offsets otherwise.
const DEC = "2025-12-31";

const call = async (fn, args) => {
  const { page, browser } = await launch(bookSeed([scored({ id: "seed", name: "Seed Co", arr: 1000 })]));
  await page.waitForFunction(() => window.__health);
  const out = await page.evaluate(([f, a]) => window.__health[f](...a), [fn, args]);
  await browser.close();
  return out;
};

test("lastCompletedDecember returns the prior 31 December for a mid-year date", async () => {
  const d = await call("lastCompletedDecember", ["2026-08-19"]);
  assert(d === "2025-12-31", `expected 2025-12-31, got ${d}`);
});

test("lastCompletedDecember in January still points at the December just gone", async () => {
  const d = await call("lastCompletedDecember", ["2027-01-05"]);
  assert(d === "2026-12-31", `expected 2026-12-31, got ${d}`);
});

test("lastCompletedDecember on 31 December treats that December as complete", async () => {
  const d = await call("lastCompletedDecember", ["2026-12-31"]);
  assert(d === "2026-12-31", `expected 2026-12-31, got ${d}`);
});

test("arrAsOf on an account with no history returns today's ARR", async () => {
  const a = scored({ id: "flat", name: "Flat Co", arr: 100000 });
  const v = await call("arrAsOf", [a, DEC, RATES]);
  assert(v === 100000, `expected 100000, got ${v}`);
});

test("arrAsOf undoes an ARR event dated after the baseline", async () => {
  // today 120000, +20000 event in 2026 => baseline was 100000
  const a = scored({ id: "grew", name: "Grew Co", arr: 120000,
    arrEvents: [{ id: "e1", date: "2026-03-01", delta: 20000, kind: "expansion", source: "adjustment" }] });
  const v = await call("arrAsOf", [a, DEC, RATES]);
  assert(v === 100000, `expected 100000, got ${v}`);
});

test("arrAsOf ignores an ARR event dated before the baseline", async () => {
  const a = scored({ id: "old", name: "Old Co", arr: 120000,
    arrEvents: [{ id: "e1", date: "2025-06-01", delta: 20000, kind: "expansion", source: "adjustment" }] });
  const v = await call("arrAsOf", [a, DEC, RATES]);
  assert(v === 120000, `expected 120000 (event predates baseline), got ${v}`);
});

test("arrAsOf undoes a renewal completed after the baseline", async () => {
  const a = scored({ id: "ren", name: "Renewed Co", arr: 150000,
    renewals: [{ id: "r1", completedOn: "2026-02-01", prevArr: 100000, arr: 150000, by: "Priya" }] });
  const v = await call("arrAsOf", [a, DEC, RATES]);
  assert(v === 100000, `expected 100000, got ${v}`);
});

test("arrAsOf SKIPS a redenomination — a currency restatement is not revenue movement", async () => {
  const a = scored({ id: "redenom", name: "Redenom Co", arr: 108000,
    arrEvents: [{ id: "e1", date: "2026-04-01", delta: 8000, kind: "redenomination", source: "adjustment" }] });
  const v = await call("arrAsOf", [a, DEC, RATES]);
  assert(v === 108000, `a redenomination must not read as growth: got ${v}`);
});

test("arrAsOf on an account churned after the baseline returns its pre-churn ARR", async () => {
  const a = scored({ id: "lost", name: "Lost Co", arr: 50000, arrUSD: 0,
    churn: { date: "2026-05-01", arr: 50000, reason: "Price" } });
  const v = await call("arrAsOf", [a, DEC, RATES]);
  assert(v === 50000, `expected the pre-churn 50000, got ${v}`);
});

test("arrAsOf returns zero for an account already churned at the baseline", async () => {
  // The account died in mid-2025. At the Dec'25 close it carried no ARR, so its baseline
  // is 0 -- not the pre-churn figure that still sits in `arr`. Reading `arr` here would
  // report a 2025 churn as movement during 2026.
  const a = scored({ id: "gone", name: "Gone Co", arr: 50000, arrUSD: 0,
    churn: { date: "2025-06-01", arr: 50000, reason: "Price" } });
  const v = await call("arrAsOf", [a, DEC, RATES]);
  assert(v === 0, `an account churned before the baseline must have a zero baseline, got ${v}`);
});

const NOW = "2026-08-19";

test("accountRetention reports growth against the prior-year close", async () => {
  const a = scored({ id: "grew", name: "Grew Co", arr: 120000,
    startDate: "2024-01-01",
    arrEvents: [{ id: "e1", date: "2026-03-01", delta: 20000, kind: "expansion", source: "adjustment" }] });
  const r = await call("accountRetention", [a, RATES, NOW]);
  assert(r.isNew === false, "an account started in 2024 is not new");
  assert(r.baselineARR === 100000, `baseline should be 100000, got ${r.baselineARR}`);
  assert(r.currentARR === 120000, `current should be 120000, got ${r.currentARR}`);
  assert(r.delta === 20000, `delta should be 20000, got ${r.delta}`);
  assert(Math.abs(r.pct - 20) < 0.05, `pct should be 20, got ${r.pct}`);
  assert(r.baselineKey === "Dec'25", `baselineKey should be Dec'25, got ${r.baselineKey}`);
});

test("accountRetention reports contraction with GRR below 100%", async () => {
  const a = scored({ id: "shrank", name: "Shrank Co", arr: 80000,
    startDate: "2024-01-01",
    arrEvents: [{ id: "e1", date: rel(-100), delta: -20000, kind: "contraction", source: "adjustment" }] });
  const r = await call("accountRetention", [a, RATES, NOW]);
  assert(r.delta < 0, `delta should be negative, got ${r.delta}`);
  assert(r.grr !== null && r.grr < 1, `GRR should be below 1, got ${r.grr}`);
});

test("accountRetention marks an account started after the baseline as new, with null metrics", async () => {
  const a = scored({ id: "fresh", name: "Fresh Co", arr: 60000, startDate: "2026-03-01" });
  const r = await call("accountRetention", [a, RATES, NOW]);
  assert(r.isNew === true, "an account started in 2026 is new relative to Dec'25");
  assert(r.nrr === null && r.grr === null, `metrics must be null for a new account, got ${r.nrr}/${r.grr}`);
  assert(r.delta === null && r.pct === null, `delta/pct must be null for a new account`);
});

test("accountRetention gives a churned account 0% GRR", async () => {
  const a = scored({ id: "lost", name: "Lost Co", arr: 50000, arrUSD: 0,
    startDate: "2023-01-01",
    churn: { date: rel(-60), arr: 50000, reason: "Price" } });
  const r = await call("accountRetention", [a, RATES, NOW]);
  assert(r.grr === 0, `a churned account's GRR should be 0, got ${r.grr}`);
  assert(r.currentARR === 0, `a churned account holds no ARR today, got ${r.currentARR}`);
});

test("accountRetention shows no movement for a non-USD account whose local ARR never changed", async () => {
  const a = scored({ id: "eur", name: "Euro Co", arr: 100000, currency: "EUR", startDate: "2024-01-01" });
  const r = await call("accountRetention", [a, RATES, NOW]);
  assert(r.delta === 0, `FX drift must not create movement: delta was ${r.delta}`);
});

test("accountRetention agrees with retentionStats for a single account", async () => {
  // The tie-out that matters: there must be exactly one retention formula.
  const a = scored({ id: "tie", name: "Tie Co", arr: 120000, startDate: "2024-01-01",
    renewals: [{ id: "r1", completedOn: rel(-180), prevArr: 100000, arr: 120000, by: "Priya" }] });
  const { page, browser } = await launch(bookSeed([a]));
  await page.waitForFunction(() => window.__health);
  const [mine, theirs] = await page.evaluate(([acct, rates, now]) => [
    window.__health.accountRetention(acct, rates, now),
    window.__health.retentionStats([acct], rates),
  ], [a, RATES, NOW]);
  await browser.close();
  assert(mine.nrr === theirs.nrr, `NRR disagrees: ${mine.nrr} vs ${theirs.nrr}`);
  assert(mine.grr === theirs.grr, `GRR disagrees: ${mine.grr} vs ${theirs.grr}`);
});

test("accountRetention does not throw on an account with no fields set", async () => {
  const r = await call("accountRetention", [{ id: "bare", arr: 0, arrUSD: 0, currency: "USD" }, RATES, NOW]);
  assert(r && typeof r === "object", "should return an object rather than throwing");
  assert(!Number.isNaN(r.baselineARR), `baselineARR must not be NaN, got ${r.baselineARR}`);
});
