# UX Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No blocking `confirm()` remains; destructive actions are guarded in proportion to how reversible they are; a render crash costs one view instead of the whole app.

**Architecture:** The modal shell already inside `BulkDialog` is extracted to a reusable `<Modal>` and both dialogs share it. Reversible actions drop their dialog entirely and gain an Undo toast; irreversible ones get a `<ConfirmDialog>`, the worst two gated on a typed word. A single `<ViewBoundary>` keyed on the current view wraps the view switch. Three `aria-live` regions are added where content changes without focus moving.

**Tech Stack:** React 18 via unpkg (no build step), Tailwind classes, Playwright + the custom runner at `tests/health/run.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-14-ux-robustness-design.md`

## Global Constraints

- **Branch:** `ux/robustness`, already created off `80cf0b3`, already holds the spec commit (`c2f6f4d`).
- **Baseline: 160 passed, 0 failed.** Run `node tests/health/run.mjs` from `D:\AI Project\My Company`. Every task must end green.
- **Never pipe the suite.** Its exit code is the CI deploy gate; a pipe replaces it with the pipeline's status. Use `node tests/health/run.mjs > /tmp/out.log 2>&1; echo "EXIT=$?"` and read both the exit code and the summary line.
- **Run exactly ONE suite at a time.** Concurrent Playwright runs contend for browsers.
- **Register every new test file** in `run.mjs`'s hardcoded import list (lines 6-28). It does not glob; an unregistered file never runs and reports no failure.
- **Dispatch-then-read needs a settle.** `window.__store.getState()` returns the LAST COMMITTED RENDER's state. Inside a `page.evaluate` that dispatches, `await new Promise(r => setTimeout(r, 50))` before reading, or you assert against pre-dispatch state.
- **`waitForSelector` timeouts across many unrelated tests mean the network, not your code.** Every test loads React/Babel/Tailwind from unpkg. Re-run before debugging.
- **Preserve these test hooks exactly:** `data-bulkdialog`, `data-bulk-confirm`, `data-toast`, `data-toast-undo`, `data-tone`. Existing tests select on them.
- **`aria-label`, not `aria-labelledby`.** The app's existing dialogs label themselves with `aria-label`; keep that so `a11y.test.mjs` keeps passing.
- **The two `alert()` calls at 266 and 3279 STAY.** They are `toast ?? alert` fallbacks and 3279 runs before `ToastProvider` mounts. Task 4 adds a comment at each; do not delete them.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Do not merge.** Merging to master deploys the live team app; that decision is the user's.

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `crm.html` | Modify | All production changes: `Modal`, `ConfirmDialog`, `ViewBoundary`, the seven call sites, three `aria-live` attributes |
| `tests/health/confirm-dialog.test.mjs` | Create | `ConfirmDialog` behavior and typed confirmation |
| `tests/health/undo-actions.test.mjs` | Create | Reactivate and delete-account undo toasts |
| `tests/health/boundary.test.mjs` | Create | `ViewBoundary` fallback, recovery, and shell survival |
| `tests/health/a11y.test.mjs` | Modify | Three `aria-live` assertions appended |
| `tests/health/reducer.test.mjs` | Modify | Flake fix: a fixture that scores Green |
| `tests/health/run.mjs` | Modify | Registers the three new test files |

---

### Task 1: Extract `<Modal>` and move `BulkDialog` onto it

Pure refactor, no behavior change. The four existing a11y tests are the regression net.

**Files:**
- Modify: `crm.html:1857-1982` (`BulkDialog`)

**Interfaces:**
- Produces: `<Modal label onClose initialFocusRef {...rest}>` — a function component rendering the overlay plus an inner dialog div carrying `role="dialog"`, `aria-modal="true"`, `aria-label={label}`, and any `rest` props spread onto it. Owns focus-on-open, the Tab trap, and the capture-phase Escape handler. Task 2's `ConfirmDialog` consumes it.

- [ ] **Step 1: Add the `Modal` component**

Insert directly above `function BulkDialog(` (currently line 1857):

