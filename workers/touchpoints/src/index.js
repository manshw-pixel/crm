// Cloudflare Email Worker for touchpoints@<domain>. It does no matching and keeps no state:
// it turns the raw email into the p_message shape and hands it to ingest_touchpoint, where
// every decision (who may file, which account, bounce or not) is made.
// Design: docs/superpowers/specs/2026-10-05-email-touchpoint-ingest-design.md
import PostalMime from "postal-mime";

const addrs = list => (list || [])
  .flatMap(a => (a.group ? a.group : [a]))
  .map(a => (a.address || "").trim().toLowerCase())
  .filter(Boolean);

const htmlToText = html => (html || "")
  .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const sha256 = async buf => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))]
  .map(b => b.toString(16).padStart(2, "0")).join("");

// Only the two headers the loop guard reads. Forwarding every header would ship customer
// metadata into a function that has no use for it.
const KEPT_HEADERS = ["auto-submitted", "precedence"];

// Identity is the From header, which anyone can write. What makes it trustworthy is the
// verdict Cloudflare Email Routing stamps on arrival. Only the FIRST Authentication-Results
// header from mx.cloudflare.net counts: it is the one Cloudflare prepended, and headers
// below it arrived with the message, so the sender could have forged them (RFC 8601 s5).
// Pass = dmarc=pass, or a dkim=pass whose header.d is the From domain or a parent of it.
export function authOk(headers, fromAddr) {
  const h = (headers || []).find(x => (x.key || "").toLowerCase() === "authentication-results"
    && /^\s*mx\.cloudflare\.net(\s|;|$)/i.test(x.value || ""));
  if (!h) return false;
  const fromDomain = String(fromAddr || "").toLowerCase().split("@").pop();
  if (!fromDomain) return false;
  return h.value.toLowerCase().split(";").slice(1).some(part => {
    if (/^\s*dmarc\s*=\s*pass\b/.test(part)) return true;
    if (!/^\s*dkim\s*=\s*pass\b/.test(part)) return false;
    const d = (part.match(/\bheader\.d\s*=\s*"?([a-z0-9.-]+)/) || [])[1];
    return !!d && (fromDomain === d || fromDomain.endsWith("." + d));
  });
}

export async function toMessage(parsed, envelopeFrom, raw) {
  const headers = {};
  for (const h of parsed.headers || []) {
    const k = (h.key || "").toLowerCase();
    if (KEPT_HEADERS.includes(k)) headers[k] = h.value;
  }
  const from = ((parsed.from && parsed.from.address) || envelopeFrom || "").toLowerCase();
  const date = parsed.date ? new Date(parsed.date) : null;
  return {
    // No Message-ID is rare but legal. A hash of the bytes keeps a retry idempotent.
    message_id: parsed.messageId || `<cf-${await sha256(raw)}@touchpoints>`,
    from,
    to: addrs(parsed.to),
    cc: addrs(parsed.cc),
    date: date && !isNaN(date) ? date.toISOString() : null,
    subject: parsed.subject || "",
    text: parsed.text || htmlToText(parsed.html),
    headers,
    auth_ok: authOk(parsed.headers, from),
  };
}

export default {
  async email(message, env) {
    for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "TOUCHPOINT_SECRET"]) {
      if (!env || !env[k]) throw new Error(`Worker setting ${k} is missing`);
    }
    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await PostalMime.parse(raw);
    const p_message = await toMessage(parsed, message.from, raw);
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/ingest_touchpoint`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_secret: env.TOUCHPOINT_SECRET, p_message }),
    });
    // Throwing makes Cloudflare refuse the message temporarily, so the sending server
    // retries later. Safe: ingest_touchpoint is idempotent on message_id.
    if (!res.ok) throw new Error(`ingest_touchpoint returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    // A 200 can still be a refusal ({ok:false, error:'bad secret'}). Swallowing it would drop
    // the mail silently; throwing surfaces it in the Worker logs. The secret is never echoed.
    let out = null;
    try { out = await res.json(); } catch { /* not JSON: treated as a refusal below */ }
    if (!out || typeof out !== "object" || out.ok !== true) {
      const err = out && typeof out === "object" && out.error ? String(out.error).slice(0, 200) : "no ok:true in response";
      throw new Error(`ingest_touchpoint refused the message: ${err.split(env.TOUCHPOINT_SECRET).join("***")}`);
    }
  },
};
