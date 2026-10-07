import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

// The ARR bridge shows new customers as new business while NRR/GRR exclude them. Same book
// as tests/unit/arr-bridge.test.mjs: opening 250K + new 300K + exp 20K - contr 10K - churn
// 50K = 510K. NRR = 210/250 = 84%.
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const A = [
  seedAccount({ id: "a", name: "Grow Co", arr: 120000, startDate: "2020-01-01", arrEvents: [{ id: "e1", date: day(-40), delta: 20000, kind: "expansion", currency: "USD" }] }),
  seedAccount({ id: "b", name: "Shrink Co", arr: 90000, startDate: "2020-01-01", arrEvents: [{ id: "e2", date: day(-20), delta: -10000, kind: "contraction", currency: "USD" }] }),
  seedAccount({ id: "c", name: "Gone Co", arr: 50000, startDate: "2020-01-01", contractStatus: "Churned", churn: { date: day(-30), arr: 50000, currency: "USD", reason: "Budget" } }),
  seedAccount({ id: "d", name: "New Co", arr: 300000, startDate: day(-90), arrEvents: [{ id: "e3", date: day(-10), delta: 50000, kind: "expansion", currency: "USD" }] }),
];
const seed = `window.__seedRows = { accounts: ${JSON.stringify(A.map(d => ({ id: d.id, data: d })))}, contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
const read = page => page.$$eval("[data-bridge-row]", els => Object.fromEntries(els.map(e => [e.dataset.bridgeRow, e.querySelector("[data-bridge-value]").innerText.trim()])));

test("ARR bridge shows new customers as new business and adds up to today's ARR", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.waitForSelector("[data-arr-bridge]");
    const v = await read(page);
    const want = { opening: "$250K", new: "+$300K", expansion: "+$20K", contraction: "-$10K", churn: "-$50K", closing: "$510K" };
    assert(JSON.stringify(v) === JSON.stringify(want), "bridge: " + JSON.stringify(v));
    const tiles = await page.textContent("#root");
    assert(/NRR \(12m\)\s*84%/.test(tiles), "NRR tile should be 84% (new logo excluded)");
    assert(/existing customers: \+\$20K exp · −\$10K contr/.test(tiles), "NRR sub-line must use existing-customer figures");
  } finally { await browser.close(); }
});

test("phone: ARR bridge fits the screen", async () => {
  const { page, browser } = await launch(seed);
  try {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.waitForSelector("[data-arr-bridge]");
    const r = await page.$eval("[data-arr-bridge]", el => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, sw: document.documentElement.scrollWidth }; });
    assert(r.l >= 0 && r.r <= 375 && r.sw <= 375, "overflow: " + JSON.stringify(r));
  } finally { await browser.close(); }
});
