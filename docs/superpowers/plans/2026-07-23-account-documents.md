# Account Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-account uploaded documents categorized as Purchase Order / Contract Agreement / Advisory, with title, amount, and effective/expiry dates, plus an expiry badge on contracts.

**Architecture:** All in `crm.html`. Reuses the existing `uploadFiles()` → Supabase `attachments` bucket. Adds an additive `documents` array on accounts, two reducer actions (`ADD_DOCUMENT`, `DELETE_DOCUMENT`) that persist the account and append to its existing `audit` array, one new `DocumentForm` component, and one new **Documents** card in `AccountDetail`. No new Supabase infrastructure or schema migration (documents live inside the account row like `renewals`/`audit`).

**Tech Stack:** React 18 UMD + Babel in `crm.html`, Tailwind CDN, Supabase JS v2, Playwright (msedge headless) for E2E.

## Global Constraints

- **Strictly additive** — every existing feature (task/activity attachments, ARR audit, renewals, palette) unchanged.
- Branch `feat/account-documents`; PR via `gh --body-file`; master merge auto-deploys live to GitHub Pages.
- `EXPIRY_WARN_DAYS = 60`. Expiry badge is **Contract Agreement only**.
- Required to save a document: a file **and** a category. Title/amount/effective/expiry optional.
- Delete hard-removes the file: `sb.storage.from("attachments").remove([path])` before removing the record; on storage error, do not remove the record.
- Date math on ISO `yyyy-mm-dd` via existing `daysUntil` helper (avoid UTC-vs-local string pitfalls).
- Spec: `docs/superpowers/specs/2026-07-23-account-documents-design.md`.
- Landmarks (master, commit `0bbffb5`):
  - Helpers: `iso` `crm.html:70`, `daysUntil` `crm.html:72`, `fmtMoney` `crm.html:79`, `fmtDate` `crm.html:80`, `uid` `crm.html:81`.
  - Audit: entry shape `{ id, date, field, from, to, by, source }`; `withAudit(a, entries)` `crm.html:234`; `AUDIT_FIELD_LABEL` `crm.html:1561`; `ChangeHistoryCard` `crm.html:1562`.
  - Attachments: `uploadFiles(fileList, accountId)` `crm.html:566`; `KeptAttachments` `crm.html:588`.
  - UI helpers: `Card` `crm.html:528`, `Btn` `crm.html:554`, `Input` `crm.html:557`, `Select` `crm.html:558`.
  - Persistence effect account-action list `crm.html:280`; state reducer account cases begin `crm.html:314`.
  - `AccountDetail` signature `crm.html:1585`; its `const [form, setForm] = useState(null)` at `crm.html:1589`; form render switch `crm.html:1655-1663`; account cards grid `crm.html:1664-1701`.

---

### Task 0: Branch

- [ ] **Step 1:** Create the feature branch.

```powershell
git checkout master; git pull; git checkout -b feat/account-documents
```

---

### Task 1: Reducer — ADD_DOCUMENT / DELETE_DOCUMENT + persistence + audit label

**Files:**
- Modify: `crm.html` — persistence effect list (`crm.html:280`), state reducer (new cases near `crm.html:314`), `AUDIT_FIELD_LABEL` (`crm.html:1561`).

**Interfaces:**
- Produces:
  - Action `{ type: "ADD_DOCUMENT", id: accountId, doc, by, source }` where `doc = { id, category, title, name, url, path, amount, effectiveDate, expiryDate, uploadedBy, uploadedAt }`.
  - Action `{ type: "DELETE_DOCUMENT", id: accountId, docId, by, source }`.
  - Both append an audit entry `{ id, date, field: "document", from, to, by, source }` (add: `from:""`, `to:"<category>: <title|name>"`; delete: reversed).

- [ ] **Step 1:** Add the two actions to the persistence effect so they save the account. In the `case` list at `crm.html:280` (currently `case "UPDATE_INPUTS": case "EDIT_ACCOUNT": ... case "ADJUST_ARR":`), add `case "ADD_DOCUMENT": case "DELETE_DOCUMENT":` to the same group:

```js
    case "UPDATE_INPUTS": case "EDIT_ACCOUNT": case "COMPLETE_RENEWAL": case "CHURN_ACCOUNT": case "REACTIVATE_ACCOUNT": case "ADJUST_ARR": case "ADD_DOCUMENT": case "DELETE_DOCUMENT": { const a = next.accounts.find(x => x.id === action.id); return a && up("accounts", a); }
```

- [ ] **Step 2:** Add the two state-reducer cases. Place them immediately after the `ADJUST_ARR` case (which ends around `crm.html:337`, just before `case "SET_OPP_STAGE"`):

