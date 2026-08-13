import { test, assert } from "./framework.mjs";
import { launchPersistent, seedAccount } from "./harness.mjs";

// These cover the one gap the rest of the suite cannot: the default mock discards every
// write, so nothing proved persist() actually sends the right upserts and deletes. Here
// the store is real and the page is genuinely reloaded from what was written.
//
// Scope: this models the app's CONTRACT with Supabase (which rows it writes, which it
// deletes, what a fresh load then sees). It does not model Supabase -- RLS policies,
// column types and network failures still require the real backend.

const P = seedAccount({ id: "p1", name: "Parent Co", csm: "Priya" });
const S = seedAccount({ id: "s1", name: "Sub Co", parentId: "p1", csm: "Priya" });
const O = seedAccount({ id: "o1", name: "Other Co", csm: "Dana" });
const PROFILES = [{ id: "u1", name: "Test User", role: "admin" }, { id: "u2", name: "Dana", role: "csm" }];
const seed = `window.__seedRows = {
  accounts: ${JSON.stringify([P, S, O])}.map(d => ({ id: d.id, data: d })),
  contacts: [{ id: "c1", data: { id: "c1", accountId: "p1", name: "Ann" } },
             { id: "c2", data: { id: "c2", accountId: "s1", name: "Bea" } },
             { id: "c3", data: { id: "c3", accountId: "o1", name: "Cy" } }],
  activities: [{ id: "v1", data: { id: "v1", accountId: "p1", date: "2026-07-01", type: "call", summary: "kickoff" } }],
  tasks: [{ id: "k1", data: { id: "k1", accountId: "p1", title: "Renewal prep", status: "Open", due: "2026-09-01" } },
          { id: "k2", data: { id: "k2", accountId: "o1", title: "Other task", status: "Open", due: "2026-09-02" } }],
  opportunities: [{ id: "q1", data: { id: "q1", accountId: "p1", stage: "Open", amount: 5000 } }],
  team: [], settings: [], profiles: ${JSON.stringify(PROFILES)} };`;

test("SMOKE: a bulk delete persists, and Undo restores every collection across a reload", async () => {
  const { page, browser, reload } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 3);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");

  // select the parent and the unrelated account, delete both
  await page.evaluate(async () => {
    const rows = [...document.querySelectorAll("tbody tr")];
    for (const r of rows) {
      const cb = r.querySelector('input[type="checkbox"]');
      if (cb && (r.textContent.includes("Parent Co") || r.textContent.includes("Other Co"))) {
        cb.click(); await new Promise(x => setTimeout(x, 40));
      }
    }
    [...document.querySelectorAll("[data-bulkbar] button")].find(b => b.textContent === "Delete").click();
    await new Promise(r => setTimeout(r, 150));
    const input = document.querySelector("[data-bulkdialog] input");
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "DELETE");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    document.querySelector("[data-bulk-confirm]").click();
    await new Promise(r => setTimeout(r, 250));
  });

  const afterDelete = await page.evaluate(() => {
    const s = window.__store.getState();
    return { accounts: s.accounts.map(a => a.id).sort(), db: Object.fromEntries(Object.entries(window.__dump()).map(([t, r]) => [t, r.length])) };
  });
  assert(afterDelete.accounts.join() === "s1", `only the orphaned sub should remain, got ${JSON.stringify(afterDelete.accounts)}`);
  assert(afterDelete.db.accounts === 1, `the delete should have reached the store, ${afterDelete.db.accounts} accounts left`);

  // undo within the toast window
  await page.evaluate(async () => {
    document.querySelector("[data-toast-undo]").click();
    await new Promise(r => setTimeout(r, 400));
  });

  // the real check: reload from what was actually written
  await reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length > 0, { timeout: 15000 });
  const after = await page.evaluate(() => {
    const s = window.__store.getState();
    return {
      accounts: s.accounts.map(a => a.id).sort(),
      subParent: (s.accounts.find(a => a.id === "s1") || {}).parentId,
      contacts: s.contacts.map(c => c.id).sort(),
      activities: s.activities.map(v => v.id).sort(),
      tasks: s.tasks.map(t => t.id).sort(),
      opps: s.opportunities.map(o => o.id).sort(),
      statuses: s.accounts.map(a => a.contractStatus),
    };
  });
  assert(after.accounts.join() === "o1,p1,s1", `all three accounts should be back after reload, got ${JSON.stringify(after.accounts)}`);
  assert(after.subParent === "p1", `the sub's parentId must be restored, got ${JSON.stringify(after.subParent)}`);
  assert(after.contacts.join() === "c1,c2,c3", `contacts not fully restored: ${JSON.stringify(after.contacts)}`);
  assert(after.activities.join() === "v1", `activities not restored: ${JSON.stringify(after.activities)}`);
  assert(after.tasks.join() === "k1,k2", `tasks not restored: ${JSON.stringify(after.tasks)}`);
  assert(after.opps.join() === "q1", `opportunities not restored: ${JSON.stringify(after.opps)}`);
  assert(after.statuses.every(s => s === "Active"), `accounts should be Active, got ${JSON.stringify(after.statuses)}`);
  await browser.close();
});

