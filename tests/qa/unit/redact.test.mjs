import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "../core.mjs";

test("redact replaces every non-empty password, skips null users and empty passes", () => {
  const env = { users: { admin: { pass: "s3cr+t" }, csm: { pass: "" }, am: null, lead: { pass: "pw2" } } };
  assert.equal(redact("bad s3cr+t and pw2 and s3cr+t", env), "bad [redacted] and [redacted] and [redacted]");
  assert.equal(redact("nothing", env), "nothing");
});
