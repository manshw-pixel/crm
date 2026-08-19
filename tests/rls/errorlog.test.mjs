// error_log against a REAL Postgres. The access rules and the counting are the
// load-bearing claims here and neither can be proven against a mock.
import { test, assert } from "../health/framework.mjs";
import { sessions } from "./fixtures.mjs";

// p_ prefixes: every argument name collides with a column of error_log, and an unprefixed
// parameter makes the function's own insert ambiguous at runtime.
const report = (who, fingerprint, extra = {}) =>
  sessions[who].rpc("log_error", {
    p_fingerprint: fingerprint, p_level: "crash", p_message: "boom", p_stack: "at x()",
    p_context: { view: "Accounts" }, p_app_version: "test", p_user_agent: "node",
    ...extra,
  });

const rowsAsAdmin = async fp => {
  const { data } = await sessions.admin.from("error_log").select("*").eq("fingerprint", fp);
  return data || [];
};

test("a plain user can report an error", async () => {
  const { error } = await report("user", "fp-user-1");
  assert(!error, `a plain user's report was rejected: ${error && error.message}`);
  assert((await rowsAsAdmin("fp-user-1")).length === 1, "the row was not written");
});

test("a plain user cannot READ the error log", async () => {
  await report("admin", "fp-read-1");
  const { data, error } = await sessions.user.from("error_log").select("*").eq("fingerprint", "fp-read-1");
  // RLS makes the rows invisible rather than raising, so assert on emptiness AND on the
  // row genuinely existing for an admin -- otherwise this passes when nothing was written.
  assert(!error, `unexpected error shape: ${error && error.message}`);
  assert((data || []).length === 0, "a plain user could read the error log");
  assert((await rowsAsAdmin("fp-read-1")).length === 1,
    "the row does not exist at all — the previous assertion proved nothing");
});

test("an admin can read the error log", async () => {
  await report("admin", "fp-read-2");
  const { data, error } = await sessions.admin.from("error_log").select("*").eq("fingerprint", "fp-read-2");
  assert(!error, `admin read failed: ${error && error.message}`);
  assert((data || []).length === 1, "the admin saw no rows");
});

test("an anonymous client can neither report nor read", async () => {
  const { error: insErr } = await report("anon", "fp-anon-1");
  assert(insErr, "an anonymous client was allowed to report an error");
  const { data } = await sessions.anon.from("error_log").select("*").limit(1);
  assert((data || []).length === 0, "an anonymous client could read the error log");
});

test("reporting the same fingerprint twice yields ONE row with count 2", async () => {
  await report("admin", "fp-count-1");
  await report("admin", "fp-count-1");
  const rows = await rowsAsAdmin("fp-count-1");
  assert(rows.length === 1, `expected one row, got ${rows.length}`);
  assert(rows[0].count === 2, `expected count 2, got ${rows[0].count}`);
});

test("N concurrent reports of one fingerprint all count", async () => {
  // The regression test for the read-modify-write race this design exists to avoid.
  // Reporting runs when the app is already unhealthy and concurrent failures are
  // CORRELATED -- one flaky network breaks every open tab at once -- so this is the
  // realistic case, not an exotic one.
  const N = 20;
  const results = await Promise.all(
    Array.from({ length: N }, () => report("admin", "fp-race-1")));
  const failed = results.filter(r => r.error);
  assert(!failed.length, `${failed.length} of ${N} reports errored: ${failed[0] && failed[0].error.message}`);
  const rows = await rowsAsAdmin("fp-race-1");
  assert(rows.length === 1, `expected one row, got ${rows.length}`);
  assert(rows[0].count === N,
    `${N - rows[0].count} of ${N} concurrent reports were LOST — the count is read-modify-write, not atomic. Got ${rows[0].count}`);
});

test("log_error stamps user_id from auth.uid(), ignoring the client", async () => {
  const { data: me } = await sessions.user.auth.getUser();
  await report("user", "fp-uid-1");
  const rows = await rowsAsAdmin("fp-uid-1");
  assert(rows[0].user_id === me.user.id,
    `expected the caller's own id, got ${rows[0].user_id}`);
});

test("a plain user cannot update or delete a row to erase their own errors", async () => {
  await report("user", "fp-tamper-1");
  const { error: upErr } = await sessions.user.from("error_log")
    .update({ count: 0, message: "nothing to see" }).eq("fingerprint", "fp-tamper-1");
  const { error: delErr } = await sessions.user.from("error_log")
    .delete().eq("fingerprint", "fp-tamper-1");
  // A denied update/delete raises nothing and affects zero rows, so read back as admin.
  assert(!upErr, `unexpected error shape: ${upErr && upErr.message}`);
  assert(!delErr, `unexpected error shape: ${delErr && delErr.message}`);
  const rows = await rowsAsAdmin("fp-tamper-1");
  assert(rows.length === 1, "the row was deleted — there must be no delete policy");
  assert(rows[0].message === "boom", "the row was edited — there must be no update policy");
});
