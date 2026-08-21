// Email alerts against a REAL Postgres. Builders are pure functions, so they are called
// directly with a superuser connection rather than through PostgREST -- execute is
// revoked from `authenticated`, which is the point.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, seedAccount, seedTask, seedActivity } from "./fixtures.mjs";

test("record_health writes one row per account", async () => {
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
  await sessions.admin.rpc("record_health", { p_scores: [{ accountId: "h3", score: 50 }] });
  await sessions.admin.rpc("record_health", { p_scores: [{ accountId: "h3", score: 61 }] });
  const { data } = await sessions.admin
    .from("health_snapshots").select("*").eq("account_id", "h3");
  assert((data || []).length === 1, `second write duplicated the row: got ${(data || []).length}`);
  assert(data[0].score === 61, `expected the later score 61, got ${data[0].score}`);
});

test("an anonymous client cannot record health", async () => {
  const { error } = await sessions.anon.rpc("record_health", {
    p_scores: [{ accountId: "h4", score: 10 }],
  });
  assert(!!error, "an anonymous client was allowed to write health snapshots");
  // Prove the row genuinely does not exist -- otherwise the assertion above proves nothing.
  const { data } = await sessions.admin
    .from("health_snapshots").select("*").eq("account_id", "h4");
  assert((data || []).length === 0, "the anonymous write landed anyway");
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

// Mutates shared state: deletes email_log and test_sent, and seeds account "s-1".
test("send_alerts mails each CSM their own book and logs the send", async () => {
  await stubSend();
  await sql(`update alert_config set api_key = 'test-key', from_email = 'admin@test.local' where id = 1`);
  await sql(`delete from email_log`);
  await sql(`delete from test_sent`);
  await seedAccount("s-1", { name: "Send Co", csm: "Admin User", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10) });

  const [{ send_alerts: result }] = await sql(`select send_alerts('renewals')`);
  assert(/1 recipient/.test(result), `unexpected dispatcher result: ${result}`);

  const logged = await sql(`select * from email_log where kind = 'renewals'`);
  assert(logged.length === 1, `expected 1 email_log row, got ${logged.length}`);
  assert(logged[0].recipient === "admin@test.local", `mailed the wrong person: ${logged[0].recipient}`);
  assert(logged[0].status === "queued", `expected status queued, got ${logged[0].status}`);
  assert(logged[0].request_id !== null, "the pg_net request id was discarded");

  const sent = await sql(`select * from test_sent`);
  assert(sent.length === 1, `expected 1 outbound post, got ${sent.length}`);
  assert(JSON.stringify(sent[0].body).includes("Send Co"), "the account was not in the email body");
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

// Mutates shared state: deletes email_log, test_sent, and re-seeds account "s-2".
test("send_alerts will not double-send the same kind to the same person today", async () => {
  await stubSend();
  await sql(`delete from email_log`);
  await sql(`delete from test_sent`);
  await seedAccount("s-2", { name: "Once Co", csm: "Admin User", contractStatus: "Active",
                             renewalDate: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10) });
  const [{ send_alerts: first }] = await sql(`select send_alerts('renewals')`);
  assert(/1 recipient/.test(first), `expected run 1 to actually mail someone, got: ${first}`);
  const [{ send_alerts: second }] = await sql(`select send_alerts('renewals')`);
  const sent = await sql(`select * from test_sent`);
  // Proves the mechanism sent at least once (so a dispatcher that never sends can't pass
  // this test), and that the second identical run did not add a second post.
  assert(sent.length === 1, `expected exactly 1 outbound post across both runs, got ${sent.length}`);
  // Proves run 2 was silent BECAUSE the idempotency guard fired, not because some
  // unrelated reason (e.g. a builder returning zero rows) skipped it identically.
  const logged = await sql(`select * from email_log where kind = 'renewals'`);
  assert(logged.length === 1, `expected exactly 1 email_log row after two runs, got ${logged.length}`);
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
  await sql(`update alert_config set api_key = 'test-key', from_email = 'admin@test.local' where id = 1`);
});

test("send_alerts refuses to run when the sender is still the placeholder", async () => {
  await stubSend();
  await sql(`delete from test_sent`);
  await sql(`update alert_config set api_key = 'test-key', from_email = 'you@example.com' where id = 1`);
  const [{ send_alerts: result }] = await sql(`select send_alerts('renewals')`);
  assert(/not set/i.test(result), `expected a "not set" refusal, got: ${result}`);
  const sent = await sql(`select * from test_sent`);
  assert(sent.length === 0, `the sender-placeholder guard returned a refusal but still sent ${sent.length} email(s)`);
  await sql(`update alert_config set from_email = 'admin@test.local' where id = 1`);
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
