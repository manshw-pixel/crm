// UI Stage 3: the restyled accounts table (avatar + industry cell, flag severity pills,
// health bar + word, uniform row height, roles, dark contrast, phone width).
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const A = [
  // parent: Health drop (red), No activity (amber), Inputs stale (grey); renewal 45d (amber)
  seedAccount({ id: "p1", name: "Parent Alpha Holdings", industry: "Manufacturing", csm: "Priya Shah", arr: 320000, accountNo: "1001",
    renewalDate: day(45), history: [{ d: day(-40), s: 99 }] }),
  seedAccount({ id: "s1", name: "Parent Alpha APAC", industry: "Logistics", csm: "Priya Shah", arr: 42000, parentId: "p1", accountNo: "1001-1",
    inputs: { usage: 95, sentiment: 95, tickets: 0, nps: 60 } }),
  seedAccount({ id: "i1", name: "Rupee Retail", industry: "Retail", csm: "Anita Rao", arr: 3500000, currency: "INR", accountNo: "1002",
    inputs: { usage: 55, sentiment: 55, tickets: 3, nps: 0 }, renewalDate: day(12) }),
  seedAccount({ id: "r1", name: "Zed Risky", industry: "Food", csm: "Anita Rao", arr: 38000, accountNo: "1003",
    inputs: { usage: 5, sentiment: 5, tickets: 20, nps: -80 } }),
  seedAccount({ id: "c1", name: "Gone Co", industry: "Media", csm: "Anita Rao", arr: 50000, accountNo: "1004",
    churn: { date: day(-60), arr: 50000, reason: "Price" } }),
];
const seed = (role = "admin", theme = "light", x = {}) => `try { localStorage.setItem("onevio.theme", "${theme}"); } catch (e) {}
  window.__seedRows = { accounts: ${JSON.stringify(A.concat(x.extra || []).map(d => ({ id: d.id, data: role === "lead" ? { ...d, leadId: "u1" } : d })))},
  contacts: [], activities: ${JSON.stringify(x.activities || [])}, tasks: [], opportunities: [], team: [], settings: ${JSON.stringify(x.settings || [])} };
  window.__seedProfile = { id: "u1", name: ${JSON.stringify(x.name || "Priya Shah")}, role: "${role}", org_id: "org-a", platform_admin: false };`;

async function openList(role, theme = "light", w = 1440, x = {}) {
  const r = await launch(seed(role, theme, x));
  if (theme !== "light") await r.page.reload();
  await r.page.setViewportSize({ width: 1440, height: 900 });
  await r.page.waitForFunction(() => window.__store && window.__store.getState().accounts.length >= 5);
  await r.page.click('button[title="Accounts"]');
  await r.page.waitForSelector("[data-account-row]");
  if (w !== 1440) await r.page.setViewportSize({ width: w, height: 900 });
  return r;
}
const showChurned = async page => { await page.getByText(/show churned/).first().click(); await page.waitForFunction(() => document.querySelectorAll("[data-account-row]").length >= 5); };
const rowOf = (page, name) => page.locator("[data-account-row]", { hasText: name }).first();

test("account cell shows avatar, name and industry; Industry column still sorts", async () => {
  const { page, browser } = await openList("admin");
  try {
    await page.click('th[data-sort-key="name"]');
    const first = page.locator("[data-account-row]").first();
    assert((await first.locator("[data-avatar]").textContent()).trim() === "PA", "avatar initials");
    assert(await first.locator("[data-avatar]").getAttribute("aria-hidden") === "true", "avatar aria-hidden");
    assert((await first.locator("[data-industry-sub]").textContent()).trim() === "Manufacturing", "industry sub-line");
    const th = page.locator('th[data-sort-key="industry"]');
    assert(await th.getAttribute("aria-sort") === "none", "industry header aria-sort");
    await th.click();
    assert(await th.getAttribute("aria-sort") === "ascending", "industry sort asc");
    const subs = await page.$$eval("[data-account-row] [data-industry-sub]", e => e.map(x => x.textContent.trim()));
    const parents = subs.filter(s => s !== "Logistics"); // the sub row follows its parent
    assert(JSON.stringify(parents) === JSON.stringify([...parents].sort()), "industry order " + subs);
  } finally { await browser.close(); }
});

