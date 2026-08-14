// Minimal assert-based runner; later tasks push cases into CASES.
export { CASES, test, assert } from "./framework.mjs";
import { CASES } from "./framework.mjs";

// Import test files (added by later tasks) here:
import "./smoke.test.mjs";
import "./helpers.test.mjs";
import "./reducer.test.mjs";
import "./crossing.test.mjs";
import "./settings.test.mjs";
import "./bell.test.mjs";
import "./dashboard.test.mjs";
import "./pill.test.mjs";
import "./dates.test.mjs";
import "./backfill.test.mjs";
import "./tasks.test.mjs";
import "./toast.test.mjs";
import "./bulk.test.mjs";
import "./segments.test.mjs";
import "./a11y.test.mjs";
import "./persistence.test.mjs";
import "./csv.test.mjs";
import "./retention.test.mjs";
import "./cohort.test.mjs";
import "./churn-analysis.test.mjs";
import "./renewal-outcomes.test.mjs";
import "./renewal-write.test.mjs";

// run.mjs is the CLI entry point (not intended to be imported by other modules — test
// files import test/assert from framework.mjs instead, see comment above), so the
// runner always executes rather than gating on an import.meta.url === argv[1] check
// (which is unreliable cross-platform, e.g. relative vs. absolute paths on Windows).
let pass = 0, fail = 0;
for (const c of CASES) {
  try { await c.fn(); console.log("PASS", c.name); pass++; }
  catch (e) { console.error("FAIL", c.name, "\n ", e.message); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
