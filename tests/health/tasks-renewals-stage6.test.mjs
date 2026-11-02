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

// ---------------------------------------------------------------- Task 3: Renewals page
// Seeds renewals at fixed day offsets (none on a window boundary) plus one past-due renewal dated
// in the previous month (owner addition: leading "Past due" board column). All USD, distinct ARR.
const LONG_NAME = "Massively Long Enterprise Holdings Name For Truncation Test1"; // 60 chars
const firstOfMonth = new Date(); firstOfMonth.setDate(1);
const localIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const PAST_DUE = localIso(new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), -4)); // 5 days before the 1st
const RN = [
  // seeded latest-first so the order tests bite
  seedAccount({ id: "r295", name: LONG_NAME, arr: 320000, renewalDate: day(295), csm: "" }),
  seedAccount({ id: "r195", name: "Hooli Media", arr: 60000, renewalDate: day(195) }),
  seedAccount({ id: "r115", name: "Acme Retail India", arr: 74000, renewalDate: day(115), renewalStage: "At risk", contractStatus: "Notice given" }),
  seedAccount({ id: "r80", name: "Umbrella Health", arr: 150000, renewalDate: day(80), renewalStage: "At risk" }),
  seedAccount({ id: "r65", name: "Wayne Logistics", arr: 118000, renewalDate: day(65), renewalStage: "Committed" }),
  seedAccount({ id: "r50", name: "Initech Software", arr: 90000, renewalDate: day(50), renewalStage: "Outreach", inputs: { usage: 40, sentiment: 40, tickets: 3, nps: 0 } }),
  seedAccount({ id: "r25", name: "Globex Corporation", arr: 240000, renewalDate: day(25), renewalStage: "Negotiating" }),
  seedAccount({ id: "r15", name: "Soylent Foods", arr: 38000, renewalDate: day(15), renewalStage: "Quote sent", inputs: { usage: 10, sentiment: 10, tickets: 9, nps: -50 } }),
  seedAccount({ id: "rpast", name: "Overdue Renewal Co", arr: 55000, renewalDate: PAST_DUE }),
];
const RN_TASKS = [
  { id: "pb-behind", accountId: "r15", title: "▶ Send renewal quote", due: day(-3), priority: "High", status: "Open", owner: "Priya", playbook: true, renewalFor: day(15) },
];
const rnSeed = ({ theme = "light", accounts = RN, tasks = RN_TASKS, pre = "" } = {}) => `${pre}try { localStorage.setItem("onevio.theme", "${theme}"); } catch (e) {}
  window.__seedRows = { accounts: ${rows(accounts)}, contacts: [], activities: [], tasks: ${rows(tasks)}, opportunities: [], team: [], settings: [] };
  window.__seedProfile = { id: "u1", org_id: "org-a", name: "Priya", role: "admin" };`;
async function openRn({ theme = "light", w = 1440, ...o } = {}) {
  const r = await launch(rnSeed({ theme, ...o }));
  if (theme !== "light") await r.page.reload();
  await r.page.setViewportSize({ width: w, height: 1000 });
  await r.page.waitForFunction(n => window.__store && window.__store.getState().accounts.length >= n, (o.accounts || RN).length);
  await r.page.click('button[title="Renewals"]');
  await r.page.waitForSelector("[data-renewals-subtitle]");
  return r;
}
const forecastText = page => page.$$eval("[data-forecast]", e => e.map(x => x.dataset.forecast + "=" + x.querySelector("[data-forecast-value]").textContent.trim()).join());
const boardCards = page => page.$$eval("[data-col-month] [data-renewal-card]", e => e.map(x => x.dataset.renewalCard));
const tableRows = page => page.$$eval("[data-renewal-row]", e => e.map(x => x.dataset.renewalRow));
const pastDays = () => -Math.ceil((new Date(PAST_DUE) - Date.now()) / DAY); // = -daysUntil(PAST_DUE)

