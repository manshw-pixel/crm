import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// Realistic-looking, zero-padded names so a name sort has one deterministic answer and a
// test can assert WHICH rows are on screen, not merely how many.
const NAMES = ["Northwind", "Contoso", "Fabrikam", "Initech", "Umbrella", "Wayne", "Stark", "Acme"];
function makeAccounts(n) {
  return Array.from({ length: n }, (_, i) => seedAccount({
    id: `v${i}`,
    // accountNo drives the DEFAULT sort, so pad it too -- it is a string compare.
    accountNo: `A-${String(i).padStart(4, "0")}`,
    name: `${NAMES[i % NAMES.length]} ${String(i).padStart(4, "0")} Ltd`,
    tier: i % 3 === 0 ? "Enterprise" : i % 3 === 1 ? "Mid" : "SMB",
    csm: i % 2 ? "Priya" : "Dana",
    // arrUSD is NOT a stored field -- the scoring pass derives it -- but seeding it keeps
    // any sum over the fixture honest rather than NaN.
    arr: 1000 + i, arrUSD: 1000 + i, currency: "USD",
  }));
}
const seedOf = accounts => `window.__seedRows = { accounts: ${JSON.stringify(accounts)}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [], profiles: [{ id: "u1", name: "Test User", role: "admin" }] };`;

const BIG = 2000;
const bigSeed = seedOf(makeAccounts(BIG));

// The spacers are <tr> too, so count the real rows by their marker attribute.
const dataRows = page => page.$$eval("tr[data-account-row]", els => els.length);
const rowNames = page => page.$$eval("tr[data-account-row] td:nth-child(3)", els => els.map(e => e.textContent.trim()));
const seq = names => names.map(n => +n.match(/(\d{4})/)[1]);

async function openList(page) {
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length > 0);
  await page.keyboard.press("3"); // the app opens on the dashboard; "3" is the Accounts view
  await page.waitForSelector("[data-select-all]", { timeout: 20000 });
  await page.waitForSelector("tr[data-account-row]", { timeout: 20000 });
}
async function scrollTo(page, top) {
  await page.evaluate(t => { document.querySelector("[data-account-scroll]").scrollTop = t; }, top);
  // one tick for the scroll event, one for React to commit the new slice
  await page.waitForTimeout(150);
}
const geometry = page => page.evaluate(() => {
  const px = sel => parseFloat((document.querySelector(sel) || { style: {} }).style.height) || 0;
  return {
    h: document.querySelector("tr[data-account-row]").getBoundingClientRect().height,
    padTop: px("[data-row-spacer='top']"),
    padBottom: px("[data-row-spacer='bottom']"),
    rendered: document.querySelectorAll("tr[data-account-row]").length,
  };
});

test("windowing keeps the DOM row count bounded at 2000 accounts, at any scroll offset", async () => {
  const { page, browser } = await launch(bigSeed);
  await openList(page);
  const counts = [];
  for (const top of [0, 500, 5000, 20000, 55000, 999999]) {
    await scrollTo(page, top);
    counts.push(await dataRows(page));
  }
  assert(counts.every(c => c > 0), `some offset rendered no rows: ${counts.join(",")}`);
  assert(counts.every(c => c < 100), `row count not bounded: ${counts.join(",")}`);
  await browser.close();
});

test("scrolling reveals the correct rows in the correct order", async () => {
  const { page, browser } = await launch(bigSeed);
  await openList(page);
  await scrollTo(page, 0);
  const top = seq(await rowNames(page));
  assert(top[0] === 0, `first row should be account 0000, got ${top[0]}`);
  assert(top.every((v, i) => i === 0 || v === top[i - 1] + 1), `slice not contiguous: ${top.slice(0, 12).join(",")}`);

  // Scroll deep and assert the rows we get back are the ones that belong at that offset,
  // computed from the row height the page actually rendered with.
  const { h } = await geometry(page);
  await scrollTo(page, Math.round(h * 900));
  const deep = seq(await rowNames(page));
  assert(deep.every((v, i) => i === 0 || v === deep[i - 1] + 1), `deep slice not contiguous: ${deep.slice(0, 12).join(",")}`);
  assert(deep[0] <= 900 && deep[deep.length - 1] >= 900,
    `row 900 should be inside the rendered slice, got ${deep[0]}..${deep[deep.length - 1]}`);

  // and the very end of the list is reachable
  await scrollTo(page, 999999);
  const end = seq(await rowNames(page));
  assert(end[end.length - 1] === BIG - 1, `last row should be ${BIG - 1}, got ${end[end.length - 1]}`);
  await browser.close();
});

