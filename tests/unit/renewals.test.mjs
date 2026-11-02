import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RENEWAL_WINDOWS, renewalWindowOf, renewalWindows } from "../../src/lib/renewals.js";

const TODAY = "2026-11-02";
const plus = (n, base = TODAY) => {
  const [y, m, d] = base.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

test("renewalWindowOf: window boundaries", () => {
  const cases = [[0, "0-30"], [30, "0-30"], [31, "31-60"], [60, "31-60"], [61, "61-90"],
    [90, "61-90"], [91, "90+"], [400, "90+"], [-1, null]];
  for (const [n, want] of cases) assert.equal(renewalWindowOf(plus(n), TODAY), want, `+${n}d`);
  for (const bad of [undefined, null, "", "soon"]) assert.equal(renewalWindowOf(bad, TODAY), null);
  assert.equal(renewalWindowOf("2027-01-01", "2026-12-31"), "0-30");
  assert.equal(renewalWindowOf("2027-01-30", "2026-12-31"), "0-30");
  assert.equal(renewalWindowOf("2027-02-01", "2026-12-31"), "31-60");
});

test("renewalWindows: sums ARR and counts per window", () => {
  const accts = [
    { arrUSD: 38000, renewalDate: plus(15) }, { arrUSD: 240000, renewalDate: plus(25) },
    { arrUSD: 90000, renewalDate: plus(50) }, { arrUSD: 118000, renewalDate: plus(65) },
    { arrUSD: 74000, renewalDate: plus(115) }, { arrUSD: 5000, renewalDate: plus(-3) },
    { arrUSD: 7000 },
  ];
  assert.deepEqual(renewalWindows(accts, TODAY), [
    { key: "0-30", label: "0–30 days", arrUSD: 278000, count: 2 },
    { key: "31-60", label: "31–60 days", arrUSD: 90000, count: 1 },
    { key: "61-90", label: "61–90 days", arrUSD: 118000, count: 1 },
    { key: "90+", label: "90+ days", arrUSD: 74000, count: 1 },
  ]);
});

test("renewalWindows: empty list gives four zero entries; missing arrUSD counts 0", () => {
  assert.deepEqual(renewalWindows([], TODAY), RENEWAL_WINDOWS.map(w => ({ ...w, arrUSD: 0, count: 0 })));
  assert.deepEqual(renewalWindows(undefined, TODAY).map(w => w.count), [0, 0, 0, 0]);
  const r = renewalWindows([{ renewalDate: plus(5) }], TODAY);
  assert.equal(r[0].arrUSD, 0); assert.equal(r[0].count, 1);
});

test("renewals module is pure (no window/document)", () => {
  const src = readFileSync(new URL("../../src/lib/renewals.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\bwindow\.|\bdocument\.|^import /m);
});
