// CLI: node tests/qa/report/build.mjs [runId]  (default: the newest run in tests/qa/out/)
// Renders out/<runId>/report.html from results.json + out/history.json + optional analysis.json.
// Screenshots stay in out/<runId>/shots/ and are referenced as shots/<file>.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderReport } from "./render.mjs";

// Pure: run ids sort lexically by time (qa-YYYYMMDD-HHMM). With isFull, pick the newest FULL run
// (no --feature, at least one result) so a quick feature rerun is not mistaken for the suite.
export const latestRunId = (names, isFull = () => true) =>
  names.filter(n => /^qa-\d{8}-\d{4}$/.test(n)).sort().reverse().find(isFull) ?? null;
const fullRun = outDir => id => {
  const f = `${outDir}/${id}/results.json`;
  if (!existsSync(f)) return false;
  const r = JSON.parse(readFileSync(f, "utf8"));
  return r.feature == null && (r.results || []).length > 0;
};

export function buildReport(outDir, runId) {
  const readJson = (f, dflt) => existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : dflt;
  runId ??= latestRunId(existsSync(outDir) ? readdirSync(outDir) : [], fullRun(outDir));
  if (!runId) throw new Error(`no full runs in ${outDir}`);
  const dir = `${outDir}/${runId}`;
  if (!existsSync(`${dir}/results.json`)) throw new Error(`${dir}/results.json not found`);
  const html = renderReport(readJson(`${dir}/results.json`), readJson(`${outDir}/history.json`, []), readJson(`${dir}/analysis.json`, {}));
  writeFileSync(`${dir}/report.html`, html);
  return { runId, path: `${dir}/report.html` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { const b = buildReport(fileURLToPath(new URL("../out", import.meta.url)), process.argv[2]); console.log(`built ${b.runId}: ${b.path}`); }
  catch (e) { console.error(e.message); process.exit(1); }
}
