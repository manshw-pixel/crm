// Minimal assert-based test framework, split out from run.mjs so test files can import
// `test`/`assert` without creating a circular import with the run.mjs entry point
// (run.mjs imports test files, so test files must not import run.mjs back).
export const CASES = [];
export function test(name, fn) { CASES.push({ name, fn }); }
export function assert(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }
