import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "a1", name: "Alpha", csm: "Priya", tier: "Mid" });
const B = seedAccount({ id: "a2", name: "Beta", csm: "Priya", tier: "SMB" });
// the team list (and so the CSM dropdown's options) comes from profiles, not the team key.
// "Dana" must be a real profile or selecting it in the dialog resolves to "".
const PROFILES = [{ id: "u1", name: "Test User", role: "admin" }, { id: "u2", name: "Dana", role: "csm" }];
export const seed = `window.__seedRows = { accounts: ${JSON.stringify([A, B])}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [], profiles: ${JSON.stringify(PROFILES)} };`;

test("BULK_PATCH_ACCOUNTS reassigns CSM and writes one audit entry each", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const res = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_PATCH_ACCOUNTS", ids: ["a1", "a2"], patch: { csm: "Dana" }, by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    const s = window.__store.getState();
    return s.accounts.map(a => ({ id: a.id, csm: a.csm, audit: (a.audit || []).map(e => [e.field, e.from, e.to, e.source]) }));
  });
  assert(res.every(a => a.csm === "Dana"), "csm not reassigned on both");
  assert(res.every(a => a.audit.length === 1), "expected exactly one audit entry per account");
  assert(res[0].audit[0][0] === "csm" && res[0].audit[0][1] === "Priya" && res[0].audit[0][2] === "Dana", "audit from/to wrong");
  assert(res[0].audit[0][3] === "bulk", "audit source should be 'bulk'");
  await browser.close();
});

test("BULK_PATCH_ACCOUNTS writes no audit entry when the value is unchanged", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const audits = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_PATCH_ACCOUNTS", ids: ["a1"], patch: { csm: "Priya" }, by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    return (window.__store.getState().accounts.find(a => a.id === "a1").audit || []).length;
  });
  assert(audits === 0, `expected no audit entry for a no-op change, got ${audits}`);
  await browser.close();
});

test("BULK_PATCH_ACCOUNTS ignores ids that do not exist", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const n = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_PATCH_ACCOUNTS", ids: ["a1", "nope"], patch: { tier: "Enterprise" }, by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().accounts.length;
  });
  assert(n === 2, `account count changed, got ${n}`);
  await browser.close();
});

test("BULK_ADD_TASKS appends one task per account", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const tasks = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_ADD_TASKS", items: [
      { id: "bt1", accountId: "a1", title: "Check in", due: "2026-09-01", owner: "Dana", status: "Open" },
      { id: "bt2", accountId: "a2", title: "Check in", due: "2026-09-01", owner: "Dana", status: "Open" },
    ] });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().tasks.map(t => t.id);
  });
  assert(tasks.length === 2 && tasks.includes("bt1") && tasks.includes("bt2"), `tasks not appended: ${JSON.stringify(tasks)}`);
  await browser.close();
});

const P = seedAccount({ id: "p1", name: "Parent" });
const S = seedAccount({ id: "s1", name: "Sub", parentId: "p1" });
const cascadeSeed = `window.__seedRows = {
  accounts: ${JSON.stringify([P, S])}.map(d => ({ id: d.id, data: d })),
  contacts: [{ id: "c1", data: { id: "c1", accountId: "p1", name: "Ann" } },
    { id: "c2", data: { id: "c2", accountId: "s1", name: "Bea" } }],
  activities: [{ id: "v1", data: { id: "v1", accountId: "p1", date: "2026-07-01", type: "call", summary: "hi" } }],
  tasks: [{ id: "k1", data: { id: "k1", accountId: "p1", title: "T", status: "Open", due: "2026-09-01" } },
    { id: "k2", data: { id: "k2", accountId: "s1", title: "T2", status: "Open", due: "2026-09-02" } }],
  opportunities: [{ id: "o1", data: { id: "o1", accountId: "p1", stage: "Open", amount: 10 } }],
  team: [], settings: [] };`;

