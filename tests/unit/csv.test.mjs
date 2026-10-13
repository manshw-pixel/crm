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
  assert.ok(!head.includes(",=Danger"), "formula-looking label must be neutralised: " + head);
  assert.ok(!head.includes("Gone"), "archived field exported");
  assert.ok(line.endsWith(",EMEA,Yes"), "values: " + line);
});
