// Demo requests from onevio.in. The public anon key reaches submit_demo_request, so the shared
// secret (held only by the demo-form Worker) is what keeps bots that skip Turnstile out.
import { test, assert } from "../health/framework.mjs";
import { sessions, sql } from "./fixtures.mjs";

const SECRET = "test-demo-secret-0123456789";
const setSecret = s => sql(`insert into public.demo_form_config (id, secret) values (1, $1)
  on conflict (id) do update set secret = excluded.secret`, [s]);
const args = (o = {}) => ({ p_secret: SECRET, p_name: "Asha Menon", p_company: "Kestrel Analytics",
  p_email: `asha+${Date.now()}${Math.random().toString(36).slice(2, 6)}@kestrel.test`, p_team_size: "6–20",
  p_message: "Renewals", p_website: "", ...o });
const count = async email => (await sql(`select count(*)::int n from demo_requests where email = $1`, [email]))[0].n;
const clean = () => sql(`delete from demo_requests where email like '%@kestrel.test'`);

test("submit needs the shared secret; with it, the request is stored", async () => {
  try {
    await setSecret(SECRET);
    const none = args({ p_secret: null }), wrong = args({ p_secret: "nope" }), good = args();
    const r1 = await sessions.anon.rpc("submit_demo_request", none);
    const r2 = await sessions.anon.rpc("submit_demo_request", wrong);
    assert(r1.error && r2.error, `refused without/with wrong secret: ${JSON.stringify([r1, r2])}`);
    assert(await count(none.p_email) === 0 && await count(wrong.p_email) === 0, "a request was stored without the secret");
    const ok = await sessions.anon.rpc("submit_demo_request", good);
    assert(!ok.error && ok.data === "ok", `control: right secret failed: ${ok.error?.message}`);
    assert(await count(good.p_email) === 1, "request not stored");
  } finally { await clean(); }
});

test("an empty configured secret refuses everything", async () => {
  try {
    await setSecret("");
    const r = await sessions.anon.rpc("submit_demo_request", args({ p_secret: "" }));
    assert(r.error, "empty secret accepted");
  } finally { await setSecret(SECRET); await clean(); }
});

test("honeypot: a filled website field stores nothing but returns ok", async () => {
  try {
    await setSecret(SECRET);
    const a = args({ p_website: "http://spam.example" });
    const r = await sessions.anon.rpc("submit_demo_request", a);
    assert(!r.error && r.data === "ok", JSON.stringify(r));
    assert(await count(a.p_email) === 0, "honeypot submission stored");
  } finally { await clean(); }
});

test("validation rejects bad fields", async () => {
  await setSecret(SECRET);
  const bad = [{ p_name: "" }, { p_name: "x".repeat(121) }, { p_company: "  " }, { p_email: "not-an-email" },
    { p_team_size: "huge" }, { p_message: "x".repeat(2001) }];
  try {
    for (const b of bad) {
      const r = await sessions.anon.rpc("submit_demo_request", args(b));
      assert(r.error && /submit_demo_request:/.test(r.error.message), `accepted ${JSON.stringify(b)}: ${JSON.stringify(r)}`);
    }
    const ok = await sessions.anon.rpc("submit_demo_request", args({ p_team_size: null, p_message: null }));
    assert(!ok.error, `control: optional fields null failed: ${ok.error?.message}`);
  } finally { await clean(); }
});

test("rate limit: a 4th request from one email in 24h is refused", async () => {
  try {
    await setSecret(SECRET);
    const email = `limit${Date.now()}@kestrel.test`;
    for (let i = 0; i < 3; i++) {
      const r = await sessions.anon.rpc("submit_demo_request", args({ p_email: email }));
      assert(!r.error, `request ${i + 1} refused: ${r.error?.message}`);
    }
    const r4 = await sessions.anon.rpc("submit_demo_request", args({ p_email: email }));
    assert(r4.error && /Too many requests/.test(r4.error.message), `4th not refused: ${JSON.stringify(r4)}`);
  } finally { await clean(); }
});

test("nobody reads demo_requests directly; only the platform admin can list", async () => {
  try {
    await setSecret(SECRET);
    const a = args(); await sessions.anon.rpc("submit_demo_request", a);
    for (const s of ["anon", "admin", "user"]) {
      const { data } = await sessions[s].from("demo_requests").select("*");
      assert((data || []).length === 0, `${s} read demo_requests directly`);
    }
    const denied = await sessions.admin.rpc("list_demo_requests");
    assert(denied.error && /platform admin only/.test(denied.error.message), `org admin listed: ${JSON.stringify(denied)}`);
    const { data, error } = await sessions.platform.rpc("list_demo_requests");
    assert(!error && data.some(r => r.email === a.p_email), `control: platform admin cannot list: ${error?.message}`);
  } finally { await clean(); }
});
