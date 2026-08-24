// Email alerts against a REAL Postgres. The alert functions are called directly with a
// superuser connection rather than through PostgREST because execute is revoked from
// `public`, `anon` AND `authenticated` -- the closing tests at the bottom of this file
// prove that revocation holds for both published API roles.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, seedAccount, seedTask, seedActivity } from "./fixtures.mjs";

// record_health() is defined in supabase-setup.sql, not email-alerts.sql, but its tests live
// here with the alert suite: the snapshots exist only to feed the health-drop alert, and
// these tests need the same real-Postgres fixtures the rest of this file uses.
//
// Every accountId below is seeded first. record_health() now drops rows whose accountId
// matches no account, so a test that skipped the seed would insert nothing and its
// assertions would report a validation rule as a broken function.

test("record_health writes one row per account", async () => {
  await seedAccount("h1", { name: "Health One" });
  await seedAccount("h2", { name: "Health Two" });
  const { error } = await sessions.admin.rpc("record_health", {
    p_scores: [{ accountId: "h1", score: 72 }, { accountId: "h2", score: 44 }],
  });
  assert(!error, `record_health failed: ${error && error.message}`);
  const { data } = await sessions.admin
    .from("health_snapshots").select("*").in("account_id", ["h1", "h2"]);
  assert((data || []).length === 2, `expected 2 snapshot rows, got ${(data || []).length}`);
  assert(data.find(r => r.account_id === "h1").score === 72, "h1 score was not stored");
});

test("record_health upserts rather than duplicating within a day", async () => {
  await seedAccount("h3", { name: "Health Three" });
  await sessions.admin.rpc("record_health", { p_scores: [{ accountId: "h3", score: 50 }] });
  await sessions.admin.rpc("record_health", { p_scores: [{ accountId: "h3", score: 61 }] });
  const { data } = await sessions.admin
    .from("health_snapshots").select("*").eq("account_id", "h3");
  assert((data || []).length === 1, `second write duplicated the row: got ${(data || []).length}`);
  assert(data[0].score === 61, `expected the later score 61, got ${data[0].score}`);
});

test("record_health drops an unknown accountId and keeps the valid one", async () => {
  await seedAccount("h-valid", { name: "Real Account" });
  await sql(`delete from health_snapshots where account_id in ('h-valid', 'no-such-account')`);

  // ONE call carrying both entries. The valid half is the control: without it, a
  // record_health() that inserted nothing at all -- or one deleted outright -- would sail
  // through the "unknown id wrote nothing" assertion.
  const { data: n, error } = await sessions.admin.rpc("record_health", {
    p_scores: [{ accountId: "no-such-account", score: 11 },
               { accountId: "h-valid", score: 88 }],
  });
  assert(!error, `record_health failed: ${error && error.message}`);

  const bogus = await sessions.admin
    .from("health_snapshots").select("*").eq("account_id", "no-such-account");
  assert((bogus.data || []).length === 0,
    "a snapshot was stored for an accountId that matches no account");

  const good = await sessions.admin
    .from("health_snapshots").select("*").eq("account_id", "h-valid");
  assert((good.data || []).length === 1,
    `control failed: the VALID accountId stored ${(good.data || []).length} row(s), expected 1`);
  assert(good.data[0].score === 88,
    `control failed: expected score 88, got ${good.data[0].score}`);

  // The return value is the app's own signal of how many rows landed, so it must agree.
  assert(n === 1, `record_health returned ${n}, expected 1 (the bogus entry must not count)`);
});

// Finding 8: the previous version of this test asserted only that SOME error came back. It
// passed for the wrong reason -- anon still held EXECUTE (Supabase's default privileges
// grant it explicitly, and `revoke ... from public` does not remove that), so the call
// reached the body and was stopped by the in-body `raise 'record_health: sign in required'`,
// which surfaces as P0001. Asserting the DENIED_CODES set is what separates "the grant is
// gone" from "the grant is intact and a runtime check caught it".
//
// DENIED_CODES and sessions.user are declared further down this module; both are resolved by
// the time any test BODY runs, since the framework registers tests first and executes after
// the module has fully evaluated.
test("record_health still exists for the owner but is closed to an anonymous client", async () => {
  // Deletion detector: PGRST202 also comes back for a function that is simply gone, so pin
  // that the owner still has an executable record_health before reading anything into it.
  const [priv] = await sql(
    `select has_function_privilege('postgres', $1::text, 'execute') as ok`,
    ["public.record_health(jsonb)"]);
  assert(priv && priv.ok === true,
    "deletion detector failed: public.record_health(jsonb) is not an existing, owner-executable function");

  const { error } = await sessions.anon.rpc("record_health", {
    p_scores: [{ accountId: "h4", score: 10 }],
  });
  assert(!!error, "an anonymous client was allowed to write health snapshots");
  assert(DENIED_CODES.includes(error.code),
    `expected one of ${DENIED_CODES.join("/")} -- the grant itself must be gone -- but got ` +
    `${error.code}: ${error.message}. P0001 means anon reached the function body.`);

  // And prove nothing landed, so a denial that somehow arrived after the insert would fail.
  const { data } = await sessions.admin
    .from("health_snapshots").select("*").eq("account_id", "h4");
  assert((data || []).length === 0, "the anonymous write landed anyway");
});

// The counterpart: revoking anon must not cost the app its access. crm.html:3733 calls
// record_health() as an ordinary signed-in user, so a "tighten it further" edit that also
// revoked `authenticated` would break the feature silently. This test goes red on that.
test("a signed-in plain user can still record health", async () => {
  await seedAccount("h-user", { name: "User Written" });
  const { error } = await sessions.user.rpc("record_health", {
    p_scores: [{ accountId: "h-user", score: 63 }],
  });
  assert(!error, `a signed-in user's record_health() was rejected: ${error && error.message}`);
  const { data } = await sessions.admin
    .from("health_snapshots").select("*").eq("account_id", "h-user");
  assert((data || []).length === 1, "the signed-in user's snapshot was not written");
});

test("email_log is admin-readable and closed to plain users", async () => {
  await sql(`insert into email_log (kind, recipient, row_count, status)
             values ('renewals', 'someone@test.local', 3, 'queued')`);
  const asAdmin = await sessions.admin.from("email_log").select("*");
  assert((asAdmin.data || []).length >= 1, "an admin could not read email_log");
  const asUser = await sessions.user.from("email_log").select("*");
  assert((asUser.data || []).length === 0, "a plain user could read email_log");
});

