import { test, assert } from "./framework.mjs";
import { launch, launchPersistent, seedAccount } from "./harness.mjs";

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

test("bandImpact counts accounts that would drop a band", async () => {
  const { page, browser } = await launch(seedOf([seedAccount()]));
  try {
    await page.waitForFunction(() => window.__health && window.__health.bandImpact);
    const r = await page.evaluate(() => {
      const H = window.__health, base = H.mergeSettings({});
      const accts = [{ id: "g", inputs: { usage: 100, sentiment: 100, tickets: 0, nps: 100 } }, { id: "y", inputs: { usage: 75, sentiment: 75, tickets: 0, nps: 40 } }];
      const acts = [{ accountId: "g", type: "call", date: new Date().toISOString().slice(0, 10) }, { accountId: "y", type: "call", date: new Date().toISOString().slice(0, 10) }];
      const heavy = { ...base, weights: { ...base.weights, value: 300 } };
      return H.bandImpact(accts, acts, base, heavy);
    });
    assert(r.down === 2, "impact: " + JSON.stringify(r));
  } finally { await browser.close(); }
});

test("Settings: sub-option panels edit and persist; day boxes clamp; preview shows", async () => {
  const { page, browser, reload } = await launchPersistent(seedOf([seedAccount()]));
  try {
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
    await page.click('button[title="Settings"]');
    await page.click("[data-recency-panel-toggle]");
    await page.waitForSelector("[data-recency-panel]");
    await page.fill('[data-zero-days="QBR"]', "200");
    await page.fill('[data-full-days="call"]', "-4");
    await page.check("[data-recency-enabled]");
    assert(/account/.test(await page.textContent('[data-impact="recency"]')), "no recency impact text");
    await page.click("[data-value-panel-toggle]");
    await page.locator('[data-value-weight="roi"]').evaluate(el => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "80");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => window.__health.writeQueue.queueState().status === "saved", null, { timeout: 15000 });
    await reload();
    await page.waitForFunction(() => window.__store && window.__store.getState().settings.recencyMix);
    const s = await page.evaluate(() => window.__store.getState().settings);
    assert(s.recencyMix.enabled === true, "enabled not persisted");
    assert(s.recencyMix.types.QBR.zeroDays === 200, "QBR zeroDays not persisted: " + s.recencyMix.types.QBR.zeroDays);
    assert(s.recencyMix.types.call.fullDays === 0, "negative full days not clamped: " + s.recencyMix.types.call.fullDays);
    assert(s.valueMix.roi === 80, "value sub-weight not persisted: " + s.valueMix.roi);
  } finally { await browser.close(); }
});
