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
    const md = d => new Date(d.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const q1 = await txt(page, '[data-board-project="q1"]'), lv1 = await txt(page, '[data-board-project="lv1"]');
    assert(q1.includes(`go-live ${md(day(40))}`), "go-live text: " + q1);
    assert(q1.includes("Unassigned"), "unassigned");
    // a live card says "live <liveAt>", never "go-live", and prefers liveAt over targetGoLive
    assert(/(^|[^-])live [A-Z][a-z]{2} \d{1,2}/.test(lv1) && !lv1.includes("go-live"), "live text: " + lv1);
    assert(lv1.includes(`live ${md(day(-20))}`) && !lv1.includes(md(day(-30))), "liveAt preferred: " + lv1);
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

/* ------------------------------ Task 3: project detail ------------------------------ */
const H = (from, to, at, by = "Boss", note = "") => ({ from, to, at, by, note });
const D_ACCTS = [...ACCTS, { ...seedAccount({ id: "a9", name: "Nocsm Labs" }), csm: "" }];
const D_PROJECTS = [...PROJECTS,
  proj("d1", "a3", "in_progress", "u2", day(-5), { startedAt: "2026-10-06T09:00:00.000Z", history: [
    H("handover", "queued", "2026-10-01T09:00:00.000Z", "Cara", "Handover submitted"),
    H("queued", "planning", "2026-10-02T09:00:00.000Z", "Boss", "Assigned to Ivy"),
    H("planning", "in_progress", "2026-10-06T09:00:00.000Z", "Ivy")] }),
  proj("nc1", "a9", "planning", "u2", day(40)),
];
const dtask = (id, projectId, status, est, logged, o = {}) => ({ ...task(id, projectId, status), title: "T " + id, estHours: est,
  timeLog: logged ? [{ by: "Ivy", at: "2026-10-10T09:00:00.000Z", hours: logged }] : [], ...o });
const D_TASKS = [...TASKS, dtask("x1", "d1", "done", 2, 2, { order: 1 }), dtask("x2", "d1", "doing", 8, 9, { order: 2 }), dtask("x3", "d1", "todo", 4, 0, { order: 3 }),
  dtask("s1", "cr1", "done", 2, 2, { order: 1 }), dtask("s2", "cr1", "done", 2, 2, { order: 2 })];
const dseed = (role = "admin") => seed(role).replace(rows(ACCTS), rows(D_ACCTS)).replace(rows(PROJECTS), rows(D_PROJECTS)).replace(rows(TASKS), rows(D_TASKS));
async function openDetail(id, { role = "admin", w = 1440 } = {}) {
  const r = await launch(dseed(role));
  await r.page.setViewportSize({ width: 1440, height: 900 }); // the sidebar button is hidden at phone width
  await r.page.click('button[title="Implementation"]').catch(() => {});
  await r.page.waitForSelector("[data-board-project]");
  const card = r.page.locator(`[data-board-project="${id}"]`);
  if (!(await card.isVisible())) await r.page.locator("details[data-board-collapsed]", { has: card }).locator("summary").click();
  await card.click();
  await r.page.waitForSelector(`[data-project-detail="${id}"]`);
  if (w !== 1440) { await r.page.setViewportSize({ width: w, height: 900 }); await r.page.waitForTimeout(600); }
  return r;
}

test("detail header card: h1, stage pill, sub line, back link", async () => {
  const { page, browser } = await openDetail("d1");
  try {
    assert(await txt(page, "[data-project-detail] h1") === "Stark Industries", "h1");
    assert(await txt(page, "[data-project-stage]") === "In progress", "stage");
    assert(await txt(page, "[data-project-sub]") === "Account Stark Industries · CSM Cara", "sub: " + await txt(page, "[data-project-sub]"));
    assert(await page.locator("[data-project-sub] [data-project-account]").count() === 1, "account link");
    assert(await page.locator("[data-stage-action]").count() > 0, "admin sees actions");
    assert(await txt(page, "[data-project-back]") === "← Implementation", "back text");
    await page.click("[data-project-back]");
    await page.waitForSelector("[data-board-project]");
  } finally { await browser.close(); }
  const b = await openDetail("nc1");
  try {
    assert(await txt(b.page, "[data-project-sub]") === "Account Nocsm Labs", "no-CSM sub: " + await txt(b.page, "[data-project-sub]"));
  } finally { await b.browser.close(); }
});

test("detail stat cards: four, go-live severity, progress text", async () => {
  const { page, browser } = await openDetail("d1");
  try {
    assert(await page.locator("[data-project-stat]").count() === 4, "four stats");
    for (const k of ["implementer", "golive", "progress", "started"]) assert(await page.locator(`[data-project-stat="${k}"]`).count() === 1, "stat " + k);
    assert(await page.locator('[data-project-stat="golive"]').getAttribute("data-sev") === "red", "passed = red");
    const pr = await txt(page, '[data-project-stat="progress"]');
    assert(pr.includes("1/3 tasks") && pr.includes("11h logged of 14h est."), "progress: " + pr);
    assert((await txt(page, '[data-project-stat="implementer"]')).includes("Ivy"), "implementer");
  } finally { await browser.close(); }
  const b = await openDetail("ip2");
  try { assert(await b.page.locator('[data-project-stat="golive"]').getAttribute("data-sev") === "amber", "<=14d = amber"); }
  finally { await b.browser.close(); }
  const c = await openDetail("pl1");
  try { assert(!(await c.page.locator('[data-project-stat="golive"]').getAttribute("data-sev")), "40d = no sev"); }
  finally { await c.browser.close(); }
});

test("detail columns: checklist beside the plan at 1440, below at 390", async () => {
  for (const [w, beside] of [[1440, true], [390, false]]) {
    const { page, browser } = await openDetail("d1", { w });
    try {
      const plan = await page.locator("[data-project-plan]").boundingBox(), chk = await page.locator("[data-project-checklist]").boundingBox();
      assert(plan && chk, "both cards at " + w);
      if (beside) assert(chk.x > plan.x + plan.width - 1, "beside at 1440");
      else assert(chk.y >= plan.y + plan.height - 1, "below at 390");
      if (!beside) {
        const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth ? "" : document.documentElement.scrollWidth + " " +
          [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).slice(-4).map(e => e.tagName + "." + e.className + "[" + Math.round(e.getBoundingClientRect().right) + "]").join(" | "));
        assert(wide === "", "no page h-scroll at 390: " + wide);
      }
    } finally { await browser.close(); }
  }
});