test("BULK_CHURN churns every account with a shared reason and an audit entry", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const res = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_CHURN", ids: ["a1", "a2"], reason: "Price", note: "batch", date: "2026-08-12", by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().accounts.map(a => ({
      status: a.contractStatus, reason: a.churn && a.churn.reason, date: a.churn && a.churn.date,
      audit: (a.audit || []).map(e => [e.field, e.to, e.source]) }));
  });
  assert(res.every(a => a.status === "Churned"), "not all churned");
  assert(res.every(a => a.reason === "Price"), "shared reason not written");
  assert(res.every(a => a.date === "2026-08-12"), "churn date wrong");
  assert(res.every(a => a.audit.length === 1 && a.audit[0][0] === "contractStatus" && a.audit[0][1] === "Churned"), "audit entry missing");
  await browser.close();
});

test("BULK_DELETE removes accounts and cascades to all four collections", async () => {
  const { page, browser } = await launch(cascadeSeed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const after = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_DELETE", ids: ["p1"] });
    await new Promise(r => setTimeout(r, 50));
    const s = window.__store.getState();
    return { accounts: s.accounts.map(a => a.id), subParent: s.accounts.find(a => a.id === "s1").parentId,
      contacts: s.contacts.map(c => c.id), activities: s.activities.length, tasks: s.tasks.map(t => t.id), opps: s.opportunities.length };
  });
  assert(after.accounts.length === 1 && after.accounts[0] === "s1", `expected only the sub to survive, got ${JSON.stringify(after.accounts)}`);
  assert(after.subParent === null, "sub should be orphaned (parentId null)");
  assert(after.activities === 0 && after.opps === 0, "cascade incomplete for p1-only collections");
  assert(after.contacts.length === 1 && after.contacts[0] === "c2", `p1's contact should be gone, s1's should survive: ${JSON.stringify(after.contacts)}`);
  assert(after.tasks.length === 1 && after.tasks[0] === "k2", `p1's task should be gone, s1's should survive: ${JSON.stringify(after.tasks)}`);
  await browser.close();
});

test("RESTORE_SNAPSHOT undoes a bulk delete including cascades and sub parentId", async () => {
  const { page, browser } = await launch(cascadeSeed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const after = await page.evaluate(async () => {
    const snap = window.__snapshotFor(window.__store.getState(), ["p1"]);
    window.__store.dispatch({ type: "BULK_DELETE", ids: ["p1"] });
    await new Promise(r => setTimeout(r, 50));
    window.__store.dispatch({ type: "RESTORE_SNAPSHOT", snapshot: snap });
    await new Promise(r => setTimeout(r, 50));
    const s = window.__store.getState();
    return { accounts: s.accounts.map(a => a.id).sort(), subParent: s.accounts.find(a => a.id === "s1").parentId,
      contacts: s.contacts.map(c => c.id).sort(), activities: s.activities.length, tasks: s.tasks.map(t => t.id).sort(), opps: s.opportunities.length };
  });
  assert(after.accounts.join() === "p1,s1", `accounts not restored: ${JSON.stringify(after.accounts)}`);
  assert(after.subParent === "p1", `sub parentId not restored, got ${after.subParent}`);
  assert(after.activities === 1 && after.opps === 1, "cascaded p1-only rows not restored");
  assert(after.contacts.join() === "c1,c2", `p1's contact not restored (s1's should have survived throughout): ${JSON.stringify(after.contacts)}`);
  assert(after.tasks.join() === "k1,k2", `p1's task not restored (s1's should have survived throughout): ${JSON.stringify(after.tasks)}`);
  await browser.close();
});

test("RESTORE_SNAPSHOT undoes a bulk churn back to Active", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const after = await page.evaluate(async () => {
    const snap = window.__snapshotFor(window.__store.getState(), ["a1", "a2"]);
    window.__store.dispatch({ type: "BULK_CHURN", ids: ["a1", "a2"], reason: "Price", note: "", date: "2026-08-12", by: "Tester" });
    await new Promise(r => setTimeout(r, 50));
    window.__store.dispatch({ type: "RESTORE_SNAPSHOT", snapshot: snap });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().accounts.map(a => ({ s: a.contractStatus, churn: a.churn, audit: (a.audit || []).length }));
  });
  assert(after.every(a => a.s === "Active"), "status not restored");
  assert(after.every(a => !a.churn), "churn entry not cleared");
  assert(after.every(a => a.audit === 0), "audit entries should be rolled back with the snapshot");
  await browser.close();
});

