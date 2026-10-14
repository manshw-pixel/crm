// QA agent entry point. Order is load-bearing: pre-flight and the org guard both run
// before reset, because reset is the first thing that writes.
//
// Exit codes:
//   0  all scenarios pass/flaky/skipped
//   1  at least one scenario failed
//   2  org guard abort (signed in to the wrong org) -- nothing further ran
//   3  pre-flight / usage: bad args, git fetch failed, site unreachable, live != master,
//      no feature matches, or out/<runId>/ already exists (same-minute rerun)
//   4  run aborted (infrastructure): an unexpected error after pre-flight (CSM-name read,
//      reset, write queue, browser) -- results.json still written with an "aborted:" note
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loadQaEnv } from "./env.mjs";
import { makeRunId, runScenarios, summarise, GuardError, redact } from "./core.mjs";
import { parseLiveVersion, checkVersion } from "./guard.mjs";
import { signIn } from "./session.mjs";
import { resetQaOrg } from "./reset.mjs";

const preflightFail = msg => { console.error(`pre-flight: ${msg}`); process.exit(3); };
const args = process.argv.slice(2);
let feature = null;
if (args.includes("--feature")) {
  feature = args[args.indexOf("--feature") + 1];
  if (!feature || feature.startsWith("--")) { console.error("usage: node tests/qa/run.mjs [--feature <prefix>] [--skip-reset]"); process.exit(3); }
}
const skipReset = args.includes("--skip-reset");
const OUT = new URL("./out/", import.meta.url);

const env = loadQaEnv();
const clean = t => redact(t, env);
const runId = makeRunId();
const startedAt = new Date().toISOString();
const notes = [];

let masterVersion;
try {
  execFileSync("git", ["fetch", "-q", "origin", "master"]);
  masterVersion = execFileSync("git", ["rev-parse", "--short", "origin/master"]).toString().trim();
} catch (e) { preflightFail(`git fetch origin master failed: ${clean(e.message)}`); }
const res = await fetch(env.baseUrl, { cache: "no-store" }).catch(e => ({ ok: false, statusText: e.message }));
if (!res.ok) preflightFail(`${env.baseUrl} unreachable (${res.status ?? ""} ${res.statusText})`);
const liveVersion = parseLiveVersion(await res.text());
const v = checkVersion(liveVersion, masterVersion);
if (!v.ok) preflightFail(v.message);

const featDir = new URL("./features/", import.meta.url);
const files = existsSync(featDir) ? readdirSync(featDir).filter(f => f.endsWith(".mjs") && (!feature || f.startsWith(feature))).sort() : [];
if (!files.length) { console.error(`no feature matches "${feature}"`); process.exit(3); }
const scenarios = (await Promise.all(files.map(f => import(new URL(f, featDir))))).flatMap(m => m.scenarios);

// Run IDs are per minute; a second run in the same minute would share reset's "this run" prefix
// and overwrite results, so refuse before any sign-in.
const dir = new URL(`${runId}/`, OUT);
if (existsSync(dir)) { console.error(`out/${runId}/ already exists (run started in the same minute); wait a minute and retry`); process.exit(3); }
const shots = new URL("shots/", dir);
mkdirSync(shots, { recursive: true });

// The QA CSM's display name: the fixture's csm column is matched against team-member NAMES.
// Read from the sign-out button's title "Sign out (<user.name>)" (src/26-app.jsx), which is
// rendered for every role and in both collapsed and expanded sidebar states, unlike the name
// div which is hidden when collapsed. Signing in as the CSM also proves that user works.
async function readCsmName(browser) {
  const csm = await signIn(browser, env, "csm");
  try {
    const t = await csm.page.locator('button[title^="Sign out ("]').first().getAttribute("title", { timeout: 15000 });
    const name = /^Sign out \((.*)\)$/.exec(t || "")?.[1]?.trim();
    if (!name) throw new Error("could not read the QA CSM's display name from the sidebar");
    return name;
  } finally { await csm.close(); }
}

let code = 0, results = [], browser;
try {
  browser = await chromium.launch({ channel: process.env.CRM_TEST_CHANNEL ?? "msedge" });
  const csmName = await readCsmName(browser);
  if (!skipReset) {
    const admin = await signIn(browser, env, "admin");
    try {
      const r = await resetQaOrg({ ...admin, runId, csmName }, runId);
      notes.push(`reset: deleted ${r.deleted} stale QA accounts, imported ${r.imported}, updated ${r.updated}`);
      for (const w of r.warnings || []) notes.push(`import warning: ${w}`);
    } finally { await admin.close(); }
  }
  results = await runScenarios(scenarios,
    async s => ({ ...(await signIn(browser, env, s.role ?? "admin", s.viewport ? { viewport: s.viewport } : {})), runId, csmName }),
    { skip: s => (s.role === "am" && !env.users.am) ? "no AM user configured" : null,
      onFail: async (s, ctx) => {
        if (!ctx?.page) return undefined;
        const file = `${s.id.replaceAll("/", "__")}.png`;
        await ctx.page.screenshot({ path: fileURLToPath(new URL(file, shots)), fullPage: true });
        return { screenshot: file };
      } });
  code = results.some(r => r.status === "fail") ? 1 : 0;
} catch (e) {
  if (e instanceof GuardError) { code = 2; notes.push(e.message); results = e.results || []; }
  else { code = 4; notes.push(`aborted: ${e?.message || e}`); results = e?.results || results; }
  console.error(clean(notes.at(-1)));
} finally { await browser?.close().catch(() => {}); }

notes.push("Add-user scenario leaves one unconfirmed sign-up per run (qa+<runId>@mail.onevio.in).");
for (const r of results) if (r.error) r.error = clean(r.error);
const summary = summarise(results);
const out = { runId, startedAt, finishedAt: new Date().toISOString(), liveVersion, masterVersion, feature, summary, results, notes: notes.map(clean) };
writeFileSync(new URL("results.json", dir), JSON.stringify(out, null, 2));
const histFile = new URL("history.json", OUT);
const history = existsSync(histFile) ? JSON.parse(readFileSync(histFile, "utf8")) : [];
history.push({ runId, summary, liveVersion, failedIds: results.filter(r => r.status === "fail").map(r => r.id) });
writeFileSync(histFile, JSON.stringify(history.slice(-20), null, 2));
console.log(`${runId}: ${summary.pass} pass, ${summary.flaky} flaky, ${summary.fail} fail, ${summary.skipped} skipped -> ${fileURLToPath(new URL("results.json", dir))}`);
for (const n of out.notes) console.log(`  ${n}`);
process.exit(code);
