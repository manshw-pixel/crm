// fmtMoney edge cases the golden suite locked in wrongly: negatives were never abbreviated
// and put the sign after the symbol ("$-12000"), and 999,999 rounded up to "$1000K".
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtMoney } from "../../src/lib/money.js";

test("negative amounts take a leading sign and the same abbreviation as positives", () => {
  assert.equal(fmtMoney(-12000), "-$12K");
  assert.equal(fmtMoney(-2345678, "INR"), "-₹2.35M");
  assert.equal(fmtMoney(-5), "-$5");
});

test("amounts that round to 1000K are shown as millions", () => {
  assert.equal(fmtMoney(999999), "$1.00M");
  assert.equal(fmtMoney(999499), "$999K");
});

test("rounding to zero never shows a negative zero", () => {
  assert.equal(fmtMoney(-0.4), "$0");
});