test("email_log refuses a second send of the same kind to the same person today", async () => {
  await sql(`insert into email_log (kind, recipient, row_count) values ('dupe', 'd@test.local', 1)`);
  let err = null;
  try {
    await sql(`insert into email_log (kind, recipient, row_count) values ('dupe', 'd@test.local', 1)`);
  } catch (e) { err = e; }
  assert(err, "the second insert was accepted — the uniqueness constraint did not fire");
  assert(err.code === "23505",
    `expected unique_violation 23505, got ${err.code}: ${err.message}`);

  // Same kind and recipient but a different day must be allowed through — proves the
  // constraint is scoped to (kind, recipient, day) and not blanket-rejecting every insert.
  const rows = await sql(
    `insert into email_log (kind, recipient, row_count, day)
     values ('dupe', 'd@test.local', 1, current_date - 1) returning id`
  );
  assert(rows.length === 1, "a different day for the same kind/recipient was wrongly rejected");
});

test("alert_recipients resolves each profile to an email address", async () => {
  const rows = await sql(`select * from alert_recipients() order by email`);
  assert(rows.length >= 2, `expected the two bootstrap users, got ${rows.length}`);
  const admin = rows.find(r => r.email === "admin@test.local");
  assert(!!admin, "admin@test.local was not resolved");
  assert(admin.person === "Admin User", `expected name "Admin User", got "${admin.person}"`);
  assert(admin.admin === true, "the admin was not flagged as an admin");
});

test("unrouted_csms reports a csm value that matches no profile", async () => {
  await seedAccount("u-1", { name: "Orphan Co", csm: "Nobody At All", contractStatus: "Active" });
  await seedAccount("u-2", { name: "Also Orphan", csm: "Nobody At All", contractStatus: "Active" });
  const rows = await sql(`select * from unrouted_csms()`);
  const hit = rows.find(r => r.csm === "Nobody At All");
  assert(!!hit, "an unmatched csm was silently dropped instead of reported");
  assert(Number(hit.accounts) === 2, `expected 2 orphaned accounts, got ${hit.accounts}`);
});

test("unrouted_csms reports unmatched csms and ignores matched ones", async () => {
  await seedAccount("u-4", { name: "Matched Co",   csm: "Admin User",   contractStatus: "Active" });
  await seedAccount("u-5", { name: "Unmatched Co", csm: "Ghost Person", contractStatus: "Active" });
  const rows = await sql(`select * from unrouted_csms()`);
  // The positive half: proves the function actually returns rows, so the negative
  // half below cannot pass merely because the result set was empty.
  const ghost = rows.find(r => r.csm === "Ghost Person");
  assert(ghost, "an unmatched csm was not reported");
  assert(Number(ghost.accounts) === 1, `expected 1 account for Ghost Person, got ${ghost.accounts}`);
  // The negative half, now meaningful.
  assert(!rows.find(r => r.csm === "Admin User"),
    "an account whose csm matches a real profile was wrongly reported as unrouted");
});

test("alert_renewals returns only this CSM's accounts renewing within 30 days", async () => {
  await seedAccount("r-1", { name: "Soon Co",  csm: "Admin User", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) });
  await seedAccount("r-2", { name: "Later Co", csm: "Admin User", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) });
  await seedAccount("r-3", { name: "Theirs",   csm: "Plain User", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) });

  const rows = await sql(`select * from alert_renewals('Admin User')`);
  const ids = rows.map(r => r.account_id);
  assert(ids.includes("r-1"), "the renewal due in 5 days was missing");
  assert(!ids.includes("r-2"), "a renewal 90 days out was included");
  assert(!ids.includes("r-3"), "another CSM's account leaked into this book");
  assert(rows.find(r => r.account_id === "r-1").days_left === 5,
    "days_left was not computed correctly");
});

test("alert_renewals excludes churned accounts", async () => {
  await seedAccount("r-4", { name: "Gone Co", csm: "Admin User", contractStatus: "Churned",
                             renewalDate: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) });
  const rows = await sql(`select * from alert_renewals('Admin User')`);
  assert(!rows.map(r => r.account_id).includes("r-4"), "a churned account was included");
  // The window itself still works -- otherwise the assertion above passes vacuously.
  assert(rows.length > 0, "the builder returned nothing at all, so nothing was proven");
});

test("alert_renewals adds unowned accounts only when asked", async () => {
  await seedAccount("r-5", { name: "Nobody's", csm: "", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) });
  const without = await sql(`select * from alert_renewals('Admin User', false)`);
  const with_   = await sql(`select * from alert_renewals('Admin User', true)`);
  assert(!without.map(r => r.account_id).includes("r-5"), "an unowned account leaked in by default");
  assert(with_.map(r => r.account_id).includes("r-5"), "an unowned account was not picked up for admins");
});

test("alert_overdue_tasks routes through the account's CSM and skips Done", async () => {
  await seedAccount("t-acct", { name: "Task Co", csm: "Admin User", contractStatus: "Active" });
  const past = new Date(Date.now() - 4 * 864e5).toISOString().slice(0, 10);
  const future = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
  await seedTask("t-1", { accountId: "t-acct", title: "Chase renewal", due: past,   status: "Open" });
  await seedTask("t-2", { accountId: "t-acct", title: "Already done",  due: past,   status: "Done" });
  await seedTask("t-3", { accountId: "t-acct", title: "Not yet due",   due: future, status: "Open" });

  const rows = await sql(`select * from alert_overdue_tasks('Admin User')`);
  const ids = rows.map(r => r.task_id);
  assert(ids.includes("t-1"), "the overdue task was missing");
  assert(!ids.includes("t-2"), "a Done task was reported as overdue");
  assert(!ids.includes("t-3"), "a task due in the future was reported as overdue");
  const hit = rows.find(r => r.task_id === "t-1");
  assert(hit.days_overdue === 4, `expected 4 days overdue, got ${hit.days_overdue}`);
  assert(hit.account_name === "Task Co", "the task was not joined to its account");
});

test("alert_overdue_tasks does not leak another CSM's tasks", async () => {
  await seedAccount("t-other", { name: "Their Co", csm: "Plain User", contractStatus: "Active" });
  await seedTask("t-4", { accountId: "t-other", title: "Theirs",
                          due: new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 10),
                          status: "Open" });
  const rows = await sql(`select * from alert_overdue_tasks('Admin User')`);
  assert(!rows.map(r => r.task_id).includes("t-4"), "another CSM's overdue task leaked in");
  assert(rows.length > 0, "the builder returned nothing at all, so nothing was proven");
});

