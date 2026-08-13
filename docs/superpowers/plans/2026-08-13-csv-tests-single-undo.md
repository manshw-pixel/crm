# CSV Import Tests, Single-Delete Undo, and Filter Labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three gaps holding OneVio CRM at 8/10 — untested CSV import, undo that exists for bulk deletes but not single deletes, and five unlabeled filter dropdowns.

**Architecture:** Everything is a single-file React app (`crm.html`) tested by a Playwright harness in `tests/health/`. CSV functions become testable by joining the existing `window.__health` seam. Single-delete undo reuses `snapshotFor` + `RESTORE_SNAPSHOT` unchanged. No new dependencies, no new tables.

**Tech Stack:** React 18 + Babel standalone (in-browser JSX), Tailwind CDN, Supabase JS v2, Playwright (msedge channel), plain `node --test`-free custom runner (`tests/health/run.mjs`).

Spec: `docs/superpowers/specs/2026-08-13-csv-tests-single-undo-design.md`

## Global Constraints

- **All changes to `crm.html` are additive.** Existing features are strictly preserved. Merging to master auto-deploys the live team app.
- **Baseline: 90 passed, 0 failed.** Run `node tests/health/run.mjs` from `D:\AI Project\My Company`. Every task must end green.
- **Run exactly ONE suite at a time.** Concurrent Playwright runs compete for browsers and make runs take ~50 minutes.
- **Tests import playwright from `tests/node_modules`.** A test file must live under `tests/` or the import fails with `ERR_MODULE_NOT_FOUND`.
- **A new test MUST be seen failing before its implementation lands.** If it passes on first run, the case was already covered — say so rather than claiming credit.
- **Never dispatch a delete or restore programmatically in a test cleanup path.** Undo is one-shot and human-clicked.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `crm.html` | `window.__health` seam (~3255); `importAccountsCSV` (~1659-1713); import banner (~2066); `AccountDetail` delete button (~2273); filter selects (~2025-2030) | Modify |
| `tests/health/csv.test.mjs` | Parser + import behavior + coercion counters | Create |
| `tests/health/bulk.test.mjs` | Single-delete undo | Modify (append) |
| `tests/health/persistence.test.mjs` | Single-delete undo survives a reload | Modify (append) |
| `tests/health/a11y.test.mjs` | Select-label sweep | Modify (append) |
| `tests/health/run.mjs` | Register `csv.test.mjs` | Modify |

---

### Task 1: Expose the CSV functions and test the parser

