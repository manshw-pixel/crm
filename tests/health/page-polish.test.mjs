import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const seedOf = (accts, extra = {}) => `window.__seedRows = { accounts: ${JSON.stringify(accts)}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: ${JSON.stringify(extra.tasks || [])}, opportunities: [], team: [], settings: [] };`;
async function open(seed) {
  const r = await launch(seed);
  await r.page.setViewportSize({ width: 1440, height: 900 });
  await r.page.waitForFunction(() => window.__store && window.__store.getState().accounts.length > 0, null, { timeout: 8000 });
  return r;
}
async function openDetail(page, name) {
  await page.click('button[title="Accounts"]');
  await page.getByText(name).first().click();
  await page.waitForSelector("[data-more-actions]", { timeout: 8000 });
}

test("dashboard analytics start collapsed but stay mounted, and open on demand", async () => {
  const { page, browser } = await open(seedOf([seedAccount()]));
  try {
    const toggle = page.locator("[data-analytics-toggle]");
    await toggle.waitFor({ timeout: 8000 });
    assert(await toggle.getAttribute("aria-expanded") === "false", "analytics not collapsed by default");
    assert(await page.$("[data-analytics] [data-am-book-toggle]") !== null, "AM book card unmounted while collapsed");
    assert(!(await page.locator("[data-analytics]").isVisible()), "analytics visible while collapsed");
    await toggle.click();
    assert(await page.locator("[data-analytics]").isVisible(), "analytics did not open");
    assert(/Cohort retention/i.test(await page.locator("[data-analytics]").textContent()), "cohort card not inside analytics");
  } finally { await browser.close(); }
});

test("the task reschedule menu says what it does", async () => {
  const t = { id: "t1", data: { id: "t1", accountId: "t1", title: "Call", due: day(-2), status: "Open", owner: "Test User", priority: "High" } };
  const { page, browser } = await open(seedOf([seedAccount()], { tasks: [t] }));
  try {
    await page.click('button[title="Tasks"]');
    const sel = page.locator('select[aria-label="Reschedule task"]').first();
    await sel.waitFor({ timeout: 8000 });
    const first = await sel.locator("option").first().textContent();
    assert(/Reschedule/.test(first), "first option reads: " + first);
  } finally { await browser.close(); }
});

test("account list filters carry their own labels", async () => {
  const { page, browser } = await open(seedOf([seedAccount()]));
  try {
    await page.click('button[title="Accounts"]');
    await page.waitForSelector('select[aria-label="Filter by tier"]');
    const firsts = await page.$$eval('select[aria-label^="Filter by"]', ss => ss.map(s => s.options[0].textContent));
    for (const w of ["Tier:", "Health:", "CSM:", "Renewal:", "Billing:"])
      assert(firsts.some(f => f.startsWith(w)), `no filter labelled ${w} in ${JSON.stringify(firsts)}`);
    assert(!/renew ≤ days/.test(await rootText(page)), "stray 'renew ≤ days' label still rendered");
  } finally { await browser.close(); }
});

test("the renewals board shows a cue while months sit past the right edge", async () => {
  const accts = Array.from({ length: 10 }, (_, i) => seedAccount({ id: "b" + i, name: "Board Co " + i, renewalDate: day(20 + i * 31) }));
  const { page, browser } = await open(seedOf(accts));
  try {
    await page.click('button[title="Renewals"]');
    await page.waitForSelector("[data-board-more]", { timeout: 8000 });
    await page.$eval("[data-board]", el => { el.scrollLeft = el.scrollWidth; });
    await page.waitForFunction(() => !document.querySelector("[data-board-more]"), null, { timeout: 3000 });
  } finally { await browser.close(); }
});

test("secondary account actions live in a More menu that Escape closes", async () => {
  const { page, browser } = await open(seedOf([seedAccount({ name: "Menu Co", renewalDate: day(20) })]));
  try {
    await openDetail(page, "Menu Co");
    assert(!(await page.getByText("Delete account").isVisible()), "Delete account visible without opening More");
    for (const v of ["+ Log activity", "+ Add task", "✎ Update health", "✓ Complete renewal", "✎ Edit account"])
      assert(await page.getByRole("button", { name: v }).first().isVisible(), v + " not visible");
    await page.click("[data-more-actions]");
    const menu = page.locator("[data-more-menu]");
    assert(await menu.isVisible(), "menu did not open");
    const txt = await menu.textContent();
    for (const v of ["Contact", "Opportunity", "Adjust ARR", "Mark churned", "Delete account"]) assert(txt.includes(v), v + " missing from menu");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("[data-more-menu]"), null, { timeout: 3000 });
    const flagNearTitle = await page.$eval("h2", h => !!h.parentElement.querySelector("[data-flag]"));
    assert(flagNearTitle, "flags not in the title row");
  } finally { await browser.close(); }
});

test("destructive data actions sit in a separate danger zone", async () => {
  const { page, browser } = await open(seedOf([seedAccount()]));
  try {
    await page.click('button[title="Settings"]');
    const dz = page.locator("[data-danger-zone]");
    await dz.waitFor({ timeout: 8000 });
    const t = await dz.textContent();
    assert(t.includes("Load sample data") && t.includes("Clear all data"), "danger zone: " + t);
    assert(!t.includes("Export JSON"), "export should not be in the danger zone");
  } finally { await browser.close(); }
});

test("account detail header is a breadcrumb back to the list", async () => {
  const { page, browser } = await open(seedOf([seedAccount({ name: "Crumb Co" })]));
  try {
    await openDetail(page, "Crumb Co");
    const h1 = await page.textContent("h1");
    assert(/Accounts\s*›\s*Crumb Co/.test(h1), "h1: " + h1);
    await page.click("[data-crumb-accounts]");
    await page.waitForSelector('select[aria-label="Filter by tier"]', { timeout: 5000 });
  } finally { await browser.close(); }
});
