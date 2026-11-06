// Phone layout of four dashboard cards: names must be readable, nothing leaves the card's
// content box, and the AM book needs no sideways scroll. Desktop is checked so the phone
// stacking cannot leak upward.
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const d = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const lost = (id, reason, arr) => seedAccount({ id, name: "Lost " + id, arr, churn: { arr, date: d(-60), reason } });
const accts = [
  seedAccount({ id: "a1", name: "Globex Industrial Holdings", arr: 240000, csm: "Priya Shah", renewalDate: d(25), transitionDate: "2024-01-01", tier: "Enterprise" }),
  seedAccount({ id: "a2", name: "Initech", arr: 90000, csm: "Rahul", renewalDate: d(50), transitionDate: d(-30) }),
  seedAccount({ id: "a3", name: "Umbrella Corporation", arr: 1500000, csm: "Priya Shah", renewalDate: d(80), tier: "Mid-Market" }),
  lost("c1", "Product gap / missing features", 120000), lost("c2", "Budget", 40000),
];
const P = (id, accountId, stage) => ({ id, data: { id, accountId, type: "onboarding", stage, implementerId: null, history: [{ at: d(-20) + "T00:00:00Z", from: "handover", to: stage }] } });
const seed = `window.__seedRows = { accounts: ${JSON.stringify(accts.map(a => ({ id: a.id, data: a })))}, contacts: [], activities: [], tasks: [], opportunities: [],
  projects: ${JSON.stringify([P("p1", "a1", "in_progress"), P("p2", "a2", "on_hold")])}, project_tasks: [], team: [], settings: [],
  profiles: [{ id: "u1", org_id: "org-a", name: "Priya Shah", role: "admin" }] };`;

async function open(width) {
  const { page, browser } = await launch(seed);
  await page.setViewportSize({ width, height: 844 });
  await page.waitForSelector("[data-renewal-row]");
  await page.click("[data-analytics-toggle]");
  await page.click("[data-am-book-toggle]");
  await page.waitForFunction(() => /Initech/.test(document.querySelector("[data-am-book]").textContent));
  return { page, browser };
}
const measure = page => page.evaluate(() => {
  const card = t => [...document.querySelectorAll("main .nm")].find(c => c.querySelector("h3")?.textContent.startsWith(t));
  const inner = c => { const b = c.getBoundingClientRect(), s = getComputedStyle(c); return b.right - parseFloat(s.paddingRight); };
  const w = e => e.getBoundingClientRect().width;
  const am = document.querySelector("[data-am-book]"), table = document.querySelector("[data-impl-tier-table]");
  const churn = card("Churn analysis");
  return {
    renewalName: w(document.querySelector("[data-renewal-row] span.truncate")),
    amLabels: [...am.querySelectorAll("span[title]")].map(w),
    amScroll: am.parentElement.scrollWidth - am.parentElement.clientWidth,
    tableOver: table.getBoundingClientRect().right - inner(card("Implementation projects")),
    headersFit: [...table.querySelectorAll("th")].every(e => e.scrollWidth <= e.clientWidth + 1),
    churnBar: w(churn.querySelector(".bg-slate-100")),
    churnTitle: w(churn.querySelector("h3")),
    pageOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

for (const width of [320, 360, 390]) test(`dashboard cards fit a ${width}px phone`, async () => {
  const { page, browser } = await open(width);
  try {
    const m = await measure(page);
    const need = width - 120;
    assert(m.renewalName >= need, "renewal name width " + m.renewalName);
    assert(m.amLabels.length >= 6 && m.amLabels.every(x => x >= need), "AM labels " + m.amLabels);
    assert(m.amScroll <= 0, "AM book scrolls sideways by " + m.amScroll);
    assert(m.tableOver <= 0.5, "tier table past the card padding by " + m.tableOver);
    assert(m.headersFit, "tier table headers clipped");
    assert(m.churnBar >= need, "churn bar width " + m.churnBar);
    assert(m.churnTitle >= 150, "churn title squeezed to " + m.churnTitle);
    assert(m.pageOver <= 0, "page scrolls sideways by " + m.pageOver);
  } finally { await browser.close(); }
});

test("desktop keeps one-line renewal and churn rows", async () => {
  const { page, browser } = await open(1440);
  try {
    const r = await page.evaluate(() => {
      const top = e => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2);
      const row = document.querySelector("[data-renewal-row]");
      const bar = [...document.querySelectorAll("main .nm")].find(c => c.querySelector("h3")?.textContent.startsWith("Churn analysis")).querySelector(".bg-slate-100");
      return { ren: new Set([...row.children].filter(e => e.offsetWidth).map(top)).size, churn: new Set([...bar.parentElement.children].map(top)).size };
    });
    assert(r.ren === 1 && r.churn === 1, JSON.stringify(r));
  } finally { await browser.close(); }
});