const expectSev = f => /^Health ↓/.test(f) ? "red" : /^Renewal in (\d+)d/.test(f) ? (+f.match(/\d+/)[0] < 30 ? "red" : "amber") : f === "No activity 30d+" ? "amber" : "grey";
test("flags carry severity (red, amber, grey per the approved rule)", async () => {
  const { page, browser } = await openList("admin");
  try {
    const pills = await page.$$eval("[data-account-row] [data-flag]", e => e.map(x => [x.textContent.trim(), x.getAttribute("data-sev")]));
    const sevs = new Set(pills.map(p => p[1]));
    assert(sevs.has("red") && sevs.has("amber") && sevs.has("grey"), "severities " + JSON.stringify(pills));
    for (const [t, s] of pills) assert(s === expectSev(t), `${t}: ${s}, want ${expectSev(t)}`);
  } finally { await browser.close(); }
});

test("health shows bar, score and word matching the score", async () => {
  const { page, browser } = await openList("admin");
  try {
    const st = await page.evaluate(() => Object.fromEntries(window.__store.getState().accounts.map(a => [a.name, a])));
    const cells = await page.$$eval("[data-account-row]", rs => rs.map(r => [r.querySelector("[data-account-name]").textContent.trim(), r.querySelector("[data-health-word]").textContent.trim()]));
    assert(cells.length === 4, "rows " + cells.length);
    const words = new Set();
    for (const [name, word] of cells) {
      const row = rowOf(page, name);
      const score = +(await row.locator("[data-risk] b").textContent());
      const want = score >= 70 ? "Healthy" : score >= 40 ? "Watch" : "At risk";
      assert(word === want, `${name}: ${score} -> ${word}, want ${want}`);
      words.add(word);
    }
    assert(words.size === 3, "precondition: all three words seeded " + [...words]);
  } finally { await browser.close(); }
});

test("rows stay one height (sub, INR ≈USD, Σ, churned)", async () => {
  const { page, browser } = await openList("admin");
  try {
    await showChurned(page);
    assert(/≈/.test(await rowOf(page, "Rupee Retail").textContent()), "≈USD line");
    assert(/Σ/.test(await rowOf(page, "Parent Alpha Holdings").textContent()), "Σ line");
    const hs = await page.$$eval("[data-account-row]", r => r.map(x => x.offsetHeight + ":" + [...x.cells].map(c => { const r = document.createRange(); r.selectNodeContents(c); return Math.round(r.getBoundingClientRect().height * 10) / 10 + "/" + getComputedStyle(c).verticalAlign; }).join(",")));
    assert(new Set(hs.map(h => h.split(":")[0])).size === 1, "row heights " + hs.join(" | "));
    assert(hs[0].split(":")[0] === "60", "row height " + hs[0]);
  } finally { await browser.close(); }
});

test("churned row faded without flags; sub-account shows ↳", async () => {
  const { page, browser } = await openList("admin");
  try {
    await showChurned(page);
    const c = rowOf(page, "Gone Co");
    assert(+(await c.evaluate(e => getComputedStyle(e).opacity)) < 1, "churned not faded");
    assert(await c.locator("[data-flag]").count() === 0, "churned row has flags");
    assert(/churned/.test(await c.textContent()), "churned badge");
    assert(/↳\s*Sub-account:/.test(await rowOf(page, "Parent Alpha APAC").textContent()), "sub ↳ / sr-only text missing");
    assert(!/↳/.test(await rowOf(page, "Parent Alpha Holdings").textContent()), "parent has ↳");
  } finally { await browser.close(); }
});

test("lead sees the restyled table without Import / New; implementation role has no checkboxes", async () => {
  for (const role of ["lead", "impl_user"]) {
    const { page, browser } = await openList(role);
    try {
      assert(await page.locator("[data-account-row] [data-avatar]").count() > 0, role + ": no avatars");
      assert(await page.locator("[data-account-row] [data-health-word]").count() > 0, role + ": no health word");
      const txt = await page.textContent("#root");
      assert(!/Import CSV/.test(txt) && !/\+ New account/.test(txt), role + ": import/new shown");
      if (role === "impl_user") assert(await page.locator("[data-select], [data-select-all]").count() === 0, "impl: checkboxes shown");
    } finally { await browser.close(); }
  }
});

