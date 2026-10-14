// Pure: results.json + history + analysis -> one self-contained HTML string. Every interpolated
// value goes through esc(): scenario titles, errors and analysis text come from the live app and
// from model output, so none of it is trusted markup.
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CSS = `
:root{--bg:#f8fafc;--card:#fff;--text:#0f172a;--muted:#64748b;--border:#e2e8f0;--pass:#15803d;--pass-bg:#dcfce7;--fail:#b91c1c;--fail-bg:#fee2e2;--flaky:#a16207;--flaky-bg:#fef9c3;--skip:#64748b;--skip-bg:#f1f5f9;--accent:#4f46e5}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#0b1120;--card:#111827;--text:#e5e7eb;--muted:#94a3b8;--border:#1f2937;--pass:#4ade80;--pass-bg:#052e16;--fail:#f87171;--fail-bg:#450a0a;--flaky:#facc15;--flaky-bg:#422006;--skip:#94a3b8;--skip-bg:#1e293b;--accent:#818cf8}}
:root[data-theme="dark"]{--bg:#0b1120;--card:#111827;--text:#e5e7eb;--muted:#94a3b8;--border:#1f2937;--pass:#4ade80;--pass-bg:#052e16;--fail:#f87171;--fail-bg:#450a0a;--flaky:#facc15;--flaky-bg:#422006;--skip:#94a3b8;--skip-bg:#1e293b;--accent:#818cf8}
*{box-sizing:border-box}html,body{overflow-x:hidden}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:960px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}
.meta{color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.verdict{border-radius:10px;padding:14px 16px;margin:12px 0;font-size:18px;font-weight:700}
.verdict.pass{background:var(--pass-bg);color:var(--pass)}.verdict.fail{background:var(--fail-bg);color:var(--fail)}
.verdict small{font-weight:500;font-size:13px;margin-left:8px}
.hist{display:flex;gap:3px;flex-wrap:wrap}.hist span{width:14px;height:22px;border-radius:3px;display:inline-block}
.hist .pass{background:var(--pass)}.hist .fail{background:var(--fail)}.hist .flaky{background:var(--flaky)}
details{background:var(--card);border:1px solid var(--border);border-radius:8px;margin:6px 0;padding:8px 12px}
summary{cursor:pointer;font-weight:600}
table{width:100%;border-collapse:collapse;table-layout:fixed}td{padding:4px 6px;border-top:1px solid var(--border);vertical-align:top;overflow-wrap:anywhere}
.st{display:inline-block;border-radius:999px;padding:0 8px;font-size:12px;font-weight:600}
.st.pass{background:var(--pass-bg);color:var(--pass)}.st.fail{background:var(--fail-bg);color:var(--fail)}
.st.flaky{background:var(--flaky-bg);color:var(--flaky)}.st.skipped{background:var(--skip-bg);color:var(--skip)}
tr.skipped td{color:var(--skip)}
.badge{display:inline-block;border-radius:4px;padding:0 6px;font-size:11px;font-weight:700;margin-left:6px;border:1px solid currentColor}
.badge.new{color:var(--fail)}.badge.fixed{color:var(--pass)}
.card{background:var(--card);border:1px solid var(--border);border-left:4px solid var(--fail);border-radius:8px;padding:12px;margin:10px 0}
.card pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);padding:8px;border-radius:6px;margin:6px 0}
.card img{max-width:100%;height:auto;border:1px solid var(--border);border-radius:6px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 10px;margin:6px 0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
footer{color:var(--muted);font-size:12px;margin-top:24px;border-top:1px solid var(--border);padding-top:8px}
`;

