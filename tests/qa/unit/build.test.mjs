import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latestRunId, buildReport } from "../report/build.mjs";

test("latestRunId picks the newest run dir and ignores other files", () => {
  assert.equal(latestRunId(["history.json", "qa-20261014-1542", "qa-20261015-0901", "report-url.txt", "qa-20261014-1600"]), "qa-20261015-0901");
  assert.equal(latestRunId(["history.json"]), null);
  assert.equal(latestRunId(["qa-20261014-1000", "qa-20261014-1100"], id => id.endsWith("1000")), "qa-20261014-1000");
});

test("buildReport writes report.html for the latest run, with analysis", () => {
  const out = mkdtempSync(join(tmpdir(), "qa-build-"));
  for (const id of ["qa-20261014-1000", "qa-20261014-1100"]) {
    mkdirSync(join(out, id));
    writeFileSync(join(out, id, "results.json"), JSON.stringify({ runId: id, summary: { total: 1, pass: 0, fail: 1 },
      results: [{ id: "f/a", feature: "f", title: "A", status: "fail", error: "e" }], notes: [] }));
  }
  writeFileSync(join(out, "qa-20261014-1100", "analysis.json"), JSON.stringify({ "f/a": { cause: "Test issue: stale", fileLine: "x:1", fix: "y", confidence: "high" } }));
  // a newer feature-only run must not be picked by default
  mkdirSync(join(out, "qa-20261014-1200"));
  writeFileSync(join(out, "qa-20261014-1200", "results.json"), JSON.stringify({ runId: "qa-20261014-1200", feature: "06-tasks", summary: {}, results: [{ id: "a" }] }));
  const { runId, path: p } = buildReport(out);
  assert.equal(runId, "qa-20261014-1100");
  const html = readFileSync(p, "utf8");
  assert.match(html, /QA run qa-20261014-1100/); assert.match(html, /Test issue: stale/);
  assert.throws(() => buildReport(out, "qa-20990101-0000"), /not found/);
});
