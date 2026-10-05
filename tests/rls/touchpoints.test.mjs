// Email touchpoint ingest against a REAL Postgres. Helpers are called by superuser SQL
// (they are revoked from every API role); ingest_touchpoint is called as `anon`, exactly
// the way the provider shim will call it.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql, seedAccount, seedContact, signUpFresh, invitedFresh, ORG_A, ORG_B } from "./fixtures.mjs";

const one = async (q, params = []) => Object.values((await sql(q, params))[0])[0];

test("tp_addr reduces display-name and case variants to the bare address", async () => {
  assert(await one(`select tp_addr('"Plain User" <USER@TEST.LOCAL>')`) === "user@test.local",
    "display-name form was not reduced");
  assert(await one(`select tp_addr('  Jane@Acme.COM ')`) === "jane@acme.com", "case/whitespace not normalised");
  assert(await one(`select tp_addr('not an address')`) === null, "a string without @ produced an address");
  assert(await one(`select tp_domain('Bob <bob@Sub.Acme.com>')`) === "sub.acme.com", "tp_domain wrong");
});

test("tp_generic flags the blocklist and nothing else", async () => {
  assert(await one(`select tp_generic('gmail.com')`) === true, "gmail.com not generic");
  assert(await one(`select tp_generic('protonmail.com')`) === true, "protonmail.com not generic");
  assert(await one(`select tp_generic('prohance.ai')`) === false, "control: a company domain was flagged generic");
});

test("tp_body_addrs finds addresses but not bare domains or trailing punctuation", async () => {
  const got = await one(`select tp_body_addrs('Ping jane@acme.com. Also see prohance.ai and BOB@Acme.com')`);
  assert(JSON.stringify([...got].sort()) === JSON.stringify(["bob@acme.com", "jane@acme.com"]),
    `got ${JSON.stringify(got)}`);
  const none = await one(`select tp_body_addrs('just prohance.ai mentioned')`);
  assert(none.length === 0, `a bare domain produced ${JSON.stringify(none)}`);
});

test("tp_strip_quotes cuts at reply markers and keeps forwarded content", async () => {
  const gmail = await one(`select tp_strip_quotes($1)`,
    ["Thanks, sending the quote.\r\n\r\nOn Mon, 5 Oct 2026 at 09:00, Jane <jane@acme.com> wrote:\r\n> earlier text"]);
  assert(gmail === "Thanks, sending the quote.", `gmail style: ${JSON.stringify(gmail)}`);
  const outlook = await one(`select tp_strip_quotes($1)`, ["Top line\n-----Original Message-----\nFrom: x"]);
  assert(outlook === "Top line", `outlook style: ${JSON.stringify(outlook)}`);
  const angle = await one(`select tp_strip_quotes($1)`, ["Reply\n> quoted"]);
  assert(angle === "Reply", `> style: ${JSON.stringify(angle)}`);
  // Control: a forward's content IS the customer thread and must survive.
  const fwd = await one(`select tp_strip_quotes($1)`,
    ["FYI\n---------- Forwarded message ---------\nFrom: Jane <jane@acme.com>\nRenewal is fine"]);
  assert(/Renewal is fine/.test(fwd), `forwarded content was stripped: ${JSON.stringify(fwd)}`);
});

// ---------- matching ----------
const match = (org, addrs, exclude = ["test.local"]) =>
  one(`select tp_match($1, $2, $3)`, [org, addrs, exclude]);

test("tp_match finds the account by contact domain, scoped to the org", async () => {
  await seedAccount("tpm-a1", { name: "Match One", contractStatus: "Active" });
  await seedContact("tpm-c1", { name: "Jane", email: "jane@match-one.example", accountId: "tpm-a1" });
  await seedAccount("tpm-b1", { name: "B Only", contractStatus: "Active" }, ORG_B);
  await seedContact("tpm-cb1", { name: "Bea", email: "bea@b-only.example", accountId: "tpm-b1" }, ORG_B);

  const hit = await match(ORG_A, ["someone@match-one.example"]);
  assert(JSON.stringify(hit) === '["tpm-a1"]', `expected tpm-a1, got ${JSON.stringify(hit)}`);
  // Org isolation, with the same call shape as the control above.
  const cross = await match(ORG_A, ["bea@b-only.example"]);
  assert(cross.length === 0, `org A matched org B's account: ${JSON.stringify(cross)}`);
  const own = await match(ORG_B, ["bea@b-only.example"]);
  assert(JSON.stringify(own) === '["tpm-b1"]', `control: org B did not match its own account: ${JSON.stringify(own)}`);
});

