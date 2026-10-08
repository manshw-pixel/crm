// The demo-form Worker under plain node: fetch is replaced with a recorder, so this never
// touches Turnstile or Supabase.
import assert from "node:assert/strict";
import worker from "../../workers/demo-form/src/index.js";

const ENV = {
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon",
  TURNSTILE_SECRET: "ts-secret-111", DEMO_FORM_SECRET: "df-secret-222",
};
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RPC = "https://x.supabase.co/rest/v1/rpc/submit_demo_request";
const GENERIC = "We couldn't send that. Please try again, or email us.";
const FORM = { name: "Asha", company: "Acme", email: "asha@acme.example", team_size: "11-50", message: "Hi", website: "", token: "tok-1" };

const post = (body, origin = "https://onevio.in", extra = {}) => new Request("https://demo.workers.dev/", {
  method: "POST",
  headers: { origin, "content-type": "application/json", "CF-Connecting-IP": "203.0.113.9", ...extra },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

// Routes fetch by URL and records every call.
function stub({ captcha = { success: true }, rpc = () => new Response('"ok"', { status: 200 }) } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) === SITEVERIFY) return new Response(JSON.stringify(captcha), { status: 200 });
    if (String(url) === RPC) return rpc();
    throw new Error("unexpected fetch " + url);
  };
  return calls;
}
// Every response body, checked for leaked secrets.
const seen = [];
async function run(req, env = ENV) {
  const res = await worker.fetch(req, env);
  const text = await res.clone().text();
  seen.push(text);
  return { res, text, json: text ? JSON.parse(text) : null };
}
const rpcErr = message => () => new Response(JSON.stringify({ message, code: "P0001" }), { status: 400 });

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("OPTIONS preflight from an allowed origin returns 204 with CORS headers", async () => {
  const calls = stub();
  const { res } = await run(new Request("https://demo.workers.dev/", { method: "OPTIONS", headers: { origin: "https://onevio.in" } }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://onevio.in");
  assert.equal(res.headers.get("Access-Control-Allow-Methods"), "POST");
  assert.equal(res.headers.get("Access-Control-Allow-Headers"), "content-type");
  assert.equal(calls.length, 0);
});

test("OPTIONS preflight from another origin is 403 with no ACAO header", async () => {
  stub();
  const { res } = await run(new Request("https://demo.workers.dev/", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
});

test("POST from a disallowed origin is 403 origin and never calls fetch", async () => {
  const calls = stub();
  const { res, json } = await run(post(FORM, "https://evil.example"));
  assert.equal(res.status, 403);
  assert.equal(json.error, "origin");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(calls.length, 0);
});

test("a POST with no Origin header is refused", async () => {
  const calls = stub();
  const req = new Request("https://demo.workers.dev/", { method: "POST", body: JSON.stringify(FORM) });
  const { res, json } = await run(req);
  assert.equal(res.status, 403);
  assert.equal(json.error, "origin");
  assert.equal(calls.length, 0);
});

test("www.onevio.in is allowed by default; ALLOWED_ORIGINS overrides", async () => {
  stub();
  const a = await run(post(FORM, "https://www.onevio.in"));
  assert.equal(a.res.status, 200);
  const env = { ...ENV, ALLOWED_ORIGINS: "https://staging.example, https://other.example" };
  const b = await run(post(FORM, "https://onevio.in"), env);
  assert.equal(b.res.status, 403, "default list is replaced, not extended");
  const c = await run(post(FORM, "https://staging.example"), env);
  assert.equal(c.res.status, 200);
  assert.equal(c.res.headers.get("Access-Control-Allow-Origin"), "https://staging.example");
});

test("GET is 405", async () => {
  stub();
  const { res, json } = await run(new Request("https://demo.workers.dev/", { method: "GET", headers: { origin: "https://onevio.in" } }));
  assert.equal(res.status, 405);
  assert.equal(json.error, "method");
});

test("a body over 8192 bytes is 413 and never calls fetch", async () => {
  const calls = stub();
  const { res, json } = await run(post({ ...FORM, message: "x".repeat(9000) }));
  assert.equal(res.status, 413);
  assert.equal(json.error, "too_large");
  assert.equal(calls.length, 0);
});

test("the size limit counts bytes, not characters", async () => {
  const calls = stub();
  const { res } = await run(post({ ...FORM, message: "€".repeat(3000) })); // 3000 chars, 9000 bytes
  assert.equal(res.status, 413);
  assert.equal(calls.length, 0);
});

test("invalid JSON is 400 bad_json", async () => {
  const calls = stub();
  const { res, json } = await run(post("{not json"));
  assert.equal(res.status, 400);
  assert.equal(json.error, "bad_json");
  const arr = await run(post("[1]"));
  assert.equal(arr.json.error, "bad_json", "a non-object body is also bad_json");
  assert.equal(calls.length, 0);
});

test("a failed Turnstile check is 400 captcha and the RPC is not called", async () => {
  const calls = stub({ captcha: { success: false } });
  const { res, json } = await run(post(FORM));
  assert.equal(res.status, 400);
  assert.equal(json.error, "captcha");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SITEVERIFY);
  const form = new URLSearchParams(String(calls[0].init.body));
  assert.equal(form.get("secret"), "ts-secret-111");
  assert.equal(form.get("response"), "tok-1");
  assert.equal(form.get("remoteip"), "203.0.113.9");
});

test("a missing token never reaches the RPC", async () => {
  const calls = stub({ captcha: { success: false } });
  const { json } = await run(post({ ...FORM, token: undefined }));
  assert.equal(json.error, "captcha");
  assert.equal(calls.every(c => c.url !== RPC), true);
});

test("success calls the RPC with the anon key, the shared secret and mapped fields", async () => {
  const calls = stub();
  const { res, json } = await run(post(FORM));
  assert.equal(res.status, 200);
  assert.deepEqual(json, { ok: true });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://onevio.in");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, RPC);
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.headers.apikey, "anon");
  assert.equal(calls[1].init.headers.Authorization, "Bearer anon");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    p_secret: "df-secret-222", p_name: "Asha", p_company: "Acme", p_email: "asha@acme.example",
    p_team_size: "11-50", p_message: "Hi", p_website: "",
  });
});