test("stage6 renewals: forecast strip equals the old formulas and never moves with the window", async () => {
  const { page, browser } = await openRn();
  try {
    // OLD formulas, copied from src/23-renewals.jsx before Stage 6
    const want = await page.evaluate(() => {
      const st = window.__store.getState(), rates = st.settings.rates;
      const scored = st.accounts.filter(a => !a.churn).map(a => ({ ...a, arrUSD: window.__health.toUSD(a.arr, a.currency, rates) }));
      const stage = a => a.renewalStage || "Not started";
      const due90 = scored.filter(a => { const d = daysUntil(a.renewalDate); return d >= 0 && d <= 90; });
      const sum = l => l.reduce((s, a) => s + a.arrUSD, 0);
      const commit = sum(due90.filter(a => stage(a) === "Committed")), atRisk = sum(due90.filter(a => stage(a) === "At risk"));
      return `due=${fmtMoney(sum(due90))},commit=${fmtMoney(commit)},best=${fmtMoney(sum(due90) - atRisk)},risk=${fmtMoney(atRisk)}`;
    });
    assert(await forecastText(page) === want, `forecast ${await forecastText(page)} want ${want}`);
    for (const k of ["0-30", "61-90", "90+"]) {
      await page.click(`[data-renewal-window="${k}"]`);
      await page.waitForSelector(`[data-renewal-window="${k}"][aria-pressed="true"]`);
      assert(await forecastText(page) === want, `forecast moved with window ${k}: ${await forecastText(page)}`);
    }
  } finally { await browser.close(); }
});

test("stage6 renewals: four window cards with renewalWindows ARR and account counts", async () => {
  const { page, browser } = await openRn();
  try {
    const want = await page.evaluate(() => {
      const st = window.__store.getState(), rates = st.settings.rates;
      const scored = st.accounts.filter(a => !a.churn).map(a => ({ ...a, arrUSD: window.__health.toUSD(a.arr, a.currency, rates) }));
      return renewalWindows(scored, new Date().toISOString().slice(0, 10)).map(w => `${w.key}|${w.label}|${fmtMoney(w.arrUSD)}|${w.count} account${w.count === 1 ? "" : "s"}|false`);
    });
    const got = await page.$$eval("[data-renewal-window]", b => b.map(x => [x.dataset.renewalWindow, x.querySelector("[data-window-label]").textContent.trim(),
      x.querySelector("[data-window-arr]").textContent.trim(), x.querySelector("[data-window-sub]").textContent.trim(), x.getAttribute("aria-pressed")].join("|")));
    assert(got.join() === want.join(), "windows " + got.join(" ; ") + " want " + want.join(" ; "));
    assert(/^0-30\|0–30 days\|.*\|2 accounts/.test(got[0]) && /^31-60\|.*\|1 account\|/.test(got[1]), "counts " + got);
  } finally { await browser.close(); }
});

test("stage6 renewals: window filter applies to board and table; second click and Clear reset it", async () => {
  const { page, browser } = await openRn();
  try {
    const all = (await boardCards(page)).sort().join();
    await page.click('[data-renewal-window="0-30"]');
    await page.waitForSelector('[data-renewal-window="0-30"][aria-pressed="true"]');
    assert(/^Showing 0–30 days · /.test(await page.textContent("[data-window-filter]")), "filter line " + await page.textContent("[data-window-filter]"));
    assert((await boardCards(page)).sort().join() === "r15,r25", "board filtered " + await boardCards(page));
    assert(await page.locator("[data-col]").count() === 12, "still 12 month lanes");
    await page.click('[data-renewals-view="table"]');
    await page.waitForSelector("[data-renewals-table]");
    assert((await tableRows(page)).join() === "r15,r25", "table filtered " + await tableRows(page));
    await page.click('[data-renewal-window="0-30"]');
    await page.waitForSelector('[data-renewal-window="0-30"][aria-pressed="false"]');
    assert(!(await page.$("[data-window-filter]")), "filter line gone after second click");
    assert((await tableRows(page)).length === RN.length, "table unfiltered " + await tableRows(page));
    await page.click('[data-renewal-window="31-60"]');
    await page.waitForSelector("[data-window-clear]");
    assert((await tableRows(page)).join() === "r50", "31-60 " + await tableRows(page));
    await page.click("[data-window-clear]");
    await page.waitForFunction(() => !document.querySelector("[data-window-filter]"));
    assert((await page.$$eval("[aria-pressed=true][data-renewal-window]", e => e.length)) === 0, "no window pressed after Clear");
    await page.click('[data-renewals-view="board"]');
    await page.waitForSelector("[data-col-month]");
    assert((await boardCards(page)).sort().join() === all, "board back to all");
  } finally { await browser.close(); }
});

