// merge_row against a REAL Postgres. These are the concurrency claims from the spec; they
// cannot be proven against the mocked store, because what is under test is precisely what
// the SERVER does when two clients write one row.
import { test, assert } from "../health/framework.mjs";
import { sessions, seedRow, valueOf } from "./fixtures.mjs";

const merge = (who, tbl, row_id, patch = {}, appends = {}) =>
  sessions[who].rpc("merge_row", { tbl, row_id, patch, appends });

test("two clients patching DIFFERENT fields of one account both survive", async () => {
  await seedRow("accounts", "m-1", { id: "m-1", name: "Acme", arr: 100, csm: "Priya" });
  const a = await merge("admin", "accounts", "m-1", { arr: 500 });
  const b = await merge("user", "accounts", "m-1", { csm: "Dana" });
  assert(!a.error, `admin merge failed: ${a.error && a.error.message}`);
  assert(!b.error, `user merge failed: ${b.error && b.error.message}`);
  const v = await valueOf("accounts", "m-1");
  assert(v.arr === 500, `the ARR edit was reverted: arr=${v.arr}`);
  assert(v.csm === "Dana", `the CSM edit was reverted: csm=${v.csm}`);
  assert(v.name === "Acme", "an untouched field was lost");
});

test("two clients appending an arrEvent both land, neither duplicated", async () => {
  await seedRow("accounts", "m-2", { id: "m-2", name: "Acme", arrEvents: [{ id: "e0", delta: 1 }] });
  await merge("admin", "accounts", "m-2", {}, { arrEvents: [{ id: "e1", delta: 10 }] });
  await merge("user", "accounts", "m-2", {}, { arrEvents: [{ id: "e2", delta: 20 }] });
  const ids = (await valueOf("accounts", "m-2")).arrEvents.map(e => e.id).sort();
  assert(ids.join() === "e0,e1,e2", `expected e0,e1,e2 — got ${ids.join()}`);
});

test("a REPLAYED append does not duplicate the entry", async () => {
  // This is what makes the retry in Task 5 safe: the worker cannot know whether a timed-out
  // request landed, so applying it twice must be identical to applying it once.
  await seedRow("accounts", "m-3", { id: "m-3", arrEvents: [] });
  const op = { arrEvents: [{ id: "e9", delta: 99 }] };
  await merge("admin", "accounts", "m-3", {}, op);
  await merge("admin", "accounts", "m-3", {}, op);
  const evs = (await valueOf("accounts", "m-3")).arrEvents;
  assert(evs.length === 1, `the replay duplicated the entry: ${JSON.stringify(evs)}`);
});

test("history dedupes by whole-element equality", async () => {
  // history entries are { d, s } with no id (crm.html:488), so identity IS the value.
  await seedRow("accounts", "m-4", { id: "m-4", history: [{ d: "2026-08-01", s: 70 }] });
  await merge("admin", "accounts", "m-4", {}, {
    history: [{ d: "2026-08-01", s: 70 }, { d: "2026-08-02", s: 80 }],
  });
  const h = (await valueOf("accounts", "m-4")).history;
  assert(h.length === 2, `expected 2 entries, got ${JSON.stringify(h)}`);
  assert(h[1].s === 80, "the new snapshot is missing");
});

test("merge_row inserts the row when it does not exist yet", async () => {
  const { error } = await merge("user", "accounts", "m-5", { id: "m-5", name: "Fresh" });
  assert(!error, `insert-through-merge failed: ${error && error.message}`);
  assert((await valueOf("accounts", "m-5")).name === "Fresh", "the row was not created");
});

test("merge_row does NOT let a plain user write settings", async () => {
  // The whole point of `security invoker`: the RPC must remain subject to settings_write,
  // which is admin-only. A definer function would sail straight past it.
  const { error } = await merge("user", "settings", "1", { rates: { INR: 99 } });
  assert(error, "a plain user's merge into settings was allowed — is merge_row security definer?");
  assert(error.code === "42501" || /permission|denied|policy/i.test(error.message),
    `expected an RLS denial, got ${error.code}: ${error.message}`);
});

test("merge_row cannot be pointed at an arbitrary table", async () => {
  const { error } = await merge("user", "profiles", "x", { role: "admin" });
  assert(error, "merge_row accepted a table outside the allow-list — role escalation is reachable");
});

test("merge_row rejects a table name crafted for SQL injection", async () => {
  const { error } = await merge("admin", 'accounts"; drop table public.accounts; --', "x", { a: 1 });
  assert(error, "the crafted table name was accepted");
  const { error: alive } = await sessions.admin.from("accounts").select("id").limit(1);
  assert(!alive || alive.code !== "PGRST205",
    "the accounts table is gone — the identifier was interpolated unsafely");
});
