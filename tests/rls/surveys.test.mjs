// tests/rls/surveys.test.mjs -- surveys.sql: send (admin only), token secrecy, public answer flow.
import assert from "node:assert/strict";
import { test } from "../health/framework.mjs";
import { sessions, sql, ORG_A, ORG_B, invitedFresh, seedAccount, seedContact } from "./fixtures.mjs";
import { NPS_CHECKIN } from "../../src/lib/surveys.js";

const T = NPS_CHECKIN;
const send = (session, account, ids, tpl = T) =>
  session.rpc("send_survey", { p_account: account, p_contact_ids: ids, p_template: tpl });
const C = (o) => ({ accountId: "sv-a1", surveyRecipient: true, ...o });

let tok1 = null, sid1 = null, lead = null;

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

test("surveys: admin sends; tokens only for .invalid", async () => {
  await seedAccount("sv-a1", { name: "Acme", csm: "Plain User" });
  await seedContact("sv-c1", C({ name: "Asha Rao", email: "asha@acme.invalid", role: "CTO" }));
  const { data, error } = await send(sessions.admin, "sv-a1", ["sv-c1"]);
  assert.ifError(error);
  assert.equal(data.sent.length, 1);
  assert.equal(data.skipped.length, 0);
  assert.match(data.sent[0].token, /^[0-9a-f]{64}$/);
  tok1 = data.sent[0].token; sid1 = data.sent[0].survey_id;
  const [row] = await sql(`select contact_role, sent_by, template_id, expires_at - sent_at as ttl from surveys where id = $1`, [sid1]);
  assert.equal(row.contact_role, "CTO");
  assert.equal(row.template_id, "nps-checkin");
  assert.equal(row.ttl.days, 30);
  const act = await sql(`select data from activities where org_id = $1 and id = $2`, [ORG_A, "sv-sent-" + sid1]);
  assert.equal(act.length, 1);
  assert.equal(act[0].data.system, true);
  assert.equal(act[0].data.summary, "Survey sent (NPS check-in) to Asha Rao");
});

test("surveys: non-admin cannot send; lead scoped", async () => {
  const r = await send(sessions.user, "sv-a1", ["sv-c1"]);
  assert.match(r.error?.message || "", /not allowed/);
  lead = await invitedFresh("sv-lead@test.local");
  await sql(`update profiles set role = 'lead', name = 'Survey Lead' where id = $1`, [lead.id]);
  const lr = await send(lead.client, "sv-a1", ["sv-c1"]);
  assert.match(lr.error?.message || "", /not allowed/);
  await seedAccount("sv-lead", { name: "Lead Co", leadId: lead.id });
  await seedContact("sv-lc", { accountId: "sv-lead", surveyRecipient: true, name: "Lee", email: "lee@lead.invalid" });
  const s2 = await send(sessions.admin, "sv-lead", ["sv-lc"]);
  assert.ifError(s2.error); assert.equal(s2.data.sent.length, 1);
  const { data, error } = await lead.client.from("surveys").select("id, account_id");
  assert.ifError(error);
  assert.deepEqual([...new Set(data.map(d => d.account_id))], ["sv-lead"]);
  const u = await sessions.user.from("surveys").select("id").eq("account_id", "sv-a1");
  assert.ifError(u.error); assert.equal(u.data.length, 1, "control: a CSM sees every account's surveys");
});

test("surveys: send skips ineligible", async () => {
  await seedContact("sv-c2", C({ name: "No Mail", email: "  " }));
  await seedContact("sv-c3", C({ name: "Out", email: "out@acme.invalid", surveyOptOut: "2026-10-01" }));
  await seedContact("sv-c4", C({ name: "Unflagged", email: "un@acme.invalid", surveyRecipient: false }));
  const { data, error } = await send(sessions.admin, "sv-a1", ["sv-c1", "sv-c2", "sv-c3", "sv-c4"]);
  assert.ifError(error);
  assert.equal(data.sent.length, 0);
  const why = Object.fromEntries(data.skipped.map(s => [s.contact_id, s.reason]));
  assert.match(why["sv-c1"], /^Survey pending since /);
  assert.equal(why["sv-c2"], "No email");
  assert.equal(why["sv-c3"], "Opted out");
  assert.equal(why["sv-c4"], "Not flagged for surveys");
});

