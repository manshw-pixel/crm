// UI Stage 4 (Task 1): account detail header card, health ring, stat cards, profile & status card.
// Targets data-* hooks only; every absence check is paired with a presence check.
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const A = [
  seedAccount({ id: "g1", name: "Globex Corporation", tier: "Enterprise", industry: "Manufacturing", leadId: "u3", csm: "Priya Shah", csmSince: "2025-03-04",
    accountNo: "1002", arr: 240000, licenses: 200, deployedLicenses: 150, renewalDate: day(20), nextQbrDate: day(12),
    history: [{ d: day(-40), s: 99 }] }),
  seedAccount({ id: "g2", name: "Globex APAC", tier: "Mid", industry: "Logistics", csm: "Priya Shah", arr: 22000, parentId: "g1", accountNo: "1002-1" }),
  seedAccount({ id: "i1", name: "Rupee Retail", tier: "Growth", industry: "Retail", csm: "Anita Rao", arr: 3500000, currency: "INR", accountNo: "1003",
    renewalDate: day(45), billingCompleted: true, billingCompletedDate: "2026-01-10" }),
  seedAccount({ id: "c1", name: "Gone Co", industry: "Media", csm: "Anita Rao", arr: 50000, accountNo: "1004",
    churn: { date: day(-60), arr: 50000, currency: "USD", reason: "Price", by: "Priya Shah" } }),
  seedAccount({ id: "b1", name: "Bare Co", industry: "", csm: "", accountNo: "1005" }),
];
const TASKS = [
  { id: "hp1", accountId: "g1", title: "Step 1", due: day(5), priority: "High", status: "Done", owner: "Priya Shah", healthPlaybook: true, healthFor: "2026-10-01" },
  { id: "hp2", accountId: "g1", title: "Step 2", due: day(9), priority: "High", status: "Open", owner: "Priya Shah", healthPlaybook: true, healthFor: "2026-10-01" },
];
const seed = (role = "admin", theme = "light") => `try { localStorage.setItem("onevio.theme", "${theme}"); } catch (e) {}
  window.__seedRows = { accounts: ${JSON.stringify(A.map(d => ({ id: d.id, data: d })))},
  contacts: [], activities: [], tasks: ${JSON.stringify(TASKS.map(t => ({ id: t.id, data: t })))}, opportunities: [], settings: [],
  profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "${role}" }, { id: "u2", org_id: "org-a", name: "Priya Shah", role: "user" },
    { id: "u3", org_id: "org-a", name: "Rahul Verma", role: "lead" }] };`;

async function openDetail(name, { role = "admin", theme = "light", churned = false } = {}) {
  const r = await launch(seed(role, theme));
  if (theme !== "light") await r.page.reload();
  await r.page.setViewportSize({ width: 1440, height: 900 });
  await r.page.click('button[title="Accounts"]');
  await r.page.waitForSelector("[data-account-row]");
  if (churned) { await r.page.getByText(/show churned/).first().click(); }
  await r.page.locator("[data-account-row]").filter({ has: r.page.locator("[data-account-name]", { hasText: new RegExp(`^${name}`) }) }).first().click();
  await r.page.waitForSelector("[data-header-card] h1");
  await r.page.waitForFunction(n => document.querySelector("[data-header-card] h1").textContent === n, name);
  return r;
}
const txt = (page, sel) => page.$eval(sel, e => e.textContent.trim());

