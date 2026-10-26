import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES, STAGE_LABEL, OPEN_STAGES, projectType, canTransition, applySignoff, historyEntry,
  loggedHours, workload, stageAt, chartCounts } from "../../src/lib/implementation.js";

const lead = { id: "L", role: "impl_lead", name: "Lead" };
const admin = { id: "A", role: "admin", name: "Adm" };
const impl = { id: "I1", role: "impl_user", name: "Ivy" };
const other = { id: "I2", role: "impl_user", name: "Oz" };
const csm = { id: "C", role: "user", name: "Cara" };
const account = { csm: "Cara" };
const proj = (o = {}) => ({ id: "p1", accountId: "a1", stage: "planning", implementerId: "I1", history: [], ...o });
const task = (o = {}) => ({ id: "t1", projectId: "p1", status: "todo", signoff: "pending", ...o });

test("constants", () => {
  assert.equal(STAGES.length, 8);
  assert.equal(STAGE_LABEL.in_progress, "In progress");
  assert.deepEqual(OPEN_STAGES, ["queued", "planning", "in_progress", "csm_review"]);
});

test("projectType", () => {
  assert.equal(projectType("a1", []), "onboarding");
  assert.equal(projectType("a1", [{ accountId: "a2" }]), "onboarding");
  assert.equal(projectType("a1", [{ accountId: "a1" }]), "expansion");
});

test("canTransition: handover -> queued needs required checklist items", () => {
  const tpl = [{ id: "x", label: "Scope", kind: "text", required: true }, { id: "y", label: "Ok", kind: "check", required: true },
    { id: "z", label: "Notes", kind: "text", required: false }];
  const p = proj({ stage: "handover", checklistTemplate: tpl, checklist: { x: "  ", y: false } });
  const r = canTransition(p, [], "queued", csm);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Scope, Ok/);
  assert.equal(canTransition({ ...p, checklist: { x: "full", y: true } }, [], "queued", csm).ok, true);
});

test("canTransition: queued -> planning", () => {
  const p = proj({ stage: "queued" });
  assert.equal(canTransition(p, [], "planning", impl).ok, false);
  assert.equal(canTransition({ ...p, implementerId: null }, [], "planning", lead).reason, "Assign an implementer first");
  assert.equal(canTransition(p, [], "planning", lead).ok, true);
  assert.equal(canTransition(p, [], "planning", admin).ok, true);
});

test("canTransition: planning -> in_progress", () => {
  const p = proj();
  assert.equal(canTransition(p, [], "in_progress", impl).reason, "Add at least one task first");
  assert.equal(canTransition(p, [task()], "in_progress", other).ok, false);
  assert.equal(canTransition(p, [task()], "in_progress", impl).ok, true);
  assert.equal(canTransition(p, [task()], "in_progress", lead).ok, true);
});

test("canTransition: in_progress -> csm_review needs all done", () => {
  const p = proj({ stage: "in_progress" });
  assert.equal(canTransition(p, [task({ status: "done" }), task({ status: "doing" })], "csm_review", impl).ok, false);
  assert.equal(canTransition(p, [task({ status: "done" })], "csm_review", impl).ok, true);
});

test("canTransition: csm_review -> live needs signed tasks and the account CSM", () => {
  const p = proj({ stage: "csm_review" });
  const signed = [task({ signoff: "signed" })];
  assert.equal(canTransition(p, [task()], "live", csm, account).ok, false);
  assert.equal(canTransition(p, signed, "live", impl, account).ok, false);
  assert.equal(canTransition(p, signed, "live", { ...csm, name: "Dan" }, account).ok, false);
  assert.equal(canTransition(p, signed, "live", csm, account).ok, true);
  assert.equal(canTransition(p, signed, "live", admin, account).ok, true);
});

