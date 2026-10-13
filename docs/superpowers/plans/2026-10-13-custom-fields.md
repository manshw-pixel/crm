# Custom Account Fields Implementation Plan (PR 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins define extra account fields in Settings → Account fields; every account can hold values for them in Edit account; values show on the account page and in CSV export.

**Architecture:** Field definitions live in the org settings row as `settings.customFields` (saved through a new `SET_CUSTOM_FIELDS` action that rides the existing settings write path). Values live on each account as `account.custom = { [fieldId]: value }`, saved through the existing `EDIT_ACCOUNT` / `merge_row` path (top-level shallow merge, so `custom` is always sent as a whole object). Pure logic sits in a new `src/lib/custom-fields.js` ES module with node unit tests; UI sits in the existing JSX files.

**Tech Stack:** React (globals, no imports in `src/NN-*.jsx`), Tailwind classes, esbuild via `node build.mjs`, node:test unit tests (`npm run test:unit`), Playwright E2E via `tests/health/run.mjs` / `run-one.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-13-custom-fields-ownership-leads-design.md` (section "PR 1 — Custom fields"). PRs 2 and 3 get their own plans after this ships.

## Global Constraints

- Field types exactly: `"text" | "number" | "date" | "select" | "bool"`. No required flag.
- Field ids are `cf_` + `uid()`; generated once, never reused or changed by rename/type change.
- Delete = `archived: true`; values are never removed from accounts.
- No SQL changes in this PR.
- `src/lib/*` must not touch window/document/React/store (build.mjs enforces this).
- New E2E test files must be added as an `import` line in `tests/health/run.mjs`, or CI never runs them.
- Additive only: do not change behaviour of existing fields, actions or CSV columns.
- Settings is already admin-only (`26-app.jsx` hides it for non-admins); no extra gating needed in the card.

## Review Focus

1. **Saving one custom field must not wipe another** — editing field A on an account that already has B saved keeps B. (Task 1 `buildCustomPatch` test + Task 3 E2E.)
2. **A dropdown value that is no longer in the options list** (admin removed the option) must still display on the account page and stay selected in the editor rather than silently blanking. (Task 1 test + Task 3 editor keeps unknown option.)
3. **Type changed after values exist** (text "abc" → number) must not crash the account page or editor; page shows raw text, editor shows blank. (Task 1 `formatCustomValue`/`editorValue` tests.)
4. **CSV export with a label containing commas, quotes or a leading `=`** must be escaped like every other cell (formula-injection guard). (Task 4 unit test.)
5. **Blank label on add** must not create a nameless field. (Task 2 E2E: Add button disabled until label non-blank.)

---

### Task 1: Pure helpers `src/lib/custom-fields.js`

**Files:**
- Create: `src/lib/custom-fields.js`
- Modify: `src/lib/index.js` (add export line)
- Test: `tests/unit/custom-fields.test.mjs`

**Interfaces:**
- Produces (all exported, become globals in the app):
  - `CUSTOM_FIELD_TYPES: string[]` = `["text","number","date","select","bool"]`
  - `CUSTOM_FIELD_TYPE_LABELS: Record<string,string>` = `{ text:"Text", number:"Number", date:"Date", select:"Dropdown", bool:"Yes / No" }`
  - `activeCustomFields(defs): Def[]` — non-archived, input order; tolerates `undefined`/non-array → `[]`.
  - `archivedCustomFields(defs): Def[]`
  - `normalizeFieldDef(d): Def` — trims label, coerces unknown type to `"text"`, `options` = trimmed non-empty unique strings (only kept for `select`), `archived` boolean.
  - `coerceCustomValue(type, raw): any` — editor value → stored value. text: trimmed string (`""`→`null`); number: finite Number or `null`; date: `YYYY-MM-DD` string or `null`; select: string or `null`; bool: `true`/`false`.
  - `editorValue(type, stored): string|boolean` — stored → input value. number: `""` unless finite; date: `""` unless matches `/^\d{4}-\d{2}-\d{2}$/`; bool: `stored === true`; text/select: `stored == null ? "" : String(stored)`.
  - `formatCustomValue(type, stored): string` — for display; `""` when empty. bool → `"Yes"`/`"No"` (only when boolean); date → `fmtDate`-free `YYYY-MM-DD` passthrough (UI formats); anything that doesn't fit the type → `String(stored)`.
  - `buildCustomPatch(currentCustom, edits): object` — `{ ...currentCustom, ...edits }`, dropping keys whose value is `null`/`""` from `edits` only if they were not present before (so clearing a value stores `null`, which keeps the key explicit).
  - `newFieldId(): string` — `"cf_" + Math.random().toString(36).slice(2, 10)`.

