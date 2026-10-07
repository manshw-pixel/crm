import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// CSV import must never destroy a stored value it could not read. It used to: a blank or
// "$120,000" arr cell zeroed ARR, "1,000,000" became 1, and a blank currency/tier/status
// cell reset an INR Enterprise account to USD/Mid/Active (8,000,000 INR -> $8M ARR).
const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const A = seedAccount({ id: "c1", name: "Rupee Co", accountNo: 7, arr: 8000000, currency: "INR", tier: "Enterprise", contractStatus: "Churn risk", licenses: 40 });
const seed = `window.__seedRows = { accounts: ${rows([A])}, contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
async function importText(page, text) {
  return page.evaluate(async t => {
    const file = new File([t], "a.csv", { type: "text/csv" });
    const res = await new Promise(done => window.__health.importAccountsCSV(file, window.__store.getState().accounts, window.__store.dispatch, done, { name: "T" }));
    await new Promise(r => setTimeout(r, 80));
    return { res, a: window.__store.getState().accounts.find(x => x.id === "c1") };
  }, text);
}
const ready = page => page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);

test("blank arr/currency/tier/status/licenses cells leave the account unchanged", async () => {
  const { page, browser } = await launch(seed);
  try {
    await ready(page);
    const { a } = await importText(page, "accountNo,name,arr,currency,tier,contractStatus,licenses\n7,Rupee Co,,,,,\n");
    assert(a.arr === 8000000 && a.currency === "INR" && a.tier === "Enterprise" && a.contractStatus === "Churn risk" && a.licenses === 40,
      "changed: " + JSON.stringify({ arr: a.arr, cur: a.currency, tier: a.tier, st: a.contractStatus, lic: a.licenses }));
    assert(!(a.arrEvents || []).length, "booked an ARR event: " + JSON.stringify(a.arrEvents));
  } finally { await browser.close(); }
});

test("grouped and currency-marked arr is read correctly; garbage is reported, not zeroed", async () => {
  const { page, browser } = await launch(seed);
  try {
    await ready(page);
    const ok = await importText(page, 'accountNo,name,arr\n7,Rupee Co,"₹ 90,00,000"\n');
    assert(ok.a.arr === 9000000, "grouped arr read as " + ok.a.arr); // positive control: a real change lands
    const bad = await importText(page, "accountNo,name,arr,currency\n7,Rupee Co,TBD,EUR\n");
    assert(bad.a.arr === 9000000 && bad.a.currency === "INR", "unreadable cell changed data: " + bad.a.arr + " " + bad.a.currency);
    assert(bad.res.badNumber === 1 && bad.res.badCurrency === 1, "not reported: " + JSON.stringify(bad.res));
  } finally { await browser.close(); }
});
