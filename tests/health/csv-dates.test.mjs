import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// CSV imports and the shared-drive folder sync.
// 1. Dates: a CSV re-saved by Excel on an Indian-locale machine is DD-MM-YYYY. new Date() read
//    "05-07-2026" as 7 May and dropped "26-08-2026" entirely -- silently, both ways.
// 2. "Churned" in the contractStatus column was coerced to Active, resurrecting churned accounts.
// 3. The folder card never said what was in the folder, so an already-imported file looked
//    like a file the app could not see.

const seedOf = (accounts, settings = null) => `window.__seedRows = { accounts: ${JSON.stringify(accounts)}.map(d => ({ id: d.id, data: d })),`
  + ` contacts: [], activities: [], tasks: [], opportunities: [], team: [],`
  + ` settings: ${settings ? `[{ id: "1", data: ${JSON.stringify(settings)} }]` : "[]"} };`;

const runImport = (page, csv) => page.evaluate(async text => {
  const file = new File([text], "accounts.csv", { type: "text/csv" });
  const st = window.__store.getState();
  const result = await new Promise(res =>
    window.__health.importAccountsCSV(file, st.accounts, window.__store.dispatch, res, { name: "Tester" }));
  await new Promise(r => setTimeout(r, 80));
  return { result, accounts: window.__store.getState().accounts };
}, csv);

test("CSV dates: day-first, ISO, month-name and invalid cells parse as expected", async () => {
  const { page, browser } = await launch(seedOf([]));
  await page.waitForFunction(() => window.__health?.parseCsvDate);
  const r = await page.evaluate(() => {
    const p = window.__health.parseCsvDate, o = window.__health.csvDateOrder;
    return {
      iso: p("2026-07-05"), dmy: p("05-07-2026", "dmy"), dmy26: p("26-08-2026", "dmy"), mdy: p("07-05-2026", "mdy"),
      slash2: p("5/7/26", "dmy"), word: p("5 Jul 2026"), feb31: p("31-02-2026", "dmy"), junk: p("soon"), empty: p(""),
      oDmy: o(["26-08-2026", "05-07-2026"]), oMdy: o(["08-26-2026"]), oMixed: o(["26-08-2026", "08-26-2026"]), oNone: o(["05-07-2026", ""]),
    };
  });
  const want = { iso: "2026-07-05", dmy: "2026-07-05", dmy26: "2026-08-26", mdy: "2026-07-05", slash2: "2026-07-05",
    word: "2026-07-05", feb31: null, junk: null, empty: "", oDmy: "dmy", oMdy: "mdy", oMixed: null, oNone: "dmy" };
  for (const k of Object.keys(want)) assert(r[k] === want[k], `${k}: expected ${JSON.stringify(want[k])}, got ${JSON.stringify(r[k])}`);
  await browser.close();
});

test("CSV import reads an Excel DD-MM-YYYY file correctly and never resurrects a churned row", async () => {
  const a = seedAccount({ id: "a1", name: "Alpha", arr: 500 }); a.accountNo = 1;
  const g = seedAccount({ id: "a2", name: "Gamma", arr: 3000 }); g.accountNo = 3; // Active here, "Churned" in the file
  const { page, browser } = await launch(seedOf([a, g]));
  await page.waitForFunction(() => window.__store && window.__health);
  const csv = [
    "accountNo,name,tier,arr,currency,startDate,renewalDate,contractStatus,billingCompletedDate",
    "1,Alpha,SMB,1000,USD,05-07-2026,07-05-2027,Active,05-07-2026",
    "2,Beta,Enterprise,5000,USD,26-08-2026,26-08-2027,Active,",
    "3,Gamma,Mid,9999,USD,05-07-2026,08-05-2027,Churned,",
    "4,Delta,Mid,100,USD,31-02-2026,01-03-2027,Active,",
  ].join("\n");
  const { result, accounts } = await runImport(page, csv);
  const by = n => accounts.find(x => x.name === n);
  // day-first proven by the 26-08 cells
  assert(by("Alpha").startDate === "2026-07-05", `Alpha start should be 5 July, got ${by("Alpha").startDate}`);
  assert(by("Alpha").renewalDate === "2027-05-07", `Alpha renewal should be 7 May, got ${by("Alpha").renewalDate}`);
  assert(by("Alpha").billingCompletedDate === "2026-07-05", `Alpha billing date, got ${by("Alpha").billingCompletedDate}`);
  assert(by("Beta")?.startDate === "2026-08-26", `Beta's 26-08 date must not be dropped, got ${by("Beta")?.startDate}`);
  // positive control: the import did apply to Alpha (ARR changed), so Gamma's no-change below means something
  assert(by("Alpha").arr === 1000, "Alpha's ARR should have been updated by the import");
  assert(by("Gamma").contractStatus !== "Churned" && by("Gamma").arr === 3000, "Gamma must be left untouched, got " + JSON.stringify({ s: by("Gamma").contractStatus, arr: by("Gamma").arr }));
  assert(result.churnSkipped?.join() === "Gamma", "Gamma should be reported as skipped for churn: " + JSON.stringify(result));
  assert(result.badDate === 1 && result.badDateRows.join() === "Delta", "31-02 should be reported as unreadable: " + JSON.stringify(result));
  assert(by("Delta") && by("Delta").startDate !== "2026-03-03", "an impossible date must not roll over into March");
  assert(result.ok === 2 && result.updated === 1, "expected 2 new (Beta, Delta) and 1 updated (Alpha): " + JSON.stringify(result));
  await browser.close();
});

