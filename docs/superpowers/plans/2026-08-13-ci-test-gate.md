# CI Test Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A red test suite must stop the GitHub Pages deploy, so a bad merge to master can no longer ship itself to the live team app.

**Architecture:** Add a `test` job to the existing `.github/workflows/pages.yml` and make the existing `deploy` job depend on it. The suite's only obstacle to running on a Linux runner is a hardcoded `channel: "msedge"` in the test harness, which becomes an environment-selected constant. No application code changes.

**Tech Stack:** GitHub Actions (`ubuntu-latest`), Node 24, Playwright 1.47 (bundled Chromium in CI, msedge locally), the custom runner at `tests/health/run.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-13-ci-test-gate-design.md`

## Global Constraints

- **Branch:** `ci/test-gate`, already created, already holds the spec commit (`af59297`).
- **Baseline: 115 passed, 0 failed.** Run `node tests/health/run.mjs` from `D:\AI Project\My Company`. Every task must end green.
- **Never pipe the suite.** `run.mjs` ends with `process.exit(fail ? 1 : 0)`. Running it as `node tests/health/run.mjs | tail -8` or chaining `; git something` after it replaces that exit code with the last command's and silently voids the gate. Locally, pipe only when you do not care about the exit code; in the workflow, never.
- **Run exactly ONE suite at a time.** Concurrent Playwright runs compete for browsers and make runs take ~50 minutes.
- **`crm.html` is not modified by this plan.** If a task seems to need an application change, stop and report.
- **Do not merge.** Merging to master auto-deploys the live team app; the merge decision is the user's.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `tests/health/harness.mjs` | Modify (lines 5-7 area, 126, 169) | Owns browser launch. Gains one exported-in-module constant selecting the channel from the environment. |
| `.github/workflows/pages.yml` | Modify | Owns CI. Gains the `test` job; `deploy` gains `needs: test`. |

No new files. Two files change, each with one clear responsibility, and they change for different reasons — hence two tasks.

---

### Task 1: Select the browser channel from the environment

**Files:**
- Modify: `tests/health/harness.mjs:126` and `tests/health/harness.mjs:169` (the two `chromium.launch` calls), plus a new constant near `const CRM = ...` on line 7.

**Interfaces:**
- Produces: module-level `const CHANNEL` in `harness.mjs`, read from `process.env.CRM_TEST_CHANNEL`. Task 2's workflow sets that variable to the empty string. No exported API changes — `launch()` and `launchPersistent()` keep their current signatures.

- [ ] **Step 1: Add the constant**

In `tests/health/harness.mjs`, directly below line 7 (`const CRM = ...`), add:

```js
// CI runners have no Edge, so use Playwright's bundled Chromium there and the browser
// the team actually uses locally. `??` not `||`: an explicitly empty CRM_TEST_CHANNEL
// must select bundled Chromium, not fall back to msedge.
const CHANNEL = process.env.CRM_TEST_CHANNEL ?? "msedge";
```

- [ ] **Step 2: Use it at both launch sites**

There are exactly two `chromium.launch` calls. Change both from:

```js
  const browser = await chromium.launch({ channel: "msedge", headless: true });
```

to:

```js
  const browser = await chromium.launch({ channel: CHANNEL || undefined, headless: true });
```

Verify you changed two and only two:

```bash
grep -n "chromium.launch" tests/health/harness.mjs
```

Expected: two lines, both reading `channel: CHANNEL || undefined`. If `grep -n "msedge" tests/health/harness.mjs` returns anything other than the comment line, you missed a site.

- [ ] **Step 3: Prove the default path is unchanged (msedge)**

Run, unpiped:

```bash
node tests/health/run.mjs
```

Expected: **115 passed, 0 failed**. This is the local developer's path — no env var set, so msedge, exactly as before.

- [ ] **Step 4: Prove the CI path works (bundled Chromium)**

First install the browser CI will use:

```bash
npx --prefix tests playwright install chromium
```

Then run the suite the way CI will, with the channel emptied. PowerShell:

