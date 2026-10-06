# Module Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the app code out of `crm.html`'s single `<script>` block into 27 ordered `src/NN-name.jsx` files that the build joins back together, with `dist/crm.html` byte-identical to today's.

**Architecture:** A one-off script slices the script block at fixed anchor lines into `src/`. `crm.html` keeps the page shell with an empty script block. `build.mjs` reads `src/*.jsx` sorted by filename, joins them with nothing in between, and feeds the result to the unchanged pipeline (stamp → esbuild transform → Tailwind → inline). Every function stays a global, so the tests and the deploy are untouched.

**Tech Stack:** Node 24 ESM, esbuild `transform` (not bundle), Tailwind CLI, Playwright E2E suite in `tests/health/` (reads `dist/crm.html`).

**Spec:** `docs/superpowers/specs/2026-10-06-module-split-design.md`

## Global Constraints

- No behaviour change, no reordering, no renaming, and no edits to any line of code beyond what this plan names.
- Acceptance gate: the branch's `dist/crm.html` must be byte-identical to `origin/master`'s, except for the `APP_VERSION` stamp, the generated-header comment line, and the SetupScreen copy change (Task 2).
- Files are named `src/NN-name.jsx` (two digits, a hyphen, lowercase name). The build sorts names with a plain `.sort()` (code-unit order, the same on every OS).
- Joined text = the concatenation of the files with **nothing** inserted between them.
- `tailwind.config.js` `content` must become `["./crm.html", "./src/**/*.jsx"]`.
- This checkout uses `core.autocrlf=true`, so working files are CRLF and the repo stores LF. Never "fix" line endings. Write files exactly as sliced.
- The leading newline right after `<script type="text/babel" data-presets="react">` is NOT part of `00-core-config.jsx`. esbuild output was verified identical without it.
- Never pipe test or build commands; redirect to a file. Do not run the full suite locally (the machine runs out of memory). CI runs it.
- Never junction or symlink `node_modules` into a worktree; run `npm ci` instead.

## Review Focus

1. **A Tailwind class used only in moved code disappears from the CSS** (content glob missed). Expected: impossible to ship, because the byte-identity gate in Task 1 compares the inlined CSS too.
2. **Someone later pastes code back into the `crm.html` script block.** Expected: the build fails with a message pointing at `src/`. Task 1 checks it by breaking the input on purpose.
3. **A new file named without the `NN-` prefix** (e.g. `src/helpers.jsx`), which would sort to an unexpected position. Expected: the build fails and names the file. Task 1 checks it.
4. **An empty `src/` file or an empty `src/` folder.** Expected: the build fails clearly instead of shipping a blank app. Task 1 checks it.
5. **A deployer following the setup instructions** to paste Supabase keys into TEAM CONFIG. Expected: the in-app SetupScreen and `TEAM-SETUP.md` point at `src/00-core-config.jsx`. Task 2 checks the text.

---

## File Structure

- Create `src/00-core-config.jsx` … `src/26-app.jsx` (27 files; the table in Task 1).
- Create `src/README.md` (Task 2) describing the convention.
- Modify `crm.html`: the script block is emptied (Task 1); the SetupScreen text moves into `src/25-auth-admin.jsx` and is changed there (Task 2).
- Modify `build.mjs`: join `src/`, guards (Task 1); header comment (Task 2).
- Modify `tailwind.config.js`: content glob and comment (Task 1).
- Modify `TEAM-SETUP.md` (Task 2).
- Temporary, never committed: `../split.mjs` (outside the repo).

---

### Task 1: Split the source, join it in the build, prove byte identity

**Files:**
- Create (via script): `src/00-core-config.jsx` … `src/26-app.jsx`
- Modify: `crm.html` (empty the script block), `build.mjs`, `tailwind.config.js`
- Temporary: `D:/AI Project/split.mjs`, `D:/AI Project/wt-ms-base/` (a detached worktree of `origin/master`, used for the baseline build)