**Files:**
- Modify: `crm.html:3255` (the `window.__health` line)
- Create: `tests/health/csv.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Produces: `window.__health.parseCSV(text) -> string[][]` and
  `window.__health.importAccountsCSV(file, accounts, dispatch, done, user) -> void`.
  Task 2 and Task 3 both consume these.

- [ ] **Step 1: Widen the test seam**

`crm.html` line 3255 currently reads:

```js
window.__health = { isoPlus, addMonths, BAND_RANK, healthPlaybookOf, DEFAULT_HEALTH_PLAYBOOK, backfillCandidates, bucketTasks, filterTasks };
```

Replace with:

```js
window.__health = { isoPlus, addMonths, BAND_RANK, healthPlaybookOf, DEFAULT_HEALTH_PLAYBOOK, backfillCandidates, bucketTasks, filterTasks, parseCSV, importAccountsCSV };
```

This is the only production change in Task 1. Both functions are already defined at
module scope above this line (`parseCSV` ~1642, `importAccountsCSV` ~1659).

- [ ] **Step 2: Write the parser tests**

Create `tests/health/csv.test.mjs`:

```javascript
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "a1", name: "Alpha Corp", csm: "Priya", tier: "Mid" });
A.accountNo = 1;
const seed = `window.__seedRows = { accounts: ${JSON.stringify([A])}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

const parse = (page, text) => page.evaluate(t => window.__health.parseCSV(t), text);

test("parseCSV keeps a quoted comma inside one field", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__health);
  const rows = await parse(page, 'name,industry\n"Acme, Inc.",Tech\n');
  assert(rows.length === 2, `expected 2 rows, got ${rows.length}`);
  assert(rows[1][0] === "Acme, Inc.", `quoted comma split the field: ${JSON.stringify(rows[1])}`);
  assert(rows[1][1] === "Tech", `second field wrong: ${JSON.stringify(rows[1])}`);
  await browser.close();
});

test("parseCSV unescapes a doubled quote", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__health);
  const rows = await parse(page, 'name\n"She said ""hi"""\n');
  assert(rows[1][0] === 'She said "hi"', `got ${JSON.stringify(rows[1][0])}`);
  await browser.close();
});

test("parseCSV treats CRLF the same as LF", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__health);
  const lf = await parse(page, "name,tier\nAlpha,Mid\nBeta,SMB\n");
  const crlf = await parse(page, "name,tier\r\nAlpha,Mid\r\nBeta,SMB\r\n");
  assert(JSON.stringify(lf) === JSON.stringify(crlf), `CRLF differs from LF:\n${JSON.stringify(lf)}\n${JSON.stringify(crlf)}`);
  await browser.close();
});

test("parseCSV keeps a newline inside a quoted field", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__health);
  const rows = await parse(page, 'name,note\nAlpha,"line one\nline two"\n');
  assert(rows.length === 2, `a quoted newline split the row: ${JSON.stringify(rows)}`);
  assert(rows[1][1] === "line one\nline two", `got ${JSON.stringify(rows[1][1])}`);
  await browser.close();
});

test("parseCSV drops blank and whitespace-only rows", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__health);
  const rows = await parse(page, "name,tier\n\nAlpha,Mid\n   ,\t\nBeta,SMB\n");
  assert(rows.length === 3, `expected header + 2 data rows, got ${rows.length}: ${JSON.stringify(rows)}`);
  await browser.close();
});

test("parseCSV emits the final row when there is no trailing newline", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__health);
  const rows = await parse(page, "name,tier\nAlpha,Mid");
  assert(rows.length === 2, `final row dropped: ${JSON.stringify(rows)}`);
  assert(rows[1][1] === "Mid", `got ${JSON.stringify(rows[1])}`);
  await browser.close();
});
```

- [ ] **Step 3: Register the file**

In `tests/health/run.mjs`, after `import "./persistence.test.mjs";` add:

```javascript
import "./csv.test.mjs";
```

- [ ] **Step 4: Run and confirm**

Run: `node tests/health/run.mjs`

Expected: **96 passed, 0 failed** (90 baseline + 6).

These parser tests exercise existing, unchanged code, so they are expected to PASS on
the first run. That is correct here and is not a TDD violation — the seam change in
Step 1 is what makes them runnable. If any FAILS, that is a genuine parser bug: stop
and report it rather than editing the test to match the behavior.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/csv.test.mjs tests/health/run.mjs
git commit -m "test: cover the CSV parser and expose it via the __health seam

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Test import behavior

**Files:**
- Modify: `tests/health/csv.test.mjs` (append)

**Interfaces:**
- Consumes: `window.__health.importAccountsCSV` from Task 1.
- Produces: nothing new. No production code changes in this task.

- [ ] **Step 1: Write the import tests**

Append to `tests/health/csv.test.mjs`:

