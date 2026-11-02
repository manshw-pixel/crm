// UI Stage 5 (Task 2): the restyled Implementation board. Targets data-* hooks only; every
// absence check is paired with a presence check.
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const DAY = 86400000;
const day = n => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const TODAY = day(0);
const rows = list => `${JSON.stringify(list)}.map(d => ({ id: d.id, data: d }))`;
const ACCTS = [
  seedAccount({ id: "a1", name: "Hooli Media", csm: "Cara" }), seedAccount({ id: "a2", name: "Acme Retail India", csm: "Cara" }),
  seedAccount({ id: "a3", name: "Stark Industries", csm: "Cara" }), seedAccount({ id: "a4", name: "Soylent Foods", csm: "Cara" }),
  seedAccount({ id: "a5", name: "Wayne Logistics", csm: "Cara" }), seedAccount({ id: "a6", name: "Globex Corporation", csm: "Cara" }),
  seedAccount({ id: "a7", name: "Umbrella Health", csm: "Cara" }), seedAccount({ id: "a8", name: "Initech", csm: "Cara" }),
];
const proj = (id, accountId, stage, implementerId, targetGoLive, o = {}) => ({ id, accountId, type: "onboarding", stage, implementerId, createdBy: "Cara",
  checklistTemplate: [], checklist: {}, targetGoLive, startedAt: null, liveAt: null, history: [], holdReason: "", ...o });
const PROJECTS = [
  proj("q1", "a1", "queued", null, day(40), { type: "expansion" }),             // Needs owner / amber
  proj("pl1", "a2", "planning", "u2", day(40)),                                  // zero tasks, On track / green
  proj("ip1", "a3", "in_progress", "u2", day(-5)),                               // Go-live passed / red
  proj("ip2", "a4", "in_progress", "u3", day(7), { type: "expansion" }),         // Go-live in 7d / amber
  proj("cr1", "a5", "csm_review", "u2", day(60)),                                // Awaiting sign-off / grey
  proj("lv1", "a6", "live", "u3", day(-30), { liveAt: day(-20) + "T09:00:00.000Z" }), // Live / green
  proj("oh1", "a7", "on_hold", "u2", day(30), { holdReason: "Waiting on customer" }), // no tag
  proj("hd1", "a8", "handover", null, null),                                     // no tag
  proj("un1", "gone", "queued", "u3", day(50)),                                  // deleted account, On track
];
const task = (id, projectId, status) => ({ id, projectId, accountId: "a3", title: id, ownerId: "u2", due: null, estHours: 2, timeLog: [], status,
  signoff: "pending", signoffNote: "", signedBy: null, signedAt: null, order: 1 });
const TASKS = [task("k1", "ip1", "done"), task("k2", "ip1", "todo")];
const TAG = { q1: ["Needs owner", "amber"], pl1: ["On track", "green"], ip1: ["Go-live passed", "red"], ip2: ["Go-live in 7d", "amber"],
  cr1: ["Awaiting sign-off", "grey"], lv1: ["Live", "green"], un1: ["On track", "green"] };

const seed = (role = "admin", theme = "light") => `try { localStorage.setItem("onevio.theme", "${theme}"); } catch (e) {}
  window.__seedRows = { accounts: ${rows(ACCTS)}, contacts: [], activities: [], tasks: [], opportunities: [], settings: [], team: [],
  projects: ${rows(PROJECTS)}, project_tasks: ${rows(TASKS)},
  profiles: [{ id: "u1", org_id: "org-a", name: "Boss", role: "${role}" }, { id: "u2", org_id: "org-a", name: "Ivy", role: "impl_user" },
    { id: "u3", org_id: "org-a", name: "Zed", role: "impl_user" }] };`;
async function open({ role = "admin", theme = "light", w = 1440 } = {}) {
  const r = await launch(seed(role, theme));
  if (theme !== "light") await r.page.reload();
  await r.page.setViewportSize({ width: w, height: 900 });
  await r.page.click('button[title="Implementation"]').catch(() => {});
  await r.page.waitForSelector("[data-board-project]");
  return r;
}
const txt = (page, sel) => page.$eval(sel, e => e.textContent.trim());
const OPEN = ["q1", "pl1", "ip1", "ip2", "cr1", "un1"];
const risky = ["q1", "ip1", "ip2"];
const thisMonth = TODAY.slice(0, 7);