const iso = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

test("alert_qbr_nudge lists QBRs due within 14 days or already past", async () => {
  await seedAccount("q-1", { name: "Due Soon", csm: "Admin User", contractStatus: "Active",
                             qbrFrequency: "Quarterly", nextQbrDate: iso(10) });
  await seedAccount("q-2", { name: "Far Off",  csm: "Admin User", contractStatus: "Active",
                             qbrFrequency: "Quarterly", nextQbrDate: iso(60) });
  const rows = await sql(`select * from alert_qbr_nudge('Admin User') where section = 'due'`);
  const ids = rows.map(r => r.account_id);
  assert(ids.includes("q-1"), "a QBR due in 10 days was not listed");
  assert(!ids.includes("q-2"), "a QBR 60 days out was listed");
});

test("alert_qbr_nudge flags a past QBR with no QBR activity logged near it", async () => {
  await seedAccount("q-3", { name: "Unlogged Co", csm: "Admin User", contractStatus: "Active",
                             qbrFrequency: "Quarterly", nextQbrDate: iso(-20) });
  const rows = await sql(`select * from alert_qbr_nudge('Admin User') where section = 'unlogged'`);
  assert(rows.map(r => r.account_id).includes("q-3"),
    "a past QBR with no activity was not flagged as possibly unlogged");
});

test("alert_qbr_nudge does NOT flag a past QBR that was logged within 14 days of it", async () => {
  await seedAccount("q-4", { name: "Logged Co", csm: "Admin User", contractStatus: "Active",
                             qbrFrequency: "Quarterly", nextQbrDate: iso(-20) });
  await seedActivity("act-1", { accountId: "q-4", type: "QBR", date: iso(-18),
                                summary: "Q3 review held" });
  const rows = await sql(`select * from alert_qbr_nudge('Admin User') where section = 'unlogged'`);
  assert(!rows.map(r => r.account_id).includes("q-4"),
    "an account with a logged QBR was wrongly accused of not logging it");
  // Prove the section is populated at all, or the assertion above is vacuous.
  assert(rows.length > 0, "the unlogged section was empty, so nothing was proven");
});

test("alert_qbr_nudge ignores accounts with qbrFrequency None", async () => {
  // Positive half first, so the negative assertion below cannot pass vacuously against
  // an empty result set.
  await seedAccount("q-6", { name: "Real Cadence", csm: "Admin User", contractStatus: "Active",
                             qbrFrequency: "Quarterly", nextQbrDate: iso(5) });
  await seedAccount("q-5", { name: "No QBRs", csm: "Admin User", contractStatus: "Active",
                             qbrFrequency: "None", nextQbrDate: "" });
  const rows = await sql(`select * from alert_qbr_nudge('Admin User')`);
  const ids = rows.map(r => r.account_id);
  assert(ids.includes("q-6"), "an account with a real QBR cadence in the window was missing");
  assert(!ids.includes("q-5"), "an account with no QBR cadence was nudged");
});

test("alert_overdue_tasks adds unowned accounts' tasks only when asked", async () => {
  await seedAccount("t-unowned", { name: "Nobody's Tasks", csm: "", contractStatus: "Active" });
  await seedTask("t-5", { accountId: "t-unowned", title: "Orphan task",
                          due: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10),
                          status: "Open" });
  const without = await sql(`select * from alert_overdue_tasks('Admin User', false)`);
  const with_   = await sql(`select * from alert_overdue_tasks('Admin User', true)`);
  assert(!without.map(r => r.task_id).includes("t-5"), "an unowned account's task leaked in by default");
  assert(with_.map(r => r.task_id).includes("t-5"), "an unowned account's task was not picked up for admins");
});

test("alert_qbr_nudge adds unowned accounts only when asked", async () => {
  await seedAccount("q-7", { name: "Nobody's QBR", csm: "", contractStatus: "Active",
                             qbrFrequency: "Quarterly", nextQbrDate: iso(5) });
  const without = await sql(`select * from alert_qbr_nudge('Admin User', false)`);
  const with_   = await sql(`select * from alert_qbr_nudge('Admin User', true)`);
  assert(!without.map(r => r.account_id).includes("q-7"), "an unowned account leaked in by default");
  assert(with_.map(r => r.account_id).includes("q-7"), "an unowned account was not picked up for admins");
});

test("alert_qbr_nudge tolerates a blank activity date instead of raising", async () => {
  await seedAccount("q-8", { name: "Blank Date Co", csm: "Admin User", contractStatus: "Active",
                             qbrFrequency: "Quarterly", nextQbrDate: iso(-20) });
  // A blank date on a QBR-typed activity: the case-wrapped guard must stop the cast from
  // ever running on it, regardless of how Postgres orders the AND conjuncts.
  await seedActivity("act-2", { accountId: "q-8", type: "QBR", date: "",
                                summary: "date left blank by mistake" });
  // A blank date on a NON-QBR-typed activity: the `type` filter is likewise not
  // ordering-guaranteed, so a fix that only guards QBR-typed rows would still break here.
  await seedActivity("act-3", { accountId: "q-8", type: "Call", date: "",
                                summary: "unrelated call, also has a blank date" });

  let rows, err = null;
  try {
    rows = await sql(`select * from alert_qbr_nudge('Admin User')`);
  } catch (e) { err = e; }
  assert(!err, `alert_qbr_nudge raised on a blank activity date: ${err && err.message}`);
  assert(rows.map(r => r.account_id).includes("q-8"),
    "the account should still be flagged (the blank-date activity does not count as a logged QBR)");

  let sendErr = null;
  try {
    await sql(`select send_alerts('qbr_nudge')`);
  } catch (e) { sendErr = e; }
  assert(!sendErr, `send_alerts('qbr_nudge') raised on a blank activity date: ${sendErr && sendErr.message}`);
});

// ---------- dispatcher ----------
// Replace the network seam with a stub. pg_net runs inside the Supabase container, so a
// real HTTP round trip would need host.docker.internal and is flaky on Windows; swapping
// this one function removes the network from the suite entirely.
const stubSend = () => sql(`
  create table if not exists public.test_sent (
    id bigserial primary key, url text, body jsonb, at timestamptz default now());
  create or replace function public.alert_post(p_url text, p_headers jsonb, p_body jsonb)
  returns bigint language plpgsql as $$
  declare n bigint;
  begin
    insert into test_sent (url, body) values (p_url, p_body) returning id into n;
    return n;
  end $$;`);