```powershell
$env:CRM_TEST_CHANNEL = ""; node tests/health/run.mjs; Remove-Item Env:\CRM_TEST_CHANNEL
```

Expected: **115 passed, 0 failed**. This is the single most valuable check in the task — it proves the suite is engine-portable before CI has to prove it, and a failure here means the plan's premise is wrong. If any test fails only on Chromium, STOP and report which; do not adjust the test to make it pass.

- [ ] **Step 5: Commit**

```bash
git add tests/health/harness.mjs
git commit -m "test: select the browser channel from the environment

CI runners have no Edge. CRM_TEST_CHANNEL=\"\" selects Playwright's bundled
Chromium; unset still means msedge, so local runs are unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Gate the deploy on the suite

**Files:**
- Modify: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: `CRM_TEST_CHANNEL` from Task 1. Setting it to `""` is what makes the suite run on a runner without Edge.
- Produces: a job named `test`. Task 3 asserts on this job's name and on `deploy` being skipped when it fails.

- [ ] **Step 1: Add the test job**

In `.github/workflows/pages.yml`, under `jobs:`, insert this **above** the existing `deploy:` job:

```yaml
  test:
    runs-on: ubuntu-latest
    env:
      CRM_TEST_CHANNEL: ""      # no Edge on the runner; use bundled Chromium
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: tests/package-lock.json
      - run: npm ci
        working-directory: tests
      - run: npx playwright install --with-deps chromium
        working-directory: tests
      # NEVER pipe this — run.mjs's exit code IS the gate, and a pipe replaces it
      - id: suite
        run: node tests/health/run.mjs
        continue-on-error: true
      # the suite loads React/Babel/Tailwind from unpkg on every page; a CDN blip is not
      # a regression. Same retry-once shape as deploy-pages below.
      - if: steps.suite.outcome == 'failure'
        run: node tests/health/run.mjs
```

- [ ] **Step 2: Make deploy depend on it**

Change the `deploy` job header from:

```yaml
  deploy:
    runs-on: ubuntu-latest
```

to:

```yaml
  deploy:
    needs: test
    runs-on: ubuntu-latest
```

Leave every other line of the `deploy` job — `environment`, the `upload-pages-artifact` step, and the two `deploy-pages` steps with their retry — exactly as they are.

- [ ] **Step 3: Validate the YAML parses**

```bash
node -e "const y=require('fs').readFileSync('.github/workflows/pages.yml','utf8'); if(!/^\s+test:/m.test(y)) throw new Error('no test job'); if(!/needs:\s*test/.test(y)) throw new Error('deploy does not depend on test'); console.log('workflow shape OK')"
```

Expected: `workflow shape OK`. This catches a mis-indented paste, which is the most likely error here and one that otherwise only surfaces after a push.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: run the health suite before deploying to Pages

A red suite now skips the deploy, so a bad merge no longer ships itself.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Prove the gate actually blocks

A workflow that has never failed is indistinguishable from no workflow. This task is the deliverable of the whole plan, not a formality.

**Files:**
- Temporarily modify then restore: `tests/health/csv.test.mjs`

**Interfaces:**
- Consumes: the `test` job from Task 2.
- Produces: two GitHub Actions run URLs, recorded in the PR body by Task 4.

- [ ] **Step 1: Push the branch so CI has something to run**

```bash
git push -u origin ci/test-gate
```

- [ ] **Step 2: Break one assertion deliberately**

In `tests/health/csv.test.mjs`, find the test `a clean import keeps the success green banner` and change its assertion from `text-emerald-700` to a string that cannot match:

```js
  assert(cls.includes("text-emerald-999"), `a clean import should stay green, got class: ${cls}`);
```

Commit it with an obvious, revert-friendly message:

```bash
git add tests/health/csv.test.mjs
git commit -m "TEMPORARY: break an assertion to falsify the CI gate

Reverted in the next commit. See docs/superpowers/plans/2026-08-13-ci-test-gate.md Task 3.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 3: Watch the run and confirm the gate holds**

```bash
gh run list --branch ci/test-gate --limit 1
gh run watch <run-id>
```

