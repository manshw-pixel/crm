// The Cloudflare Email Worker under plain node: postal-mime parses a real MIME message and
// fetch is replaced with a recorder, so this never touches the network.
import assert from "node:assert/strict";
import worker, { toMessage, authOk } from "../../workers/touchpoints/src/index.js";
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
// What Cloudflare Email Routing stamps on a message that passed. Prepended (topmost), as a
// receiving MTA does.
const CF_PASS = "Authentication-Results: mx.cloudflare.net; dkim=pass header.d=test.local header.s=x; spf=pass smtp.mailfrom=user@test.local; dmarc=pass header.from=test.local";
const withHeaders = (...lines) => [...lines, RAW].join("\r\n");
const authOf = async raw => (await toMessage(await PostalMime.parse(raw), "user@test.local", bytes(raw))).auth_ok;
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
  assert.equal(m.auth_ok, false, "RAW carries no Authentication-Results header");
});

test("auth_ok is true for a Cloudflare-stamped DMARC/DKIM pass", async () => {
  assert.equal(await authOf(withHeaders(CF_PASS)), true);
});

test("auth_ok is false with no Authentication-Results header", async () => {
  assert.equal(await authOf(RAW), false);
  assert.equal(await authOf(withHeaders(CF_PASS)), true, "positive control");
});

test("a forged non-Cloudflare header claiming dmarc=pass is ignored", async () => {
  assert.equal(await authOf(withHeaders("Authentication-Results: evil.example; dmarc=pass header.from=test.local; dkim=pass header.d=test.local")), false);
});

test("the first Cloudflare header is used even when a forged one sits above it", async () => {
  const forged = "Authentication-Results: evil.example; dmarc=pass header.from=test.local";
  assert.equal(await authOf(withHeaders(forged, CF_PASS)), true);
  const realFail = "Authentication-Results: mx.cloudflare.net; dkim=fail header.d=test.local; spf=fail smtp.mailfrom=user@test.local; dmarc=fail header.from=test.local";
  const forgedCf = "Authentication-Results: mx.cloudflare.net; dmarc=pass header.from=test.local";
  assert.equal(await authOf(withHeaders(realFail, forgedCf)), false, "a lower forged mx.cloudflare.net header must not win");
});

test("dkim=pass for an unrelated domain with dmarc=fail is not aligned", async () => {
  assert.equal(await authOf(withHeaders("Authentication-Results: mx.cloudflare.net; dkim=pass header.d=evil.example header.s=x; dmarc=fail header.from=test.local")), false);
});

test("dkim=pass from a parent domain of the From subdomain is aligned", () => {
  const h = v => [{ key: "authentication-results", value: v }];
  assert.equal(authOk(h("mx.cloudflare.net; dkim=pass header.d=acme.com; dmarc=fail"), "a@mail.acme.com"), true);
  assert.equal(authOk(h("mx.cloudflare.net; dkim=pass header.d=evil.com; dmarc=fail"), "a@mail.acme.com"), false);
  assert.equal(authOk(h("mx.cloudflare.net; dkim=pass header.d=xacme.com; dmarc=fail"), "a@acme.com"), false, "suffix without a dot is not a parent");
  assert.equal(authOk(h("  MX.Cloudflare.NET; DKIM=Pass Header.D=Acme.COM"), "a@acme.com"), true, "case-insensitive");
  assert.equal(authOk(h("mx.cloudflare.net; dkim=fail header.d=evil.com; dkim=pass header.d=acme.com"), "a@acme.com"), true, "any aligned pass suffices");
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

test("email() rejects a 200 whose body is not ok, without leaking the secret", async () => {
  globalThis.fetch = async () => new Response('{"ok":false,"error":"bad secret"}', { status: 200 });
  await assert.rejects(worker.email({ from: "user@test.local", raw: new Response(RAW).body }, ENV),
    e => /bad secret/.test(e.message) && !e.message.includes("s3"));
  globalThis.fetch = async () => new Response('{"ok":false}', { status: 200 });
  await assert.rejects(worker.email({ from: "user@test.local", raw: new Response(RAW).body }, ENV));
  globalThis.fetch = async () => new Response('{"ok":true}', { status: 200 });
  await worker.email({ from: "user@test.local", raw: new Response(RAW).body }, ENV); // positive control
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