test("select-all covers only the filtered rows", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3"); // Accounts view
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(async () => {
    const setVal = (el, v) => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setVal(document.querySelector('input[placeholder^="Search"]'), "Alpha");
    await new Promise(r => setTimeout(r, 100));
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    return document.querySelector("[data-bulkbar]").textContent;
  });
  assert(res.includes("1 selected"), `expected "1 selected" with a filter applied, got: ${res}`);
  await browser.close();
});

test("selecting a parent does not select its sub-accounts", async () => {
  const { page, browser } = await launch(cascadeSeed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector('[data-select="p1"]');
  const res = await page.evaluate(async () => {
    document.querySelector('[data-select="p1"]').click();
    await new Promise(r => setTimeout(r, 100));
    return { bar: document.querySelector("[data-bulkbar]").textContent,
      subChecked: document.querySelector('[data-select="s1"]').checked };
  });
  assert(res.bar.includes("1 selected"), `expected 1 selected, got: ${res.bar}`);
  assert(res.subChecked === false, "sub-account was implicitly selected");
  await browser.close();
});

test("changing a filter clears the selection", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const gone = await page.evaluate(async () => {
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    const setVal = (el, v) => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setVal(document.querySelector('input[placeholder^="Search"]'), "Alpha");
    await new Promise(r => setTimeout(r, 150));
    return !document.querySelector("[data-bulkbar]");
  });
  assert(gone === true, "selection survived a filter change");
  await browser.close();
});

test("bulk churn requires a reason before it will submit", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(async () => {
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    [...document.querySelectorAll("[data-bulkbar] button")].find(b => b.textContent === "Churn").click();
    await new Promise(r => setTimeout(r, 100));
    const btn = document.querySelector("[data-bulk-confirm]");
    return { disabled: btn.disabled };
  });
  assert(res.disabled === true, "confirm should be disabled until a reason is chosen");
  await browser.close();
});

test("bulk reassign shows an undo toast that restores the prior CSM", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(async () => {
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    [...document.querySelectorAll("[data-bulkbar] button")].find(b => b.textContent === "Reassign CSM").click();
    await new Promise(r => setTimeout(r, 100));
    const sel = document.querySelector("[data-bulkdialog] select");
    const setSel = (el, v) => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setSel(sel, "Dana");
    await new Promise(r => setTimeout(r, 50));
    document.querySelector("[data-bulk-confirm]").click();
    await new Promise(r => setTimeout(r, 150));
    const afterApply = window.__store.getState().accounts.map(a => a.csm);
    document.querySelector("[data-toast-undo]").click();
    await new Promise(r => setTimeout(r, 150));
    const afterUndo = window.__store.getState().accounts.map(a => a.csm);
    return { afterApply, afterUndo };
  });
  assert(res.afterApply.every(c => c === "Dana"), `reassign did not apply: ${JSON.stringify(res.afterApply)}`);
  assert(res.afterUndo.every(c => c === "Priya"), `undo did not restore: ${JSON.stringify(res.afterUndo)}`);
  await browser.close();
});

test("Escape closes the bulk dialog without closing the account view", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  await page.evaluate(async () => {
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    [...document.querySelectorAll("[data-bulkbar] button")].find(b => b.textContent === "Change tier").click();
  });
  await page.waitForSelector("[data-bulkdialog]");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const state = await page.evaluate(() => ({
    dialog: !!document.querySelector("[data-bulkdialog]"),
    stillOnList: !!document.querySelector("[data-select-all]"),
  }));
  assert(state.dialog === false, "dialog did not close on Escape");
  assert(state.stillOnList === true, "Escape leaked past the dialog and changed the view");
  await browser.close();
});

test("a selected account that disappears from data is excluded from a subsequent bulk action", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(async () => {
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    // simulate a teammate's realtime delete of a1 arriving underneath the selection
    window.__store.dispatch({ type: "BULK_DELETE", ids: ["a1"] });
    await new Promise(r => setTimeout(r, 100));
    [...document.querySelectorAll("[data-bulkbar] button")].find(b => b.textContent === "Reassign CSM").click();
    await new Promise(r => setTimeout(r, 100));
    const sel = document.querySelector("[data-bulkdialog] select");
    const setSel = (el, v) => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setSel(sel, "Dana");
    await new Promise(r => setTimeout(r, 50));
    document.querySelector("[data-bulk-confirm]").click();
    await new Promise(r => setTimeout(r, 150));
    const toastText = document.querySelector("[data-toast-undo]")?.closest("div")?.parentElement?.textContent || "";
    return { accounts: window.__store.getState().accounts.map(a => ({ id: a.id, csm: a.csm })), toastText };
  });
  const a2 = res.accounts.find(a => a.id === "a2");
  assert(a2 && a2.csm === "Dana", `surviving account should have been reassigned: ${JSON.stringify(res.accounts)}`);
  assert(res.toastText.includes("1 account"), `toast should report only 1 account affected, got: ${res.toastText}`);
  await browser.close();
});