Then confirm all four of these. **All four must hold**; if any does not, the gate is not working:

```bash
gh run view <run-id> --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
```

1. `test` concluded `failure`.
2. The failure is the seeded one — `a clean import keeps the success green banner` — and not something incidental. Check with `gh run view <run-id> --log-failed | grep FAIL`.
3. The retry step ran and also failed (a real failure must survive the retry).
4. `deploy` concluded `skipped`. **Not** `success`, **not** `failure`.

Record the run URL.

- [ ] **Step 4: Confirm the live site did not move**

```bash
curl -s https://manshw-pixel.github.io/crm/crm.html | grep -c "text-amber-700"
```

Expected: a non-zero count, i.e. the site still serves the current master build. The point is that a failing branch did not deploy; if the live page changed, `needs:` is not wired correctly.

- [ ] **Step 5: Restore the assertion**

Revert the temporary commit:

```bash
git revert --no-edit HEAD
git push
```

Confirm the file is truly back:

```bash
grep -n "text-emerald-700" tests/health/csv.test.mjs
```

Expected: the assertion line is present again, and `grep -c "text-emerald-999" tests/health/csv.test.mjs` returns `0`.

- [ ] **Step 6: Confirm green passes through**

```bash
gh run list --branch ci/test-gate --limit 1
gh run watch <run-id>
```

Expected: `test` concluded `success`. Note that `deploy` will still be `skipped` on this run — the workflow only triggers deploys on `push` to `master`, and this is a branch. That is correct behavior, not a failure. The deploy path itself is proven on merge.

Record this run URL too.

- [ ] **Step 7: Run the full suite locally one last time**

```bash
node tests/health/run.mjs
```

Expected: **115 passed, 0 failed**, confirming the revert restored the suite exactly.

---

### Task 4: Open the PR

**Files:**
- Create: `pr-body.md` (scratch file at the repo root; it is untracked and gets overwritten each PR — do not commit it)

- [ ] **Step 1: Write the PR body**

Write `pr-body.md` covering: the problem (master auto-deploys with no test step); the two changes (env-selected channel, `test` job with `needs: test`); the accepted consequence that a bad merge still lands on master but never reaches users; and **both run URLs from Task 3** with the four confirmed facts — `test` failed, the retry failed, `deploy` was skipped, the live site did not move.

- [ ] **Step 2: Create the PR**

```bash
gh pr create --title "Gate the Pages deploy on the health suite" --body-file pr-body.md
```

- [ ] **Step 3: Stop and ask**

Report the PR URL and the two run URLs. **Do not merge.** Merging to master auto-deploys the live team app; that decision is the user's.

Note for whoever merges: the merge commit's own run is the first time the `deploy` job runs behind the new gate. Watch it — a green suite must be followed by a successful deploy, and the live page must pick up the change.

---

## Self-Review Notes

**Spec coverage:** Design §1 (channel constant) → Task 1. §2 (test job, `needs: test`, unpiped run, retry) → Task 2 Steps 1-2. §3 prerequisites → verified during spec writing; Task 1 Step 4 re-proves the only one that could regress (engine portability). Testing §steps 1-2 → Task 3 Steps 2-6. Risks table: "gate never blocks" → Task 3; "piping voids the exit code" → Global Constraints plus the inline comment in Task 2 Step 1; "slow browser download" → npm cache and Chromium-only in Task 2 Step 1; "retry masks flakiness" → Task 3 Step 3 item 3 requires the retry to fail too.

**Placeholder scan:** none. Every step names exact files, exact commands, and expected output. `<run-id>` is a value the engineer reads from the preceding command, not a placeholder for undecided content.

**Type consistency:** `CHANNEL` and `CRM_TEST_CHANNEL` are spelled identically in Task 1 (definition), Task 2 (workflow `env`), and the Global Constraints. The job name `test` is consistent across Task 2's definition, `needs: test`, and Task 3's assertions.

**Out of scope, per the spec:** browser matrix, failure-artifact upload, PR-triggered runs, branch protection, vendoring the CDN assets.