```js
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

// The modal shell, extracted from BulkDialog so ConfirmDialog cannot drift from it.
// Both the focus-on-open behavior and the capture-phase Escape handling below fix real
// bugs; a second hand-written copy is how one of them silently regresses.
function Modal({ label, onClose, initialFocusRef, children, ...rest }) {
  const dlgRef = useRef(null);
  // Focus the first control from the container rather than a ref on each input: <Select>
  // is a plain function component and does not forward refs, so per-input refs silently
  // did nothing for three of the five bulk kinds.
  useEffect(() => {
    const first = dlgRef.current?.querySelector(FOCUSABLE);
    (initialFocusRef?.current || first)?.focus();
  }, [initialFocusRef]);
  useEffect(() => {
    const h = e => {
      // stopPropagation is required: App registers a window-level Escape that closes the
      // account detail view, so an unguarded Escape would close the dialog AND navigate.
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      // trap Tab inside the modal: without this it walks into the table behind the
      // overlay, which is inert to the eye but not to the keyboard
      const items = [...(dlgRef.current?.querySelectorAll(FOCUSABLE) || [])];
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (!dlgRef.current.contains(active)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", h, true); // capture phase: runs before App's handler
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 pt-[15vh]" onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={label}
           className="nm w-full max-w-md p-4" onClick={e => e.stopPropagation()} {...rest}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete the duplicated logic from `BulkDialog`**

In `BulkDialog`, delete these now-redundant declarations and effects:
- `const ref = useRef();` — **keep this one**, it is the initial-focus target
- `const dlgRef = useRef(null);` — delete
- `const FOCUSABLE = "...";` — delete (now module-level)
- the entire focus `useEffect` (the one calling `.focus()`) — delete
- the entire keydown `useEffect` (Escape + Tab trap) — delete

- [ ] **Step 3: Wrap `BulkDialog`'s body in `Modal`**

Replace `BulkDialog`'s `return (` block opening — the outer overlay div and the inner dialog div (currently 1945-1947) — with:

```jsx
  return (
    <Modal label={BULK_TITLE[kind]} onClose={onClose} initialFocusRef={ref} data-bulkdialog>
```

and replace the two closing `</div>` tags that closed those two divs (currently 1980-1981) with a single:

```jsx
    </Modal>
```

Everything between — the header `<div className="mb-3 …">`, the fields, and the button row — is unchanged. `data-bulkdialog` must survive: three tests select on it.

- [ ] **Step 4: Verify no behavior changed**

```bash
node tests/health/run.mjs > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "^FAIL|passed," /tmp/t1.log
```

Expected: `EXIT=0` and **160 passed, 0 failed**.

The four tests that specifically protect this refactor are "every bulk dialog kind moves focus into the dialog on open", "Tab is trapped inside the bulk dialog", "Escape closes the bulk dialog without closing the account view", and "every icon-only button carries an accessible name". If any fails, the extraction changed behavior — fix the extraction, do not touch the test.

- [ ] **Step 5: Commit**

```bash
git add crm.html
git commit -m "refactor: extract the modal shell from BulkDialog

Focus-on-open, the Tab trap and the capture-phase Escape guard now live in
one <Modal>. A second hand-written copy is how one of those fixes silently
regresses. No behavior change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `<ConfirmDialog>`

**Files:**
- Modify: `crm.html` (add the component after `Modal`)
- Create: `tests/health/confirm-dialog.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: `<Modal>` from Task 1.
- Produces: `<ConfirmDialog title body confirmLabel tone typedWord onConfirm onClose>`. `tone` is `"danger"` (default) or `"normal"`. When `typedWord` is a string, the confirm button is disabled until the input matches it exactly. `onConfirm` may be async; the dialog closes only after it resolves. Tasks 4 consumes it.

- [ ] **Step 1: Write the failing tests**

Create `tests/health/confirm-dialog.test.mjs`. These drive the dialog through the "Clear all data" button in Settings, which Task 4 converts — so they fail now for the right reason (no dialog exists yet):

```js
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { scored, bookSeed } from "./money-fixture.mjs";

const seed = bookSeed([scored({ id: "a1", name: "Alpha Corp", arr: 100000 })]);

// Opens Settings and clicks the destructive "Clear all data" button, which Task 4 wires
// to a ConfirmDialog with typedWord="DELETE".
const openClearAll = async page => {
  await page.click('button[title="Settings"]');
  await page.getByText("Clear all data").first().click();
};

test("the confirm dialog is a labelled modal and traps focus", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  await openClearAll(page);
  const r = await page.evaluate(() => {
    const d = document.querySelector("[data-confirmdialog]");
    return { modal: d?.getAttribute("aria-modal"), label: d?.getAttribute("aria-label"),
      hasFocus: d?.contains(document.activeElement) };
  });
  assert(r.modal === "true", `dialog should be aria-modal, got ${r.modal}`);
  assert(r.label && r.label.length > 0, `dialog should carry an aria-label, got ${r.label}`);
  assert(r.hasFocus, "focus should move into the dialog on open");
  await browser.close();
});

test("the typed-confirmation button stays disabled until the word matches exactly", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  await openClearAll(page);
  const dis = () => page.evaluate(() => document.querySelector("[data-confirm-go]").disabled);
  assert(await dis() === true, "confirm should start disabled");
  await page.fill("[data-confirmdialog] input", "delete");
  assert(await dis() === true, "lowercase 'delete' must not enable the confirm button");
  await page.fill("[data-confirmdialog] input", "DELETE");
  assert(await dis() === false, "exact 'DELETE' should enable the confirm button");
  await page.fill("[data-confirmdialog] input", "");
  assert(await dis() === true, "clearing the field should re-disable the confirm button");
  await browser.close();
});

test("cancelling the confirm dialog writes nothing", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  const before = await page.evaluate(() => window.__store.getState().accounts.length);
  await openClearAll(page);
  await page.getByText("Cancel").first().click();
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  const after = await page.evaluate(() => ({
    n: window.__store.getState().accounts.length,
    open: !!document.querySelector("[data-confirmdialog]"),
  }));
  assert(after.n === before, `cancel must not change data: ${before} -> ${after.n}`);
  assert(!after.open, "cancel should close the dialog");
  await browser.close();
});

