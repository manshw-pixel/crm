/* ------------------------------ error reporting ------------------------------
   Everything below runs when the app is ALREADY broken, so every branch here is written
   to fail quietly rather than to be clever. */

// Collapse volatile substrings so the same bug fingerprints identically across
// occurrences: ids, uuids, numbers and quoted values differ per instance and would
// otherwise produce a new row every time, defeating the whole point of the count.
const fingerprintOf = (level, message, where) => {
  const norm = String(message || "")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "<uuid>")
    .replace(/\d+/g, "<n>")
    .replace(/'[^']*'/g, "'<v>'")
    .slice(0, 200);
  return `${level}|${where || "-"}|${norm}`;
};

const REPORT_THROTTLE_MS = 10000;
const reportedAt = new Map();
let reporting = false;

function reportError(level, error, context) {
  try {
    // Re-entrancy guard: an error raised INSIDE reporting must not report itself.
    if (reporting) return;
    const message = String((error && error.message) || error || "unknown");
    const where = (context && (context.view || context.table)) || null;
    const fingerprint = fingerprintOf(level, message, where);

    // Postgres dedupes by fingerprint anyway; this stops a tight failure loop emitting a
    // request per occurrence to get there. `retry` is a captured level and a flaky
    // connection produces those in bursts.
    const now = Date.now();
    const last = reportedAt.get(fingerprint);
    if (last && now - last < REPORT_THROTTLE_MS) return;
    reportedAt.set(fingerprint, now);

    reporting = true;
    try {
      // Deliberately NOT writeQueue.enqueue: the queue's failure is one of the things
      // reported here, and a failing queue must not report by using the failing queue.
      // p_ prefixes: every argument name collides with a column of error_log, and an
      // unprefixed parameter makes the function's own insert ambiguous at runtime.
      const p = sb.rpc("log_error", {
        p_fingerprint: fingerprint, p_level: level, p_message: message,
        p_stack: (error && error.stack) ? String(error.stack).slice(0, 4000) : null,
        p_context: context || {},
        p_app_version: APP_VERSION,
        p_user_agent: navigator.userAgent,
      });
      // Swallow both shapes: supabase-js REJECTS on network/CORS and RESOLVES { error }
      // otherwise. There is nowhere better to send a failure to report a failure.
      if (p && p.then) p.then(() => {}, () => {});
    } finally {
      reporting = false;
    }
  } catch (e) {
    // Never let reporting convert a handled error into an unhandled one.
  }
}

