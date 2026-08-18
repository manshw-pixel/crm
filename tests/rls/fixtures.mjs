// Fixtures for the RLS suite. Unlike tests/health, NOTHING here is mocked: this talks to a
// real local Postgres + GoTrue + Storage brought up by `supabase start`, with the real
// supabase-setup.sql applied. See docs/superpowers/specs/2026-08-17-rls-auth-tests-design.md
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

export const API_URL = process.env.SUPABASE_API_URL || "http://127.0.0.1:54321";
export const DB_URL = process.env.SUPABASE_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const PASSWORD = "test-password-123";

// The CLI's local anon key is fixed and public — it is not a secret and must not be
// treated as one. `supabase status -o json` reports it if this ever changes.
export const ANON_KEY = process.env.SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwiZXhwIjoxOTgzODEyOTk2fQ.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const SETUP_SQL = fileURLToPath(new URL("../../supabase-setup.sql", import.meta.url));

const newClient = () => createClient(API_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const sessions = { admin: null, user: null, anon: newClient() };

// Drop and rebuild from supabase-setup.sql. Dropping auth.users too is what makes the
// first-signup-becomes-admin trigger testable: handle_new_user() checks for an EMPTY
// profiles table, so a stale user from a previous run would silently change the outcome.
export async function resetStack() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    // One multi-statement query: node-postgres uses the simple query protocol for a
    // string with no parameters, which permits several statements in one call.
    //
    // The `alter default privileges` lines are NOT ceremony. Supabase grants those
    // defaults against the schema named `public`; dropping the schema drops them with it,
    // so tables created by supabase-setup.sql below would have no grants for `anon` or
    // `authenticated` at all. PostgREST would then answer every request — admin's
    // included — with "permission denied for table", and the whole suite would fail in a
    // way that looks like a policy bug but is really a missing GRANT.
    await client.query(`
      drop schema if exists public cascade;
      create schema public;
      grant usage, create on schema public to postgres, anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
      delete from auth.users;
    `);
    await client.query(readFileSync(SETUP_SQL, "utf8"));
    // PostgREST caches the schema. Without this the tables we just recreated come back as
    // PGRST205 "Could not find the table in the schema cache" on the very first request.
    await client.query(`notify pgrst, 'reload schema';`);
  } finally {
    await client.end();
  }
  await waitForSchemaReload();
}

// The NOTIFY above is asynchronous — PostgREST reloads a moment later. Poll a known table
// until it answers rather than sleeping a guessed interval.
async function waitForSchemaReload() {
  const probe = newClient();
  for (let i = 0; i < 50; i++) {
    const { error } = await probe.from("accounts").select("id").limit(1);
    // Any answer other than "I don't know that table" means the cache is current. An RLS
    // denial is a perfectly good answer here: it proves the table is visible to PostgREST.
    if (!error || error.code !== "PGRST205") return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("PostgREST never picked up the reloaded schema after 10s");
}

async function signUp(email, name) {
  const client = newClient();
  const { data, error } = await client.auth.signUp({
    email, password: PASSWORD, options: { data: name ? { name } : {} },
  });
  if (error) throw new Error(`signUp(${email}) failed: ${error.message}`);
  if (!data.session) throw new Error(`signUp(${email}) returned no session — is enable_confirmations still false in supabase/config.toml?`);
  return { client, id: data.user.id };
}

// ORDER MATTERS AND IS ASSERTED, NOT ASSUMED. handle_new_user() makes the first signup
// against an empty profiles table an admin. A suite that signed users up ad hoc would pass
// or fail on test ordering, so the two canonical users are created here, in this order.
export async function bootstrap() {
  await resetStack();
  const admin = await signUp("admin@test.local", "Admin User");
  const user = await signUp("user@test.local", "Plain User");
  sessions.admin = admin.client;
  sessions.user = user.client;
  sessions.anon = newClient();
  await purgeAttachments();
  return { adminId: admin.id, userId: user.id };
}

// Storage is NOT reset by resetStack, and cannot be: Postgres rejects
// `delete from storage.objects` outright with "Direct deletion from storage tables is not
// allowed. Use the Storage API instead." — a trigger Supabase installs on the table, which
// fires for the superuser too. That statement was in resetStack and it aborted the whole
// reset transaction, so bootstrap threw and not one of the 25 tests ever ran.
//
// So the bucket is emptied through the API, which is what that error asks for, and it has
// to happen AFTER signup because the API needs a session. `drop schema public` never
// touched storage anyway — the bucket and its objects live in the `storage` schema and
// survive a reset, which is exactly why this purge is needed for a repeated local run.
async function purgeAttachments() {
  const { data, error } = await sessions.admin.storage.from("attachments").list("rls");
  // A missing bucket or an empty prefix is the normal case on a fresh stack, not a failure.
  if (error || !data?.length) return;
  await sessions.admin.storage.from("attachments").remove(data.map(f => `rls/${f.name}`));
}

let fresh = 0;
// `name: null` signs up with NO name metadata, so handle_new_user() falls back to the
// email prefix — which is the branch the fourth auth test exercises.
export async function signUpFresh(email, name = "Fresh User") {
  return signUp(email || `fresh${++fresh}@test.local`, name);
}

export async function roleOf(id) {
  const { data } = await sessions.admin.from("profiles").select("role").eq("id", id).single();
  return data?.role ?? null;
}

// Read-backs run AS ADMIN on purpose. A denied delete or update returns no error, so the
// only way to know it was denied is to look at the row with a session that can see it.
export async function stillExists(table, id) {
  const { data } = await sessions.admin.from(table).select("id").eq("id", id);
  return (data || []).length > 0;
}

export async function valueOf(table, id) {
  const { data } = await sessions.admin.from(table).select("data").eq("id", id).single();
  return data?.data ?? null;
}

// Insert a row as admin for a test to then attack as a plain user.
export async function seedRow(table, id, data = { name: "Seeded" }) {
  const { error } = await sessions.admin.from(table).insert({ id, data });
  if (error) throw new Error(`seedRow(${table}, ${id}) failed: ${error.message}`);
}