test("Escape closes the confirm dialog", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  await openClearAll(page);
  await page.keyboard.press("Escape");
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  const open = await page.evaluate(() => !!document.querySelector("[data-confirmdialog]"));
  assert(!open, "Escape should close the dialog");
  await browser.close();
});
```

- [ ] **Step 2: Register and run to confirm they fail**

Add `import "./confirm-dialog.test.mjs";` to `tests/health/run.mjs`, then:

```bash
node tests/health/run.mjs > /tmp/t2a.log 2>&1; echo "EXIT=$?"; grep -E "^FAIL|passed," /tmp/t2a.log
```

Expected: **160 passed, 4 failed** — all four failing because `[data-confirmdialog]` does not exist yet.

- [ ] **Step 3: Add the `ConfirmDialog` component**

Insert directly below `Modal`:

```js
// Guards actions in proportion to how reversible they are. Reversible actions do not use
// this at all -- they act immediately and offer an Undo toast, which is safer than a
// dialog people click through reflexively.
function ConfirmDialog({ title, body, confirmLabel = "Confirm", tone = "danger", typedWord, onConfirm, onClose }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef();
  const ready = !typedWord || typed === typedWord;
  const go = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try { await onConfirm(); } finally { onClose(); }
  };
  return (
    <Modal label={title} onClose={onClose} initialFocusRef={typedWord ? inputRef : undefined} data-confirmdialog>
      <h3 className="mb-2 text-sm font-bold text-slate-800">{title}</h3>
      <p className={`text-xs ${tone === "danger" ? "text-rose-700" : "text-slate-600"}`}>{body}</p>
      {typedWord && <label className="mt-3 block text-xs text-slate-700">Type {typedWord} to confirm
        <Input ref={inputRef} value={typed} onChange={e => setTyped(e.target.value)} /></label>}
      <div className="mt-4 flex gap-2">
        <Btn kind="primary" disabled={!ready || busy} data-confirm-go onClick={go}>{confirmLabel}</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Note for Task 4**

`ConfirmDialog` is now defined but nothing renders it, so the four tests still fail. That is expected — Task 4 wires the call sites. Do NOT wire them here; Task 3 must land first so the undo-toast conversions are reviewed separately from the dialog conversions.

Run the suite to confirm the state is unchanged apart from the four known failures:

```bash
node tests/health/run.mjs > /tmp/t2b.log 2>&1; echo "EXIT=$?"; grep -E "^FAIL|passed," /tmp/t2b.log
```

Expected: still **160 passed, 4 failed**, same four names. A NEW failure means `ConfirmDialog`'s definition broke something — most likely a name collision. Fix before committing.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/confirm-dialog.test.mjs tests/health/run.mjs
git commit -m "feat: add ConfirmDialog, with failing tests for its call sites

The component and its tests land together; the call sites are wired in a
later commit so the undo-toast and dialog conversions review separately.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Replace two reversible confirms with Undo toasts

**Files:**
- Modify: `crm.html:2293` (reactivate), `crm.html:2298` (delete account)
- Create: `tests/health/undo-actions.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Consumes: `toast({ text, tone, undo })` from `useToast()`, already in scope in `AccountDetail`.

- [ ] **Step 1: Write the failing tests**

Create `tests/health/undo-actions.test.mjs`:

```js
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { scored, bookSeed } from "./money-fixture.mjs";

const CHURNED = scored({ id: "a1", name: "Alpha Corp", arr: 100000,
  contractStatus: "Churned", churn: { date: "2026-06-01", arr: 100000, reason: "Price" } });

const openAccount = async (page, name) => {
  await page.click('button[title="Accounts"]');
  await page.getByText(name).first().click();
};

test("reactivating an account acts immediately and offers an Undo", async () => {
  const { page, browser } = await launch(bookSeed([CHURNED]));
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
  await openAccount(page, "Alpha Corp");
  await page.getByText("Reactivate").first().click();
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  const after = await page.evaluate(() => {
    const a = window.__store.getState().accounts.find(x => x.id === "a1");
    return { status: a.contractStatus, churn: a.churn, undo: !!document.querySelector("[data-toast-undo]") };
  });
  assert(after.status === "Active", `expected Active, got ${after.status}`);
  assert(after.churn === null, `churn should clear, got ${JSON.stringify(after.churn)}`);
  assert(after.undo, "an Undo toast should be offered");
  await browser.close();
});

test("undoing a reactivation puts the account back to churned", async () => {
  const { page, browser } = await launch(bookSeed([CHURNED]));
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
  await openAccount(page, "Alpha Corp");
  await page.getByText("Reactivate").first().click();
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  await page.click("[data-toast-undo]");
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  const a = await page.evaluate(() => {
    const x = window.__store.getState().accounts.find(y => y.id === "a1");
    return { status: x.contractStatus, reason: x.churn?.reason };
  });
  assert(a.status === "Churned", `expected Churned after undo, got ${a.status}`);
  assert(a.reason === "Price", `the original churn reason should return, got ${a.reason}`);
  await browser.close();
});

test("deleting an account no longer asks for confirmation and still restores on Undo", async () => {
  const A = scored({ id: "a1", name: "Alpha Corp", arr: 100000 });
  const { page, browser } = await launch(bookSeed([A]));
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
  await openAccount(page, "Alpha Corp");
  // No confirm() dialog: the click alone deletes. If a native confirm were still present,
  // Playwright would auto-dismiss it and the delete would never happen.
  await page.getByText("Delete account").first().click();
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  const gone = await page.evaluate(() => window.__store.getState().accounts.length);
  assert(gone === 0, `the account should be deleted without a confirm, got ${gone} left`);
  await page.click("[data-toast-undo]");
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  const back = await page.evaluate(() => window.__store.getState().accounts.length);
  assert(back === 1, `Undo should restore the account, got ${back}`);
  await browser.close();
});
```

- [ ] **Step 2: Register and run to confirm the new ones fail**

Add `import "./undo-actions.test.mjs";` to `run.mjs`, then run. Expected: **160 passed, 7 failed** — the 4 from Task 2 plus these 3.

The delete test fails today for a subtle reason worth understanding: Playwright auto-dismisses native dialogs, so `confirm()` returns false and the delete never happens.

- [ ] **Step 3: Convert the reactivate site**

Replace `crm.html:2292-2293` (the reactivate button's `onClick`) with:

```jsx
        {a.churn && <button className="nm-btn px-3 py-1.5 text-xs font-bold text-emerald-600"
          onClick={() => {
            // Reversible in one dispatch, so no dialog: act, then offer Undo.
            const prev = a.churn;
            dispatch({ type: "REACTIVATE_ACCOUNT", id: a.id, by: user.name });
            dispatch({ type: "ADD_ACTIVITY", item: { id: uid(), accountId: a.id, type: "note", date: iso(Date.now()), summary: `Account reactivated by ${user.name}` } });
            toast({ text: `Reactivated ${a.name}.`, tone: "success",
              undo: () => dispatch({ type: "CHURN_ACCOUNT", id: a.id, entry: prev }) });
          }}>↻ Reactivate</button>}
```

- [ ] **Step 4: Convert the delete site**

In `crm.html`, delete only this line from the delete button's `onClick` (currently 2298):

```js
            if (!confirm(`Delete ${a.name} for the whole team, including its contacts, activities, tasks and opportunities?`)) return;
```

and replace it with:

```js
            // No dialog: the Undo toast below is the guard, and it is a better one --
            // a confirm people click through protects nothing.
```

Leave the snapshot, dispatch, toast and `back()` exactly as they are.

- [ ] **Step 5: Run**

```bash
node tests/health/run.mjs > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "^FAIL|passed," /tmp/t3.log
```

Expected: **163 passed, 4 failed** — the 3 new ones pass; Task 2's 4 still fail until Task 4.

The existing test "deleting a single account offers an undo that restores it with its children" must still pass. If it now fails, the delete path broke.

- [ ] **Step 6: Commit**

```bash
git add crm.html tests/health/undo-actions.test.mjs tests/health/run.mjs
git commit -m "feat: reversible actions act immediately with an Undo toast

Reactivate and delete-account drop their confirm(). Delete already showed an
Undo toast, so the dialog was redundant belt-and-braces.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Replace the five irreversible confirms with dialogs

**Files:**
- Modify: `crm.html:961` (delete document), `2399` and `2406` (opportunity), `2786` and `2787` (Settings data), plus comments at `266` and `3279`

**Interfaces:**
- Consumes: `<ConfirmDialog>` from Task 2.

Each site holds `const [confirming, setConfirming] = useState(null)` and renders the dialog when set, mirroring how `AccountDetail` manages `form` at 2226.

- [ ] **Step 1: Convert the document delete**

The component is `DocumentsCard({ a, dispatch, user })` at `crm.html:935`. Add near its
other state:

```js
  const [confirmDoc, setConfirmDoc] = useState(null);
```

Change the delete button's `onClick` (currently 960-964) to just open the dialog:

```jsx
                  <button title="Delete document" className="text-xs text-rose-500 hover:text-rose-700"
                    onClick={() => setConfirmDoc(d)}>✕</button>
```

Then render the dialog immediately before the component's closing `</div>` of the documents list:

```jsx
      {confirmDoc && <ConfirmDialog
        title="Delete document"
        body={`Delete "${confirmDoc.title || confirmDoc.name}"? This permanently removes the file and cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (sb) {
            const { error } = await sb.storage.from("attachments").remove([confirmDoc.path]);
            if (error) { toast({ text: "Could not delete file: " + error.message, tone: "error" }); return; }
          }
          dispatch({ type: "DELETE_DOCUMENT", id: a.id, docId: confirmDoc.id, by: user?.name, source: "delete" });
        }}
        onClose={() => setConfirmDoc(null)} />}
