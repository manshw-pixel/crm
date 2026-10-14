// CLI: node tests/qa/report/build.mjs [runId]  (default: the newest run in tests/qa/out/)
// Renders out/<runId>/report.html from results.json + out/history.json + optional analysis.json.
// Screenshots stay in out/<runId>/shots/ and are referenced as shots/<file>.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderReport } from "./render.mjs";

// Pure: run ids sort lexically by time (qa-YYYYMMDD-HHMM); pick the newest.
export const latestRunId = names => names.filter(n => /^qa-\d{8}-\d{4}$/.test(n)).sort().at(-1) ?? null;

export function buildReport(outDir, runId) {
  const readJson = (f, dflt) => existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : dflt;
  runId ??= latestRunId(existsSync(outDir) ? readdirSync(outDir) : []);
  if (!runId) throw new Error(`no runs in ${outDir}`);
  const dir = `${outDir}/${runId}`;
  if (!existsSync(`${dir}/results.json`)) throw new Error(`${dir}/results.json not found`);
  const html = renderReport(readJson(`${dir}/results.json`), readJson(`${outDir}/history.json`, []), readJson(`${dir}/analysis.json`, {}));
  writeFileSync(`${dir}/report.html`, html);
  return `${dir}/report.html`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { console.log(buildReport(fileURLToPath(new URL("../out", import.meta.url)), process.argv[2])); }
  catch (e) { console.error(e.message); process.exit(1); }
}