- [ ] **Step 1: Write the failing test** — `tests/unit/custom-fields.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOM_FIELD_TYPES, activeCustomFields, archivedCustomFields, normalizeFieldDef, coerceCustomValue,
  editorValue, formatCustomValue, buildCustomPatch, newFieldId } from "../../src/lib/custom-fields.js";

test("types list is exactly the five spec types", () => {
  assert.deepEqual(CUSTOM_FIELD_TYPES, ["text", "number", "date", "select", "bool"]);
});

test("active/archived split tolerates junk", () => {
  assert.deepEqual(activeCustomFields(undefined), []);
  assert.deepEqual(activeCustomFields("x"), []);
  const defs = [{ id: "a", label: "A" }, { id: "b", label: "B", archived: true }, { id: "c", label: "C" }];
  assert.deepEqual(activeCustomFields(defs).map(d => d.id), ["a", "c"]);
  assert.deepEqual(archivedCustomFields(defs).map(d => d.id), ["b"]);
});

test("normalizeFieldDef trims, defaults type, cleans options", () => {
  assert.deepEqual(normalizeFieldDef({ id: "x", label: "  Region ", type: "weird" }), { id: "x", label: "Region", type: "text", archived: false });
  assert.deepEqual(normalizeFieldDef({ id: "x", label: "Seg", type: "select", options: [" A ", "", "B", "A"] }),
    { id: "x", label: "Seg", type: "select", options: ["A", "B"], archived: false });
  assert.equal("options" in normalizeFieldDef({ id: "x", label: "N", type: "number", options: ["1"] }), false);
});

test("coerceCustomValue per type", () => {
  assert.equal(coerceCustomValue("text", "  hi "), "hi");
  assert.equal(coerceCustomValue("text", "   "), null);
  assert.equal(coerceCustomValue("number", "12.5"), 12.5);
  assert.equal(coerceCustomValue("number", "abc"), null);
  assert.equal(coerceCustomValue("number", ""), null);
  assert.equal(coerceCustomValue("date", "2026-10-13"), "2026-10-13");
  assert.equal(coerceCustomValue("date", "13/10/2026"), null);
  assert.equal(coerceCustomValue("select", "Gold"), "Gold");
  assert.equal(coerceCustomValue("select", ""), null);
  assert.equal(coerceCustomValue("bool", true), true);
  assert.equal(coerceCustomValue("bool", false), false);
});

test("editorValue never crashes on a value of the wrong type (type changed after save)", () => {
  assert.equal(editorValue("number", "abc"), "");
  assert.equal(editorValue("number", 7), "7");
  assert.equal(editorValue("date", "soon"), "");
  assert.equal(editorValue("bool", "yes"), false);
  assert.equal(editorValue("text", 5), "5");
  assert.equal(editorValue("select", "Removed option"), "Removed option");
  assert.equal(editorValue("text", null), "");
});

test("formatCustomValue shows what is stored, even if it no longer fits", () => {
  assert.equal(formatCustomValue("bool", true), "Yes");
  assert.equal(formatCustomValue("bool", false), "No");
  assert.equal(formatCustomValue("number", 1200), "1200");
  assert.equal(formatCustomValue("number", "abc"), "abc");
  assert.equal(formatCustomValue("select", "Removed option"), "Removed option");
  assert.equal(formatCustomValue("text", null), "");
  assert.equal(formatCustomValue("text", ""), "");
});

test("buildCustomPatch keeps fields it was not asked to change", () => {
  assert.deepEqual(buildCustomPatch({ a: "x", b: 2 }, { a: "y" }), { a: "y", b: 2 });
  assert.deepEqual(buildCustomPatch(undefined, { a: "y" }), { a: "y" });
  assert.deepEqual(buildCustomPatch({ a: "x" }, { a: null }), { a: null });
  assert.deepEqual(buildCustomPatch({}, { a: null }), {});
});

test("newFieldId is prefixed and unique", () => {
  const ids = new Set(Array.from({ length: 200 }, newFieldId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^cf_[a-z0-9]+$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/custom-fields.test.mjs`
Expected: FAIL — cannot find module `src/lib/custom-fields.js`.

- [ ] **Step 3: Write the implementation** — `src/lib/custom-fields.js`

