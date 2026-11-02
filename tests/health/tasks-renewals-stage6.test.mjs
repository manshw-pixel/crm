// UI Stage 6 (Task 2): the restyled Tasks work queue. Targets data-* hooks; expectations are
// derived from the store (the auto-seeder may add playbook tasks), never hard counts.
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const DAY = 86400000;
const day = n => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const rows = list => `${JSON.stringify(list)}.map(d => ({ id: d.id, data: d }))`;
const LONG = "Prepare a very long renewal business case for the steering commi"; // 64 chars
const ACCTS = [
  seedAccount({ id: "a1", name: "Northwind Analytics", csm: "Priya" }),
  seedAccount({ id: "a2", name: "Bluepeak Logistics", csm: "Marco" }),
];
const TASKS = [
  { id: "s-over", accountId: "a1", title: "▶ Send renewal quote", due: day(-19), priority: "High", status: "Open", owner: "Priya", playbook: true },
  { id: "s-hlth", accountId: "a1", title: "♥ Escalate to exec", due: day(-2), priority: "Medium", status: "Open", owner: "Priya", healthPlaybook: true },
  { id: "s-today", accountId: "a2", title: "Call the champion", due: day(0), priority: "Medium", status: "Open", owner: "Priya" },
  { id: "s-week", accountId: "a2", title: "Marco weekly check", due: day(3), priority: "Low", status: "Open", owner: "Marco" },
  { id: "s-later", accountId: "a2", title: "Plan expansion", due: day(20), priority: "Low", status: "Open", owner: "Priya" },
  { id: "s-done", accountId: "a1", title: "Old finished thing", due: day(-9), priority: "Low", status: "Done", owner: "Priya" },
  { id: "s-ghost", accountId: "gone", title: "Ghost account follow-up", due: day(0), priority: "Low", status: "Open", owner: "Priya" },
  { id: "s-long", accountId: "a2", title: LONG, due: day(25), priority: "Medium", status: "Open", owner: "Priya" },
];
const seed = (theme = "light") => `try { localStorage.setItem("onevio.theme", "${theme}"); } catch (e) {}
  window.__seedRows = { accounts: ${rows(ACCTS)}, contacts: [], activities: [], tasks: ${rows(TASKS)}, opportunities: [], team: [], settings: [] };
  window.__seedProfile = { id: "u1", org_id: "org-a", name: "Priya", role: "admin" };`;

async function open({ theme = "light", w = 1440 } = {}) {
  const r = await launch(seed(theme));
  if (theme !== "light") await r.page.reload();
  await r.page.setViewportSize({ width: w, height: 900 });
  await r.page.waitForFunction(() => window.__store && window.__store.getState().tasks.length >= 8);
  await r.page.click('button[title="Tasks"]');
  await r.page.waitForSelector("[data-tasks-subtitle]");
  await r.page.waitForSelector("[data-task-row]");
  return r;
}
// Store-derived subtitle for the current filters (scope All for this admin).
const expectSub = (page, source = "all") => page.evaluate(src => {
  const st = window.__store.getState(), H = window.__health;
  const byId = Object.fromEntries(st.accounts.map(a => [a.id, a]));
  const b = H.bucketTasks(H.filterTasks(st.tasks, byId, { scope: "all", userName: "Priya", source: src }), new Date().toISOString().slice(0, 10));
  const open = b.overdue.length + b.today.length + b.week.length + b.later.length;
  return `${open} open · ${b.overdue.length} overdue · ${b.today.length} due today · ${b.week.length} this week`;
}, source);
const subText = page => page.$eval("[data-tasks-subtitle]", e => e.textContent.trim());
const sections = page => page.$$eval("section[data-task-section]", s => s.map(x => ({
  key: x.dataset.taskSection, label: x.getAttribute("aria-label"),
  exp: x.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded"),
  count: x.querySelector("[data-section-count]")?.textContent.trim(), rows: x.querySelectorAll("[data-task-row]").length })));

