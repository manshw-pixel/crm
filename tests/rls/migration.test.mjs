// Proves supabase-setup.sql migrates a database created by the PRE-multitenant file: rows,
// users and settings all land in the default org and nothing is lost. Runs LAST in run.mjs
// and rebuilds the stack itself, so it must not share fixtures state with earlier files.
//
// Why last, and why it ends in bootstrap(): it drops the public schema and auth.users, which
// invalidates every shared session. Running last means no later file sees that; the
// bootstrap() in `finally` still puts the stack back in the normal fixture state, so adding a
// file after this one (or re-running locally) does not inherit a half-migrated database.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, assert } from "../health/framework.mjs";
import { sql, bootstrap, newClient, PASSWORD, ORG_A, ORG_B } from "./fixtures.mjs";

const OLD = readFileSync(fileURLToPath(new URL("./pre-multitenant-setup.sql", import.meta.url)), "utf8");
const NEW = readFileSync(fileURLToPath(new URL("../../supabase-setup.sql", import.meta.url)), "utf8");
const ALERTS = readFileSync(fileURLToPath(new URL("../../email-alerts.sql", import.meta.url)), "utf8");

const ENTITY_TABLES = ["accounts", "contacts", "activities", "tasks", "opportunities"];
const LEGACY_DIR = "legacy-mig";
const LEGACY_PATH = `${LEGACY_DIR}/contract.pdf`;
const LEGACY_URL = `http://127.0.0.1:54321/storage/v1/object/public/attachments/${LEGACY_PATH}`;
const att = { name: "contract.pdf", url: LEGACY_URL, path: LEGACY_PATH };

// PostgREST caches the schema; after swapping it underneath, poll until it answers.
async function reloadSchema() {
  await sql(`notify pgrst, 'reload schema'`);
  const probe = newClient();
  for (let i = 0; i < 50; i++) {
    const { error } = await probe.from("accounts").select("id").limit(1);
    if (!error || error.code !== "PGRST205") return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("PostgREST never picked up the reloaded schema after 10s");
}

async function signUpVia(email, name) {
  const client = newClient();
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD, options: { data: { name } } });
  if (error) throw new Error(`signUp(${email}) failed: ${error.message}`);
  if (!data.session) throw new Error(`signUp(${email}) returned no session`);
  return { client, id: data.user.id };
}

// crm.html's fetchAll(), verbatim in shape. Pre-multitenant it read settings with
// .eq("id", 1); that column is gone, and RLS now scopes the row to the caller's org, so the
// post-migration query drops the filter. Rows are sorted so order is not compared.
async function loadQuery(client, { legacySettings }) {
  const settingsQ = client.from("settings").select("data");
  const res = await Promise.all([
    ...ENTITY_TABLES.map(t => client.from(t).select("data")),
    legacySettings ? settingsQ.eq("id", 1) : settingsQ,
    client.from("profiles").select("id,name,role,disabled"),
  ]);
  const bad = res.find(r => r.error);
  if (bad) throw new Error(`load query failed: ${bad.error.message}`);
  const sortBy = (rows, k) => [...rows].sort((a, b) => JSON.stringify(k(a)).localeCompare(JSON.stringify(k(b))));
  const out = {};
  ENTITY_TABLES.forEach((t, i) => { out[t] = sortBy(res[i].data.map(x => x.data), x => x.id); });
  out.settings = res[5].data.map(x => x.data);
  out.profiles = sortBy(res[6].data, x => x.id);
  return out;
}

// Every row of every migrated table, as the superuser sees it. Used for count equality and
// for the idempotency check (a second run must not change a single byte).
async function snapshot() {
  const snap = {};
  for (const t of ENTITY_TABLES) snap[t] = await sql(`select org_id, id, data from public.${t} order by id`);
  snap.settings = await sql(`select org_id, data from public.settings order by org_id`);
  snap.profiles = await sql(`select id, org_id, name, role, disabled, platform_admin from public.profiles order by id`);
  snap.health = await sql(`select org_id, account_id, day::text, score from public.health_snapshots order by account_id, day`);
  snap.errors = await sql(`select org_id, fingerprint, level, message, count from public.error_log order by fingerprint`);
  snap.orgs = await sql(`select id, name from public.orgs order by id`);
  snap.prefs = await sql(`select * from public.org_alert_prefs order by org_id`);
  return snap;
}

const listNames = async (client, prefix) => {
  const { data, error } = await client.storage.from("attachments").list(prefix);
  if (error) throw new Error(`list ${prefix} failed: ${error.message}`);
  return (data || []).map(f => f.name);
};

