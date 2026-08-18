import { test, assert } from "./framework.mjs";
import { launch } from "./harness.mjs";

// diffRow is the one function in this change that can CORRUPT data rather than merely fail
// to save it: if it ever calls a replacement an append, the arrEvents audit trail grows
// duplicate entries -- a new way to damage the trail three PRs went into getting right.
// Hence the density here.
let page, browser;
const boot = async () => { if (!page) ({ page, browser } = await launch("")); };
const diff = (prev, next) => page.evaluate(([p, n]) => window.__health.diffRow(p, n), [prev, next]);

test("diffRow reports only the scalar fields that changed", async () => {
  await boot();
  const r = await diff({ id: "a1", name: "Acme", arr: 100, csm: "Priya" },
                       { id: "a1", name: "Acme", arr: 200, csm: "Priya" });
  assert(JSON.stringify(r.patch) === '{"arr":200}', `patch was ${JSON.stringify(r.patch)}`);
  assert(JSON.stringify(r.appends) === "{}", "nothing should have been appended");
  assert(JSON.stringify(r.sets) === "{}", "nothing should have been set wholesale");
});

test("diffRow returns an empty diff when nothing changed", async () => {
  await boot();
  const row = { id: "a1", name: "Acme", arr: 100, inputs: { usage: 3 }, arrEvents: [{ id: "e1" }] };
  const r = await diff(row, JSON.parse(JSON.stringify(row)));
  assert(JSON.stringify(r) === '{"patch":{},"appends":{},"sets":{}}',
    `expected an empty diff, got ${JSON.stringify(r)}`);
});

test("diffRow sends a changed nested object whole, not field by field", async () => {
  await boot();
  // jsonb `||` is a SHALLOW merge, so a partial nested object would DROP its sibling keys
  // server-side. `inputs` must travel complete.
  const r = await diff({ id: "a1", inputs: { usage: 3, tickets: 1 } },
                       { id: "a1", inputs: { usage: 9, tickets: 1 } });
  assert(JSON.stringify(r.patch) === '{"inputs":{"usage":9,"tickets":1}}',
    `patch was ${JSON.stringify(r.patch)}`);
});

test("diffRow classifies a trailing addition as an append", async () => {
  await boot();
  const r = await diff({ id: "a1", arrEvents: [{ id: "e1", delta: 10 }] },
                       { id: "a1", arrEvents: [{ id: "e1", delta: 10 }, { id: "e2", delta: 20 }] });
  assert(JSON.stringify(r.appends) === '{"arrEvents":[{"id":"e2","delta":20}]}',
    `appends was ${JSON.stringify(r.appends)}`);
  assert(JSON.stringify(r.patch) === "{}", "an append must not also travel as a patch");
});

test("diffRow appends multiple trailing items in order", async () => {
  await boot();
  const r = await diff({ id: "a1", history: [{ d: "2026-08-01", s: 70 }] },
                       { id: "a1", history: [{ d: "2026-08-01", s: 70 },
                                             { d: "2026-08-02", s: 71 },
                                             { d: "2026-08-03", s: 72 }] });
  assert(r.appends.history.length === 2, `expected 2 appends, got ${JSON.stringify(r.appends.history)}`);
  assert(r.appends.history[0].d === "2026-08-02" && r.appends.history[1].d === "2026-08-03",
    "append order was not preserved");
});

test("diffRow falls back to a whole-array set when an item was REMOVED", async () => {
  await boot();
  const r = await diff({ id: "a1", docs: [{ id: "d1" }, { id: "d2" }] },
                       { id: "a1", docs: [{ id: "d1" }] });
  assert(JSON.stringify(r.appends) === "{}", "a removal is not an append");
  assert(JSON.stringify(r.sets) === '{"docs":[{"id":"d1"}]}', `sets was ${JSON.stringify(r.sets)}`);
});

test("diffRow falls back to a whole-array set when items were REORDERED", async () => {
  await boot();
  const r = await diff({ id: "a1", docs: [{ id: "d1" }, { id: "d2" }] },
                       { id: "a1", docs: [{ id: "d2" }, { id: "d1" }] });
  assert(JSON.stringify(r.appends) === "{}", "a reorder is not an append");
  assert(r.sets.docs.length === 2 && r.sets.docs[0].id === "d2", `sets was ${JSON.stringify(r.sets)}`);
});

test("diffRow falls back to a whole-array set when an EXISTING item was edited", async () => {
  await boot();
  // EDIT_DOCUMENT mutates an element in place. The prefix no longer matches, so this must
  // NOT be read as "unchanged, plus nothing".
  const r = await diff({ id: "a1", docs: [{ id: "d1", name: "old" }] },
                       { id: "a1", docs: [{ id: "d1", name: "new" }] });
  assert(JSON.stringify(r.appends) === "{}", "an in-place edit is not an append");
  assert(JSON.stringify(r.sets) === '{"docs":[{"id":"d1","name":"new"}]}',
    `sets was ${JSON.stringify(r.sets)}`);
});

test("diffRow handles an array that did not exist before", async () => {
  await boot();
  const r = await diff({ id: "a1" }, { id: "a1", arrEvents: [{ id: "e1" }] });
  assert(JSON.stringify(r.appends) === '{"arrEvents":[{"id":"e1"}]}',
    `appends was ${JSON.stringify(r.appends)}`);
});

test("diffRow treats an absent prev row as a whole write", async () => {
  await boot();
  const r = await diff(undefined, { id: "a1", name: "Acme", arrEvents: [{ id: "e1" }] });
  assert(r.patch.name === "Acme" && r.patch.arrEvents.length === 1, `patch was ${JSON.stringify(r.patch)}`);
  assert(JSON.stringify(r.appends) === "{}", "a new row has nothing to append onto");
});

test("diffRow reports a field cleared to undefined as an explicit null", async () => {
  await boot();
  // `delete a._orphaned` and a cleared parentId must actually REMOVE the value server-side.
  // An undefined vanishes from the JSON payload and leaves the old value in place.
  const r = await diff({ id: "a1", parentId: "p1" }, { id: "a1", parentId: undefined });
  assert(r.patch.parentId === null, `expected an explicit null, got ${JSON.stringify(r.patch)}`);
  if (browser) await browser.close();
});