**Interfaces:**
- Produces: the `src/` convention and the `build.mjs` join, which Task 2 edits inside (`src/25-auth-admin.jsx`, the build header line).

- [ ] **Step 1: Build the baseline from master**

```bash
cd "D:/AI Project/My Company"
git worktree add --detach ../wt-ms-base origin/master
cd ../wt-ms-base && npm ci --silent && node build.mjs > ../base-build.txt 2>&1
cp dist/crm.html ../base-crm.html
```

Expected: `../base-crm.html` exists, about 720 KB.

- [ ] **Step 2: Write the split script** at `D:/AI Project/split.mjs` (outside the repo):

```js
// One-off: slice crm.html's script block into src/NN-name.jsx at fixed anchors.
// Asserts each anchor is found exactly once, in order, and that the join == original.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
const ROOT = "D:/AI Project/wt-ms";
const html = readFileSync(`${ROOT}/crm.html`, "utf8");
const RE = /(<script type="text\/babel" data-presets="react">)([\s\S]*?)(<\/script>)/;
const m = html.match(RE);
if (!m) throw new Error("script block not found");
const body = m[2].replace(/^\r?\n/, "");            // drop the newline after the tag
const EOL = body.includes("\r\n") ? "\r\n" : "\n";
const lines = body.split(EOL);
// [file, anchor]: the anchor is the start of a line; null = first line of the block.
const MAP = [
  ["00-core-config", null],
  ["01-qbr", "/* ------------------------------- QBR cadence"],
  ["02-seed-data", "/* ------------------------------- seed data"],
  ["03-audit", "/* ------------------------------ audit trail"],
  ["04-store", "/* ------------------------------ store (Supabase)"],
  ["05-error-reporting", "/* ------------------------------ error reporting"],
  ["06-write-queue", "/* ------------------------------ write queue"],
  ["07-reducer", "function persist("],
  ["08-playbook-engine", "/* --------------------------- renewal playbook"],
  ["09-charts", "/* ----------------------------- tiny charts"],
  ["10-ui-atoms", "/* ------------------------------ UI atoms"],
  ["11-toasts", "/* ------------------------------ toasts"],
  ["12-attachments", "/* ------------------------- attachments"],
  ["13-forms", "/* ------------------------- account documents"],
  ["14-retention-math", "/* ------------------------------- Dashboard"],
  ["15-analytics-cards", "/* ---------------------------- cohort retention"],
  ["16-dashboard", "function Dashboard("],
  ["17-csv", "/* ------------------------------ Account list"],
  ["18-drive-sync", "/* ---------------------- shared-drive folder sync"],
  ["19-dialogs-bulk", "/* ------------------------------ bulk actions"],
  ["20-account-list", "/* ------------------------------ list windowing"],
  ["21-account-detail", "/* ------------------------------ Account detail"],
  ["22-tasks", "/* ------------------------------ tasks view"],
  ["23-renewals", "/* ------------------------------- Renewals"],
  ["24-settings", "/* ------------------------------- Playbook"],
  ["25-auth-admin", "/* --------------------------------- Auth (Supabase)"],
  ["26-app", "/* --------------------------------- App ---"],
];
// Find each anchor line; pull contiguous comment lines directly above a declaration
// anchor into the same file.
const starts = MAP.map(([name, a], i) => {
  if (a === null) return 0;
  const hits = lines.map((l, n) => l.startsWith(a) ? n : -1).filter(n => n >= 0);
  if (hits.length !== 1) throw new Error(`anchor for ${name} found ${hits.length} times: ${a}`);
  let n = hits[0];
  if (!a.startsWith("/*")) while (n > 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[n - 1])) n--;
  return n;
});
starts.forEach((s, i) => { if (i && s <= starts[i - 1]) throw new Error(`anchor out of order: ${MAP[i][0]}`); });
if (existsSync(`${ROOT}/src`)) throw new Error("src/ already exists");
mkdirSync(`${ROOT}/src`);
const parts = MAP.map(([name], i) => {
  const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
  const isLast = i + 1 === starts.length;
  // every slice ends with EOL except possibly the very last (mirrors the original exactly)
  const text = lines.slice(starts[i], end).join(EOL) + (isLast ? "" : EOL);
  writeFileSync(`${ROOT}/src/${name}.jsx`, text);
  return text;
});
if (parts.join("") !== body) throw new Error("join != original body");
writeFileSync(`${ROOT}/crm.html`, html.replace(RE, (_, a, _b, c) => `${a}${c}`));
console.log("split ok:", parts.length, "files; lines per file:", parts.map(p => p.split(EOL).length).join(","));
```

