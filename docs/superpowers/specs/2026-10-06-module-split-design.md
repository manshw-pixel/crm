# Module split: crm.html source into ordered src/ files

Date: 2026-10-06 · Status: approved design, awaiting spec review

## Goal

Make the app easier to work in. The single `<script>` block in `crm.html` (about
4,900 lines) becomes about 27 smaller source files grouped by area. **Behaviour,
build output and deployment stay exactly the same.** The goal the user picked is
"easier to work in". Enforced module boundaries (imports/exports) and Node unit
tests were explicitly not chosen and are out of scope.

## Why concatenation, not ES modules

Today every top-level function and constant is a global, because the whole app
is one classic script. `build.mjs` compiles that block with `esbuild.transform`
(no bundling). React, ReactDOM and supabase are browser globals from vendored
UMD files. The tests rely on the globals: they call `seedData()`, read
`window.__health` and `window.__store` from inside the page, and the harness
reads the built `dist/crm.html`.

Joining ordered source files back into one script keeps all of that true by
construction. Converting to `import`/`export` would turn hundreds of implicit
globals into explicit imports, a large and risky rewrite for a goal that was not
asked for.

## Design

### Layout

- `crm.html` keeps the page shell: `<head>`, the `<style>` block, `<body>`, and
  an **empty** `<script type="text/babel" data-presets="react"></script>`. That
  block marks where the built script goes.
- `src/NN-name.jsx` hold the code, in load order. The two-digit prefix *is* the
  order: the build sorts filenames, so there is no separate manifest to drift.
- Files are plain JSX fragments of one shared script. They have no imports or
  exports, and they may use any global defined in an earlier file (or a later
  one, from inside a function body), exactly as today.

### File map

Each file begins at its anchor line and runs to the line before the next file's
anchor. Anchors are existing section-marker comments, or a top-level
declaration where a marker group mixes concerns. When an anchor is a
declaration, the contiguous comment lines directly above it belong to the same
file. The first file starts on the line after the opening `<script>` tag; the
last ends on the line before `</script>`.

| File | Anchor (first line) | Holds |
|---|---|---|
| `00-core-config.jsx` | first script line | health-score doc comment, **TEAM CONFIG**, constants, date helpers, health scoring |
| `01-qbr.jsx` | `/* --- QBR cadence --- */` | QBR cadence |
| `02-seed-data.jsx` | `/* --- seed data --- */` | `seedData`, `emptyData` |
| `03-audit.jsx` | `/* --- audit trail --- */` | audit trail |
| `04-store.jsx` | `/* --- store (Supabase) --- */` | Supabase client, `fetchAll` |
| `05-error-reporting.jsx` | `/* --- error reporting --- */` | `reportError` and friends |
| `06-write-queue.jsx` | `/* --- write queue --- */` | `writeQueue` |
| `07-reducer.jsx` | `function persist(` | `persist`, `reducer` |
| `08-playbook-engine.jsx` | `/* --- renewal playbook --- */` | renewal playbook seeding, task queue helpers |
| `09-charts.jsx` | `/* --- tiny charts --- */` | Sparkline, TrendLine, LineChart, StackedBars, DistBar |
| `10-ui-atoms.jsx` | `/* --- UI atoms --- */` | Card, Stat, chips, ScrollList, MoreMenu, Btn, Select, … |
| `11-toasts.jsx` | `/* --- toasts --- */` | ToastProvider |
| `12-attachments.jsx` | `/* --- attachments --- */` | attachments, quick actions |
| `13-forms.jsx` | `/* --- account documents --- */` | DocumentsCard and every account form |
| `14-retention-math.jsx` | `/* --- Dashboard --- */` | retention, point-in-time ARR, AM-book maths |
| `15-analytics-cards.jsx` | `/* --- cohort retention --- */` | CohortGrid, ChurnAnalysis, RenewalOutcomes, AmBookCard |
| `16-dashboard.jsx` | `function Dashboard(` | Dashboard |
| `17-csv.jsx` | `/* --- Account list --- */` | subNumbers, CSV export/import, CSV dates |
| `18-drive-sync.jsx` | `/* --- shared-drive folder sync --- */` | IntegrationsCard and folder sync |
| `19-dialogs-bulk.jsx` | `/* --- bulk actions --- */` | Modal, ConfirmDialog, BulkDialog |
| `20-account-list.jsx` | `/* --- list windowing --- */` | windowing, AccountList |
| `21-account-detail.jsx` | `/* --- Account detail --- */` | ChangeHistoryCard, AccountDetail |
| `22-tasks.jsx` | `/* --- tasks view --- */` | TaskRow, TasksView |
| `23-renewals.jsx` | `/* --- Renewals --- */` | Renewals |
| `24-settings.jsx` | `/* --- Playbook --- */` | playbook cards, RecencyWindowInputs, Settings |
| `25-auth-admin.jsx` | `/* --- Auth (Supabase) --- */` | Setup/Auth/NewPassword screens, ClientConsole, UsersCard, ErrorLogCard |
| `26-app.jsx` | `/* --- App --- */` | NavIcon, CommandPalette, SyncStatus, App, Root, render call |

