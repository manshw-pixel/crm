// Reducer + persistOps + diffRow, in plain Node (src/lib/reducer.js).
process.env.TZ = "UTC";
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { reducer, persistOps, diffRow } from "../../src/lib/reducer.js";
import { DEFAULT_WEIGHTS, mergeSettings } from "../../src/lib/scoring.js";

const NOW = Date.parse("2026-06-15T12:00:00Z");
const TODAY = "2026-06-15";
const deepFreeze = o => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const acct = (o = {}) => ({ id: "a1", name: "Acme", accountNo: 1, arr: 100000, currency: "USD", tier: "Mid", csm: "Priya",
  contractStatus: "Active", renewalDate: "2027-01-01", startDate: "2020-01-01", inputs: { usage: 80, sentiment: 80, tickets: 0, nps: 40 }, history: [], ...o });
const base = () => ({
  accounts: [acct(), acct({ id: "s1", name: "Sub", accountNo: 2, parentId: "a1" }), acct({ id: "b1", name: "Beta", accountNo: 5 })],
  contacts: [{ id: "c1", accountId: "a1", name: "Ann" }, { id: "c2", accountId: "b1", name: "Bo" }],
  activities: [{ id: "v1", accountId: "a1", type: "call", date: "2026-06-01", note: "hi" }],
  tasks: [{ id: "t1", accountId: "a1", title: "Call", status: "Open" }, { id: "t2", accountId: "b1", title: "Mail", status: "Done" }],
  opportunities: [{ id: "o1", accountId: "a1", name: "Upsell", stage: "Discovery" }],
  settings: { ...mergeSettings({}), rates: { INR: 0.012 }, snapshots: [], segments: [] },
});
const implBase = () => ({ ...base(),
  projects: [{ id: "p1", accountId: "a1", stage: "csm_review", history: [], liveAt: null },
             { id: "p2", accountId: "b1", stage: "planning", history: [] }],
  projectTasks: [
    { id: "k1", projectId: "p1", accountId: "a1", title: "A", status: "done", signoff: "signed", timeLog: [] },
    { id: "k2", projectId: "p1", accountId: "a1", title: "B", status: "done", signoff: "pending", timeLog: [] },
    { id: "k3", projectId: "p2", accountId: "b1", title: "C", status: "todo", signoff: "pending", timeLog: [] }] });
// run one action against frozen state: an in-place mutation throws (strict-mode module)
const run = (action, st = base()) => {
  deepFreeze(st);
  mock.timers.enable({ apis: ["Date"], now: NOW });
  try { const next = reducer(st, action); return { prev: st, next, ops: persistOps(action, next, st) }; }
  finally { mock.timers.reset(); }
};
const A = (s, id = "a1") => s.accounts.find(a => a.id === id);
const merges = ops => ops.filter(o => o.kind === "merge");
const deletes = ops => ops.filter(o => o.kind === "delete").map(o => `${o.table}:${o.column}=${o.value}`);

// ---------- one table of every action: transition never mutates, and writes what it should