test("RPC validation errors map to safe messages", async () => {
  const table = [
    ["submit_demo_request: name must be 1-200 characters", "Please enter your name."],
    ["submit_demo_request: company must be 1-200 characters", "Please enter your company."],
    ["submit_demo_request: email is not valid", "Please check your email address."],
    ["submit_demo_request: team size is not valid", "Please choose a team size."],
    ["submit_demo_request: message is too long", "Your message is too long."],
    ["Too many requests — please email us instead.", "Too many requests — please email us instead."],
  ];
  for (const [raw, safe] of table) {
    stub({ rpc: rpcErr(raw) });
    const { res, json } = await run(post(FORM));
    assert.equal(res.status, 400, raw);
    assert.equal(json.error, "rejected");
    assert.equal(json.message, safe);
  }
});

test("an unknown RPC error and a secret mismatch both give the generic message", async () => {
  for (const raw of ["something exploded: relation x does not exist", "submit_demo_request: not allowed"]) {
    stub({ rpc: rpcErr(raw) });
    const { res, json } = await run(post(FORM));
    assert.equal(res.status, 400);
    assert.equal(json.error, "rejected");
    assert.equal(json.message, GENERIC);
  }
});

test("an unreachable RPC, or a 5xx from it, is 502 unavailable", async () => {
  stub({ rpc: () => { throw new Error("network down"); } });
  let r = await run(post(FORM));
  assert.equal(r.res.status, 502);
  assert.equal(r.json.error, "unavailable");
  stub({ rpc: () => new Response("boom", { status: 503 }) });
  r = await run(post(FORM));
  assert.equal(r.res.status, 502);
  assert.equal(r.json.error, "unavailable");
});

test("an unreachable Turnstile is 502 unavailable", async () => {
  globalThis.fetch = async () => { throw new Error("down"); };
  const { res, json } = await run(post(FORM));
  assert.equal(res.status, 502);
  assert.equal(json.error, "unavailable");
});

test("a hung upstream times out as 502 unavailable (siteverify hang makes no RPC call)", async () => {
  const realTimeout = AbortSignal.timeout;
  AbortSignal.timeout = () => realTimeout.call(AbortSignal, 20);
  const keepAlive = setInterval(() => {}, 50); // Node unrefs timeout signals; keep the loop alive
  try {
    const calls = [];
    const hang = (url, init) => new Promise((_, reject) => {
      calls.push(String(url));
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });
    globalThis.fetch = hang;
    let r = await run(post(FORM));
    assert.equal(r.res.status, 502);
    assert.equal(r.json.error, "unavailable");
    assert.deepEqual(calls, [SITEVERIFY]);
    globalThis.fetch = (url, init) => String(url) === SITEVERIFY
      ? Promise.resolve(new Response('{"success":true}')) : hang(url, init);
    r = await run(post(FORM));
    assert.equal(r.res.status, 502);
    assert.equal(r.json.error, "unavailable");
  } finally { AbortSignal.timeout = realTimeout; clearInterval(keepAlive); }
});

test("a truthy but non-true success is a captcha failure", async () => {
  for (const success of ["true", 1, {}]) {
    const calls = stub({ captcha: { success } });
    const { res, json } = await run(post(FORM));
    assert.equal(res.status, 400);
    assert.equal(json.error, "captcha");
    assert.equal(calls.length, 1);
  }
});

test("a 5xx or non-JSON siteverify answer is unavailable, not captcha", async () => {
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response("oops", { status: 503 }); };
  const { res, json } = await run(post(FORM));
  assert.equal(res.status, 502);
  assert.equal(json.error, "unavailable");
  assert.deepEqual(calls, [SITEVERIFY]);
});

test("missing settings is 502 unavailable, not a crash", async () => {
  const calls = stub();
  const { res, json } = await run(post(FORM), {});
  assert.equal(res.status, 502);
  assert.equal(json.error, "unavailable");
  assert.equal(calls.length, 0);
});

test("no response body ever contains a secret", () => {
  assert.ok(seen.length > 10, "the earlier cases ran");
  for (const t of seen) {
    assert.ok(!t.includes("ts-secret-111"), t);
    assert.ok(!t.includes("df-secret-222"), t);
  }
});

let fail = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log("PASS", name); }
  catch (e) { fail++; console.error("FAIL", name, "\n  ", e.message); }
}
console.log(`\n${cases.length - fail} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
