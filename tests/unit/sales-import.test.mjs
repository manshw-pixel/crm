import { test } from "node:test";
import assert from "node:assert/strict";
import { rowDestination, checklistFromRow, planOnboardingRow } from "../../src/lib/sales-import.js";

const T = [
  { id: "order_form", label: "Signed order form attached", kind: "check", required: true },
  { id: "go_live_target", label: "Go-live target date", kind: "date", required: true },
  { id: "customer_contact", label: "Customer project contact", kind: "text", required: true },
  { id: "modules_scope", label: "Modules / scope purchased", kind: "text", required: true },
  { id: "licences", label: "Licences sold", kind: "text", required: false },
  { id: "commitments", label: "Special commitments made in the sale", kind: "text", required: false },
  { id: "integrations", label: "Integrations required", kind: "text", required: false },
  { id: "kickoff", label: "Kickoff call scheduled", kind: "check", required: false },
];
const user = { id: "u1", name: "Sam" };
const now = "2026-10-27T10:00:00.000Z";
const full = { order_form: "Yes", go_live_target: "15-11-2026", customer_contact: "Asha", modules_scope: "CRM" };
const plan = (o = {}) => planOnboardingRow({ accountId: "a1", accountName: "Acme", cells: full, template: T, order: "dmy",
  projects: [], user, now, file: "sales.csv", newId: "p-new", ...o });

test("rowDestination", () => {
  assert.equal(rowDestination("Onboarding ", "accounts"), "onboarding");
  assert.equal(rowDestination("ACCOUNTS", "onboarding"), "accounts");
  assert.equal(rowDestination("", "accounts"), "accounts");
  assert.equal(rowDestination(undefined, "onboarding"), "onboarding");
  assert.deepEqual(rowDestination("crm", "accounts"), { unknown: "crm" });
});

test("checklistFromRow", () => {
  assert.deepEqual(
    checklistFromRow({ order_form: "Yes", go_live_target: "15-11-2026", customer_contact: "Asha", kickoff: "no", licences: "  " }, T, "dmy"),
    { order_form: true, go_live_target: "2026-11-15", customer_contact: "Asha", kickoff: false });
  assert.equal(checklistFromRow({ go_live_target: "01-02-2026" }, T, "mdy").go_live_target, "2026-01-02");
});

test("queued when all required present", () => {
  const r = plan();
  assert.equal(r.kind, "queued");
  const p = r.project;
  assert.equal(p.stage, "queued"); assert.equal(p.type, "onboarding"); assert.equal(p.targetGoLive, "2026-11-15");
  assert.equal(p.id, "p-new"); assert.equal(p.source, "sales-feed"); assert.equal(p.createdBy, "Sam");
  assert.equal(p.implementerId, null); assert.equal(p.holdReason, "");
  assert.equal(p.history.length, 1);
  assert.equal(p.history[0].note, "Imported from sales feed (sales.csv)");
  assert.equal(p.history[0].to, "queued");
  assert.notEqual(p.checklistTemplate, T);
});

test("draft when a required item missing", () => {
  const { customer_contact, ...cells } = full;
  const r = plan({ cells });
  assert.equal(r.kind, "draft");
  assert.equal(r.project.stage, "handover");
  assert.deepEqual(r.project.missing, ["Customer project contact"]);
  assert.deepEqual(r.project.history, []);
});

test("skips and expansion", () => {
  assert.deepEqual(plan({ projects: [{ accountId: "a1", stage: "in_progress" }] }), { kind: "skip", reason: "open project exists" });
  assert.deepEqual(plan({ projects: [{ accountId: "a1", stage: "on_hold" }] }), { kind: "skip", reason: "open project exists" });
  assert.deepEqual(plan({ projects: [{ accountId: "a1", stage: "handover" }] }), { kind: "skip", reason: "open project exists" });
  const r = plan({ projects: [{ accountId: "a1", stage: "live" }] });
  assert.equal(r.kind, "queued"); assert.equal(r.project.type, "expansion");
  assert.deepEqual(plan({ accountId: null }), { kind: "skip", reason: "account not imported" });
});

test("same run duplicate is skipped", () => {
  const projects = [];
  const a = plan({ projects }); projects.push(a.project);
  assert.deepEqual(plan({ projects }), { kind: "skip", reason: "open project exists" });
});

test("targetGoLive falls back to first date item, else null", () => {
  const t2 = [{ id: "d1", label: "D", kind: "date", required: false }];
  assert.equal(plan({ template: t2, cells: { d1: "2026-12-01" } }).project.targetGoLive, "2026-12-01");
  assert.equal(plan({ template: t2, cells: {} }).project.targetGoLive, null);
});

test("checklistFromRow matches label headers, ignoring case, * and punctuation", () => {
  for (const h of ["signed order form attached *", "signed order form attached", "order_form", "order form"]) {
    assert.equal(checklistFromRow({ [h]: "Yes" }, T, "dmy").order_form, true, h);
  }
  assert.equal(checklistFromRow({ "go-live target date *": "15-11-2026" }, T, "dmy").go_live_target, "2026-11-15");
  assert.equal(checklistFromRow({ order_form: "no", "signed order form attached": "yes" }, T, "dmy").order_form, false);
});

test("checklistFromRow truthy check values", () => {
  for (const v of ["yes", "Y", "TRUE", "1", "✓", "✔", "☑", "✅", "x", " Done ", "attached", "Signed", "checked"])
    assert.equal(checklistFromRow({ order_form: v }, T, "dmy").order_form, true, v);
  assert.equal(checklistFromRow({ order_form: "no" }, T, "dmy").order_form, false);
  assert.equal(checklistFromRow({ order_form: "pending" }, T, "dmy").order_form, false);
  assert.equal("order_form" in checklistFromRow({ order_form: "" }, T, "dmy"), false);
});