```js
    case "ADD_DOCUMENT": return { ...state, accounts: state.accounts.map(a => {
      if (a.id !== action.id) return a;
      const label = `${action.doc.category}: ${action.doc.title || action.doc.name}`;
      return withAudit({ ...a, documents: [...(a.documents || []), action.doc] },
        [{ id: uid(), date: iso(Date.now()), field: "document", from: "", to: label, by: action.by || "unknown", source: action.source || "upload" }]);
    }) };
    case "DELETE_DOCUMENT": return { ...state, accounts: state.accounts.map(a => {
      if (a.id !== action.id) return a;
      const doc = (a.documents || []).find(d => d.id === action.docId);
      if (!doc) return a;
      const label = `${doc.category}: ${doc.title || doc.name}`;
      return withAudit({ ...a, documents: (a.documents || []).filter(d => d.id !== action.docId) },
        [{ id: uid(), date: iso(Date.now()), field: "document", from: label, to: "", by: action.by || "unknown", source: action.source || "delete" }]);
    }) };
```

- [ ] **Step 3:** Add a label so the Change history card names the field. In `AUDIT_FIELD_LABEL` (`crm.html:1561`) add `document: "Document"`:

```js
const AUDIT_FIELD_LABEL = { arr: "ARR", renewalDate: "Renewal date", csm: "CSM", tier: "Tier", contractStatus: "Contract status", renewalStage: "Renewal stage", document: "Document" };
```

- [ ] **Step 4:** Sanity-check the file still parses (no syntax error): open `crm.html` in the browser — it should load without a Babel/console error. (Full behavior is verified by the E2E harness in Task 4.)

- [ ] **Step 5:** Commit.

```powershell
git add crm.html; git commit -m "feat: ADD_DOCUMENT/DELETE_DOCUMENT reducer actions with audit"
```

---

### Task 2: DocumentForm component

**Files:**
- Modify: `crm.html` — add `DocumentForm` directly below the attachments block (after `KeptAttachments`, ~`crm.html:600`, before `/* quick actions */`).

**Interfaces:**
- Consumes: `uploadFiles` (`crm.html:566`), `ADD_DOCUMENT` action (Task 1), `Btn`/`Input`/`Select` helpers.
- Produces: `DOC_CATEGORIES = ["Purchase Order", "Contract Agreement", "Advisory"]`; `<DocumentForm acct dispatch user onDone />`.

- [ ] **Step 1:** Add the categories constant and component:

```js
/* ------------------------- account documents ------------------------- */
const DOC_CATEGORIES = ["Purchase Order", "Contract Agreement", "Advisory"];
const EXPIRY_WARN_DAYS = 60;
function DocumentForm({ acct, dispatch, user, onDone }) {
  const fileRef = useRef(null);
  const [category, setCategory] = useState(DOC_CATEGORIES[0]);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async e => {
    e.preventDefault();
    const files = fileRef.current?.files;
    if (!files || !files.length) { setErr("Choose a file."); return; }
    setBusy(true); setErr("");
    try {
      const [uploaded] = await uploadFiles(files, acct.id);
      const doc = { id: uid(), category, title: title.trim(), name: uploaded.name, url: uploaded.url, path: uploaded.path,
        amount: amount === "" ? null : +amount, effectiveDate: effectiveDate || null, expiryDate: expiryDate || null,
        uploadedBy: user?.name || "unknown", uploadedAt: iso(Date.now()) };
      dispatch({ type: "ADD_DOCUMENT", id: acct.id, doc, by: user?.name, source: "upload" });
      onDone();
    } catch (ex) { setErr(ex.message || String(ex)); setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select value={category} onChange={e => setCategory(e.target.value)} options={DOC_CATEGORIES} />
        <Input placeholder="Title (optional)" value={title} onChange={e => setTitle(e.target.value)} />
        <Input type="number" placeholder="Amount (optional)" value={amount} onChange={e => setAmount(e.target.value)} />
        <input ref={fileRef} type="file" className="text-xs text-slate-700" />
        <label className="text-xs text-slate-500">Effective<Input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} /></label>
        <label className="text-xs text-slate-500">Expiry<Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></label>
      </div>
      {err && <div className="text-xs font-semibold text-rose-600">{err}</div>}
      <div className="flex gap-2">
        <Btn kind="primary" type="submit">{busy ? "Uploading…" : "Upload document"}</Btn>
        <Btn onClick={onDone}>Cancel</Btn>
      </div>
    </form>
  );
}
```

- [ ] **Step 2:** Confirm the file still loads in the browser without a console/Babel error.

- [ ] **Step 3:** Commit.

```powershell
git add crm.html; git commit -m "feat: DocumentForm component for account documents"
```

---

### Task 3: Documents card + expiry badge + AccountDetail wiring

