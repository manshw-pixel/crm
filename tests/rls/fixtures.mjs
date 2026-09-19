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

// The default org that supabase-setup.sql creates and stamps existing data with. Fixed
// uuid so tests and the backfill can name it without a lookup.
export const ORG_A = "00000000-0000-0000-0000-000000000001";
export const ORG_B = "00000000-0000-0000-0000-000000000002";

// The CLI's local anon key is public and not a secret — but it is NOT fixed. This literal
// is a stale key from an older CLI, kept only as a local convenience; newer stacks reject
// it outright. CI exports SUPABASE_ANON_KEY from `supabase status -o json`, and
// assertAnonIsAnonymous() below fails the run rather than let a rejected token pass for a
// working policy. If you run this locally, export the key too.
export const ANON_KEY = process.env.SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwiZXhwIjoxOTgzODEyOTk2fQ.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const SETUP_SQL = fileURLToPath(new URL("../../supabase-setup.sql", import.meta.url));
const ALERTS_SQL = fileURLToPath(new URL("../../email-alerts.sql", import.meta.url));

// Exported so a test can attempt a sign-in with a client that never had a session on it in
// the first place -- sessions.admin/sessions.user already have their own tokens cached and
// aren't suitable for probing a DIFFERENT address's credentials.
export const newClient = () => createClient(API_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const sessions = { admin: null, user: null, adminB: null, userB: null, platform: null, anon: newClient() };

// Drop and rebuild from supabase-setup.sql. Dropping auth.users too keeps sign-up
// deterministic: a stale user from a previous run would make signUp() throw "already
// registered" and leave its old profile (and org) in place.
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
    // The alert layer lives in its own file because it needs pg_cron/pg_net and a
    // hand-pasted API key. It still has to be applied here, or every builder test would
    // fail with "function does not exist" and look like a bug in the test rather than a
    // missing file.
    await client.query(readFileSync(ALERTS_SQL, "utf8"));
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

// Two orgs, two people each, plus a platform admin who starts inside org A. Every user is
// INVITED first: handle_new_user() attaches a sign-up to an org only through a pending
// invite, so an ad-hoc sign-up here would land with no org and read nothing.
//
// The platform admin is invited as 'user', not 'admin': the platform RPCs gate on
// platform_admin, not role, and a second org-A admin would make the "last admin" guard
// tests in auth.test.mjs pass for the wrong reason (or fail).
export async function bootstrap() {
  await resetStack();
  await sql(`insert into orgs (id, name) values ($1, 'Org B') on conflict (id) do nothing`, [ORG_B]);
  await sql(`insert into settings (org_id, data) values ($1, '{}') on conflict (org_id) do nothing`, [ORG_B]);
  // org_alert_prefs is created by email-alerts.sql (Task 5); until then the table is absent.
  await sql(`do $$ begin
    if to_regclass('public.org_alert_prefs') is not null then
      insert into org_alert_prefs (org_id) values ('${ORG_B}') on conflict (org_id) do nothing;
    end if; end $$`);
  await sql(`insert into invites (email, org_id, role) values
    ('admin@test.local',    $1, 'admin'),
    ('user@test.local',     $1, 'user'),
    ('adminb@test.local',   $2, 'admin'),
    ('userb@test.local',    $2, 'user'),
    ('platform@test.local', $1, 'user')`, [ORG_A, ORG_B]);
  const admin    = await signUp("admin@test.local", "Admin User");
  const user     = await signUp("user@test.local", "Plain User");
  const adminB   = await signUp("adminb@test.local", "Admin B");
  const userB    = await signUp("userb@test.local", "Plain B");
  const platform = await signUp("platform@test.local", "Platform Owner");
  // The flag cannot be granted through the API (guard_profile_org), only by SQL.
  await sql(`update profiles set platform_admin = true where id = $1`, [platform.id]);
  sessions.admin = admin.client;   sessions.user = user.client;
  sessions.adminB = adminB.client; sessions.userB = userB.client;
  sessions.platform = platform.client;
  sessions.anon = newClient();
  await assertAnonIsAnonymous();
  await purgeAttachments();
  return { adminId: admin.id, userId: user.id, adminBId: adminB.id, userBId: userB.id, platformId: platform.id };
}

// The five anonymous tests are all of the form "the anon client got nothing back". That
// shape passes for the RIGHT reason (no policy grants anon anything) and for a WORTHLESS
// one (the gateway threw the request out before consulting a policy at all).
//
// It really happened: the anon key below went stale, every anon request returned PGRST301
// "None of the keys was able to decode the JWT", and all five tests passed anyway. The
// falsification sweep caught it — disabling RLS on accounts outright did not turn the
// anonymous read test red, because that test was never reaching RLS.
//
// So prove the anon client is a VALID client that policy denies, not a broken one.
async function assertAnonIsAnonymous() {
  const { error } = await sessions.anon.from("accounts").select("id").limit(1);
  // PGRST301/PGRST302 are "your token is unusable". Anything else — including a clean
  // empty result, which is what correct policies produce — means the request was actually
  // evaluated, and that is all this guard cares about.
  if (error && String(error.code).startsWith("PGRST30")) {
    throw new Error(
      `The anonymous client's key was rejected (${error.code}: ${error.message}). `
      + "Every anonymous test would pass vacuously against a rejected token, so the suite "
      + "refuses to run. Set SUPABASE_ANON_KEY from `supabase status -o json`."
    );
  }
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
  // Both the org-prefixed layout (Task 4) and the legacy flat `rls/` prefix: until the
  // storage policies move to org prefixes, the existing storage tests still write `rls/`.
  const targets = [[sessions.admin, `${ORG_A}/rls`], [sessions.adminB, `${ORG_B}/rls`], [sessions.admin, "rls"]];
  for (const [session, prefix] of targets) {
    const { data, error } = await session.storage.from("attachments").list(prefix);
    // A missing bucket or an empty prefix is the normal case on a fresh stack, not a failure.
    if (error || !data?.length) continue;
    await session.storage.from("attachments").remove(data.map(f => `${prefix}/${f.name}`));
  }
}

let fresh = 0;
// `name: null` signs up with NO name metadata, so handle_new_user() falls back to the
// email prefix — which is the branch the fourth auth test exercises.
export async function signUpFresh(email, name = "Fresh User") {
  return signUp(email || `fresh${++fresh}@test.local`, name);
}

// A fresh sign-up that lands in `org` as a plain user. An uninvited sign-up has no org and
// reads nothing, so any test whose precondition is "this user CAN do X" must use this.
export async function invitedFresh(email, org = ORG_A) {
  await sql(`insert into invites (email, org_id, role) values ($1, $2, 'user')`, [email, org]);
  return signUpFresh(email);
}

// Read by SQL: an org admin's session can no longer see another org's profiles.
export async function roleOf(id) {
  const [row] = await sql(`select role from profiles where id = $1`, [id]);
  return row?.role ?? null;
}
export async function orgOf(id) {
  const [row] = await sql(`select org_id from profiles where id = $1`, [id]);
  return row?.org_id ?? null;
}

// Read-backs run by SQL on purpose. A denied delete or update returns no error, so the
// only way to know it was denied is to look at the row with a session that can see it --
// and only the superuser sees every org.
export async function stillExists(table, id, org = ORG_A) {
  const rows = await sql(`select id from public.${table} where org_id = $1 and id = $2`, [org, id]);
  return rows.length > 0;
}

export async function valueOf(table, id, org = ORG_A) {
  const [row] = await sql(`select data from public.${table} where org_id = $1 and id = $2`, [org, id]);
  return row?.data ?? null;
}

// Insert a row through the API (default: org A's admin) for a test to then attack.
export async function seedRow(table, id, data = { name: "Seeded" }, session = sessions.admin) {
  const { error } = await session.from(table).insert({ id, data });
  if (error) throw new Error(`seedRow(${table}, ${id}) failed: ${error.message}`);
}

// Raw SQL as the `postgres` superuser. Builders are revoked from `authenticated` on
// purpose, so PostgREST cannot reach them and the suite must not try.
export async function sql(text, params = []) {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const { rows } = await client.query(text, params);
    return rows;
  } finally {
    await client.end();
  }
}

// Seed a JSONB row directly. seedRow() goes through PostgREST as admin; these go through
// SQL so a test can seed rows a policy would refuse, and so dates land unambiguously.
const seedEntity = table => (id, data, org = ORG_A) => sql(
  `insert into public.${table} (org_id, id, data) values ($1, $2, $3)
   on conflict (org_id, id) do update set data = excluded.data`, [org, id, data]);
export const seedAccount  = seedEntity("accounts");
export const seedTask     = seedEntity("tasks");
export const seedActivity = seedEntity("activities");