const ACTIONS = {
  ADD_ACCOUNT: { type: "ADD_ACCOUNT", item: acct({ id: "n1", name: "New", accountNo: undefined }) },
  EDIT_ACCOUNT: { type: "EDIT_ACCOUNT", id: "a1", patch: { arr: 120000 }, by: "T" },
  COMPLETE_RENEWAL: { type: "COMPLETE_RENEWAL", id: "a1", newDate: "2028-01-01", newArr: 110000, entry: { completedOn: TODAY, arr: 110000, prevArr: 100000, by: "T" } },
  CHURN_ACCOUNT: { type: "CHURN_ACCOUNT", id: "a1", entry: { date: TODAY, reason: "Budget", arr: 100000, currency: "USD", by: "T" } },
  REACTIVATE_ACCOUNT: { type: "REACTIVATE_ACCOUNT", id: "a1", by: "T" },
  ADJUST_ARR: { type: "ADJUST_ARR", id: "a1", newArr: 90000, entry: { id: "e1", date: TODAY, delta: -10000, kind: "contraction", by: "T" } },
  ADD_DOCUMENT: { type: "ADD_DOCUMENT", id: "a1", doc: { id: "d1", category: "Contract", title: "MSA" }, by: "T" },
  SET_OPP_STAGE: { type: "SET_OPP_STAGE", id: "o1", stage: "Won" },
  DELETE_ACCOUNT: { type: "DELETE_ACCOUNT", id: "a1" },
  ADD_CONTACT: { type: "ADD_CONTACT", item: { id: "c9", accountId: "a1", name: "Cy" } },
  EDIT_CONTACT: { type: "EDIT_CONTACT", id: "c1", patch: { role: "CTO" } },
  DELETE_CONTACT: { type: "DELETE_CONTACT", id: "c1" },
  ADD_OPP: { type: "ADD_OPP", item: { id: "o9", accountId: "a1", stage: "Discovery" } },
  ADD_ACTIVITY: { type: "ADD_ACTIVITY", item: { id: "v9", accountId: "a1", type: "email", date: TODAY } },
  EDIT_ACTIVITY: { type: "EDIT_ACTIVITY", id: "v1", patch: { note: "edited" } },
  ADD_TASK: { type: "ADD_TASK", item: { id: "t9", accountId: "a1", title: "x", status: "Open" } },
  EDIT_TASK: { type: "EDIT_TASK", id: "t1", patch: { title: "y" } },
  TOGGLE_TASK: { type: "TOGGLE_TASK", id: "t1" },
  UPDATE_INPUTS: { type: "UPDATE_INPUTS", id: "a1", inputs: { usage: 20 } },
  BULK_PATCH_ACCOUNTS: { type: "BULK_PATCH_ACCOUNTS", ids: ["a1", "b1"], patch: { csm: "Marco" }, by: "T" },
  BULK_ADD_TASKS: { type: "BULK_ADD_TASKS", items: [{ id: "t8", accountId: "a1", title: "x" }, { id: "t7", accountId: "gone", title: "x" }] },
  BULK_DELETE_TASKS: { type: "BULK_DELETE_TASKS", ids: ["t1", "t2"] },
  BULK_CHURN: { type: "BULK_CHURN", ids: ["a1", "b1"], date: TODAY, reason: "Budget", by: "T", activities: [{ id: "v8", accountId: "a1", type: "churn", date: TODAY }, { id: "v7", accountId: "gone", type: "churn", date: TODAY }] },
  BULK_DELETE_ACTIVITIES: { type: "BULK_DELETE_ACTIVITIES", ids: ["v1"] },
  BULK_DELETE: { type: "BULK_DELETE", ids: ["a1", "b1"] },
  RESTORE_SNAPSHOT: { type: "RESTORE_SNAPSHOT", snapshot: { accounts: [acct({ arr: 1 })], contacts: [], activities: [], tasks: [], opportunities: [] } },
  SET_WEIGHTS: { type: "SET_WEIGHTS", weights: { ...DEFAULT_WEIGHTS, usage: 50 } },
  SET_RECENCY_MIX: { type: "SET_RECENCY_MIX", mix: { enabled: true, types: {} } },
  SET_VALUE_MIX: { type: "SET_VALUE_MIX", mix: { caseStudy: 50, savings: 25, roi: 25 } },
  SET_RATES: { type: "SET_RATES", rates: { INR: 0.011 } },
  SET_INTEGRATIONS: { type: "SET_INTEGRATIONS", integrations: { processed: {}, log: [] } },
  SET_SNAPSHOTS: { type: "SET_SNAPSHOTS", snapshots: [{ month: "2026-06" }] },
  SET_PLAYBOOK: { type: "SET_PLAYBOOK", playbook: [] },
  SET_SEGMENTS: { type: "SET_SEGMENTS", segments: [{ id: "g", name: "Big" }] },
  SET_CUSTOM_FIELDS: { type: "SET_CUSTOM_FIELDS", fields: [{ id: "cf_1", label: "Region", type: "text", archived: false }] },
  SEED_PLAYBOOK: { type: "SEED_PLAYBOOK", id: "a1", seededFor: "2027-01-01", items: [{ id: "t6", accountId: "a1", title: "Kickoff" }] },
  SET_HEALTH_PLAYBOOK: { type: "SET_HEALTH_PLAYBOOK", healthPlaybook: { Yellow: [], Red: [] } },
  SEED_HEALTH_PLAYBOOK: { type: "SEED_HEALTH_PLAYBOOK", id: "a1", healthBand: "Red", healthPlaybookBand: "Red", items: [], event: { date: TODAY, from: "Green", to: "Red" } },
  EDIT_DOCUMENT: { type: "EDIT_DOCUMENT", id: "a1", docId: "d0", patch: { title: "v2" }, by: "T" },
  DELETE_DOCUMENT: { type: "DELETE_DOCUMENT", id: "a1", docId: "d0", by: "T" },
};
const SIGN = { actor: { id: "u1", name: "Priya", role: "user" }, now: "2026-06-15T12:00:00.000Z" };
Object.assign(ACTIONS, {
  ADD_PROJECT: { type: "ADD_PROJECT", item: { id: "p9", accountId: "a1", stage: "handover" } },
  EDIT_PROJECT: { type: "EDIT_PROJECT", id: "p1", patch: { targetGoLive: "2026-09-01" } },
  SET_PROJECT_STAGE: { type: "SET_PROJECT_STAGE", id: "p2", to: "in_progress", note: "", ...SIGN },
  ADD_PROJECT_TASK: { type: "ADD_PROJECT_TASK", item: { id: "k9", projectId: "p1", accountId: "a1", title: "x" } },
  EDIT_PROJECT_TASK: { type: "EDIT_PROJECT_TASK", id: "k3", patch: { title: "y" } },
  LOG_TASK_TIME: { type: "LOG_TASK_TIME", id: "k3", entry: { by: "Priya", at: TODAY, hours: 1 } },
  DELETE_PROJECT_TASK: { type: "DELETE_PROJECT_TASK", id: "k3" },
  SIGNOFF_TASK: { type: "SIGNOFF_TASK", taskId: "k2", verdict: "signed", note: "", ...SIGN },
  SET_IMPL_CHECKLIST: { type: "SET_IMPL_CHECKLIST", items: [] },
  SET_IMPL_PLAN_TEMPLATES: { type: "SET_IMPL_PLAN_TEMPLATES", items: [] },
  SET_IMPL_CAPACITY: { type: "SET_IMPL_CAPACITY", map: { u1: 20 } },
});
const withDoc = () => { const s = base(); s.accounts[0] = { ...s.accounts[0], documents: [{ id: "d0", category: "Contract", title: "MSA" }] }; return s; };