test("canTransition: hold, resume, cancel", () => {
  const p = proj({ stage: "in_progress" });
  assert.equal(canTransition(p, [], "on_hold", other).ok, false);
  assert.equal(canTransition(p, [], "on_hold", impl).ok, true);
  assert.equal(canTransition(proj({ stage: "handover" }), [], "on_hold", lead).ok, false);
  const held = proj({ stage: "on_hold", history: [{ from: "planning", to: "in_progress" }, { from: "in_progress", to: "on_hold" }] });
  assert.equal(canTransition(held, [], "in_progress", impl).ok, true);
  assert.equal(canTransition(held, [], "planning", impl).ok, false);
  assert.equal(canTransition(held, [], "in_progress", other).ok, false);
  assert.equal(canTransition(p, [], "cancelled", impl).ok, false);
  assert.equal(canTransition(p, [], "cancelled", lead).ok, true);
  assert.equal(canTransition(proj({ stage: "live" }), [], "cancelled", admin).ok, false);
});

test("applySignoff: return keeps other signed tasks signed (Review Focus 2)", () => {
  const ts = [task({ id: "a", signoff: "signed", signedBy: "Cara", status: "done" }), task({ id: "b", status: "done" })];
  const r = applySignoff(ts, "b", "returned", "redo", csm, "2026-10-26");
  assert.equal(r.projectStage, "in_progress");
  assert.deepEqual(r.tasks[0], ts[0]);
  assert.deepEqual([r.tasks[1].status, r.tasks[1].signoff, r.tasks[1].signoffNote], ["todo", "returned", "redo"]);
});

test("applySignoff: partial stays in review, all signed goes live", () => {
  const ts = [task({ id: "a" }), task({ id: "b" })];
  const r1 = applySignoff(ts, "a", "signed", "", csm, "2026-10-26");
  assert.equal(r1.projectStage, "csm_review");
  assert.equal(r1.tasks[0].signedBy, "Cara");
  assert.equal(r1.tasks[0].signedAt, "2026-10-26");
  assert.equal(r1.tasks[1], ts[1]);
  assert.equal(applySignoff(r1.tasks, "b", "signed", "", csm, "2026-10-27").projectStage, "live");
});

test("historyEntry and loggedHours", () => {
  assert.deepEqual(historyEntry("a", "b", csm, "n", "2026-10-26"), { at: "2026-10-26", by: "Cara", from: "a", to: "b", note: "n" });
  assert.equal(loggedHours({}), 0);
  assert.equal(loggedHours({ timeLog: [{ hours: 1.5 }, { hours: 2 }] }), 3.5);
});

test("workload: no tasks -> 0h, null load, never NaN", () => {
  const r = workload([{ id: "I1", name: "Ivy" }], [proj()], [], {}, "2026-10-26");
  assert.deepEqual(r[0], { id: "I1", name: "Ivy", active: 1, remainingHours: 0, logged30: 0, freeFrom: null, loadPct: null, band: null });
});

test("workload: 60h on 30h capacity due in one week is 200% red", () => {
  const t = task({ ownerId: "I1", estHours: 60, due: "2026-11-02", timeLog: [] });
  const r = workload([{ id: "I1", name: "Ivy" }], [proj()], [t], { I1: 30 }, "2026-10-26");
  assert.equal(r[0].loadPct, 200);
  assert.equal(r[0].band, "red");
  assert.equal(r[0].freeFrom, "2026-11-02");
  assert.equal(r[0].remainingHours, 60);
});

test("workload: logged hours reduce remaining, 30-day window, bands, sort, no due date", () => {
  const ts = [
    task({ id: "1", ownerId: "I1", estHours: 40, due: "2026-11-02", timeLog: [{ hours: 10, at: "2026-10-20" }, { hours: 5, at: "2026-09-01" }] }),
    task({ id: "2", ownerId: "I2", estHours: 10 }), // no due date: one-week floor
    task({ id: "3", ownerId: "I1", estHours: 5, status: "done" }),
  ];
  const r = workload([{ id: "I1", name: "Ivy" }, { id: "I2", name: "Oz" }, { id: "I3", name: "Zed" }],
    [proj(), proj({ id: "p2", implementerId: "I2" })], ts, {}, "2026-10-26");
  assert.deepEqual(r.map(x => x.id), ["I3", "I2", "I1"]);
  const i1 = r.find(x => x.id === "I1"), i2 = r.find(x => x.id === "I2");
  assert.equal(i1.remainingHours, 25);
  assert.equal(i1.logged30, 10);
  assert.equal(i1.loadPct, 83);
  assert.equal(i1.band, "amber");
  assert.equal(i2.loadPct, 33);
  assert.equal(i2.band, "green");
  assert.equal(i2.freeFrom, null);
});