test("tp_match ignores generic domains, excluded domains and churned accounts", async () => {
  await seedAccount("tpm-g1", { name: "Gmail Holder", contractStatus: "Active" });
  await seedContact("tpm-cg1", { name: "Gee", email: "gee@gmail.com", accountId: "tpm-g1" });
  assert((await match(ORG_A, ["other@gmail.com"])).length === 0, "a gmail contact claimed a gmail thread");

  await seedAccount("tpm-x1", { name: "Excluded", contractStatus: "Active" });
  await seedContact("tpm-cx1", { name: "Ex", email: "ex@excluded.example", accountId: "tpm-x1" });
  assert((await match(ORG_A, ["ex@excluded.example"], ["excluded.example"])).length === 0,
    "an excluded domain still matched");
  assert((await match(ORG_A, ["ex@excluded.example"], [])).length === 1, "control: the unexcluded domain did not match");

  await seedAccount("tpm-ch1", { name: "Gone", contractStatus: "Churned" });
  await seedContact("tpm-cch1", { name: "Old", email: "old@gone.example", accountId: "tpm-ch1" });
  assert((await match(ORG_A, ["old@gone.example"])).length === 0, "a churned account matched");
});

test("tp_match narrows a shared domain by exact address, else reports both", async () => {
  await seedAccount("tpm-p1", { name: "Acme Parent", contractStatus: "Active" });
  await seedAccount("tpm-p2", { name: "Acme EMEA", contractStatus: "Active" });
  await seedContact("tpm-cp1", { name: "Pat", email: "pat@acme-shared.example", accountId: "tpm-p1" });
  await seedContact("tpm-cp2", { name: "Emma", email: "emma@acme-shared.example", accountId: "tpm-p2" });

  const narrowed = await match(ORG_A, ["emma@acme-shared.example"]);
  assert(JSON.stringify(narrowed) === '["tpm-p2"]', `exact address did not narrow: ${JSON.stringify(narrowed)}`);
  const both = await match(ORG_A, ["newperson@acme-shared.example"]);
  assert(JSON.stringify(both) === '["tpm-p1","tpm-p2"]', `expected both, got ${JSON.stringify(both)}`);
});

test("tp_match tolerates messy stored contact emails but not subdomains", async () => {
  await seedAccount("tpm-m1", { name: "Messy", contractStatus: "Active" });
  await seedContact("tpm-cm1", { name: "Mo", email: "  Mo@Messy-Co.EXAMPLE ", accountId: "tpm-m1" });
  assert(JSON.stringify(await match(ORG_A, ["x@messy-co.example"])) === '["tpm-m1"]',
    "a contact email with case/whitespace did not match");
  // Pinned on purpose: exact domain only. The bounce tells the CSM to add the contact.
  assert((await match(ORG_A, ["x@mail.messy-co.example"])).length === 0, "a subdomain matched");
  await seedContact("tpm-cm2", { name: "No Mail", accountId: "tpm-m1" });   // contact with no email: harmless
  assert(JSON.stringify(await match(ORG_A, ["x@messy-co.example"])) === '["tpm-m1"]',
    "a contact without an email broke matching");
});

// ---------- ingest_touchpoint ----------
const SECRET = "tp-test-secret";
const INBOX = "touchpoints@onevio.test";

// Same network seam the alert tests replace: bounces land in test_sent, never on the wire.
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

