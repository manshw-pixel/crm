// Runs a single test file, for tight red/green loops during development. The full gate is
// still run.mjs -- this exists so a 6-second change does not need a 10-minute suite.
// Usage: node tests/health/run-one.mjs currency-history.test.mjs
import { CASES } from "./framework.mjs";

const file = process.argv[2];
if (!file) { console.error("usage: node tests/health/run-one.mjs <file.test.mjs>"); process.exit(2); }
await import(`./${file}`);

let pass = 0, fail = 0;
for (const c of CASES) {
  try { await c.fn(); console.log("PASS", c.name); pass++; }
  catch (e) { console.error("FAIL", c.name, "\n  ", e.message.split("\n")[0]); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
