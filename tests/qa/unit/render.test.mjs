import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "../report/render.mjs";

const results = { runId: "qa-20261014-1530", liveVersion: "cbadbda", finishedAt: "2026-10-14T10:15:00Z",
  summary: { total: 2, pass: 1, fail: 1, flaky: 0, byFeature: { "08-finance": { pass: 1, fail: 1, flaky: 0 } } },
  results: [
    { id: "08-finance/a", feature: "08-finance", title: "A", status: "pass" },
    { id: "08-finance/b", feature: "08-finance", title: "B <script>", status: "fail", error: "x < y", artifacts: { screenshot: "08-finance__b.png" } }],
  notes: [] };
const history = [{ runId: "qa-20261013-0900", summary: { total: 2, pass: 2, fail: 0, flaky: 0 }, failedIds: [] }];

test("verdict, new-failure diff, escaping, analysis", () => {
  const html = renderReport(results, history, { "08-finance/b": { cause: "tax rounding", fileLine: "src/lib/invoice.js:42", fix: "round per line", confidence: "medium" } });
  assert.match(html, /1 of 2 failed/);
  assert.match(html, /New failure/);
  assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"));
  assert.match(html, /src\/lib\/invoice\.js:42/);
  assert.match(html, /<title>QA Report<\/title>/);
});

test("all pass verdict", () => {
  const r = { ...results, summary: { total: 1, pass: 1, fail: 0, flaky: 0, byFeature: {} }, results: [results.results[0]] };
  assert.match(renderReport(r, [], {}), /PASS/);
});

test("skipped shown grey with reason and counted separately; fixed-since badge; notes escaped", () => {
  const r = { ...results, notes: ["n <b>"],
    summary: { total: 2, pass: 1, fail: 0, flaky: 0, skipped: 1, byFeature: { "08-finance": { pass: 1, fail: 0, flaky: 0, skipped: 1 } } },
    results: [{ id: "08-finance/b", feature: "08-finance", title: "B", status: "pass" },
      { id: "08-finance/c", feature: "08-finance", title: "C", status: "skipped", reason: "no AM user configured" }] };
  const html = renderReport(r, [{ runId: "x", summary: { total: 1, pass: 0, fail: 1, flaky: 0 }, failedIds: ["08-finance/b"] }], {});
  assert.match(html, /1 skipped/);
  assert.match(html, /no AM user configured/);
  assert.match(html, /class="st skipped"/);
  assert.match(html, /Fixed since last run/);
  assert.ok(html.includes("n &lt;b&gt;"));
});

test("history entry for the current run is excluded from baseline and strip", () => {
  const self = { runId: results.runId, summary: results.summary, failedIds: ["08-finance/b"] };
  const html = renderReport(results, [...history, self], {});
  assert.match(html, /New failure/);
  assert.equal((html.match(/<span class="(pass|fail|flaky)" title=/g) || []).length, 2);
});

test("attribute values are escaped", () => {
  const r = { ...results, results: [{ id: 'x"y', feature: "f", title: "T", status: "fail", error: "e", artifacts: { screenshot: 'a"<b>.png' } }] };
  const html = renderReport(r, [], {});
  assert.ok(html.includes('src="shots/a&quot;&lt;b&gt;.png"'));
  assert.ok(!html.includes('a"<b>'));
});