```javascript
// importAccountsCSV(file, accounts, dispatch, done, user) reads the File with a
// FileReader, so the helper resolves on the `done` callback rather than returning.
const runImport = (page, csv) => page.evaluate(async text => {
  const file = new File([text], "accounts.csv", { type: "text/csv" });
  const st = window.__store.getState();
  const dispatched = [];
  const spy = a => { dispatched.push({ type: a.type, id: a.id, patch: a.patch, item: a.item, inputs: a.inputs }); window.__store.dispatch(a); };
  const result = await new Promise(res => window.__health.importAccountsCSV(file, st.accounts, spy, res, { name: "Tester" }));
  await new Promise(r => setTimeout(r, 80));
  return { result, dispatched, accounts: window.__store.getState().accounts.map(a => ({ id: a.id, name: a.name, tier: a.tier, accountNo: a.accountNo })) };
}, csv);

test("import rejects a file with no data rows", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, dispatched } = await runImport(page, "name,tier\n");
  assert(!!result.err, `expected an error, got ${JSON.stringify(result)}`);
  assert(result.err.includes("No data rows"), `wrong error: ${result.err}`);
  assert(dispatched.length === 0, `nothing should be dispatched: ${JSON.stringify(dispatched)}`);
  await browser.close();
});

test("import rejects a header without a name column", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, dispatched } = await runImport(page, "tier,arr\nMid,1000\n");
  assert(!!result.err, `expected an error, got ${JSON.stringify(result)}`);
  assert(result.err.includes('"name"'), `error should name the name column: ${result.err}`);
  assert(dispatched.length === 0, `nothing should be dispatched: ${JSON.stringify(dispatched)}`);
  await browser.close();
});

test("import skips rows with an empty name and counts them", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result } = await runImport(page, "name,tier\n,Mid\nBeta Co,SMB\n");
  assert(result.skipped === 1, `expected skipped 1, got ${JSON.stringify(result)}`);
  assert(result.ok === 1, `the named row should still import, got ${JSON.stringify(result)}`);
  await browser.close();
});

test("import creates a new account and counts it as ok", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, dispatched, accounts } = await runImport(page, "name,tier\nBeta Co,SMB\n");
  assert(result.ok === 1 && result.updated === 0, `expected 1 new, got ${JSON.stringify(result)}`);
  assert(dispatched.some(d => d.type === "ADD_ACCOUNT"), `expected ADD_ACCOUNT: ${JSON.stringify(dispatched.map(d => d.type))}`);
  assert(accounts.length === 2, `expected 2 accounts, got ${accounts.length}`);
  await browser.close();
});

test("import matches an existing accountNo and updates instead of duplicating", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, dispatched, accounts } = await runImport(page, "accountNo,name,tier\n1,Renamed Corp,SMB\n");
  assert(result.updated === 1 && result.ok === 0, `expected an update, got ${JSON.stringify(result)}`);
  assert(dispatched.some(d => d.type === "EDIT_ACCOUNT" && d.id === "a1"), `expected EDIT_ACCOUNT on a1: ${JSON.stringify(dispatched)}`);
  assert(accounts.length === 1, `must not create a second account, got ${accounts.length}`);
  await browser.close();
});

// Pinned deliberately: case-insensitive name matching is what makes re-importing an
// export idempotent instead of doubling every account.
test("import matches an existing name case-insensitively", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, accounts } = await runImport(page, "name,tier\nalpha corp,SMB\n");
  assert(result.updated === 1 && result.ok === 0, `expected a case-insensitive match, got ${JSON.stringify(result)}`);
  assert(accounts.length === 1, `must not create a duplicate, got ${JSON.stringify(accounts)}`);
  await browser.close();
});

test("import dispatches UPDATE_INPUTS when health columns are present", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { dispatched } = await runImport(page, "accountNo,name,usage,sentiment,tickets,nps\n1,Alpha Corp,55,60,3,20\n");
  const inputs = dispatched.find(d => d.type === "UPDATE_INPUTS");
  assert(inputs, `expected UPDATE_INPUTS: ${JSON.stringify(dispatched.map(d => d.type))}`);
  assert(inputs.inputs.usage === 55 && inputs.inputs.nps === 20, `wrong inputs: ${JSON.stringify(inputs.inputs)}`);
  await browser.close();
});

test("import coerces a non-numeric arr to 0 rather than NaN", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { dispatched } = await runImport(page, "name,arr\nGamma Co,not-a-number\n");
  const add = dispatched.find(d => d.type === "ADD_ACCOUNT");
  assert(add, "expected ADD_ACCOUNT");
  assert(add.item.arr === 0, `arr should coerce to 0, got ${JSON.stringify(add.item.arr)}`);
  await browser.close();
});
```

