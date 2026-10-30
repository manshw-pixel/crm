// fmtMoney edge cases the golden suite locked in wrongly: negatives were never abbreviated
// and put the sign after the symbol ("$-12000"), and 999,999 rounded up to "$1000K".
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtMoney, fmtFinance } from "../../src/lib/money.js";

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

test("amounts that round to 1000M are shown as billions", () => {
  assert.equal(fmtMoney(1234567890), "$1.23B");
  assert.equal(fmtMoney(999999999), "$1.00B");
  assert.equal(fmtMoney(999994999), "$999.99M");
  assert.equal(fmtMoney(-2500000000, "INR"), "-₹2.50B");
});

test("finance amounts stay exact below a million and shorten from a million up", () => {
  assert.equal(fmtFinance(999999.99), "999,999.99");
  assert.equal(fmtFinance(1234567.5), "1.23M");
  assert.equal(fmtFinance(999999999), "1.00B");
  assert.equal(fmtFinance(-2500000000), "-2.50B");
  assert.equal(fmtFinance(0), "0.00");
});
