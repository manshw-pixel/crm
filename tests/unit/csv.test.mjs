import { goldenSuite } from "./_golden.mjs";
import * as lib from "../../src/lib/csv.js";
goldenSuite("csv", lib);

import { test } from "node:test";
import assert from "node:assert/strict";
test("accountsCSVText exports deployedLicenses right after licenses; unrecorded is empty", () => {
  const base = { name: "X", tier: "Mid", arr: 1, currency: "USD", arrUSD: 1, renewalDate: "2026-09-01", licenses: 200 };
  const [head, r1, r2] = lib.accountsCSVText([{ ...base, deployedLicenses: 150 }, { ...base, deployedLicenses: null }]).split("\n");
  const cols = head.split(",");
  assert.equal(cols[cols.indexOf("licenses") + 1], "deployedLicenses");
  const i = cols.indexOf("deployedLicenses");
  assert.equal(r1.split(",")[i], '"150"');
  assert.equal(r2.split(",")[i], '""');
});

test("accountsCSVText appends active custom fields, escaped, archived excluded", () => {
  const fields = [
    { id: "cf_a", label: "Region, area", type: "text" },
    { id: "cf_b", label: "=Danger", type: "bool" },
    { id: "cf_z", label: "Gone", type: "text", archived: true },
  ];
  const rows = [{ id: "1", name: "Acme", arr: 0, arrUSD: 0, renewalDate: "2027-01-01", custom: { cf_a: "EMEA", cf_b: true, cf_z: "x" } }];
  const [head, line] = lib.accountsCSVText(rows, fields).split("\n");
  const plain = lib.accountsCSVText(rows).split("\n")[0];
  assert.ok(head.startsWith(plain + ","), "custom columns must come after the existing ones");
  assert.ok(head.includes('"Region, area"'), "label with a comma must be quoted: " + head);
  assert.ok(head.includes("'=Danger"), "formula-looking label must be neutralised: " + head);
  assert.ok(!head.includes("Gone"), "archived field exported");
  assert.ok(line.endsWith(',"EMEA","Yes"'), "values: " + line);
});

test("custom values are csvCell-escaped: formula guard, quoting, numerics", () => {
  const fields = [
    { id: "cf_f", label: "F", type: "text" },
    { id: "cf_c", label: "C", type: "text" },
    { id: "cf_n", label: "N", type: "number" },
  ];
  const rows = [{ id: "1", name: "Acme", arr: 0, arrUSD: 0, renewalDate: "2027-01-01",
    custom: { cf_f: '=HYPERLINK("x")', cf_c: "a,b", cf_n: -5 } }];
  const [, line] = lib.accountsCSVText(rows, fields).split("\n");
  const tail = ',"\'=HYPERLINK(""x"")","a,b","-5"';
  assert.ok(line.endsWith(tail), "custom cells must be csvCell-escaped (guard, quoting, numeric): " + line);
});

test("survey columns stay out of the template", () => {
  const plain = lib.accountsCSVText([]).split("\n")[0];
  assert.ok(!plain.includes("Survey"), plain);
  assert.equal(lib.accountsCSVText([], [], undefined).split("\n")[0], plain);
});

test("survey columns: values, blank NPS when not enough, n still shown", async () => {
  const { surveyDatesByAccount } = await import("../../src/lib/survey-reports.js");
  const mk = (id, surveyNps) => ({ id, name: id, arr: 0, arrUSD: 0, renewalDate: "2027-01-01", surveyNps });
  const rows = [mk("a", { nps: 40, n: 6, enough: true }), mk("b", { nps: 100, n: 1, enough: false }), mk("c", undefined)];
  const cols = surveyDatesByAccount([{ accountId: "a", source: "sent", sentAt: "2026-10-01T10:00:00Z", submittedAt: "2026-10-03T00:00:00Z" },
    { accountId: "a", source: "sent", sentAt: "2026-09-01T00:00:00Z" }]);
  const [head, ...lines] = lib.accountsCSVText(rows, [{ id: "cf", label: "Zed", type: "text" }], cols).split("\n");
  const h = head.split(",");
  const i = h.indexOf('"Survey NPS"');
  assert.equal(h.slice(i, i + 5).join(","), '"Survey NPS","Survey NPS responses","Last survey sent","Last survey answered","Zed"');
  assert.equal(h[i - 1], "approvedRoi");
  const tail = l => l.split(",").slice(i, i + 4).join(",");
  assert.equal(tail(lines[0]), '"40","6","2026-10-01","2026-10-03"');
  assert.equal(tail(lines[1]), '"","1","",""');
  assert.equal(tail(lines[2]), '"","","",""');
});

test("account CSV import ignores the survey columns", async () => {
  const rows = lib.parseCSV(lib.accountsCSVText([{ id: "a", name: "Acme", arr: 5, arrUSD: 5, renewalDate: "2027-01-01", surveyNps: { nps: 40, n: 6, enough: true } }], [], new Map()));
  const { customImportColumns } = lib;
  assert.deepEqual(customImportColumns(rows[0], []), []);
  assert.deepEqual(customImportColumns(rows[0], [{ id: "cf", label: "Zed", type: "text" }]), []);
});