- [ ] **Step 2: Run and confirm**

Run: `node tests/health/run.mjs`

Expected: **104 passed, 0 failed** (96 + 8).

These test existing behavior and should PASS on the first run. Any FAIL is a real
import bug — stop and report it with the failing assertion rather than adjusting the
test to match.

- [ ] **Step 3: Commit**

```bash
git add tests/health/csv.test.mjs
git commit -m "test: cover CSV import matching, counting and coercion

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Surface the silent tier and status coercions

**Files:**
- Modify: `crm.html:1663`, `crm.html:1668`, `crm.html:1679`, `crm.html:1686`, `crm.html:1712` (`importAccountsCSV`), `crm.html:2066` (the banner)
- Modify: `tests/health/csv.test.mjs` (append)

**Interfaces:**
- Consumes: `window.__health.importAccountsCSV` from Task 1.
- Produces: the `done` payload gains `badTier: number` and `badStatus: number`. Present
  on every `done(...)` call, including the two error paths, so the banner never reads
  `undefined`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/health/csv.test.mjs`:

```javascript
// An unrecognized tier silently becomes "Mid" and an unrecognized contractStatus
// silently becomes "Active". A wrongly-mapped column therefore retiers a whole book
// with no signal. Keep the fallback -- failing the import outright is worse -- but
// count the coercions and report them.
test("import counts an unrecognized tier and still falls back to Mid", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, dispatched } = await runImport(page, "name,tier\nDelta Co,Enterprise-Plus\n");
  assert(result.badTier === 1, `expected badTier 1, got ${JSON.stringify(result)}`);
  const add = dispatched.find(d => d.type === "ADD_ACCOUNT");
  assert(add.item.tier === "Mid", `fallback value should be unchanged, got ${add.item.tier}`);
  await browser.close();
});

test("import counts an unrecognized contractStatus", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, dispatched } = await runImport(page, "name,contractStatus\nEcho Co,Pending Signature\n");
  assert(result.badStatus === 1, `expected badStatus 1, got ${JSON.stringify(result)}`);
  const add = dispatched.find(d => d.type === "ADD_ACCOUNT");
  assert(add.item.contractStatus === "Active", `fallback value should be unchanged, got ${add.item.contractStatus}`);
  await browser.close();
});

// An empty cell is a missing value, not a mis-typed one, and must not be reported.
test("an empty tier cell is not counted as a coercion", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result } = await runImport(page, "name,tier\nFoxtrot Co,\n");
  assert(result.badTier === 0, `an empty cell must not count, got ${JSON.stringify(result)}`);
  await browser.close();
});

test("a valid tier in different case is not counted as a coercion", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, dispatched } = await runImport(page, "name,tier\nGolf Co,enterprise\n");
  assert(result.badTier === 0, `case-insensitive match must not count, got ${JSON.stringify(result)}`);
  const add = dispatched.find(d => d.type === "ADD_ACCOUNT");
  assert(add.item.tier === "Enterprise", `expected Enterprise, got ${add.item.tier}`);
  await browser.close();
});

test("the error paths still return the coercion counters", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result } = await runImport(page, "tier,arr\nMid,1000\n");
  assert(result.badTier === 0 && result.badStatus === 0, `error payload must carry counters, got ${JSON.stringify(result)}`);
  await browser.close();
});

test("the import banner reports unrecognized tiers", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const text = await page.evaluate(async () => {
    const file = new File(["name,tier\nHotel Co,Enterprise-Plus\n"], "a.csv", { type: "text/csv" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('input[type="file"][accept*="csv"]');
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const banner = [...document.querySelectorAll("div")].find(d => d.textContent.startsWith("Imported "));
    return banner ? banner.textContent : "";
  });
  assert(text.includes("unrecognized tier"), `banner should warn about the coercion, got: ${text.slice(0, 200)}`);
  await browser.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/health/run.mjs`