test("CSV import refuses a file that mixes DD-MM and MM-DD dates", async () => {
  const a = seedAccount({ id: "a1", name: "Alpha", arr: 500 }); a.accountNo = 1;
  const { page, browser } = await launch(seedOf([a]));
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, accounts } = await runImport(page, "accountNo,name,arr,startDate\n1,Alpha,1000,26-08-2026\n2,Beta,5,08-26-2026\n");
  assert(/mix DD-MM-YYYY and MM-DD-YYYY/.test(result.err || ""), "expected a mixed-format error: " + JSON.stringify(result));
  assert(accounts.length === 1 && accounts[0].arr === 500, "nothing should have been imported");
  await browser.close();
});

test("billing CSV reads DD-MM-YYYY billing dates", async () => {
  const a = seedAccount({ id: "a1", name: "Alpha" }); a.accountNo = 7;
  const { page, browser } = await launch(seedOf([a]));
  await page.waitForFunction(() => window.__store && window.__health);
  const out = await page.evaluate(async () => {
    const st = window.__store.getState();
    const r = window.__health.importBillingCSV("accountNo,name,billingCompletedDate\n7,Alpha,19-08-2026\n", st.accounts, window.__store.dispatch);
    await new Promise(res => setTimeout(res, 80));
    return { r, d: window.__store.getState().accounts[0].billingCompletedDate };
  });
  assert(out.r.updated === 1 && out.d === "2026-08-19", "expected 19 Aug 2026: " + JSON.stringify(out));
  await browser.close();
});

/* ------------------------ folder card: per-file status ------------------------ */
const folderSeed = (accounts, settings) => seedOf(accounts, settings) + `
window.__handle = {
  kind: "directory", name: "Sales Sync",
  async queryPermission() { return "granted"; }, async requestPermission() { return "granted"; },
  async *entries() {
    yield ["old.csv", { kind: "file", getFile: async () => new File(["name\\nOld Co\\n"], "old.csv", { lastModified: 1000 }) }];
    yield ["new.csv", { kind: "file", getFile: async () => new File(["name,startDate\\nNew Co,26-08-2026\\n"], "new.csv", { lastModified: 2000 }) }];
    yield ["cloud.csv", { kind: "file", getFile: async () => { throw new DOMException("The file could not be read.", "NotReadableError"); } }];
    yield ["notes.txt", { kind: "file", getFile: async () => new File(["x"], "notes.txt") }];
    yield ["archive", { kind: "directory" }];
  },
};
window.showDirectoryPicker = async () => window.__handle;
(() => {
  const store = new Map([["sales", window.__handle]]);
  const later = f => setTimeout(f, 0);
  const db = { createObjectStore() {}, transaction() { const tx = { objectStore: () => ({
    put(v, k) { store.set(k, v); later(() => tx.oncomplete && tx.oncomplete()); },
    delete(k) { store.delete(k); later(() => tx.oncomplete && tx.oncomplete()); },
    get(k) { const rq = {}; later(() => { rq.result = store.get(k); rq.onsuccess && rq.onsuccess(); }); return rq; },
  }) }; return tx; } };
  Object.defineProperty(window, "indexedDB", { value: { open() { const r = {}; later(() => { r.result = db; r.onsuccess && r.onsuccess(); }); return r; } } });
})();`;

const fileRow = (page, name) => page.textContent(`[data-files="sales"] [data-file="${name}"]`);

test("folder card lists each CSV with its status, and Sync now imports only the new one", async () => {
  // old.csv at this exact version was imported before (legacy `true` marker)
  const { page, browser } = await launch(folderSeed([], { integrations: { processed: { "old.csv|1000": true }, log: [] } }));
  await page.click('button[title="Settings"]', { timeout: 15000 });
  await page.waitForSelector('[data-files="sales"] [data-file="cloud.csv"]', { timeout: 10000 });
  const names = await page.$$eval('[data-files="sales"] [data-file]', els => els.map(e => e.dataset.file));
  assert(names.join() === "cloud.csv,new.csv,old.csv", "only the CSVs, sorted: " + names.join());
  assert(/imported/.test(await fileRow(page, "old.csv")), "old.csv should show as imported");
  assert(/new — imports on next sync/.test(await fileRow(page, "new.csv")), "new.csv should show as new");
  assert(/can't read/.test(await fileRow(page, "cloud.csv")), "cloud.csv should show as unreadable");
  await page.click('button:has-text("Sync now")');
  await page.waitForFunction(() => /imported [A-Z][a-z]{2} \d/.test(document.querySelector('[data-files="sales"] [data-file="new.csv"]')?.textContent || ""), null, { timeout: 10000 });
  const st = await page.evaluate(() => window.__store.getState().accounts.map(a => ({ name: a.name, startDate: a.startDate })));
  assert(st.length === 1 && st[0].name === "New Co" && st[0].startDate === "2026-08-26", "only new.csv imported, date read day-first: " + JSON.stringify(st));
  const log = await page.textContent("main");
  assert(/cloud\.csv: can't read/.test(log), "the unreadable file should be named in the log");
  await browser.close();
});