test("every reducer action is covered by this table", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../../src/lib/reducer.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export function reducer"));
  const cases = [...body.matchAll(/case "([A-Z_]+)"/g)].map(m => m[1]).filter(t => t !== "REPLACE");
  assert.deepEqual(cases.filter(t => !ACTIONS[t]), [], "add the missing action(s) to ACTIONS");
});

for (const [type, action] of Object.entries(ACTIONS)) {
  test(`${type}: never mutates state (frozen input) and returns a new state`, () => {
    const st = type.endsWith("_DOCUMENT") && type !== "ADD_DOCUMENT" ? withDoc() : implBase();
    const { prev, next } = run(action, st);
    assert.notEqual(next, prev);
  });
}

test("unknown action returns the same state object and writes nothing", () => {
  const { prev, next, ops } = run({ type: "NOPE" });
  assert.equal(next, prev); assert.deepEqual(ops, []);
});
test("REPLACE swaps state wholesale and is never persisted by persistOps", () => {
  const s2 = base();
  const { next, ops } = run({ type: "REPLACE", state: s2 });
  assert.equal(next, s2); assert.deepEqual(ops, []);
});

// ---------- accounts

test("ADD_ACCOUNT assigns the next account # and writes the full row", () => {
  const { next, ops } = run(ACTIONS.ADD_ACCOUNT);
  assert.equal(A(next, "n1").accountNo, 6);
  assert.deepEqual(merges(ops).map(o => o.rowId), ["n1"]);
  assert.equal(merges(ops)[0].patch.accountNo, 6);
});