// The test above deletes a1 BEFORE the dialog opens. Here the delete lands while the
// dialog is already open and mounted -- the harder timing, and the one a teammate's
// ~800ms realtime refetch actually produces.
//
// This uses "Add task to each" deliberately. The reassign path cannot detect a
// missing filter: BULK_PATCH_ACCOUNTS looks each id up and silently skips the ones
// that are gone, so a stale id is a harmless no-op there. BULK_ADD_TASKS instead
// MAPS ids to new rows, so an unfiltered stale id fabricates a task pointing at a
// deleted account -- an orphan that shows up in the Tasks view with a dash for its
// account. That is the observable damage the filter exists to prevent.
//
// Note on what this does and does not prove. It does NOT exercise the liveIds filter
// inside submit(), and CANNOT: submit() reads window.__store.getState(), which an
// effect republishes each render, so it returns the last COMMITTED render's state. A
// dispatch fired in the same tick as the click has not been reduced yet and is
// invisible to it. The guarantee is enforced in the BULK_ADD_TASKS reducer instead,
// which is the only layer that sees authoritative state; this test covers that guard.
//
// For the same reason the toast count is best-effort and is deliberately NOT asserted
// here: the dialog cannot know how many rows a dispatch it just fired actually
// created. The count is correct in every reachable case -- a realtime refetch and a
// user click cannot share a synchronous tick, so in production `ids` has already been
// narrowed by the prune effect before submit() runs.
test("an account deleted while the bulk dialog is open is excluded at dispatch time", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(async () => {
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    [...document.querySelectorAll("[data-bulkbar] button")].find(b => b.textContent === "Add task").click();
    await new Promise(r => setTimeout(r, 100));
    const dialogSawBoth = document.querySelector("[data-bulkdialog] h3").textContent.includes("2 account");
    const input = document.querySelector("[data-bulkdialog] input");
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "Check in");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    // The teammate's realtime delete and the user's click land in the SAME tick, with
    // no await between them -- the worst case for the reducer guard. The dialog's
    // `ids` prop is still [a1, a2] because React has not re-rendered yet, so neither
    // the prune effect nor the updated prop can help, and submit()'s own filter reads
    // pre-delete state. Only the reducer can catch this. Do not insert a wait here --
    // with one, React re-renders, `ids` arrives already narrowed, and the test stops
    // exercising the guard at all.
    window.__store.dispatch({ type: "BULK_DELETE", ids: ["a1"] });
    document.querySelector("[data-bulk-confirm]").click();
    await new Promise(r => setTimeout(r, 150));
    const toastText = document.querySelector("[data-toast-undo]")?.closest("div")?.parentElement?.textContent || "";
    const s = window.__store.getState();
    return { dialogSawBoth, tasks: s.tasks.map(t => ({ accountId: t.accountId, title: t.title })), toastText };
  });
  assert(res.dialogSawBoth, "dialog should have opened with both accounts selected, or the test proves nothing");
  assert(res.tasks.length === 1, `exactly one task should have been created, not one per stale id: ${JSON.stringify(res.tasks)}`);
  assert(res.tasks[0].accountId === "a2", `task should belong to the surviving account: ${JSON.stringify(res.tasks)}`);
  await browser.close();
});

