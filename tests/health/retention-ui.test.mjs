// Browser-level checks for the retention columns. The arithmetic itself is covered by
// account-retention.test.mjs; these assert it reaches the screen and stays sortable.
import { launch } from "./harness.mjs";
import { test, assert } from "./framework.mjs";
import { rel, scored } from "./money-fixture.mjs";

// NOT money-fixture's bookSeed: that one seeds no `profiles`, which is fine for tests that
// call window.__health directly but leaves the app with no signed-in user, so the account
// table never renders and every selector times out. Anything asserting on RENDERED rows
// needs the profile row too.
const seedOf = accounts => `window.__seedRows = { accounts: ${JSON.stringify(accounts)}.map(d => ({ id: d.id, data: d })),`
  + ` contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [],`
  + ` profiles: [{ id: "u1", name: "Test User", role: "admin" }] };`;

const BOOK = [
  scored({ id: "grew", name: "Grew Co", arr: 120000, startDate: "2024-01-01",
    arrEvents: [{ id: "e1", date: rel(-100), delta: 20000, kind: "expansion", source: "adjustment" }] }),
  scored({ id: "shrank", name: "Shrank Co", arr: 80000, startDate: "2024-01-01",
    arrEvents: [{ id: "e2", date: rel(-100), delta: -20000, kind: "contraction", source: "adjustment" }] }),
  scored({ id: "fresh", name: "Fresh Co", arr: 60000, startDate: rel(-30) }),
];

const cellsOf = page => page.$$eval("[data-account-row]", rows => rows.map(r => ({
  name: r.querySelector("td:nth-child(3)").innerText.trim(),
  nrr: r.querySelector("[data-nrr]")?.innerText.trim(),
  grr: r.querySelector("[data-grr]")?.innerText.trim(),
  mv: r.querySelector("[data-movement]")?.innerText.trim(),
})));

test("the accounts list shows NRR, GRR and a movement badge per account", async () => {
  const { page, browser } = await launch(seedOf(BOOK));
  await page.keyboard.press("3"); // the app opens on the dashboard; "3" is the Accounts view
  await page.waitForSelector("[data-account-row]");
  const cells = await cellsOf(page);
  const grew = cells.find(c => c.name.includes("Grew"));
  assert(grew, `no row for Grew Co: ${JSON.stringify(cells.map(c => c.name))}`);
  assert(/%/.test(grew.nrr), `expected an NRR percentage, got ${JSON.stringify(grew)}`);
  assert(grew.mv.includes("▲"), `expected an up badge for a grown account, got ${grew.mv}`);
  const shrank = cells.find(c => c.name.includes("Shrank"));
  assert(shrank.mv.includes("▼"), `expected a down badge for a shrunk account, got ${shrank.mv}`);
  await browser.close();
});

test("an account started after the baseline shows a new badge, not a percentage", async () => {
  const { page, browser } = await launch(seedOf(BOOK));
  await page.keyboard.press("3"); // the app opens on the dashboard; "3" is the Accounts view
  await page.waitForSelector("[data-account-row]");
  const cells = await cellsOf(page);
  const fresh = cells.find(c => c.name.includes("Fresh"));
  assert(/new/i.test(fresh.mv), `expected a "new" marker, got ${fresh.mv}`);
  assert(fresh.nrr === "—", `a new account must not show an NRR figure, got ${fresh.nrr}`);
  await browser.close();
});

test("the NRR column sorts the book", async () => {
  const { page, browser } = await launch(seedOf(BOOK));
  await page.keyboard.press("3"); // the app opens on the dashboard; "3" is the Accounts view
  await page.waitForSelector("[data-account-row]");
  await page.click("th[data-sort-key='nrr']");
  await new Promise(r => setTimeout(r, 150));
  // Assert the ORDERING PROPERTY, not a guessed arrangement: read the rendered NRR values
  // and require them to be monotonic. A "new" account renders "—" and sorts below every
  // real figure (its null NRR maps to -1), so it is pinned to the low end rather than
  // being an exception to the ordering.
  const read = () => page.$$eval("[data-account-row]", rows => rows.map(r => ({
    name: r.querySelector("td:nth-child(3)").innerText.trim(),
    nrr: r.querySelector("[data-nrr]").innerText.trim(),
  })));
  const asc = await read();
  assert(asc.length === 3, `expected 3 rows, got ${asc.length}`);
  const num = c => c.nrr === "—" ? -1 : parseInt(c.nrr, 10);
  assert(asc.every((c, i) => i === 0 || num(c) >= num(asc[i - 1])),
    `ascending NRR order broken: ${asc.map(c => `${c.name}=${c.nrr}`).join(" | ")}`);
  assert(asc[asc.length - 1].name.includes("Grew"),
    `the expanded account should sort highest: ${asc.map(c => c.name).join(" | ")}`);

  // clicking the same header again must reverse it
  await page.click("th[data-sort-key='nrr']");
  await new Promise(r => setTimeout(r, 150));
  const desc = await read();
  assert(desc.every((c, i) => i === 0 || num(c) <= num(desc[i - 1])),
    `descending NRR order broken: ${desc.map(c => `${c.name}=${c.nrr}`).join(" | ")}`);
  await browser.close();
});

test("the movement column header names the baseline", async () => {
  const { page, browser } = await launch(seedOf(BOOK));
  await page.keyboard.press("3"); // the app opens on the dashboard; "3" is the Accounts view
  await page.waitForSelector("[data-account-row]");
  const header = await page.$eval("th[data-sort-key='movement']", th => th.innerText.trim());
  // the header cell is styled `uppercase`, so match case-insensitively
  assert(/vs\s+DEC'\d\d/i.test(header), `header should name the baseline, got "${header}"`);
  await browser.close();
});

test("the account detail view shows the full retention arithmetic", async () => {
  const { page, browser } = await launch(seedOf(BOOK));
  await page.keyboard.press("3"); // the app opens on the dashboard; "3" is the Accounts view
  await page.waitForSelector("[data-account-row]");
  await page.click("[data-account-row]:has-text('Grew Co')");
  await page.waitForSelector("[data-retention-block]");
  const b = await page.$eval("[data-retention-block]", el => ({
    baseline: el.querySelector("[data-baseline-arr]").innerText,
    current: el.querySelector("[data-current-arr]").innerText,
    change: el.querySelector("[data-change]").innerText,
    ratio: el.querySelector("[data-ratio]").innerText,
  }));
  // Grew Co: 120000 today, +20000 event inside the window => 100000 at the baseline
  assert(/100/.test(b.baseline), `baseline should show 100000, got ${b.baseline}`);
  assert(/120/.test(b.current), `current should show 120000, got ${b.current}`);
  assert(/\+/.test(b.change) && /20/.test(b.change), `change should show +20000, got ${b.change}`);
  assert(/120\.0%/.test(b.ratio), `ratio should be 120.0%, got ${b.ratio}`);
  await browser.close();
});

test("a new account's detail view explains why there is no comparison", async () => {
  const { page, browser } = await launch(seedOf(BOOK));
  await page.keyboard.press("3"); // the app opens on the dashboard; "3" is the Accounts view
  await page.waitForSelector("[data-account-row]");
  await page.click("[data-account-row]:has-text('Fresh Co')");
  await page.waitForSelector("[data-retention-block]");
  const txt = await page.$eval("[data-retention-block]", el => el.innerText);
  assert(/started after/i.test(txt), `expected an explanation for a new account, got: ${txt}`);
  assert(!/\$/.test(txt), `a new account must not show ARR figures, got: ${txt}`);
  await browser.close();
});
