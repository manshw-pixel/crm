import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const seedOf = (accts, extra = {}, pre = "") => `${pre}window.__seedRows = { accounts: ${JSON.stringify(accts)}.map(d => ({ id: d.id, data: d })), contacts: ${JSON.stringify(extra.contacts || [])}, activities: ${JSON.stringify(extra.activities || [])}, tasks: ${JSON.stringify(extra.tasks || [])}, opportunities: [], team: [], settings: [] };`;

test("the bell is an SVG icon named with its unread count", async () => {
  const { page, browser } = await launch(seedOf([seedAccount({ renewalDate: day(10) })]));
  try {
    const bell = page.locator("[data-bell]");
    await bell.waitFor({ timeout: 8000 });
    await page.waitForFunction(() => /1 unread/.test(document.querySelector("[data-bell]").getAttribute("aria-label")), null, { timeout: 5000 });
    assert(await bell.locator("svg").count() === 1, "bell has no svg icon");
    assert(!(await bell.textContent()).includes("🔔"), "bell still renders the emoji");
    assert(await bell.getAttribute("aria-expanded") === "false", "bell lacks aria-expanded");
  } finally { await browser.close(); }
});

test("a slow first load shows a skeleton, never the empty-book copy, then the data", async () => {
  const { page, browser } = await launch(seedOf([seedAccount({ name: "Loaded Co" })], {}, "window.__loadDelay = 1500;"));
  try {
    await page.waitForSelector("[data-skeleton]", { timeout: 5000 });
    const during = await rootText(page);
    assert(!/Fresh start/.test(during) && !/\$0/.test(during), "empty-book copy shown while loading: " + during.slice(0, 200));
    await page.waitForFunction(() => !document.querySelector("[data-skeleton]"), null, { timeout: 8000 });
    assert(/Loaded Co/.test(await rootText(page)), "data did not render after load");
  } finally { await browser.close(); }
});

test("a failed first load still renders the views rather than a skeleton forever", async () => {
  const { page, browser } = await launch(seedOf([seedAccount()], {}, 'window.__loadError = "boom";'));
  try {
    await page.waitForFunction(() => /Fresh start/.test(document.getElementById("root").textContent), null, { timeout: 8000 });
    assert(await page.$("[data-skeleton]") === null, "skeleton still shown after a failed load");
  } finally { await browser.close(); }
});

test("renewal days render as chips banded by urgency", async () => {
  const accts = [seedAccount({ id: "a", name: "Soon Co", renewalDate: day(10) }),
    seedAccount({ id: "b", name: "Mid Co", renewalDate: day(45) }),
    seedAccount({ id: "c", name: "Later Co", renewalDate: day(75) })];
  const { page, browser } = await launch(seedOf(accts));
  try {
    await page.waitForSelector('[data-scroll-list="Renewals due"] [data-days-chip]', { timeout: 8000 });
    const chips = await page.$$eval('[data-scroll-list="Renewals due"] [data-days-chip]', els => els.map(e => [e.textContent, e.getAttribute("data-days-chip")]));
    assert(JSON.stringify(chips) === JSON.stringify([["10d", "urgent"], ["45d", "soon"], ["75d", "later"]]), "chips: " + JSON.stringify(chips));
  } finally { await browser.close(); }
});

test("an overdue renewal reads as overdue in the account list", async () => {
  const { page, browser } = await launch(seedOf([seedAccount({ name: "Late Co", renewalDate: day(-3) })]));
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    await page.click('button[title="Accounts"]');
    await page.waitForSelector("[data-days-chip]", { timeout: 8000 });
    const chip = await page.$eval("[data-days-chip]", e => [e.textContent, e.getAttribute("data-days-chip")]);
    assert(chip[0] === "3d overdue" && chip[1] === "overdue", "overdue chip: " + JSON.stringify(chip));
  } finally { await browser.close(); }
});

// Every icon-only button (no letters or digits in its text) must carry an aria-label.
const unnamed = page => page.$$eval("#root button", bs => bs
  .filter(b => !/[\p{L}\p{N}]/u.test(b.textContent) && !(b.getAttribute("aria-label") || "").trim())
  .map(b => b.outerHTML.slice(0, 120)));

test("icon-only buttons on the dashboard and account page have accessible names", async () => {
  const A = seedAccount({ id: "x1", name: "Icon Co", renewalDate: day(20),
    documents: [{ id: "d1", title: "MSA", name: "msa.pdf", category: "Contract", url: "#", uploadedAt: day(-1) }] });
  const { page, browser } = await launch(seedOf([A], {
    contacts: [{ id: "c1", data: { id: "c1", accountId: "x1", name: "Ann", role: "CTO", email: "a@x.example" } }],
    tasks: [{ id: "t1", data: { id: "t1", accountId: "x1", title: "Call", due: day(2), status: "Open", owner: "Test User", priority: "High" } }],
    activities: [{ id: "v1", data: { id: "v1", accountId: "x1", type: "Call", date: day(-2), note: "hi" } }] }));
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    const dash = await unnamed(page);
    assert(dash.length === 0, "dashboard: " + JSON.stringify(dash));
    await page.click('button[title="Accounts"]');
    await page.getByText("Icon Co").first().click();
    await page.waitForFunction(() => /Contacts \(\d+\)/.test(document.getElementById("root").textContent), null, { timeout: 8000 });
    const acct = await unnamed(page);
    assert(acct.length === 0, "account page: " + JSON.stringify(acct));
  } finally { await browser.close(); }
});