Expected: **104 passed, 6 failed**. The five payload tests fail on
`result.badTier === undefined`; the banner test fails because the text is absent.

- [ ] **Step 3: Add the counters**

In `crm.html`, inside `importAccountsCSV`:

Line 1663 — add the counters to the no-data-rows error:

```js
    if (rows.length < 2) return done({ ok: 0, updated: 0, skipped: 0, badTier: 0, badStatus: 0, err: "No data rows found — the first row must be a header (name, tier, arr, …)." });
```

Line 1668 — add them to the missing-name error:

```js
    if (!has("name")) return done({ ok: 0, updated: 0, skipped: 0, badTier: 0, badStatus: 0, err: 'The header row needs a "name" column (matching Export CSV format works).' });
```

Find the counter declarations (`let ok = 0, updated = 0, skipped = 0;`) and extend:

```js
    let ok = 0, updated = 0, skipped = 0, badTier = 0, badStatus = 0;
```

Line 1679 — replace the tier line with:

```js
      if (has("tier")) {
        const raw = col(r, "tier");
        const match = ["Enterprise", "Mid", "SMB"].find(t => t.toLowerCase() === raw.toLowerCase());
        // an empty cell is a missing value, not a mis-typed one -- don't report it
        if (raw && !match) badTier++;
        vals.tier = match || "Mid";
      }
```

Line 1686 — replace the contractStatus line with:

```js
      if (has("contractstatus")) {
        const raw = col(r, "contractstatus");
        const match = ["Active", "Auto-renew", "In negotiation", "Churn risk"].find(s => s.toLowerCase() === raw.toLowerCase());
        if (raw && !match) badStatus++;
        vals.contractStatus = match || "Active";
      }
```

Line 1712 — the success payload:

```js
    done({ ok, updated, skipped, badTier, badStatus });
```

- [ ] **Step 4: Add the banner warning**

In `crm.html` line 2066, inside the success branch, insert the two warnings
immediately after the existing `skipped` clause and before the `. Columns:` text:

```jsx
        {importMsg.err ? importMsg.err : <>Imported {importMsg.ok} new · updated {importMsg.updated} existing (matched by account # or name){importMsg.skipped ? ` · skipped ${importMsg.skipped} row(s) without a name` : ""}{importMsg.badTier ? ` · ${importMsg.badTier} row(s) had an unrecognized tier (set to Mid)` : ""}{importMsg.badStatus ? ` · ${importMsg.badStatus} row(s) had an unrecognized status (set to Active)` : ""}. Columns: accountNo, name (required), tier, arr, currency, industry, csm, startDate, renewalDate, contractStatus, modules, licenses, dedicatedSupport, billingCompleted, billingCompletedDate, usage, sentiment, tickets, nps.</>}
```

The `importMsg.badTier ? … : ""` guard means an absent or zero counter renders nothing,
so the banner is unchanged for a clean import.

- [ ] **Step 5: Run to verify they pass**

Run: `node tests/health/run.mjs`

Expected: **110 passed, 0 failed**.

- [ ] **Step 6: Commit**