- [ ] **Step 3: Run it**

```bash
cd "D:/AI Project/wt-ms" && node ../split.mjs > ../split-out.txt 2>&1; cat ../split-out.txt
```

Expected: `split ok: 27 files; lines per file: …`. Then check that the shell's block is now `<script type="text/babel" data-presets="react"></script>` (`grep -n 'text/babel' crm.html`).

Note: `body` ends with the original last line's EOL, before `</script>`, so the last file keeps it as well. The join check guarantees this is exact.

- [ ] **Step 4: Change `build.mjs` to read `src/`**

Add `readdirSync` to the `node:fs` import. Replace the block from `let html = read("crm.html");` through `const jsxSource = scriptMatch[1];` with:

```js
let html = read("crm.html");

// The app code lives in src/NN-name.jsx, joined in filename order into the one
// <script type="text/babel"> block -- a plain concatenation, so every top-level name
// stays a global exactly as when it was a single file. See
// docs/superpowers/specs/2026-10-06-module-split-design.md
const SRC_NAME = /^\d\d-[a-z0-9-]+\.jsx$/;
let srcFiles;
try { srcFiles = readdirSync(p("src")).filter(f => f.endsWith(".jsx")).sort(); }
catch { throw new Error("build: src/ not found — the app code lives in src/NN-name.jsx"); }
if (!srcFiles.length) throw new Error("build: src/ has no .jsx files");
const badName = srcFiles.find(f => !SRC_NAME.test(f));
if (badName) throw new Error(`build: src/${badName} must be named NN-name.jsx (two-digit order prefix, lowercase)`);
const parts = srcFiles.map(f => {
  const t = read(join("src", f));
  if (!t.trim()) throw new Error(`build: src/${f} is empty`);
  return t;
});
let jsxSource = parts.join("");

const SCRIPT_RE = /<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/;
const scriptMatch = html.match(SCRIPT_RE);
if (!scriptMatch) throw new Error("build: no <script type=\"text/babel\"> block found in crm.html");
if (scriptMatch[1].trim()) throw new Error("build: crm.html's <script type=\"text/babel\"> block must stay empty — app code belongs in src/NN-name.jsx");

// Stamp the build so an error report says which build produced it. Targeted string
// replace on a known literal (now in src/00-core-config.jsx).
const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
const stamped = jsxSource.replace('const APP_VERSION = "dev";', `const APP_VERSION = "${sha}";`);
if (stamped === jsxSource) {
  // A silent no-op here would stamp every error report "dev" forever, with nothing to
  // notice it. The literal is load-bearing; if it drifts, the build must stop.
  throw new Error('build: APP_VERSION literal not found in src/ — the version stamp would silently ship as "dev"');
}
jsxSource = stamped;
```

Keep the header comment at the top of `build.mjs` accurate: change "crm.html stays the hand-edited source of truth" to "crm.html (page shell) and src/*.jsx (app code) are the hand-edited source of truth".

Everything after `jsxSource` is unchanged. The esbuild call already consumes `jsxSource`, and the final `.replace(SCRIPT_RE, …)` still replaces the (now empty) block with the compiled script.

