import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv, validateEnv } from "../env.mjs";

const FULL = `QA_BASE_URL=https://crm.onevio.in/crm.html
QA_ORG_NAME=CRM
# comment
QA_ADMIN_EMAIL=a@x.in
QA_ADMIN_PASS=p=w"1
QA_CSM_EMAIL=c@x.in
QA_CSM_PASS=p2
QA_AM_EMAIL=m@x.in
QA_AM_PASS=p3
QA_LEAD_EMAIL=l@x.in
QA_LEAD_PASS=p4`;

const NO_AM = FULL.split("\n").filter(l => !l.startsWith("QA_AM_")).join("\n");

test("parseEnv keeps '=' inside values and skips comments", () => {
  const e = parseEnv(FULL);
  assert.equal(e.QA_ADMIN_PASS, 'p=w"1');
  assert.equal(e.QA_ORG_NAME, "CRM");
  assert.equal(Object.keys(e).length, 10);
});

test("validateEnv builds the users map", () => {
  const q = validateEnv(parseEnv(FULL));
  assert.equal(q.users.lead.email, "l@x.in");
  assert.equal(q.users.am.email, "m@x.in");
  assert.equal(q.orgName, "CRM");
});

test("validateEnv names every missing key at once", () => {
  assert.throws(() => validateEnv({ QA_BASE_URL: "x" }), /QA_ORG_NAME.*QA_ADMIN_EMAIL.*QA_LEAD_PASS/s);
});

test("AM user is optional: absent keys give users.am === null", () => {
  const q = validateEnv(parseEnv(NO_AM));
  assert.equal(q.users.am, null);
  assert.equal(q.users.csm.email, "c@x.in");
});

test("blank AM keys also give users.am === null", () => {
  const q = validateEnv({ ...parseEnv(NO_AM), QA_AM_EMAIL: "", QA_AM_PASS: "" });
  assert.equal(q.users.am, null);
});

test("partial AM keys throw naming the missing one", () => {
  assert.throws(() => validateEnv({ ...parseEnv(NO_AM), QA_AM_EMAIL: "m@x.in" }), /QA_AM_PASS/);
  assert.throws(() => validateEnv({ ...parseEnv(NO_AM), QA_AM_PASS: "p" }), /QA_AM_EMAIL/);
});