```bash
git add crm.html tests/health/csv.test.mjs
git commit -m "feat: report unrecognized tier and status values on CSV import

A mis-mapped column silently retiered every imported account to Mid. The
fallback stays -- failing the whole import on one bad cell is worse -- but the
coercions are now counted and surfaced in the import banner.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Undo on single-account delete

**Files:**
- Modify: `crm.html:2201` (`AccountDetail` signature area — add `useToast`), `crm.html:2273` (the delete button)
- Modify: `tests/health/bulk.test.mjs` (append)
- Modify: `tests/health/persistence.test.mjs` (append)

**Interfaces:**
- Consumes: `snapshotFor(state, ids)` (crm.html ~246) and the `RESTORE_SNAPSHOT` action,
  both unchanged. `useToast()` returns the `toast({ text, tone, undo })` function.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Append to `tests/health/bulk.test.mjs`:

```javascript
// Bulk-deleting 20 accounts was undoable while deleting one was permanent. A user who
// learns to trust undo on the bulk path would get burned on the more common one.
test("deleting a single account offers an undo that restores it with its children", async () => {
  const { page, browser } = await launch(cascadeSeed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(async () => {
    window.confirm = () => true; // the blocking confirm stays; auto-accept it
    // each row is <tr onClick={() => openAccount(a.id)}>, so clicking it opens detail
    const row = [...document.querySelectorAll("tbody tr")].find(r => r.textContent.includes("Parent"));
    if (!row) return { err: "parent row not found" };
    row.click();
    await new Promise(r => setTimeout(r, 250));
    const del = [...document.querySelectorAll("button")].find(b => b.textContent === "Delete account");
    if (!del) return { err: "no delete button — is the seeded user an admin?" };
    del.click();
    await new Promise(r => setTimeout(r, 250));
    const afterDelete = window.__store.getState().accounts.map(a => a.id);
    const undo = document.querySelector("[data-toast-undo]");
    if (!undo) return { err: "no undo toast after single delete", afterDelete };
    undo.click();
    await new Promise(r => setTimeout(r, 300));
    const s = window.__store.getState();
    return {
      afterDelete,
      accounts: s.accounts.map(a => a.id).sort(),
      subParent: (s.accounts.find(a => a.id === "s1") || {}).parentId,
      contacts: s.contacts.map(c => c.id).sort(),
      tasks: s.tasks.map(t => t.id).sort(),
      activities: s.activities.length,
      opps: s.opportunities.length,
    };
  });
  assert(!res.err, res.err);
  assert(res.afterDelete.join() === "s1", `only the orphaned sub should remain after delete, got ${JSON.stringify(res.afterDelete)}`);
  assert(res.accounts.join() === "p1,s1", `undo should restore the parent, got ${JSON.stringify(res.accounts)}`);
  assert(res.subParent === "p1", `undo should restore the sub's parentId, got ${JSON.stringify(res.subParent)}`);
  assert(res.contacts.join() === "c1,c2", `undo should restore contacts, got ${JSON.stringify(res.contacts)}`);
  assert(res.tasks.join() === "k1,k2", `undo should restore tasks, got ${JSON.stringify(res.tasks)}`);
  assert(res.activities === 1 && res.opps === 1, `undo should restore activities and opportunities, got ${res.activities}/${res.opps}`);
  await browser.close();
});
```

Note on the seed: `cascadeSeed` in this file has `team: [], settings: []` and no
`profiles` key, so the harness mock falls back to `{ id: "u1", name: "Test User",
role: "admin" }` — the delete button is admin-only and will render.

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/health/run.mjs`

Expected: **110 passed, 1 failed**, failing with `no undo toast after single delete`.

- [ ] **Step 3: Give AccountDetail a toast**

In `crm.html`, find the first line of `AccountDetail`'s body (immediately after the
signature at line 2201) and add:

```js
  const toast = useToast();
```

- [ ] **Step 4: Snapshot and offer undo**

Replace the delete button's `onClick` at line 2273:

```jsx
          onClick={() => { if (confirm(`Delete ${a.name} for the whole team, including its contacts, activities, tasks and opportunities?`)) { dispatch({ type: "DELETE_ACCOUNT", id: a.id }); back(); } }}>Delete account</button>}
```

with:

```jsx
          onClick={() => {
            if (!confirm(`Delete ${a.name} for the whole team, including its contacts, activities, tasks and opportunities?`)) return;
            // snapshot BEFORE the dispatch -- snapshotFor reads the pre-delete state and
            // already handles a single id, including sub-account parentIds
            const snapshot = snapshotFor(st, [a.id]);
            dispatch({ type: "DELETE_ACCOUNT", id: a.id });
            toast({ text: `Deleted ${a.name}.`, tone: "success",
              undo: () => dispatch({ type: "RESTORE_SNAPSHOT", snapshot }) });
            back();
          }}>Delete account</button>}
```

