// The attachments bucket. NOTE the bucket is created with `public = true`, so objects are
// readable by URL with NO auth at all — deliberate per the comment in supabase-setup.sql,
// and pinned below rather than asserted away. See finding F5 in the spec.
import { test, assert } from "../health/framework.mjs";
import { sessions, API_URL } from "./fixtures.mjs";

const body = () => new Blob(["hello"], { type: "text/plain" });

test("an authenticated user can upload to attachments", async () => {
  const { error } = await sessions.user.storage.from("attachments").upload("rls/user-upload.txt", body(), { upsert: true });
  assert(!error, `upload failed: ${error && error.message}`);
});

test("an authenticated user can list attachments", async () => {
  const { data, error } = await sessions.user.storage.from("attachments").list("rls");
  assert(!error, `list failed: ${error && error.message}`);
  assert((data || []).some(f => f.name === "user-upload.txt"), `expected the uploaded file, got ${JSON.stringify(data)}`);
});

// DOCUMENTS CURRENT BEHAVIOUR — see finding F2. attachments_delete checks only the bucket
// id, so any authenticated user can delete anyone's file.
test("any authenticated user CAN delete another user's attachment (documents finding F2)", async () => {
  await sessions.admin.storage.from("attachments").upload("rls/admin-upload.txt", body(), { upsert: true });
  const { error } = await sessions.user.storage.from("attachments").remove(["rls/admin-upload.txt"]);
  assert(!error, `remove errored: ${error && error.message}`);
  const { data } = await sessions.admin.storage.from("attachments").list("rls");
  assert(!(data || []).some(f => f.name === "admin-upload.txt"),
    "today's policy lets any user delete any file; this test pins that");
});

test("an anonymous client cannot upload", async () => {
  const { error } = await sessions.anon.storage.from("attachments").upload("rls/anon.txt", body());
  assert(error, "an anonymous upload must be rejected");
});

test("an anonymous client cannot delete", async () => {
  await sessions.user.storage.from("attachments").upload("rls/keepme.txt", body(), { upsert: true });
  await sessions.anon.storage.from("attachments").remove(["rls/keepme.txt"]);
  const { data } = await sessions.admin.storage.from("attachments").list("rls");
  assert((data || []).some(f => f.name === "keepme.txt"), "an anonymous client deleted a file");
});

// DOCUMENTS CURRENT BEHAVIOUR — see finding F5. The bucket is PUBLIC: uploaded customer
// documents are readable by anyone holding the URL, with no session.
test("anyone with the URL can read an attachment (documents finding F5)", async () => {
  await sessions.user.storage.from("attachments").upload("rls/public.txt", body(), { upsert: true });
  const res = await fetch(`${API_URL}/storage/v1/object/public/attachments/rls/public.txt`);
  assert(res.status === 200, `the bucket is public, so an unauthenticated fetch should succeed, got ${res.status}`);
  assert((await res.text()) === "hello", "the public URL should return the file contents");
});