test("subtitle counts match the seed and follow the Type filter", async () => {
  const { page, browser } = await open();
  try {
    const gl = PROJECTS.filter(p => OPEN.includes(p.id) && p.targetGoLive && p.targetGoLive.slice(0, 7) === thisMonth).length;
    const want = `${OPEN.length} open projects · ${risky.length} at risk · ${gl} go-live this month`;
    assert(await txt(page, "[data-board-subtitle]") === want, "subtitle: " + await txt(page, "[data-board-subtitle]") + " want " + want);
    await page.selectOption("[data-board-filter-type]", "expansion");
    const gl2 = PROJECTS.filter(p => ["q1", "ip2"].includes(p.id) && p.targetGoLive.slice(0, 7) === thisMonth).length;
    const want2 = `2 open projects · 2 at risk · ${gl2} go-live this month`;
    assert(await txt(page, "[data-board-subtitle]") === want2, "expansion subtitle: " + await txt(page, "[data-board-subtitle]") + " want " + want2);
  } finally { await browser.close(); }
});

test("each open or live card has exactly one tag with the right text and severity; on hold and draft have none", async () => {
  const { page, browser } = await open();
  try {
    for (const [id, [text, sev]] of Object.entries(TAG)) {
      const card = page.locator(`[data-board-project="${id}"]`);
      assert(await card.count() === 1, "card " + id);
      assert(await card.locator("[data-board-tag]").count() === 1, "one tag on " + id);
      assert(await card.locator("[data-board-tag]").textContent() === text, `${id} text`);
      assert(await card.locator("[data-board-tag]").getAttribute("data-sev") === sev, `${id} sev`);
    }
    await page.locator('[data-board-column="on_hold"] summary').click();
    await page.locator('[data-board-column="handover"] summary').click();
    assert(await page.locator('[data-board-project="oh1"]').count() === 1 && await page.locator('[data-board-project="oh1"] [data-board-tag]').count() === 0, "on hold has no tag");
    assert(await page.locator('[data-board-project="hd1"]').count() === 1 && await page.locator('[data-board-project="hd1"] [data-board-tag]').count() === 0, "draft has no tag");
  } finally { await browser.close(); }
});

test("progress: zero-task card reads 0/0 tasks done and 0%; a card with tasks shows its share", async () => {
  const { page, browser } = await open();
  try {
    const z = await txt(page, '[data-board-project="pl1"] [data-board-progress]');
    assert(z.includes("0/0 tasks done") && z.includes("0%") && !/NaN/.test(z), "zero-task progress: " + z);
    const p = await txt(page, '[data-board-project="ip1"] [data-board-progress]');
    assert(p.includes("1/2 tasks done") && p.includes("50%"), "ip1 progress: " + p);
  } finally { await browser.close(); }
});

test("a card whose account was deleted shows Unknown account and a ? avatar", async () => {
  const { page, browser } = await open();
  try {
    const c = page.locator('[data-board-project="un1"]');
    assert((await c.locator(".im-name").textContent()) === "Unknown account", "name");
    assert((await c.locator("[data-avatar]").textContent()) === "?", "avatar");
    assert((await page.locator('[data-board-project="q1"] [data-avatar]').textContent()) === "HM", "normal avatar paired");
  } finally { await browser.close(); }
});

test("card text: go-live wording, unassigned owner, live date", async () => {
  const { page, browser } = await open();
  try {
    assert(/go-live [A-Z][a-z]{2} \d{1,2}/.test(await txt(page, '[data-board-project="q1"]')), "go-live text");
    assert((await txt(page, '[data-board-project="q1"]')).includes("Unassigned"), "unassigned");
    assert(/live [A-Z][a-z]{2} \d{1,2}/.test(await txt(page, '[data-board-project="lv1"]')), "live text");
  } finally { await browser.close(); }
});