const PAGE_FNS = `window.__c = (() => {
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = s => (s.match(/[\\d.]+/g) || [0, 0, 0]).map(Number);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const rgba = s => { const c = parse(s); return c.length < 4 ? [...c.slice(0, 3), 1] : c.slice(0, 4); };
  const over = (top, a, base) => top.map((v, i) => v * a + base[i] * (1 - a));
  const opOf = e => { let o = 1; for (let x = e; x; x = x.parentElement) o *= +getComputedStyle(x).opacity; return o; };
  const bgOf = e => {
    const layers = [];
    for (let x = e; x; x = x.parentElement) {
      const c = rgba(getComputedStyle(x).backgroundColor), a = c[3] * opOf(x);
      if (a >= 1) return layers.reduceRight((b, [col, al]) => over(col, al, b), c.slice(0, 3));
      if (a > 0) layers.push([c.slice(0, 3), a]);
    }
    return null;
  };
  const textOn = e => { const bg = bgOf(e); if (!bg) return null; const c = rgba(getComputedStyle(e).color); return ratio(over(c.slice(0, 3), c[3] * opOf(e), bg), bg); };
  return { textOn };
})();`;
for (const theme of ["light", "dark"]) test(`${theme}: text contrast >= 4.5 on name, industry, flag pills, health word`, async () => {
  const { page, browser } = await openList("admin", theme);
  try {
    if (theme === "dark") assert(await page.evaluate(() => document.documentElement.classList.contains("dark")), "not dark");
    await page.mouse.move(0, 0);
    await page.addScriptTag({ content: PAGE_FNS });
    const r = await page.evaluate(() => {
      const els = [...document.querySelectorAll("[data-account-row] :is([data-industry-sub], [data-flag], [data-health-word], [data-account-name], .acct-sigma, .acct-label)")];
      return { labels: document.querySelectorAll("[data-account-row] .acct-label").length, n: els.length, low: els.map(e => [window.__c.textOn(e), e.textContent.trim().slice(0, 24)]).filter(([k]) => k === null || k < 4.5).map(([k, t]) => (k === null ? "none" : k.toFixed(2)) + " " + t) };
    });
    assert(r.labels >= 12, "precondition: .acct-label cells " + r.labels);
    assert(r.n > 24, "precondition: elements " + r.n);
    assert(r.low.length === 0, "low contrast: " + r.low.join(" | "));
  } finally { await browser.close(); }
});

test("390px: no page horizontal scroll; table scrolls inside [data-account-scroll]", async () => {
  const { page, browser } = await openList("admin", "light", 390);
  try {
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const s = document.querySelector("[data-account-scroll]"), d = document.scrollingElement;
      return { page: d.scrollWidth - d.clientWidth, inner: s.scrollWidth - s.clientWidth };
    });
    assert(m.page <= 0, "page overflows by " + m.page);
    assert(m.inner > 0, "table does not scroll inside its box " + m.inner);
  } finally { await browser.close(); }
});

for (const theme of ["light", "dark"]) test(`${theme}: hovering an unselected row tints it; header band is 11px uppercase`, async () => {
  const { page, browser } = await openList("admin", theme);
  try {
    const row = rowOf(page, "Zed Risky");
    await page.mouse.move(0, 0);
    const before = await row.evaluate(e => getComputedStyle(e).backgroundColor);
    await row.hover();
    const after = await row.evaluate(e => getComputedStyle(e).backgroundColor);
    assert(before !== after && after !== "rgba(0, 0, 0, 0)", `hover ${before} -> ${after}`);
    const th = await page.$eval('th[data-sort-key="tier"]', e => { const c = getComputedStyle(e); return [c.fontSize, c.textTransform, c.backgroundColor]; });
    assert(th[0] === "11px" && th[1] === "uppercase", "th " + th);
    assert(th[2] === (theme === "dark" ? "rgb(22, 32, 54)" : "rgb(248, 250, 252)"), "head band " + th[2]);
  } finally { await browser.close(); }
});

// ---- Task 3: quick-filter pills + toolbar ----
const names = page => page.$$eval("[data-account-row] [data-account-name]", e => e.map(x => x.firstChild.textContent.trim()));
const pressed = (page, k) => page.getAttribute(`[data-quick="${k}"]`, "aria-pressed");

test("quick pills set existing filters", async () => {
  const { page, browser } = await openList("admin");
  try {
    assert(await pressed(page, "all") === "true", "All not pressed initially");
    await page.click('[data-quick="risk"]');
    assert(await page.inputValue('[aria-label="Filter by health risk"]') === "Red", "risk select not Red");
    assert(await pressed(page, "risk") === "true", "risk pill not pressed");
    assert(await pressed(page, "all") === "false", "All still pressed");
    const risks = await page.$$eval("[data-account-row] [data-risk]", e => e.map(x => x.getAttribute("data-risk")));
    assert(risks.length > 0 && risks.every(r => r === "Red"), "rows " + risks);
    await page.click('[data-quick="renew"]');
    assert(await page.inputValue('[aria-label="Filter by renewal window in days"]') === "90", "renew select not 90");
    await page.click('[data-quick="all"]');
    assert(await page.inputValue('[aria-label="Filter by health risk"]') === "All" && await page.inputValue('[aria-label="Filter by renewal window in days"]') === "All", "All did not reset");
  } finally { await browser.close(); }
});

