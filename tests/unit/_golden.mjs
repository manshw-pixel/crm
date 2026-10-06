// Shared harness for the pure-logic unit tests. Pins the timezone and the clock to the
// values golden.json was recorded under, revives encoded arguments, and normalises
// outputs the same way the generator serialised them.
process.env.TZ = "UTC";
import { readFileSync } from "node:fs";
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const G = JSON.parse(readFileSync(new URL("./golden/golden.json", import.meta.url), "utf8"));

const revive = v => {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object") {
    if ("$date" in v) return new Date(v.$date);
    if ("$undef" in v) return undefined;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
  }
  return v;
};
const norm = v => v === undefined ? null
  : JSON.parse(JSON.stringify(v instanceof Map ? { $map: [...v.entries()] } : v));

export function goldenSuite(moduleName, lib) {
  const cases = G.cases.filter(c => c[0] === moduleName);
  test(`${moduleName}: has golden cases`, () => assert.ok(cases.length > 0));
  cases.forEach(([, fn, args, expected], i) => {
    test(`${moduleName}.${fn} #${i}`, () => {
      mock.timers.enable({ apis: ["Date"], now: Date.parse(G.now) });
      try {
        assert.equal(typeof lib[fn], "function", `${fn} is not exported from src/lib/${moduleName}.js`);
        assert.deepEqual(norm(lib[fn](...revive(args))), expected);
      } finally { mock.timers.reset(); }
    });
  });
}