test("EDIT_ACCOUNT: arr change audits, books an expansion, and writes only the diff + appends", () => {
  const { next, ops } = run(ACTIONS.EDIT_ACCOUNT);
  const a = A(next);
  assert.equal(a.arr, 120000);
  assert.deepEqual(a.audit.map(e => [e.field, e.from, e.to, e.by]), [["arr", 100000, 120000, "T"]]);
  assert.deepEqual(a.arrEvents.map(e => [e.kind, e.delta, e.currency, e.source]), [["expansion", 20000, "USD", "edit"]]);
  const [op] = ops;
  assert.equal(ops.length, 1);
  assert.deepEqual(op.patch, { arr: 120000 });
  assert.deepEqual(Object.keys(op.appends).sort(), ["arrEvents", "audit"]);
});

test("EDIT_ACCOUNT: a currency change is a redenomination, never a contraction", () => {
  const { next } = run({ type: "EDIT_ACCOUNT", id: "a1", patch: { currency: "INR", arr: 8000000 }, by: "T" });
  const [ev] = A(next).arrEvents;
  assert.equal(ev.kind, "redenomination"); assert.equal(ev.delta, 0);
  assert.deepEqual([ev.fromCurrency, ev.toCurrency, ev.fromArr, ev.toArr], ["USD", "INR", 100000, 8000000]);
});

test("EDIT_ACCOUNT from a CSV import tags the event source as import", () => {
  const { next } = run({ type: "EDIT_ACCOUNT", id: "a1", patch: { arr: 90000 }, by: "T", source: "csv import" });
  assert.deepEqual(A(next).arrEvents.map(e => [e.kind, e.source]), [["contraction", "import"]]);
});

test("EDIT_ACCOUNT with no real change writes nothing", () => {
  const { ops } = run({ type: "EDIT_ACCOUNT", id: "a1", patch: { arr: 100000, tier: "Mid" }, by: "T" });
  assert.deepEqual(ops, []);
});

test("COMPLETE_RENEWAL resets the cycle and stamps the booked currency", () => {
  const { next } = run(ACTIONS.COMPLETE_RENEWAL);
  const a = A(next);
  assert.deepEqual([a.renewalDate, a.arr, a.contractStatus, a.renewalStage, a.billingCompleted], ["2028-01-01", 110000, "Active", "Not started", false]);
  assert.equal(a.renewals.at(-1).currency, "USD");
  assert.deepEqual(a.audit.map(e => e.field), ["arr", "renewalDate"]);
});

test("CHURN then REACTIVATE: status, churn record, audit; cleared churn travels as null", () => {
  const churned = run(ACTIONS.CHURN_ACCOUNT).next;
  assert.equal(A(churned).contractStatus, "Churned");
  const { next, ops } = run(ACTIONS.REACTIVATE_ACCOUNT, structuredClone(churned));
  assert.equal(A(next).churn, null);
  assert.equal(merges(ops)[0].patch.churn, null);
  assert.deepEqual(A(next).audit.map(e => e.to), ["Churned", "Active"]);
});

test("ADJUST_ARR stamps currency on the event and audits the source", () => {
  const { next } = run(ACTIONS.ADJUST_ARR);
  assert.equal(A(next).arr, 90000);
  assert.equal(A(next).arrEvents[0].currency, "USD");
  assert.equal(A(next).audit[0].source, "adjustment");
  const opp = run({ ...ACTIONS.ADJUST_ARR, entry: { ...ACTIONS.ADJUST_ARR.entry, source: "opportunity" } }).next;
  assert.equal(A(opp).audit[0].source, "opportunity");
});

test("documents: add / edit / delete each leave one audit entry; unknown docId is a no-op", () => {
  assert.equal(A(run(ACTIONS.ADD_DOCUMENT).next).audit[0].to, "Contract: MSA");
  assert.equal(A(run(ACTIONS.EDIT_DOCUMENT, withDoc()).next).audit[0].to, "Contract: v2");
  const del = A(run(ACTIONS.DELETE_DOCUMENT, withDoc()).next);
  assert.deepEqual([del.documents.length, del.audit[0].from], [0, "Contract: MSA"]);
  const { prev, next, ops } = run({ ...ACTIONS.EDIT_DOCUMENT, docId: "zzz" }, withDoc());
  assert.equal(A(next), A(prev)); assert.deepEqual(ops, []);
});

test("DELETE_ACCOUNT cascades, orphans the sub, and writes the sub's cleared parentId", () => {
  const { next, ops } = run(ACTIONS.DELETE_ACCOUNT);
  assert.deepEqual(next.accounts.map(a => a.id), ["s1", "b1"]);
  assert.equal(A(next, "s1").parentId, null);
  assert.ok(!("_orphaned" in A(next, "s1")), "no internal flag leaks into state");
  assert.deepEqual([next.contacts, next.activities, next.tasks, next.opportunities].map(l => l.map(r => r.id)), [["c2"], [], ["t2"], []]);
  assert.deepEqual(deletes(ops), ["accounts:id=a1", "contacts:data->>accountId=a1", "activities:data->>accountId=a1",
    "tasks:data->>accountId=a1", "opportunities:data->>accountId=a1",
    "projects:data->>accountId=a1", "project_tasks:data->>accountId=a1"]);
  assert.deepEqual(merges(ops).map(o => [o.rowId, o.patch]), [["s1", { parentId: null }]]);
});

test("BULK_DELETE: deletes each account's cascade; a sub whose parent survives is untouched", () => {
  const { next, ops } = run({ type: "BULK_DELETE", ids: ["b1"] });
  assert.equal(A(next, "s1").parentId, "a1");
  assert.deepEqual(merges(ops), []);
  assert.equal(deletes(ops).length, 7);
  const both = run(ACTIONS.BULK_DELETE);
  assert.deepEqual(both.next.accounts.map(a => a.id), ["s1"]);
  assert.deepEqual(merges(both.ops).map(o => o.rowId), ["s1"]);
});

test("BULK_PATCH_ACCOUNTS audits only real changes, one entry per field", () => {
  const { next, ops } = run({ type: "BULK_PATCH_ACCOUNTS", ids: ["a1", "b1"], patch: { csm: "Priya", tier: "Enterprise" }, by: "T" });
  assert.deepEqual(A(next).audit.map(e => e.field), ["tier"]);
  assert.deepEqual(merges(ops).map(o => o.rowId), ["a1", "b1"]);
});

test("BULK_CHURN churns each, records each account's own arr, drops activities for gone accounts", () => {
  const { next, ops } = run(ACTIONS.BULK_CHURN);
  assert.deepEqual(next.accounts.filter(a => a.churn).map(a => [a.id, a.churn.arr]), [["a1", 100000], ["b1", 100000]]);
  assert.deepEqual(next.activities.map(v => v.id), ["v1", "v8"]);
  assert.ok(!merges(ops).some(o => o.rowId === "v7"), "dropped activity must not be written");
});

