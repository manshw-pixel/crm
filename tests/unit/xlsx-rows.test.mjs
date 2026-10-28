import { test } from "node:test";
import assert from "node:assert/strict";
import { cellText, sheetRows, rowsToCSV } from "../../src/lib/xlsx-rows.js";
import { parseCSV } from "../../src/lib/csv.js";

test("cellText: typed date is the same calendar day (UTC parts)", () => {
  assert.equal(cellText(new Date(Date.UTC(2026, 10, 15))), "2026-11-15");
});
test("cellText: number, boolean, string, empty", () => {
  assert.equal(cellText(1001), "1001");
  assert.equal(cellText(2.5), "2.5");
  assert.equal(cellText(true), "TRUE");
  assert.equal(cellText(false), "FALSE");
  assert.equal(cellText("  Acme "), "  Acme ");
  assert.equal(cellText(null), "");
  assert.equal(cellText(undefined), "");
});
test("cellText: rich text, formula, hyperlink, error", () => {
  assert.equal(cellText({ richText: [{ text: "Ac" }, { text: "me" }] }), "Acme");
  assert.equal(cellText({ formula: "A1*2", result: 4 }), "4");
  assert.equal(cellText({ formula: "A1", result: new Date(Date.UTC(2026, 0, 2)) }), "2026-01-02");
  assert.equal(cellText({ formula: "A1" }), "");
  assert.equal(cellText({ text: "site", hyperlink: "https://x.y" }), "site");
  assert.equal(cellText({ error: "#REF!" }), "");
});
test("sheetRows pads to header width and drops trailing blank rows", () => {
  const rows = sheetRows([["a", "b", "c"], [1, null], [], [null, ""], ]);
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "", ""]]);
});
test("sheetRows keeps an inner blank row but drops trailing ones", () => {
  assert.deepEqual(sheetRows([["a"], [], ["x"], [""]]), [["a"], [""], ["x"]]);
});
test("rowsToCSV round-trips through parseCSV incl. comma and quote", () => {
  const rows = [["name", "note"], ["Acme, Inc", 'say "hi"'], ["=SUM(A1)", "-5"]];
  assert.deepEqual(parseCSV(rowsToCSV(rows)), rows);
});