**Files:**
- Modify: `crm.html` — add `docExpiryBadge` helper + `DocumentsCard` component near the documents block; wire the "documents" form key and the card into `AccountDetail` (`crm.html:1585`, form switch `crm.html:1655-1663`, cards grid `crm.html:1664-1701`).

**Interfaces:**
- Consumes: `DOC_CATEGORIES`, `EXPIRY_WARN_DAYS`, `DELETE_DOCUMENT`, `DocumentForm`, `Card`, `fmtMoney`, `fmtDate`, `daysUntil`.
- Produces: `docExpiryBadge(doc)` → JSX badge or null; `<DocumentsCard a dispatch user onAdd />`; `AccountDetail` form state accepts `form === "document"`.

- [ ] **Step 1:** Add the expiry-badge helper and the card, directly below `DocumentForm`:

```js
function docExpiryBadge(doc) {
  if (doc.category !== "Contract Agreement" || !doc.expiryDate) return null;
  const d = daysUntil(doc.expiryDate);
  if (d < 0) return <span className="nm-inset !rounded-full px-2 py-0.5 text-[10px] font-bold text-rose-600">Expired</span>;
  if (d <= EXPIRY_WARN_DAYS) return <span className="nm-inset !rounded-full px-2 py-0.5 text-[10px] font-bold text-amber-600">Expires in {d}d</span>;
  return null;
}
function DocumentsCard({ a, dispatch, user, onAdd }) {
  const docs = a.documents || [];
  return (
    <Card title={`Documents (${docs.length})`} right={<button className="text-xs font-semibold text-indigo-600 hover:underline" onClick={onAdd}>＋ Add document</button>}>
      {docs.length === 0 && <div className="text-sm text-slate-500">No documents yet.</div>}
      {DOC_CATEGORIES.map(cat => {
        const group = docs.filter(d => d.category === cat);
        if (!group.length) return null;
        return (
          <div key={cat} className="mb-2">
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{cat}s</div>
            {group.map(d => (
              <div key={d.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0">
                <a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:text-indigo-800">📎 {d.title || d.name}</a>
                {docExpiryBadge(d)}
                {d.amount != null && <span className="text-xs font-semibold text-slate-700">{fmtMoney(d.amount, a.currency)}</span>}
                {(d.effectiveDate || d.expiryDate) && <span className="text-xs text-slate-500">{d.effectiveDate ? fmtDate(d.effectiveDate) : "—"} → {d.expiryDate ? fmtDate(d.expiryDate) : "—"}</span>}
                <button title="Delete document" className="ml-auto text-xs text-rose-500 hover:text-rose-700"
                  onClick={async () => {
                    if (!confirm(`Delete "${d.title || d.name}"? This permanently removes the file.`)) return;
                    if (sb) { const { error } = await sb.storage.from("attachments").remove([d.path]); if (error) { alert("Could not delete file: " + error.message); return; } }
                    dispatch({ type: "DELETE_DOCUMENT", id: a.id, docId: d.id, by: user?.name, source: "delete" });
                  }}>✕</button>
              </div>
            ))}
          </div>
        );
      })}
    </Card>
  );
}
```

- [ ] **Step 2:** Wire the form into `AccountDetail`'s form switch. In the chain at `crm.html:1655-1663`, add a branch for `form === "document"` (before the trailing `<UpdateHealthForm …>` default). The block is wrapped by `{form && <Card title=…>` — match the existing pattern; add:

```jsx
        : form === "document" ? <DocumentForm acct={a} user={user} dispatch={dispatch} onDone={() => setForm(null)} />
```

- [ ] **Step 3:** Render the card. Inside the `<div className="grid gap-4 lg:grid-cols-2">` block (the Activity/Opportunities grid, `crm.html:1702-1717`) or as a new full-width row directly after that grid closes — add:

```jsx
      <DocumentsCard a={a} dispatch={dispatch} user={user} onAdd={() => setForm("document")} />
```

Place it as its own row after the two-column grid so it spans full width.

- [ ] **Step 4:** Confirm the app loads; open an account and confirm the Documents card renders with "No documents yet." and a "＋ Add document" button.

- [ ] **Step 5:** Commit.

```powershell
git add crm.html; git commit -m "feat: Documents card, expiry badge, and DocumentForm wiring in AccountDetail"
```

---

### Task 4: E2E verification (Playwright harness)

**Files:**
- Create: `scratchpad/docs-e2e/` (harness copy of `crm.html` + mock + test) — not committed to the repo.

**Interfaces:**
- Consumes: the shipped `crm.html`. Mocks `sb` with an in-memory Supabase incl. `storage.from().upload/getPublicUrl/remove`, `from().upsert/select`, and `channel`/`removeChannel` stubs; seeds via `window.__seed = seedData()`.

