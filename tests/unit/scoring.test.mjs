import { goldenSuite } from "./_golden.mjs";
import * as lib from "../../src/lib/scoring.js";
goldenSuite("scoring", lib);

import { test } from "node:test";
import assert from "node:assert/strict";
test("flagSeverity follows the approved rule", () => {
  const { flagSeverity } = lib;
  assert.equal(flagSeverity("Health ↓12"), "red");
  assert.equal(flagSeverity("Renewal in 0d"), "red");
  assert.equal(flagSeverity("Renewal in 29d"), "red");
  assert.equal(flagSeverity("Renewal in 30d"), "amber");
  assert.equal(flagSeverity("Renewal in 59d"), "amber");
  assert.equal(flagSeverity("No activity 30d+"), "amber");
  assert.equal(flagSeverity("Inputs stale 52d"), "grey");
  assert.equal(flagSeverity("anything else"), "grey");
});