`st` is already a prop of `AccountDetail` and holds the full state. The toast lives in
`ToastProvider` above `App`, so it survives `back()` unmounting this view.

- [ ] **Step 5: Run to verify it passes**

Run: `node tests/health/run.mjs`

Expected: **111 passed, 0 failed**.

- [ ] **Step 6: Prove the undo persists**

Append to `tests/health/persistence.test.mjs`:

```javascript
test("SMOKE: undoing a single-account delete survives a reload", async () => {
  const { page, browser, reload } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 3);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const mid = await page.evaluate(async () => {
    window.confirm = () => true;
    const row = [...document.querySelectorAll("tbody tr")].find(r => r.textContent.includes("Other Co"));
    row.click();
    await new Promise(r => setTimeout(r, 250));
    const del = [...document.querySelectorAll("button")].find(b => b.textContent === "Delete account");
    if (!del) return { err: "no delete button" };
    del.click();
    await new Promise(r => setTimeout(r, 250));
    const gone = !window.__store.getState().accounts.some(a => a.id === "o1");
    document.querySelector("[data-toast-undo]").click();
    await new Promise(r => setTimeout(r, 400));
    return { gone };
  });
  assert(!mid.err, mid.err);
  assert(mid.gone, "the account should have been deleted before the undo");
  await reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length > 0);
  const after = await page.evaluate(() => {
    const s = window.__store.getState();
    return { accounts: s.accounts.map(a => a.id).sort(), contacts: s.contacts.filter(c => c.accountId === "o1").length, tasks: s.tasks.filter(t => t.accountId === "o1").length };
  });
  assert(after.accounts.includes("o1"), `the undone delete must survive a reload, got ${JSON.stringify(after.accounts)}`);
  assert(after.contacts === 1, `its contact should be restored too, got ${after.contacts}`);
  assert(after.tasks === 1, `its task should be restored too, got ${after.tasks}`);
  await browser.close();
});
```

- [ ] **Step 7: Run and commit**

Run: `node tests/health/run.mjs`

Expected: **112 passed, 0 failed**.