async function setup() {
  await stubSend();
  await sql(`delete from test_sent`);
  await sql(`update alert_config set api_key = 'test-key', from_email = 'alerts@onevio.test' where id = 1`);
  await sql(`update touchpoint_config set secret = $1, inbox_address = $2 where id = 1`, [SECRET, INBOX]);
}

let seq = 0;
const msg = o => ({ message_id: `<tp-${Date.now()}-${++seq}@test>`, from: "user@test.local",
  to: [INBOX], cc: [], date: "2026-10-01T09:00:00Z", subject: "Renewal chat", text: "Hi there", ...o });
const ingest = async (m, secret = SECRET) => {
  const { data, error } = await sessions.anon.rpc("ingest_touchpoint", { p_secret: secret, p_message: m });
  if (error) throw new Error(`ingest_touchpoint errored: ${error.message}`);
  return data;
};
const activityFor = async (m, org = ORG_A) =>
  (await sql(`select data from activities where org_id = $1 and id = 'em-' || md5($2)`, [org, m.message_id]))[0]?.data ?? null;
const logFor = async m => (await sql(`select * from ingest_log where message_id = $1`, [m.message_id]))[0] ?? null;
const bouncesTo = async email => (await sql(`select body from test_sent`))
  .filter(r => (r.body.to || []).some(t => t.email === email));

async function seedCustomer(id, domain, org = ORG_A, name = `Cust ${id}`) {
  await seedAccount(id, { name, contractStatus: "Active" }, org);
  await seedContact(`${id}-c`, { name: "Contact", email: `contact@${domain}`, accountId: id }, org);
}

test("a forwarded thread is logged on the matching account", async () => {
  await setup();
  await seedCustomer("tpi-a1", "happy.example");
  const m = msg({ from: '"Plain User" <USER@TEST.LOCAL>', cc: ["Contact <contact@happy.example>"],
    text: "Quote attached.\nOn Mon, 5 Oct 2026, Contact <contact@happy.example> wrote:\n> old" });
  const out = await ingest(m);
  assert(out.ok === true && out.verdict === "logged" && out.account_id === "tpi-a1", JSON.stringify(out));
  const a = await activityFor(m);
  assert(a, "no activity was written");
  assert(a.type === "email" && a.source === "email" && a.accountId === "tpi-a1", JSON.stringify(a));
  assert(a.loggedBy === "Plain User", `loggedBy was ${a.loggedBy}`);
  assert(a.summary === "Renewal chat" && a.details === "Quote attached.", `summary/details: ${JSON.stringify(a)}`);
  assert(a.date === "2026-10-01", `date was ${a.date}`);
  assert(JSON.stringify(a.participants) === '["contact@happy.example"]',
    `participants should be external only: ${JSON.stringify(a.participants)}`);
  const log = await logFor(m);
  assert(log.verdict === "logged" && log.org_id === ORG_A && log.account_id === "tpi-a1", JSON.stringify(log));
  assert((await bouncesTo("user@test.local")).length === 0, "a logged message bounced");
});

test("body addresses are a fallback; a bare domain mention is not", async () => {
  await setup();
  await seedCustomer("tpi-b1", "bodyonly.example");
  const viaBody = msg({ text: "FYI\n---------- Forwarded message ---------\nFrom: contact@bodyonly.example\nHello" });
  assert((await ingest(viaBody)).verdict === "logged", "body-address fallback did not log");
  const bare = msg({ text: "We should talk to bodyonly.example soon" });
  const out = await ingest(bare);
  assert(out.verdict === "no_match", `bare domain gave ${out.verdict}`);
  assert(await activityFor(bare) === null, "a bare domain mention wrote an activity");
});

test("a wrong or placeholder secret writes nothing", async () => {
  await setup();
  await seedCustomer("tpi-s1", "secret.example");
  const bad = msg({ cc: ["contact@secret.example"] });
  assert((await ingest(bad, "wrong")).ok === false, "wrong secret was accepted");
  assert(await logFor(bad) === null && await activityFor(bad) === null, "wrong secret wrote something");
  await sql(`update touchpoint_config set secret = 'CHANGE-ME' where id = 1`);
  const ph = msg({ cc: ["contact@secret.example"] });
  assert((await ingest(ph, "CHANGE-ME")).ok === false, "the placeholder secret was accepted");
  await setup();
  // Control: the same shape with the right secret logs.
  const good = msg({ cc: ["contact@secret.example"] });
  assert((await ingest(good)).verdict === "logged", "control: correct secret did not log");
});

