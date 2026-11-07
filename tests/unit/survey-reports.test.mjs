import { test } from "node:test";
import assert from "node:assert/strict";
import { filterSurveys, npsByYear, followUpStats, questionResults, roleSplit, previousPeriod, responsesCSV } from "../../src/lib/survey-reports.js";

const npsT = { questions: [{ id: "nps", type: "nps", text: "Recommend?" }] };
const sv = (o) => ({ id: "s" + Math.random(), accountId: "a1", contactId: "c1", contactName: "Arjun", contactRole: "", templateId: "t", template: npsT, source: "sent", sentAt: "2026-03-05T00:00:00Z", expiresAt: "2026-04-05", submittedAt: null, answers: {}, ...o });
const rateT = (scale) => ({ questions: [{ id: "q1", type: "rating", text: "Rate", scale }] });

test("questionResults keeps scales apart", () => {
  const r = questionResults([
    sv({ submittedAt: "2026-03-06", template: rateT(5), answers: { q1: 4 } }),
    sv({ submittedAt: "2026-03-06", template: rateT(7), answers: { q1: 6 } }),
  ], "t");
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(x => [x.n, x.avg]), [[1, 4], [1, 6]]);
});
test("rating average", () => {
  const r = questionResults([4, 5, 3].map(v => sv({ submittedAt: "2026-03-06", template: rateT(5), answers: { q1: v } })), "t");
  assert.equal(r[0].avg, 4);
  assert.deepEqual(r[0].dist, [0, 0, 1, 1, 1]);
});
test("missing answers are not counted in n", () => {
  const r = questionResults([sv({ submittedAt: "2026-03-06", template: rateT(5), answers: { q1: 4 } }), sv({ submittedAt: "2026-03-06", template: rateT(5), answers: {} })], "t");
  assert.equal(r[0].n, 1);
});
test("choice and text results", () => {
  const t = { questions: [{ id: "c", type: "single", text: "C", options: ["x", "y"] }, { id: "m", type: "text", text: "M" }] };
  const r = questionResults([
    sv({ submittedAt: "2026-03-06", template: t, answers: { c: "y", m: "old" } }),
    sv({ submittedAt: "2026-03-09", template: t, answers: { c: "y", m: "new" }, accountId: "a2" }),
  ], "t");
  assert.deepEqual(r[0].counts, [{ label: "y", n: 2 }, { label: "x", n: 0 }]);
  assert.deepEqual(r[1].items.map(i => i.text), ["new", "old"]);
});
test("roleSplit", () => {
  const rs = roleSplit([sv({ contactRole: "", submittedAt: "2026-03-06", answers: { nps: 9 } }), sv({ contactRole: "Admin", submittedAt: "2026-03-06", answers: { nps: 3 } })], "t");
  assert.deepEqual(rs.map(x => x.role), ["Admin", "No role"]);
});
const task = (o) => ({ source: "survey", surveyId: "S", questionId: "nps", owner: "Priya", status: "Done", createdAt: "2026-03-10", doneAt: "2026-03-12", ...o });
const S = [sv({ id: "S", submittedAt: "2026-03-09", answers: { nps: 2 } })];
test("followUpStats ignores reopened tasks", () => {
  const r = followUpStats(S, [task({ status: "Open", doneAt: "2026-03-11" })]);
  assert.equal(r.onTime, 0); assert.equal(r.open, 1);
});
test("followUpStats boundary", () => {
  assert.equal(followUpStats(S, [task({ doneAt: "2026-03-17" })]).onTime, 1);
  assert.equal(followUpStats(S, [task({ doneAt: "2026-03-18" })]).onTime, 0);
  const z = followUpStats(S, []);
  assert.equal(z.total, 0); assert.equal(z.rate, null);
  assert.equal(followUpStats(S, [task({ owner: "" })]).byCsm[0].csm, "Unassigned");
});
test("npsByYear uses the latest answer per contact", () => {
  const r = npsByYear([
    sv({ id: "1", submittedAt: "2026-03-06", answers: { nps: 2 } }),
    sv({ id: "2", submittedAt: "2026-05-06", answers: { nps: 10 } }),
  ], 3, "2026-11-07");
  assert.equal(r.length, 1);
  assert.equal(r[0].n, 1); assert.equal(r[0].promoters, 1);
});
test("npsByYear response rate", () => {
  const imp = sv({ source: "imported", submittedAt: "2026-03-06", answers: { nps: 9 } });
  const r = npsByYear([imp], 3, "2026-11-07");
  assert.equal(r[0].sent, 0); assert.equal(r[0].responseRate, null);
  const r2 = npsByYear([imp, sv({ contactId: "c2", submittedAt: "2026-03-07", answers: { nps: 9 } }), sv({ contactId: "c3" })], 3, "2026-11-07");
  assert.equal(r2[0].sent, 2); assert.equal(r2[0].responseRate, 50);
});
test("filterSurveys", () => {
  const acc = { a1: { csm: "Priya", tier: "Gold" }, a2: { csm: "Ravi", tier: "Silver" } };
  const L = [
    sv({ id: "1", submittedAt: "2026-03-10", contactRole: "Admin" }),
    sv({ id: "2", accountId: "a2", templateId: "u", source: "imported", sentAt: "2026-04-01", contactRole: "" }),
  ];
  const ids = f => filterSurveys(L, acc, f).map(s => s.id);
  assert.deepEqual(ids({}), ["1", "2"]);
  assert.deepEqual(ids({ templateId: "u" }), ["2"]);
  assert.deepEqual(ids({ csm: "Priya" }), ["1"]);
  assert.deepEqual(ids({ tier: "Silver" }), ["2"]);
  assert.deepEqual(ids({ role: "Admin" }), ["1"]);
  assert.deepEqual(ids({ role: "(none)" }), ["2"]);
  assert.deepEqual(ids({ source: "imported" }), ["2"]);
  assert.deepEqual(ids({ from: "2026-03-10", to: "2026-03-10" }), ["1"]);
  assert.deepEqual(ids({ from: "2026-03-11" }), ["2"]);
  assert.deepEqual(ids({ to: "2026-03-09" }), []);
});
test("previousPeriod", () => {
  assert.deepEqual(previousPeriod("2026-03-01", "2026-03-31"), { from: "2026-01-29", to: "2026-02-28" });
});
test("responsesCSV neutralises formulas", () => {
  const t = { questions: [{ id: "m", type: "text", text: "M" }] };
  const csv = responsesCSV([sv({ template: t, submittedAt: "2026-03-06", answers: { m: '=HYPERLINK("x")' } })], { a1: { name: "Lumen", csm: "P", tier: "Gold" } });
  assert.ok(csv.startsWith("Date,Account,CSM,Tier,Template,Contact,Role,Source,Question,Answer\n"));
  assert.ok(!csv.includes('"=HYPERLINK'));
  assert.ok(csv.includes("'=HYPERLINK"));
});