- [ ] **Step 5: Tailwind content**

In `tailwind.config.js`, set `content: ["./crm.html", "./src/**/*.jsx"],`. Change the first comment line from `// Scans crm.html only.` to `// Scans crm.html and src/**/*.jsx (the app code).`.

- [ ] **Step 6: Build and run the byte-identity gate**

```bash
cd "D:/AI Project/wt-ms" && npm ci --silent && node build.mjs > ../ms-build.txt 2>&1; echo build=$?
cat > ../gate.cjs <<'EOF'
// Byte-identity gate: dist/crm.html vs the master baseline, masking only allowed diffs.
const fs = require("fs");
const norm = s => s.replace(/const APP_VERSION = "[0-9a-f]+"/, 'const APP_VERSION = "X"');
const a = norm(fs.readFileSync("../base-crm.html", "utf8")), b = norm(fs.readFileSync("dist/crm.html", "utf8"));
if (a === b) { console.log("IDENTICAL"); process.exit(0); }
let i = 0; while (a[i] === b[i]) i++;
console.log("DIFF at", i, "\nbase:", JSON.stringify(a.slice(i - 80, i + 80)), "\nnew: ", JSON.stringify(b.slice(i - 80, i + 80)));
process.exit(1);
EOF
node ../gate.cjs > ../gate.txt 2>&1; echo gate=$?; cat ../gate.txt
```

Expected: `build=0`, `gate=0`, `IDENTICAL`. In the compiled output the stamp is `const APP_VERSION = "<sha>"`, which the normaliser masks. The header comment is unchanged until Task 2. Any other difference is a defect: find and fix the cause; do not mask it.

- [ ] **Step 7: Prove each guard fires** (restore after each; record outputs in the report)

```bash
# (a) code left in the shell
cp crm.html ../crm.bak && sed -i 's|<script type="text/babel" data-presets="react"></script>|<script type="text/babel" data-presets="react">x</script>|' crm.html
node build.mjs > ../g1.txt 2>&1; echo exit=$?; tail -1 ../g1.txt; cp ../crm.bak crm.html
# (b) badly named file
echo "const z = 1;" > src/helpers.jsx; node build.mjs > ../g2.txt 2>&1; echo exit=$?; tail -1 ../g2.txt; rm src/helpers.jsx
# (c) empty file
: > src/99-empty.jsx; node build.mjs > ../g3.txt 2>&1; echo exit=$?; tail -1 ../g3.txt; rm src/99-empty.jsx
# (d) tailwind content glob is load-bearing: revert it and the gate must fail
cp tailwind.config.js ../tw.bak && sed -i 's|content: \["./crm.html", "./src/\*\*/\*.jsx"\]|content: ["./crm.html"]|' tailwind.config.js
node build.mjs > /dev/null 2>&1; node ../gate.cjs > ../g4.txt 2>&1; echo gate=$?; head -1 ../g4.txt; cp ../tw.bak tailwind.config.js
node build.mjs > ../ms-build.txt 2>&1
```

Expected: (a), (b) and (c) exit non-zero with the matching `build: …` message; (d) the gate prints `DIFF`. After restoring, `git status` shows no stray files and the gate is `IDENTICAL` again.

- [ ] **Step 8: Run a focused slice of the suite** (one at a time, redirected): `smoke.test.mjs`, `offline.test.mjs`, `dashboard-polish.test.mjs`, `health-mix.test.mjs`. Expected: all pass. These load the built app, so a broken join would fail them immediately.

- [ ] **Step 9: Commit**

```bash
git add src crm.html build.mjs tailwind.config.js
git commit -m "Split crm.html's app code into ordered src/ files joined by the build"
```

Leave `../split.mjs`, `../gate.cjs`, `../wt-ms-base`, `../base-crm.html` in place for Task 2's gate. The controller removes them at the end.

---

