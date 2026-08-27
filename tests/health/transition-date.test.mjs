// The sales -> AM handoff date on an account: it reaches the detail header, it degrades
// honestly when unset, and it round-trips through the edit form into the store.
import { launch, seedAccount } from "./harness.mjs";
import { test, assert } from "./framework.mjs";

// seedAccount alone leaves the app with no signed-in user, so nothing renders past the
// auth gate -- anything asserting on RENDERED output needs the profiles row too.
const seedOf = accounts => `window.__seedRows = { accounts: ${JSON.stringify(accounts)}.map(d => ({ id: d.id, data: d })),`
  + ` contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [],`
  + ` profiles: [{ id: "u1", name: "Test User", role: "admin" }] };`;

const openDetail = async (page, name) => {
  await page.click('button[title="Accounts"]');
  await page.getByText(name).first().click();
  await page.waitForSelector("[data-transition-pill]");
};

const pillText = page => page.textContent("[data-transition-pill]");

test("the account detail header shows the sales-to-AM transition date when set", async () => {
  const acct = seedAccount({ id: "t1", name: "Handoff Co", transitionDate: "2025-06-15" });
  const { page, browser } = await launch(seedOf([acct]));
  await openDetail(page, "Handoff Co");
  const txt = await pillText(page);
  assert(/Sales\s*→\s*AM/.test(txt), `expected a sales-to-AM label, got ${JSON.stringify(txt)}`);
  assert(/Jun 15, 2025/.test(txt), `expected the formatted transition date, got ${JSON.stringify(txt)}`);
  await browser.close();
});

test("an account with no transition date says so rather than rendering an invalid date", async () => {
  const acct = seedAccount({ id: "t1", name: "Nodate Co" });
  const { page, browser } = await launch(seedOf([acct]));
  await openDetail(page, "Nodate Co");
  const txt = await pillText(page);
  assert(/not set/i.test(txt), `expected a "not set" marker, got ${JSON.stringify(txt)}`);
  // The bug this guards: fmtDate(undefined) yields "Invalid Date", which looks like data.
  assert(!/Invalid/i.test(txt), `unset date leaked an Invalid Date: ${JSON.stringify(txt)}`);
  await browser.close();
});

test("the edit form saves a transition date onto the account", async () => {
  const acct = seedAccount({ id: "t1", name: "Nodate Co" });
  const { page, browser } = await launch(seedOf([acct]));
  await openDetail(page, "Nodate Co");
  await page.getByRole("button", { name: "✎ Edit account" }).first().click();
  await page.fill('input[data-field="transitionDate"]', "2026-03-02");
  await page.getByRole("button", { name: "Save changes" }).first().click();
  await page.waitForFunction(() =>
    /Mar 2, 2026/.test(document.querySelector("[data-transition-pill]")?.textContent || ""));
  assert(/Mar 2, 2026/.test(await pillText(page)), "the saved date should reach the header pill");
  await browser.close();
});

test("clearing the transition date in the form stores null, not an empty string", async () => {
  const acct = seedAccount({ id: "t1", name: "Handoff Co", transitionDate: "2025-06-15" });
  const { page, browser } = await launch(seedOf([acct]));
  await openDetail(page, "Handoff Co");
  await page.getByRole("button", { name: "✎ Edit account" }).first().click();
  await page.fill('input[data-field="transitionDate"]', "");
  await page.getByRole("button", { name: "Save changes" }).first().click();
  await page.waitForFunction(() =>
    /not set/i.test(document.querySelector("[data-transition-pill]")?.textContent || ""));
  const stored = await page.evaluate(() =>
    window.__store.getState().accounts.find(a => a.id === "t1").transitionDate);
  assert(stored === null, `expected null for a cleared date, got ${JSON.stringify(stored)}`);
  await browser.close();
});

/* ---------------------------- CSV round-trip ---------------------------- */
// Bulk backfill is the whole point of the CSV columns: accounts predating the field are
// filled in from a spreadsheet, not one form at a time.
import { seedAccount as acct } from "./harness.mjs";

const csvSeed = accounts => `window.__seedRows = { accounts: ${JSON.stringify(accounts)}.map(d => ({ id: d.id, data: d })),`
  + ` contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

const runImport = (page, csv) => page.evaluate(async text => {
  const file = new File([text], "accounts.csv", { type: "text/csv" });
  const st = window.__store.getState();
  const result = await new Promise(res =>
    window.__health.importAccountsCSV(file, st.accounts, window.__store.dispatch, res, { name: "Tester" }));
  await new Promise(r => setTimeout(r, 80));
  return { result, accounts: window.__store.getState().accounts.map(a => ({ name: a.name, transitionDate: a.transitionDate })) };
}, csv);

test("CSV import backfills a transition date onto an existing account", async () => {
  const a = acct({ id: "a1", name: "Alpha Corp" });
  a.accountNo = 1;
  const { page, browser } = await launch(csvSeed([a]));
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, accounts } = await runImport(page, "accountNo,name,transitionDate\n1,Alpha Corp,2025-06-15\n");
  assert(result.updated === 1, `expected 1 updated, got ${JSON.stringify(result)}`);
  const alpha = accounts.find(x => x.name === "Alpha Corp");
  assert(alpha.transitionDate === "2025-06-15", `expected the imported date, got ${JSON.stringify(alpha)}`);
  await browser.close();
});

test("CSV import ignores an unparseable transition date rather than storing garbage", async () => {
  const a = acct({ id: "a1", name: "Alpha Corp", transitionDate: "2025-06-15" });
  a.accountNo = 1;
  const { page, browser } = await launch(csvSeed([a]));
  await page.waitForFunction(() => window.__store && window.__health);
  const { accounts } = await runImport(page, "accountNo,name,transitionDate\n1,Alpha Corp,not-a-date\n");
  const alpha = accounts.find(x => x.name === "Alpha Corp");
  assert(alpha.transitionDate === "2025-06-15", `a junk cell overwrote a good date: ${JSON.stringify(alpha)}`);
  await browser.close();
});

test("CSV export includes the transition date column", async () => {
  const a = acct({ id: "a1", name: "Alpha Corp", transitionDate: "2025-06-15" });
  const b = acct({ id: "a2", name: "Nodate Co" });
  const { page, browser } = await launch(csvSeed([a, b]));
  await page.waitForFunction(() => window.__store && window.__health);
  const text = await page.evaluate(() =>
    window.__health.accountsCSVText(window.__store.getState().accounts.map(x => ({ ...x, arrUSD: x.arr }))));
  const [header, ...lines] = text.split("\n");
  assert(header.includes("transitionDate"), `no transitionDate column in header: ${header}`);
  const idx = header.split(",").findIndex(h => h.replace(/"/g, "") === "transitionDate");
  const cellAt = name => lines.find(l => l.includes(name)).split(",")[idx].replace(/"/g, "");
  assert(cellAt("Alpha Corp") === "2025-06-15", `wrong exported date: ${cellAt("Alpha Corp")}`);
  // An account with no handoff date must export an empty cell, not "undefined".
  assert(cellAt("Nodate Co") === "", `unset date exported as ${JSON.stringify(cellAt("Nodate Co"))}`);
  await browser.close();
});
