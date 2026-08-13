import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "a1", name: "Alpha Corp", csm: "Priya", tier: "Mid" });
A.accountNo = 1;
const seed = `window.__seedRows = { accounts: ${JSON.stringify([A])}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;

const parse = (page, text) => page.evaluate(t => window.__health.parseCSV(t), text);

test("parseCSV keeps a quoted comma inside one field", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__health);
  const rows = await parse(page, 'name,industry\n"Acme, Inc.",Tech\n');
  assert(rows.length === 2, `expected 2 rows, got ${rows.length}`);
  assert(rows[1][0] === "Acme, Inc.", `quoted comma split the field: ${JSON.stringify(rows[1])}`);
  assert(rows[1][1] === "Tech", `second field wrong: ${JSON.stringify(rows[1])}`);
  await browser.close();
});

test("parseCSV unescapes a doubled quote", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__health);
  const rows = await parse(page, 'name\n"She said ""hi"""\n');
  assert(rows[1][0] === 'She said "hi"', `got ${JSON.stringify(rows[1][0])}`);
  await browser.close();
});

test("parseCSV treats CRLF the same as LF", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__health);
  const lf = await parse(page, "name,tier\nAlpha,Mid\nBeta,SMB\n");
  const crlf = await parse(page, "name,tier\r\nAlpha,Mid\r\nBeta,SMB\r\n");
  assert(JSON.stringify(lf) === JSON.stringify(crlf), `CRLF differs from LF:\n${JSON.stringify(lf)}\n${JSON.stringify(crlf)}`);
  await browser.close();
});

test("parseCSV keeps a newline inside a quoted field", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__health);
  const rows = await parse(page, 'name,note\nAlpha,"line one\nline two"\n');
  assert(rows.length === 2, `a quoted newline split the row: ${JSON.stringify(rows)}`);
  assert(rows[1][1] === "line one\nline two", `got ${JSON.stringify(rows[1][1])}`);
  await browser.close();
});

test("parseCSV drops blank and whitespace-only rows", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__health);
  const rows = await parse(page, "name,tier\n\nAlpha,Mid\n   ,\t\nBeta,SMB\n");
  assert(rows.length === 3, `expected header + 2 data rows, got ${rows.length}: ${JSON.stringify(rows)}`);
  await browser.close();
});

test("parseCSV emits the final row when there is no trailing newline", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__health);
  const rows = await parse(page, "name,tier\nAlpha,Mid");
  assert(rows.length === 2, `final row dropped: ${JSON.stringify(rows)}`);
  assert(rows[1][1] === "Mid", `got ${JSON.stringify(rows[1])}`);
  await browser.close();
});

// importAccountsCSV(file, accounts, dispatch, done, user) reads the File with a
// FileReader, so the helper resolves on the `done` callback rather than returning.
const runImport = (page, csv) => page.evaluate(async text => {
  const file = new File([text], "accounts.csv", { type: "text/csv" });
  const st = window.__store.getState();
  const dispatched = [];
  const spy = a => { dispatched.push({ type: a.type, id: a.id, patch: a.patch, item: a.item, inputs: a.inputs }); window.__store.dispatch(a); };
  const result = await new Promise(res => window.__health.importAccountsCSV(file, st.accounts, spy, res, { name: "Tester" }));
  await new Promise(r => setTimeout(r, 80));
  return { result, dispatched, accounts: window.__store.getState().accounts.map(a => ({ id: a.id, name: a.name, tier: a.tier, accountNo: a.accountNo })) };
}, csv);

test("import rejects a file with no data rows", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, dispatched } = await runImport(page, "name,tier\n");
  assert(!!result.err, `expected an error, got ${JSON.stringify(result)}`);
  assert(result.err.includes("No data rows"), `wrong error: ${result.err}`);
  assert(dispatched.length === 0, `nothing should be dispatched: ${JSON.stringify(dispatched)}`);
  await browser.close();
});

test("import rejects a header without a name column", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, dispatched } = await runImport(page, "tier,arr\nMid,1000\n");
  assert(!!result.err, `expected an error, got ${JSON.stringify(result)}`);
  assert(result.err.includes('"name"'), `error should name the name column: ${result.err}`);
  assert(dispatched.length === 0, `nothing should be dispatched: ${JSON.stringify(dispatched)}`);
  await browser.close();
});

test("import skips rows with an empty name and counts them", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result } = await runImport(page, "name,tier\n,Mid\nBeta Co,SMB\n");
  assert(result.skipped === 1, `expected skipped 1, got ${JSON.stringify(result)}`);
  assert(result.ok === 1, `the named row should still import, got ${JSON.stringify(result)}`);
  await browser.close();
});

test("import creates a new account and counts it as ok", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, dispatched, accounts } = await runImport(page, "name,tier\nBeta Co,SMB\n");
  assert(result.ok === 1 && result.updated === 0, `expected 1 new, got ${JSON.stringify(result)}`);
  assert(dispatched.some(d => d.type === "ADD_ACCOUNT"), `expected ADD_ACCOUNT: ${JSON.stringify(dispatched.map(d => d.type))}`);
  assert(accounts.length === 2, `expected 2 accounts, got ${accounts.length}`);
  await browser.close();
});

test("import matches an existing accountNo and updates instead of duplicating", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, dispatched, accounts } = await runImport(page, "accountNo,name,tier\n1,Renamed Corp,SMB\n");
  assert(result.updated === 1 && result.ok === 0, `expected an update, got ${JSON.stringify(result)}`);
  assert(dispatched.some(d => d.type === "EDIT_ACCOUNT" && d.id === "a1"), `expected EDIT_ACCOUNT on a1: ${JSON.stringify(dispatched)}`);
  assert(accounts.length === 1, `must not create a second account, got ${accounts.length}`);
  await browser.close();
});

// Pinned deliberately: case-insensitive name matching is what makes re-importing an
// export idempotent instead of doubling every account.
test("import matches an existing name case-insensitively", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { result, accounts } = await runImport(page, "name,tier\nalpha corp,SMB\n");
  assert(result.updated === 1 && result.ok === 0, `expected a case-insensitive match, got ${JSON.stringify(result)}`);
  assert(accounts.length === 1, `must not create a duplicate, got ${JSON.stringify(accounts)}`);
  await browser.close();
});

test("import dispatches UPDATE_INPUTS when health columns are present", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { dispatched } = await runImport(page, "accountNo,name,usage,sentiment,tickets,nps\n1,Alpha Corp,55,60,3,20\n");
  const inputs = dispatched.find(d => d.type === "UPDATE_INPUTS");
  assert(inputs, `expected UPDATE_INPUTS: ${JSON.stringify(dispatched.map(d => d.type))}`);
  assert(inputs.inputs.usage === 55 && inputs.inputs.nps === 20, `wrong inputs: ${JSON.stringify(inputs.inputs)}`);
  await browser.close();
});

test("import coerces a non-numeric arr to 0 rather than NaN", async () => {
  const { page, browser } = await launch(seed);
  await page.waitForFunction(() => window.__store && window.__health);
  const { dispatched } = await runImport(page, "name,arr\nGamma Co,not-a-number\n");
  const add = dispatched.find(d => d.type === "ADD_ACCOUNT");
  assert(add, "expected ADD_ACCOUNT");
  assert(add.item.arr === 0, `arr should coerce to 0, got ${JSON.stringify(add.item.arr)}`);
  await browser.close();
});
