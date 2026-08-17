# Build step: precompile JSX, vendor the runtime deps

Date: 2026-08-17
Status: approved for implementation

## Problem

`crm.html` ships as a single file that compiles itself in the browser. On every page
load it fetches five things from a CDN — react, react-dom, `@babel/standalone`,
`supabase-js` (unpkg) and Tailwind (`cdn.tailwindcss.com`) — then Babel Standalone
transforms 3,400 lines of JSX at runtime before anything renders.

Three costs:

1. **Delivery.** The user pays a ~3MB Babel download and a full compile on every visit.
2. **Availability.** Five external dependencies sit on the critical path of an app the
   team uses daily. A CDN outage is an outage.
3. **Test reliability.** Every one of the 174 tests loads those same CDN scripts, so the
   suite needs the network. `pages.yml` carries a retry-once hack purely to absorb unpkg
   blips, which also silently absorbs genuinely flaky tests.

This is the delivery-architecture gap that holds the app at 8.5 on the strict rubric.

## Goals

- `dist/crm.html` makes **zero** network requests.
- No JSX compilation in the browser; Babel Standalone is gone.
- The 174-test gate verifies the artifact that actually ships.
- `crm.html` remains the single, hand-editable source of truth, as pleasant to work on
  as it is today.

## Non-goals

- Splitting `crm.html` into `src/` modules. Considered and rejected: a 3,400-line
  restructure on top of a delivery change is two risky changes at once.
- Error monitoring, and the `retentionStats` currency defect at `crm.html:1247`. Both
  remain open, tracked separately.

## Architecture

### Source layout

```
crm.html        source of truth — hand-edited, JSX inline, exactly as today
vendor/         committed, pinned runtime deps (never fetched at build time)
build.mjs       the build
dist/           generated, gitignored
  crm.html      self-contained artifact — what Pages serves
  index.html    copy of the above; fixes the long-standing /crm/ root 404
```

### The build is a transform, not a bundle

`build.mjs` uses esbuild to convert JSX to plain JS and does **not** bundle modules.
React, ReactDOM and `supabase` remain browser **globals**, supplied by vendored UMD
files inlined ahead of the app script — precisely as they are today. This is what keeps
the change small: no module system, no import rewriting, and existing call sites such as
`supabase.createClient(...)` at `crm.html:66` and `crm.html:2997` keep working verbatim.

Steps:

1. Read `crm.html`; extract the body of `<script type="text/babel" data-presets="react">`.
2. `esbuild.transform(src, { loader: "jsx", target: "es2020" })`.
3. Run the Tailwind CLI with `crm.html` as its content source to produce a real
   stylesheet. The existing `<style>` block (the `.nm` / `.grad` design tokens) is
   concatenated ahead of it, unchanged.
4. Inline everything: the three vendored UMD scripts, the compiled CSS, the five Inter
   woff2 faces as base64 `@font-face` sources, and the compiled app JS.
5. Write `dist/crm.html` and `dist/index.html`.

### Vendored dependencies

Committed under `vendor/` at pinned versions so a build never touches the network:

| File | Source |
|---|---|
| `react.production.min.js` | react 18 UMD |
| `react-dom.production.min.js` | react-dom 18 UMD |
| `supabase.umd.js` | @supabase/supabase-js 2 UMD |
| `inter-{400,500,600,700,800}.woff2` | Inter, the five weights the app uses |

Tailwind is a build-time dev dependency, not a vendored runtime file — its output is
compiled CSS.

### The one source change

Additive, at `crm.html:66`:

```js
const sb = window.__sbFactory ? window.__sbFactory()
         : CONFIGURED ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
```

`window.__sbFactory` is never set in production, so production behavior is unchanged.
This replaces a regex-over-source-text seam with a runtime one — necessary because the
old seam matched JSX source that no longer exists after compilation, and depending on
compiler output formatting would make the test gate hostage to a bundler flag.

`CONFIGURED` is untouched: it already evaluates `true` from the committed constants, so
the harness needs no override for it.

## Testing

### Harness

`tests/health/harness.mjs` keeps its shape — read HTML, inject a seed `<script>` right
after `<body>`, write to a temp file, load over `file://`. Two changes:

- It reads `dist/crm.html` instead of `crm.html`.
- The two `html.replace(/const CONFIGURED = …/)` calls (`:119`, `:146`) are deleted.
  `MOCK` and `STATEFUL_MOCK` become `window.__sbFactory = () => { … }` and ride in on the
  existing injected seed script, which already runs before the app bootstraps at the end
  of `<body>`.

No individual test file changes. All 174 tests then exercise the shipped artifact.

### New test

An offline assertion: load `dist/crm.html` with a Playwright `page.on("request")`
listener and fail on any request whose URL is not the `file://` document itself.

### Falsification standard

Applying the standard set by the `ci/test-gate` work — a gate that has not been seen
red has not been tested:

1. Prove the suite goes **red** against a deliberately broken build.
2. Prove the offline test goes **red** if a CDN `<script>` tag is restored.
3. Diff the rendered app against the current live page to confirm Tailwind's compiled
   stylesheet dropped no classes.
4. Serve `dist/` over localhost and exercise the app by hand before merging.

## CI

`pages.yml`:

- The `test` job gains a `node build.mjs` step before the suite, then uploads `dist/`
  with `actions/upload-artifact`.
- The `deploy` job downloads that artifact and hands it to `upload-pages-artifact`
  instead of `path: .`. The bytes that passed the gate are the bytes published — no
  rebuild between gate and deploy, and the public site stops serving source, `vendor/`
  and `tests/`.
- **The retry-once step on the suite is removed.** It existed to absorb unpkg blips;
  with nothing loaded from a CDN, a second run would only absorb a flaky test. The
  `deploy-pages` retry stays — that one absorbs a real GitHub-side flake.

Standing rule, unchanged: never pipe `run.mjs`. Its exit code *is* the gate.

## Risks

| Risk | Mitigation |
|---|---|
| Tailwind purges a class built dynamically | Checked: all 50 `className={\`…${…}\`}` interpolations splice **whole** class strings from ternaries or lookup tables. No `bg-${x}` fragment construction exists, so the static scanner sees every class. |
| esbuild's JSX output differs from Babel's | Both target `React.createElement` against the same React 18. The 174-test suite is the check. |
| Artifact size once fonts are inlined | Measure after the first build; if the five woff2 faces prove heavy, subsetting is the lever. |
| A stale `dist/` is served | `dist/` is gitignored and built fresh in CI on every run. There is no committed copy to go stale. |

## Rollout

Feature branch → PR → merge to master, which deploys. Live URL after merge:
`https://manshw-pixel.github.io/crm/` now resolves, with `/crm/crm.html` still working.