test("header shows avatar, name, number and sub line; Parent link opens the parent", async () => {
  const { page, browser } = await openDetail("Globex Corporation");
  try {
    assert(await txt(page, "[data-header-card] [data-avatar]") === "GC", "avatar initials");
    assert(await page.getAttribute("[data-header-card] [data-avatar]", "aria-hidden") === "true", "avatar aria-hidden");
    assert(/#1002/.test(await txt(page, "[data-header-card] section")), "account number");
    const sub = await txt(page, "[data-sub-line]");
    assert(sub === "Enterprise · Manufacturing · Lead Rahul Verma", "sub line: " + sub);
    assert(await page.locator("button", { hasText: "← Accounts" }).count() === 1, "back link text");
    // the sub account's sub line carries the Parent link
    await page.click("button:has-text('← Accounts')");
    await page.locator("[data-account-row]").filter({ has: page.locator("[data-account-name]", { hasText: /^Globex APAC$/ }) }).first().click();
    await page.waitForFunction(() => document.querySelector("[data-header-card] h1")?.textContent === "Globex APAC");
    const sub2 = await txt(page, "[data-sub-line]");
    assert(sub2 === "Mid · Logistics · Parent Globex Corporation", "sub account sub line: " + sub2);
    await page.click("[data-sub-line] button");
    await page.waitForFunction(() => document.querySelector("[data-header-card] h1")?.textContent === "Globex Corporation");
  } finally { await browser.close(); }
});

test("health ring names score and word", async () => {
  const { page, browser } = await openDetail("Globex Corporation");
  try {
    // the list row's health cell is the independent source of the score
    await page.click("button:has-text('← Accounts')");
    const row = page.locator("[data-account-row]").filter({ has: page.locator("[data-account-name]", { hasText: /^Globex Corporation/ }) }).first();
    const score = +(await row.locator("[data-risk] b").textContent());
    assert(score >= 0 && score <= 100, "precondition: score " + score);
    await row.click();
    await page.waitForSelector("[data-health-ring]");
    const word = score >= 70 ? "Healthy" : score >= 40 ? "Watch" : "At risk";
    const ring = page.locator("[data-health-ring]");
    assert(await ring.getAttribute("role") === "img", "ring role");
    assert(await ring.getAttribute("aria-label") === `Health ${score}, ${word}`, "ring label " + await ring.getAttribute("aria-label"));
    assert(await page.locator("[data-health-word]").isVisible(), "word visible");
    assert(await txt(page, "[data-health-word]") === word, "health word");
    assert(await txt(page, "[data-health-ring]") === String(score), "score centred in the ring");
  } finally { await browser.close(); }
});

test("stat cards: 4 with licenses, 3 without; INR shows ≈ USD; parent ARR shows Σ", async () => {
  let r = await openDetail("Globex Corporation");
  try {
    assert(await r.page.locator("[data-stat]").count() === 4, "Globex stats");
    assert(/Σ/.test(await txt(r.page, '[data-stat="arr"]')), "Σ rollup on parent ARR");
    assert(/150 deployed of 200/.test(await txt(r.page, '[data-stat="licenses"]')), "licenses sub");
    assert(await txt(r.page, '[data-stat="csm"] .ad-stat-tile') === "PS", "CSM initials tile");
  } finally { await r.browser.close(); }
  r = await openDetail("Bare Co");
  try {
    const keys = await r.page.$$eval("[data-stat]", e => e.map(x => x.getAttribute("data-stat")));
    assert(keys.join(",") === "arr,renewal,csm", "bare stats " + keys);
  } finally { await r.browser.close(); }
  r = await openDetail("Rupee Retail");
  try {
    assert(/≈ \$[\d.,]+[KM]? USD/.test(await txt(r.page, '[data-stat="arr"]')), "INR ≈ USD line: " + await txt(r.page, '[data-stat="arr"]'));
  } finally { await r.browser.close(); }
});

test("renewal stat severity: 20d red, 45d amber", async () => {
  let r = await openDetail("Globex Corporation");
  try { assert(await r.page.getAttribute('[data-stat="renewal"]', "data-sev") === "red", "20d red"); } finally { await r.browser.close(); }
  r = await openDetail("Rupee Retail");
  try { assert(await r.page.getAttribute('[data-stat="renewal"]', "data-sev") === "amber", "45d amber"); } finally { await r.browser.close(); }
});

test("status pills carry severity", async () => {
  const { page, browser } = await openDetail("Globex Corporation");
  try {
    const pills = await page.$$eval("[data-status-pill]", e => e.map(x => [x.textContent.trim(), x.getAttribute("data-sev")]));
    const find = re => pills.find(p => re.test(p[0]));
    assert(find(/^Billing pending$/)?.[1] === "amber", "billing " + JSON.stringify(pills));
    assert(find(/^QBR due in \d+d$/)?.[1] === "amber", "qbr " + JSON.stringify(pills));
    assert(find(/^Transition date not set$/)?.[1] === "grey", "transition " + JSON.stringify(pills));
    const pb = find(/^♥ 1\/2 playbook$/);
    assert(pb && pb[1] === "red", "playbook " + JSON.stringify(pills));
    assert(pills.every(p => ["red", "amber", "grey", "green"].includes(p[1])), "every pill has a sev");
  } finally { await browser.close(); }
  const r = await openDetail("Rupee Retail");
  try {
    const sev = await r.page.locator("[data-status-pill]", { hasText: /^Billing ✓/ }).getAttribute("data-sev");
    assert(sev === "green", "billing done green: " + sev);
  } finally { await r.browser.close(); }
});

test("existing header hooks survive", async () => {
  const { page, browser } = await openDetail("Globex Corporation");
  try {
    for (const h of ["data-header-card", "data-retention-block", "data-csm-since-label", "data-lead-meta", "data-transition-pill", "data-flag"])
      assert(await page.locator(`[${h}]`).count() > 0, "missing hook " + h);
    for (const h of ["data-baseline-arr", "data-current-arr", "data-change", "data-ratio"])
      assert(await page.locator(`[data-retention-block] [${h}]`).count() + (await page.locator("[data-retention-block] p").count()) > 0, "retention " + h);
    for (const label of ["+ Log activity", "+ Add task", "✎ Update health", "✓ Complete renewal", "✎ Edit account"])
      assert(await page.locator("[data-header-card] button", { hasText: label }).count() === 1, "button " + label);
    assert(await page.locator("[data-header-card] [data-more-actions]").textContent() === "More ▾", "More menu");
    assert(/since Mar 4, 2025/.test(await txt(page, "[data-csm-since-label]")), "csm since");
  } finally { await browser.close(); }
});

test("churned account header: Reactivate, no Complete renewal, no stage select", async () => {
  const { page, browser } = await openDetail("Gone Co", { churned: true });
  try {
    assert(await page.locator("[data-header-card] button", { hasText: "↻ Reactivate" }).isVisible(), "Reactivate visible");
    assert(await page.locator("[data-header-card] button", { hasText: "✎ Edit account" }).count() === 1, "precondition: action row");
    assert(await page.locator("button", { hasText: "✓ Complete renewal" }).count() === 0, "no Complete renewal");
    assert(await page.locator("[data-renewal-stage]").count() === 0, "no renewal stage");
    assert(await page.getByText("CHURNED", { exact: true }).count() === 1, "churned banner");
  } finally { await browser.close(); }
});

test("read-only role header: no action row, stage is a static pill", async () => {
  const { page, browser } = await openDetail("Globex Corporation", { role: "impl_user" });
  try {
    assert(await page.locator("[data-health-ring]").count() === 1, "precondition: header rendered");
    assert(await page.locator("button", { hasText: "+ Log activity" }).count() === 0, "no Log activity");
    assert(await page.locator("[data-more-actions]").count() === 0, "no More menu");
    const tag = await page.$eval("[data-renewal-stage]", e => e.tagName);
    assert(tag === "SPAN", "stage element " + tag);
  } finally { await browser.close(); }
  const r = await openDetail("Globex Corporation");
  try {
    assert(await r.page.$eval("[data-renewal-stage]", e => e.tagName) === "SELECT", "admin gets the select");
    assert(await r.page.$eval("[data-renewal-stage]", e => e.labels.length && e.labels[0].textContent) === "Renewal stage", "select has a real label");
  } finally { await r.browser.close(); }
});

test("empty profile parts: no stray separators in the sub line", async () => {
  const { page, browser } = await openDetail("Bare Co");
  try {
    const sub = await txt(page, "[data-sub-line]");
    assert(sub === "Mid", "bare sub line: " + JSON.stringify(sub));
    assert(!/·\s*·/.test(sub) && !/^·|·$/.test(sub), "stray separator " + sub);
  } finally { await browser.close(); }
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

for (const theme of ["light", "dark"]) test(`${theme}: header text contrast >= 4.5`, async () => {
  const { page, browser } = await openDetail("Globex Corporation", { theme });
  try {
    if (theme === "dark") assert(await page.evaluate(() => document.documentElement.classList.contains("dark")), "not dark");
    await page.mouse.move(0, 0);
    await page.addScriptTag({ content: PAGE_FNS });
    const r = await page.evaluate(() => {
      const els = [...document.querySelectorAll("[data-header-card] :is(h1, .ad-no, [data-sub-line], [data-sub-line] button, .ad-stat-label, .ad-stat-value, .ad-stat-sub, [data-status-pill], [data-flag], [data-health-word], .ad-ring-n, .ad-meta, .ad-val, .ad-caps, .ad-stage, .ad-meta-sm)")];
      return { n: els.length, low: els.map(e => [window.__c.textOn(e), e.textContent.trim().slice(0, 24)]).filter(([k]) => k === null || k < 4.5).map(([k, t]) => (k === null ? "none" : k.toFixed(2)) + " " + t) };
    });
    assert(r.n > 30, "precondition: elements " + r.n);
    assert(r.low.length === 0, "low contrast: " + r.low.join(" | "));
  } finally { await browser.close(); }
});
