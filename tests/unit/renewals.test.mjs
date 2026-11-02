import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { RENEWAL_WINDOWS, renewalWindowOf, renewalWindows, localDateKey } from "../../src/lib/renewals.js";
import { fmtDayHint } from "../../src/lib/dates.js";

const TODAY = "2026-11-02";
const plus = (n, base = TODAY) => {
  const [y, m, d] = base.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

test("renewalWindowOf: window boundaries", () => {
  const cases = [[0, "0-30"], [30, "0-30"], [31, "31-60"], [60, "31-60"], [61, "61-90"],
    [90, "61-90"], [91, "90+"], [400, "90+"], [-1, null]];
  for (const [n, want] of cases) assert.equal(renewalWindowOf(plus(n), TODAY), want, `+${n}d`);
  for (const bad of [undefined, null, "", "soon"]) assert.equal(renewalWindowOf(bad, TODAY), null);
  assert.equal(renewalWindowOf("2027-01-01", "2026-12-31"), "0-30");
  assert.equal(renewalWindowOf("2027-01-30", "2026-12-31"), "0-30");
  assert.equal(renewalWindowOf("2027-02-01", "2026-12-31"), "31-60");
});

test("renewalWindows: sums ARR and counts per window", () => {
  const accts = [
    { arrUSD: 38000, renewalDate: plus(15) }, { arrUSD: 240000, renewalDate: plus(25) },
    { arrUSD: 90000, renewalDate: plus(50) }, { arrUSD: 118000, renewalDate: plus(65) },
    { arrUSD: 74000, renewalDate: plus(115) }, { arrUSD: 5000, renewalDate: plus(-3) },
    { arrUSD: 7000 },
  ];
  assert.deepEqual(renewalWindows(accts, TODAY), [
    { key: "0-30", label: "0–30 days", arrUSD: 278000, count: 2 },
    { key: "31-60", label: "31–60 days", arrUSD: 90000, count: 1 },
    { key: "61-90", label: "61–90 days", arrUSD: 118000, count: 1 },
    { key: "90+", label: "90+ days", arrUSD: 74000, count: 1 },
  ]);
});

test("renewalWindows: empty list gives four zero entries; missing arrUSD counts 0", () => {
  assert.deepEqual(renewalWindows([], TODAY), RENEWAL_WINDOWS.map(w => ({ ...w, arrUSD: 0, count: 0 })));
  assert.deepEqual(renewalWindows(undefined, TODAY).map(w => w.count), [0, 0, 0, 0]);
  const r = renewalWindows([{ renewalDate: plus(5) }], TODAY);
  assert.equal(r[0].arrUSD, 0); assert.equal(r[0].count, 1);
});

// Sturdier purity check: strip comments and string literals first, then ban host globals and
// clock reads; only relative imports are allowed.
const codeOnly = src => src
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
  .replace(/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""');
const BANNED = /\b(window|document|globalThis|self|localStorage|sessionStorage|navigator)\b|\bDate\.now\s*\(/;
function impureReason(src) {
  for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s*(["'])([^"']+)\1/gm))
    if (!/^\.\.?\//.test(m[2])) return "non-relative import " + m[2];
  if (/^\s*import\s*["'](?!\.)/m.test(src)) return "bare side-effect import";
  const hit = BANNED.exec(codeOnly(src));
  return hit ? "uses " + hit[0] : null;
}

test("renewals module is pure (comments/strings stripped; no host globals, no clock reads)", () => {
  const src = readFileSync(new URL("../../src/lib/renewals.js", import.meta.url), "utf8");
  assert.equal(impureReason(src), null);
});

test("purity check bites: catches globals, Date.now and package imports; ignores comments/strings", () => {
  assert.match(impureReason("const x = window.innerWidth;"), /window/);
  assert.match(impureReason("const t = Date.now();"), /Date\.now/);
  assert.match(impureReason("const s = localStorage;"), /localStorage/);
  assert.match(impureReason("const g = globalThis.x;"), /globalThis/);
  assert.match(impureReason("const n = navigator.language;"), /navigator/);
  assert.match(impureReason('import x from "react";'), /non-relative/);
  assert.equal(impureReason('import { a } from "./dates.js";\n// window.x and Date.now()\nconst s = "document";'), null);
});

// Follow-up (7): the page's "today" comes from LOCAL date parts so the Past due lane (local
// month keys) and the windows agree on the 1st of a month east of UTC (IST).
test("localDateKey: local calendar date, not the UTC one", () => {
  assert.equal(localDateKey(new Date(2026, 10, 1, 0, 30)), "2026-11-01");
  assert.equal(localDateKey(new Date(2026, 0, 9, 23, 59)), "2026-01-09");
});

test("localDateKey in IST at 00:30 on the 1st gives the 1st (toISOString would give the 31st)", () => {
  const code = `import("${new URL("../../src/lib/renewals.js", import.meta.url).href}").then(m => {
    const d = new Date(2026, 10, 1, 0, 30);
    process.stdout.write(m.localDateKey(d) + "|" + d.toISOString().slice(0, 10));
  });`;
  const out = execFileSync(process.execPath, ["-e", code], { env: { ...process.env, TZ: "Asia/Kolkata" } }).toString();
  assert.equal(out, "2026-11-01|2026-10-31");
});

// Follow-up (5): the Today hint is formatted from the SAME ISO date the buckets use.
test("fmtDayHint: formats the given ISO date in UTC, whatever the local timezone", () => {
  assert.equal(fmtDayHint("2026-11-02"), "Mon Nov 2");
  const code = `import("${new URL("../../src/lib/dates.js", import.meta.url).href}").then(m => process.stdout.write(m.fmtDayHint("2026-11-02")));`;
  for (const TZ of ["America/Los_Angeles", "Asia/Kolkata", "Pacific/Kiritimati"])
    assert.equal(execFileSync(process.execPath, ["-e", code], { env: { ...process.env, TZ } }).toString(), "Mon Nov 2", TZ);
});