```js
// Admin-defined account fields (spec 2026-10-13, PR 1). Definitions live in settings.customFields;
// values live on the account as `custom: { [fieldId]: value }`. A field is never hard-deleted:
// `archived` hides it and keeps every stored value, so restoring brings the data back.
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "bool"];
export const CUSTOM_FIELD_TYPE_LABELS = { text: "Text", number: "Number", date: "Date", select: "Dropdown", bool: "Yes / No" };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const list = defs => (Array.isArray(defs) ? defs : []);

export const activeCustomFields = defs => list(defs).filter(d => d && !d.archived);
export const archivedCustomFields = defs => list(defs).filter(d => d && d.archived);

export function normalizeFieldDef(d) {
  const type = CUSTOM_FIELD_TYPES.includes(d && d.type) ? d.type : "text";
  const out = { id: d.id, label: String((d && d.label) || "").trim(), type };
  if (type === "select") out.options = [...new Set(list(d.options).map(o => String(o).trim()).filter(Boolean))];
  out.archived = !!(d && d.archived);
  return out;
}

export function coerceCustomValue(type, raw) {
  if (type === "bool") return raw === true;
  if (type === "number") { if (raw === "" || raw == null) return null; const n = Number(raw); return Number.isFinite(n) ? n : null; }
  const s = raw == null ? "" : String(raw).trim();
  if (type === "date") return ISO_DAY.test(s) ? s : null;
  return s === "" ? null : s;
}

export function editorValue(type, stored) {
  if (type === "bool") return stored === true;
  if (type === "number") return typeof stored === "number" && Number.isFinite(stored) ? String(stored) : "";
  if (type === "date") return typeof stored === "string" && ISO_DAY.test(stored) ? stored : "";
  return stored == null ? "" : String(stored);
}

export function formatCustomValue(type, stored) {
  if (stored == null || stored === "") return "";
  if (type === "bool" && typeof stored === "boolean") return stored ? "Yes" : "No";
  return String(stored);
}

// Shallow merge: merge_row replaces top-level keys, so `custom` must always travel whole.
export function buildCustomPatch(currentCustom, edits) {
  const base = { ...(currentCustom || {}) };
  for (const [k, v] of Object.entries(edits || {})) {
    if ((v == null || v === "") && !(k in base)) continue;
    base[k] = v === "" ? null : v;
  }
  return base;
}

export const newFieldId = () => "cf_" + Math.random().toString(36).slice(2, 10);
```

Add to `src/lib/index.js` after the `invoice.js` line:

```js
export * from "./custom-fields.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/custom-fields.test.mjs` → all PASS.
Run: `npm run test:unit` → all PASS (includes `imports.test.mjs`, which checks lib exports load).
Run: `npm run build` → "Done", no lib-purity error.

- [ ] **Step 5: Commit**

```bash
git add src/lib/custom-fields.js src/lib/index.js tests/unit/custom-fields.test.mjs
git commit -m "Custom fields: pure helpers for definitions and values"
```

---

### Task 2: `SET_CUSTOM_FIELDS` action + Settings → Account fields card

**Files:**
- Modify: `src/lib/reducer.js` — line ~111 (write-op case list) and ~301 (state case)
- Modify: `src/24-settings.jsx` — new `CustomFieldsCard` function above `function Settings`; nav entry (line ~296); render it after the Health playbook card (line ~365)
- Test: `tests/unit/reducer.test.mjs` (add a case), `tests/health/custom-fields.test.mjs` (new), `tests/health/run.mjs` (import line)

**Interfaces:**
- Consumes: `normalizeFieldDef`, `activeCustomFields`, `archivedCustomFields`, `newFieldId`, `CUSTOM_FIELD_TYPES`, `CUSTOM_FIELD_TYPE_LABELS` (Task 1).
- Produces: action `{ type: "SET_CUSTOM_FIELDS", fields: Def[] }` → `state.settings.customFields = fields`, persisted via the settings merge op. DOM hooks: `#set-custom-fields`, `[data-cf-row="<id>"]`, `[data-cf-new-label]`, `[data-cf-new-type]`, `[data-cf-add]`, `[data-cf-archive="<id>"]`, `[data-cf-restore="<id>"]`, `[data-cf-options="<id>"]`, `[data-cf-builtin]`.