test("UPDATE_INPUTS clamps, stamps, and appends a scored history point", () => {
  const { next, ops } = run({ type: "UPDATE_INPUTS", id: "a1", inputs: { usage: 500, nps: "x" } });
  const a = A(next);
  assert.equal(a.inputs.usage, 100); assert.equal(a.inputs.nps, 40);
  assert.equal(a.inputsUpdatedAt, TODAY);
  assert.equal(a.history.length, 1); assert.equal(typeof a.history[0].s, "number");
  assert.deepEqual(merges(ops)[0].appends.history, a.history);
});

// ---------- contacts, activities, tasks, opps

test("contacts: edit merges and writes only the changed field; delete writes a delete", () => {
  const { next, ops } = run(ACTIONS.EDIT_CONTACT);
  assert.deepEqual(next.contacts[0], { id: "c1", accountId: "a1", name: "Ann", role: "CTO" });
  assert.deepEqual(ops.map(o => [o.rowId, o.patch]), [["c1", { role: "CTO" }]]);
  assert.deepEqual(deletes(run(ACTIONS.DELETE_CONTACT).ops), ["contacts:id=c1"]);
});

test("ADD_ACTIVITY QBR schedules the next one (month-end safe) and writes the account too", () => {
  const st = base(); st.accounts[0] = { ...st.accounts[0], qbrFrequency: "Quarterly" };
  const { next, ops } = run({ type: "ADD_ACTIVITY", item: { id: "q", accountId: "a1", type: "QBR", date: "2026-11-30" } }, st);
  assert.equal(A(next).nextQbrDate, "2027-02-28");
  assert.deepEqual(merges(ops).map(o => o.table), ["accounts", "activities"]);
});

test("ADD_ACTIVITY QBR on an account with no cadence changes no account", () => {
  const { prev, next, ops } = run({ type: "ADD_ACTIVITY", item: { id: "q", accountId: "a1", type: "QBR", date: TODAY } });
  assert.equal(A(next), A(prev));
  assert.deepEqual(merges(ops).map(o => o.table), ["activities"]);
});

test("TOGGLE_TASK flips Open <-> Done", () => {
  const once = run(ACTIONS.TOGGLE_TASK).next;
  assert.equal(once.tasks[0].status, "Done");
  assert.equal(run(ACTIONS.TOGGLE_TASK, structuredClone(once)).next.tasks[0].status, "Open");
});

test("BULK_ADD_TASKS drops tasks for accounts that no longer exist (state and writes)", () => {
  const { next, ops } = run(ACTIONS.BULK_ADD_TASKS);
  assert.ok(next.tasks.some(t => t.id === "t8") && !next.tasks.some(t => t.id === "t7"));
  assert.deepEqual(ops.map(o => o.rowId), ["t8"]);
});

test("SEED_PLAYBOOK appends tasks and stamps the account; writes both", () => {
  const { next, ops } = run(ACTIONS.SEED_PLAYBOOK);
  assert.equal(A(next).playbookSeededFor, "2027-01-01");
  assert.deepEqual(ops.map(o => `${o.table}:${o.rowId}`), ["tasks:t6", "accounts:a1"]);
});

test("SEED_HEALTH_PLAYBOOK sets the band and appends the event", () => {
  const { next, ops } = run(ACTIONS.SEED_HEALTH_PLAYBOOK);
  assert.deepEqual([A(next).healthBand, A(next).healthEvents.length], ["Red", 1]);
  assert.deepEqual(merges(ops)[0].appends.healthEvents.length, 1);
});

test("RESTORE_SNAPSHOT replaces rows by id and re-adds missing ones", () => {
  const st = base(); st.accounts = st.accounts.filter(a => a.id !== "a1");
  const { next, ops } = run(ACTIONS.RESTORE_SNAPSHOT, st);
  assert.equal(A(next).arr, 1);
  assert.deepEqual(ops.map(o => o.rowId), ["a1"]);
});

// ---------- settings