test("tabs are a tablist of role=tab with aria-selected; Workload hidden for impl_user", async () => {
  const a = await open();
  try {
    assert(await a.page.locator('[role=tablist] [role=tab][data-impl-tab]').count() === 3, "three tabs for admin");
    assert(await a.page.locator('[data-impl-tab="Board"]').getAttribute("aria-selected") === "true", "Board selected");
    await a.page.click('[data-impl-tab="My tasks"]');
    assert(await a.page.locator('[data-impl-tab="My tasks"]').getAttribute("aria-selected") === "true", "My tasks selected");
    assert(await a.page.locator('[data-impl-tab="Board"]').getAttribute("aria-selected") === "false", "Board deselected");
  } finally { await a.browser.close(); }
  const b = await open({ role: "impl_user" });
  try {
    assert(await b.page.locator("[data-impl-tab]").count() === 2, "two tabs for impl_user");
    assert(await b.page.locator('[data-impl-tab="Workload"]').count() === 0, "no Workload tab");
  } finally { await b.browser.close(); }
});

test("collapsed lanes: three details with their hints", async () => {
  const { page, browser } = await open();
  try {
    assert(await page.locator("details[data-board-collapsed]").count() === 3, "three collapsed");
    const hints = { handover: "Sales handovers not yet submitted", on_hold: "Paused with a reason", cancelled: "Closed without going live" };
    for (const [s, h] of Object.entries(hints)) {
      const t = await txt(page, `details[data-board-column="${s}"] summary`);
      assert(t.includes(h), `${s} hint: ${t}`);
    }
    assert((await txt(page, 'details[data-board-column="handover"] summary')).includes("Handover drafts"), "handover label");
  } finally { await browser.close(); }
});

test("existing hooks survive and the filters still filter", async () => {
  const { page, browser } = await open();
  try {
    for (const s of ["queued", "planning", "in_progress", "csm_review", "live"]) assert(await page.locator(`section[data-board-column="${s}"]`).count() === 1, "lane " + s);
    assert(await page.locator("[data-board-filter-who]").count() === 1 && await page.locator("[data-board-filter-type]").count() === 1, "filters");
    assert(await page.locator("label", { hasText: "Implementer" }).count() === 1 && await page.locator("label", { hasText: "Type" }).count() === 1, "visible labels");
    assert(await page.locator("h1", { hasText: /^Implementation$/ }).count() === 1, "h1 text");
    await page.selectOption("[data-board-filter-who]", "u2");
    assert(await page.locator('[data-board-project="pl1"]').count() === 1 && await page.locator('[data-board-project="ip2"]').count() === 0, "who filter");
    await page.selectOption("[data-board-filter-who]", "");
    await page.selectOption("[data-board-filter-type]", "expansion");
    assert(await page.locator('[data-board-project="q1"]').count() === 1 && await page.locator('[data-board-project="pl1"]').count() === 0, "type filter");
    await page.selectOption("[data-board-filter-type]", "");
    await page.click('[data-board-project="ip1"]');
    await page.waitForSelector('[data-project-detail="ip1"]');
  } finally { await browser.close(); }
});

// In-page contrast helper (same method as dashboard-stage2.test.mjs).
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
for (const theme of ["light", "dark"]) test(`board text contrast >= 4.5:1 (${theme})`, async () => {
  const { page, browser } = await open({ theme });
  try {
    await page.addScriptTag({ content: PAGE_FNS });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const { textOn } = window.__c, low = [], seen = {};
      const sels = { h1: "main h1", subtitle: "[data-board-subtitle]", lane: ".im-lane-title", name: ".im-name", meta: ".im-meta", type: ".im-type", prog: ".im-prog-row span", owner: ".im-owner", tag: "[data-board-tag]", hint: ".im-hint", label: ".im-flabel", seg: ".im-seg-btn" };
      for (const [k, sel] of Object.entries(sels)) {
        const els = document.querySelectorAll(sel); seen[k] = els.length;
        for (const e of els) { const c = textOn(e); if (c === null || c < 4.5) low.push(k + " " + (c === null ? "no bg" : c.toFixed(2)) + " " + e.textContent.trim().slice(0, 24)); }
      }
      return { low, seen };
    });
    assert(r.seen.h1 >= 1 && r.seen.subtitle === 1 && r.seen.lane === 5 && r.seen.name >= 6 && r.seen.tag >= 6, "targets present " + JSON.stringify(r.seen));
    assert(r.low.length === 0, "low contrast: " + r.low.join(" | "));
  } finally { await browser.close(); }
});
