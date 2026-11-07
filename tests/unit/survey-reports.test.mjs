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

// ---- Surveys page Overview helpers ----
import { surveyStatsByCsm, detractorsAwaiting } from "../../src/lib/survey-reports.js";
const ACC = { a1: { csm: "Priya" }, a2: { csm: "Ravi" }, a3: { csm: "" } };
const WIN = { start: "2026-03-01" };
test("surveyStatsByCsm groups by account CSM, blank is Unassigned, imported not counted as sent", () => {
  const L = [
    sv({ id: "1", accountId: "a1", contactId: "c1", submittedAt: "2026-03-06", answers: { nps: 10 } }),
    sv({ id: "2", accountId: "a1", contactId: "c2" }),
    sv({ id: "3", accountId: "a1", contactId: "c3", source: "imported", submittedAt: "2026-03-07", answers: { nps: 2 } }),
    sv({ id: "4", accountId: "a2", contactId: "c4", submittedAt: "2026-03-08", answers: { nps: 3 } }),
    sv({ id: "5", accountId: "a3", contactId: "c5" }),
    sv({ id: "6", accountId: "a1", contactId: "c6", sentAt: "2025-03-05T00:00:00Z", submittedAt: "2025-03-06", answers: { nps: 9 } }),
  ];
  const r = surveyStatsByCsm(L, ACC, [], WIN);
  assert.deepEqual(r.map(x => x.csm), ["Priya", "Ravi", "Unassigned"]);
  const p = r[0];
  assert.equal(p.sent, 2); assert.equal(p.answered, 1); assert.equal(p.rate, 50);
  assert.equal(p.n, 2); assert.equal(p.nps, 0); // 10 promoter, 2 detractor; the 2025 answer is another campaign
  assert.equal(r[1].nps, -100); assert.equal(r[1].rate, 100);
  assert.equal(r[2].sent, 1); assert.equal(r[2].rate, 0); assert.equal(r[2].nps, null);
});
test("surveyStatsByCsm defaults to the latest campaign and carries follow-up per owner", () => {
  const L = [sv({ id: "S", accountId: "a1", submittedAt: "2026-03-09", answers: { nps: 2 } })];
  const r = surveyStatsByCsm(L, ACC, [task({ owner: "Priya" }), task({ owner: "Priya", status: "Open", doneAt: null })]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].followUp, { total: 2, onTime: 1, rate: 50 });
});
test("surveyStatsByCsm keeps a CSM who only owns follow-ups", () => {
  const L = [sv({ id: "S", accountId: "a1", submittedAt: "2026-03-09", answers: { nps: 2 } })];
  const r = surveyStatsByCsm(L, ACC, [task({ owner: "Zed" })], WIN);
  assert.deepEqual(r.map(x => x.csm), ["Priya", "Zed"]);
  assert.equal(r[1].sent, 0); assert.equal(r[1].followUp.total, 1);
});
test("surveyStatsByCsm on nothing", () => {
  assert.deepEqual(surveyStatsByCsm([], {}, []), []);
  assert.deepEqual(surveyStatsByCsm(null, null, null), []);
});
test("detractorsAwaiting lists open NPS follow-ups with score and comment", () => {
  const t = { questions: [{ id: "nps", type: "nps", text: "R" }, { id: "why", type: "text", text: "Why" }] };
  const L = [sv({ id: "S", template: t, submittedAt: "2026-03-09", answers: { nps: 2, why: "Slow support" } }), sv({ id: "T", submittedAt: "2026-03-09", answers: { nps: 4 } })];
  const open = task({ id: "t1", status: "Open", doneAt: null });
  const r = detractorsAwaiting(L, [open, task({ id: "t2" }), task({ id: "t3", source: "manual", status: "Open" }), task({ id: "t4", surveyId: "T", status: "In progress", doneAt: null }), task({ id: "t5", surveyId: "nope", status: "Open" })]);
  assert.deepEqual(r.map(x => [x.task.id, x.score, x.comment]), [["t1", 2, "Slow support"], ["t4", 4, ""]]);
  assert.equal(r[0].survey.id, "S");
  assert.deepEqual(detractorsAwaiting(null, null), []);
});
test("text items carry the survey source so imported answers can be marked", () => {
  const t = { questions: [{ id: "m", type: "text", text: "M" }] };
  const r = questionResults([
    sv({ submittedAt: "2026-03-06", template: t, answers: { m: "a" }, source: "import" }),
    sv({ submittedAt: "2026-03-07", template: t, answers: { m: "b" } }),
  ], "t");
  assert.deepEqual(r[0].items.map(i => [i.text, i.source]), [["b", "sent"], ["a", "import"]]);
});

test("detractor means the current NPS answer is 0-6: edited, removed and rule-matched-at-8 are excluded", () => {
  const L = [sv({ id: "S", submittedAt: "2026-03-09", answers: { nps: 9 } }), sv({ id: "E", submittedAt: "2026-03-09", answers: { nps: 8 } }), sv({ id: "R", submittedAt: "2026-03-09", answers: {} })];
  const ts = ["S", "E", "R"].map(id => task({ id: "t" + id, surveyId: id, status: "Open", doneAt: null, createdAt: "2026-03-01" }));
  assert.deepEqual(detractorsAwaiting(L, ts), []);
  const f = followUpStats(L, ts, "2026-04-01");
  assert.equal(f.total, 0); assert.equal(f.open, 0);
  assert.deepEqual(surveyStatsByCsm(L, ACC, ts, WIN, "2026-04-01").map(x => x.followUp.total), [0]);
  const done = followUpStats(L, [task({ surveyId: "S" })], "2026-04-01");
  assert.equal(done.total, 0);
  assert.equal(followUpStats([sv({ id: "S", submittedAt: "2026-03-09", answers: { nps: 6 } })], [task()], "2026-04-01").total, 1);
});
test("followUpStats keeps young open tasks out of the denominator", () => {
  const open = o => task({ status: "Open", doneAt: null, ...o });
  const young = followUpStats(S, [open({ createdAt: "2026-03-20" })], "2026-03-20");
  assert.equal(young.total, 0); assert.equal(young.open, 1); assert.equal(young.rate, null);
  assert.equal(young.byCsm[0].open, 1); assert.equal(young.byCsm[0].total, 0);
  assert.equal(followUpStats(S, [open({ createdAt: "2026-03-20" })], "2026-03-27").total, 0, "7 days old can still be on time");
  const old = followUpStats(S, [open({ createdAt: "2026-03-20" })], "2026-03-28");
  assert.equal(old.total, 1); assert.equal(old.onTime, 0); assert.equal(old.open, 1); assert.equal(old.rate, 0);
  const late = followUpStats(S, [task({ createdAt: "2026-03-20", doneAt: "2026-03-30" })], "2026-03-30");
  assert.equal(late.total, 1); assert.equal(late.onTime, 0);
  assert.equal(late.byCsm[0].total, 1);
});
