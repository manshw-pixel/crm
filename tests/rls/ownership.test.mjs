// Admin-only owner fields on accounts (spec 2026-10-13 PR 2). Every block has a positive control.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, ORG_A, seedRow, valueOf } from "./fixtures.mjs";

const MSG = /Only an admin can change an account's CSM or Lead/;
const merge = (who, row_id, patch) => sessions[who].rpc("merge_row", { tbl: "accounts", row_id, patch, appends: {} });
const drop = id => sql(`delete from public.accounts where org_id = $1 and id = $2`, [ORG_A, id]);

test("a non-admin cannot change csm, csmSince or leadId on an existing account", async () => {
  const id = "own-1";
  try {
    await seedRow("accounts", id, { name: "Own Co", csm: "Admin User" });
    for (const patch of [{ csm: "Plain User" }, { csmSince: "2026-01-01" }, { leadId: "someone" }]) {
      const r = await merge("user", id, patch);
      assert(r.error && MSG.test(r.error.message), `non-admin change ${JSON.stringify(patch)} not blocked: ${JSON.stringify(r)}`);
    }
    assert((await valueOf("accounts", id)).csm === "Admin User", "csm changed despite the block");
    const ok = await merge("admin", id, { csm: "Plain User", csmSince: "2026-10-13" });
    assert(!ok.error, `control: admin change failed: ${ok.error?.message}`);
    assert((await valueOf("accounts", id)).csm === "Plain User", "admin change did not land");
  } finally { await drop(id); }
});

test("CSM edits ARR on an account owned by another CSM, sending the unchanged csm too", async () => {
  const id = "own-2";
  try {
    await seedRow("accounts", id, { name: "Other Co", csm: "Admin User", arr: 1 });
    const r = await merge("user", id, { arr: 2, csm: "Admin User" });
    assert(!r.error, `unrelated edit with unchanged csm was blocked: ${r.error?.message}`);
    assert((await valueOf("accounts", id)).arr === 2, "edit did not land");
  } finally { await drop(id); }
});

test("a non-admin may create an account owned by themselves or nobody, not by someone else", async () => {
  try {
    const bad = await merge("user", "own-3", { name: "Theirs", csm: "Admin User" });
    assert(bad.error && MSG.test(bad.error.message), "created an account owned by someone else");
    const lead = await merge("user", "own-4", { name: "Lead", leadId: "x" });
    assert(lead.error && MSG.test(lead.error.message), "created an account with a leadId");
    const mine = await merge("user", "own-5", { name: "Mine", csm: "Plain User", csmSince: "2026-10-13" });
    assert(!mine.error, `control: self-owned create failed: ${mine.error?.message}`);
    const none = await merge("user", "own-6", { name: "Nobody" });
    assert(!none.error, `control: unowned create failed: ${none.error?.message}`);
  } finally { for (const id of ["own-3", "own-4", "own-5", "own-6"]) await drop(id); }
});

test("operator context (no auth.uid) can change owners", async () => {
  const id = "own-7";
  try {
    await seedRow("accounts", id, { name: "Ops Co", csm: "Admin User" });
    await sql(`update public.accounts set data = data || '{"csm":"Plain User"}' where org_id = $1 and id = $2`, [ORG_A, id]);
    assert((await valueOf("accounts", id)).csm === "Plain User", "operator update blocked");
  } finally { await drop(id); }
});