test("applying a bulk action after every selected account vanished warns instead of closing silently", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(async () => {
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    [...document.querySelectorAll("[data-bulkbar] button")].find(b => b.textContent === "Change tier").click();
    await new Promise(r => setTimeout(r, 100));
    // both selected accounts disappear underneath the open dialog
    window.__store.dispatch({ type: "BULK_DELETE", ids: ["a1", "a2"] });
    await new Promise(r => setTimeout(r, 100));
    const auditBefore = window.__store.getState().accounts.length;
    document.querySelector("[data-bulk-confirm]").click();
    await new Promise(r => setTimeout(r, 150));
    const toasts = [...document.querySelectorAll("[data-toast]")];
    return {
      auditBefore,
      dialog: !!document.querySelector("[data-bulkdialog]"),
      toastText: toasts.map(t => t.textContent).join(" | "),
      tones: toasts.map(t => t.getAttribute("data-tone")),
      undo: !!document.querySelector("[data-toast-undo]"),
      accounts: window.__store.getState().accounts.length,
    };
  });
  assert(res.auditBefore === 0, "precondition: both accounts should already be gone");
  assert(res.toastText.includes("no longer available"), `expected an explanatory toast, got: ${res.toastText}`);
  assert(res.tones.includes("error"), `toast should be an error tone, got: ${JSON.stringify(res.tones)}`);
  assert(res.undo === false, "a no-op must not offer an undo");
  assert(res.dialog === false, "dialog should still close");
  assert(res.accounts === 0, "no dispatch should have occurred");
  await browser.close();
});

// Bulk churn used to write no timeline activity, so a bulk-churned account had a gap
// that a single-churned one did not (ChurnForm dispatches ADD_ACTIVITY alongside
// CHURN_ACCOUNT). BULK_CHURN now carries the activities with it.
test("BULK_CHURN writes a churn activity per account, matching single churn", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const acts = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_CHURN", ids: ["a1", "a2"], reason: "Price", note: "batch",
      date: "2026-08-12", by: "Tester",
      activities: ["a1", "a2"].map(id => ({ id: "act-" + id, accountId: id, type: "churn",
        date: "2026-08-12", summary: "Account churned (Price — batch) · by Tester" })) });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().activities;
  });
  assert(acts.length === 2, `expected one churn activity per account, got ${acts.length}`);
  assert(acts.every(a => a.type === "churn"), `activities should be type "churn": ${JSON.stringify(acts)}`);
  assert(acts.every(a => a.date === "2026-08-12"), "activity should use the churn date, not today");
  assert(new Set(acts.map(a => a.accountId)).size === 2, "each account needs its own activity");
  await browser.close();
});

test("BULK_CHURN drops activities for accounts that no longer exist", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  const acts = await page.evaluate(async () => {
    window.__store.dispatch({ type: "BULK_CHURN", ids: ["a1", "ghost"], reason: "Price", note: "",
      date: "2026-08-12", by: "Tester",
      activities: ["a1", "ghost"].map(id => ({ id: "act-" + id, accountId: id, type: "churn",
        date: "2026-08-12", summary: "Account churned" })) });
    await new Promise(r => setTimeout(r, 50));
    return window.__store.getState().activities;
  });
  assert(acts.length === 1 && acts[0].accountId === "a1",
    `a churn activity must not be created for a missing account: ${JSON.stringify(acts)}`);
  await browser.close();
});

// RESTORE_SNAPSHOT merges rather than replaces (it keeps current rows absent from the
// snapshot), so undoing a bulk churn does NOT remove the churn activity on its own --
// the account would go back to Active while still showing "Account churned" on its
// timeline. The undo has to delete those activities explicitly.
test("undoing a bulk churn removes the churn activities it created", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const res = await page.evaluate(async () => {
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 100));
    [...document.querySelectorAll("[data-bulkbar] button")].find(b => b.textContent === "Churn").click();
    await new Promise(r => setTimeout(r, 150));
    const sel = document.querySelector("[data-bulkdialog] select");
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(sel, "Price");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    document.querySelector("[data-bulk-confirm]").click();
    await new Promise(r => setTimeout(r, 200));
    const afterChurn = window.__store.getState().activities.length;
    document.querySelector("[data-toast-undo]").click();
    await new Promise(r => setTimeout(r, 250));
    const s = window.__store.getState();
    return { afterChurn, activities: s.activities.length, statuses: s.accounts.map(a => a.contractStatus) };
  });
  assert(res.afterChurn === 2, `bulk churn should have written 2 activities, got ${res.afterChurn}`);
  assert(res.statuses.every(s => s === "Active"), `undo should restore Active, got ${JSON.stringify(res.statuses)}`);
  assert(res.activities === 0, `undo must remove the churn activities, ${res.activities} left behind`);
  await browser.close();
});

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
