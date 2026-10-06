import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const soon = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const seedOf = accts => `window.__seedRows = { accounts: ${JSON.stringify(accts)}.map(d => ({ id: d.id, data: d })), contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };`;
// 15 renewals inside 30 days overflow the Renewals due card's max-h-48 at desktop width
const many = Array.from({ length: 15 }, (_, i) => seedAccount({ id: "r" + i, name: "Renew Co " + i, renewalDate: soon(5 + i) }));

test("dashboard money and retention stats render at hero size with tabular numerals", async () => {
  const { page, browser } = await launch(seedOf(many));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForSelector("[data-stat-value]");
  const stats = await page.$$eval("[data-stat-value]", els => els.map(e => ({
    label: e.closest("[data-stat]").getAttribute("data-stat"), size: e.getAttribute("data-size"), cls: e.className })));
  const hero = stats.filter(s => s.size === "hero").map(s => s.label);
  for (const want of ["Total ARR", "ARR at risk", "GRR", "NRR", "Churned ARR"])
    assert(hero.some(l => l.startsWith(want)), `${want} is not a hero stat: ${JSON.stringify(hero)}`);
  assert(hero.length === 5, "expected exactly 5 hero stats, got " + JSON.stringify(hero));
  const sm = stats.filter(s => s.size === "sm").map(s => s.label);
  assert(sm.some(l => l.startsWith("QBRs due")) && sm.some(l => l.startsWith("Tasks due 7d")), "operational row not small: " + JSON.stringify(sm));
  for (const s of stats) assert(/\btabular-nums\b/.test(s.cls), `${s.label} value lacks tabular-nums`);
  await browser.close();
});

test("overflowing dashboard list shows a +N more cue that clears at the bottom", async () => {
  const { page, browser } = await launch(seedOf(many));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForSelector('[data-scroll-list="Renewals due"]');
  const list = '[data-scroll-list="Renewals due"]';
  await page.waitForSelector(`${list} [data-more-count]`, { timeout: 5000 });
  const n = Number(await page.getAttribute(`${list} [data-more-count]`, "data-more-count"));
  // count the rows actually below the fold to check N independently of the component
  const hidden = await page.$eval(`${list} > [aria-label]`, el => {
    const box = el.getBoundingClientRect();
    return Array.from(el.querySelectorAll("[data-row]")).filter(b => b.getBoundingClientRect().bottom > box.bottom + 1).length;
  });
  assert(n > 0 && n === hidden, `pill says ${n} more, ${hidden} rows are below the fold`);
  await page.$eval(`${list} > [aria-label]`, el => { el.scrollTop = el.scrollHeight; });
  await page.waitForFunction(sel => !document.querySelector(`${sel} [data-more-count]`), list, { timeout: 3000 });
  await browser.close();
});

test("a list that fits shows no overflow cue", async () => {
  const { page, browser } = await launch(seedOf([seedAccount({ renewalDate: soon(10) })]));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForSelector('[data-scroll-list="Renewals due"]');
  await page.waitForTimeout(300);
  assert(await page.$('[data-scroll-list="Renewals due"] [data-more-count]') === null, "short list shows a more cue");
  await browser.close();
});
