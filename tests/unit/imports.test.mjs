// Every lib module must import cleanly in plain Node (no window/document). An import-time
// reference to a browser global throws here -- the backstop for the build's lint guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

const dir = new URL("../../src/lib/", import.meta.url);
for (const f of readdirSync(dir).filter(f => f.endsWith(".js"))) {
  test(`src/lib/${f} imports in plain Node`, async () => {
    const m = await import(new URL(f, dir));
    assert.ok(Object.keys(m).length > 0, `${f} exports nothing`);
  });
}
