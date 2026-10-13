import { test } from "node:test";
import assert from "node:assert/strict";
import { lastActivityDate, recencyBreakdown, scoreComponents } from "../../src/lib/scoring.js";

const today = new Date().toISOString().slice(0, 10);
const old = "2020-01-01";
const acct = { id: "a1", inputs: {} };
const real = { id: "x1", accountId: "a1", type: "note", date: old, summary: "talked" };
const sys = { id: "x2", accountId: "a1", type: "note", date: today, summary: "CSM changed from A to B by C", system: true };

test("system activities do not count as the last activity", () => {
  assert.equal(lastActivityDate("a1", [real, sys]), old);
  assert.equal(lastActivityDate("a1", [sys]), null);
});
test("system activities do not count toward per-type recency", () => {
  const note = recencyBreakdown(acct, [real, sys], null).find(p => p.type === "note");
  assert.equal(note.lastDate, old);
});
test("a system note does not raise the recency score", () => {
  const a = scoreComponents(acct, [real], null).recency;
  const b = scoreComponents(acct, [real, sys], null).recency;
  assert.equal(b, a);
});
