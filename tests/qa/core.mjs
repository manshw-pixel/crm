// Pure runner core: no browser, no network. run.mjs supplies makeCtx (which opens pages)
// and onFail (which takes screenshots); everything here is unit-tested in isolation.
export class GuardError extends Error {}

const pad = n => String(n).padStart(2, "0");
export const makeRunId = (d = new Date()) =>
  `qa-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

// A scenario's own `skip` reason wins; otherwise AM scenarios skip when no AM user is configured.
export const skipReason = (s, env) => s.skip ?? ((s.role === "am" && !env.users.am) ? "no AM user configured" : null);

// Thrown by a scenario to record itself "skipped" at runtime (e.g. a precondition the org
// doesn't meet). No retry, no onFail; the message is the skip reason.
export class SkipScenario extends Error {}

export async function runScenarios(scenarios, makeCtx, { onFail, skip } = {}) {
  const results = [];
  for (const s of scenarios) {
    const reason = skip?.(s);
    if (reason) {
      results.push({ id: s.id, feature: s.feature, title: s.title, status: "skipped", attempts: 0, ms: 0, reason });
      continue;
    }
    const t0 = Date.now();
    let lastErr, artifacts;
    const errs = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      let ctx;
      try {
        ctx = await makeCtx(s);
        await s.run(ctx);
        results.push({ id: s.id, feature: s.feature, title: s.title, status: attempt === 1 ? "pass" : "flaky", attempts: attempt, ms: Date.now() - t0 });
        lastErr = null;
        break;
      } catch (err) {
        if (err instanceof GuardError) { err.results = results; throw err; }
        if (err instanceof SkipScenario && lastErr) {
          // A retry that skips must not hide attempt 1's failure (e.g. attempt 1 did the write).
          lastErr = new Error(`${lastErr.message || lastErr} (skipped on retry after failure: ${err.message})`);
          if (onFail) artifacts = await onFail(s, ctx, lastErr, attempt).catch(() => undefined);
          break;
        }
        if (err instanceof SkipScenario) {
          results.push({ id: s.id, feature: s.feature, title: s.title, status: "skipped", attempts: 1, ms: Date.now() - t0, reason: err.message });
          lastErr = null;
          break;
        }
        lastErr = err;
        errs.push(String(err?.message || err));
        if (attempt === 2 && onFail) artifacts = await onFail(s, ctx, err, attempt).catch(() => undefined);
      } finally {
        await ctx?.close?.().catch(() => {});
      }
    }
    if (lastErr) {
      const r = { id: s.id, feature: s.feature, title: s.title, status: "fail", attempts: 2, ms: Date.now() - t0, error: String(lastErr.message || lastErr), artifacts };
      // Both attempts failed differently: keep each, since attempt 1's error is often the real cause.
      if (errs.length === 2 && errs[0] !== errs[1]) r.errors = errs;
      results.push(r);
    }
  }
  return results;
}

export function summarise(results) {
  const byFeature = {};
  for (const r of results) {
    const f = (byFeature[r.feature] ??= { pass: 0, fail: 0, flaky: 0, skipped: 0 });
    f[r.status]++;
  }
  const count = s => results.filter(r => r.status === s).length;
  return { total: results.length, pass: count("pass"), fail: count("fail"), flaky: count("flaky"), skipped: count("skipped"), byFeature };
}

// Replace every configured password in text before it is written to results/report/console.
export function redact(text, env) {
  let s = String(text ?? "");
  for (const u of Object.values(env?.users || {})) if (u?.pass) s = s.split(u.pass).join("[redacted]");
  return s;
}

// --skip-reset reuses the accounts of the most recent run that DID reset (its seedRunId).
// Older history entries without seedRunId are not trusted.
export const latestSeedRunId = history => [...(history || [])].reverse().find(h => h?.seedRunId)?.seedRunId ?? null;

// Every free-text field of a result that can carry app/console text goes through redact before it is written.
export function redactResult(r, clean) {
  if (r.error) r.error = clean(r.error);
  if (r.errors) r.errors = r.errors.map(clean);
  if (r.reason) r.reason = clean(r.reason);
  return r;
}