test("detail task pills and over-estimate ink", async () => {
  const { page, browser } = await openDetail("d1");
  try {
    const pills = await page.$$eval("[data-task-pill]", es => es.map(e => e.textContent.trim()));
    assert(JSON.stringify(pills) === JSON.stringify(["Done", "Doing", "To do"]), "pills " + pills);
    assert(await page.locator('[data-task-row="x2"] [data-task-logged]').getAttribute("data-over") === "true", "9h/8h is over");
    assert(await page.locator('[data-task-row="x1"] [data-task-logged]').getAttribute("data-over") === null, "2h/2h not over");
    assert((await txt(page, "[data-project-plan] h2")).includes("(1/3 done · 11h / 14h)"), "plan title");
  } finally { await browser.close(); }
});

test("detail history: newest first with From → To", async () => {
  const { page, browser } = await openDetail("d1");
  try {
    const h = await page.$$eval("[data-history-row]", es => es.map(e => e.textContent.trim()));
    assert(h.length === 3 && h[0].includes("Planning → In progress") && h[1].includes("Queued → Planning"), "history " + h.join(" | "));
    assert(h[1].includes("Assigned to Ivy") && h[1].includes("Boss"), "meta " + h[1]);
  } finally { await browser.close(); }
});

test("detail: states the preview does not draw keep working", async () => {
  const a = await openDetail("q1");
  try {
    await a.page.click('[data-stage-action="assign"]');
    await a.page.click('[data-assign-row="u2"] button');
    await a.page.waitForSelector('[data-project-detail="q1"][data-stage="planning"]');
    assert(await txt(a.page, "[data-project-implementer]") === "Ivy", "assigned");
  } finally { await a.browser.close(); }
  const b = await openDetail("d1");
  try {
    await b.page.evaluate(() => { window.prompt = () => "Customer freeze"; });
    await b.page.click('[data-stage-action="hold"]');
    await b.page.waitForSelector('[data-project-detail="d1"][data-stage="on_hold"]');
    assert((await txt(b.page, "[data-project-detail]")).includes("On hold: Customer freeze"), "hold reason");
    await b.page.click('[data-stage-action="resume"]');
    await b.page.waitForSelector('[data-project-detail="d1"][data-stage="in_progress"]');
  } finally { await b.browser.close(); }
  const c = await openDetail("cr1");
  try {
    await c.page.click('[data-task-row="s1"] [data-task-signoff]');
    await c.page.waitForSelector('[data-task-row="s1"] [data-task-signed]');
    await c.page.click('[data-task-row="s2"] [data-task-sendback]');
    await c.page.fill("[data-sendback-note]", "Fix the import");
    await c.page.click("[data-sendback-confirm]");
    await c.page.waitForSelector('[data-task-row="s2"] [data-task-returned]');
  } finally { await c.browser.close(); }
  const d = await openDetail("hd1");
  try {
    assert(await d.page.locator("[data-project-checklist] [data-draft-checklist]").count() === 1, "draft form in checklist card");
    assert(await d.page.locator("[data-save-draft]").count() === 1 && await d.page.locator("[data-submit-handover]").count() === 1, "draft buttons");
  } finally { await d.browser.close(); }
});

test("detail: read-only implementer sees pills but no actions or selects", async () => {
  const { page, browser } = await openDetail("d1", { role: "impl_user" });
  try {
    assert(await page.locator("[data-task-pill]").count() === 3, "pills visible");
    assert(await page.locator("[data-stage-action]").count() === 0, "no actions");
    assert(await page.locator("[data-task-status]").count() === 0, "no status selects");
    assert(await page.locator("[data-project-stat]").count() === 4, "stats visible");
  } finally { await browser.close(); }
});

test("detail: unknown account has no account link", async () => {
  const { page, browser } = await openDetail("un1");
  try {
    assert(await txt(page, "[data-project-detail] h1") === "Unknown account", "h1");
    assert(await page.locator("[data-project-account]").count() === 0, "no link");
    const sub = await page.locator("[data-project-sub]").count() ? await txt(page, "[data-project-sub]") : "";
    assert(!/(^|\s)·(\s|$)/.test(sub.replace(/ · CSM /, "")) && !sub.startsWith("·") && !sub.endsWith("·"), "sub has no stray dot: " + sub);
    assert((await txt(page, "[data-project-detail] [data-avatar]")) === "?", "? avatar");
  } finally { await browser.close(); }
});
