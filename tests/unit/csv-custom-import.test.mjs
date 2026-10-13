import { test } from "node:test";
import assert from "node:assert/strict";
import { customImportColumns, parseCustomCell, parseCSV, accountsCSVText } from "../../src/lib/csv.js";

const defs = [
  { id: "cf_r", label: "Region", type: "select", options: ["North", "South"] },
  { id: "cf_n", label: "Seats 2026", type: "number" },
  { id: "cf_d", label: "Go-live", type: "date" },
  { id: "cf_b", label: "Has SSO", type: "bool" },
  { id: "cf_t", label: "Notes", type: "text" },
  { id: "cf_i", label: "Industry", type: "text" },
  { id: "cf_x", label: "Old", type: "text", archived: true },
];

test("customImportColumns matches by label, ignoring case and punctuation", () => {
  const cols = customImportColumns(["name", "REGION", "seats-2026", "go live", "has_sso", "notes", "industry", "old"], defs);
  assert.deepEqual(cols.map(c => [c.def.id, c.index]), [["cf_r", 1], ["cf_n", 2], ["cf_d", 3], ["cf_b", 4], ["cf_t", 5]]);
});

test("customImportColumns: a field labelled like a built-in never takes that column; archived fields are ignored", () => {
  const cols = customImportColumns(["industry", "old"], defs);
  assert.deepEqual(cols, []);
});

test("parseCustomCell: blank leaves alone, good values parse, bad ones are flagged", () => {
  const d = id => defs.find(x => x.id === id);
  assert.equal(parseCustomCell(d("cf_t"), "  "), null);
  assert.deepEqual(parseCustomCell(d("cf_r"), "north"), { value: "North" });
  assert.deepEqual(parseCustomCell(d("cf_r"), "East"), { bad: true });
  assert.deepEqual(parseCustomCell(d("cf_n"), "1,200"), { value: 1200 });
  assert.deepEqual(parseCustomCell(d("cf_n"), "lots"), { bad: true });
  assert.deepEqual(parseCustomCell(d("cf_d"), "25-12-2026", "dmy"), { value: "2026-12-25" });
  assert.deepEqual(parseCustomCell(d("cf_d"), "soon"), { bad: true });
  assert.deepEqual(parseCustomCell(d("cf_b"), "Yes"), { value: true });
  assert.deepEqual(parseCustomCell(d("cf_b"), "no"), { value: false });
  assert.deepEqual(parseCustomCell(d("cf_b"), "maybe"), { bad: true });
  assert.deepEqual(parseCustomCell(d("cf_t"), " hi "), { value: "hi" });
});

test("export then import round-trips every custom field type", () => {
  const live = defs.filter(x => x.id !== "cf_i");
  const a = { name: "Acme", custom: { cf_r: "South", cf_n: 40, cf_d: "2026-11-02", cf_b: true, cf_t: "=SUM(1)" } };
  const rows = parseCSV(accountsCSVText([a], live));
  const cols = customImportColumns(rows[0], live);
  const back = Object.fromEntries(cols.map(({ index, def }) => [def.id, parseCustomCell(def, rows[1][index], "dmy")?.value]));
  assert.deepEqual(back, a.custom);
});
