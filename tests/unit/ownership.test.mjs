import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNER_KEYS, isAdminUser, stripOwnerKeys, csmChangeSummary } from "../../src/lib/ownership.js";

test("owner keys are exactly csm, csmSince, leadId", () => {
  assert.deepEqual(OWNER_KEYS, ["csm", "csmSince", "leadId"]);
});

test("isAdminUser", () => {
  assert.equal(isAdminUser({ role: "admin" }), true);
  assert.equal(isAdminUser({ role: "user" }), false);
  assert.equal(isAdminUser(null), false);
});

test("stripOwnerKeys keeps everything for admins, drops owner keys for others", () => {
  const p = { arr: 5, csm: "B", csmSince: "2026-10-13", leadId: "x", tier: "Mid" };
  assert.deepEqual(stripOwnerKeys(p, { role: "admin" }), p);
  assert.deepEqual(stripOwnerKeys(p, { role: "user" }), { arr: 5, tier: "Mid" });
  assert.deepEqual(stripOwnerKeys(p, null), { arr: 5, tier: "Mid" });
  assert.equal("csm" in p, true, "must not mutate the input");
});

test("csmChangeSummary", () => {
  assert.equal(csmChangeSummary("Priya", "Priya", "Admin"), null);
  assert.equal(csmChangeSummary("", "", "Admin"), null);
  assert.equal(csmChangeSummary(null, undefined, "Admin"), null);
  assert.equal(csmChangeSummary("", "Ravi", "Admin"), "CSM set to Ravi by Admin");
  assert.equal(csmChangeSummary("Priya", "Ravi", "Admin"), "CSM changed from Priya to Ravi by Admin");
  assert.equal(csmChangeSummary("Priya", "", "Admin"), "CSM changed from Priya to (none) by Admin");
});
