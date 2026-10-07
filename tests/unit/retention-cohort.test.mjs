// NRR/GRR measure the book that existed a year ago. A logo signed inside the trailing
// window used to land in both the base and the retained ARR, pulling every ratio toward
// 100% -- the more new business, the rosier churn looked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { retentionStats } from "../../src/lib/retention.js";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const kept = { id: "a", arr: 100000, arrUSD: 100000, currency: "USD", startDate: "2020-01-01" };
const churned = { id: "b", arr: 50000, arrUSD: 50000, currency: "USD", startDate: "2020-01-01",
  churn: { date: day(-30), arr: 50000, currency: "USD" } };
const newLogo = { id: "c", arr: 200000, arrUSD: 200000, currency: "USD", startDate: day(-60) };

test("a new logo does not move NRR or GRR", () => {
  const without = retentionStats([kept, churned], {});
  const withNew = retentionStats([kept, churned, newLogo], {});
  assert.ok(Math.abs(without.nrr - 100000 / 150000) < 1e-9, `baseline nrr ${without.nrr}`);
  assert.equal(withNew.nrr, without.nrr);
  assert.equal(withNew.grr, without.grr);
});

test("a new logo's own churn and expansion stay in the displayed totals", () => {
  const ex = { ...newLogo, id: "d", arrEvents: [{ id: "e1", date: day(-10), delta: 5000, currency: "USD", kind: "expansion" }] };
  const lostNew = { ...newLogo, id: "f", churn: { date: day(-5), arr: 7000, currency: "USD" } };
  const r = retentionStats([kept, ex, lostNew], {});
  assert.equal(r.expansion, 5000);
  assert.equal(r.churnedARR, 7000);
  assert.equal(r.lost, 1);
  assert.equal(r.nrr, 1); // only `kept` is in the cohort, and it did not move
});

test("an account with no startDate stays in the cohort", () => {
  const r = retentionStats([{ ...kept, startDate: undefined }, churned], {});
  assert.ok(Math.abs(r.nrr - 100000 / 150000) < 1e-9);
});