test("surveys: daily cap refuses whole send", async () => {
  const [{ n }] = await sql(`select count(*)::int n from surveys where org_id = $1 and sent_at::date = (now() at time zone 'utc')::date`, [ORG_A]);
  const cap = n + 1;
  await sql(`insert into settings (org_id, data) values ($1, jsonb_build_object('surveys', jsonb_build_object('dailyCap', $2::int)))
    on conflict (org_id) do update set data = settings.data || excluded.data`, [ORG_A, cap]);
  try {
    await seedContact("sv-c5", C({ name: "Five", email: "five@acme.invalid" }));
    await seedContact("sv-c6", C({ name: "Six", email: "six@acme.invalid" }));
    const r = await send(sessions.admin, "sv-a1", ["sv-c5", "sv-c6"]);
    assert.equal(r.error?.message, `Daily survey limit reached (${cap}). Try again tomorrow.`);
    const rows = await sql(`select id from surveys where contact_id in ('sv-c5','sv-c6')`);
    assert.equal(rows.length, 0, "nothing sent when the cap refuses");
  } finally {
    await sql(`update settings set data = data - 'surveys' where org_id = $1`, [ORG_A]);
  }
});

test("surveys: token column not selectable", async () => {
  const bad = await sessions.admin.from("surveys").select("token");
  assert.ok(bad.error, "select token must error");
  const star = await sessions.admin.from("surveys").select("*");
  assert.ok(star.error, "select * includes token and must error");
  const ok = await sessions.admin.from("surveys").select("id").eq("id", sid1);
  assert.ifError(ok.error); assert.equal(ok.data.length, 1);
  const anon = await sessions.anon.from("surveys").select("id");
  assert.ok(anon.error || (anon.data || []).length === 0);
});

test("surveys: get_survey returns snapshot; null for bad token", async () => {
  const { data, error } = await sessions.anon.rpc("get_survey", { p_token: tok1 });
  assert.ifError(error);
  assert.equal(data.firstName, "Asha");
  assert.equal(data.accountName, "Acme");
  assert.equal(data.csmName, "Plain User");
  assert.ok(data.orgName);
  assert.equal(data.intro, T.intro);
  assert.deepEqual(data.questions, T.questions);
  assert.equal(data.editable, true);
  assert.equal(data.answers, undefined);
  const bad = await sessions.anon.rpc("get_survey", { p_token: "nope" });
  assert.ifError(bad.error); assert.equal(bad.data, null);
  const [c2] = await sql(`select contact_id, submitted_at from surveys where id = $1`, [sid1]);
  assert.equal(c2.contact_id, "sv-c1");
  assert.equal(c2.submitted_at, null, "opening must not submit");
  const ans = await sql(`select 1 from survey_answers where survey_id = $1`, [sid1]);
  assert.equal(ans.length, 0, "opening must not store answers");
  const act = await sql(`select 1 from activities where org_id = $1 and id = $2`, [ORG_A, "sv-ans-" + sid1]);
  assert.equal(act.length, 0, "opening must not log a touchpoint");
});

test("surveys: submit validates", async () => {
  const sub = (a) => sessions.anon.rpc("submit_survey", { p_token: tok1, p_answers: a });
  for (const a of [{ nps: 11 }, {}, { reason: "x" }, { nps: 9, bogus: 1 }, { nps: 4.5 }, { nps: "9" }, { reason: "   " }]) {
    const r = await sub(a);
    assert.ifError(r.error); assert.deepEqual(r.data, { ok: false }, JSON.stringify(a));
  }
  const bad = await sessions.anon.rpc("submit_survey", { p_token: "nope", p_answers: { nps: 9 } });
  assert.deepEqual(bad.data, { ok: false });
  const [row] = await sql(`select submitted_at from surveys where id = $1`, [sid1]);
  assert.equal(row.submitted_at, null);
});

