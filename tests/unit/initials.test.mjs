import { test } from "node:test";
import assert from "node:assert/strict";
import { initialsOf } from "../../src/lib/initials.js";

test("initialsOf: first letters of the first two words, upper-case", () => {
  assert.equal(initialsOf("Priya Shah", "p@x.io"), "PS");
  assert.equal(initialsOf("priya  shah kumar", ""), "PS");
  assert.equal(initialsOf("Rahul", "r@x.io"), "R");
  assert.equal(initialsOf("  Anita   Rao  "), "AR");
});
test("initialsOf: empty name falls back to the email's first letter", () => {
  assert.equal(initialsOf("", "z@x.io"), "Z");
  assert.equal(initialsOf(null, "zed@x.io"), "Z");
  assert.equal(initialsOf("   ", undefined), "");
  assert.equal(initialsOf(undefined, undefined), "");
});
