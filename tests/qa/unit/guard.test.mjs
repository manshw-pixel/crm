import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrgName, assertQaOrg, parseLiveVersion, checkVersion } from "../guard.mjs";
import { GuardError } from "../core.mjs";

test("org name parsing fails closed on placeholders", () => {
  assert.equal(parseOrgName("Admin · CRM"), "CRM");
  assert.equal(parseOrgName("Admin · …"), null);
  assert.equal(parseOrgName("Admin · "), null);
  assert.equal(parseOrgName("Admin"), null);
});

test("guard: exact match only", () => {
  assertQaOrg("CRM", "CRM");
  assert.throws(() => assertQaOrg("Acme Corp", "CRM"), GuardError);
  assert.throws(() => assertQaOrg("CRM 2", "CRM"), GuardError);
  assert.throws(() => assertQaOrg(null, "CRM"), GuardError);
});

test("version parse and compare", () => {
  assert.equal(parseLiveVersion('x const APP_VERSION = "cbadbda"; y'), "cbadbda");
  assert.equal(parseLiveVersion("nothing"), null);
  assert.equal(checkVersion("cbadbda", "cbadbda").ok, true);
  const r = checkVersion("aaaaaaa", "cbadbda");
  assert.equal(r.ok, false);
  assert.match(r.message, /live is aaaaaaa, master is cbadbda/);
});
