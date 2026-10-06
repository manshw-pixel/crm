import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const rows = list => JSON.stringify(list.map(d => ({ id: d.id, data: d })));
const seedOf = (accts, x = {}) => `window.__seedRows = { accounts: ${rows(accts)}, contacts: ${rows(x.contacts || [])}, activities: [], tasks: ${rows(x.tasks || [])}, opportunities: [], team: [], settings: [] };`;
async function open(seed) {
  const r = await launch(seed);
  await r.page.setViewportSize({ width: 1440, height: 900 });
  await r.page.waitForFunction(() => window.__store && window.__store.getState().accounts.length > 0, null, { timeout: 8000 });
  return r;
}
const A = seedAccount({ id: "s1", name: "Second Co", renewalDate: day(40) });
const playbookTask = { id: "p1", accountId: "s1", title: "▶ Renewal kickoff call", due: day(-3), status: "Open", owner: "Test User", priority: "High", playbook: true, renewalFor: A.renewalDate };

test("dashboard: trends shrink to a note without data, and overdue shows on Tasks due 7d", async () => {
  const { page, browser } = await open(seedOf([A], { tasks: [playbookTask] }));
  try {
    await page.waitForSelector("[data-trends-note]", { timeout: 8000 });
    assert(!/Trends \(monthly\)/i.test(await rootText(page)), "empty Trends card still rendered");
    const sub = await page.$eval('[data-stat^="Tasks due 7d"]', e => e.textContent);
    // the renewal playbook auto-seeds its own steps for this account, so assert the shape, not a count
    assert(/\d+ overdue · /.test(sub), "Tasks due 7d does not mention overdue: " + sub);
  } finally { await browser.close(); }
});

test("tasks: one source mark with a name, a legend, and an overdue chip", async () => {
  const { page, browser } = await open(seedOf([A], { tasks: [playbookTask] }));
  try {
    await page.click('button[title="Tasks"]');
    const row = page.locator("[data-task-row]").first();
    await row.waitFor({ timeout: 8000 });
    assert(await row.locator('[aria-label="Renewal playbook step"]').count() === 1, "source mark is unnamed");
    const title = await row.locator("[data-task-title]").textContent();
    assert(title === "Renewal kickoff call", "title still carries the glyph: " + JSON.stringify(title));
    assert(await row.locator('[data-days-chip="overdue"]').count() === 1, "no overdue chip on the row");
    assert(await page.$("[data-source-legend]") !== null, "no source legend");
    const stored = await page.evaluate(() => window.__store.getState().tasks[0].title);
    assert(stored === "▶ Renewal kickoff call", "stored title was changed: " + stored);
  } finally { await browser.close(); }
});

test("accounts: flat movement is a muted dash and billing is a pill", async () => {
  const { page, browser } = await open(seedOf([seedAccount({ startDate: "2024-01-01" })]));
  try {
    await page.click('button[title="Accounts"]');
    await page.waitForSelector("[data-movement]");
    const mv = await page.$eval("[data-movement]", e => e.textContent.trim());
    assert(mv === "—", "flat movement reads: " + mv);
    assert(await page.$('[data-billing-pill="pending"]') !== null, "billing is not a pill");
  } finally { await browser.close(); }
});

test("renewals: playbook progress is labelled and an empty outcomes table collapses to a line", async () => {
  const { page, browser } = await open(seedOf([A], { tasks: [playbookTask] }));
  try {
    await page.click('button[title="Renewals"]');
    await page.waitForSelector("[data-playbook-progress]", { timeout: 8000 });
    const t = await page.$eval("[data-playbook-progress]", e => e.textContent);
    assert(/^Playbook \d+\/\d+$/.test(t), "progress reads: " + t); // auto-seeded steps join ours
    assert(await page.$("[data-outcomes-empty]") !== null, "empty outcomes still renders the table");
  } finally { await browser.close(); }
});

test("account detail: one header card, health input bars, bordered contact buttons", async () => {
  const c = { id: "c1", accountId: "s1", name: "Ann", role: "CTO", email: "a@x.example", sentiment: "Neutral" };
  const { page, browser } = await open(seedOf([A], { contacts: [c] }));
  try {
    await page.click('button[title="Accounts"]');
    await page.getByText("Second Co").first().click();
    await page.waitForSelector("[data-header-card]", { timeout: 8000 });
    const inside = await page.$eval("[data-header-card]", el => ({
      tier: /Tier/i.test(el.textContent), pill: !!el.querySelector("[data-transition-pill]"), ret: !!el.querySelector("[data-retention-block]") }));
    assert(inside.tier && inside.pill && inside.ret, "header card is missing parts: " + JSON.stringify(inside));
    assert(await page.locator("[data-input-bar]").count() === 5, "expected 5 health input bars");
    const cls = await page.getAttribute('[data-edit-contact="c1"]', "class");
    assert(/\bnm-btn\b/.test(cls), "contact edit is not a bordered button: " + cls);
  } finally { await browser.close(); }
});

test("settings: a section index, no scope toggle, and readable playbook names", async () => {
  const { page, browser } = await open(seedOf([A]));
  try {
    await page.click('button[title="Settings"]');
    await page.waitForSelector("[data-settings-index]", { timeout: 8000 });
    const targets = await page.$$eval("[data-settings-index] a", as => as.map(a => [a.textContent, !!document.querySelector(a.getAttribute("href"))]));
    assert(targets.length >= 7 && targets.every(t => t[1]), "index links: " + JSON.stringify(targets));
    assert(await page.$("[data-scope-toggle]") === null, "scope toggle shown on Settings");
    const w = await page.$eval('input[title="Days before renewal"]', e => e.getBoundingClientRect().width);
    assert(w < 100, "playbook day box is " + w + "px wide");
  } finally { await browser.close(); }
});