// Filters test_sent by the RECIPIENT (body.to[0].email), never by a substring match on the
// whole body. A substring match also matches the sender/from_name, which appears in every
// post regardless of who it went to -- an earlier version of these tests set
// from_email = 'alerts@onevio.test' to satisfy the sender-placeholder guard and then matched
// "admin@test.local" against the whole JSON body, so it silently counted Plain User's post
// too (their post's `sender` field contained the same string). test_sent.body is jsonb, so
// the driver already hands back a parsed object; the typeof guard is defense in depth only.
const sentTo = async (email) => (await sql(`select * from test_sent`)).filter(r => {
  const body = typeof r.body === "string" ? JSON.parse(r.body) : r.body;
  return (body.to || []).some(t => t.email === email);
});

// Mutates shared state: deletes email_log and test_sent, and seeds account "s-1".
// NOTE: this test does NOT assume it is the only source of accounts in the book -- other
// tests earlier in this file seed accounts (some for "Plain User", some unowned) that are
// still present when this runs, so a CSM other than Admin User may legitimately also get
// mailed. Every assertion below is therefore scoped to admin@test.local specifically,
// never to a total recipient/send count across the whole run. (CI caught this: an earlier
// version asserted `/1 recipient/` and broke the moment a prior test left a second
// genuine renewal in the database -- the dispatcher was right, the test's assumption
// wasn't.)
test("send_alerts mails each CSM their own book and logs the send", async () => {
  await stubSend();
  await sql(`update alert_config set api_key = 'test-key', from_email = 'alerts@onevio.test' where id = 1`);
  await sql(`delete from email_log`);
  await sql(`delete from test_sent`);
  await seedAccount("s-1", { name: "Send Co", csm: "Admin User", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10) });

  await sql(`select send_alerts('renewals')`);

  const logged = await sql(`select * from email_log where kind = 'renewals' and recipient = 'admin@test.local'`);
  assert(logged.length === 1, `expected 1 email_log row for admin@test.local, got ${logged.length}`);
  assert(logged[0].status === "queued", `expected status queued, got ${logged[0].status}`);
  assert(logged[0].request_id !== null, "the pg_net request id was discarded");

  const sentToAdmin = await sentTo("admin@test.local");
  assert(sentToAdmin.length === 1, `expected 1 outbound post to admin@test.local, got ${sentToAdmin.length}`);
  assert(JSON.stringify(sentToAdmin[0].body).includes("Send Co"), "the account was not in the email body");
});

// Mutates shared state: deletes email_log, test_sent, and ALL rows in accounts. This test
// runs last among the dispatcher tests that need real accounts (the double-send test below
// re-seeds its own account rather than relying on anything left over here).
test("send_alerts sends nothing when a book has no rows", async () => {
  await stubSend();
  await sql(`delete from email_log`);
  await sql(`delete from test_sent`);
  await sql(`delete from accounts`);
  const [{ send_alerts: result }] = await sql(`select send_alerts('renewals')`);
  const sent = await sql(`select * from test_sent`);
  assert(sent.length === 0, `an empty digest was sent anyway: ${result}`);
  // Prove the mechanism can send at all in this same empty-accounts state, so a dispatcher
  // that silently sends nothing regardless of input cannot pass this test: seed one account
  // and confirm the send now goes through.
  await seedAccount("s-empty-check", { name: "Proof Co", csm: "Admin User", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10) });
  await sql(`delete from email_log`);
  const [{ send_alerts: result2 }] = await sql(`select send_alerts('renewals')`);
  assert(/1 recipient/.test(result2), `expected a send once a real account existed: ${result2}`);
  const sent2 = await sql(`select * from test_sent`);
  assert(sent2.length === 1, `expected exactly 1 outbound post once rows existed, got ${sent2.length}`);
});

// Mutates shared state: deletes email_log, test_sent, and re-seeds account "s-2". Like the
// test above, this does not assume Admin User is the only recipient the run mails -- every
// assertion is scoped to admin@test.local so leftover accounts from earlier tests (e.g.
// Plain User's genuine renewal) cannot make this test pass or fail for the wrong reason.
test("send_alerts will not double-send the same kind to the same person today", async () => {
  await stubSend();
  await sql(`delete from email_log`);
  await sql(`delete from test_sent`);
  await seedAccount("s-2", { name: "Once Co", csm: "Admin User", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10) });
  await sql(`select send_alerts('renewals')`);

  const loggedAfterFirst = await sql(
    `select * from email_log where kind = 'renewals' and recipient = 'admin@test.local'`);
  assert(loggedAfterFirst.length === 1,
    `expected run 1 to log exactly 1 email_log row for admin@test.local, got ${loggedAfterFirst.length}`);
  const sentAfterFirst = await sentTo("admin@test.local");
  assert(sentAfterFirst.length === 1,
    `expected run 1 to actually mail admin@test.local once, got ${sentAfterFirst.length}`);

  await sql(`select send_alerts('renewals')`);

  const sentAfterSecond = await sentTo("admin@test.local");
  // Proves the second identical run did not add a second post to the same recipient --
  // paired above with proof that the mechanism sent at least once, so a dispatcher that
  // never sends cannot pass this test the same way idempotency does.
  assert(sentAfterSecond.length === 1,
    `expected exactly 1 outbound post to admin@test.local across both runs, got ${sentAfterSecond.length}`);
  // Proves run 2 was silent BECAUSE the idempotency guard fired, not because some
  // unrelated reason (e.g. a builder returning zero rows) skipped it identically.
  const loggedAfterSecond = await sql(
    `select * from email_log where kind = 'renewals' and recipient = 'admin@test.local'`);
  assert(loggedAfterSecond.length === 1,
    `expected exactly 1 email_log row for admin@test.local after two runs, got ${loggedAfterSecond.length}`);
});