```bash
git add crm.html tests/health/bulk.test.mjs tests/health/persistence.test.mjs
git commit -m "feat: undo on single-account delete, matching the bulk path

Bulk-deleting 20 accounts was undoable while deleting one was permanent. The
blocking confirm stays -- this cascades across five tables -- and now also
offers the same 10s snapshot undo, reusing snapshotFor and RESTORE_SNAPSHOT
unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Label the filter selects

**Files:**
- Modify: `crm.html:2025-2030` (the five `<Select>` elements in the account list filter row)
- Modify: `tests/health/a11y.test.mjs` (append)

**Interfaces:**
- Consumes: nothing. `Select` already spreads unknown props onto the `<select>`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `tests/health/a11y.test.mjs`:

```javascript
// Written as a sweep rather than five assertions so a newly added select cannot
// regress it, matching the icon-only-button sweep above.
test("every select in the account list has an accessible name", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const bare = await page.evaluate(() => [...document.querySelectorAll("select")]
    .filter(s => !s.getAttribute("aria-label") && !s.getAttribute("aria-labelledby") && !s.closest("label"))
    .map(s => s.outerHTML.slice(0, 100)));
  assert(bare.length === 0, `selects without an accessible name:\n${bare.join("\n")}`);
  await browser.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/health/run.mjs`

Expected: **112 passed, 1 failed**, listing the five unlabeled selects.

- [ ] **Step 3: Add the labels**

In `crm.html`, add an `aria-label` to each of the five filter selects (lines ~2025-2030).
Leave every other attribute untouched:

```jsx
        <Select aria-label="Filter by tier" value={tier} onChange={e => setTier(e.target.value)} options={["All", "Enterprise", "Mid", "SMB"]} />
        <Select aria-label="Filter by health risk" value={risk} onChange={e => setRisk(e.target.value)} options={["All", "Green", "Yellow", "Red"]} />
        <Select aria-label="Filter by CSM" value={csm} onChange={e => setCsm(e.target.value)} options={csms} />
        <Select aria-label="Filter by renewal window in days" value={renew} onChange={e => setRenew(e.target.value)} options={["All", "30", "60", "90"]} />
        <Select aria-label="Filter by billing status" value={billing} onChange={e => setBilling(e.target.value)} options={["All", "Completed", "Pending"]} />
```

The adjacent `<span>` hints ("renew ≤ days", "billing") stay as they are — they are
visual affordances, and the `aria-label` is what a screen reader announces.

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/health/run.mjs`

Expected: **113 passed, 0 failed**.

If the sweep still fails, the remaining selects are elsewhere in the account list (for
example inside the bulk dialog when it is open) — label those too rather than narrowing
the test's selector.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/a11y.test.mjs
git commit -m "feat: label the account list filter selects

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification and PR

- [ ] **Step 1: Full suite**

Run: `node tests/health/run.mjs`
Expected: **113 passed, 0 failed**. Record the count for the PR body.

- [ ] **Step 2: Confirm the CSV path in the sandbox**

The stateful sandbox at `sandbox/build.mjs` rebuilds a Supabase-free copy:

```bash
node "C:/Users/manish.w/AppData/Local/Temp/claude/D--AI-Project-My-Company/dc1b1e77-ef39-4542-9916-67e8f8add2af/scratchpad/sandbox/build.mjs"
node "C:/Users/manish.w/AppData/Local/Temp/claude/D--AI-Project-My-Company/dc1b1e77-ef39-4542-9916-67e8f8add2af/scratchpad/sandbox/server.mjs"
```

Open http://localhost:8080, go to Accounts, import a small CSV with one bad tier value,
and confirm the banner shows the warning. This is a visual check of copy and wording,
which no assertion covers.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/csv-tests-single-undo
gh pr create --title "CSV import tests, single-delete undo, and filter labels" --body-file pr-body.md
```

Write `pr-body.md` first — PowerShell mangles inline quoting. Cover: the three gaps
closed, the coercion-reporting change and why the fallback was kept, that single-delete
undo inherits the bulk path's accepted delete/restore race, and the final test count.

**Do not merge without asking.** Merging to master auto-deploys the live team app.

---

## Self-Review Notes

**Spec coverage:** §1 test seam → Task 1 Step 1. §1.1 parser cases → Task 1 Step 2 (all
six rows of the table). §1.2 import cases → Task 2 (all eight rows). §1.3 coercion
counters + banner → Task 3. §2 single-delete undo → Task 4, including the reload proof.
§3 filter labels → Task 5. Testing section → every task ends with a full-suite run.
Regression surface → the `window.__health` collision is covered by both names being new;
the payload-shape risk is covered by Task 3 Step 1's error-path test; the `useToast`
risk is covered by Task 4 Step 3's note that `ToastProvider` wraps `App`.

**Type consistency:** `badTier`/`badStatus` are named identically in Task 3's tests,
the two error payloads, the counter declaration, both coercion blocks, the success
payload, and the banner. `snapshotFor(st, [a.id])` matches the existing
`snapshotFor(state, ids)` signature. `toast({ text, tone, undo })` matches the shape
used by `BulkDialog`.

**Expected counts:** 90 baseline → 96 (T1) → 104 (T2) → 110 (T3) → 112 (T4) → 113 (T5).

**Known deviation from strict TDD:** Tasks 1 and 2 test existing behavior, so their
tests pass on first run. This is called out explicitly in each task so a passing run is
not mistaken for a working red-green cycle. Tasks 3, 4 and 5 are true red-green.