test("stage6 renewals: Board/Table tabs, view remembered, broken storage falls back to Board", async () => {
  const { page, browser } = await openRn();
  try {
    const tabs = await page.$$eval('[role=tablist][aria-label="Renewals view"] [role=tab]', t => t.map(x => x.dataset.renewalsView + "=" + x.getAttribute("aria-selected")));
    assert(tabs.join() === "board=true,table=false", "tabs " + tabs);
    assert(await page.$("[data-col-month]") && !(await page.$("[data-renewals-table]")), "board is the default");
    await page.click('[data-renewals-view="table"]');
    await page.waitForSelector("[data-renewals-table]");
    await page.reload();
    await page.waitForFunction(() => window.__store);
    await page.click('button[title="Renewals"]');
    await page.waitForSelector("[data-renewals-table]");
    assert(await page.getAttribute('[data-renewals-view="table"]', "aria-selected") === "true", "table remembered");
  } finally { await browser.close(); }
  const b = await openRn({ pre: `try { localStorage.setItem("onevio.renewals.view", "table"); } catch (e) {} Storage.prototype.getItem = function () { throw new Error("blocked"); };` });
  try {
    assert(await b.page.$("[data-col-month]") && await b.page.getAttribute('[data-renewals-view="board"]', "aria-selected") === "true", "throwing storage -> Board");
  } finally { await b.browser.close(); }
});

test("stage6 renewals: board card pills, stage select dispatches only renewalStage", async () => {
  const { page, browser } = await openRn();
  try {
    const cards = await page.$$eval("[data-col-month] [data-renewal-card]", e => e.map(c => ({ id: c.dataset.renewalCard,
      name: c.querySelector("[data-renewal-name]").textContent.trim(), nameTitle: c.querySelector("[data-renewal-name]").title,
      h: c.querySelector("[data-renewal-health]").textContent.trim(), hs: c.querySelector("[data-renewal-health]").dataset.sev,
      d: c.querySelector("[data-days-chip]").textContent.trim(), line: c.querySelector("[data-renewal-arr]").textContent.trim(),
      sel: c.querySelector("select").getAttribute("aria-label"), stage: c.querySelector("select").dataset.stage,
      pb: c.querySelector("[data-playbook-progress]")?.textContent.trim(), pbs: c.querySelector("[data-playbook-progress]")?.dataset.sev })));
    const sev = { Healthy: "green", Watch: "amber", "At risk": "red" };
    for (const c of cards) {
      const m = /^\d+ · (Healthy|Watch|At risk)$/.exec(c.h);
      assert(m && sev[m[1]] === c.hs, "health pill " + JSON.stringify(c));
      assert(/^\d+d$/.test(c.d), "days " + JSON.stringify(c));
      assert(c.sel === "Renewal stage for " + c.name && c.nameTitle === c.name, "select/name " + JSON.stringify(c));
      assert(/^(Playbook \d+\/\d+ · (behind|on pace)|No playbook yet)$/.test(c.pb), "playbook " + JSON.stringify(c));
    }
    const s15 = cards.find(c => c.id === "r15"), s65 = cards.find(c => c.id === "r65");
    assert(/ · behind$/.test(s15.pb) && s15.pbs === "amber" && s15.hs !== "green", "r15 " + JSON.stringify(s15));
    assert(s15.line === "$38K · Active" && s65.stage === "Committed", "line/stage " + JSON.stringify([s15, s65]));
    const r195 = cards.find(c => c.id === "r195");
    assert(r195.pb === "No playbook yet", "no playbook " + JSON.stringify(r195));
    const snap = () => page.evaluate(() => { const a = window.__store.getState().accounts.find(x => x.id === "r195");
      return JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k]) => !["renewalStage", "audit", "updatedAt", "updatedBy"].includes(k)))); });
    const before = await snap();
    await page.selectOption('[data-renewal-card="r195"] select', "Outreach");
    await page.waitForFunction(() => window.__store.getState().accounts.find(a => a.id === "r195").renewalStage === "Outreach");
    assert(before === await snap(), "only renewalStage changed");
    assert(await page.getAttribute('[data-renewal-card="r195"] select', "data-stage") === "Outreach", "stage colour follows");
  } finally { await browser.close(); }
});