test("surveys: submit twice then after window", async () => {
  const sub = (a) => sessions.anon.rpc("submit_survey", { p_token: tok1, p_answers: a });
  const a = await sub({ nps: 9, reason: "   " });
  assert.deepEqual(a.data, { ok: true });
  const b = await sub({ nps: 7, reason: "Good support" });
  assert.deepEqual(b.data, { ok: true });
  const rows = await sql(`select question_id, value_num, value_text from survey_answers where survey_id = $1 order by question_id`, [sid1]);
  assert.deepEqual(rows.map(r => [r.question_id, r.value_num == null ? null : Number(r.value_num), r.value_text]),
    [["nps", 7, null], ["reason", null, "Good support"]]);
  const vis = await sessions.admin.from("survey_answers").select("question_id").eq("survey_id", sid1);
  assert.ifError(vis.error); assert.equal(vis.data.length, 2, "admin reads answers");
  const g = await sessions.anon.rpc("get_survey", { p_token: tok1 });
  assert.equal(g.data.answers.nps, 7); assert.ok(g.data.submittedAt);
  await sql(`update surveys set submitted_at = now() - interval '8 days' where id = $1`, [sid1]);
  const c = await sub({ nps: 1 });
  assert.deepEqual(c.data, { ok: false });
  const g2 = await sessions.anon.rpc("get_survey", { p_token: tok1 });
  assert.equal(g2.data.editable, false);
  const [n] = await sql(`select value_num from survey_answers where survey_id = $1 and question_id = 'nps'`, [sid1]);
  assert.equal(Number(n.value_num), 7);
});

test("surveys: submit writes touchpoint once", async () => {
  const rows = await sql(`select data from activities where org_id = $1 and id like 'sv-ans-%' and data->>'surveyId' = $2`, [ORG_A, sid1]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data.type, "survey");
  assert.equal(rows[0].data.system, undefined);
  assert.equal(rows[0].data.summary, "Survey answered by Asha Rao");
});

