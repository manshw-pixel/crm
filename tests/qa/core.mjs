// Pure runner core: no browser, no network. run.mjs supplies makeCtx (which opens pages)
// and onFail (which takes screenshots); everything here is unit-tested in isolation.
export class GuardError extends Error {}

const pad = n => String(n).padStart(2, "0");
export const makeRunId = (d = new Date()) =>
  `qa-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

// A scenario's own `skip` reason wins; otherwise AM scenarios skip when no AM user is configured.
export const skipReason = (s, env) => s.skip ?? ((s.role === "am" && !env.users.am) ? "no AM user configured" : null);

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
        lastErr = err;
        if (attempt === 2 && onFail) artifacts = await onFail(s, ctx, err, attempt).catch(() => undefined);
      } finally {
        await ctx?.close?.().catch(() => {});
      }
    }
    if (lastErr) results.push({ id: s.id, feature: s.feature, title: s.title, status: "fail", attempts: 2, ms: Date.now() - t0, error: String(lastErr.message || lastErr), artifacts });
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
