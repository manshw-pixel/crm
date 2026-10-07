import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// Direct coverage for reducer actions no other test dispatches by name. Each check asserts
// the state transition AND (for writes) that persist() sent a merge_row for the right row --
// a reducer that mutates in place would pass the state check but send nothing (diffRow).
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const A = seedAccount({ id: "a1", name: "Act Co", accountNo: 1, qbrFrequency: "Quarterly", renewalDate: day(400) });
const B = seedAccount({ id: "b1", name: "Sub Co", accountNo: 2, parentId: "a1" });
const seed = `window.__seedRows = { accounts: ${rows([A, B])}, contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

// dispatch, wait for the commit (see test-suite gotchas: getState is the LAST render), and
// return the new state plus the merge_row calls this action produced
async function act(page, action) {
  return page.evaluate(async action => {
    window.__rpcCalls = [];
    window.__store.dispatch(action);
    await new Promise(r => setTimeout(r, 60));
    const s = window.__store.getState();
    return { s, writes: (window.__rpcCalls || []).filter(c => c.fn === "merge_row").map(c => c.args) };
  }, action);
}
const wrote = (writes, tbl, id) => writes.some(w => w.tbl === tbl && w.row_id === id);
async function open() {
  const r = await launch(seed);
  await r.page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  return r;
}

test("reducer: contacts add, edit, delete", async () => {
  const { page, browser } = await open();
  try {
    let r = await act(page, { type: "ADD_CONTACT", item: { id: "c1", accountId: "a1", name: "Ann", email: "a@x.example" } });
    assert(r.s.contacts.length === 1 && wrote(r.writes, "contacts", "c1"), "add: " + JSON.stringify(r.writes));
    r = await act(page, { type: "EDIT_CONTACT", id: "c1", patch: { role: "CTO" } });
    assert(r.s.contacts[0].role === "CTO" && r.s.contacts[0].name === "Ann", "edit merged wrong");
    assert(r.writes.length === 1 && JSON.stringify(r.writes[0].patch) === '{"role":"CTO"}', "edit must send only the diff: " + JSON.stringify(r.writes));
    r = await act(page, { type: "DELETE_CONTACT", id: "c1" });
    assert(r.s.contacts.length === 0, "delete left the contact");
  } finally { await browser.close(); }
});

test("reducer: activities add/edit/bulk-delete, and a QBR schedules the next one", async () => {
  const { page, browser } = await open();
  try {
    let r = await act(page, { type: "ADD_ACTIVITY", item: { id: "v1", accountId: "a1", type: "QBR", date: "2026-03-31", note: "q" } });
    const a = r.s.accounts.find(x => x.id === "a1");
    assert(a.nextQbrDate === "2026-06-30", "quarterly QBR next date (month-end clamp): " + a.nextQbrDate);
    assert(wrote(r.writes, "activities", "v1") && wrote(r.writes, "accounts", "a1"), "QBR must write activity AND account: " + JSON.stringify(r.writes.map(w => w.tbl)));
    r = await act(page, { type: "EDIT_ACTIVITY", id: "v1", patch: { note: "edited" } });
    assert(r.s.activities[0].note === "edited" && wrote(r.writes, "activities", "v1"), "edit activity");
    r = await act(page, { type: "BULK_DELETE_ACTIVITIES", ids: ["v1"] });
    assert(r.s.activities.length === 0, "bulk delete activities");
  } finally { await browser.close(); }
});

test("reducer: tasks edit/toggle/bulk-delete and playbook seeding", async () => {
  const { page, browser } = await open();
  try {
    let r = await act(page, { type: "SEED_PLAYBOOK", id: "a1", seededFor: "2027-01-01", items: [
      { id: "t1", accountId: "a1", title: "Kickoff", due: day(3), status: "Open" },
      { id: "t2", accountId: "a1", title: "Review", due: day(9), status: "Open" }] });
    const a = r.s.accounts.find(x => x.id === "a1");
    assert(a.playbookSeededFor === "2027-01-01", "seededFor not stamped");
    assert(["t1", "t2"].every(id => wrote(r.writes, "tasks", id)) && wrote(r.writes, "accounts", "a1"), "seed writes: " + JSON.stringify(r.writes.map(w => w.row_id)));
    r = await act(page, { type: "TOGGLE_TASK", id: "t1" });
    assert(r.s.tasks.find(t => t.id === "t1").status === "Done", "toggle to Done");
    r = await act(page, { type: "TOGGLE_TASK", id: "t1" });
    assert(r.s.tasks.find(t => t.id === "t1").status === "Open", "toggle back to Open");
    r = await act(page, { type: "EDIT_TASK", id: "t2", patch: { title: "Renamed" } });
    assert(r.s.tasks.find(t => t.id === "t2").title === "Renamed" && wrote(r.writes, "tasks", "t2"), "edit task");
    r = await act(page, { type: "BULK_DELETE_TASKS", ids: ["t1", "t2"] });
    assert(r.s.tasks.filter(t => t.accountId === "a1" && ["t1", "t2"].includes(t.id)).length === 0, "bulk delete tasks");
  } finally { await browser.close(); }
});

test("reducer: documents add/edit/delete each leave an audit entry", async () => {
  const { page, browser } = await open();
  try {
    const doc = { id: "d1", title: "MSA", name: "msa.pdf", category: "Contract", url: "https://x.example/msa.pdf" };
    let r = await act(page, { type: "ADD_DOCUMENT", id: "a1", doc, by: "T" });
    let a = r.s.accounts.find(x => x.id === "a1");
    assert(a.documents.length === 1 && wrote(r.writes, "accounts", "a1"), "add doc");
    r = await act(page, { type: "EDIT_DOCUMENT", id: "a1", docId: "d1", patch: { title: "MSA v2" }, by: "T" });
    a = r.s.accounts.find(x => x.id === "a1");
    assert(a.documents[0].title === "MSA v2", "edit doc");
    r = await act(page, { type: "DELETE_DOCUMENT", id: "a1", docId: "d1", by: "T" });
    a = r.s.accounts.find(x => x.id === "a1");
    assert(a.documents.length === 0, "delete doc");
    const docAudit = (a.audit || [])
      .filter(e => e.field === "document");
    assert(docAudit.length === 3, "expected 3 document audit entries, got " + docAudit.length);
  } finally { await browser.close(); }
});

test("reducer: churn then reactivate, opportunities, and settings actions persist", async () => {
  const { page, browser } = await open();
  try {
    let r = await act(page, { type: "CHURN_ACCOUNT", id: "a1", entry: { date: day(0), reason: "Budget", arr: 100000, currency: "USD", by: "T" } });
    let a = r.s.accounts.find(x => x.id === "a1");
    assert(a.contractStatus === "Churned" && a.churn.reason === "Budget" && wrote(r.writes, "accounts", "a1"), "churn");
    r = await act(page, { type: "REACTIVATE_ACCOUNT", id: "a1", by: "T" });
    a = r.s.accounts.find(x => x.id === "a1");
    assert(a.contractStatus === "Active" && a.churn === null, "reactivate");
    assert(r.writes.some(w => w.row_id === "a1" && w.patch && w.patch.churn === null), "cleared churn must travel as explicit null: " + JSON.stringify(r.writes));

    r = await act(page, { type: "ADD_OPP", item: { id: "o1", accountId: "a1", name: "Upsell", stage: "Discovery", amount: 5000 } });
    assert(r.s.opportunities.length === 1 && wrote(r.writes, "opportunities", "o1"), "add opp");
    r = await act(page, { type: "SET_OPP_STAGE", id: "o1", stage: "Proposal" });
    assert(r.s.opportunities[0].stage === "Proposal" && wrote(r.writes, "opportunities", "o1"), "opp stage");

    for (const [type, key, val] of [["SET_WEIGHTS", "weights", { usage: 50, sentiment: 10, tickets: 10, recency: 10, nps: 20, value: 0 }],
      ["SET_RATES", "rates", { INR: 0.011, PHP: 0.017 }], ["SET_PLAYBOOK", "playbook", [{ title: "x", offset: 1 }]],
      ["SET_HEALTH_PLAYBOOK", "healthPlaybook", { Yellow: [], Red: [] }], ["SET_SNAPSHOTS", "snapshots", [{ month: new Date().toISOString().slice(0, 7), commit90: 0, arr: 1 }]],
      ["SET_INTEGRATIONS", "integrations", { processed: {}, log: [] }]]) {
      const payloadKey = { SET_WEIGHTS: "weights", SET_RATES: "rates", SET_PLAYBOOK: "playbook", SET_HEALTH_PLAYBOOK: "healthPlaybook", SET_SNAPSHOTS: "snapshots", SET_INTEGRATIONS: "integrations" }[type];
      r = await act(page, { type, [payloadKey]: val });
      assert(JSON.stringify(r.s.settings[key]) === JSON.stringify(val), `${type} state`);
      assert(r.writes.some(w => w.tbl === "settings"), `${type} must persist settings`);
    }
  } finally { await browser.close(); }
});

test("reducer: deleting a parent orphans its sub-account and writes the cleared parentId", async () => {
  const { page, browser } = await open();
  try {
    const r = await act(page, { type: "DELETE_ACCOUNT", id: "a1" });
    const b = r.s.accounts.find(x => x.id === "b1");
    assert(r.s.accounts.length === 1 && b.parentId === null, "sub not orphaned: " + JSON.stringify(b));
    assert(!("_orphaned" in b), "internal _orphaned flag leaked into state");
    assert(r.writes.some(w => w.row_id === "b1" && w.patch.parentId === null), "parentId:null not written: " + JSON.stringify(r.writes));
  } finally { await browser.close(); }
});