test("surveys: unsubscribe sets opt-out and next send skips", async () => {
  await seedContact("sv-c7", C({ name: "Seven", email: "seven@acme.invalid" }));
  const s = await send(sessions.admin, "sv-a1", ["sv-c7"]);
  assert.ifError(s.error);
  const tok = s.data.sent[0].token;
  const u = await sessions.anon.rpc("unsubscribe_survey", { p_token: tok });
  assert.deepEqual(u.data, { ok: true });
  const [c] = await sql(`select data from contacts where org_id = $1 and id = 'sv-c7'`, [ORG_A]);
  assert.match(c.data.surveyOptOut, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(c.data.name, "Seven", "other fields kept");
  await sql(`update surveys set expires_at = now() - interval '1 day' where token = $1`, [tok]);
  const again = await send(sessions.admin, "sv-a1", ["sv-c7"]);
  assert.ifError(again.error);
  assert.equal(again.data.sent.length, 0);
  assert.equal(again.data.skipped[0].reason, "Opted out");
  const bad = await sessions.anon.rpc("unsubscribe_survey", { p_token: "nope" });
  assert.deepEqual(bad.data, { ok: false });
  const expired = await sessions.anon.rpc("get_survey", { p_token: tok });
  assert.equal(expired.data, null, "expired token reads null");
});

test("surveys: email escapes names", async () => {
  await stubSend();
  const [cfg] = await sql(`select api_key, from_email from alert_config where id = 1`);
  await sql(`update alert_config set api_key = 'test-key', from_email = 'alerts@onevio.test' where id = 1`);
  try {
    await seedContact("sv-c8", C({ name: "<b>x</b>", email: "esc@acme.test" }));
    await seedContact("sv-c9", C({ name: "Nine", email: "nine@acme.invalid" }));
    await sql(`delete from test_sent`);
    const { data, error } = await send(sessions.admin, "sv-a1", ["sv-c8", "sv-c9"]);
    assert.ifError(error);
    assert.equal(data.sent.length, 2);
    const byId = Object.fromEntries(data.sent.map(x => [x.contact_id, x]));
    assert.equal(byId["sv-c8"].token, undefined, "real address never returns its token");
    assert.match(byId["sv-c9"].token, /^[0-9a-f]{64}$/, ".invalid address returns its token");
    const all = (await sql(`select body from test_sent`)).map(r => r.body);
    assert.equal(all.length, 1, "exactly one post: the .invalid recipient is not posted");
    const posts = all.filter(b => (b.to || []).some(t => t.email === "esc@acme.test"));
    assert.equal(posts.length, 1);
    const html = posts[0].htmlContent;
    assert.ok(html.includes("Hi &lt;b&gt;x&lt;/b&gt;"), html);
    assert.ok(!html.includes("<b>x</b>"));
    assert.ok(html.includes("Plain User from "));
    assert.ok(html.includes("Answer the survey") && html.includes("Unsubscribe"));
    assert.ok(html.includes("&amp;q=nps&amp;v=10"));
  } finally {
    if (cfg) await sql(`update alert_config set api_key = $1, from_email = $2 where id = 1`, [cfg.api_key, cfg.from_email]);
  }
});

test("surveys: submit checks choice options", async () => {
  const tpl = { id: "choice-t", name: "Choice", intro: "", questions: [
    { id: "s", type: "single", text: "Pick", options: ["A", "B"] },
    { id: "m", type: "multi", text: "Pick many", options: ["A", "B", "C"] },
    { id: "n", type: "single", text: "No options" }] };
  await seedContact("sv-c10", C({ name: "Ten", email: "ten@acme.invalid" }));
  const s = await send(sessions.admin, "sv-a1", ["sv-c10"], tpl);
  assert.ifError(s.error);
  const tok = s.data.sent[0].token;
  const sub = (a) => sessions.anon.rpc("submit_survey", { p_token: tok, p_answers: a });
  for (const a of [{ s: "Z" }, { s: ["A"] }, { m: "A" }, { m: ["A", "Z"] }, { m: ["A", "A"] },
                   { m: ["x".repeat(5000)] }, { n: "anything" }]) {
    const r = await sub(a);
    assert.ifError(r.error); assert.deepEqual(r.data, { ok: false }, JSON.stringify(a));
  }
  const ok = await sub({ s: "B", m: ["A", "C"] });
  assert.deepEqual(ok.data, { ok: true });
  const rows = await sql(`select question_id, value_text, value_choices from survey_answers where survey_id = $1 order by question_id`, [s.data.sent[0].survey_id]);
  assert.deepEqual(rows.map(r => [r.question_id, r.value_text, r.value_choices]), [["m", null, ["A", "C"]], ["s", "B", null]]);
});

test("surveys: org B cannot read org A surveys", async () => {
  const { data, error } = await sessions.adminB.from("surveys").select("id, org_id");
  assert.ifError(error);
  assert.equal(data.filter(r => r.org_id === ORG_A).length, 0);
  const ans = await sessions.adminB.from("survey_answers").select("survey_id").eq("survey_id", sid1);
  assert.ifError(ans.error); assert.equal(ans.data.length, 0);
  const s = await send(sessions.adminB, "sv-a1", ["sv-c1"]);
  assert.match(s.error?.message || "", /account not found/);
  const own = await sessions.admin.from("surveys").select("id").eq("id", sid1);
  assert.equal(own.data.length, 1, "control: org A admin still reads it");
});

test("surveys: deleting the account deletes its surveys and answers", async () => {
  await sql(`delete from accounts where org_id = $1 and id = 'sv-a1'`, [ORG_A]);
  const rows = await sql(`select id from surveys where org_id = $1 and account_id = 'sv-a1'`, [ORG_A]);
  assert.equal(rows.length, 0);
  const ans = await sql(`select 1 from survey_answers where survey_id = $1`, [sid1]);
  assert.equal(ans.length, 0);
  await sql(`delete from accounts where org_id = $1 and id = 'sv-lead'`, [ORG_A]);
  await sql(`delete from contacts where org_id = $1 and id like 'sv-%'`, [ORG_A]);
  await sql(`delete from activities where org_id = $1 and id like 'sv-%'`, [ORG_A]);
});