test("dropdown change un-presses pill", async () => {
  const { page, browser } = await openList("admin");
  try {
    await page.click('[data-quick="risk"]');
    assert(await pressed(page, "risk") === "true", "precondition: risk pressed");
    await page.selectOption('[aria-label="Filter by health risk"]', "All");
    assert(await pressed(page, "risk") === "false", "risk pill still pressed");
    assert(await pressed(page, "all") === "true", "All not pressed");
  } finally { await browser.close(); }
});

test("no-activity pill filters", async () => {
  // r1 has a fresh activity, so the pill must drop it
  const { page, browser } = await openList("admin", "light", 1440, { activities: [{ id: "act1", data: { id: "act1", accountId: "r1", type: "Call", date: day(-2), note: "x" } }] });
  try {
    const before = await page.locator("[data-account-row]").count();
    await page.click('[data-quick="noActivity"]');
    assert(await pressed(page, "noActivity") === "true", "pill not pressed");
    const rows = await page.$$eval("[data-account-row]", rs => rs.map(r => [...r.querySelectorAll("[data-flag]")].map(f => f.textContent.trim())));
    assert(rows.length > 0 && rows.length < before, `rows ${rows.length} of ${before}`);
    assert(rows.every(f => f.includes("No activity 30d+")), "row without flag " + JSON.stringify(rows));
    const count = +(await page.textContent('[data-quick="noActivity"] [data-quick-count]'));
    assert(count === rows.length, `count ${count} vs rows ${rows.length}`);
  } finally { await browser.close(); }
});

test("old segment without noActivity applies", async () => {
  const settings = [{ id: 1, data: { segments: [{ id: "seg-old", name: "Old red", filter: { risk: "Red" } }] } }];
  const { page, browser } = await openList("admin", "light", 1440, { settings });
  const errs = [];
  page.on("pageerror", e => errs.push(e.message));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  try {
    await page.click('[data-quick="noActivity"]');
    await page.selectOption("[data-segment-select]", "seg-old");
    await page.waitForTimeout(200);
    assert(errs.length === 0, "errors " + errs.join(" | "));
    assert(await pressed(page, "noActivity") === "false", "noActivity not reset by old segment");
    const risks = await page.$$eval("[data-account-row] [data-risk]", e => e.map(x => x.getAttribute("data-risk")));
    assert(risks.length > 0 && risks.every(r => r === "Red"), "rows " + risks);
  } finally { await browser.close(); }
});

test("my book hidden for user with no accounts", async () => {
  const a = await openList("admin");
  try { assert(await a.page.locator('[data-quick="mine"]').count() === 1, "precondition: My book shown for Priya"); }
  finally { await a.browser.close(); }
  const { page, browser } = await openList("admin", "light", 1440, { name: "Nobody Here" });
  try {
    assert(await page.locator('[data-quick="all"]').count() === 1, "pills missing");
    assert(await page.locator('[data-quick="mine"]').count() === 0, "My book shown");
  } finally { await browser.close(); }
});

test("my book hidden when user only owns churned accounts", async () => {
  const extra = [seedAccount({ id: "g1", name: "Ghost Only", csm: "Ghost Owner", accountNo: "1099", churn: { date: day(-60), arr: 1000, reason: "Price" } })];
  const { page, browser } = await openList("admin", "light", 1440, { name: "Ghost Owner", extra });
  try {
    assert(await page.locator('[data-quick="all"]').count() === 1, "pills missing");
    assert(await page.locator('[data-quick="mine"]').count() === 0, "My book shown for churned-only owner");
  } finally { await browser.close(); }
});

test("phone pill targets >= 44px tall", async () => {
  const { page, browser } = await openList("admin", "light", 390);
  try {
    await page.waitForTimeout(300);
    const hs = await page.$$eval("[data-quick]", e => e.map(x => x.getBoundingClientRect().height));
    assert(hs.length >= 4 && hs.every(h => h >= 44), "heights " + hs);
    const over = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
    assert(over <= 0, "page overflows " + over);
  } finally { await browser.close(); }
});
