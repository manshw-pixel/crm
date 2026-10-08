import { test } from "node:test";
import assert from "node:assert/strict";
import { licenseFigures, licenseSummary } from "../../src/lib/licenses.js";

const A = (id, licenses, deployedLicenses, name = id) => ({ id, name, licenses, ...(deployedLicenses === undefined ? {} : { deployedLicenses }) });

test("licenseFigures: not set, not recorded, recorded, zero, numeric strings", () => {
  assert.deepEqual(licenseFigures({}), { total: 0, deployed: null, pct: null });
  assert.deepEqual(licenseFigures(A("a", 200)), { total: 200, deployed: null, pct: null });
  assert.deepEqual(licenseFigures(A("a", 200, 150)), { total: 200, deployed: 150, pct: 75 });
  assert.deepEqual(licenseFigures(A("a", 200, 0)), { total: 200, deployed: 0, pct: 0 });
  assert.deepEqual(licenseFigures(A("a", "200", "150")), { total: 200, deployed: 150, pct: 75 });
  assert.deepEqual(licenseFigures(A("a", 200, null)), { total: 200, deployed: null, pct: null });
  assert.deepEqual(licenseFigures(A("a", 200, "")), { total: 200, deployed: null, pct: null });
  assert.deepEqual(licenseFigures(A("a", 0, 5)), { total: 0, deployed: 5, pct: null });
  assert.deepEqual(licenseFigures({ licenses: 200, deployedLicenses: "  " }), { total: 200, deployed: null, pct: null });
});

test("licenseFigures: over-deployment exceeds 100 and rounding", () => {
  assert.equal(licenseFigures(A("a", 100, 130)).pct, 130);
  assert.equal(licenseFigures(A("a", 3, 1)).pct, 33);
  assert.equal(licenseFigures(A("a", 3, 2)).pct, 67);
});

test("licenseSummary: only accounts with both figures feed the totals and %", () => {
  const s = licenseSummary([A("a", 200, 150), A("b", 100, 50), A("c", 400), A("d", 0, 10), A("e", undefined)]);
  assert.equal(s.total, 300);
  assert.equal(s.deployed, 200);
  assert.equal(s.pct, 67);
  assert.equal(s.counted, 3);          // a, b, c have licenses > 0
  assert.equal(s.missingDeployed, 1);  // c
});

test("licenseSummary: lowest is ascending by ratio, ties by name, capped at 5", () => {
  const s = licenseSummary([A("1", 100, 90, "Zeta"), A("2", 100, 10, "Beta"), A("3", 100, 10, "Alpha"),
    A("4", 100, 50, "C"), A("5", 100, 60, "D"), A("6", 100, 70, "E"), A("7", 100, 80, "F")]);
  assert.deepEqual(s.lowest.map(x => x.name), ["Alpha", "Beta", "C", "D", "E"]);
  assert.deepEqual(s.lowest[0], { id: "3", name: "Alpha", total: 100, deployed: 10, pct: 10 });
});

test("licenseSummary: empty and no-deployed cases", () => {
  assert.deepEqual(licenseSummary([]), { total: 0, deployed: 0, pct: null, counted: 0, missingDeployed: 0, lowest: [] });
  const s = licenseSummary([A("a", 200), A("b", 100)]);
  assert.equal(s.counted, 2); assert.equal(s.missingDeployed, 2); assert.equal(s.pct, null); assert.deepEqual(s.lowest, []);
});