// Regression test for Task 3 (Finding 3, MEDIUM): free-text account names and task titles
// were spliced unescaped into digest HTML. An account/task named with HTML markup could
// inject a link or break the table structure in every recipient's inbox. Both directions
// are asserted: the escaped entities ARE present, and the raw markup is NOT -- a
// contains-only check would pass even if the raw markup were ALSO present alongside an
// escaped copy, and an absence-only check would pass vacuously if the account never made
// it into the digest at all (wrong CSM, wrong status, task not actually overdue, etc). So
// this test also asserts the account's ESCAPED name is present, which cannot happen unless
// the row was actually found and rendered.
test("send_alerts escapes HTML in account names and task titles", async () => {
  await stubSend();
  await sql(`update alert_config set api_key = 'test-key', from_email = 'alerts@onevio.test' where id = 1`);
  await sql(`delete from email_log`);
  await sql(`delete from test_sent`);

  const evilName = 'Acme & Sons <Ltd> </table><a href="https://evil.example">x</a>';
  const evilTitle = 'Approve </table><a href="https://evil.example">click me</a> & go';
  await seedAccount("t-evil", { name: evilName, csm: "Admin User", contractStatus: "Active" });
  const past = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  await seedTask("t-evil-1", { accountId: "t-evil", title: evilTitle, due: past, status: "Open" });

  await sql(`select send_alerts('overdue_tasks')`);

  const sentToAdmin = await sentTo("admin@test.local");
  assert(sentToAdmin.length === 1, `expected 1 outbound post to admin@test.local, got ${sentToAdmin.length}`);
  const body = JSON.stringify(sentToAdmin[0].body);

  // Positive: the escaped form of the injected name is actually present, proving the
  // account row was found and rendered (not silently absent).
  assert(body.includes("Acme &amp; Sons &lt;Ltd&gt;"),
    `expected the escaped account name in the email body, got: ${body}`);
  assert(body.includes("&lt;a href=&quot;https://evil.example&quot;&gt;click me&lt;/a&gt;"),
    `expected the escaped task title anchor text in the email body, got: ${body}`);

  // Negative: the raw markup must not survive anywhere in the body.
  assert(!body.includes("<a href"), `raw <a href markup leaked into the email body: ${body}`);
  assert(!body.includes("</table><a"), `raw </table><a markup leaked into the email body: ${body}`);

  await sql(`delete from email_log where recipient = 'admin@test.local'`);
  await sql(`delete from test_sent`);
});

test("send_alerts refuses to run when the API key is still the placeholder", async () => {
  await stubSend();
  await sql(`delete from test_sent`);
  await sql(`update alert_config set api_key = 'PASTE_YOUR_BREVO_API_KEY' where id = 1`);
  const [{ send_alerts: result }] = await sql(`select send_alerts('renewals')`);
  assert(/not set/i.test(result), `expected a "not set" refusal, got: ${result}`);
  // A refusal string alone proves nothing if the guard were moved after the send -- confirm
  // no email actually went out.
  const sent = await sql(`select * from test_sent`);
  assert(sent.length === 0, `the placeholder guard returned a refusal but still sent ${sent.length} email(s)`);
  await sql(`update alert_config set api_key = 'test-key', from_email = 'alerts@onevio.test' where id = 1`);
});

test("send_alerts refuses to run when the sender is still the placeholder", async () => {
  await stubSend();
  await sql(`delete from test_sent`);
  await sql(`update alert_config set api_key = 'test-key', from_email = 'you@example.com' where id = 1`);
  const [{ send_alerts: result }] = await sql(`select send_alerts('renewals')`);
  assert(/not set/i.test(result), `expected a "not set" refusal, got: ${result}`);
  const sent = await sql(`select * from test_sent`);
  assert(sent.length === 0, `the sender-placeholder guard returned a refusal but still sent ${sent.length} email(s)`);
  await sql(`update alert_config set from_email = 'alerts@onevio.test' where id = 1`);
});

test("send_alerts skips a kind disabled in alert_config.enabled_kinds", async () => {
  await stubSend();
  await sql(`delete from email_log`);
  await sql(`delete from test_sent`);
  await seedAccount("s-disabled", { name: "Disabled Co", csm: "Admin User", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10) });
  await sql(`update alert_config set enabled_kinds = array['overdue_tasks','qbr_nudge'] where id = 1`);
  const [{ send_alerts: result }] = await sql(`select send_alerts('renewals')`);
  assert(/disabled/i.test(result), `expected a "disabled" refusal, got: ${result}`);
  const sent = await sql(`select * from test_sent`);
  assert(sent.length === 0, `a disabled kind still sent ${sent.length} email(s)`);
  await sql(`update alert_config set enabled_kinds = array['renewals','overdue_tasks','qbr_nudge'] where id = 1`);
});

// pg_net is deliberately NOT installed in this test database (extensions live in a file the
// harness never applies, since pg_cron would abort the whole schema reset). So net._http_response
// may not exist here. Create a minimal stand-in only if the real thing is absent -- if pg_net IS
// present (e.g. in CI), these are no-ops and the tests run against the real table.
async function ensureHttpResponseTable() {
  await sql(`create schema if not exists net`);
  await sql(`create table if not exists net._http_response (
    id bigint primary key,
    status_code int,
    content text,
    created timestamptz default now()
  )`);
}

test("settle_alert_sends marks a 201 response as sent", async () => {
  await ensureHttpResponseTable();
  await sql(`delete from email_log`);
  await sql(`insert into email_log (kind, recipient, row_count, request_id)
             values ('renewals', 'ok@test.local', 2, 900001)`);
  await sql(`insert into net._http_response (id, status_code, content, created)
             values (900001, 201, '{"messageId":"x"}', now())
             on conflict (id) do update set status_code = 201`);
  await sql(`select settle_alert_sends()`);
  const [row] = await sql(`select * from email_log where request_id = 900001`);
  assert(row.status === "sent", `expected sent, got ${row.status}`);
  assert(row.http_status === 201, `expected http_status 201, got ${row.http_status}`);
  assert(row.settled_at !== null, "settled_at was not stamped");
});

test("settle_alert_sends marks a 401 response as failed and records the body", async () => {
  await ensureHttpResponseTable();
  await sql(`insert into email_log (kind, recipient, row_count, request_id)
             values ('renewals', 'bad@test.local', 2, 900002)`);
  await sql(`insert into net._http_response (id, status_code, content, created)
             values (900002, 401, '{"message":"Key not found"}', now())
             on conflict (id) do update set status_code = 401`);
  await sql(`select settle_alert_sends()`);
  const [row] = await sql(`select * from email_log where request_id = 900002`);
  assert(row.status === "failed", `a 401 was not recorded as failed, got ${row.status}`);
  assert(/Key not found/.test(row.response || ""), "Brevo's rejection body was not kept");
});

test("settle_alert_sends gives up on a send that never got a response", async () => {
  await ensureHttpResponseTable();
  await sql(`insert into email_log (kind, recipient, row_count, request_id, created_at)
             values ('renewals', 'lost@test.local', 1, 900003, now() - interval '2 hours')`);
  await sql(`select settle_alert_sends()`);
  const [row] = await sql(`select * from email_log where request_id = 900003`);
  assert(row.status === "unknown", `a stale queued row stayed ${row.status} forever`);
});