test("stage6 renewals: lanes ascend from this month, cards and table rows ascend by date", async () => {
  const { page, browser } = await openRn();
  try {
    const lanes = await page.$$eval("[data-col-month]", e => e.map(x => x.dataset.colMonth));
    const now = new Date(), first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    assert(lanes.length === 12 && lanes[0] === first && lanes.every((m, i) => !i || m > lanes[i - 1]), "lanes " + lanes);
    const labels = await page.$$eval("[data-col-month] h2", e => e.map(x => x.textContent.trim()));
    assert(/^[A-Z][a-z]{2} \d{4}$/.test(labels[0]), "lane label " + labels[0]);
    const order = ["r15", "r25", "r50", "r65", "r80", "r115", "r195", "r295"];
    assert((await boardCards(page)).join() === order.join(), "board order " + await boardCards(page));
    const empty = await page.$$eval("[data-col-month]", e => e.filter(x => !x.querySelector("[data-renewal-card]")).map(x => x.querySelector("[data-lane-empty]")?.textContent.trim()));
    assert(empty.length && empty.every(t => t === "No renewals"), "empty lanes " + empty);
    await page.click('[data-renewals-view="table"]');
    await page.waitForSelector("[data-renewals-table]");
    assert((await tableRows(page)).join() === ["rpast", ...order].join(), "table order " + await tableRows(page));
  } finally { await browser.close(); }
});

test("stage6 renewals: leading Past due column (owner addition) -- card, table pill, window filter empties it", async () => {
  const { page, browser } = await openRn();
  try {
    const lane = await page.evaluate(() => {
      const board = document.querySelector("[data-board]"), l = document.querySelector("[data-col-past-due]");
      const first = board && [...board.querySelectorAll("[data-col-past-due], [data-col-month]")][0];
      return l && { first: first === l, h: l.querySelector("h2").textContent.trim(), hColor: getComputedStyle(l.querySelector("h2")).color,
        fg: getComputedStyle(document.querySelector("[data-col-month] h2")).color, count: l.querySelector("[data-lane-count]")?.textContent.trim(),
        total: l.querySelector("[data-lane-total]")?.textContent.trim(), cards: [...l.querySelectorAll("[data-renewal-card]")].map(c => c.dataset.renewalCard),
        chip: l.querySelector("[data-days-chip]")?.textContent.trim(), band: l.querySelector("[data-days-chip]")?.dataset.daysChip, sev: l.querySelector("[data-days-chip]")?.dataset.sev };
    });
    const n = pastDays();
    assert(lane && lane.first && lane.h === "Past due" && lane.hColor !== lane.fg, "past-due lane " + JSON.stringify(lane));
    assert(lane.count === "1" && lane.total === "$55K USD" && lane.cards.join() === "rpast", "past-due count/total " + JSON.stringify(lane));
    assert(lane.chip === `${n}d overdue` && lane.band === "overdue" && lane.sev === "red", "overdue pill " + JSON.stringify(lane));
    assert(await page.locator("[data-col]").count() === 12, "Past due is not one of the 12 month lanes");
    assert(!(await page.$("[data-col-month] [data-renewal-card=rpast]")), "past-due card only in the Past due lane");
    await page.click('[data-renewal-window="0-30"]');
    await page.waitForSelector('[data-renewal-window="0-30"][aria-pressed="true"]');
    assert(await page.locator("[data-col-past-due] [data-renewal-card]").count() === 0, "window filter empties Past due");
    await page.click('[data-renewal-window="0-30"]');
    await page.click('[data-renewals-view="table"]');
    await page.waitForSelector("[data-renewal-row=rpast]");
    const p = await page.$eval("[data-renewal-row=rpast] [data-days-chip]", e => [e.textContent.trim(), e.dataset.sev]);
    assert(p[0] === `${n}d overdue` && p[1] === "red", "table pill " + p);
  } finally { await browser.close(); }
});

test("stage6 renewals: no Past due column when nothing is past due; missing renewalDate does not trip the boundary", async () => {
  const accounts = [seedAccount({ id: "ok", name: "Fine Co", renewalDate: day(40) }), seedAccount({ id: "nodate", name: "No Date Co", renewalDate: "" })];
  const { page, browser } = await openRn({ accounts, tasks: [] });
  try {
    await page.waitForSelector("[data-renewal-card=ok]");
    assert(!(await page.$("[data-viewerror]")), "missing renewalDate tripped the error boundary");
    assert(!(await page.$("[data-col-past-due]")), "Past due lane shown with nothing past due");
  } finally { await browser.close(); }
});

test("stage6 renewals: table headers, right-aligned ARR, CSM dash, stage select dispatches", async () => {
  const { page, browser } = await openRn();
  try {
    await page.click('[data-renewals-view="table"]');
    await page.waitForSelector("[data-renewals-table]");
    const h = await page.$$eval("[data-renewals-table] thead th", e => e.map(x => x.textContent.trim()));
    assert(h.join() === "Account,ARR,Health,Renewal,Stage,Playbook,CSM", "headers " + h);
    const r = await page.$eval("[data-renewal-row=r295]", tr => ({ arr: tr.cells[1].textContent.trim(), al: getComputedStyle(tr.cells[1]).textAlign, csm: tr.cells[6].textContent.trim(),
      stage: tr.querySelector("select").getAttribute("aria-label") }));
    assert(r.arr === "$320K" && r.al === "right" && r.csm === "—" && r.stage === "Renewal stage for " + LONG_NAME, "row " + JSON.stringify(r));
    await page.selectOption("[data-renewal-row=r50] select", "Committed");
    await page.waitForFunction(() => window.__store.getState().accounts.find(a => a.id === "r50").renewalStage === "Committed");
  } finally { await browser.close(); }
});