test("sub-accounts still render directly under their parent when windowed", async () => {
  const accts = makeAccounts(BIG);
  // give account 0005 two subs; they must appear immediately after it, in sorted order
  accts.push(seedAccount({ id: "sub-a", accountNo: "Z-1", name: "Zeta Sub A", parentId: "v5", arr: 10, arrUSD: 10, currency: "USD" }));
  accts.push(seedAccount({ id: "sub-b", accountNo: "Z-2", name: "Zeta Sub B", parentId: "v5", arr: 20, arrUSD: 20, currency: "USD" }));
  const { page, browser } = await launch(seedOf(accts));
  await openList(page);
  await scrollTo(page, 0);
  const names = await rowNames(page);
  const p = names.findIndex(n => n.includes("0005"));
  assert(p >= 0, `parent 0005 not in the first slice: ${names.slice(0, 8).join(" | ")}`);
  assert(names[p + 1].includes("Zeta Sub A"), `expected sub A under parent, got ${names[p + 1]}`);
  assert(names[p + 2].includes("Zeta Sub B"), `expected sub B under parent, got ${names[p + 2]}`);
  await browser.close();
});

test("select-all selects every filtered row, not just the visible slice", async () => {
  const { page, browser } = await launch(bigSeed);
  await openList(page);
  await page.click("[data-select-all]");
  await page.waitForSelector("[data-bulkbar]", { timeout: 20000 });
  const label = (await page.textContent('[data-live="selection"]')).trim();
  assert(label === `${BIG} selected`, `expected "${BIG} selected", got "${label}"`);
  // and the DOM is still windowed while all 2000 are selected
  const n = await dataRows(page);
  assert(n < 100, `select-all rendered the whole list (${n} rows)`);
  await browser.close();
});

test("select-all covers the whole FILTERED set, not the whole book", async () => {
  const { page, browser } = await launch(bigSeed);
  await openList(page);
  await page.selectOption('select[aria-label="Filter by tier"]', "Enterprise");
  await page.waitForTimeout(250);
  const expected = Array.from({ length: BIG }, (_, i) => i).filter(i => i % 3 === 0).length; // 667
  await page.click("[data-select-all]");
  await page.waitForSelector("[data-bulkbar]", { timeout: 20000 });
  const label = (await page.textContent('[data-live="selection"]')).trim();
  assert(label === `${expected} selected`, `expected "${expected} selected", got "${label}"`);
  const names = await rowNames(page);
  assert(names.length > 0 && names.length < 100, `filtered list not windowed: ${names.length} rows`);
  await browser.close();
});

test("sorting is correct with windowing on", async () => {
  const { page, browser } = await launch(bigSeed);
  await openList(page);
  await page.click('th:has-text("Account")');
  await page.waitForTimeout(300);
  await scrollTo(page, 0);
  let names = await rowNames(page);
  assert(names[0].startsWith("Acme"), `name-ascending should start with Acme, got ${names[0]}`);
  assert(names.every((n, i) => i === 0 || n >= names[i - 1]), "name ascending order broken");
  await page.click('th:has-text("Account")');
  await page.waitForTimeout(300);
  await scrollTo(page, 0);
  names = await rowNames(page);
  assert(names[0].startsWith("Wayne"), `name-descending should start with Wayne, got ${names[0]}`);
  assert(names.every((n, i) => i === 0 || n <= names[i - 1]), "name descending order broken");
  await browser.close();
});

test("search filtering is correct with windowing on", async () => {
  const { page, browser } = await launch(bigSeed);
  await openList(page);
  await page.fill('input[placeholder^="Search"]', "Northwind");
  await page.waitForTimeout(350);
  await page.click("[data-select-all]");
  await page.waitForSelector("[data-bulkbar]", { timeout: 20000 });
  const label = (await page.textContent('[data-live="selection"]')).trim();
  assert(label === "250 selected", `expected 250 Northwind accounts, got "${label}"`);
  const names = await rowNames(page);
  assert(names.length > 0 && names.every(n => n.startsWith("Northwind")), "a non-matching row is rendered");
  await browser.close();
});

