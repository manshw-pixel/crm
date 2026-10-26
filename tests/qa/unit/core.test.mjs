import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRunId, runScenarios, summarise, GuardError, skipReason, SkipScenario } from "../core.mjs";

const ctx = async () => ({});
const sc = (id, run) => ({ id: `01-x/${id}`, feature: "01-x", title: id, run });

test("runId format", () => {
  assert.equal(makeRunId(new Date(2026, 9, 4, 9, 5)), "qa-20261004-0905");
});

test("pass, fail, and pass-on-retry is flaky", async () => {
  let n = 0;
  const r = await runScenarios([
    sc("ok", async () => {}),
    sc("bad", async () => { throw new Error("boom"); }),
    sc("wobbly", async () => { if (n++ === 0) throw new Error("first"); }),
  ], ctx);
  assert.deepEqual(r.map(x => [x.status, x.attempts]), [["pass", 1], ["fail", 2], ["flaky", 2]]);
  assert.equal(r[1].error, "boom");
  assert.deepEqual(summarise(r).byFeature["01-x"], { pass: 1, fail: 1, flaky: 1, skipped: 0 });
});

test("flaky keeps attempt 1's error and screenshot; pass/fail unchanged", async () => {
  let n = 0;
  const calls = [];
  const r = await runScenarios([
    sc("ok", async () => {}),
    sc("wobbly", async () => { if (n++ === 0) throw new Error("first"); }),
    sc("bad", async () => { throw new Error("boom"); }),
  ], ctx, { onFail: async (s, c, e, attempt) => { calls.push([s.title, attempt]); return { screenshot: `${s.title}-${attempt}.png` }; } });
  assert.deepEqual(r.map(x => x.status), ["pass", "flaky", "fail"]);
  assert.equal(r[0].firstError, undefined);
  assert.equal(r[1].firstError, "first");
  assert.deepEqual(r[1].firstArtifacts, { screenshot: "wobbly-1.png" });
  assert.equal(r[1].error, undefined);
  assert.deepEqual(r[2].artifacts, { screenshot: "bad-2.png" });
  assert.deepEqual(r[2].firstArtifacts, { screenshot: "bad-1.png" });
  assert.deepEqual(calls, [["wobbly", 1], ["bad", 1], ["bad", 2]]);
});

test("GuardError stops the run with no retry", async () => {
  let ran = 0;
  await assert.rejects(runScenarios([
    sc("g", async () => { ran++; throw new GuardError("wrong org"); }),
    sc("after", async () => { ran++; }),
  ], ctx), GuardError);
  assert.equal(ran, 1);
});

test("onFail artifacts attached to the final failure", async () => {
  const r = await runScenarios([sc("bad", async () => { throw new Error("x"); })], ctx,
    { onFail: async () => ({ screenshot: "s.png" }) });
  assert.equal(r[0].artifacts.screenshot, "s.png");
});

test("skip: non-null reason records skipped without calling makeCtx or run", async () => {
  let made = 0, ran = 0;
  const r = await runScenarios([
    { ...sc("am-only", async () => { ran++; }), role: "am" },
    sc("normal", async () => { ran++; }),
  ], async () => { made++; return {}; }, { skip: s => s.role === "am" ? "no AM user configured" : null });
  assert.equal(made, 1);
  assert.equal(ran, 1);
  assert.equal(r[0].status, "skipped");
  assert.equal(r[0].reason, "no AM user configured");
  assert.equal(r[0].attempts, 0);
  assert.equal(r[1].status, "pass");
  const s = summarise(r);
  assert.equal(s.skipped, 1);
  assert.equal(s.total, 2);
  assert.deepEqual(s.byFeature["01-x"], { pass: 1, fail: 0, flaky: 0, skipped: 1 });
});

test("GuardError carries the results gathered so far", async () => {
  const err = await runScenarios([
    sc("first", async () => {}),
    sc("g", async () => { throw new GuardError("wrong org"); }),
  ], ctx).catch(e => e);
  assert.ok(err instanceof GuardError);
  assert.equal(err.results.length, 1);
  assert.equal(err.results[0].status, "pass");
});

test("skipReason: scenario's own skip wins, else the AM rule", () => {
  const noAm = { users: { am: null } }, withAm = { users: { am: { email: "x" } } };
  assert.equal(skipReason({ role: "admin", skip: "platform only" }, withAm), "platform only");
  assert.equal(skipReason({ role: "am" }, noAm), "no AM user configured");
  assert.equal(skipReason({ role: "am" }, withAm), null);
  assert.equal(skipReason({ role: "admin" }, noAm), null);
});

test("SkipScenario thrown at runtime: skipped with its reason, one attempt, no onFail", async () => {
  let runs = 0, fails = 0, closes = 0;
  const r = await runScenarios([{ id: "f/s", feature: "f", title: "t", run: async () => { runs++; throw new SkipScenario("no limit"); } }],
    async () => ({ close: async () => { closes++; } }), { onFail: async () => { fails++; } });
  assert.equal(runs, 1); assert.equal(fails, 0); assert.equal(closes, 1);
  assert.equal(r[0].status, "skipped"); assert.equal(r[0].attempts, 1); assert.equal(r[0].reason, "no limit");
});

test("SkipScenario on retry after a failed attempt is a fail carrying attempt 1's error", async () => {
  let n = 0;
  const r = await runScenarios([{ id: "f/s", feature: "f", title: "t", run: async () => {
    if (++n === 1) throw new Error("boom"); throw new SkipScenario("already seeded"); } }], ctx);
  assert.equal(r.length, 1); assert.equal(r[0].status, "fail"); assert.equal(r[0].attempts, 2);
  assert.match(r[0].error, /^boom \(skipped on retry after failure: already seeded\)$/);
});

test("fail on both attempts keeps both errors when they differ, one when identical", async () => {
  let n = 0;
  const r = await runScenarios([
    sc("diff", async () => { throw new Error(++n === 1 ? "timeout on click" : "duplicate row"); }),
    sc("same", async () => { throw new Error("boom"); }),
  ], ctx);
  assert.equal(r[0].error, "duplicate row");
  assert.deepEqual(r[0].errors, ["timeout on click", "duplicate row"]);
  assert.equal(r[1].errors, undefined);
});

test("latestSeedRunId: newest entry that seeded; null when none did", async () => {
  const { latestSeedRunId } = await import("../core.mjs");
  assert.equal(latestSeedRunId([{ runId: "a", seedRunId: "a" }, { runId: "b" }, { runId: "c", seedRunId: "c" }, { runId: "d" }]), "c");
  assert.equal(latestSeedRunId([{ runId: "x" }]), null);
  assert.equal(latestSeedRunId(undefined), null);
});

test("redactResult scrubs error, errors[] and reason", async () => {
  const { redactResult, redact } = await import("../core.mjs");
  const env = { users: { admin: { pass: "s3cret!" } } };
  const r = redactResult({ error: "x s3cret!", errors: ["a s3cret!", "b"], reason: "r s3cret!" }, t => redact(t, env));
  assert.ok(!JSON.stringify(r).includes("s3cret!"));
  assert.deepEqual(r.errors, ["a [redacted]", "b"]);
});

test("skipReason: impl scenarios skip without an impl user", () => {
  assert.equal(skipReason({ role: "impl" }, { users: { impl: null } }), "no impl user configured");
  assert.equal(skipReason({ role: "impl" }, { users: { impl: { email: "i", pass: "p" } } }), null);
  assert.equal(skipReason({ role: "impl", skip: "x" }, { users: { impl: null } }), "x");
});