test("missing message_id or from is refused without a log row", async () => {
  await setup();
  const out = await ingest({ from: "user@test.local", subject: "x", text: "y" });
  assert(out.ok === false && /message_id/.test(out.error || ""), JSON.stringify(out));
  const out2 = await ingest({ message_id: "<no-from@test>", subject: "x" });
  assert(out2.ok === false, JSON.stringify(out2));
  assert((await sql(`select 1 from ingest_log where message_id = '<no-from@test>'`)).length === 0, "a row was logged");
});

test("unknown, disabled, org-less and disabled-org senders are rejected silently", async () => {
  await setup();
  await seedCustomer("tpi-r1", "reject.example");
  await seedCustomer("tpi-r1b", "reject.example", ORG_B);
  const disabled = await invitedFresh("tp-disabled@test.local");
  await sql(`update profiles set disabled = true where id = $1`, [disabled.id]);
  await signUpFresh("tp-orgless@test.local");          // uninvited => org_id is null
  const senders = ["stranger@elsewhere.example", "tp-disabled@test.local", "tp-orgless@test.local"];
  for (const from of senders) {
    const m = msg({ from, cc: ["contact@reject.example"] });
    const out = await ingest(m);
    assert(out.ok === true && out.verdict === "rejected_sender", `${from}: ${JSON.stringify(out)}`);
    assert(await activityFor(m) === null, `${from}: an activity was written`);
    const log = await logFor(m);
    assert(log.sender === from.split("@")[1], `${from}: log kept "${log.sender}", expected the domain only`);
    assert(log.org_id === null, `${from}: log row carried an org`);
  }
  await sql(`update orgs set disabled = true where id = $1`, [ORG_B]);
  try {
    const m = msg({ from: "userb@test.local", cc: ["contact@reject.example"] });
    assert((await ingest(m)).verdict === "rejected_sender", "a sender in a disabled org was accepted");
    assert(await activityFor(m, ORG_B) === null, "disabled org got an activity");
  } finally {
    await sql(`update orgs set disabled = false where id = $1`, [ORG_B]);
  }
  assert((await sql(`select body from test_sent`)).length === 0, "a rejected sender was bounced");
  // Control: the same thread from an active CSM logs.
  const ok = msg({ cc: ["contact@reject.example"] });
  assert((await ingest(ok)).verdict === "logged", "control: an active CSM did not log");
});

test("a CSM cannot log onto another org's account", async () => {
  await setup();
  await seedCustomer("tpi-o1", "orgb-only.example", ORG_B);
  const a = msg({ cc: ["contact@orgb-only.example"] });
  const out = await ingest(a);
  assert(out.verdict === "no_match", `org A sender got ${out.verdict}`);
  assert(await activityFor(a, ORG_B) === null && await activityFor(a, ORG_A) === null, "cross-org activity written");
  assert((await bouncesTo("user@test.local")).length === 1, "the no_match was not bounced");
  // Control: org B's own CSM logs the same thread.
  const b = msg({ from: "userb@test.local", cc: ["contact@orgb-only.example"] });
  assert((await ingest(b)).verdict === "logged", "control: org B's CSM did not log");
  assert((await activityFor(b, ORG_B))?.accountId === "tpi-o1", "control: activity not on org B's account");
});