test("SMOKE: a bulk churn and its undo both survive a reload", async () => {
  const { page, browser, reload } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 3);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  await page.evaluate(async () => {
    document.querySelector("[data-select-all]").click();
    await new Promise(r => setTimeout(r, 120));
    [...document.querySelectorAll("[data-bulkbar] button")].find(b => b.textContent === "Churn").click();
    await new Promise(r => setTimeout(r, 150));
    const sel = document.querySelector("[data-bulkdialog] select");
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(sel, "Price");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    document.querySelector("[data-bulk-confirm]").click();
    await new Promise(r => setTimeout(r, 250));
  });
  await reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 3);
  const churned = await page.evaluate(() => {
    const s = window.__store.getState();
    return { statuses: s.accounts.map(a => a.contractStatus), acts: s.activities.filter(v => v.type === "churn").length };
  });
  assert(churned.statuses.every(s => s === "Churned"), `churn should persist, got ${JSON.stringify(churned.statuses)}`);
  assert(churned.acts === 3, `each churned account needs a persisted timeline activity, got ${churned.acts}`);
  await browser.close();
});

test("SMOKE: saved segments persist across a reload", async () => {
  const { page, browser, reload } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 3);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-save-segment]");
  await page.evaluate(async () => {
    window.prompt = () => "Dana book";
    const box = document.querySelector('input[placeholder^="Search"]');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(box, "Other");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    document.querySelector("[data-save-segment]").click();
    await new Promise(r => setTimeout(r, 200));
  });
  await reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 3);
  const segs = await page.evaluate(() => window.__store.getState().settings.segments);
  assert(segs.length === 1 && segs[0].name === "Dana book", `segment did not survive reload: ${JSON.stringify(segs)}`);
  assert(segs[0].filter.q === "Other", `segment filter not persisted: ${JSON.stringify(segs[0].filter)}`);
  await browser.close();
});

// Guards against the branch having broken ordinary single-account flows, which is where
// a bulk/undo refactor is most likely to do collateral damage.
test("SMOKE: pre-existing single-account flows still work and persist", async () => {
  const { page, browser, reload } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 3);
  await page.evaluate(async () => {
    window.__store.dispatch({ type: "EDIT_ACCOUNT", id: "o1", patch: { tier: "Enterprise" }, by: "Tester" });
    await new Promise(r => setTimeout(r, 80));
    window.__store.dispatch({ type: "ADD_TASK", item: { id: "nt1", accountId: "o1", title: "Fresh task", status: "Open", due: "2026-10-01" } });
    await new Promise(r => setTimeout(r, 80));
    window.__store.dispatch({ type: "DELETE_ACCOUNT", id: "o1" });
    await new Promise(r => setTimeout(r, 150));
  });
  await reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length > 0);
  const s = await page.evaluate(() => {
    const st = window.__store.getState();
    return { accounts: st.accounts.map(a => a.id).sort(), tasks: st.tasks.map(t => t.id).sort(), contacts: st.contacts.map(c => c.id).sort() };
  });
  assert(!s.accounts.includes("o1"), `single delete should persist, got ${JSON.stringify(s.accounts)}`);
  assert(!s.tasks.includes("nt1") && !s.tasks.includes("k2"), `single delete must cascade its tasks: ${JSON.stringify(s.tasks)}`);
  assert(!s.contacts.includes("c3"), `single delete must cascade its contacts: ${JSON.stringify(s.contacts)}`);
  assert(s.accounts.join() === "p1,s1", `unrelated accounts must survive, got ${JSON.stringify(s.accounts)}`);
  await browser.close();
});

test("SMOKE: undoing a single-account delete survives a reload", async () => {
  const { page, browser, reload } = await launchPersistent(seed);
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 3);
  await page.keyboard.press("3");
  await page.waitForSelector("[data-select-all]");
  const mid = await page.evaluate(async () => {
    window.confirm = () => true;
    const row = [...document.querySelectorAll("tbody tr")].find(r => r.textContent.includes("Other Co"));
    if (!row) return { err: "Other Co row not found" };
    row.click();
    await new Promise(r => setTimeout(r, 250));
    const del = [...document.querySelectorAll("button")].find(b => b.textContent === "Delete account");
    if (!del) return { err: "no delete button" };
    del.click();
    await new Promise(r => setTimeout(r, 250));
    const gone = !window.__store.getState().accounts.some(a => a.id === "o1");
    const undo = document.querySelector("[data-toast-undo]");
    if (!undo) return { err: "no undo toast", gone };
    undo.click();
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
