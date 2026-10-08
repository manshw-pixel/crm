// Cloudflare Worker behind the "Book a demo" form on onevio.in. It checks the Turnstile token,
// then hands the fields to the submit_demo_request RPC together with a shared secret, so the
// database function can refuse anything that did not come through here. It keeps no state.
// Design: docs/superpowers/specs/2026-10-08-marketing-site-design.md ("Captcha: Cloudflare Turnstile")

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_ORIGINS = "https://onevio.in,https://www.onevio.in";
const MAX_BYTES = 8192;
const GENERIC = "We couldn't send that. Please try again, or email us.";
const RATE_LIMIT = "Too many requests — please email us instead.";

// The RPC's own errors are never passed through (they name internals). Each known one maps to
// text a visitor can act on. A secret mismatch ("not allowed") is an operator misconfiguration
// and falls through to the generic message on purpose.
const SAFE_MESSAGES = [
  [/name must be/i, "Please enter your name."],
  [/company must be/i, "Please enter your company."],
  [/email is not valid/i, "Please check your email address."],
  [/team size is not valid/i, "Please choose a team size."],
  [/message is too long/i, "Your message is too long."],
];

const allowedOrigins = env => String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS)
  .split(",").map(s => s.trim()).filter(Boolean);

function reply(status, body, origin) {
  const headers = { "content-type": "application/json" };
  if (origin) { headers["Access-Control-Allow-Origin"] = origin; headers["Vary"] = "Origin"; }
  return new Response(JSON.stringify(body), { status, headers });
}
const fail = (status, error, message, origin) => reply(status, { ok: false, error, message }, origin);

function safeMessage(raw) {
  const text = String(raw || "");
  if (text.includes(RATE_LIMIT)) return RATE_LIMIT;
  for (const [re, safe] of SAFE_MESSAGES) if (re.test(text)) return safe;
  return GENERIC;
}

export default {
  async fetch(request, env) {
    const reqOrigin = request.headers.get("origin") || "";
    const origin = allowedOrigins(env).includes(reqOrigin) ? reqOrigin : null;

    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
      } });
    }
    if (!origin) return fail(403, "origin", "This request is not allowed.", null);
    if (request.method !== "POST") return fail(405, "method", "Method not allowed.", origin);

    const declared = Number(request.headers.get("content-length"));
    if (declared > MAX_BYTES) return fail(413, "too_large", "That message is too large.", origin);
    const raw = new Uint8Array(await request.arrayBuffer());
    if (raw.byteLength > MAX_BYTES) return fail(413, "too_large", "That message is too large.", origin);

    let form;
    try { form = JSON.parse(new TextDecoder().decode(raw)); } catch { form = null; }
    if (!form || typeof form !== "object" || Array.isArray(form)) {
      return fail(400, "bad_json", "That request could not be read.", origin);
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.TURNSTILE_SECRET || !env.DEMO_FORM_SECRET) {
      console.error("demo-form: a required setting is missing");
      return fail(502, "unavailable", GENERIC, origin);
    }

    try {
      const verify = await fetch(SITEVERIFY, {
        method: "POST",
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET,
          response: String(form.token || ""),
          remoteip: request.headers.get("CF-Connecting-IP") || "",
        }),
      });
      const verdict = await verify.json().catch(() => ({}));
      if (!verdict.success) return fail(400, "captcha", "Please complete the check and try again.", origin);

      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/submit_demo_request`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          p_secret: env.DEMO_FORM_SECRET,
          p_name: form.name,
          p_company: form.company,
          p_email: form.email,
          p_team_size: form.team_size,
          p_message: form.message,
          p_website: form.website,
        }),
      });
      if (res.ok) return reply(200, { ok: true }, origin);
      if (res.status >= 500) return fail(502, "unavailable", GENERIC, origin);
      const err = await res.json().catch(() => ({}));
      return fail(400, "rejected", safeMessage(err && err.message), origin);
    } catch {
      return fail(502, "unavailable", GENERIC, origin);
    }
  },
};