Order is fixed by the original file: UsersCard and ErrorLogCard stay in
`25-auth-admin.jsx` because they come after ClientConsole, and moving them would
change the output. Reordering is out of scope.

### Build (`build.mjs`)

- Read `src/*.jsx`, sorted by filename. Join the contents with **nothing** in
  between; each file keeps its own trailing newline exactly as cut. The result
  is the script text and goes into the empty `<script type="text/babel">` block.
  From there the existing pipeline is unchanged (stamp, esbuild transform,
  Tailwind, fonts, vendor inlining).
- `APP_VERSION` stamping runs on the joined text. Its literal now lives in
  `00-core-config.jsx`, and the existing "literal not found → throw" guard stays.
- New guards, each throwing with a clear message:
  - `src/` is missing or holds no `.jsx` files
  - a `src/` file is empty
  - the `<script type="text/babel">` block in `crm.html` is **not** empty (someone
    edited code into the shell, which would otherwise be silently overwritten or
    duplicated)
- The generated-file header comment changes to "edit crm.html (shell) and src/".

### Tailwind

`tailwind.config.js` `content` becomes `["./crm.html", "./src/**/*.jsx"]`, and
its comment is updated. **This is load-bearing.** If it is missed, every class
used only in moved code silently vanishes from the CSS.

### How the split is produced

A one-off Node script reads `crm.html` from `origin/master`, finds each anchor
from the table, and writes the slices to `src/`. The split is therefore exact and
repeatable, not hand-moved. The script asserts that:

- every anchor is found exactly once, in table order
- the slices joined equal the original script text byte for byte

The script is run once, then deleted. It is not committed as a maintained tool.

### Docs and copy

- The in-app SetupScreen text ("Open `crm.html` … paste both into the
  `TEAM CONFIG` block") points at `src/00-core-config.jsx`.
- `TEAM-SETUP.md` says the same.
- `docs/` gets one short note in the build-step spec's area, or a README line
  under `src/`, explaining the numbered-file convention and "add new code to
  the file for its area; a new area gets a new number".
- Existing comments that cite `crm.html:NNNN` line numbers are left as they
  are. They were already approximate.

## Verification

1. **Byte identity (the acceptance gate).** Build `origin/master` and build the
   branch. `dist/crm.html` must be identical except for:
   - the `APP_VERSION` stamp (different commit SHA)
   - the generated-header comment line
   - the SetupScreen copy change

   Compare with those three normalised (or build the branch once before the copy
   change for a pure identity check, then once after). Any other difference fails
   the gate.
2. **Tailwind CSS identical.** This is covered by (1), since the CSS is inlined.
   A missed content glob shows up as a difference.
3. The guards each fire, checked by temporarily breaking the input:
   - an empty `src/` file
   - code left in the shell's script block
4. Full health suite and RLS suite in CI.

## Out of scope

- `import`/`export`, bundling, or any change to the global-scope model
- Node unit tests
- Renaming, reordering or restyling any code
- Changing behaviour, the deploy, or the test harness
- Updating `crm.html:NNNN` line references in comments and tests

## Follow-on (not this spec)

Once code lives in `src/`, the "enforced boundaries" and "fast unit tests" goals
become incremental: one area at a time can gain explicit exports, starting with
pure logic (scoring, money maths, CSV parsing). Each would be its own spec.