test("settings actions update their key and always write the settings row", () => {
  for (const [type, key, val] of [["SET_WEIGHTS", "weights", ACTIONS.SET_WEIGHTS.weights], ["SET_RATES", "rates", ACTIONS.SET_RATES.rates],
    ["SET_SEGMENTS", "segments", ACTIONS.SET_SEGMENTS.segments], ["SET_CUSTOM_FIELDS", "customFields", ACTIONS.SET_CUSTOM_FIELDS.fields], ["SET_VALUE_MIX", "valueMix", ACTIONS.SET_VALUE_MIX.mix]]) {
    const { next, ops } = run(ACTIONS[type]);
    assert.deepEqual(next.settings[key], val, type);
    assert.deepEqual(ops.map(o => [o.table, o.rowId]), [["settings", "1"]], type);
  }
});

// ---------- diffRow

test("diffRow: new row is a full patch; unchanged row is empty", () => {
  assert.deepEqual(diffRow(undefined, { id: 1, a: 2 }), { patch: { id: 1, a: 2 }, appends: {}, sets: {} });
  assert.deepEqual(diffRow({ a: [1], b: { c: 1 } }, { a: [1], b: { c: 1 } }), { patch: {}, appends: {}, sets: {} });
});
test("diffRow: trailing growth is an append; reorder/removal/edit is a whole-array set", () => {
  assert.deepEqual(diffRow({ x: [1, 2] }, { x: [1, 2, 3] }).appends, { x: [3] });
  assert.deepEqual(diffRow({ x: [1, 2] }, { x: [2, 1] }).sets, { x: [2, 1] });
  assert.deepEqual(diffRow({ x: [1, 2] }, { x: [1] }).sets, { x: [1] });
  assert.deepEqual(diffRow({ x: [{ a: 1 }] }, { x: [{ a: 2 }, { a: 3 }] }).sets, { x: [{ a: 2 }, { a: 3 }] });
  assert.deepEqual(diffRow({}, { x: [1] }).appends, { x: [1] });
});
test("diffRow: a removed or undefined field travels as explicit null", () => {
  assert.deepEqual(diffRow({ a: 1, b: 2 }, { a: 1 }).patch, { b: null });
  assert.deepEqual(diffRow({ a: 1 }, { a: undefined }).patch, { a: null });
});

/* ---------------------------- implementation projects ---------------------------- */
const ACTOR = { id: "u1", name: "Priya", role: "user" };
const impl = (action, st = implBase()) => run(action, st);

test("SIGNOFF_TASK returned: task back to todo, project to in_progress, other signed task stays signed", () => {
  const { next, ops } = impl({ type: "SIGNOFF_TASK", taskId: "k2", verdict: "returned", note: "redo", actor: ACTOR, now: "2026-06-15T12:00:00.000Z" });
  const T = id => next.projectTasks.find(t => t.id === id);
  assert.equal(T("k2").status, "todo"); assert.equal(T("k2").signoff, "returned"); assert.equal(T("k1").signoff, "signed");
  assert.equal(next.projects.find(p => p.id === "p1").stage, "in_progress");
  const m = merges(ops);
  const proj = m.find(o => o.table === "projects");
  assert.equal(proj.rowId, "p1"); assert.equal(proj.patch.stage, "in_progress");
  assert.deepEqual(proj.appends.history.map(h => [h.from, h.to, h.by]), [["csm_review", "in_progress", "Priya"]]);
  assert.deepEqual(m.filter(o => o.table === "project_tasks").map(o => o.rowId), ["k2"]);
  const act = m.find(o => o.table === "activities");
  assert.equal(act.patch.system, true); assert.equal(act.patch.accountId, "a1");
});

test("SIGNOFF_TASK signed on the last task takes the project live", () => {
  const { next, ops } = impl({ type: "SIGNOFF_TASK", taskId: "k2", verdict: "signed", note: "", actor: ACTOR, now: "2026-06-15T12:00:00.000Z" });
  const p = next.projects.find(x => x.id === "p1");
  assert.equal(p.stage, "live"); assert.equal(p.liveAt, "2026-06-15T12:00:00.000Z");
  assert.equal(next.projectTasks.find(t => t.id === "k2").signedBy, "Priya");
  assert.ok(merges(ops).some(o => o.table === "projects" && o.patch.stage === "live"));
});

