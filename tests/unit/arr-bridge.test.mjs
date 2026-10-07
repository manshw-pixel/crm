// ARR bridge: opening (12m ago, existing customers) + new + expansion - contraction - churn
// = closing (today's ARR). New logos are reported here as new business, never in NRR/GRR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arrBridge, retentionStats } from "../../src/lib/retention.js";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const usd = (o) => ({ currency: "USD", arrUSD: o.arr, startDate: "2020-01-01", ...o });
const book = [
  usd({ id: "a", arr: 120000, arrEvents: [{ id: "e1", date: day(-40), delta: 20000, kind: "expansion" }] }), // grew 100k -> 120k
  usd({ id: "b", arr: 90000, arrEvents: [{ id: "e2", date: day(-20), delta: -10000, kind: "contraction" }] }), // 100k -> 90k
  usd({ id: "c", arr: 50000, churn: { date: day(-30), arr: 50000, currency: "USD" } }),                       // lost 50k
  usd({ id: "d", arr: 300000, startDate: day(-90), arrEvents: [{ id: "e3", date: day(-10), delta: 50000, kind: "expansion" }] }), // new logo
  usd({ id: "e", arr: 7000, startDate: day(-100), churn: { date: day(-5), arr: 7000, currency: "USD" } }),   // new logo, already lost
];

test("bridge components and identity", () => {
  const b = arrBridge(book, {});
  assert.equal(b.opening, 250000);      // a 100k + b 100k + c 50k
  assert.equal(b.expansion, 20000);     // a only: d's upsell is part of its new ARR
  assert.equal(b.contraction, 10000);
  assert.equal(b.churn, 50000);
  assert.equal(b.newARR, 300000);       // d at today's value; e churned so contributes 0
  assert.equal(b.newLogos, 2);
  assert.equal(b.newLost, 1);
  assert.equal(b.closing, 510000);      // a + b + d
  assert.equal(b.opening + b.newARR + b.expansion - b.contraction - b.churn, b.closing);
});

test("bridge NRR/GRR equal the dashboard tiles exactly", () => {
  const b = arrBridge(book, {}), r = retentionStats(book, {});
  assert.equal(b.nrr, r.nrr);
  assert.equal(b.grr, r.grr);
  assert.equal(b.nrr, (250000 + 20000 - 10000 - 50000) / 250000);
});

test("empty book", () => {
  const b = arrBridge([], {});
  assert.equal(b.opening, 0); assert.equal(b.closing, 0); assert.equal(b.nrr, null);
});
