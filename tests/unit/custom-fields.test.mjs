import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOM_FIELD_TYPES, activeCustomFields, archivedCustomFields, normalizeFieldDef, coerceCustomValue,
  editorValue, formatCustomValue, buildCustomPatch, newFieldId } from "../../src/lib/custom-fields.js";

test("types list is exactly the five spec types", () => {
  assert.deepEqual(CUSTOM_FIELD_TYPES, ["text", "number", "date", "select", "bool"]);
});

test("active/archived split tolerates junk", () => {
  assert.deepEqual(activeCustomFields(undefined), []);
  assert.deepEqual(activeCustomFields("x"), []);
  const defs = [{ id: "a", label: "A" }, { id: "b", label: "B", archived: true }, { id: "c", label: "C" }];
  assert.deepEqual(activeCustomFields(defs).map(d => d.id), ["a", "c"]);
  assert.deepEqual(archivedCustomFields(defs).map(d => d.id), ["b"]);
});

test("normalizeFieldDef trims, defaults type, cleans options", () => {
  assert.deepEqual(normalizeFieldDef({ id: "x", label: "  Region ", type: "weird" }), { id: "x", label: "Region", type: "text", archived: false });
  assert.deepEqual(normalizeFieldDef({ id: "x", label: "Seg", type: "select", options: [" A ", "", "B", "A"] }),
    { id: "x", label: "Seg", type: "select", options: ["A", "B"], archived: false });
  assert.equal("options" in normalizeFieldDef({ id: "x", label: "N", type: "number", options: ["1"] }), false);
});

test("coerceCustomValue per type", () => {
  assert.equal(coerceCustomValue("text", "  hi "), "hi");
  assert.equal(coerceCustomValue("text", "   "), null);
  assert.equal(coerceCustomValue("number", "12.5"), 12.5);
  assert.equal(coerceCustomValue("number", "abc"), null);
  assert.equal(coerceCustomValue("number", ""), null);
  assert.equal(coerceCustomValue("date", "2026-10-13"), "2026-10-13");
  assert.equal(coerceCustomValue("date", "13/10/2026"), null);
  assert.equal(coerceCustomValue("select", "Gold"), "Gold");
  assert.equal(coerceCustomValue("select", ""), null);
  assert.equal(coerceCustomValue("bool", true), true);
  assert.equal(coerceCustomValue("bool", false), false);
});

test("editorValue never crashes on a value of the wrong type (type changed after save)", () => {
  assert.equal(editorValue("number", "abc"), "");
  assert.equal(editorValue("number", 7), "7");
  assert.equal(editorValue("date", "soon"), "");
  assert.equal(editorValue("bool", "yes"), false);
  assert.equal(editorValue("text", 5), "5");
  assert.equal(editorValue("select", "Removed option"), "Removed option");
  assert.equal(editorValue("text", null), "");
});

test("formatCustomValue shows what is stored, even if it no longer fits", () => {
  assert.equal(formatCustomValue("bool", true), "Yes");
  assert.equal(formatCustomValue("bool", false), "No");
  assert.equal(formatCustomValue("number", 1200), "1200");
  assert.equal(formatCustomValue("number", "abc"), "abc");
  assert.equal(formatCustomValue("select", "Removed option"), "Removed option");
  assert.equal(formatCustomValue("text", null), "");
  assert.equal(formatCustomValue("text", ""), "");
});

test("buildCustomPatch keeps fields it was not asked to change", () => {
  assert.deepEqual(buildCustomPatch({ a: "x", b: 2 }, { a: "y" }), { a: "y", b: 2 });
  assert.deepEqual(buildCustomPatch(undefined, { a: "y" }), { a: "y" });
  assert.deepEqual(buildCustomPatch({ a: "x" }, { a: null }), { a: null });
  assert.deepEqual(buildCustomPatch({}, { a: null }), {});
});

test("newFieldId is prefixed and unique", () => {
  const ids = new Set(Array.from({ length: 200 }, newFieldId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^cf_[a-z0-9]+$/);
});

test("hardening: null def, blank number, impossible dates, undefined edits", () => {
  assert.doesNotThrow(() => normalizeFieldDef(null));
  assert.doesNotThrow(() => normalizeFieldDef(undefined));
  assert.equal(coerceCustomValue("number", "   "), null);
  assert.equal(coerceCustomValue("date", "2026-13-45"), null);
  assert.equal(coerceCustomValue("date", "2026-02-30"), null);
  assert.equal(coerceCustomValue("date", "2026-02-28"), "2026-02-28");
  assert.equal(coerceCustomValue("date", "2024-02-29"), "2024-02-29");
  const p = buildCustomPatch({ a: "x" }, { a: undefined });
  assert.ok("a" in p && p.a === null);
});
