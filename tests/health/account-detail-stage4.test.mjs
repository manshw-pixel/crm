// UI Stage 4 (Task 1): account detail header card, health ring, stat cards, profile & status card.
// Targets data-* hooks only; every absence check is paired with a presence check.
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const LONG = "Supercalifragilisticexpialidocious International Holdings and Logistics Group XY";
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
  // Task 2: overview cards
  seedAccount({ id: "w1", name: "Wide Co", industry: "Tech", csm: "Priya Shah", accountNo: "1006",
    arrEvents: [{ id: "ev1", date: day(-30), kind: "expansion", delta: 5000, reason: "Seats added", note: "", source: "manual", by: "Priya Shah" }],
    audit: [{ id: "au1", date: day(-5), field: "tier", from: "Mid", to: "Enterprise", by: "Priya Shah", source: "manual" }] }),
  // Task 3: 80-char name
  seedAccount({ id: "l1", name: LONG, industry: "Tech", csm: "Priya Shah", accountNo: "1007" }),
];
const ACTS = [
  { id: "a1", accountId: "w1", type: "call", date: day(-1), summary: "Sponsor call" },
  { id: "a2", accountId: "w1", type: "email", date: day(-2), summary: "Usage report" },
  { id: "a3", accountId: "w1", type: "QBR", date: day(-3), summary: "Quarterly review" },
  { id: "a4", accountId: "w1", type: "mystery", date: day(-4), summary: "Odd type" },
];
const CONTACTS = [
  { id: "ct1", accountId: "w1", name: "Maya Kapoor", role: "VP Ops", email: "maya@wide.example", sentiment: "Positive", isChampion: true },
  { id: "ct2", accountId: "w1", name: "Dan Lee", role: "IT", email: "dan@wide.example", sentiment: "Neutral" },
];
const OPPS = [{ id: "o1", accountId: "w1", type: "Upsell", value: 20000, stage: "Proposal", closeDate: day(30) }];
const rowsOf = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const TASKS = [
  { id: "hp1", accountId: "g1", title: "Step 1", due: day(5), priority: "High", status: "Done", owner: "Priya Shah", healthPlaybook: true, healthFor: "2026-10-01" },
  { id: "hp2", accountId: "g1", title: "Step 2", due: day(9), priority: "High", status: "Open", owner: "Priya Shah", healthPlaybook: true, healthFor: "2026-10-01" },
  { id: "wt1", accountId: "w1", title: "Send quote", due: day(-3), priority: "High", status: "Open", owner: "Priya Shah" },
  { id: "wt2", accountId: "w1", title: "Usage review", due: day(4), priority: "Medium", status: "Open", owner: "Priya Shah" },
  { id: "wt3", accountId: "w1", title: "QBR prep", due: day(12), priority: "Low", status: "Open", owner: "Anita Rao" },
];
const seed = (role = "admin", theme = "light") => `try { localStorage.setItem("onevio.theme", "${theme}"); } catch (e) {}
  window.__seedRows = { accounts: ${JSON.stringify(A.map(d => ({ id: d.id, data: d })))},
  contacts: ${rowsOf(CONTACTS)}, activities: ${rowsOf(ACTS)},
  tasks: ${rowsOf(TASKS)}, opportunities: ${rowsOf(OPPS)}, settings: [],
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
    const col = label => page.locator("[data-header-card] button", { hasText: label }).evaluate(e => getComputedStyle(e).color);
    const [re, ed] = [await col("↻ Reactivate"), await col("✎ Edit account")];
    assert(re !== ed, `Reactivate colour ${re} should differ from Edit ${ed} (emerald)`);
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

// ---------------- Task 2: tabs + two-column overview ----------------
const card = (page, re) => page.locator("[data-ad-card]").filter({ has: page.locator("h2", { hasText: re }) }).first();
const phone = async page => { await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150); };

test("tabs are underline tabs", async () => {
  const { page, browser } = await openDetail("Wide Co");
  try {
    const tabs = page.locator("[data-account-tab]");
    assert(await tabs.count() === 3, "three tabs");
    for (const h of await tabs.evaluateAll(es => es.map(e => e.getBoundingClientRect().height))) assert(h >= 44, "tab height " + h);
    const ul = await page.$eval('[data-account-tab="overview"]', e => { const c = getComputedStyle(e); return c.borderBottomWidth + " " + c.borderBottomStyle; });
    assert(ul === "2px solid", "selected underline " + ul);
    assert(await page.getAttribute('[data-account-tab="overview"]', "aria-selected") === "true", "overview selected");
    assert(await page.locator("[data-overview]").count() === 1, "precondition: overview shown");
    await page.click('[data-account-tab="Invoices"]');
    assert(await page.getAttribute('[data-account-tab="Invoices"]', "aria-selected") === "true", "invoices selected");
    assert(await page.getAttribute('[data-account-tab="overview"]', "aria-selected") === "false", "overview deselected");
    await page.locator(":is(h2,h3)", { hasText: /^Invoices$/ }).first().waitFor({ timeout: 3000 });
    assert(await page.locator("[data-overview]").count() === 0, "overview hidden on Invoices");
  } finally { await browser.close(); }
});

test("two columns on desktop, stacked on phone", async () => {
  const { page, browser } = await openDetail("Wide Co");
  try {
    const box = re => card(page, re).boundingBox();
    let [h, act] = [await box(/^Health breakdown/), await box(/^Activity timeline/)];
    assert(h && act, "precondition: both cards");
    assert(h.x >= act.x + act.width, `desktop: health x ${h.x} vs activity right ${act.x + act.width}`);
    await phone(page);
    [h, act] = [await box(/^Health breakdown/), await box(/^Activity timeline/)];
    assert(h.y >= act.y + act.height, `phone: health y ${h.y} vs activity bottom ${act.y + act.height}`);
  } finally { await browser.close(); }
});

test("activity icon by type", async () => {
  const { page, browser } = await openDetail("Wide Co");
  try {
    const icons = await page.$$eval("[data-activity-icon]", e => e.map(x => x.getAttribute("data-activity-icon")));
    assert(icons.join(",") === "call,email,qbr,note", "icons " + icons);
    assert(await page.locator("[data-activity-icon] svg path").count() === 4, "an svg path per icon");
    const words = await page.$$eval("[data-activity-type]", e => e.map(x => x.textContent.trim()));
    assert(words.join(",") === "call,email,QBR,mystery", "type words " + words);
    assert(await page.locator("[data-activity-type]").first().isVisible(), "type word visible");
  } finally { await browser.close(); }
});

test("health bars keep hooks", async () => {
  const { page, browser } = await openDetail("Wide Co");
  try {
    const hc = card(page, /^Health breakdown/);
    assert(await hc.locator("[data-input-bar]").count() === 5, "5 input bars");
    assert(/Inputs last updated/.test(await hc.textContent()), "Inputs last updated text");
    const hgt = await hc.locator("[data-input-bar]").first().evaluate(e => e.getBoundingClientRect().height);
    assert(Math.round(hgt) === 7, "bar height " + hgt);
  } finally { await browser.close(); }
});

test("task priority pill", async () => {
  const { page, browser } = await openDetail("Wide Co");
  try {
    const row = t => page.locator("[data-task-row]", { hasText: t });
    assert(await row("Send quote").locator("[data-priority]").getAttribute("data-sev") === "red", "High red");
    assert(await row("Usage review").locator("[data-priority]").getAttribute("data-sev") === "amber", "Medium amber");
    assert(await row("QBR prep").locator("[data-priority]").getAttribute("data-sev") === "grey", "Low grey");
    const due = row("Send quote").locator("[data-task-due]");
    assert(await due.getAttribute("data-overdue") === "true", "overdue flag");
    const c1 = await due.evaluate(e => getComputedStyle(e).color);
    const c2 = await row("QBR prep").locator("[data-task-due]").evaluate(e => getComputedStyle(e).color);
    assert(c1 !== c2, "overdue due colour should differ: " + c1);
    assert(await row("Send quote").evaluate(e => e.tagName) === "LABEL", "task row is a label");
  } finally { await browser.close(); }
});

test("contacts show avatar and champion word", async () => {
  const { page, browser } = await openDetail("Wide Co");
  try {
    const row = page.locator("[data-contact-row]", { hasText: "Maya Kapoor" });
    assert(/★ Champion/.test(await row.textContent()), "champion word");
    assert(!/Champion/.test(await page.locator("[data-contact-row]", { hasText: "Dan Lee" }).textContent()), "non-champion has no word");
    assert(await row.locator("[data-contact-av]").textContent() === "MK", "initials");
    assert(await page.getAttribute('[data-edit-contact="ct1"]', "aria-label") === "Edit contact", "edit label");
    assert(await page.getAttribute('[data-delete-contact="ct1"]', "aria-label") === "Delete contact", "delete label");
  } finally { await browser.close(); }
});

test("revenue history collapsed by default", async () => {
  const { page, browser } = await openDetail("Wide Co");
  try {
    const rc = card(page, /^Revenue history \(1\)/);
    const btn = rc.locator("button[aria-expanded]");
    assert(await btn.getAttribute("aria-expanded") === "false", "collapsed");
    assert(await rc.getByText(/Seats added/).count() === 0, "events hidden");
    await btn.click();
    assert(await btn.getAttribute("aria-expanded") === "true", "expanded");
    assert(await rc.getByText(/Seats added/).isVisible(), "events visible");
  } finally { await browser.close(); }
});

test("won opportunity confirm still works", async () => {
  const { page, browser } = await openDetail("Wide Co");
  try {
    const sel = card(page, /^Opportunities/).locator("select");
    const h = await sel.evaluate(e => e.getBoundingClientRect().height);
    assert(h >= 34, "stage select height " + h);
    await sel.selectOption("Won");
    await page.getByText("Book expansion ARR").first().waitFor({ timeout: 3000 });
  } finally { await browser.close(); }
});

test("phone: icon buttons and tabs >= 44px", async () => {
  const { page, browser } = await openDetail("Wide Co");
  try {
    await phone(page);
    const sizes = await page.$$eval("[data-overview] button[aria-label], [data-account-tab]", e => e.map(x => { const r = x.getBoundingClientRect(); return [x.getAttribute("aria-label") || x.textContent, Math.round(r.width), Math.round(r.height)]; }));
    assert(sizes.length >= 10, "precondition: buttons " + sizes.length);
    const small = sizes.filter(([, w, h]) => h < 44 || w < 44);
    assert(small.length === 0, "small: " + JSON.stringify(small));
  } finally { await browser.close(); }
});

// ---------------- Task 3: phone, print, forced-colors, focus ----------------
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const name of ["Globex Corporation", LONG]) test(`390px: no horizontal scroll, ring visible (${name.length} chars)`, async () => {
  assert(LONG.length === 80, "precondition: long name is 80 chars");
  const { page, browser } = await openDetail(name);
  try {
    await phone(page);
    const over = await noHScroll(page);
    const wide = over > 0 ? await page.evaluate(() => [...document.querySelectorAll("main *")].filter(e => e.getBoundingClientRect().right > 391).slice(-4).map(e => e.tagName + "." + e.className.toString().slice(0, 40) + ":" + Math.round(e.getBoundingClientRect().right))) : [];
    assert(over <= 0, "horizontal overflow " + over + " " + wide.join(" | "));
    const rb = await page.locator("[data-health-ring]").boundingBox();
    assert(rb && rb.x >= 0 && rb.x + rb.width <= 390, "ring outside viewport " + JSON.stringify(rb));
    if (name === LONG) assert(await page.getAttribute("[data-header-card] h1", "title") === LONG, "h1 title");
  } finally { await browser.close(); }
});

test("200% zoom (720px viewport): no horizontal scroll", async () => {
  const { page, browser } = await openDetail("Wide Co");
  try {
    await page.setViewportSize({ width: 720, height: 450 });
    await page.waitForTimeout(150);
    const over = await noHScroll(page);
    assert(over <= 0, "horizontal overflow " + over);
  } finally { await browser.close(); }
});

test("print hides actions and tabs", async () => {
  const { page, browser } = await openDetail("Wide Co");
  try {
    const disp = () => page.evaluate(() => [".ad-actions", "[role=tablist]"].map(s => getComputedStyle(document.querySelector(s)).display));
    assert((await disp()).every(d => d !== "none"), "precondition: shown on screen");
    await page.emulateMedia({ media: "print" });
    const d = await disp();
    assert(d.every(x => x === "none"), "print display " + d);
  } finally { await browser.close(); }
});

test("forced-colors: pills and stat tiles have a border", async () => {
  const { page, browser } = await openDetail("Globex Corporation");
  try {
    await page.emulateMedia({ forcedColors: "active" });
    const st = await page.evaluate(() => [...document.querySelectorAll(".ad-pill, [data-stat]")].map(e => getComputedStyle(e).borderTopStyle));
    assert(st.length >= 6, "precondition: elements " + st.length);
    assert(st.every(s => s === "solid"), "borders " + st);
  } finally { await browser.close(); }
});

test("focus ring visible on Log activity, a tab and an edit button", async () => {
  const { page, browser } = await openDetail("Wide Co");
  try {
    await page.keyboard.press("Tab");
    for (const loc of [page.locator("button", { hasText: "+ Log activity" }).first(), page.locator('[data-account-tab="Invoices"]'), page.locator('[data-edit-contact="ct1"]')]) {
      await loc.focus();
      const o = await loc.evaluate(e => { const c = getComputedStyle(e); return [parseFloat(c.outlineWidth), c.outlineStyle]; });
      assert(o[0] >= 2 && o[1] !== "none", "outline " + o);
    }
  } finally { await browser.close(); }
});

test("show/hide toggles are named", async () => {
  const { page, browser } = await openDetail("Wide Co");
  try {
    const b = card(page, /^Revenue history/).locator("button[aria-expanded]");
    assert(await b.getAttribute("aria-label") === "Show revenue history", "label " + await b.getAttribute("aria-label"));
    await b.click();
    assert(await b.getAttribute("aria-label") === "Hide revenue history", "label after click");
    assert(await card(page, /^Change history/).locator("button[aria-expanded]").getAttribute("aria-label") === "Show change history", "change label");
  } finally { await browser.close(); }
});

test("dark: open revenue row contrast >= 4.5", async () => {
  const { page, browser } = await openDetail("Wide Co", { theme: "dark" });
  try {
    await card(page, /^Revenue history/).locator("button[aria-expanded]").click();
    await page.addScriptTag({ content: PAGE_FNS });
    const r = await page.evaluate(() => {
      const els = [...document.querySelectorAll("[data-rev-row] > span")];
      return { n: els.length, low: els.map(e => [window.__c.textOn(e), e.textContent.trim().slice(0, 24)]).filter(([k]) => k === null || k < 4.5).map(([k, t]) => (k === null ? "none" : k.toFixed(2)) + " " + t) };
    });
    assert(r.n >= 4, "precondition: spans " + r.n);
    assert(r.low.length === 0, "low contrast: " + r.low.join(" | "));
  } finally { await browser.close(); }
});