test("migration: pre-multitenant data lands in the default org intact", async () => {
  try {
    await sql(`drop schema if exists public cascade; create schema public;
      grant usage, create on schema public to postgres, anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
      delete from auth.users;`);
    await sql(OLD);
    await reloadSchema();

    // ---- seed a realistic single-org database with the OLD file ----
    await sql(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
               values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                       'legacy@test.local', '', now(), '{"name":"Legacy Admin"}', now(), now())`);
    // A second legacy user signed up through GoTrue, so it has a real password and session.
    // Not the first profile, so the OLD handle_new_user makes it a plain user.
    const legacy = await signUpVia("legacy-user@test.local", "Legacy User");
    await sql(`insert into accounts (id, data) values
      ('old-1', $1), ('old-2', '{"id":"old-2","name":"Old Two"}')`,
      [{ id: "old-1", name: "Old One", documents: [att] }]);
    await sql(`insert into tasks (id, data) values ('t-1', $1)`, [{ id: "t-1", title: "Old task", attachments: [att] }]);
    await sql(`insert into activities (id, data) values ('act-1', $1)`, [{ id: "act-1", accountId: "old-1", attachments: [att] }]);
    await sql(`insert into contacts (id, data) values ('c-1', '{"id":"c-1","name":"Old Contact"}')`);
    await sql(`insert into opportunities (id, data) values ('o-1', '{"id":"o-1","name":"Old Opp"}')`);
    await sql(`insert into settings (id, data) values (1, '{"rates":{"INR":0.5}}')`);
    await sql(`insert into health_snapshots (account_id, day, score) values ('old-1', current_date, 70)`);
    await sql(`insert into error_log (fingerprint, level, message) values ('fp-legacy', 'crash', 'old crash')`);
    // A legacy storage object in the OLD un-prefixed layout. Catalogue row only: listing and
    // deleting read the catalogue, and SQL cannot insert a blob.
    await sql(`insert into storage.objects (bucket_id, name) values ('attachments', $1) on conflict do nothing`, [LEGACY_PATH]);

    const before = await snapshot0();
    const loadBefore = await loadQuery(legacy.client, { legacySettings: true });
    assert(loadBefore.accounts.length === 2 && loadBefore.settings.length === 1 && loadBefore.profiles.length === 2,
      `precondition: the legacy user reads the old data: ${JSON.stringify(loadBefore)}`);

    // ---- migrate ----
    await sql(NEW);
    await sql(ALERTS);
    await reloadSchema();

    const accts = await sql(`select org_id, id from accounts order by id`);
    assert(accts.length === 2 && accts.every(r => r.org_id === ORG_A), `accounts not stamped: ${JSON.stringify(accts)}`);
    const [task] = await sql(`select org_id from tasks where id = 't-1'`);
    assert(task.org_id === ORG_A, "task not stamped");
    const [settings] = await sql(`select org_id, data from settings`);
    assert(settings.org_id === ORG_A && settings.data.rates.INR === 0.5, `settings lost: ${JSON.stringify(settings)}`);
    const [hs] = await sql(`select org_id from health_snapshots where account_id = 'old-1'`);
    assert(hs.org_id === ORG_A, "health snapshot not stamped");
    const [prof] = await sql(`select org_id, role, platform_admin from profiles where id = '11111111-1111-1111-1111-111111111111'`);
    assert(prof.org_id === ORG_A && prof.role === "admin", `legacy admin lost: ${JSON.stringify(prof)}`);
    const pk = await sql(`select array_length(conkey, 1) as n from pg_constraint where conrelid = 'public.accounts'::regclass and contype = 'p'`);
    assert(pk[0].n === 2, "accounts primary key was not swapped to (org_id, id)");
    const prefs = await sql(`select 1 from org_alert_prefs where org_id = $1`, [ORG_A]);
    assert(prefs.length === 1, "default org has no alert prefs after migration");

    // Every row of every table is in ORG_A, and nothing was lost or duplicated.
    const after = await snapshot();
    for (const t of [...ENTITY_TABLES, "settings", "profiles", "health", "errors"]) {
      assert(after[t].length === before[t].length, `${t}: ${before[t].length} rows before, ${after[t].length} after`);
      assert(after[t].every(r => r.org_id === ORG_A), `${t}: a row missed the default org: ${JSON.stringify(after[t])}`);
    }
    for (const t of ENTITY_TABLES) {
      assert(JSON.stringify(after[t].map(r => [r.id, r.data])) === JSON.stringify(before[t].map(r => [r.id, r.data])),
        `${t}: row data changed in migration`);
    }
    // Attachment links are deliberately NOT rewritten (Task 4 ruling): the objects were not moved.
    const [a1] = await sql(`select data from accounts where id = 'old-1'`);
    const [t1] = await sql(`select data from tasks where id = 't-1'`);
    const [ac1] = await sql(`select data from activities where id = 'act-1'`);
    for (const [where, list] of [["accounts.documents", a1.data.documents], ["tasks.attachments", t1.data.attachments],
                                 ["activities.attachments", ac1.data.attachments]]) {
      assert(list?.length === 1 && list[0].path === LEGACY_PATH && list[0].url === LEGACY_URL,
        `${where} was re-pathed or lost: ${JSON.stringify(list)}`);
    }
    const [obj] = await sql(`select count(*)::int as n from storage.objects where bucket_id = 'attachments' and name = $1`, [LEGACY_PATH]);
    assert(obj.n === 1, "the legacy storage object was moved or removed by the migration");

    // ---- idempotency: running both files again changes nothing ----
    await sql(NEW);
    await sql(ALERTS);
    await reloadSchema();
    const again = await snapshot();
    assert(JSON.stringify(again) === JSON.stringify(after), "re-running the files changed data");

    // ---- the existing user, signed in, still reads everything; the load query is unchanged ----
    const { error: siErr } = await legacy.client.auth.signInWithPassword({ email: "legacy-user@test.local", password: PASSWORD });
    assert(!siErr, `legacy user cannot sign in after migration: ${siErr && siErr.message}`);
    const loadAfter = await loadQuery(legacy.client, { legacySettings: false });
    assert(JSON.stringify(loadAfter) === JSON.stringify(loadBefore),
      `the app's load query changed:\nbefore ${JSON.stringify(loadBefore)}\nafter  ${JSON.stringify(loadAfter)}`);

    // ---- an uninvited sign-up is org-less and reads nothing ----
    const stranger = await signUpVia("stranger-mig@test.local", "Stranger");
    const [sp] = await sql(`select org_id from profiles where id = $1`, [stranger.id]);
    assert(sp && sp.org_id === null, `uninvited sign-up joined an org: ${JSON.stringify(sp)}`);
    const { data: sAcc, error: sErr } = await stranger.client.from("accounts").select("id");
    assert(!sErr && sAcc.length === 0, `uninvited sign-up read accounts: ${JSON.stringify(sAcc)} ${sErr && sErr.message}`);
    const { data: ctl } = await legacy.client.from("accounts").select("id");
    assert(ctl?.length === 2, "control: the legacy user should read both accounts");
    assert((await listNames(stranger.client, LEGACY_DIR)).length === 0, "uninvited sign-up listed a legacy file");

    // ---- legacy un-prefixed storage: default org keeps it, another org cannot touch it ----
    await sql(`insert into orgs (id, name) values ($1, 'Org B') on conflict (id) do nothing`, [ORG_B]);
    await sql(`insert into invites (email, org_id, role) values ('orgb-mig@test.local', $1, 'user')`, [ORG_B]);
    const other = await signUpVia("orgb-mig@test.local", "Org B User");
    assert((await listNames(legacy.client, LEGACY_DIR)).includes("contract.pdf"), "default org cannot list its legacy file");
    assert(!(await listNames(other.client, LEGACY_DIR)).includes("contract.pdf"), "LEAK: another org listed a legacy file");
    await other.client.storage.from("attachments").remove([LEGACY_PATH]);
    const [still] = await sql(`select count(*)::int as n from storage.objects where bucket_id = 'attachments' and name = $1`, [LEGACY_PATH]);
    assert(still.n === 1, "another org deleted a legacy default-org file");
    await legacy.client.storage.from("attachments").remove([LEGACY_PATH]);
    const [gone] = await sql(`select count(*)::int as n from storage.objects where bucket_id = 'attachments' and name = $1`, [LEGACY_PATH]);
    assert(gone.n === 0, "the default org could not delete its legacy file");
  } finally {
    await bootstrap();   // leave the stack in the normal fixture state
  }
});

// Pre-migration snapshot: the old schema has no org_id, orgs or prefs, so pretend every row
// carries ORG_A-to-be only for the shape comparison (counts and data are what is compared).
async function snapshot0() {
  const snap = {};
  for (const t of ENTITY_TABLES) snap[t] = await sql(`select id, data from public.${t} order by id`);
  snap.settings = await sql(`select data from public.settings`);
  snap.profiles = await sql(`select id from public.profiles order by id`);
  snap.health = await sql(`select account_id from public.health_snapshots`);
  snap.errors = await sql(`select fingerprint from public.error_log`);
  return snap;
}