test("stage6 tasks: subtitle counts follow the store and the Source filter", async () => {
  const { page, browser } = await open();
  try {
    let want = await expectSub(page);
    await page.waitForFunction(w => document.querySelector("[data-tasks-subtitle]").textContent.trim() === w, want, { timeout: 5000 }).catch(() => {});
    assert(await subText(page) === want, `subtitle ${await subText(page)} want ${want}`);
    await page.selectOption('select[title="Source"]', "manual");
    want = await expectSub(page, "manual");
    await page.waitForFunction(w => document.querySelector("[data-tasks-subtitle]").textContent.trim() === w, want, { timeout: 5000 }).catch(() => {});
    assert(await subText(page) === want && /· 0 overdue ·/.test(want), `manual subtitle ${await subText(page)} want ${want}`);
  } finally { await browser.close(); }
});

test("stage6 tasks: five stacked sections in order, Overdue + Today open, headers toggle", async () => {
  const { page, browser } = await open();
  try {
    const s = await sections(page);
    assert(s.map(x => x.key).join() === "overdue,today,week,later,done", "order " + JSON.stringify(s));
    assert(s.map(x => x.label).join() === "Overdue,Today,This week,Later,Done", "labels " + s.map(x => x.label));
    assert(s.map(x => x.exp).join() === "true,true,false,false,false", "expanded " + s.map(x => x.exp));
    assert(s[0].rows >= 2 && s[2].rows === 0 && s[0].count === String(s[0].rows), "rows " + JSON.stringify(s));
    const hints = await page.$$eval("[data-task-section] [data-section-hint]", e => e.map(x => x.textContent.trim()));
    assert(hints[0] === "oldest first" && /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/.test(hints[1]) && hints[2] === "next 7 days", "hints " + hints);
    await page.click('[data-task-section="week"] > button');
    await page.waitForSelector('[data-task-section="week"] [data-task-row]');
    assert((await sections(page))[2].exp === "true", "week header should report expanded");
    await page.click('[data-task-section="overdue"] > button');
    await page.waitForFunction(() => !document.querySelector('[data-task-section="overdue"] [data-task-row]'));
    assert((await sections(page))[0].exp === "false", "overdue header should report collapsed");
    const chev = await page.$$eval("[data-task-section] > button svg", e => e.length);
    assert(chev === 5, "chevron svg per header " + chev);
  } finally { await browser.close(); }
});

