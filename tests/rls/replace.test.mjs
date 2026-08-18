import { test, assert } from "../health/framework.mjs";
import { sessions, seedRow, stillExists } from "./fixtures.mjs";

const payload = extra => ({
  accounts: [{ id: "r-new", name: "Imported" }],
  contacts: [], activities: [], tasks: [], opportunities: [],
  settings: { rates: { INR: 0.012 } }, ...extra,
});

test("replace_all swaps the whole dataset for an admin", async () => {
  await seedRow("accounts", "r-old", { id: "r-old", name: "Old" });
  const { error } = await sessions.admin.rpc("replace_all", { payload: payload() });
  assert(!error, `admin replace_all failed: ${error && error.message}`);
  assert(!(await stillExists("accounts", "r-old")), "the old row survived the replace");
  assert(await stillExists("accounts", "r-new"), "the new row was not inserted");
});

test("A FAILING replace_all leaves every original row in place", async () => {
  // THE D3 REGRESSION TEST. The old replaceAllRemote deleted all five tables in a loop and
  // only then inserted, so a failure anywhere in between emptied the team's database with
  // no backup. The failure here is induced by a malformed payload -- a row with no id in
  // the SECOND table, so the deletes have already run by the time it blows up.
  await seedRow("accounts", "r-keep", { id: "r-keep", name: "Must survive" });
  await seedRow("contacts", "r-keep-c", { id: "r-keep-c", name: "Must survive too" });
  const { error } = await sessions.admin.rpc("replace_all", {
    payload: payload({ contacts: [{ nope: "this row has no id" }] }),
  });
  assert(error, "a malformed payload was accepted — the replace is not validating rows");
  assert(await stillExists("accounts", "r-keep"),
    "THE DATABASE WAS EMPTIED — replace_all is not atomic");
  assert(await stillExists("contacts", "r-keep-c"),
    "THE DATABASE WAS EMPTIED — replace_all is not atomic");
  assert(!(await stillExists("accounts", "r-new")), "a partial insert was committed");
});

test("a plain user cannot replace_all", async () => {
  await seedRow("accounts", "r-guard", { id: "r-guard", name: "Guarded" });
  const { error } = await sessions.user.rpc("replace_all", { payload: payload() });
  assert(error, "a plain user's replace_all was allowed — it must stay admin-gated");
  assert(/admin only/.test(error.message),
    `expected the admin guard to reject it, got: ${error.message}`);
  assert(await stillExists("accounts", "r-guard"), "the plain user's replace took effect anyway");
});