const RENEWED = seedAccount({ id: "rr", name: "Renewed Co", arr: 120000, renewalDate: day(355),
  renewals: [{ id: "x1", completedOn: day(-2), from: day(-2), to: day(355), prevArr: 100000, arr: 120000, by: "Priya" }] });
test("stage6 renewals: outcomes empty line kept; closed renewals show a win-rate pill", async () => {
  const { page, browser } = await openRn({ accounts: RN.filter(a => a.id !== "rpast") }); // a past-due renewal counts as slipped
  try {
    assert(/No renewals closed yet — outcomes appear here as renewals complete\./.test(await page.textContent("[data-outcomes-empty]")), "empty text");
  } finally { await browser.close(); }
  const b = await openRn({ accounts: [RENEWED], tasks: [] });
  try {
    await b.page.waitForSelector(".rn-outcomes .ad-pill[data-sev]");
    const t = await b.page.$eval(".rn-outcomes .ad-pill[data-sev]", e => [e.textContent.trim(), e.dataset.sev]);
    assert(t[0] === "100%" && t[1] === "green", "win-rate pill " + t);
    assert(await b.page.$eval(".rn-outcomes h2", e => e.textContent.trim()) === "Renewal outcomes by quarter", "outcomes h2");
  } finally { await b.browser.close(); }
});

for (const theme of ["light", "dark"]) test(`stage6 renewals: text contrast >= 4.5:1 (${theme})`, async () => {
  const { page, browser } = await openRn({ theme, accounts: [...RN, RENEWED] });
  try {
    await page.addScriptTag({ content: PAGE_FNS });
    const check = sels => page.evaluate(sels => {
      const { textOn } = window.__c, low = [], seen = {};
      for (const [k, sel] of Object.entries(sels)) {
        const els = document.querySelectorAll(sel); seen[k] = els.length;
        for (const e of els) { const c = textOn(e); if (c === null || c < 4.5) low.push(k + " " + (c === null ? "no bg" : c.toFixed(2)) + " " + e.textContent.trim().slice(0, 24)); }
      }
      return { low, seen, dark: document.documentElement.classList.contains("dark") };
    }, sels);
    const stages = ["Not started", "Outreach", "Quote sent", "Negotiating", "Committed", "At risk"];
    for (const [i, id] of ["r195", "r295", "r115", "r80", "r65", "r50"].entries()) await page.selectOption(`[data-renewal-card="${id}"] select`, stages[i]);
    let r = await check({ subtitle: "[data-renewals-subtitle]", tab: "[data-renewals-view]", wlabel: "[data-window-label]", warr: "[data-window-arr]", wsub: "[data-window-sub]",
      flabel: "[data-forecast] > span", lane: "[data-board] h2", total: "[data-lane-total]", count: "[data-lane-count]", name: "[data-renewal-name]", hp: "[data-renewal-health]",
      days: "[data-days-chip]", arr: "[data-renewal-arr]", stage: "[data-renewal-card] select", pb: "[data-playbook-progress]", empty: "[data-lane-empty]",
      oh: ".rn-outcomes h2", oc: ".rn-outcomes td, .rn-outcomes th" });
    assert(r.dark === (theme === "dark"), "theme applied");
    assert(r.seen.wlabel === 4 && r.seen.flabel >= 4 && r.seen.lane === 13 && r.seen.stage >= 9 && r.seen.oc > 5, "targets " + JSON.stringify(r.seen));
    assert(r.low.length === 0, "board low contrast: " + r.low.join(" | "));
    await page.click('[data-renewals-view="table"]');
    await page.waitForSelector("[data-renewals-table]");
    r = await check({ th: "[data-renewals-table] th", td: "[data-renewals-table] td", sel: "[data-renewals-table] select" });
    assert(r.seen.td > 50 && r.low.length === 0, "table low contrast: " + r.low.join(" | ") + JSON.stringify(r.seen));
  } finally { await browser.close(); }
});
