# CI Test Gate Before Deploy — Design

**Date:** 2026-08-13
**Status:** approved for planning

## Problem

`.github/workflows/pages.yml` deploys `crm.html` to GitHub Pages on every push to
master, with no test step. The 115-test suite in `tests/health/` runs only when a human
remembers to run it. Master auto-deploys to the live team app, so one bad merge ships
itself.

This is the top gap from the 2026-08-13 rating (8.5/10): it is the cheapest change
available and it protects every feature already built.

## Goal

A red suite must prevent the deploy. Nothing else about how the team works changes.

## Decisions

Settled during brainstorming; each rejected option is recorded because the reasoning
matters more than the choice.

| Decision | Chosen | Rejected, and why |
| --- | --- | --- |
| Where the gate sits | A `test` job in `pages.yml`; `deploy` gets `needs: test` | PR-only checks still let a direct push to master deploy unchecked. Branch protection was declined as too rigid — it can lock out a fix when CI itself is broken. |
| Browser in CI | Playwright's bundled Chromium in CI, msedge locally, selected by env var | Installing Edge on the runner tracks Edge stable, so an upstream Edge release can turn master red with no code change. Dropping msedge locally would stop testing the browser the team actually uses. |
| Flake policy | Retry the suite once, then fail | Failing immediately blocks the deploy on an unpkg blip. Vendoring the CDN assets is the robust fix but is a much larger change, and it makes the tested page differ from the deployed one. |

**Accepted consequence of the chosen gate:** a bad merge still lands on master. It just
never reaches users. Reverting master remains a manual step.

**Accepted consequence of the chosen browser split:** CI and local runs use different
engines, so a bug specific to Edge could pass CI. Judged acceptable — the suite asserts
application logic and DOM structure, not engine-specific rendering.

## Design

### 1. Make the browser channel selectable

`tests/health/harness.mjs` hardcodes `channel: "msedge"` in two places (the two
`chromium.launch` calls, currently lines 126 and 169). Both read one shared constant:

```js
// CI runners have no Edge; use Playwright's bundled Chromium there and the browser the
// team actually uses locally. Empty string means "no channel" -> bundled Chromium.
const CHANNEL = process.env.CRM_TEST_CHANNEL ?? "msedge";
// at each launch site:
chromium.launch({ channel: CHANNEL || undefined, headless: true })
```

`??` rather than `||` so that an explicitly empty `CRM_TEST_CHANNEL` selects bundled
Chromium instead of falling back to msedge. Unset (every local run today) still means
msedge, so no developer's workflow changes.

This is the only change outside `.github/`.

### 2. Add the test job

In `.github/workflows/pages.yml`, ahead of `deploy`:

```yaml
  test:
    runs-on: ubuntu-latest
    env:
      CRM_TEST_CHANNEL: ""      # bundled Chromium; no Edge on the runner
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: 24       # matches local (v24.15.0)
          cache: npm
          cache-dependency-path: tests/package-lock.json
      - run: npm ci
        working-directory: tests
      - run: npx playwright install --with-deps chromium
        working-directory: tests
      - id: suite
        run: node tests/health/run.mjs
        continue-on-error: true
      # the suite loads React/Babel/Tailwind from unpkg on every page; a CDN blip is not
      # a regression. Same retry-once shape as deploy-pages below.
      - if: steps.suite.outcome == 'failure'
        run: node tests/health/run.mjs
```

And `deploy` gains:

```yaml
  deploy:
    needs: test
```

**The suite must be run unpiped.** `run.mjs` ends with `process.exit(fail ? 1 : 0)`, so
its exit code is the gate. Piping it (`| tail`) or chaining another command after it
replaces that exit code with the last command's, silently disabling the gate. This is
not hypothetical: it made a real 1-failure run report exit 0 during the PR #14 work.

### 3. Prerequisites already satisfied

Verified against the repo, not assumed:

- `tests/package.json` and `tests/package-lock.json` are committed; `node_modules` is
  gitignored. `npm ci` works.
- The harness resolves `crm.html` via `fileURLToPath(new URL("../../crm.html",
  import.meta.url))` and writes temp copies under `tmpdir()`. Nothing is
  Windows-specific, and the `.replace(/\\/g, "/")` in `buildHtml` is harmless on Linux.
- `run.mjs` already exits non-zero on failure.

## Testing

**The gate itself must be falsified before it is trusted.** A workflow that has never
failed is indistinguishable from no workflow at all. On the feature branch:

1. Temporarily break one assertion, push, and confirm: the `test` job fails, the retry
   also fails, `deploy` reports **skipped**, and the live Pages site is unchanged.
2. Restore the assertion, push, and confirm the full sequence goes green and deploys.

Step 1 is the deliverable, not a formality. Record the run URLs in the PR.

The suite's own 115 tests are unchanged by this work; the only risk to them is the
channel change, which the first green CI run and one local run together confirm (local
exercises msedge, CI exercises bundled Chromium).

## Out of scope

- A browser matrix. One engine in CI is enough until a cross-browser bug actually occurs.
- Uploading failure screenshots or traces as artifacts. Easy to add once the gate has
  caught something and the logs prove insufficient.
- PR-triggered runs and branch protection. Explicitly declined above; revisit if a bad
  merge ever reaches master.
- Vendoring the CDN assets. Recorded as the real fix for test-time network dependence,
  deferred as too large for this change.

## Risks

| Risk | Mitigation |
| --- | --- |
| The gate is wired up but never actually blocks | The falsification run in Testing, step 1 |
| Piping the suite silently voids the exit code | Called out inline in the workflow design; verify the run step is unpiped during review |
| Playwright browser download makes every deploy slow | npm cache keyed on the lockfile; Chromium only, not all browsers. If the added minutes become a problem, revisit vendoring. |
| Retry masks a genuinely flaky test as passing | The retry re-runs the whole suite and both attempts are visible in the logs. A test that needs the retry regularly should be fixed, not tolerated. |
