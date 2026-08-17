// The point of the build step: dist/crm.html must be entirely self-contained. If a CDN
// <script>, a webfont <link> or any other remote reference creeps back into crm.html,
// these fail -- and CI's retry-once hack for unpkg blips is gone, so a network dependency
// can no longer hide behind a second attempt.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildMockedHtml, seedAccount } from "./harness.mjs";
import { test, assert } from "./framework.mjs";

const CHANNEL = process.env.CRM_TEST_CHANNEL ?? "msedge";
const SEED = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

test("dist makes zero non-file requests", async () => {
  const url = buildMockedHtml(SEED);
  const browser = await chromium.launch({ channel: CHANNEL || undefined, headless: true });
  const page = await browser.newPage();
  const remote = [];
  // file: is the document itself; data: is the inlined supabase bundle. Neither touches
  // the network. Anything else is a remote dependency and a build regression.
  page.on("request", r => {
    const u = r.url();
    if (!u.startsWith("file://") && !u.startsWith("data:")) remote.push(u);
  });
  await page.goto(url);
  await page.waitForSelector("#root", { timeout: 15000 });
  // The app renders asynchronously; give any lazy fetch a chance to fire before asserting.
  await page.waitForTimeout(1000);
  // The vendored globals must have EVALUATED, not merely been included. supabase-js is a
  // webpack bundle that throws on load from a plain inline <script> (its publicPath probe
  // reads document.currentScript.src), which would leave production with no
  // window.supabase at all -- invisible to every other test, since they mock sb.
  const globals = await page.evaluate(() => ({
    react: typeof window.React?.createElement,
    reactDom: typeof window.ReactDOM?.createRoot,
    supabase: typeof window.supabase?.createClient,
  }));
  await browser.close();
  assert(remote.length === 0, `dist must not load anything remote, got:\n  ${remote.join("\n  ")}`);
  assert(globals.react === "function", `React global missing (got ${globals.react})`);
  assert(globals.reactDom === "function", `ReactDOM global missing (got ${globals.reactDom})`);
  assert(globals.supabase === "function", `window.supabase.createClient missing (got ${globals.supabase}) -- the vendored UMD failed to evaluate`);
});

test("dist ships no CDN references and no in-browser compiler", async () => {
  const dist = readFileSync(fileURLToPath(new URL("../../dist/crm.html", import.meta.url)), "utf8");
  assert(!/(?:src|href)="https?:/.test(dist), "dist must contain no absolute http(s) src/href");
  assert(!/babel/i.test(dist), "Babel must not survive into dist -- JSX is compiled ahead of time");
  assert(!/type="text\/babel"/.test(dist), "no script should still be waiting on a browser-side compiler");
});
