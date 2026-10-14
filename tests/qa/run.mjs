// QA agent entry point. Order is load-bearing: pre-flight and the org guard both run
// before reset, because reset is the first thing that writes.
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loadQaEnv } from "./env.mjs";
import { makeRunId, runScenarios, summarise, GuardError } from "./core.mjs";
import { parseLiveVersion, checkVersion } from "./guard.mjs";
import { signIn } from "./session.mjs";
import { resetQaOrg } from "./reset.mjs";

const args = process.argv.slice(2);
const feature = args.includes("--feature") ? args[args.indexOf("--feature") + 1] : null;
const skipReset = args.includes("--skip-reset");
const OUT = new URL("./out/", import.meta.url);

const env = loadQaEnv();
const runId = makeRunId();
const startedAt = new Date().toISOString();
const notes = [];

execFileSync("git", ["fetch", "-q", "origin", "master"]);
const masterVersion = execFileSync("git", ["rev-parse", "--short", "origin/master"]).toString().trim();
const res = await fetch(env.baseUrl, { cache: "no-store" }).catch(e => ({ ok: false, statusText: e.message }));
if (!res.ok) { console.error(`pre-flight: ${env.baseUrl} unreachable (${res.status ?? ""} ${res.statusText})`); process.exit(3); }
const liveVersion = parseLiveVersion(await res.text());
const v = checkVersion(liveVersion, masterVersion);
if (!v.ok) { console.error(`pre-flight: ${v.message}`); process.exit(3); }

const featDir = new URL("./features/", import.meta.url);
const files = existsSync(featDir) ? readdirSync(featDir).filter(f => f.endsWith(".mjs") && (!feature || f.startsWith(feature))).sort() : [];
if (!files.length) { console.error(`no feature matches "${feature}"`); process.exit(3); }
const scenarios = (await Promise.all(files.map(f => import(new URL(f, featDir))))).flatMap(m => m.scenarios);

const dir = new URL(`${runId}/`, OUT); mkdirSync(dir, { recursive: true });

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

const browser = await chromium.launch({ channel: process.env.CRM_TEST_CHANNEL ?? "msedge" });
let code = 0, results = [];
try {
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
        await ctx.page.screenshot({ path: fileURLToPath(new URL(file, dir)), fullPage: true });
        return { screenshot: file };
      } });
  code = results.some(r => r.status === "fail") ? 1 : 0;
} catch (e) {
  if (!(e instanceof GuardError)) throw e;
  console.error(e.message); code = 2; notes.push(e.message);
  results = e.results || [];
} finally { await browser.close(); }

notes.push("Add-user scenario leaves one unconfirmed sign-up per run (qa+<runId>@mail.onevio.in).");
const summary = summarise(results);
const out = { runId, startedAt, finishedAt: new Date().toISOString(), liveVersion, masterVersion, feature, summary, results, notes };
writeFileSync(new URL("results.json", dir), JSON.stringify(out, null, 2));
const histFile = new URL("history.json", OUT);
const history = existsSync(histFile) ? JSON.parse(readFileSync(histFile, "utf8")) : [];
history.push({ runId, summary, liveVersion, failedIds: results.filter(r => r.status === "fail").map(r => r.id) });
writeFileSync(histFile, JSON.stringify(history.slice(-20), null, 2));
console.log(`${runId}: ${summary.pass} pass, ${summary.flaky} flaky, ${summary.fail} fail, ${summary.skipped} skipped -> ${fileURLToPath(new URL("results.json", dir))}`);
for (const n of notes) console.log(`  ${n}`);
process.exit(code);
