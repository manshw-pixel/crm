import { test } from "node:test";
import assert from "node:assert/strict";
import { signIn } from "../session.mjs";
import { GuardError } from "../core.mjs";

const env = { baseUrl: "http://x", orgName: "CRM", users: { admin: { email: "a@x.in", pass: "SECRET-pw" }, am: null } };

function fake({ evaluate, errorText = null }) {
  const calls = { closed: 0, filled: [] };
  const page = {
    addInitScript: async () => {}, goto: async () => {}, fill: async (sel, v) => { calls.filled.push(v); },
    getByRole: () => ({ click: async () => {} }),
    locator: () => ({ first: () => ({ textContent: async () => errorText }) }),
    evaluate, waitForTimeout: async () => {},
  };
  const context = { newPage: async () => page, close: async () => { calls.closed++; } };
  return { browser: { newContext: async () => context }, calls };
}
const T = { timeoutMs: 30 };

test("one matching row returns a usable ctx", async () => {
  const { browser, calls } = fake({ evaluate: async () => [{ name: "CRM" }] });
  const c = await signIn(browser, env, "admin", T);
  assert.equal(c.role, "admin");
  assert.equal(calls.closed, 0);
});

test("wrong org -> GuardError and context closed", async () => {
  const { browser, calls } = fake({ evaluate: async () => [{ name: "Acme" }] });
  await assert.rejects(signIn(browser, env, "admin", T), GuardError);
  assert.equal(calls.closed, 1);
});

test("evaluate always throwing -> GuardError after timeout, closed", async () => {
  const { browser, calls } = fake({ evaluate: async () => { throw new Error("sb not defined"); } });
  await assert.rejects(signIn(browser, env, "admin", T), GuardError);
  assert.equal(calls.closed, 1);
});

test("two rows (platform admin) -> GuardError", async () => {
  const { browser } = fake({ evaluate: async () => [{ name: "CRM" }, { name: "Acme" }] });
  await assert.rejects(signIn(browser, env, "admin", T), GuardError);
});

test("sign-in error text -> plain Error, no password, closed", async () => {
  const { browser, calls } = fake({ evaluate: async () => null, errorText: "Invalid login credentials" });
  await assert.rejects(signIn(browser, env, "admin", T), e => {
    assert.ok(!(e instanceof GuardError));
    assert.match(e.message, /sign-in failed for admin: Invalid login credentials/);
    assert.ok(!e.message.includes("SECRET-pw"));
    return true;
  });
  assert.equal(calls.closed, 1);
});

test("missing role user -> plain Error", async () => {
  const { browser } = fake({ evaluate: async () => [] });
  await assert.rejects(signIn(browser, env, "am", T), /no am user/);
});