test("at 100 rows or fewer windowing is off and every row renders", async () => {
  const { page, browser } = await launch(seedOf(makeAccounts(100)));
  await openList(page);
  const n = await dataRows(page);
  assert(n === 100, `expected all 100 rows rendered, got ${n}`);
  const spacers = await page.$$eval("tr[data-row-spacer]", els => els.length);
  assert(spacers === 0, `a small list should render no spacer rows, got ${spacers}`);
  await browser.close();
});

test("windowing engages just above the 100-row threshold", async () => {
  const { page, browser } = await launch(seedOf(makeAccounts(101)));
  await openList(page);
  const n = await dataRows(page);
  assert(n < 101, `101 rows should be windowed, got ${n} rendered`);
  await browser.close();
});

test("row height is re-measured after a viewport resize", async () => {
  const { page, browser } = await launch(bigSeed);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openList(page);
  await scrollTo(page, 0);
  const before = await geometry(page);

  // Change what a row actually measures, then resize -- the component must re-measure a
  // real row rather than trust whatever it learned on mount. A hardcoded constant, or a
  // height cached once, fails from here down.
  await page.addStyleTag({ content: "tr[data-account-row] td { padding-top: 12px; padding-bottom: 12px; }" });
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(500);
  const after = await geometry(page);

  assert(after.h > before.h + 5, `row height should have grown, was ${before.h} now ${after.h}`);
  // Total virtual height must equal the real row height times the full row count.
  const virtual = after.padTop + after.padBottom + after.rendered * after.h;
  assert(Math.abs(virtual - BIG * after.h) < after.h * 2,
    `virtual height ${Math.round(virtual)} does not match ${BIG} rows of ${after.h}px (${Math.round(BIG * after.h)})`);

  // and after re-measuring, scrolling still lands on the right rows
  await scrollTo(page, Math.round(after.h * 500));
  const idx = seq(await rowNames(page));
  assert(idx[0] <= 500 && idx[idx.length - 1] >= 500,
    `after resize, row 500 should be on screen, got ${idx[0]}..${idx[idx.length - 1]}`);
  await browser.close();
});

test("the account name cell stays on one line so rows keep a uniform height", async () => {
  const { page, browser } = await launch(bigSeed);
  await page.setViewportSize({ width: 800, height: 900 });
  await openList(page);
  await scrollTo(page, 0);
  const heights = await page.$$eval("tr[data-account-row]", els => els.map(e => e.getBoundingClientRect().height));
  assert(heights.every(h => Math.abs(h - heights[0]) < 0.6),
    `rows are not uniform height at a narrow viewport: ${[...new Set(heights.map(Math.round))].join(",")}`);
  await browser.close();
});

test("sorting 2000 accounts is far faster than the pre-windowing baseline", async () => {
  const { page, browser } = await launch(bigSeed);
  await openList(page);
  const ms = await page.evaluate(async () => {
    const th = [...document.querySelectorAll("th")].find(t => t.textContent.trim().startsWith("ARR"));
    const t0 = performance.now();
    th.click();
    // wait for React to commit the re-sorted slice
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t0;
  });
  // Baseline before windowing was ~850ms at 2000 rows.
  assert(ms < 300, `sort at 2000 rows took ${Math.round(ms)}ms, expected well under the ~850ms baseline`);
  await browser.close();
});

test("the sticky header and aria-sort survive windowing", async () => {
  const { page, browser } = await launch(bigSeed);
  await openList(page);
  const sorted = await page.$$eval("th[aria-sort]", els => els.map(e => e.getAttribute("aria-sort")));
  assert(sorted.includes("ascending"), `expected an ascending header, got ${sorted.join(",")}`);
  assert(sorted.filter(s => s !== "none").length === 1, "exactly one header should carry a sort direction");
  const sticky = await page.$eval("thead", e => getComputedStyle(e).position);
  assert(sticky === "sticky", `thead should stay sticky, got ${sticky}`);
  await scrollTo(page, 4000);
  const stillThere = await page.$$eval("thead th", els => els.length);
  assert(stillThere > 5, "header disappeared after scrolling");
  await browser.close();
});
