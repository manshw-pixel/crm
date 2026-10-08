import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMIT_MIN, limitMessage, roomLeft, isOverLimit, usageLabel, parseLimit } from "../../src/lib/limits.js";

test("limitMessage matches the server text", () => {
  assert.equal(limitMessage("users", 10), "Your plan allows 10 users — contact OneVio to raise it.");
  assert.equal(limitMessage("accounts", 5), "Your plan allows 5 accounts — contact OneVio to raise it.");
});
test("roomLeft", () => {
  assert.equal(roomLeft(null, 999), Infinity);
  assert.equal(roomLeft(10, 7), 3);
  assert.equal(roomLeft(5, 8), 0); // over limit never goes negative
});
test("isOverLimit is strict and Unlimited is never over", () => {
  assert.equal(isOverLimit(5, 5), false);
  assert.equal(isOverLimit(6, 5), true);
  assert.equal(isOverLimit(1e6, null), false);
});
test("usageLabel", () => {
  assert.equal(usageLabel(7, 10), "7 / 10");
  assert.equal(usageLabel(42, null), "42 / ∞");
});
test("parseLimit", () => {
  assert.deepEqual(parseLimit(true, "1", LIMIT_MIN.users), { value: null, error: null });
  assert.deepEqual(parseLimit(false, "2", LIMIT_MIN.users), { value: 2, error: null });
  assert.deepEqual(parseLimit(false, " 12 ", LIMIT_MIN.accounts), { value: 12, error: null });
  assert.equal(parseLimit(false, "1", LIMIT_MIN.users).error, "Must be at least 2.");
  assert.equal(parseLimit(false, "4", LIMIT_MIN.accounts).error, "Must be at least 5.");
  assert.equal(parseLimit(false, "", 2).error, "Enter a whole number, or tick Unlimited.");
  assert.equal(parseLimit(false, "2.5", 2).error, "Enter a whole number, or tick Unlimited.");
  assert.equal(parseLimit(false, "abc", 2).error, "Enter a whole number, or tick Unlimited.");
});
