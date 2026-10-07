// CSV import read arr/licenses with parseFloat(...) || 0: a blank cell or "$120,000" set an
// existing account's ARR to 0, and "1,000,000" (Excel's thousands separators) to 1 -- each
// booking a whole-account "contraction" with no warning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsvNumber, importSummary } from "../../src/lib/csv.js";

test("parseCsvNumber reads plain, grouped and currency-marked numbers", () => {
  assert.equal(parseCsvNumber("120000"), 120000);
  assert.equal(parseCsvNumber("1,000,000"), 1000000);
  assert.equal(parseCsvNumber("10,00,000"), 1000000);      // Indian grouping
  assert.equal(parseCsvNumber("$120,000"), 120000);
  assert.equal(parseCsvNumber("₹ 8,00,000.50"), 800000.5);
  assert.equal(parseCsvNumber(" USD 5000 "), 5000);
  assert.equal(parseCsvNumber("0"), 0);
});

test("parseCsvNumber: blank is '' (leave alone), garbage is null (report)", () => {
  assert.equal(parseCsvNumber(""), "");
  assert.equal(parseCsvNumber("   "), "");
  assert.equal(parseCsvNumber(undefined), "");
  for (const bad of ["n/a", "TBD", "1.2.3", "12abc", "1,2,3x", "--5"]) assert.equal(parseCsvNumber(bad), null, bad);
});

test("importSummary reports unreadable numbers", () => {
  assert.match(importSummary({ ok: 0, updated: 2, skipped: 0, badNumber: 2 }), /2 unreadable number/);
});