### Task 2: Point docs and setup copy at src/, update the generated header

**Files:**
- Modify: `src/25-auth-admin.jsx` (SetupScreen copy), `build.mjs` (generated header line), `TEAM-SETUP.md`
- Create: `src/README.md`

**Interfaces:**
- Consumes: Task 1's `src/` layout and the build join. `../base-crm.html` is still present for the gate.

- [ ] **Step 1: SetupScreen copy.** In `src/25-auth-admin.jsx` find:

```jsx
<li>Open <code>crm.html</code> in a text editor and paste both into the <code>TEAM CONFIG</code> block near the top.</li>
```

and change it to:

```jsx
<li>Open <code>src/00-core-config.jsx</code> in a text editor and paste both into the <code>TEAM CONFIG</code> block near the top.</li>
```

- [ ] **Step 2: Generated header.** In `build.mjs`, change the injected comment to:

```js
  "<!DOCTYPE html>\n<!-- GENERATED by build.mjs from crm.html (shell) + src/*.jsx (app code). Do not edit; edit those. -->",
```

- [ ] **Step 3: TEAM-SETUP.md.** Find every instruction that tells a deployer to edit `crm.html` for the Supabase URL/anon key (`grep -n "crm.html" TEAM-SETUP.md`) and point it at `src/00-core-config.jsx`. Leave lines about the served page `/crm.html` alone.

- [ ] **Step 4: `src/README.md`:**

```markdown
# App source

The app is one browser script split into ordered files. `build.mjs` joins
`src/*.jsx` in filename order, with nothing in between, into the
`<script type="text/babel">` block of `crm.html`, then compiles it. There are
no imports or exports: every top-level name is a global, exactly as when this
was a single file.

- Add code to the file for its area.
- A new area gets a new file named `NN-name.jsx`. The two-digit prefix is its
  load order; pick a number between its neighbours, or renumber.
- Top-level `const`s must be defined in an earlier file than any top-level code
  that runs immediately and uses them. Functions can be used from anywhere.
- Never put code back in `crm.html`'s script block. The build refuses.
- Supabase URL and anon key: the TEAM CONFIG block in `00-core-config.jsx`.
```

- [ ] **Step 5: Gate with the allowed differences.** Rebuild (`node build.mjs > ../ms-build.txt 2>&1`), then edit `../gate.cjs` (created in Task 1 Step 6) so its `norm` also masks the header comment and the SetupScreen sentence, and run `node ../gate.cjs > ../gate.txt 2>&1`:

```js
const norm=s=>s.replace(/const APP_VERSION = "[0-9a-f]+"/, "const APP_VERSION = \"X\"")
  .replace(/<!-- GENERATED by build\.mjs[^>]*-->/, "<!--H-->")
  .replace(/"Open ", .{0,80}?"crm\.html"|"Open ", .{0,80}?"src\/00-core-config\.jsx"/, "OPEN");
```

Expected: `IDENTICAL`. If the SetupScreen regex does not match the compiled form, print the diff region and adjust the mask to exactly that sentence. The mask must never cover more than the one changed string.

- [ ] **Step 6: Focused tests:** `smoke.test.mjs` and `offline.test.mjs`, plus any test that asserts SetupScreen text (`grep -rln "TEAM CONFIG\|Open <code>" tests/health`). Expected: pass, or update only the expected text of a SetupScreen assertion.

- [ ] **Step 7: Commit**

```bash
git add src/25-auth-admin.jsx src/README.md build.mjs TEAM-SETUP.md
git commit -m "Point setup docs and the generated header at src/"
```

---

### Final: CI and cleanup

Push the branch and open a PR. CI's `test` job builds with the new `build.mjs` on Linux (LF files) and runs the full health and RLS suites. That is the full-suite gate. Afterwards remove `../wt-ms-base`, `../base-crm.html`, `../split.mjs`, `../gate.cjs` and the scratch `../*.txt` files.
