// Builds dist/crm.html: a single, fully self-contained file that makes ZERO network
// requests. crm.html stays the hand-edited source of truth; this is a transform, not a
// bundle -- React, ReactDOM and supabase remain browser globals supplied by the vendored
// UMD files, exactly as they were when they came from unpkg. That is what keeps the
// change small: no module system, no import rewriting, no edits to call sites.
//
// See docs/superpowers/specs/2026-08-17-build-step-design.md
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as esbuild from "esbuild";

const ROOT = dirname(fileURLToPath(import.meta.url));
const p = (...s) => join(ROOT, ...s);
const read = f => readFileSync(p(f), "utf8");

// ---------------------------------------------------------------------------
// 1. Extract the JSX source out of the <script type="text/babel"> block.
// ---------------------------------------------------------------------------
let html = read("crm.html");

// Stamp the build so an error report says which build produced it. Targeted string
// replace on a known literal rather than a head rewrite -- an earlier build regenerated
// <head> from a template and silently ate every edit made to it.
const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
html = html.replace('const APP_VERSION = "dev";', `const APP_VERSION = "${sha}";`);

const SCRIPT_RE = /<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/;
const scriptMatch = html.match(SCRIPT_RE);
if (!scriptMatch) throw new Error("build: no <script type=\"text/babel\"> block found in crm.html");
const jsxSource = scriptMatch[1];

// ---------------------------------------------------------------------------
// 2. Compile JSX -> plain JS. Same React.createElement target Babel Standalone used.
// ---------------------------------------------------------------------------
const { code: appJs } = await esbuild.transform(jsxSource, {
  loader: "jsx",
  target: "es2020",
  jsx: "transform",
  legalComments: "none",
});

// ---------------------------------------------------------------------------
// 3. Compile Tailwind. Replaces the in-browser JIT that cdn.tailwindcss.com ran on
//    every page load. Preflight is on by default, matching the CDN's behaviour.
// ---------------------------------------------------------------------------
const TMP_CSS = p("dist", ".tailwind.out.css");
mkdirSync(p("dist"), { recursive: true });
const TMP_IN = p("dist", ".tailwind.in.css");
writeFileSync(TMP_IN, "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n");
execFileSync(
  process.execPath,
  [p("node_modules", "tailwindcss", "lib", "cli.js"), "-c", p("tailwind.config.js"), "-i", TMP_IN, "-o", TMP_CSS, "--minify"],
  { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] },
);
const tailwindCss = readFileSync(TMP_CSS, "utf8");
rmSync(TMP_IN, { force: true });
rmSync(TMP_CSS, { force: true });

// ---------------------------------------------------------------------------
// 4. Inline the fonts. Inter v20 ships as a VARIABLE font, so all five weights the app
//    uses (400-800) resolve to one file per subset -- hence two faces, not ten. The
//    unicode-ranges are copied from the Google Fonts stylesheet so latin-ext only
//    downloads... well, nothing downloads. It is already here.
// ---------------------------------------------------------------------------
const SUBSETS = JSON.parse(read("vendor/inter-subsets.json"));
const b64 = f => readFileSync(p("vendor", f)).toString("base64");
const face = (file, range) => `@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64,${b64(file)}) format('woff2');unicode-range:${range};}`;
const fontCss = [
  face("inter-latin.woff2", SUBSETS.latin.range),
  face("inter-latin-ext.woff2", SUBSETS["latin-ext"].range),
].join("\n");

// ---------------------------------------------------------------------------
// 5. Reassemble. Every external <script>/<link> in <head> is dropped and replaced by
//    inlined vendor code; the hand-written <style> block is preserved verbatim and kept
//    AFTER Tailwind so its .nm/.grad tokens still win the cascade, as they do today.
// ---------------------------------------------------------------------------
const vendorJs = [
  "vendor/react.production.min.js",
  "vendor/react-dom.production.min.js",
].map(read).join("\n;\n");

// supabase-js is a webpack bundle whose "automatic publicPath" probe reads
// document.currentScript.src and THROWS when it is empty -- which is exactly what an
// inline <script> gives it. Inlining it the obvious way kills window.supabase outright
// in production (the E2E suite would not catch it: it mocks sb). A data: URL is still a
// zero-network load, but currentScript.src is a real string, so the probe is satisfied.
const supabaseTag = `<script src="data:text/javascript;base64,${readFileSync(p("vendor", "supabase.umd.js")).toString("base64")}"></script>`;

// Transform the REAL head rather than substituting a hardcoded one. An earlier version
// emitted a fixed <head> template, which silently swallowed anything added to crm.html's
// head -- a new meta tag, an icon link, a changed <title> -- and, worse, quietly ate the
// very CDN tags the guard below is supposed to shout about. Now only the known external
// dependencies are stripped; everything else is carried through untouched.
const headMatch = html.match(/<head>([\s\S]*?)<\/head>/);
if (!headMatch) throw new Error("build: no <head> block found in crm.html");

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) throw new Error("build: no <style> block found in crm.html");
const handWrittenCss = styleMatch[1];

const head = headMatch[1]
  // the five runtime deps, now vendored and inlined below
  .replace(/<script src="https:\/\/unpkg\.com\/[^"]*"><\/script>\s*/g, "")
  .replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*/g, "")
  // the Google Fonts preconnect + stylesheet; Inter is embedded as base64 instead
  .replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*/g, "")
  .replace(/<link href="https:\/\/fonts\.googleapis\.com\/[^"]*"[^>]*>\s*/g, "")
  // the hand-written token block moves into the combined stylesheet, after Tailwind, so
  // its .nm/.grad rules still win the cascade exactly as they do today
  .replace(/<style>[\s\S]*?<\/style>/, () =>
    `<style>${fontCss}\n${tailwindCss}\n${handWrittenCss}</style>\n<script>${vendorJs}</script>\n${supabaseTag}`);

// Function replacements throughout: the inlined CSS/JS contains `$&` and `$'` sequences,
// which String.replace would expand as substitution patterns and re-insert the original.
let out = html
  .replace(/<head>[\s\S]*?<\/head>/, () => `<head>\n${head}\n</head>`)
  .replace(SCRIPT_RE, () => `<script>\n${appJs}\n</script>`);

// A generated file should say so, and should not be mistaken for the source.
out = out.replace(
  /^<!DOCTYPE html>/,
  "<!DOCTYPE html>\n<!-- GENERATED by build.mjs from crm.html. Do not edit; edit crm.html. -->",
);

writeFileSync(p("dist", "crm.html"), out);
// index.html so the /crm/ root stops 404ing. Same bytes, two names.
writeFileSync(p("dist", "index.html"), out);

// Fail loudly rather than shipping an artifact that still phones home.
const leftovers = out.match(/(?:src|href)="https?:\/\/[^"]+"/g);
if (leftovers) throw new Error("build: external reference survived into dist:\n  " + leftovers.join("\n  "));

const kb = n => (n / 1024).toFixed(0) + "KB";
console.log(`dist/crm.html  ${kb(Buffer.byteLength(out))}  (app ${kb(appJs.length)}, css ${kb(tailwindCss.length)}, vendor ${kb(vendorJs.length)}, fonts ${kb(fontCss.length)})`);
