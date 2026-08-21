// Email alerts against a REAL Postgres. Builders are pure functions, so they are called
// directly with a superuser connection rather than through PostgREST -- execute is
// revoked from `authenticated`, which is the point.
import { test, assert } from "../health/framework.mjs";
import { sessions } from "./fixtures.mjs";

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