test("settle_alert_sends gives up on a stale row with no request_id at all", async () => {
  // A queued row can have a NULL request_id (e.g. the post never happened). Such a row can
  // never join net._http_response, so the stale sweep -- not the join -- must be the thing
  // that rescues it. This proves the sweep has no accidental `request_id is not null` guard.
  await ensureHttpResponseTable();
  await sql(`insert into email_log (kind, recipient, row_count, request_id, created_at)
             values ('renewals', 'norequest@test.local', 1, null, now() - interval '2 hours')`);
  await sql(`select settle_alert_sends()`);
  const [row] = await sql(`select * from email_log where recipient = 'norequest@test.local'`);
  assert(row.status === "unknown", `a stale row with no request_id stayed ${row.status} forever`);
});

test("settle_alert_sends leaves a recent unanswered send alone", async () => {
  await ensureHttpResponseTable();
  // Control row: has a matching net._http_response and MUST settle to 'sent' in this same
  // call. Without it, "still queued" below would pass identically against a settle function
  // that does nothing at all -- this row proves the mechanism actually ran.
  await sql(`insert into email_log (kind, recipient, row_count, request_id)
             values ('renewals', 'control-settles@test.local', 1, 900010)`);
  await sql(`insert into net._http_response (id, status_code, content, created)
             values (900010, 201, '{"messageId":"control"}', now())
             on conflict (id) do update set status_code = 201`);
  // Row under test: fresh, unanswered, must be left alone.
  await sql(`insert into email_log (kind, recipient, row_count, request_id)
             values ('renewals', 'fresh@test.local', 1, 900004)`);
  await sql(`select settle_alert_sends()`);
  const [settled] = await sql(`select * from email_log where request_id = 900010`);
  assert(settled.status === "sent", `the control row did not settle: ${settled.status}`);
  const [fresh] = await sql(`select * from email_log where request_id = 900004`);
  assert(fresh.status === "queued", `a send from seconds ago was prematurely settled to ${fresh.status}`);
});

test("settle_alert_sends routes a failed send into error_log for an admin to see", async () => {
  await ensureHttpResponseTable();
  await sql(`delete from error_log where fingerprint = 'email-send-failed'`);
  await sql(`insert into email_log (kind, recipient, row_count, request_id)
             values ('renewals', 'routed-fail@test.local', 1, 900005)`);
  await sql(`insert into net._http_response (id, status_code, content, created)
             values (900005, 500, '{"message":"server error"}', now())
             on conflict (id) do update set status_code = 500`);
  await sql(`select settle_alert_sends()`);
  const [row] = await sql(`select * from error_log where fingerprint = 'email-send-failed'`);
  assert(row, "a failed send did not produce an error_log row");
  assert(row.level === "write_failed", `expected level write_failed, got ${row.level}`);
  assert(row.app_version === "cron", `expected app_version 'cron', got ${row.app_version}`);
  assert(row.user_agent === "pg_cron", `expected user_agent 'pg_cron', got ${row.user_agent}`);
});

test("settle_alert_sends counts a failure once across repeat sweeps, not once per sweep", async () => {
  // F6: the escalation guard used to check `settled_at > now() - interval '1 day'`, but the
  // sweep runs hourly -- so a failure stays inside a 1-day window for the next 23 hourly
  // sweeps after the one that first counted it, and log_error_system fires again on every one
  // of them.
  //
  // Any OTHER failed row left lying around by an earlier test (e.g. request_id 900005 from the
  // "routes a failed send into error_log" test above, whose settled_at is `now()` and stays
  // inside any of the guard's windows for a long time) would make this test's escalation fire
  // for the wrong reason and pass or fail independent of the code under test. So this clears
  // every failed row system-wide before seeding its own -- not just its own request_id -- to
  // guarantee the one row seeded here is the only thing that can trip the guard.
  await ensureHttpResponseTable();
  await sql(`delete from error_log where fingerprint = 'email-send-failed'`);
  await sql(`delete from email_log where status = 'failed'`);
  await sql(`delete from email_log where request_id = 900020`);
  await sql(`insert into email_log (kind, recipient, row_count, request_id, status, settled_at)
             values ('renewals', 'twice-swept@test.local', 1, 900020, 'failed', now())`);

  // Sweep 1: the row just failed, settled_at is `now()` -- inside every guard, fixed or not.
  // Must count once.
  await sql(`select settle_alert_sends()`);
  const [afterFirst] = await sql(`select * from error_log where fingerprint = 'email-send-failed'`);
  assert(afterFirst, "first sweep did not create an error_log row");
  assert(afterFirst.count === 1, `expected count 1 after the first sweep, got ${afterFirst.count}`);

  // Simulate an hour passing by backdating the SAME row's settled_at to 2 hours ago -- this is
  // the only thing that changes between sweep 1 and sweep 2.
  await sql(`update email_log set settled_at = now() - interval '2 hours' where request_id = 900020`);

  // Sweep 2, same row, now 2 hours old: outside the correct 1-hour guard (must NOT recount),
  // but still inside the old, wrong 1-day guard (WOULD recount, taking count to 2). This is
  // exactly the discriminating case -- it fails against the unfixed '1 day' guard and passes
  // against the fixed '1 hour' one.
  await sql(`select settle_alert_sends()`);
  const [afterSecond] = await sql(`select * from error_log where fingerprint = 'email-send-failed'`);
  assert(afterSecond.count === afterFirst.count,
    `a failure settled 2 hours ago was re-counted by a later sweep: count went from ${afterFirst.count} to ${afterSecond.count}`);
});

test("settle_alert_sends self-corrects an 'unknown' row once a late response arrives", async () => {
  // F7: the join update required status = 'queued', but the stale-row sweep flips anything
  // older than an hour to 'unknown' -- so a pg_net response arriving after ~1.5h permanently
  // recorded a delivered email as 'unknown'. This drives the same row through both sweeps in
  // sequence: first with no response (must land on 'unknown'), then with a late response that
  // must be allowed to overwrite it.
  await ensureHttpResponseTable();
  await sql(`delete from email_log where request_id = 900021`);
  await sql(`insert into email_log (kind, recipient, row_count, request_id, created_at)
             values ('renewals', 'late-response@test.local', 1, 900021, now() - interval '2 hours')`);

  await sql(`select settle_alert_sends()`);
  const [stale] = await sql(`select * from email_log where request_id = 900021`);
  assert(stale.status === "unknown", `expected the unanswered row to go 'unknown' first, got ${stale.status}`);

  await sql(`insert into net._http_response (id, status_code, content, created)
             values (900021, 201, '{"messageId":"late"}', now())
             on conflict (id) do update set status_code = 201`);
  await sql(`select settle_alert_sends()`);
  const [corrected] = await sql(`select * from email_log where request_id = 900021`);
  assert(corrected.status === "sent",
    `a late response did not self-correct an 'unknown' row, stayed ${corrected.status}`);
});