- [ ] **Step 1:** Build the harness. Copy `crm.html` to `scratchpad/docs-e2e/app.html`. Replace the line `const sb = CONFIGURED ? supabase.createClient(...) : null;` (`crm.html:66`) with an in-memory mock. The storage mock must record uploads and removes:

```js
const sb = (() => {
  const store = { rows: {}, removed: [] };
  const storage = { from: () => ({
    upload: async (path, file) => { store.rows[path] = file?.name || path; return { error: null }; },
    getPublicUrl: (path) => ({ data: { publicUrl: "blob://" + path } }),
    remove: async (paths) => { paths.forEach(p => { store.removed.push(p); delete store.rows[p]; }); return { error: null }; },
  }) };
  const table = () => ({ upsert: async () => ({ error: null }), delete: () => ({ eq: async () => ({ error: null }) }), select: async () => ({ data: [], error: null }) });
  window.__sbStore = store;
  return { storage, from: table, channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }), removeChannel: () => {} };
})();
```

Also set `const CONFIGURED = true;` in the harness copy and inject `window.__seed` (an account with `documents: []`) the way prior harnesses do (mirror the seed shape used by existing E2E scripts under `scratchpad/`).

- [ ] **Step 2:** Write the Playwright test `scratchpad/docs-e2e/test.mjs` driving headless Edge (`channel: "msedge"`). Cases:

```js
import { chromium } from "playwright";
const b = await chromium.launch({ channel: "msedge", headless: true });
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.goto("file://" + process.cwd().replace(/\\/g, "/") + "/scratchpad/docs-e2e/app.html");
// open first account, open Documents form
await p.getByText(/Add document/).click();
// choose Contract Agreement, set an expiry 30 days out, attach a file, upload
// (select category, fill date input, setInputFiles on the file input, click "Upload document")
// assert: row appears under "Contract Agreements", amber "Expires in" badge present
// set an expiry in the past -> assert red "Expired"
// add a Purchase Order with an amount -> assert under "Purchase Orders" with formatted amount
// delete a doc (accept confirm) -> assert row gone AND window.__sbStore.removed includes its path
// assert errs.length === 0 and a pre-existing task attachment still renders
console.log(errs.length ? "FAIL " + errs.join("; ") : "PASS");
await b.close();
```

Fill in the selectors concretely against the rendered DOM (use `page.on("dialog", d => d.accept())` for the delete confirm; use `setInputFiles` with a small temp file).

- [ ] **Step 3:** Run it.

Run: `node scratchpad/docs-e2e/test.mjs`
Expected: `PASS` (no page errors; all assertions hold).

- [ ] **Step 4:** If it fails, fix the implementation in `crm.html` (not the test), re-run until PASS. Commit any `crm.html` fixes:

```powershell
git add crm.html; git commit -m "fix: account documents issues found in E2E"
```

---

### Task 5: PR

- [ ] **Step 1:** Push and open the PR (body via file to avoid PowerShell quoting issues).

```powershell
git push -u origin feat/account-documents
```

- [ ] **Step 2:** Write the PR body to `scratchpad/pr-body.md` (summary of the feature, the additive guarantee, and the E2E results) and open the PR:

```powershell
gh pr create --title "feat: account documents (PO / Contract / Advisory) with expiry flag" --body-file scratchpad/pr-body.md
```

- [ ] **Step 3:** Report the PR URL to the user for review before merge (merge to master deploys live).

---

## Self-Review

- **Spec coverage:** data model (Task 1 doc shape) ✓; category + required file (Task 2 validation) ✓; extra fields title/amount/effective/expiry (Task 2) ✓; Supabase Storage reuse (Task 2 `uploadFiles`) ✓; ADD/DELETE reducer + audit (Task 1) ✓; storage hard-delete (Task 3 delete handler) ✓; Documents card grouped by category (Task 3) ✓; expiry badge 60d/expired, contracts only (Task 3 `docExpiryBadge`) ✓; DocumentForm (Task 2) ✓; E2E cases incl. attachments-still-work regression (Task 4) ✓.
- **Placeholder scan:** Task 4 leaves selector fill-in as explicit instruction (harness is scratch, not shipped code) — acceptable; all shipped-code steps show complete code.
- **Type consistency:** `doc` fields identical across Task 1 (reducer/audit), Task 2 (construction), Task 3 (render/delete). Action names `ADD_DOCUMENT`/`DELETE_DOCUMENT` and payload keys (`id`, `doc`, `docId`, `by`, `source`) consistent across persistence, reducer, form, and card. `DOC_CATEGORIES`, `EXPIRY_WARN_DAYS`, `docExpiryBadge` defined once, consumed as declared.