test("stage6 tasks: row look -- due pill, priority tag, word source tags, no glyphs, named checkbox", async () => {
  const { page, browser } = await open();
  try {
    const r = await page.evaluate(() => {
      const row = id => [...document.querySelectorAll("[data-task-row]")].find(x => x.querySelector("[data-task-title]").textContent.trim() === id);
      const d = r => r && { due: r.querySelector("[data-task-due]")?.textContent.trim(), sev: r.querySelector("[data-task-due]")?.dataset.sev,
        chip: !!r.querySelector('[data-days-chip="overdue"]'), pri: r.querySelector("[data-task-priority]")?.textContent.trim(),
        psev: r.querySelector("[data-task-priority]")?.dataset.sev, src: r.querySelector("[data-task-source]")?.dataset.taskSource,
        srcText: r.querySelector("[data-task-source]")?.textContent.trim(), srcLabel: r.querySelector("[data-task-source]")?.getAttribute("aria-label"),
        box: r.querySelector('input[type=checkbox]')?.getAttribute("aria-label"), boxTitle: r.querySelector('input[type=checkbox]')?.title,
        acct: r.querySelector("[data-task-account]")?.textContent.trim() };
      return { over: d(row("Send renewal quote")), hlth: d(row("Escalate to exec")), today: d(row("Call the champion")), ghost: d(row("Ghost account follow-up")),
        main: document.querySelector("main").textContent };
    });
    assert(r.over && /^Overdue · 19d$/.test(r.over.due) && r.over.sev === "red" && r.over.chip, "overdue due " + JSON.stringify(r.over));
    assert(r.over.pri === "High" && r.over.psev === "red", "High priority " + JSON.stringify(r.over));
    assert(r.over.src === "renewal" && r.over.srcText === "Renewal" && r.over.srcLabel === "Renewal playbook step", "renewal tag " + JSON.stringify(r.over));
    assert(r.over.box === "Complete Send renewal quote" && r.over.boxTitle === "Complete", "checkbox " + JSON.stringify(r.over));
    assert(r.over.acct === "Northwind Analytics", "account link " + r.over.acct);
    assert(r.hlth.src === "health" && r.hlth.srcText === "Health" && r.hlth.srcLabel === "Health playbook step" && r.hlth.pri === "Medium" && r.hlth.psev === "amber", "health " + JSON.stringify(r.hlth));
    assert(r.today.due === "Today" && r.today.sev === "grey" && !r.today.chip && r.today.src === undefined, "today " + JSON.stringify(r.today));
    assert(r.ghost.pri === "Low" && r.ghost.psev === "grey" && r.ghost.acct === "—", "ghost " + JSON.stringify(r.ghost));
    assert(!/[▶♥]/.test(r.main) && /Send renewal quote/.test(r.main), "glyphs must be gone from main");
    const legend = await page.textContent("[data-source-legend]");
    assert(legend.trim() === "Tags: Renewal / Health = playbook step · untagged = added by hand", "legend " + legend);
  } finally { await browser.close(); }
});

test("stage6 tasks: dashboard hand-off unchanged (overdue-only, owner chip, sidebar clears)", async () => {
  const { page, browser } = await open();
  try {
    await page.click('button[title="Dashboard"]');
    await page.evaluate(() => window.__goTasks({ overdue: true }));
    await page.waitForFunction(() => { const s = [...document.querySelectorAll("[data-task-section]")];
      return s.length >= 3 && s.every(x => x.querySelector("[aria-expanded]").getAttribute("aria-expanded") === (x.dataset.taskSection === "overdue" ? "true" : "false")); }, null, { timeout: 8000 });
    const s = await sections(page);
    assert(s.filter(x => x.exp === "true").map(x => x.key).join() === "overdue" && s[1].rows === 0, "overdue only " + JSON.stringify(s));
    await page.evaluate(() => window.__goTasks({ owner: "Marco" }));
    await page.waitForSelector("[data-task-owner-filter]");
    await page.click('[data-task-section="week"] > button');
    await page.waitForSelector('[data-task-section="week"] [data-task-row]');
    const t = await page.$$eval("[data-task-row] [data-task-title]", e => e.map(x => x.textContent.trim()));
    assert(t.join() === "Marco weekly check", "Marco rows " + t);
    await page.click('button[title="Tasks"]');
    await page.waitForFunction(() => !document.querySelector("[data-task-owner-filter]"));
    const all = await page.$$eval("[data-task-row] [data-task-title]", e => e.map(x => x.textContent.trim()));
    assert(all.includes("Send renewal quote"), "unfiltered after sidebar " + all);
  } finally { await browser.close(); }
});