```

`onConfirm` is async and `ConfirmDialog` awaits it, so the dialog stays open until the storage call resolves.

- [ ] **Step 2: Convert the two opportunity confirms**

Add to the opportunities component's state:

```js
  const [confirmOpp, setConfirmOpp] = useState(null); // { kind: "won" | "stage", opp, next }
```

Replace the `confirm(...)` guard at 2399 (mark Won) so the handler opens the dialog instead, and the same for the already-booked warning at 2406. Render one dialog that switches on `kind`:

```jsx
      {confirmOpp && <ConfirmDialog
        title={confirmOpp.kind === "won" ? "Book expansion ARR" : "Change a booked opportunity"}
        tone={confirmOpp.kind === "won" ? "normal" : "danger"}
        body={confirmOpp.kind === "won"
          ? `Mark this ${confirmOpp.opp.type} as WON and book ${fmtMoney(confirmOpp.opp.value, a.currency)} expansion ARR onto ${a.name}?`
          : "This opportunity was already booked as Won expansion. Changing its stage does NOT reverse the ARR — use ⇄ Adjust ARR for that."}
        confirmLabel={confirmOpp.kind === "won" ? "Book it" : "Continue"}
        onConfirm={() => confirmOpp.run()}
        onClose={() => setConfirmOpp(null)} />}
