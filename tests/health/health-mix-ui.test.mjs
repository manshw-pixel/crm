import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const seedOf = (accts, acts = [], settings = null) => `window.__seedRows = { accounts: ${rows(accts)}, contacts: [], activities: ${rows(acts)}, tasks: [], opportunities: [], team: [], settings: ${settings ? JSON.stringify([{ id: 1, data: settings }]) : "[]"} };`;
async function openDetail(page, name) {
  await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length > 0);
  await page.click('button[title="Accounts"]');
  await page.getByText(name).first().click();
  await page.waitForSelector("[data-more-actions]", { timeout: 8000 });
}

test("Update health saves the Value answers and logs a history point", async () => {
  const A = seedAccount({ id: "v1", name: "Value Co" });
  const { page, browser } = await launch(seedOf([A]));
  try {
    await openDetail(page, "Value Co");
    await page.getByRole("button", { name: "✎ Update health" }).click();
    await page.check('[data-value-check="caseStudy"]');
    await page.check('[data-value-check="roi"]');
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const a = await page.evaluate(async () => { await new Promise(r => setTimeout(r, 50)); return window.__store.getState().accounts[0]; });
    assert(JSON.stringify(a.inputs.value) === JSON.stringify({ caseStudy: true, savings: false, roi: true }), "value: " + JSON.stringify(a.inputs.value));
    assert((a.history || []).length === 1, "no history point logged");
  } finally { await browser.close(); }
});

test("the account page shows a Value bar, and per-type recency only when the mix is on", async () => {
  const A = seedAccount({ id: "v2", name: "Mix Co" });
  const acts = [{ id: "x1", accountId: "v2", type: "QBR", date: day(-101), summary: "q" }];
  const off = await launch(seedOf([A], acts));
  try {
    await openDetail(off.page, "Mix Co");
    assert(await off.page.locator("[data-input-bar]").count() === 6, "expected 6 input bars incl. Value");
    assert(await off.page.$("[data-recency-breakdown]") === null, "breakdown shown while the mix is off");
  } finally { await off.browser.close(); }
  const on = await launch(seedOf([A], acts, { recencyMix: { enabled: true } }));
  try {
    await openDetail(on.page, "Mix Co");
    await on.page.waitForSelector("[data-recency-breakdown]", { timeout: 5000 });
    const qbr = await on.page.textContent('[data-recency-type="QBR"]');
    assert(/QBR/.test(qbr) && /101d ago/.test(qbr), "QBR row: " + qbr);
    assert(/never/.test(await on.page.textContent('[data-recency-type="renewal"]')), "never-happened type not labelled");
  } finally { await on.browser.close(); }
});
