// Entry point for the RLS suite. Mirrors tests/health/run.mjs, including its exit-code
// contract: NEVER pipe this — the exit code IS the gate.
import { CASES } from "../health/framework.mjs";
import { bootstrap } from "./fixtures.mjs";

import "./auth.test.mjs";
import "./policies.test.mjs";
import "./merge.test.mjs";
import "./storage.test.mjs";
import "./replace.test.mjs";
import "./errorlog.test.mjs";

try {
  await bootstrap();
} catch (e) {
  // Lead with the REAL error. This used to open with "Could not reach the local Supabase
  // stack", which is only one of the ways bootstrap can fail: when a perfectly healthy
  // stack rejected one of the reset statements, the log confidently blamed Docker and
  // buried the actual message underneath it.
  console.error("\nBootstrap failed, so no test ran.\n");
  console.error(e.stack || e.message);
  console.error("\nIf that reads as a connection failure: is Docker running, and have you run `supabase start`?");
  process.exit(2);
}

let pass = 0, fail = 0;
for (const c of CASES) {
  try { await c.fn(); console.log("PASS", c.name); pass++; }
  catch (e) { console.error("FAIL", c.name, "\n  ", e.message); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
