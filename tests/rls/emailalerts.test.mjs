// Email alerts against a REAL Postgres. Builders are pure functions, so they are called
// directly with a superuser connection rather than through PostgREST -- execute is
// revoked from `authenticated`, which is the point.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql } from "./fixtures.mjs";

test("record_health writes one row per account", async () => {
  const { error } = await sessions.admin.rpc("record_health", {
    p_scores: [{ accountId: "h1", score: 72 }, { accountId: "h2", score: 44 }],
  });
  assert(!error, `record_health failed: ${error && error.message}`);
  const { data } = await sessions.admin
    .from("health_snapshots").select("*").in("account_id", ["h1", "h2"]);
  assert((data || []).length === 2, `expected 2 snapshot rows, got ${(data || []).length}`);
  assert(data.find(r => r.account_id === "h1").score === 72, "h1 score was not stored");
});

test("record_health upserts rather than duplicating within a day", async () => {
  await sessions.admin.rpc("record_health", { p_scores: [{ accountId: "h3", score: 50 }] });
  await sessions.admin.rpc("record_health", { p_scores: [{ accountId: "h3", score: 61 }] });
  const { data } = await sessions.admin
    .from("health_snapshots").select("*").eq("account_id", "h3");
  assert((data || []).length === 1, `second write duplicated the row: got ${(data || []).length}`);
  assert(data[0].score === 61, `expected the later score 61, got ${data[0].score}`);
});

test("an anonymous client cannot record health", async () => {
  const { error } = await sessions.anon.rpc("record_health", {
    p_scores: [{ accountId: "h4", score: 10 }],
  });
  assert(!!error, "an anonymous client was allowed to write health snapshots");
  // Prove the row genuinely does not exist -- otherwise the assertion above proves nothing.
  const { data } = await sessions.admin
    .from("health_snapshots").select("*").eq("account_id", "h4");
  assert((data || []).length === 0, "the anonymous write landed anyway");
});

test("email_log is admin-readable and closed to plain users", async () => {
  await sql(`insert into email_log (kind, recipient, row_count, status)
             values ('renewals', 'someone@test.local', 3, 'queued')`);
  const asAdmin = await sessions.admin.from("email_log").select("*");
  assert((asAdmin.data || []).length >= 1, "an admin could not read email_log");
  const asUser = await sessions.user.from("email_log").select("*");
  assert((asUser.data || []).length === 0, "a plain user could read email_log");
});

test("email_log refuses a second send of the same kind to the same person today", async () => {
  await sql(`insert into email_log (kind, recipient, row_count) values ('dupe', 'd@test.local', 1)`);
  let threw = false;
  try {
    await sql(`insert into email_log (kind, recipient, row_count) values ('dupe', 'd@test.local', 1)`);
  } catch (e) { threw = true; }
  assert(threw, "the uniqueness constraint did not prevent a duplicate send");
});