test("stage6 tasks: flows unchanged -- tick completes, +1 week leaves Overdue, empty states verbatim", async () => {
  const { page, browser } = await open();
  try {
    await page.click('[data-task-section="overdue"] [data-task-row] input[type=checkbox]');
    await page.waitForFunction(() => window.__store.getState().tasks.find(t => t.id === "s-over").status === "Done");
    await page.locator('[data-task-section="overdue"] select[title="Reschedule"]').first().selectOption("7");
    await page.waitForFunction(w => window.__store.getState().tasks.find(t => t.id === "s-hlth").due === w, new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
    await page.waitForFunction(() => !document.querySelector('[data-task-section="overdue"]'));
    await page.fill('input[placeholder="Search tasks…"]', "zzzznothing");
    await page.waitForFunction(() => /No tasks match these filters\./.test(document.querySelector("main").textContent));
    assert(!(await page.$("[data-task-section]")), "no sections when nothing matches");
  } finally { await browser.close(); }
});

test("stage6 tasks: Scope group buttons carry aria-pressed", async () => {
  const { page, browser } = await open();
  try {
    const read = () => page.$$eval('[role=group][aria-label="Scope"] button', b => b.map(x => x.textContent.trim() + "=" + x.getAttribute("aria-pressed")));
    assert((await read()).join() === "Mine=false,All=true", "initial " + await read());
    await page.click('[role=group][aria-label="Scope"] button:has-text("Mine")');
    await page.waitForFunction(() => document.querySelector('[role=group][aria-label="Scope"] button').getAttribute("aria-pressed") === "true");
    assert((await read()).join() === "Mine=true,All=false", "after Mine " + await read());
    const labels = await page.$$eval("main label", l => l.map(x => (x.firstChild?.textContent || "").trim()));
    assert(labels.includes("Source") && labels.includes("Health") && labels.includes("Search tasks"), "visible/hidden labels " + labels);
  } finally { await browser.close(); }
});

const PAGE_FNS = `window.__c = (() => {
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = s => (s.match(/[\\d.]+/g) || [0, 0, 0]).map(Number);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const rgba = s => { const c = parse(s); return c.length < 4 ? [...c.slice(0, 3), 1] : c.slice(0, 4); };
  const over = (top, a, base) => top.map((v, i) => v * a + base[i] * (1 - a));
  const opOf = e => { let o = 1; for (let x = e; x; x = x.parentElement) o *= +getComputedStyle(x).opacity; return o; };
  const bgOf = e => { const layers = [];
    for (let x = e; x; x = x.parentElement) { const c = rgba(getComputedStyle(x).backgroundColor), a = c[3] * opOf(x);
      if (a >= 1) return layers.reduceRight((b, [col, al]) => over(col, al, b), c.slice(0, 3)); if (a > 0) layers.push([c.slice(0, 3), a]); }
    return null; };
  const textOn = e => { const bg = bgOf(e); if (!bg) return null; const c = rgba(getComputedStyle(e).color); return ratio(over(c.slice(0, 3), c[3] * opOf(e), bg), bg); };
  return { textOn };
})();`;
for (const theme of ["light", "dark"]) test(`stage6 tasks: text contrast >= 4.5:1 (${theme})`, async () => {
  const { page, browser } = await open({ theme });
  try {
    await page.addScriptTag({ content: PAGE_FNS });
    const r = await page.evaluate(() => {
      const { textOn } = window.__c, low = [], seen = {};
      const sels = { subtitle: "[data-tasks-subtitle]", section: "[data-task-section] h2", count: "[data-section-count]", title: "[data-task-title]",
        account: "[data-task-account]", tag: "[data-task-source]", due: "[data-task-due]", pri: "[data-task-priority]", legend: "[data-source-legend]" };
      for (const [k, sel] of Object.entries(sels)) {
        const els = document.querySelectorAll(sel); seen[k] = els.length;
        for (const e of els) { const c = textOn(e); if (c === null || c < 4.5) low.push(k + " " + (c === null ? "no bg" : c.toFixed(2)) + " " + e.textContent.trim().slice(0, 24)); }
      }
      return { low, seen, dark: document.documentElement.classList.contains("dark") };
    });
    assert(r.dark === (theme === "dark"), "theme applied");
    assert(r.seen.subtitle === 1 && r.seen.section === 5 && r.seen.title >= 4 && r.seen.tag >= 2 && r.seen.due >= 4 && r.seen.pri >= 4, "targets " + JSON.stringify(r.seen));
    assert(r.low.length === 0, "low contrast: " + r.low.join(" | "));
  } finally { await browser.close(); }
});
