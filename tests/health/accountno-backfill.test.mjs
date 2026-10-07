import { test, assert } from "./framework.mjs";
import { launch, launchPersistent, seedAccount } from "./harness.mjs";

// fetchAll gives legacy accounts an account #. It used to write the WHOLE row with a raw
// upsert -- outside the write queue (no retry) and able to overwrite a teammate's
// concurrent edit with this client's stale copy. It must send only {accountNo} via merge_row.
const legacy = { ...seedAccount({ id: "L1", name: "Legacy Co" }) }; delete legacy.accountNo;
const numbered = seedAccount({ id: "N1", name: "Numbered Co", accountNo: 7 });
const seed = pre => `${pre || ""}window.__seedRows = { accounts: ${JSON.stringify([numbered, legacy].map(d => ({ id: d.id, data: d })))}, contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
const backfills = page => page.evaluate(() => (window.__rpcCalls || [])
  .filter(c => c.fn === "merge_row" && c.args.tbl === "accounts" && c.args.row_id === "L1" && "accountNo" in (c.args.patch || {})).map(c => c.args.patch));

test("account # backfill sends only {accountNo} through the write queue", async () => {
  const { page, browser } = await launch(seed());
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
    await page.waitForFunction(() => (window.__rpcCalls || []).some(c => c.fn === "merge_row" && c.args.row_id === "L1" && "accountNo" in (c.args.patch || {})), null, { timeout: 5000 });
    const p = await backfills(page);
    assert(p.length === 1 && JSON.stringify(p[0]) === '{"accountNo":8}', "expected one patch {accountNo:8}, got " + JSON.stringify(p));
    const a = await page.evaluate(() => window.__store.getState().accounts.find(x => x.id === "L1"));
    assert(a.accountNo === 8, "local state should carry the new number: " + a.accountNo);
  } finally { await browser.close(); }
});

test("a failing backfill is retried, then given up -- the refetch does not re-queue it forever", async () => {
  // launchPersistent: only its mock implements __rpcFailures (launch()'s rpc always succeeds)
  const { page, browser } = await launchPersistent(seed("window.__rpcFailures = 1000;"));
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 2);
    // 1 try + 3 retries (0.5s + 2s + 8s backoff), then give-up -> refetch. Wait past a second cycle.
    await page.waitForTimeout(14000);
    const n = (await backfills(page)).length;
    assert(n === 4, `expected exactly 4 attempts (no re-queue loop after the refetch), got ${n}`);
  } finally { await browser.close(); }
});
