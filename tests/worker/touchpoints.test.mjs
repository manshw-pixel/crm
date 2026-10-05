// The Cloudflare Email Worker under plain node: postal-mime parses a real MIME message and
// fetch is replaced with a recorder, so this never touches the network.
import assert from "node:assert/strict";
import worker, { toMessage } from "../../workers/touchpoints/src/index.js";
import PostalMime from "postal-mime";

const RAW = [
  'From: "Plain User" <User@Test.Local>',
  "To: touchpoints@onevio.in",
  "Cc: Jane Customer <jane@acme.example>, bob@acme.example",
  "Subject: Re: renewal",
  "Date: Mon, 05 Oct 2026 09:12:00 +0000",
  "Message-ID: <abc123@mail.test>",
  "Auto-Submitted: no",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Quote attached.",
  "",
].join("\r\n");
const bytes = s => new TextEncoder().encode(s).buffer;
const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", TOUCHPOINT_SECRET: "s3" };

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("toMessage maps a parsed email to the ingest shape", async () => {
  const m = await toMessage(await PostalMime.parse(RAW), "user@test.local", bytes(RAW));
  assert.equal(m.message_id, "<abc123@mail.test>");
  assert.equal(m.from, "user@test.local");
  assert.deepEqual(m.to, ["touchpoints@onevio.in"]);
  assert.deepEqual(m.cc, ["jane@acme.example", "bob@acme.example"]);
  assert.equal(m.subject, "Re: renewal");
  assert.equal(m.date, "2026-10-05T09:12:00.000Z");
  assert.match(m.text, /Quote attached\./);
  assert.deepEqual(m.headers, { "auto-submitted": "no" });
});

test("a message with no Message-ID gets a stable id derived from its bytes", async () => {
  const raw = RAW.replace("Message-ID: <abc123@mail.test>\r\n", "");
  const parsed = await PostalMime.parse(raw);
  const a = await toMessage(parsed, "user@test.local", bytes(raw));
  const b = await toMessage(parsed, "user@test.local", bytes(raw));
  assert.match(a.message_id, /^<cf-[0-9a-f]{64}@touchpoints>$/);
  assert.equal(a.message_id, b.message_id, "a retry must produce the same id");
});

test("an HTML-only email still yields text", async () => {
  const raw = RAW.replace("Content-Type: text/plain; charset=utf-8", "Content-Type: text/html; charset=utf-8")
                 .replace("Quote attached.", "<p>Quote <b>attached</b>.</p>");
  const m = await toMessage(await PostalMime.parse(raw), "user@test.local", bytes(raw));
  assert.match(m.text, /Quote\s+attached\./);
  assert.doesNotMatch(m.text, /<p>|<b>/);
});

test("email() posts to ingest_touchpoint with the secret and anon key", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{"ok":true}', { status: 200 }); };
  await worker.email({ from: "user@test.local", raw: new Response(RAW).body }, ENV);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://x.supabase.co/rest/v1/rpc/ingest_touchpoint");
  assert.equal(calls[0].init.headers.apikey, "anon");
  assert.equal(calls[0].init.headers.Authorization, "Bearer anon");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.p_secret, "s3");
  assert.equal(body.p_message.message_id, "<abc123@mail.test>");
});

test("email() throws on a non-2xx so the sending server retries", async () => {
  globalThis.fetch = async () => new Response("boom", { status: 503 });
  await assert.rejects(worker.email({ from: "user@test.local", raw: new Response(RAW).body }, ENV), /503/);
});

test("email() throws when settings are missing rather than posting to undefined", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}"); };
  await assert.rejects(worker.email({ from: "user@test.local", raw: new Response(RAW).body }, {}), /SUPABASE_URL/);
  assert.equal(called, false);
});

let fail = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log("PASS", name); }
  catch (e) { fail++; console.error("FAIL", name, "\n  ", e.message); }
}
console.log(`\n${cases.length - fail} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