test("log_error_system collapses repeat calls into one row via fingerprint", async () => {
  await sql(`delete from error_log where fingerprint = 'test-collapse-fp'`);
  await sql(`select log_error_system('test-collapse-fp', 'write_failed', 'first', '{}'::jsonb)`);
  await sql(`select log_error_system('test-collapse-fp', 'write_failed', 'second', '{}'::jsonb)`);
  const rows = await sql(`select * from error_log where fingerprint = 'test-collapse-fp'`);
  assert(rows.length === 1, `expected exactly 1 collapsed row, got ${rows.length}`);
  assert(rows[0].count === 2, `expected count 2 after two calls, got ${rows[0].count}`);
  assert(rows[0].message === "second", `expected the latest message to win, got ${rows[0].message}`);
});

// ---------- the alert functions are closed to both published API roles ----------
// `revoke ... from public` alone does NOT close these on Supabase: fixtures.mjs re-applies
// `alter default privileges in schema public grant all on functions to ... anon,
// authenticated, ...` (mirroring hosted Supabase) before email-alerts.sql runs, so every
// function created afterwards carries an EXPLICIT execute grant to anon and authenticated,
// which revoking PUBLIC leaves untouched. The anon key is published in crm.html and shipped
// to GitHub Pages, so an open alert_recipients() -- SECURITY DEFINER over auth.users --
// would leak every user's email address to the internet.
//
// EACH TEST BELOW IS A PAIR, and both halves are load-bearing:
//
//   POSITIVE CONTROL (owner half) -- a DELETION DETECTOR, and nothing more. A bare "the
//   unprivileged caller was refused" assertion passes just as happily against a function
//   that no longer exists, which is the vacuity trap this branch keeps falling into.
//   has_function_privilege() raises undefined_function when the signature is gone, so
//   sql() rejects and the test fails.
//
//   It does NOT detect over-revoking, and must not be read as protecting the pg_cron jobs:
//   sql() connects as `postgres`, which is superuser locally, and a privilege check always
//   answers true for a superuser. Even for a non-superuser owner the answer would still be
//   true, because an owner keeps an implicit grant that `revoke ... from public, anon,
//   authenticated` never touches. Nothing here would notice an over-revoke.
//
//   NEGATIVE HALF (unprivileged) -- catches the revoke being REMOVED, or a `grant execute`
//   creeping back. Without the revoke the RPC succeeds and `assert(error, ...)` fails.
//
// The accepted codes are a SPECIFIC SET, never truthiness and never a message substring:
//   42501    insufficient_privilege -- PostgREST reached the function and was refused.
//   PGRST202 the function is absent from THIS ROLE's schema cache, which PostgREST builds
//            per role: a function with execute revoked can simply not appear in it.
// Both mean "unreachable by this role", which is what the finding requires. Widening to
// this set is only safe because the deletion detector above independently proves the
// function is still there -- PGRST202 alone also comes back for a deleted function.
//
// A truthy-error check would be worthless here for a further reason: send_alerts() returns
// a plain string on the no-config path and log_error_system() succeeds silently, so "some
// error happened" would pass for entirely the wrong reason -- or not fail at all.
const DENIED_CODES = ["42501", "PGRST202"];

// Owner-side probes. Most can only prove EXISTENCE: the builders return zero rows against
// an unseeded database and settle_alert_sends() returns void, so there is no cheap, stable
// output worth asserting on and inventing one would only make it brittle. Two probes can
// assert something real, and do. Each probe is responsible for the state it needs, so the
// tests below do not depend on what earlier tests in this file happened to leave behind.
const OWNER_PROBES = {
  // Existence only -- a zero-row result is a perfectly normal answer here.
  alert_recipients: () => sql(`select * from alert_recipients()`),
  unrouted_csms: () => sql(`select * from unrouted_csms()`),
  alert_renewals: () => sql(`select * from alert_renewals('Ana', false)`),
  alert_overdue_tasks: () => sql(`select * from alert_overdue_tasks('Ana', false)`),
  alert_qbr_nudge: () => sql(`select * from alert_qbr_nudge('Ana', false)`),

  // Existence only, but it needs net._http_response, which does not exist until
  // ensureHttpResponseTable() has run (pg_net is deliberately absent from this test DB).
  // Calling that helper here rather than relying on the settle tests above having already
  // run is what keeps this probe independent of test registration order.
  settle_alert_sends: async () => {
    await ensureHttpResponseTable();
    await sql(`select settle_alert_sends()`);
  },

  // Asserts on the RETURN VALUE, and establishes the config it needs rather than inheriting
  // whatever the dispatcher tests left in alert_config. Driving the placeholder-key guard
  // deliberately means the body runs and returns its refusal string without reaching the
  // send path -- so this probe writes no email_log or test_sent rows, unlike a probe that
  // lets a real send through. The config is restored to the value the dispatcher tests
  // leave, so running this in the middle of the file would be harmless too.
  send_alerts: async () => {
    await sql(`update alert_config set api_key = 'PASTE_YOUR_BREVO_API_KEY' where id = 1`);
    try {
      const [row] = await sql(`select send_alerts('renewals') as out`);
      assert(row && /not set/i.test(row.out),
        `positive control failed: send_alerts() returned ${JSON.stringify(row && row.out)}, expected a "not set" refusal`);
    } finally {
      await sql(`update alert_config set api_key = 'test-key', from_email = 'alerts@onevio.test' where id = 1`);
    }
  },

  // Asserts on the SIDE EFFECT: the row must actually appear, so a log_error_system() gutted
  // to a no-op fails its own control. Cleans up after itself -- the fingerprint is scoped to
  // this probe and left behind would pollute error_log for anything that counts rows.
  log_error_system: async () => {
    await sql(`delete from error_log where fingerprint = 'rls-owner-probe'`);
    await sql(`select log_error_system('rls-owner-probe', 'write_failed', 'owner control', '{}'::jsonb)`);
    const rows = await sql(`select * from error_log where fingerprint = 'rls-owner-probe'`);
    assert(rows.length === 1,
      `positive control failed: an owner log_error_system() wrote ${rows.length} row(s), expected 1`);
    await sql(`delete from error_log where fingerprint = 'rls-owner-probe'`);
  },

  // Asserts on the RETURN VALUE, and the value pins the escape order: & must be escaped
  // FIRST, so '<b>&' comes back as '&lt;b&gt;&amp;' -- if & were escaped last, the & this
  // probe's own escaping just produced would itself get re-escaped, and the result would be
  // '&lt;b&gt;&amp;amp;' instead. A probe that only checked "did not throw" would miss both
  // a deleted function body and an order regression; this one catches both.
  html_escape: async () => {
    const [row] = await sql(`select html_escape('<b>&') as out`);
    assert(row && row.out === "&lt;b&gt;&amp;",
      `positive control failed: html_escape('<b>&') returned ${JSON.stringify(row && row.out)}, expected "&lt;b&gt;&amp;"`);
  },

  // alert_post has NO probe: its body calls net.http_post and pg_net is deliberately absent
  // from this test database, so invoking it would fail for a reason unrelated to grants.
  //
  // Its deletion detector is also weaker than it looks, and the reason is worth recording.
  // By the time this loop runs, stubSend() above has replaced alert_post wholesale, so the
  // has_function_privilege() check probes the STUB -- delete the shipped alert_post from
  // email-alerts.sql and this control still passes. Coverage survives anyway, via the
  // unprivileged half: `create or replace` RETAINS the existing ACL, which is the only
  // reason the stub does not re-open the function in the normal case. Were the shipped
  // function gone, stubSend() would be a fresh CREATE, it would inherit the anon /
  // authenticated grant from fixtures.mjs's default privileges, and the anon and plain-user
  // halves would go red.
  alert_post: null,
};

