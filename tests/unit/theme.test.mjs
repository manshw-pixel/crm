import { test } from "node:test";
import assert from "node:assert/strict";
import { THEME_KEY, THEME_CHOICES, normalizeChoice, resolveTheme, nextChoice } from "../../src/lib/theme.js";

test("constants", () => {
  assert.equal(THEME_KEY, "onevio.theme");
  assert.deepEqual(THEME_CHOICES, ["light", "dark", "auto"]);
});
test("normalizeChoice: only exact values survive; everything else is auto", () => {
  for (const c of ["light", "dark", "auto"]) assert.equal(normalizeChoice(c), c);
  for (const bad of [null, undefined, "", "Dark", "1", 1, {}, " dark"]) assert.equal(normalizeChoice(bad), "auto", String(bad));
});
test("resolveTheme: all six choice x device combinations", () => {
  assert.equal(resolveTheme("light", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("dark", true), "dark");
  assert.equal(resolveTheme("auto", false), "light");
  assert.equal(resolveTheme("auto", true), "dark");
  assert.equal(resolveTheme("garbage", true), "dark");
});
test("nextChoice cycles light -> dark -> auto -> light", () => {
  assert.equal(nextChoice("light"), "dark");
  assert.equal(nextChoice("dark"), "auto");
  assert.equal(nextChoice("auto"), "light");
  assert.equal(nextChoice("junk"), "light");
});