```

Each call site passes a `run` closure carrying exactly the dispatches its old `confirm()` guarded. Move that code verbatim — do not re-derive it.

- [ ] **Step 3: Convert the two Settings data actions**

The component is `Settings({ st, dispatch, user, scored })` at `crm.html:2729`; the two
buttons are at `2786-2787`, inside the same `<div className="flex flex-wrap gap-2">` as
Export/Import JSON. Add to its state:

```js
  const [confirmData, setConfirmData] = useState(null); // "sample" | "clear"
```

Replace the two buttons at 2786-2787 with:

```jsx
          <Btn onClick={() => setConfirmData("sample")}>Load sample data</Btn>
          <Btn onClick={() => setConfirmData("clear")}>Clear all data</Btn>
```

and render:

```jsx
      {confirmData && <ConfirmDialog
        title={confirmData === "sample" ? "Replace all team data" : "Delete all team data"}
        body={confirmData === "sample"
          ? "This replaces the team's data with the sample dataset. Everyone sees this change, and it cannot be undone."
          : "This deletes ALL of the team's accounts and data for everyone. Export JSON first if you want a backup. It cannot be undone."}
        confirmLabel={confirmData === "sample" ? "Replace data" : "Delete everything"}
        typedWord={confirmData === "sample" ? "REPLACE" : "DELETE"}
        onConfirm={() => bulkReplace(confirmData === "sample" ? seedData() : emptyData())}
        onClose={() => setConfirmData(null)} />}
```

- [ ] **Step 4: Document why the two `alert()` calls stay**

At `crm.html:266`, above the line, add:

```js
  // alert() is the fallback, not the primary path: this runs from module scope helpers
  // that can fire before ToastProvider mounts, and losing the message entirely would be
  // worse than an unstyled dialog. Deliberately kept -- see the UX robustness spec.
```

At `crm.html:3279`, above the `.then(...)`, add:

```js
      // Same reasoning as line 266: profile loading runs BEFORE ToastProvider wraps App,
      // so window.__toast is genuinely undefined here and alert is the only channel left.
```

- [ ] **Step 5: Verify no `confirm()` survives**

```bash
grep -n "confirm(" crm.html | grep -v "setConfirm\|confirmText\|confirmLabel\|ConfirmDialog\|confirmDoc\|confirmOpp\|confirmData\|data-confirm"
```

Expected: no output. Then check the alerts are intact:

```bash
grep -c "alert(" crm.html
```

Expected: `2`.

- [ ] **Step 6: Run**

```bash
node tests/health/run.mjs > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "^FAIL|passed," /tmp/t4.log
```

Expected: `EXIT=0` and **167 passed, 0 failed** — Task 2's four now pass.

- [ ] **Step 7: Commit**

```bash
git add crm.html
git commit -m "feat: irreversible actions use a real dialog, not confirm()

Document delete, booking expansion ARR, and the two Settings data actions.
Replacing and clearing team data now require typing REPLACE or DELETE.
Records why the two alert() fallbacks stay.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `<ViewBoundary>`

**Files:**
- Modify: `crm.html` (add the class; wrap the view switch at ~3251-3256)
- Create: `tests/health/boundary.test.mjs`
- Modify: `tests/health/run.mjs`

**Interfaces:**
- Produces: `<ViewBoundary view={view} key={view}>` wrapping the view switch.

- [ ] **Step 1: Write the failing tests**

Create `tests/health/boundary.test.mjs`. The crash is triggered by corrupt seed data, which is the real-world failure mode — verified: `("corrupt" || []).forEach(...)` throws, because `|| []` only guards null and undefined.

