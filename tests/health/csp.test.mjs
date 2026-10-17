// dist/crm.html carries a Content-Security-Policy <meta> (build.mjs) and a frame guard
// (crm.html <head>). Every other suite runs with bypassCSP because the harness injects its
// mock as an inline script; this is the one place dist/ runs under the REAL policy.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildMockedHtml, seedAccount } from "./harness.mjs";
import { test, assert } from "./framework.mjs";

const CHANNEL = process.env.CRM_TEST_CHANNEL ?? "msedge";
const SEED = `window.__seedRows = { accounts: [${JSON.stringify(seedAccount())}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
const fileOf = url => fileURLToPath(url);
const toUrl = f => "file://" + f.replace(/\\/g, "/");

// The mocked page, with ONLY the harness's own injected script added to the policy -- so
// the app's scripts must still pass on the hashes build.mjs computed.
function underPolicy(extraBody = "") {
  const file = fileOf(buildMockedHtml(SEED));
  let html = readFileSync(file, "utf8");
  const injected = html.match(/<body[^>]*><script>([\s\S]*?)<\/script>/)[1];
  const h = createHash("sha256").update(injected, "utf8").digest("base64");
  html = html.replace(/(script-src )/, `$1'sha256-${h}' `);
  if (extraBody) html = html.replace(/<div id="root"><\/div>/, m => `${m}${extraBody}`);
  writeFileSync(file, html);
  return toUrl(file);
}

async function open(url, fn, { bypassCSP = false } = {}) {
  const browser = await chromium.launch({ channel: CHANNEL || undefined, headless: true });
  try {
    const page = await browser.newPage({ bypassCSP });
    const violations = [], errors = [];
    await page.exposeFunction("__cspViolation", v => violations.push(v));
    await page.addInitScript(() => document.addEventListener("securitypolicyviolation",
      e => window.__cspViolation(`${e.violatedDirective} ${e.blockedURI}`)));
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(url);
    return await fn(page, violations, errors);
  } finally { await browser.close(); }
}

test("csp: dist carries a meta CSP with script hashes and no unsafe-inline/eval for scripts", async () => {
  const html = readFileSync(new URL("../../dist/crm.html", import.meta.url), "utf8");
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
  assert(csp, "dist/crm.html has no CSP meta");
  const script = csp.split(";").map(s => s.trim()).find(s => s.startsWith("script-src"));
  assert(/'sha256-/.test(script), "script-src must list hashes");
  assert(!/unsafe-inline|unsafe-eval/.test(script), `script-src must not allow unsafe-inline/eval: ${script}`);
  assert(/default-src 'none'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp), "lockdown directives missing");
  assert(html.indexOf("Content-Security-Policy") < html.indexOf("<script"), "CSP meta must precede every script");
});

// Page errors are compared against the same page with the policy bypassed: the simple MOCK
// lacks some query methods (e.g. .order) and throws on its own, CSP or not. Only an error
// that appears under the policy and NOT without it is the policy's doing.
test("csp: the app boots under the real policy with zero violations", async () => {
  const boot = async (page, violations, errors) => {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    return { violations: [...violations], errors: [...errors] };
  };
  const base = await open(underPolicy(), boot, { bypassCSP: true });
  const real = await open(underPolicy(), boot);
  assert(real.violations.length === 0, "CSP violations: " + real.violations.join(" | "));
  const extra = real.errors.filter(e => !base.errors.includes(e));
  assert(extra.length === 0, "page errors only under the policy: " + extra.join(" | "));
});

// Control: without this, "zero violations" could mean the policy is not being enforced at all.
test("csp: an injected inline script is refused (policy is live, not inert)", async () => {
  await open(underPolicy(`<script>window.__injected = true;</script>`), async (page, violations) => {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1, null, { timeout: 15000 });
    assert(await page.evaluate(() => window.__injected) !== true, "unhashed inline script ran");
    assert(violations.some(v => v.startsWith("script-src")), "expected a script-src violation, got: " + violations.join(" | "));
  });
});

test("frame guard: the CRM does not boot inside another page's frame", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crm-frame-"));
  const outer = join(dir, "outer.html");
  writeFileSync(outer, `<!doctype html><iframe id="f" src="${underPolicy()}" width="800" height="600"></iframe>`);
  const browser = await chromium.launch({ channel: CHANNEL || undefined, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(toUrl(outer));
    await page.waitForTimeout(2000);
    // Either the guard navigated the top window to the CRM (break-out worked), or the frame
    // stayed hidden with the app never booted. Both mean nothing clickable sits in a frame.
    const frame = page.frames().find(f => f !== page.mainFrame());
    if (!frame) return;   // broke out: the top page itself became the CRM
    const st = await frame.evaluate(() => ({
      hidden: getComputedStyle(document.documentElement).display === "none",
      booted: !!(window.__store && document.getElementById("root") && document.getElementById("root").children.length),
    }));
    assert(st.hidden, "framed CRM must be hidden");
    assert(!st.booted, "framed CRM must not boot");
  } finally { await browser.close(); }
});

test("frame guard: unframed page is visible (control)", async () => {
  await open(underPolicy(), async page => {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1, null, { timeout: 15000 });
    assert(await page.evaluate(() => getComputedStyle(document.documentElement).display) !== "none", "unframed page hidden");
  });
});