test("SIGNOFF_TASK signed with others pending changes only the task (no stage write, no activity)", () => {
  const st = implBase(); st.projectTasks[0].signoff = "pending";
  const { ops } = impl({ type: "SIGNOFF_TASK", taskId: "k1", verdict: "signed", note: "", actor: ACTOR, now: "2026-06-15T12:00:00.000Z" }, st);
  assert.deepEqual(merges(ops).map(o => o.table), ["project_tasks"]);
});

test("LOG_TASK_TIME appends to timeLog via appends, not a whole-array set", () => {
  const entry = { by: "Priya", at: "2026-06-15", hours: 2 };
  const { next, ops } = impl({ type: "LOG_TASK_TIME", id: "k3", entry });
  assert.deepEqual(next.projectTasks.find(t => t.id === "k3").timeLog, [entry]);
  assert.deepEqual(merges(ops).map(o => [o.table, o.rowId, o.patch, o.appends]), [["project_tasks", "k3", {}, { timeLog: [entry] }]]);
});

test("SET_PROJECT_STAGE appends history, stamps startedAt, writes a system activity", () => {
  const { next, ops } = impl({ type: "SET_PROJECT_STAGE", id: "p2", to: "in_progress", note: "go", actor: ACTOR, now: "2026-06-15T12:00:00.000Z" });
  const p = next.projects.find(x => x.id === "p2");
  assert.equal(p.stage, "in_progress"); assert.equal(p.startedAt, "2026-06-15T12:00:00.000Z");
  assert.equal(next.activities.at(-1).system, true); assert.equal(next.activities.at(-1).accountId, "b1");
  assert.deepEqual(merges(ops).map(o => o.table), ["projects", "activities"]);
});

test("project/task add, edit, delete write to projects and project_tasks; settings keys write settings", () => {
  const a = impl({ type: "ADD_PROJECT", item: { id: "p9", accountId: "a1", stage: "handover" } });
  assert.deepEqual(merges(a.ops).map(o => [o.table, o.rowId]), [["projects", "p9"]]);
  const e = impl({ type: "EDIT_PROJECT_TASK", id: "k3", patch: { title: "C2" } });
  assert.deepEqual(merges(e.ops).map(o => [o.table, o.patch]), [["project_tasks", { title: "C2" }]]);
  assert.deepEqual(deletes(impl({ type: "DELETE_PROJECT_TASK", id: "k3" }).ops), ["project_tasks:id=k3"]);
  const s = impl({ type: "SET_IMPL_CAPACITY", map: { u1: 20 } });
  assert.deepEqual(merges(s.ops).map(o => [o.table, o.patch.implCapacity]), [["settings", { u1: 20 }]]);
  assert.deepEqual(impl({ type: "SET_IMPL_CHECKLIST", items: [] }).next.settings.implChecklist, []);
  const t = impl({ type: "SET_IMPL_PLAN_TEMPLATES", items: [{ name: "x" }] });
  assert.deepEqual(t.next.settings.implPlanTemplates, [{ name: "x" }]);
  // templates persist through the definer RPC (impl_lead may save them), never a settings merge
  assert.deepEqual(t.ops, [{ kind: "rpc", table: "settings", fn: "save_impl_plan_templates", args: { items: [{ name: "x" }] } }]);
});

test("DELETE_ACCOUNT also removes that account's projects and tasks from state", () => {
  const { next } = impl({ type: "DELETE_ACCOUNT", id: "a1" });
  assert.deepEqual(next.projects.map(p => p.id), ["p2"]);
  assert.deepEqual(next.projectTasks.map(t => t.id), ["k3"]);
});
