// The attachments bucket. NOTE the bucket is created with `public = true`, so objects are
// readable by URL with NO auth at all — deliberate per the comment in supabase-setup.sql,
// and pinned below rather than asserted away. See finding F5 in the spec.
//
// Every object lives under <org_id>/...; the first path segment must be the caller's org.
// Legacy objects (no org prefix) stay readable/deletable by the default org (ORG_A) only.
import { test, assert } from "../health/framework.mjs";
import { sessions, API_URL, ORG_A, ORG_B, sql } from "./fixtures.mjs";

const body = () => new Blob(["hello"], { type: "text/plain" });
const A = `${ORG_A}/rls`;
const B = `${ORG_B}/rls`;
const names = async (session, prefix) => {
  const { data, error } = await session.storage.from("attachments").list(prefix);
  if (error) throw new Error(`list ${prefix} failed: ${error.message}`);
  return (data || []).map(f => f.name);
};

test("an authenticated user can upload to attachments", async () => {
  const { error } = await sessions.user.storage.from("attachments").upload(`${A}/user-upload.txt`, body(), { upsert: true });
  assert(!error, `upload failed: ${error && error.message}`);
});

test("an authenticated user can list attachments", async () => {
  assert((await names(sessions.user, A)).includes("user-upload.txt"), "expected the uploaded file");
});

// DOCUMENTS CURRENT BEHAVIOUR — see finding F2. Within an org, attachments_delete checks
// only the org prefix, so any user can delete a colleague's file.
test("any authenticated user CAN delete another same-org user's attachment (documents finding F2)", async () => {
  await sessions.admin.storage.from("attachments").upload(`${A}/admin-upload.txt`, body(), { upsert: true });
  assert((await names(sessions.admin, A)).includes("admin-upload.txt"), "precondition: admin's upload landed");
  const { error } = await sessions.user.storage.from("attachments").remove([`${A}/admin-upload.txt`]);
  assert(!error, `remove errored: ${error && error.message}`);
  assert(!(await names(sessions.admin, A)).includes("admin-upload.txt"),
    "today's policy lets any same-org user delete any file; this test pins that");
});

test("an anonymous client cannot upload", async () => {
  const { error } = await sessions.anon.storage.from("attachments").upload(`${A}/anon.txt`, body());
  assert(error, "an anonymous upload must be rejected");
});

test("an anonymous client cannot delete", async () => {
  await sessions.user.storage.from("attachments").upload(`${A}/keepme.txt`, body(), { upsert: true });
  assert((await names(sessions.admin, A)).includes("keepme.txt"), "precondition: the file exists");
  await sessions.anon.storage.from("attachments").remove([`${A}/keepme.txt`]);
  assert((await names(sessions.admin, A)).includes("keepme.txt"), "an anonymous client deleted a file");
});

// DOCUMENTS CURRENT BEHAVIOUR — see finding F5. The bucket is PUBLIC: uploaded customer
// documents are readable by anyone holding the URL, with no session.
test("anyone with the URL can read an attachment (documents finding F5)", async () => {
  await sessions.user.storage.from("attachments").upload(`${A}/public.txt`, body(), { upsert: true });
  const res = await fetch(`${API_URL}/storage/v1/object/public/attachments/${A}/public.txt`);
  assert(res.status === 200, `the bucket is public, so an unauthenticated fetch should succeed, got ${res.status}`);
  assert((await res.text()) === "hello", "the public URL should return the file contents");
});

test("a user cannot upload under another org's prefix", async () => {
  const { error } = await sessions.user.storage.from("attachments").upload(`${B}/cross.txt`, body(), { upsert: true });
  assert(error, "upload into org B's prefix should be refused");
  // Read back with org B's admin, who can see that prefix: nothing landed.
  assert(!(await names(sessions.adminB, B)).includes("cross.txt"), "org A's upload landed in org B's prefix");
});

test("a user cannot list or delete another org's files", async () => {
  const { error } = await sessions.adminB.storage.from("attachments").upload(`${B}/b-only.txt`, body(), { upsert: true });
  assert(!error, `precondition: org B's upload failed: ${error && error.message}`);
  assert((await names(sessions.adminB, B)).includes("b-only.txt"), "precondition: org B can list its own file");
  const { data } = await sessions.user.storage.from("attachments").list(B);
  assert(!(data || []).some(f => f.name === "b-only.txt"), "LEAK: org A listed org B's file");
  await sessions.user.storage.from("attachments").remove([`${B}/b-only.txt`]);
  assert((await names(sessions.adminB, B)).includes("b-only.txt"), "org A deleted org B's file");
});

// F20: the title claims only what is asserted: a refused upload, confirmed by a read-back
// with sessions.user, which (as the default org) CAN see un-prefixed paths.
test("an upload outside the org prefix is refused", async () => {
  const { error } = await sessions.user.storage.from("attachments").upload("rls-new/legacy.txt", body(), { upsert: true });
  assert(error, "an upload outside the org prefix should be refused");
  assert(!(await names(sessions.user, "rls-new")).includes("legacy.txt"), "the refused upload landed anyway");
});

// Pre-multitenant objects are NOT moved (renaming a storage.objects row orphans its blob);
// the default org keeps read/delete on them. Seeded as a catalogue row by SQL, because the
// API now refuses an un-prefixed upload. Listing reads only the catalogue, so no blob needed.
test("a legacy un-prefixed object is visible and deletable by the default org only", async () => {
  await sql(`insert into storage.objects (bucket_id, name) values ('attachments', 'rls/legacy-seed.txt')
             on conflict do nothing`);
  assert((await names(sessions.user, "rls")).includes("legacy-seed.txt"), "the default org cannot see its legacy file");
  const { data: bSees } = await sessions.adminB.storage.from("attachments").list("rls");
  assert(!(bSees || []).some(f => f.name === "legacy-seed.txt"), "LEAK: org B listed a legacy default-org file");
  await sessions.adminB.storage.from("attachments").remove(["rls/legacy-seed.txt"]);
  assert((await names(sessions.user, "rls")).includes("legacy-seed.txt"), "org B deleted a legacy default-org file");
  await sessions.user.storage.from("attachments").remove(["rls/legacy-seed.txt"]);
  const [row] = await sql(`select count(*)::int as n from storage.objects
                           where bucket_id = 'attachments' and name = 'rls/legacy-seed.txt'`);
  assert(row.n === 0, "the default org could not delete its legacy file");
});