export function renderReport(results, history = [], analysis = {}) {
  // Callers may pass the whole history.json, which already contains this run: drop it so it is
  // neither the diff baseline nor a duplicate cell in the strip.
  history = (history || []).filter(h => h.runId !== results.runId);
  const s = results.summary || {};
  const rows = results.results || [];
  const prev = history.at(-1);
  const prevFailed = new Set(prev?.failedIds || []);
  const failed = rows.filter(r => r.status === "fail");
  const failedNow = new Set(failed.map(r => r.id));
  const extra = [s.flaky ? `${s.flaky} flaky` : "", s.skipped ? `${s.skipped} skipped` : ""].filter(Boolean).join(" · ");
  const verdict = s.fail
    ? `<div class="verdict fail">${esc(s.fail)} of ${esc(s.total)} failed<small>${esc(extra)}</small></div>`
    : `<div class="verdict pass">PASS<small>${esc(`${s.pass ?? 0} of ${s.total ?? 0} passed`)}${extra ? " · " + esc(extra) : ""}</small></div>`;

  const badge = r => {
    if (!prev) return "";
    if (r.status === "fail" && !prevFailed.has(r.id)) return `<span class="badge new">New failure</span>`;
    if (r.status !== "fail" && r.status !== "skipped" && prevFailed.has(r.id)) return `<span class="badge fixed">Fixed since last run</span>`;
    return "";
  };

  const features = [...new Set(rows.map(r => r.feature))];
  const featureHtml = features.map(f => {
    const fr = rows.filter(r => r.feature === f);
    const c = st => fr.filter(r => r.status === st).length;
    const counts = [`${c("pass")} pass`, c("flaky") && `${c("flaky")} flaky`, c("fail") && `${c("fail")} fail`, c("skipped") && `${c("skipped")} skipped`].filter(Boolean).join(" · ");
    const trs = fr.map(r => `<tr class="${esc(r.status)}"><td style="width:90px"><span class="st ${esc(r.status)}">${esc(r.status)}</span></td><td>${esc(r.title)}${badge(r)}<div class="meta">${esc(r.id)}${r.reason ? " · " + esc(r.reason) : ""}</div></td></tr>`).join("");
    return `<details${c("fail") ? " open" : ""}><summary>${esc(f)} <span class="meta">${esc(counts)}</span></summary><table>${trs}</table></details>`;
  }).join("");

  const cards = failed.map(r => {
    const a = analysis[r.id];
    const shot = r.artifacts?.screenshot ? `<img src="shots/${esc(r.artifacts.screenshot)}" alt="${esc(`Screenshot of ${r.title}`)}">` : "";
    const an = a ? `<dl><dt>Cause</dt><dd>${esc(a.cause)}</dd><dt>Where</dt><dd><code>${esc(a.fileLine)}</code></dd><dt>Fix</dt><dd>${esc(a.fix)}</dd><dt>Confidence</dt><dd>${esc(a.confidence)}</dd></dl>` : "";
    return `<div class="card"><strong>${esc(r.title)}</strong>${badge(r)}<div class="meta">${esc(r.id)}</div><pre>${esc(r.error)}</pre>${an}${shot}</div>`;
  }).join("");

  const fixed = prev ? [...prevFailed].filter(id => !failedNow.has(id) && rows.some(r => r.id === id && r.status !== "skipped")) : [];
  const hist = [...history.slice(-19), { runId: results.runId, summary: s }].map(h => {
    const hs = h.summary || {};
    const cls = hs.fail ? "fail" : hs.flaky ? "flaky" : "pass";
    return `<span class="${cls}" title="${esc(`${h.runId}: ${hs.pass ?? 0} pass, ${hs.fail ?? 0} fail`)}"></span>`;
  }).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA Report</title><style>${CSS}</style></head><body><main>
<h1>QA run ${esc(results.runId)}</h1><div class="meta">live ${esc(results.liveVersion)} · finished ${esc(results.finishedAt)}</div>
${verdict}
<h2>History</h2><div class="hist">${hist}</div>
${failed.length ? `<h2>Failures</h2>${cards}` : ""}
${fixed.length ? `<div class="meta">${esc(fixed.length)} fixed since last run</div>` : ""}
<h2>Features</h2>${featureHtml}
<footer>${(results.notes || []).map(n => `<div>${esc(n)}</div>`).join("")}</footer>
</main></body></html>`;
}