test("an ambiguous match bounces naming both accounts and logs nothing", async () => {
  await setup();
  await seedCustomer("tpi-m1", "twins.example", ORG_A, "Twin Parent");
  await seedCustomer("tpi-m2", "twins.example", ORG_A, "Twin EMEA");
  const m = msg({ cc: ["someone-new@twins.example"], subject: "Pricing" });
  assert((await ingest(m)).verdict === "ambiguous", "not ambiguous");
  assert(await activityFor(m) === null, "an ambiguous message wrote an activity");
  const [b] = await bouncesTo("user@test.local");
  assert(b, "no bounce was sent");
  assert(b.body.subject === "Not logged: Pricing", `subject was ${b.body.subject}`);
  assert(/Twin Parent/.test(b.body.textContent) && /Twin EMEA/.test(b.body.textContent), b.body.textContent);
  assert(!/someone-new/.test(b.body.textContent), "the bounce quoted thread content");
  assert((b.body.to || []).length === 1, "the bounce went to more than the sender");
});

test("the same message_id twice logs once and bounces once", async () => {
  await setup();
  await seedCustomer("tpi-d1", "dupe.example");
  const m = msg({ cc: ["contact@dupe.example"] });
  assert((await ingest(m)).verdict === "logged", "first delivery did not log");
  assert((await ingest(m)).verdict === "duplicate", "second delivery was not a duplicate");
  assert((await sql(`select count(*)::int n from activities where id = 'em-' || md5($1)`, [m.message_id]))[0].n === 1,
    "duplicate activity");
  const miss = msg({ cc: ["x@nobody-here.example"] });
  await ingest(miss); await ingest(miss);
  assert((await bouncesTo("user@test.local")).length === 1, "a retried no_match bounced twice");
});

test("auto-submitted mail is recorded but never bounced", async () => {
  await setup();
  const auto = msg({ cc: ["x@nobody-auto.example"], headers: { "auto-submitted": "auto-replied" } });
  assert((await ingest(auto)).verdict === "no_match", "auto mail verdict wrong");
  assert(await logFor(auto), "auto mail was not recorded");
  assert((await bouncesTo("user@test.local")).length === 0, "auto mail was bounced");
  const control = msg({ cc: ["x@nobody-auto.example"] });
  await ingest(control);
  assert((await bouncesTo("user@test.local")).length === 1, "control: an ordinary no_match did not bounce");
});

test("an empty message is malformed and bounced", async () => {
  await setup();
  const m = msg({ subject: "", text: "  " });
  assert((await ingest(m)).verdict === "malformed", "empty message not malformed");
  const [b] = await bouncesTo("user@test.local");
  assert(b && b.body.subject === "Not logged: (no subject)", `bounce: ${JSON.stringify(b && b.body)}`);
});

test("a failed bounce is recorded and the call still succeeds", async () => {
  await setup();
  await sql(`create or replace function public.alert_post(p_url text, p_headers jsonb, p_body jsonb)
             returns bigint language plpgsql as $$ begin raise exception 'brevo down'; end $$;`);
  try {
    const m = msg({ cc: ["x@nobody-fail.example"] });
    const out = await ingest(m);
    assert(out.ok === true && out.verdict === "no_match", JSON.stringify(out));
    assert((await logFor(m)).bounce_failed === true, "bounce_failed was not set");
  } finally {
    await stubSend();
  }
  const ok = msg({ cc: ["x@nobody-fail.example"] });
  await ingest(ok);
  assert((await logFor(ok)).bounce_failed === false, "control: a working bounce was marked failed");
});

test("a bad date falls back to today and long text is truncated", async () => {
  await setup();
  await seedCustomer("tpi-t1", "trunc.example");
  const m = msg({ cc: ["contact@trunc.example"], date: "not a date",
    subject: "S".repeat(500), text: "B".repeat(9000) });
  assert((await ingest(m)).verdict === "logged", "long message did not log");
  const a = await activityFor(m);
  const [{ today }] = await sql(`select to_char(current_date, 'YYYY-MM-DD') as today`);
  assert(a.date === today, `date was ${a.date}, expected ${today}`);
  assert(a.summary.length === 200 && a.details.length === 4000, `lengths ${a.summary.length}/${a.details.length}`);
  const noDate = msg({ cc: ["contact@trunc.example"], date: undefined });
  await ingest(noDate);
  assert((await activityFor(noDate)).date === today, "a missing date did not fall back to today");
});
