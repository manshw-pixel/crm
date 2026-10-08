import { test, assert } from "./framework.mjs";
import { launch } from "./harness.mjs";

// The server enforces the account limit; the app refuses first so the user gets a message
// instead of an optimistic write that rolls back. Writes go out as merge_row rpcs, so a
// "new account" write is a merge_row on accounts whose row_id is not one of the seeded ids.
const MSG = "Your plan allows 5 accounts — contact OneVio to raise it.";
const accts = n => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `a${i}`, data: { id: `a${i}`, name: `Acct ${i}`, tier: "Mid", arr: 0, currency: "USD", industry: "Tech", csm: "", startDate: "2025-01-01", renewalDate: `${new Date().getFullYear() + 2}-01-01`, contractStatus: "Active", inputs: { usage: 80, sentiment: 80, tickets: 0, nps: 40 }, history: [], inputsUpdatedAt: "2026-07-01" } })));
const seed = (n, max) => `window.__seedRows = { accounts: ${accts(n)}, contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [],
  orgs: [{ id: "org-a", name: "Acme Corp", max_accounts: ${max === null ? "null" : max} }] };
  window.__seedProfile = { id: "u1", name: "Admin", role: "admin", org_id: "org-a", platform_admin: false };`;
// Account writes are merge_row rpcs (mock records {fn, args:{tbl,row_id,patch}}). One add also
// triggers follow-up writes to the same new row (health band), so count DISTINCT new row ids.
// The seeded rows get accountNo backfill / health-band writes at load, so "edits" are the
// merge_rows that carry a user-visible field (arr or name) on a seeded row.
const writes = page => page.evaluate(() => {
  const acc = (window.__rpcCalls || []).filter(c => c.fn === "merge_row" && c.args.tbl === "accounts");
  const seeded = id => /^a\d+$/.test(id);
  return { newRows: new Set(acc.filter(c => !seeded(c.args.row_id)).map(c => c.args.row_id)).size,
    edits: acc.filter(c => seeded(c.args.row_id) && ("arr" in c.args.patch || "name" in c.args.patch)).length };
});
const ready = (page, n) => page.waitForFunction(k => window.__store && window.__store.getState().accounts.length === k, n);
// ORG_LIMITS loads from an async orgs read after mount; give it time before acting.
const settle = async page => { await page.waitForTimeout(600); await page.click('button[title="Accounts"]', { timeout: 10000 }); };

async function addAccount(page, name) {
  await page.click("text=+ New account", { timeout: 10000 });
  await page.fill("form >> input >> nth=0", name, { timeout: 10000 });
  await page.click("text=Create account", { timeout: 10000 });
}
async function uploadCsv(page, text) {
  await page.setInputFiles('input[type="file"]', { name: "a.csv", mimeType: "text/csv", buffer: Buffer.from(text) }, { timeout: 10000 });
}

test("add-account form is refused at the limit", async () => {
  const { page, browser } = await launch(seed(5, 5));
  try {
    await ready(page, 5); await settle(page);
    await addAccount(page, "Over");
    await page.waitForSelector("[data-limit-error]", { timeout: 15000 });
    assert((await page.textContent("[data-limit-error]")).includes(MSG), "limit message missing");
    await page.waitForTimeout(500);
    assert((await writes(page)).newRows === 0, "a new account was written past the limit");
    assert((await page.evaluate(() => window.__store.getState().accounts.length)) === 5, "store grew past the limit");
  } finally { await browser.close(); }
});

test("control: add-account works one below the limit", async () => {
  const { page, browser } = await launch(seed(4, 5));
  try {
    await ready(page, 4); await settle(page);
    await addAccount(page, "Fits");
    await page.waitForFunction(() => window.__store.getState().accounts.length === 5, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    assert(!(await page.$("[data-limit-error]")), "limit error shown below the limit");
    assert((await writes(page)).newRows === 1, "the new account was not written");
  } finally { await browser.close(); }
});

test("CSV import whose new rows exceed room is refused whole -- updates included", async () => {
  const { page, browser } = await launch(seed(4, 5));
  try {
    await ready(page, 4); await settle(page);
    await uploadCsv(page, "name,arr\nAcct 0,999\nNew One,1\nNew Two,2\n");
    await page.waitForFunction(m => document.querySelector("#root").textContent.includes(m), "Nothing was imported.", { timeout: 15000 });
    const text = await page.textContent("#root");
    assert(text.includes(MSG), "limit message missing from import message");
    assert(text.includes("adds 2 new accounts; there is room for 1. Nothing was imported."), "room sentence missing");
    await page.waitForTimeout(500);
    { const w = await writes(page); assert(w.newRows === 0 && w.edits === 0, "an account write happened despite the refusal: " + JSON.stringify(w)); }
    const s = await page.evaluate(() => window.__store.getState().accounts);
    assert(s.length === 4 && s.find(a => a.name === "Acct 0").arr === 0, "store changed: " + JSON.stringify(s.map(a => [a.name, a.arr])));
  } finally { await browser.close(); }
});

test("control: CSV import that fits is applied, updates and adds together", async () => {
  const { page, browser } = await launch(seed(4, 5));
  try {
    await ready(page, 4); await settle(page);
    await uploadCsv(page, "name,arr\nAcct 0,999\nNew One,1\n");
    await page.waitForFunction(() => window.__store.getState().accounts.length === 5, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const text = await page.textContent("#root");
    assert(!text.includes("Nothing was imported"), "refusal shown for an import that fits");
    assert(text.includes("Imported 1 new") && text.includes("updated 1 existing"), "success message missing");
    const s = await page.evaluate(() => window.__store.getState().accounts);
    assert(s.find(a => a.name === "Acct 0").arr === 999, "update not applied");
    assert((await writes(page)).newRows === 1, "expected exactly one add write");
    assert((await writes(page)).edits === 1, "expected exactly one update write");
  } finally { await browser.close(); }
});

test("Unlimited (max_accounts null) never blocks the form", async () => {
  const { page, browser } = await launch(seed(50, null));
  try {
    await ready(page, 50); await settle(page);
    await addAccount(page, "Plenty");
    await page.waitForFunction(() => window.__store.getState().accounts.length === 51, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    assert(!(await page.$("[data-limit-error]")), "limit error shown when Unlimited");
    assert((await writes(page)).newRows === 1, "the new account was not written");
  } finally { await browser.close(); }
});
