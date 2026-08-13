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
