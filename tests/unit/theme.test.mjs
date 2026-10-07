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
import { readFileSync, readdirSync } from "node:fs";
const ROOT = new URL("../../", import.meta.url);
const html = readFileSync(new URL("crm.html", ROOT), "utf8");
const block = re => { const m = html.match(re); return m ? m[1] : ""; };
const varsIn = css => new Set([...css.matchAll(/--([a-z]+(?:-[a-z]+)?(?:-\d+)?)\s*:/g)].map(m => m[1]));
const usedShades = () => {
  const src = readdirSync(new URL("src/", ROOT)).filter(f => f.endsWith(".jsx"))
    .map(f => readFileSync(new URL("src/" + f, ROOT), "utf8")).join("\n");
  const re = /\b(?:bg|text|border|ring|from|to|fill|stroke|divide|outline|accent|placeholder)-(white|scrim|(?:slate|gray|indigo|rose|amber|emerald|sky)-\d{2,3})\b/g;
  return new Set([...src.matchAll(re)].map(m => m[1]));
};
test("every colour the app uses has a light variable", () => {
  const light = varsIn(block(/:root\s*\{([\s\S]*?)\}/));
  const missing = [...usedShades()].filter(s => !light.has(s));
  assert.deepEqual(missing, []);
});
test("every colour the app uses has a dark variable, and the dark block is screen-only", () => {
  const dark = varsIn(block(/@media screen\s*\{\s*html\.dark\s*\{([\s\S]*?)\}\s*\}/));
  const missing = [...usedShades(), "page", "line-strong"].filter(s => s !== "scrim" && !dark.has(s));
  assert.deepEqual(missing, []);
  assert.ok(!dark.has("scrim"), "scrim must not change in dark");
});
test("the head script mirrors normalizeChoice/resolveTheme", () => {
  const head = block(/<head>([\s\S]*?)<\/head>/);
  assert.match(head, /localStorage\.getItem\("onevio\.theme"\)/);
  assert.match(head, /c!=="light"&&c!=="dark"/);
  assert.match(head, /prefers-color-scheme: dark/);
  // colour-scheme comes only from the screen-scoped html.dark block; an inline style would leak into print
  assert.ok(!/colorScheme/.test(head), "head script must not set an inline colorScheme");
  assert.ok(head.indexOf("onevio.theme") < head.indexOf("<style>"), "theme script must run before the stylesheet");
});