```js
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { scored, bookSeed } from "./money-fixture.mjs";

// renewals as a string rather than an array. Every consumer does (a.renewals || []).forEach,
// and || only guards null/undefined, so a truthy non-array reaches .forEach and throws.
// This is exactly what a malformed Supabase row would do.
const CORRUPT = { ...scored({ id: "bad", name: "Corrupt Co", arr: 100000 }), renewals: "not-an-array" };

test("a crashing view shows a recoverable panel instead of a white screen", async () => {
  const { page, browser } = await launch(bookSeed([CORRUPT]));
  await page.waitForFunction(() => window.__store);
  await page.click('button[title="Renewals"]');
  await page.waitForSelector("[data-viewerror]", { timeout: 5000 });
  const r = await page.evaluate(() => {
    const el = document.querySelector("[data-viewerror]");
    return { text: el.textContent, root: document.querySelector("#root").textContent.length };
  });
  assert(/something went wrong|couldn't be displayed/i.test(r.text),
    `the panel should explain the failure, got: ${r.text.slice(0, 120)}`);
  assert(r.root > 200, "the app shell should still be rendered, not blanked");
  await browser.close();
});

test("the nav still works after a view crashes", async () => {
  const { page, browser } = await launch(bookSeed([CORRUPT]));
  await page.waitForFunction(() => window.__store);
  await page.click('button[title="Renewals"]');
  await page.waitForSelector("[data-viewerror]", { timeout: 5000 });
  // navigating away must clear the error: the boundary is keyed on the view
  await page.click('button[title="Dashboard"]');
  await page.evaluate(() => new Promise(r => setTimeout(r, 100)));
  const stillBroken = await page.evaluate(() => !!document.querySelector("[data-viewerror]"));
  assert(!stillBroken, "switching views should clear the error state");
  await browser.close();
});

test("a healthy book renders no error panel", async () => {
  const { page, browser } = await launch(bookSeed([scored({ id: "ok", name: "Fine Co", arr: 100000 })]));
  await page.waitForFunction(() => window.__store);
  await page.click('button[title="Renewals"]');
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));
  const broken = await page.evaluate(() => !!document.querySelector("[data-viewerror]"));
  assert(!broken, "a valid book must not trip the boundary");
  await browser.close();
});
```

- [ ] **Step 2: Register and confirm they fail**

Add `import "./boundary.test.mjs";` to `run.mjs` and run. Expected: **167 passed, 2 failed** — the first two fail (no `[data-viewerror]`); the third passes already.

If the first two fail with a *timeout on `button[title="Renewals"]`* rather than on `[data-viewerror]`, the nav button's title differs — find the real one with `page.locator` and fix the selector, not the assertion.

- [ ] **Step 3: Add the `ViewBoundary` class**

React 18 has no hook equivalent of `componentDidCatch`, so this is a class. Insert above `function App(`:

```js
// Catches render/lifecycle errors in the view area only, so a crash costs one screen
// instead of the session. Does NOT catch errors in event handlers or async callbacks --
// those already route through the try/catch blocks and the error toast.
class ViewBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null, attempt: 0 }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("View crashed:", this.props.view, error, info); }
  render() {
    if (!this.state.error) return <div key={this.state.attempt}>{this.props.children}</div>;
    return (
      <div data-viewerror className="nm m-4 p-6" role="alert">
        <h2 className="mb-2 text-sm font-bold text-rose-700">Something went wrong in {this.props.view}</h2>
        <p className="mb-1 text-xs text-slate-600">This view couldn't be displayed. Your data is safe — nothing was changed.</p>
        <p className="mb-4 font-mono text-[11px] text-slate-500">{String(this.state.error?.message || this.state.error)}</p>
        <button className="nm-btn px-3 py-1.5 text-xs font-bold text-indigo-600"
          onClick={() => this.setState(s => ({ error: null, attempt: s.attempt + 1 }))}>Try again</button>
      </div>
    );
  }
}
```

- [ ] **Step 4: Wrap the view switch**

At `crm.html` ~3251, wrap the whole run of `{view === "..." && <... />}` lines:

```jsx
      <ViewBoundary key={view} view={view}>
        {view === "Dashboard" && <Dashboard ... />}
        {/* ...every other view line, unchanged... */}
      </ViewBoundary>
```

`key={view}` is what makes navigation clear the error: React unmounts and remounts the boundary when the key changes, resetting its state without any manual reset.

Nav, header, command palette and `ToastProvider` must stay OUTSIDE the boundary — that is the whole point.

- [ ] **Step 5: Run**

```bash
node tests/health/run.mjs > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "^FAIL|passed," /tmp/t5.log
```

Expected: `EXIT=0` and **170 passed, 0 failed**.

- [ ] **Step 6: Commit**

```bash
git add crm.html tests/health/boundary.test.mjs tests/health/run.mjs
git commit -m "feat: a render crash costs one view, not the whole app

ViewBoundary wraps the view switch, keyed on the current view so navigating
away clears the error. Nav, header and toasts stay outside it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Three `aria-live` regions

**Files:**
- Modify: `crm.html` (account list result count, bulk selection count, import result banner)
- Modify: `tests/health/a11y.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/health/a11y.test.mjs`:

```js
test("regions that change without moving focus are announced", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  await page.click('button[title="Accounts"]');
  const live = await page.evaluate(() =>
    [...document.querySelectorAll("[aria-live]")].map(el => el.getAttribute("data-live") || "toast"));
  // the toast region plus the account-list result count; the other two appear only after
  // a selection or an import, and are asserted in their own tests below
  assert(live.includes("results"), `the result count should be announced, got: ${live.join()}`);
  await browser.close();
});

test("the bulk selection count is announced", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store);
  await page.click('button[title="Accounts"]');
  await page.locator('input[type="checkbox"]').first().check();
  const ok = await page.evaluate(() => {
    const el = document.querySelector('[data-live="selection"]');
    return el && el.getAttribute("aria-live") === "polite";
  });
  assert(ok, "the selection count should carry aria-live=polite");
  await browser.close();
});
```

Note: `a11y.test.mjs` already defines its own `seed` at the top of the file — reuse it rather than importing another.

- [ ] **Step 2: Run to confirm failure**

Expected: **170 passed, 2 failed**.

- [ ] **Step 3: Add the attributes**

**A live region must already be in the DOM when its content changes.** A region that mounts
at the same moment it gains text is frequently not announced at all — the screen reader has
nothing to diff against. Two of the three below therefore need an always-present wrapper,
not an attribute on the conditional element.

1. **Account list result count.** The count lives in a `Card` *title* prop
   (`crm.html:2074`: ``title={`Accounts (${rows.length})`}``), so there is no element to
   annotate without restructuring `Card`. Add a visually-hidden live region as the first
   child inside that `Card` instead:

```jsx
        <span data-live="results" aria-live="polite" className="sr-only">{rows.length} accounts</span>