- [ ] **Step 1: Write the failing unit test** — append to `tests/unit/reducer.test.mjs` (follow the file's existing import of `reducer` / op-planning helper; read the top of the file first and reuse its helpers exactly):

```js
test("SET_CUSTOM_FIELDS stores the list in settings and plans a settings write", () => {
  const fields = [{ id: "cf_1", label: "Region", type: "text", archived: false }];
  const s0 = { ...EMPTY_STATE_FOR_TESTS, settings: { weights: {} } };
  const s1 = reducer(s0, { type: "SET_CUSTOM_FIELDS", fields });
  assert.deepEqual(s1.settings.customFields, fields);
  const ops = planWrites(s0, s1, { type: "SET_CUSTOM_FIELDS", fields });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].table, "settings");
  assert.deepEqual(ops[0].patch.customFields, fields);
});
```

(Replace `EMPTY_STATE_FOR_TESTS` / `reducer` / `planWrites` with the names this test file already uses for an empty state, the reducer, and the write-op planner — do not invent new helpers.)

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/reducer.test.mjs` → the new test FAILS (`customFields` undefined).

- [ ] **Step 3: Implement the reducer change** in `src/lib/reducer.js`:
  - In the write-op `switch`, add `case "SET_CUSTOM_FIELDS":` to the line that reads `case "SET_PLAYBOOK": case "SET_HEALTH_PLAYBOOK": case "SET_SEGMENTS": {`.
  - In the state `switch`, next to `case "SET_SEGMENTS": ...`, add:

```js
    case "SET_CUSTOM_FIELDS": return { ...state, settings: { ...state.settings, customFields: action.fields } };
```

Run: `node --test tests/unit/reducer.test.mjs` → PASS. If a golden test in `tests/unit/golden` fails, read `tests/unit/_golden.mjs` for the regen flag; regenerate ONLY if the diff is exactly the new action (see memory note "golden-regen trap": never regen to hide an unrelated change).

- [ ] **Step 4: Write the failing E2E test** — `tests/health/custom-fields.test.mjs`

```js
// Custom account fields: admin defines them in Settings, they persist to settings, archive/restore keeps them.
import { launch, seedAccount, gotoSettings } from "./harness.mjs";
import { test, assert } from "./framework.mjs";

export const seedCF = (accounts, customFields = [], role = "admin") => `window.__seedRows = { accounts: ${JSON.stringify(accounts)}.map(d => ({ id: d.id, data: d })),`
  + ` contacts: [], activities: [], tasks: [], opportunities: [], team: [],`
  + ` settings: [{ id: 1, data: { customFields: ${JSON.stringify(customFields)} } }],`
  + ` profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "${role}" }] };`;
const storedFields = page => page.evaluate(() => window.__store.getState().settings.customFields || []);

test("admin adds, renames and archives/restores a custom field in Settings", async () => {
  const { page, browser } = await launch(seedCF([seedAccount({ id: "a1", name: "Acme" })]));
  try {
    await gotoSettings(page);
    await page.waitForSelector("#set-custom-fields");
    assert(await page.locator("#set-custom-fields [data-cf-builtin]").count() > 5, "built-in fields not listed");
    assert(await page.locator("[data-cf-add]").isDisabled(), "Add should be disabled with a blank label");
    await page.fill("[data-cf-new-label]", "Region");
    await page.selectOption("[data-cf-new-type]", "select");
    await page.click("[data-cf-add]");
    let f = await storedFields(page);
    assert(f.length === 1 && f[0].label === "Region" && f[0].type === "select" && /^cf_/.test(f[0].id), "field not stored: " + JSON.stringify(f));
    const id = f[0].id;
    await page.fill(`[data-cf-options="${id}"]`, "North, South");
    await page.locator(`[data-cf-options="${id}"]`).blur();
    f = await storedFields(page);
    assert(JSON.stringify(f[0].options) === '["North","South"]', "options not stored: " + JSON.stringify(f));
    await page.click(`[data-cf-archive="${id}"]`);
    f = await storedFields(page);
    assert(f[0].archived === true, "archive should flag, not remove");
    assert(await page.locator(`[data-cf-row="${id}"]`).count() === 0, "archived field still in the active list");
    await page.click("text=Archived (1)");
    await page.click(`[data-cf-restore="${id}"]`);
    f = await storedFields(page);
    assert(f[0].archived === false && f[0].id === id, "restore lost the field id");
  } finally { await browser.close(); }
});
```

Add `import "./custom-fields.test.mjs";` to the import block in `tests/health/run.mjs`.

- [ ] **Step 5: Run it to verify it fails**

Run: `npm run build && node tests/health/run-one.mjs custom-fields.test.mjs`
Expected: FAIL — `#set-custom-fields` not found.

- [ ] **Step 6: Implement `CustomFieldsCard`** in `src/24-settings.jsx`, above `function Settings(`:

```jsx
// Admin-defined account fields (spec 2026-10-13). Built-ins are listed read-only so admins see the
// whole picture; custom fields can be added, renamed, retyped, reordered and archived (never deleted).
const BUILTIN_ACCOUNT_FIELDS = ["Name", "Tier", "ARR", "Billing currency", "Industry", "CSM owner", "Start date", "Transition date",
  "Renewal date", "Contract status", "QBR cadence", "Modules", "Total licenses", "Deployed licenses", "Dedicated support", "Billing completed", "Parent account"];
function CustomFieldsCard({ st, dispatch }) {
  const all = (st.settings && st.settings.customFields) || [];
  const active = activeCustomFields(all), archived = archivedCustomFields(all);
  const [label, setLabel] = useState(""), [type, setType] = useState("text"), [showArch, setShowArch] = useState(false);
  const save = list => dispatch({ type: "SET_CUSTOM_FIELDS", fields: list.map(normalizeFieldDef) });
  const patch = (id, p) => save(all.map(d => d.id === id ? { ...d, ...p } : d));
  const move = (id, dir) => {
    const ids = active.map(d => d.id), i = ids.indexOf(id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    save([...ids.map(x => all.find(d => d.id === x)), ...archived]);
  };
  return (
    <Card title="Account fields">
      <p className="mb-2 text-xs text-slate-500">Built-in fields are fixed. Custom fields appear on every account's Edit form and page, and in CSV export.</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {BUILTIN_ACCOUNT_FIELDS.map(n => <span key={n} data-cf-builtin className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">🔒 {n}</span>)}
      </div>
      {active.map((d, i) => (
        <div key={d.id} data-cf-row={d.id} className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <Input defaultValue={d.label} aria-label="Field label" className="w-40"
            onBlur={e => { const v = e.target.value.trim(); if (v && v !== d.label) patch(d.id, { label: v }); else e.target.value = d.label; }} />
          <Select value={d.type} aria-label="Field type" onChange={e => patch(d.id, { type: e.target.value })}
            options={CUSTOM_FIELD_TYPES.map(t => ({ value: t, label: CUSTOM_FIELD_TYPE_LABELS[t] }))} />
          {d.type === "select" && <Input data-cf-options={d.id} defaultValue={(d.options || []).join(", ")} placeholder="Options, comma-separated" className="w-56"
            onBlur={e => patch(d.id, { options: e.target.value.split(",") })} />}
          <button title="Move up" aria-label="Move up" disabled={i === 0} className="text-xs text-slate-500 disabled:opacity-30" onClick={() => move(d.id, -1)}>▲</button>
          <button title="Move down" aria-label="Move down" disabled={i === active.length - 1} className="text-xs text-slate-500 disabled:opacity-30" onClick={() => move(d.id, 1)}>▼</button>
          <button data-cf-archive={d.id} className="ml-auto text-xs font-semibold text-rose-600" onClick={() => patch(d.id, { archived: true })}>Delete</button>
        </div>))}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <Input data-cf-new-label value={label} onChange={e => setLabel(e.target.value)} placeholder="New field label" className="w-40" />
        <Select data-cf-new-type value={type} onChange={e => setType(e.target.value)} options={CUSTOM_FIELD_TYPES.map(t => ({ value: t, label: CUSTOM_FIELD_TYPE_LABELS[t] }))} />
        <Btn data-cf-add kind="primary" disabled={!label.trim()} onClick={() => { save([...all, { id: newFieldId(), label, type }]); setLabel(""); setType("text"); }}>+ Add field</Btn>
      </div>
      {archived.length > 0 && <div className="mt-3 text-xs">
        <button className="font-semibold text-slate-500 hover:text-slate-800" onClick={() => setShowArch(s => !s)}>Archived ({archived.length})</button>
        {showArch && archived.map(d => <div key={d.id} className="mt-1 flex items-center gap-2 text-slate-600">
          <span>{d.label}</span><span className="text-slate-400">{CUSTOM_FIELD_TYPE_LABELS[d.type]}</span>
          <button data-cf-restore={d.id} className="font-semibold text-indigo-600" onClick={() => patch(d.id, { archived: false })}>Restore</button></div>)}
      </div>}
    </Card>
  );
}
```

Before relying on `Select` with `{value,label}` options and `Btn` with `disabled`: open `src/10-ui-atoms.jsx` and check `Select`'s `options` prop and `Btn`'s prop pass-through. If `Select` only takes strings, use a plain `<select className="nm-inset border-0 px-3 py-1.5 text-sm text-slate-800 outline-none">` with `<option value={t}>{CUSTOM_FIELD_TYPE_LABELS[t]}</option>` instead (same `data-cf-new-type` / `aria-label`). Make sure `data-*` attributes reach the DOM element.

Wire it into `Settings`:
- Nav array: insert `["Account fields", "set-custom-fields"]` after `["Health playbook", "set-health-pb"]`.
- After `<div id="set-health-pb" ...>...</div>` add:

```jsx
      <div id="set-custom-fields" className="scroll-mt-4"><CustomFieldsCard st={st} dispatch={dispatch} /></div>
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run build && node tests/health/run-one.mjs custom-fields.test.mjs` → PASS.
Run: `node tests/health/run-one.mjs settings.test.mjs` → PASS (nav change must not break it).

- [ ] **Step 8: Commit**

```bash
git add src/lib/reducer.js src/24-settings.jsx tests/unit/reducer.test.mjs tests/health/custom-fields.test.mjs tests/health/run.mjs tests/unit/golden
git commit -m "Custom fields: Settings card and SET_CUSTOM_FIELDS action"
```

---

### Task 3: Edit account inputs + account page Details

**Files:**
- Modify: `src/13-forms.jsx` — `AccountForm` (props, state, submit, a new section before the Billing `<details>`)
- Modify: `src/21-account-detail.jsx` — pass `customFields` to `AccountForm` (line ~`form === "edit"`), and add a Details row in the header card facts block
- Test: `tests/health/custom-fields.test.mjs` (append cases)

**Interfaces:**
- Consumes: `activeCustomFields`, `coerceCustomValue`, `editorValue`, `formatCustomValue`, `buildCustomPatch` (Task 1); `settings.customFields` (Task 2).
- Produces: `AccountForm` accepts new prop `customFields: Def[]` (default `[]`); account patch includes `custom` (whole object). DOM hooks: `[data-custom-field="<id>"]` on each editor input, `[data-custom-details]` on the account-page row, `[data-custom-value="<id>"]` on each displayed value.

- [ ] **Step 1: Write the failing E2E tests** — append to `tests/health/custom-fields.test.mjs`:

```js
const FIELDS = [
  { id: "cf_t", label: "Region", type: "text", archived: false },
  { id: "cf_n", label: "Seats sold", type: "number", archived: false },
  { id: "cf_d", label: "Go-live", type: "date", archived: false },
  { id: "cf_s", label: "Segment", type: "select", options: ["Gold", "Silver"], archived: false },
  { id: "cf_b", label: "Reference", type: "bool", archived: false },
  { id: "cf_x", label: "Old field", type: "text", archived: true },
];
const openEdit = async (page, name) => {
  await page.click('button[title="Accounts"]');
  await page.getByText(name).first().click();
  await page.waitForSelector("[data-header-card]");
  await page.click("text=✎ Edit account");
  await page.waitForSelector("form");
};
const custom = (page, id) => page.evaluate(i => window.__store.getState().accounts.find(a => a.id === i).custom || {}, id);

test("Edit account renders each custom field type and saves them; archived fields are hidden", async () => {
  const { page, browser } = await launch(seedCF([seedAccount({ id: "a1", name: "Acme" })], FIELDS));
  try {
    await openEdit(page, "Acme");
    assert(await page.locator('[data-custom-field="cf_x"]').count() === 0, "archived field shown in the form");
    await page.fill('[data-custom-field="cf_t"]', "  EMEA ");
    await page.fill('[data-custom-field="cf_n"]', "40");
    await page.fill('[data-custom-field="cf_d"]', "2026-12-01");
    await page.selectOption('[data-custom-field="cf_s"]', "Gold");
    await page.check('[data-custom-field="cf_b"]');
    await page.click("text=Save changes");
    const c = await custom(page, "a1");
    assert(c.cf_t === "EMEA" && c.cf_n === 40 && c.cf_d === "2026-12-01" && c.cf_s === "Gold" && c.cf_b === true, "saved: " + JSON.stringify(c));
    const details = await page.textContent("[data-custom-details]");
    assert(/Region/.test(details) && /EMEA/.test(details) && /Gold/.test(details) && /Yes/.test(details), "details row: " + details);
  } finally { await browser.close(); }
});

test("saving one custom field keeps the others, including an archived field's value", async () => {
  const acct = seedAccount({ id: "a1", name: "Acme", custom: { cf_t: "APAC", cf_n: 5, cf_x: "kept" } });
  const { page, browser } = await launch(seedCF([acct], FIELDS));
  try {
    await openEdit(page, "Acme");
    await page.fill('[data-custom-field="cf_n"]', "9");
    await page.click("text=Save changes");
    const c = await custom(page, "a1");
    assert(c.cf_t === "APAC" && c.cf_n === 9 && c.cf_x === "kept", "lost a value: " + JSON.stringify(c));
  } finally { await browser.close(); }
});

test("a dropdown value whose option was removed still shows and stays selected", async () => {
  const acct = seedAccount({ id: "a1", name: "Acme", custom: { cf_s: "Bronze" } });
  const { page, browser } = await launch(seedCF([acct], FIELDS));
  try {
    await page.click('button[title="Accounts"]');
    await page.getByText("Acme").first().click();
    await page.waitForSelector("[data-custom-details]");
    assert(/Bronze/.test(await page.textContent('[data-custom-value="cf_s"]')), "removed option not displayed");
    await page.click("text=✎ Edit account");
    assert(await page.inputValue('[data-custom-field="cf_s"]') === "Bronze", "editor dropped the removed option");
  } finally { await browser.close(); }
});

test("no custom fields: no section in the form, no details row", async () => {
  const { page, browser } = await launch(seedCF([seedAccount({ id: "a1", name: "Acme" })], []));
  try {
    await openEdit(page, "Acme");
    assert(await page.locator("[data-custom-field]").count() === 0, "inputs rendered with no fields");
    assert(await page.locator("[data-custom-details]").count() === 0, "details row rendered with no fields");
  } finally { await browser.close(); }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build && node tests/health/run-one.mjs custom-fields.test.mjs` → the 4 new cases FAIL.

- [ ] **Step 3: Implement the form** in `src/13-forms.jsx`:

Change the signature to:

```jsx
function AccountForm({ dispatch, onDone, existing, team = [], accounts = [], user, customFields = [] }) {
```

After the `const [v, setV] = useState(...)` line add:

```jsx
  const cfs = activeCustomFields(customFields);
  const [cv, setCv] = useState(() => Object.fromEntries(cfs.map(d => [d.id, editorValue(d.type, existing && existing.custom ? existing.custom[d.id] : null)])));
```

In `onSubmit`, after `const clean = { ... };` add:

```jsx
      if (cfs.length) clean.custom = buildCustomPatch(existing && existing.custom, Object.fromEntries(cfs.map(d => [d.id, coerceCustomValue(d.type, cv[d.id])])));
```

Immediately before `<details data-billing-fieldset`, add:

```jsx
      {cfs.length > 0 && <div className="col-span-2 mt-1 text-xs font-bold text-slate-700 md:col-span-4">Custom fields</div>}
      {cfs.map(d => {
        const setC = val => setCv(s => ({ ...s, [d.id]: val }));
        const cls = "nm-inset w-full border-0 px-3 py-1.5 text-sm text-slate-800 outline-none";
        if (d.type === "bool") return <label key={d.id} className="flex items-center gap-1 text-xs text-slate-700">
          <input type="checkbox" data-custom-field={d.id} checked={!!cv[d.id]} onChange={e => setC(e.target.checked)} />{d.label}</label>;
        if (d.type === "select") {
          const opts = d.options || [], cur = cv[d.id];
          return <F key={d.id} label={d.label}><select data-custom-field={d.id} value={cur} onChange={e => setC(e.target.value)} className={cls}>
            <option value="">—</option>
            {cur && !opts.includes(cur) && <option value={cur}>{cur}</option>}
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select></F>;
        }
        return <F key={d.id} label={d.label}><Input data-custom-field={d.id} type={d.type === "number" ? "number" : d.type === "date" ? "date" : "text"}
          value={cv[d.id]} onChange={e => setC(e.target.value)} /></F>;
      })}
```

(Check `Input` in `10-ui-atoms.jsx` forwards `data-*` props to the `<input>`; if not, use a plain `<input className={cls} ...>`.)

- [ ] **Step 4: Implement the account page** in `src/21-account-detail.jsx`:

Where the edit form is rendered, change

```jsx
: form === "edit" ? <AccountForm existing={a} dispatch={dispatch} onDone={() => setForm(null)} team={team} accounts={st.accounts} user={user} />
```

to

```jsx
: form === "edit" ? <AccountForm existing={a} dispatch={dispatch} onDone={() => setForm(null)} team={team} accounts={st.accounts} user={user} customFields={st.settings && st.settings.customFields} />
```

In the header card, directly after the closing `</div>` of the facts row (the one containing `<Meta label="Tier" ...>` ... `Parent`), add:

```jsx
            {(() => { const shown = activeCustomFields(st.settings && st.settings.customFields)
                .map(d => ({ d, text: formatCustomValue(d.type, a.custom && a.custom[d.id]) })).filter(x => x.text);
              return shown.length > 0 && <div data-custom-details className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                {shown.map(({ d, text }) => <Meta key={d.id} label={d.label}
                  value={<span data-custom-value={d.id}>{d.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(text) ? fmtDate(text) : text}</span>} />)}
              </div>; })()}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node tests/health/run-one.mjs custom-fields.test.mjs` → all PASS.
Run: `node tests/health/run-one.mjs licenses.test.mjs` and `node tests/health/run-one.mjs transition-date.test.mjs` → PASS (AccountForm regressions).

- [ ] **Step 6: Commit**

```bash
git add src/13-forms.jsx src/21-account-detail.jsx tests/health/custom-fields.test.mjs
git commit -m "Custom fields: Edit account inputs and account page details"
```

---

### Task 4: CSV export columns

**Files:**
- Modify: `src/lib/csv.js:24-29` (`accountsCSVText`)
- Modify: `src/17-csv.jsx:2-6` (`exportCSV`), `src/20-account-list.jsx:196` (call site)
- Test: `tests/unit/csv.test.mjs` (append)

**Interfaces:**
- Consumes: `activeCustomFields`, `formatCustomValue` (Task 1). `csvCell` (existing escaper in `csv.js`).
- Produces: `accountsCSVText(rows, customFields = [])` — appends one column per active field, header = label (escaped via `csvCell`), cell = `formatCustomValue`. `exportCSV(rows, customFields)`.
  `18-drive-sync.jsx:73` keeps calling `accountsCSVText(rows)` unchanged (Drive sync output stays as is — additive rule).

- [ ] **Step 1: Write the failing test** — append to `tests/unit/csv.test.mjs` (reuse its existing imports; add `accountsCSVText` to the import if not already there):

```js
test("accountsCSVText appends active custom fields, escaped, archived excluded", () => {
  const fields = [
    { id: "cf_a", label: "Region, area", type: "text" },
    { id: "cf_b", label: "=Danger", type: "bool" },
    { id: "cf_z", label: "Gone", type: "text", archived: true },
  ];
  const rows = [{ id: "1", name: "Acme", arr: 0, arrUSD: 0, renewalDate: "2027-01-01", custom: { cf_a: "EMEA", cf_b: true, cf_z: "x" } }];
  const [head, line] = accountsCSVText(rows, fields).split("\n");
  const plain = accountsCSVText(rows).split("\n")[0];
  assert.ok(head.startsWith(plain + ","), "custom columns must come after the existing ones");
  assert.ok(head.includes('"Region, area"'), "label with a comma must be quoted: " + head);
  assert.ok(!head.includes(",=Danger"), "formula-looking label must be neutralised: " + head);
  assert.ok(!head.includes("Gone"), "archived field exported");
  assert.ok(line.endsWith(",EMEA,Yes"), "values: " + line);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/unit/csv.test.mjs` → new test FAILS.

- [ ] **Step 3: Implement** in `src/lib/csv.js`. Add at the top of the file (next to other imports; if the file has none, add it as the first line):

```js
import { activeCustomFields, formatCustomValue } from "./custom-fields.js";
```

Change `accountsCSVText` to:

```js
export function accountsCSVText(rows, customFields = []) {
  const cols = [/* unchanged existing list */];
  const esc = csvCell;
  const cell = (a, c) => /* unchanged existing expression */;
  const cfs = activeCustomFields(customFields);
  const head = [...cols, ...cfs.map(d => esc(d.label))].join(",");
  return [head, ...rows.map(a => [...cols.map(c => esc(cell(a, c))), ...cfs.map(d => esc(formatCustomValue(d.type, a.custom && a.custom[d.id])))].join(","))].join("\n");
}
```

(Keep the existing `cols` array and `cell` expression byte-for-byte; only the `cfs`/`head`/`return` lines change. Note the existing header did `cols.join(",")` unescaped — keep built-in headers unescaped so the existing header string is identical.)

In `src/17-csv.jsx`:

```jsx
function exportCSV(rows, customFields) {
  const url = URL.createObjectURL(new Blob([accountsCSVText(rows, customFields)], { type: "text/csv" }));
```

In `src/20-account-list.jsx:196`, the component has the store state in scope (check its props: it is `st` or similar); change to:

```jsx
      <Btn onClick={() => exportCSV(rows, st.settings && st.settings.customFields)}>Export CSV</Btn>
```

If the list component does not receive settings, thread `customFields` from its parent in `26-app.jsx` as a prop named `customFields` and use that.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/csv.test.mjs` and `npm run test:unit` → PASS.
Run: `npm run build && node tests/health/run-one.mjs csv.test.mjs` → PASS (existing export E2E unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv.js src/17-csv.jsx src/20-account-list.jsx tests/unit/csv.test.mjs
git commit -m "Custom fields: include active fields in CSV export"
```

---

### Task 5: Full verification and PR

- [ ] **Step 1:** `npm run test:unit` → all PASS.
- [ ] **Step 2:** `node tests/health/run.mjs` (do not pipe; ~10 min) → 0 failed. A failure in a file this PR did not touch: rerun that file with `run-one.mjs`; if it passes alone, note it as a flake in the PR body; if it fails alone, fix it.
- [ ] **Step 3:** Screenshot check — adapt `tests/health/_shot-account.mjs` locally (do not commit the change) to seed two custom fields with values and confirm the Details row and Edit form look right at 1440px and 390px.
- [ ] **Step 4:** Push branch and open PR titled "Custom account fields (Settings → Account fields)" with a body summarising: Settings card, Edit form section, account page Details row, CSV export columns, archive-not-delete, no SQL needed. End the body with the Claude Code attribution line.