test("stageAt replays history; null before creation", () => {
  const p = proj({ history: [{ at: "2026-03-01T09:00:00Z", from: null, to: "handover" }, { at: "2026-04-10", from: "handover", to: "queued" }] });
  assert.equal(stageAt(p, "2026-02-28"), null);
  assert.equal(stageAt(p, "2026-03-01"), "handover");
  assert.equal(stageAt(p, "2026-04-09"), "handover");
  assert.equal(stageAt(p, "2026-12-31"), "queued");
  assert.equal(stageAt({}, "2026-01-01"), null);
});

test("applySignoff: an unknown verdict throws instead of signing", () => {
  const ts = [{ id: "a", signoff: "pending" }];
  assert.throws(() => applySignoff(ts, "a", "approved", "", admin, "2026-10-26"), /verdict must be/);
  assert.throws(() => applySignoff(ts, "a", undefined, "", admin, "2026-10-26"), /verdict must be/);
  assert.equal(applySignoff(ts, "a", "signed", "", admin, "2026-10-26").tasks[0].signoff, "signed");
});

const h = (at, from, to) => ({ at, by: "x", from, to, note: "" });
test("chartCounts month: created in May is not counted Jan-Apr; live in a month counts only there", () => {
  const p = proj({ accountId: "a1", history: [h("2026-05-10T10:00:00Z", "handover", "queued"), h("2026-06-02", "queued", "planning"),
    h("2026-08-31T23:00:00Z", "csm_review", "live")] });
  const r = chartCounts([p], 2026, "month", () => "Gold", "All");
  assert.deepEqual(r.periods, ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  assert.deepEqual(r.series.active, [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(r.series.completed, [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual(r.series.onHold, Array(12).fill(0));
});

test("chartCounts quarter: live in Q2 completes only in Q2; on hold at end; cancelled excluded; tier filter + byTier", () => {
  const live = proj({ id: "L", accountId: "a1", history: [h("2026-01-05", "handover", "queued"), h("2026-05-01", "csm_review", "live")] });
  const held = proj({ id: "H", accountId: "a2", history: [h("2026-02-01", "handover", "queued"), h("2026-09-30T22:00:00Z", "planning", "on_hold")] });
  const canc = proj({ id: "C", accountId: "a1", history: [h("2026-01-01", "handover", "queued"), h("2026-03-15", "queued", "cancelled")] });
  const tierOf = id => id === "a1" ? "Gold" : "Silver";
  const r = chartCounts([live, held, canc], 2026, "quarter", tierOf, "All");
  assert.deepEqual(r.periods, ["Q1", "Q2", "Q3", "Q4"]);
  assert.deepEqual(r.series.active, [2, 1, 0, 0]);
  assert.deepEqual(r.series.completed, [0, 1, 0, 0]);
  assert.deepEqual(r.series.onHold, [0, 0, 1, 1]);
  assert.deepEqual(r.byTier.Gold, { active: [1, 0, 0, 0], completed: [0, 1, 0, 0], onHold: [0, 0, 0, 0] });
  assert.deepEqual(r.byTier.Silver, { active: [1, 1, 0, 0], completed: [0, 0, 0, 0], onHold: [0, 0, 1, 1] });
  const g = chartCounts([live, held, canc], 2026, "quarter", tierOf, "Gold");
  assert.deepEqual(g.series.active, [1, 0, 0, 0]);
  assert.deepEqual(g.series.onHold, [0, 0, 0, 0]);
  assert.deepEqual(Object.keys(g.byTier).sort(), ["Gold", "Silver"]);
});