```

2. **Bulk selection count** — `crm.html:2133`. This element's text changes while it stays
   mounted, so the attribute goes on it directly:

```jsx
          <span data-live="selection" aria-live="polite" className="text-sm font-bold text-slate-800">{selected.size} selected</span>
```

   Note the surrounding `{selected.size > 0 && (...)}` at 2131 means the whole bar unmounts
   at zero. That is acceptable here: going from "3 selected" to "1 selected" is the case
   worth announcing, and both states have the bar mounted.

3. **Import result banner** — `crm.html:2081` is `{importMsg && <div …>}`, which mounts only
   once a result exists. Wrap it in a permanent region rather than annotating the inner div:

```jsx
      <div data-live="import" aria-live="polite">
        {importMsg && <div className={`nm-sm mb-3 flex items-center gap-2 p-3 text-sm ${importMsg.err ? "text-rose-600" : (importMsg.badTier || importMsg.badStatus) ? "text-amber-700" : "text-emerald-700"}`}>
          {/* ...banner contents unchanged... */}
        </div>}
      </div>
```

   Leave the inner div's className expression exactly as it is — PR #14's amber coercion
   tone is asserted by two existing tests.

- [ ] **Step 4: Run**

Expected: `EXIT=0` and **172 passed, 0 failed**. Confirm the count went from 1 to 4:

```bash
grep -c 'aria-live' crm.html
```

Expected: `4`.

- [ ] **Step 5: Commit**

```bash
git add crm.html tests/health/a11y.test.mjs
git commit -m "feat: announce result count, selection count and import results

Three regions whose text changes without focus moving, which a screen reader
otherwise misses entirely.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Fix the `reducer.test.mjs` flake

**Files:**
- Modify: `tests/health/reducer.test.mjs`

- [ ] **Step 1: Understand the race before changing anything**

The test dispatches an artificial `Green` band, but the seeded account *scores* Yellow — its `inputsUpdatedAt` is stale, dragging the recency input down. The health auto-seeder then fires and overwrites the band, appending a second event. Measured during PR #16: 0ms passes, 50ms and 250ms fail deterministically. Raising the wait is the wrong fix and was already tried and reverted.

The fix makes the auto-seeder AGREE rather than winning a race: seed an account that genuinely scores Green.

- [ ] **Step 2: Give the test its own Green-scoring fixture**

In `tests/health/reducer.test.mjs`, above the "with empty items" test, add:

```js
// Scores Green on its own (fresh inputs, top scores), so the health auto-seeder agrees
// with the Green band this test dispatches and has nothing to correct. Without this the
// test races the auto-seeder: it dispatches Green, the seeder recomputes Yellow and
// overwrites it, and the assertions fail ~2 runs in 8 regardless of wait length.
const GREEN = seedAccount({ id: "t1", inputs: { usage: 100, sentiment: 100, tickets: 0, nps: 100 } });
GREEN.inputsUpdatedAt = new Date().toISOString().slice(0, 10);
const greenSeed = `window.__seedRows = { accounts: [${JSON.stringify(GREEN)}].map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
```

Change that test's `launch(seed)` to `launch(greenSeed)`, and change its wait from `setTimeout(r, 0)` to `setTimeout(r, 50)` — with the race gone, the longer, more robust wait is now correct. Delete the "0 is load-bearing" comment block, which no longer applies.

- [ ] **Step 3: Verify the band actually computes Green**

Before trusting the fix, confirm the premise:

```bash
node -e "
const riskOf = s => (s >= 70 ? 'Green' : s >= 40 ? 'Yellow' : 'Red');
console.log('threshold check:', riskOf(70), riskOf(69));"
```

Expected: `Green Yellow`. Then run the suite and confirm the test passes.

If it still fails, the inputs are not enough to clear 70 — print the account's computed `score` from the page and adjust the inputs upward rather than reverting to the racy version.

- [ ] **Step 4: Run five consecutive times**

The whole point is that it stops being intermittent:

```bash
for i in 1 2 3 4 5; do node tests/health/run.mjs > /tmp/flake$i.log 2>&1; echo "run $i EXIT=$? $(grep 'passed,' /tmp/flake$i.log)"; done
```

Expected: five lines, each `EXIT=0` and **172 passed, 0 failed**. Any failure means the race is not actually gone — report it rather than re-running until it looks clean.

- [ ] **Step 5: Commit**

```bash
git add tests/health/reducer.test.mjs
git commit -m "fix: remove the auto-seeder race from the playbook reducer test

The test dispatched Green at an account that scores Yellow, so the auto-seeder
overwrote it ~2 runs in 8. A Green-scoring fixture removes the race instead of
winning it more often. Verified over five consecutive runs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Verify on both browsers and open the PR

**Files:**
- Create: `pr-body.md` (untracked scratch; do not commit)

- [ ] **Step 1: Full suite, local path**

```bash
node tests/health/run.mjs > /tmp/final.log 2>&1; echo "EXIT=$?"; grep -E "^FAIL|passed," /tmp/final.log
```

Expected: `EXIT=0`, **172 passed, 0 failed**.

- [ ] **Step 2: Full suite, the CI path**

PowerShell:

```powershell
$env:CRM_TEST_CHANNEL = ""; node tests/health/run.mjs > /tmp/final-ci.log 2>&1; $LASTEXITCODE; Remove-Item Env:\CRM_TEST_CHANNEL
```

Expected: exit 0, **172 passed, 0 failed**. A test passing on msedge and failing on Chromium must be reported, not adjusted.

- [ ] **Step 3: Confirm the success criteria mechanically**

```bash
echo "confirm(): $(grep -c 'confirm(' crm.html | tr -d ' ')  (expect only ConfirmDialog/state identifiers)"
grep -n "confirm(" crm.html | grep -v "setConfirm\|confirmText\|confirmLabel\|ConfirmDialog\|confirmDoc\|confirmOpp\|confirmData\|data-confirm" || echo "no bare confirm() - OK"
echo "alert(): $(grep -c 'alert(' crm.html) (expect 2)"
echo "aria-live: $(grep -c 'aria-live' crm.html) (expect 4)"
echo "ErrorBoundary present: $(grep -c 'class ViewBoundary' crm.html) (expect 1)"
echo "Modal implementations: $(grep -c 'aria-modal=\"true\"' crm.html) (expect 2 - Modal and the command palette)"
```

- [ ] **Step 4: Register check**

```bash
node -e "const r=require('fs').readFileSync('tests/health/run.mjs','utf8'); ['confirm-dialog','undo-actions','boundary'].forEach(n=>{ if(!r.includes('./'+n+'.test.mjs')) throw new Error('not registered: '+n); }); console.log('all three registered')"
```

- [ ] **Step 5: Push and open the PR**

Write `pr-body.md` covering: the seven `confirm()` calls split by reversibility (with the table from the spec); why the two `alert()` calls stayed; the `Modal` extraction and that `BulkDialog` now shares it; the per-view boundary and its explicit limitation (no event-handler or async errors); the three `aria-live` regions; the flake fix and its five-run verification; and the test count 160 → 172.

```bash
git push -u origin ux/robustness
gh pr create --title "Guard destructive actions by reversibility; add an error boundary" --body-file pr-body.md
gh run list --branch ux/robustness --limit 1
gh run watch <run-id>
```

`test` must conclude `success` and `deploy` must show `skipped` (correct on a PR).

- [ ] **Step 6: Stop and report**

Report the PR URL, the final count, and every behavior change. **Do not merge** — that decision is the user's.

---

## Self-Review Notes

**Spec coverage:** Spec §"Principle" table rows → Task 3 (2 undo sites) and Task 4 (5 dialog sites). §`<Modal>` extraction → Task 1. §`<ConfirmDialog>` → Task 2. §`<ViewBoundary>` → Task 5, including its stated limitation, which is reproduced in the code comment. §`aria-live` regions → Task 6. §"Correction: the two alert() calls stay" → Task 4 Step 4 plus the Task 8 Step 3 check asserting the count is still 2. §"The carried-over flake" → Task 7, including the five-run verification the spec's success criterion demands. §Success criteria 1-6 → Task 8 Steps 1-4.

**Placeholder scan:** The first draft of Tasks 4 and 6 said "find the element rendering X"; every one of those is now a named component and line number (`DocumentsCard` 935, `Settings` 2729, the two buttons at 2786-2787, the result count at 2074, the selection count at 2133, the import banner at 2081). The one remaining soft instruction is Task 4 Step 2's "each call site passes a `run` closure carrying exactly the dispatches its old `confirm()` guarded" — deliberate, because that code is site-specific and must be moved verbatim rather than retyped from a plan. No TBDs.

**One thing the plan discovered that the spec did not:** a live region must already exist in the DOM when its content changes, or it is frequently not announced. Two of the three `aria-live` targets mount at the same instant they gain text, so Task 6 wraps them in permanent regions instead of annotating the conditional element. A naive implementation would have passed a `getAttribute("aria-live")` test while announcing nothing to an actual screen reader.

**Type consistency:** `<Modal label onClose initialFocusRef {...rest}>` is spelled identically in Task 1's definition and both consumers (Task 1's `BulkDialog`, Task 2's `ConfirmDialog`). `ConfirmDialog`'s props — `title body confirmLabel tone typedWord onConfirm onClose` — match across Task 2's definition and all five call sites in Task 4. Test hooks `data-confirmdialog`, `data-confirm-go`, `data-viewerror`, `data-live` are used consistently between the tests that assert them and the components that emit them.

**Test count chain:** 160 → (Task 2: +4 failing) → (Task 3: 163 passed, 4 failing) → (Task 4: 167) → (Task 5: +3, 170) → (Task 6: +2, 172) → Task 7 keeps 172.

**Out of scope, per the spec:** `retentionStats:1240` historical currency.
