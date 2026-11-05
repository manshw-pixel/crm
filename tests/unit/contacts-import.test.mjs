import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTACT_COLUMNS, contactTemplateRows, planContactImport } from "../../src/lib/contacts-import.js";

const H = CONTACT_COLUMNS;
const accounts = [
  { id: "a1", accountNo: "7", name: "Lumen Retail" },
  { id: "a2", name: "Harbor" },
  { id: "a3", name: "Harbor" },
];
const contacts = () => [
  { id: "c1", accountId: "a1", name: "Arjun Rao", email: "Arjun@Lumen.com", surveyRecipient: false },
  { id: "c2", accountId: "a1", name: "Kiran" },
  { id: "c3", accountId: "a1", name: "Kiran" },
  { id: "c4", accountId: "a1", name: "Vikram", email: "v@lumen.com", surveyOptOut: "2026-04-04" },
];
const plan = (body, extra = {}, header = H) =>
  planContactImport({ rows: [header, ...body], accounts, contacts: contacts(), newId: () => "new1", ...extra });

test("new contact defaults", () => {
  const p = plan([["Lumen Retail", "Pooja", "Finance", "p@lumen.com", "", "", ""]]);
  assert.equal(p.rows[0].status, "new");
  assert.deepEqual(p.adds[0], { id: "new1", accountId: "a1", name: "Pooja", role: "Finance", email: "p@lumen.com", isChampion: false, sentiment: "Neutral", surveyRecipient: false });
});
test("update by email, case-insensitive, blanks keep", () => {
  const p = plan([["Lumen Retail", "", "", "arjun@lumen.com", "", "", "Yes"]]);
  assert.equal(p.rows[0].status, "update");
  assert.deepEqual(p.patches, [{ id: "c1", patch: { surveyRecipient: true } }]);
});
test("reimport is a no-op", () => {
  const p = plan([["Lumen Retail", "Arjun Rao", "", "Arjun@Lumen.com", "No", "", "No"]]);
  assert.equal(p.rows[0].status, "same");
  assert.equal(p.rows[0].msg, "No change");
  assert.equal(p.patches.length, 0);
  assert.equal(p.counts.same, 1);
});
test("opt-out wins", () => {
  const p = plan([["Lumen Retail", "", "", "v@lumen.com", "", "", "Yes"]]);
  assert.equal(p.rows[0].status, "update");
  assert.deepEqual(p.patches[0].patch, { surveyRecipient: true });
  assert.equal(p.rows[0].msg, "Opted out — flag kept, will not be emailed");
});
test("ambiguous name match is an error", () => {
  const p = plan([["Lumen Retail", "Kiran", "", "", "", "", "Yes"]]);
  assert.equal(p.rows[0].status, "error");
  assert.equal(p.rows[0].msg, '2 contacts named "Kiran" on Lumen Retail — add an email');
});
test("duplicate email in file errors both rows", () => {
  const p = plan([["Lumen Retail", "X1", "", "x@lumen.com", "", "", ""], ["Lumen Retail", "X2", "", "X@lumen.com", "", "", ""]]);
  assert.deepEqual(p.rows.map((r) => r.status), ["error", "error"]);
  assert.equal(p.rows[0].msg, "Email appears twice in this file for Lumen Retail");
});
test("account matching by number and ambiguous name", () => {
  const p = plan([["7", "Pooja", "", "", "", "", ""], ["Harbor", "Z", "", "", "", "", ""]]);
  assert.equal(p.rows[0].status, "new");
  assert.equal(p.adds[0].accountId, "a1");
  assert.equal(p.rows[1].msg, 'ambiguous account name "Harbor" — use the account #');
  assert.equal(plan([["Nope", "Z"]]).rows[0].msg, 'Unknown account "Nope"');
});
test("lock to one account", () => {
  const p = plan([["7", "Pooja"], ["Harbor", "Z"]], { lockAccountId: "a1" });
  assert.equal(p.rows[0].status, "new");
  assert.equal(p.rows[1].msg, "This import is for Lumen Retail only");
});
test("accepts TRUE/FALSE and messy headers", () => {
  const p = plan([["Lumen Retail", "Pooja", "p@lumen.com", "TRUE"]], {}, [" account ", "Name *", "EMAIL", "send surveys"]);
  assert.equal(p.rows[0].cells.send, "Yes");
  assert.equal(p.adds[0].surveyRecipient, true);
});
test("bad values", () => {
  const p = plan([
    ["Lumen Retail", "A", "", "", "Maybe", "", ""],
    ["Lumen Retail", "B", "", "", "", "Happy", ""],
    ["Lumen Retail", "C", "", "", "", "", "Maybe"],
    ["Lumen Retail", "D", "", "sara@northwind", "", "", ""],
    ["", "", "", "", "", "", ""],
    ["Lumen Retail", "", "", "", "", "", "Yes"],
  ]);
  assert.deepEqual(p.rows.map((r) => r.msg), [
    "Champion must be Yes or No",
    "Sentiment must be Positive, Neutral or Negative",
    "Send surveys must be Yes or No",
    "Email is not valid",
    "Name is missing",
  ]);
  assert.equal(p.rows[4].n, 7);
});
test("account-only rows are skipped, with and without a lock", () => {
  const body = [["Lumen Retail", "", "", "", "", "", ""], ["Lumen Retail", "Pooja", "", "", "", "", ""], ["Lumen Retail", "", "", "", "", "", ""]];
  for (const extra of [{}, { lockAccountId: "a1" }]) {
    const p = plan(body, extra);
    assert.equal(p.rows.length, 1);
    assert.equal(p.rows[0].n, 3);
    assert.equal(p.counts.error, 0);
  }
});
test("missing header", () => {
  const p = planContactImport({ rows: [["Account", "Role"]], accounts, contacts: [], newId: () => "x" });
  assert.equal(p.err, 'The header row needs "Account" and "Name" columns — download the template.');
  assert.deepEqual(p.rows, []);
});
test("contactTemplateRows", () => {
  const r = contactTemplateRows({ name: "Lumen Retail" });
  assert.equal(r.length, 201);
  assert.deepEqual(r[1], ["Lumen Retail", "", "", "", "", "", ""]);
  assert.equal(contactTemplateRows().length, 1);
});