// [rpc name, rpc args, signature for has_function_privilege]
const CLOSED_FUNCTIONS = [
  ["alert_recipients", {}, "public.alert_recipients()"],
  ["unrouted_csms", {}, "public.unrouted_csms()"],
  ["alert_renewals", { p_csm: "Ana", p_include_unowned: false },
    "public.alert_renewals(text, boolean)"],
  ["alert_overdue_tasks", { p_csm: "Ana", p_include_unowned: false },
    "public.alert_overdue_tasks(text, boolean)"],
  ["alert_qbr_nudge", { p_csm: "Ana", p_include_unowned: false },
    "public.alert_qbr_nudge(text, boolean)"],
  ["alert_post", { p_url: "http://127.0.0.1:1/none", p_headers: {}, p_body: {} },
    "public.alert_post(text, jsonb, jsonb)"],
  ["send_alerts", { p_kind: "renewals" }, "public.send_alerts(text)"],
  ["settle_alert_sends", {}, "public.settle_alert_sends()"],
  ["log_error_system", {
    p_fingerprint: "rls-grant-probe", p_level: "write_failed",
    p_message: "should never be written", p_context: {},
  }, "public.log_error_system(text, text, text, jsonb)"],
  ["html_escape", { p_text: "<b>&" }, "public.html_escape(text)"],
];

// The deletion detector, shared by both role tests. The $1::text cast is deliberate: an
// unknown-typed literal leaves the has_function_privilege() overload ambiguous.
async function assertNotDeleted(fn, signature) {
  const [priv] = await sql(
    `select has_function_privilege('postgres', $1::text, 'execute') as ok`, [signature]);
  assert(priv && priv.ok === true,
    `deletion detector failed: ${signature} did not answer as an existing, owner-executable function`);
  const probe = OWNER_PROBES[fn];
  if (probe) await probe();
}

for (const [fn, args, signature] of CLOSED_FUNCTIONS) {
  test(`${fn}() still exists for the owner but is closed to an anonymous client`, async () => {
    await assertNotDeleted(fn, signature);
    const { data, error } = await sessions.anon.rpc(fn, args);
    assert(error, `anon executed ${fn}() successfully and got: ${JSON.stringify(data)}`);
    assert(DENIED_CODES.includes(error.code),
      `expected one of ${DENIED_CODES.join("/")} from ${fn}(), got ${error.code}: ${error.message}`);
  });

  test(`${fn}() still exists for the owner but is closed to a signed-in plain user`, async () => {
    await assertNotDeleted(fn, signature);
    const { data, error } = await sessions.user.rpc(fn, args);
    assert(error, `an authenticated user executed ${fn}() and got: ${JSON.stringify(data)}`);
    assert(DENIED_CODES.includes(error.code),
      `expected one of ${DENIED_CODES.join("/")} from ${fn}(), got ${error.code}: ${error.message}`);
  });
}

// A refused call must not have RUN. log_error_system() is the one function in the table
// above with an observable write, so it is the one that can show the denial landed before
// the body executed rather than after. Self-contained: it clears the fingerprint, seeds its
// own row and makes its own denied calls, so it does not depend on the loop tests above
// having run first or on the order the framework registers tests in.
test("a refused log_error_system() call writes no error_log row", async () => {
  await sql(`delete from error_log where fingerprint = 'rls-denied-write'`);
  const denied = {
    p_fingerprint: "rls-denied-write", p_level: "write_failed",
    p_message: "should never be written", p_context: {},
  };
  // Positive control: the identical call from the owner DOES write, so "unchanged below"
  // means the calls were refused rather than that log_error_system() is inert or misnamed.
  await sql(`select log_error_system('rls-denied-write', 'write_failed', 'owner control', '{}'::jsonb)`);
  const seeded = await sql(`select * from error_log where fingerprint = 'rls-denied-write'`);
  assert(seeded.length === 1,
    `positive control failed: an owner call wrote ${seeded.length} row(s), expected 1`);
  const before = seeded[0].count;

  await sessions.anon.rpc("log_error_system", denied);
  await sessions.user.rpc("log_error_system", denied);

  const after = await sql(`select * from error_log where fingerprint = 'rls-denied-write'`);
  assert(after.length === 1, `expected only the owner's row, got ${after.length}`);
  assert(after[0].count === before,
    `a refused log_error_system() still ran: count went ${before} -> ${after[0].count}`);
  assert(after[0].message === "owner control",
    `a refused log_error_system() overwrote the message with: ${after[0].message}`);
});
