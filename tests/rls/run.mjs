// Entry point for the RLS suite. Mirrors tests/health/run.mjs, including its exit-code
// contract: NEVER pipe this — the exit code IS the gate.
import { CASES } from "../health/framework.mjs";
import { bootstrap } from "./fixtures.mjs";

import "./auth.test.mjs";
import "./policies.test.mjs";
import "./storage.test.mjs";

try {
  await bootstrap();
} catch (e) {
  console.error("\nCould not reach the local Supabase stack.");
  console.error("Is Docker running, and have you run `supabase start`?\n");
  console.error(e.message);
  process.exit(2);
}

let pass = 0, fail = 0;
for (const c of CASES) {
  try { await c.fn(); console.log("PASS", c.name); pass++; }
  catch (e) { console.error("FAIL", c.name, "\n  ", e.message); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
