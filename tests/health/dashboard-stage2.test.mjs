// Dashboard stage 2: header (date line, greeting, "Whole team", quiet Saved, 42px bell).
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const A = [seedAccount({ id: "s1", name: "Stage Co", csm: "Priya Shah" })];
const rows = `window.__seedRows = { accounts: ${JSON.stringify(A.map(d => ({ id: d.id, data: d })))},
  contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };
  window.__seedProfile = { id: "u1", name: "Priya Shah", role: "admin", org_id: "org-a", platform_admin: false };`;
const ready = page => page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 1);
const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; }, sel);

test("dashboard header: date line, greeting, scope labels, no search, 42px bell", async () => {
  const { page, browser } = await launch(rows);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ready(page);
    await page.waitForSelector("[data-dash-greeting]");
    const date = (await page.textContent("[data-dash-date]")).trim();
    assert(/^[A-Z][a-z]+day, \d{1,2} [A-Z][a-z]+$/.test(date), "date line: " + date);
    const greet = (await page.textContent("[data-dash-greeting]")).trim();
    assert(/^Good (morning|afternoon|evening), Priya$/.test(greet), "greeting: " + greet);
    const labels = await page.$$eval("[data-scope-toggle] button", bs => bs.map(b => b.textContent.trim()));
    assert(labels.length === 2 && /^My book/.test(labels[0]) && labels[1] === "Whole team", "scope labels: " + labels);
    assert(!(await visible(page, '[data-sync-status="saved"]')), "Saved must be hidden on Dashboard");
    assert(await page.$('[data-sync-status="saved"]'), "saved status still in the DOM for assistive tech");
    const search = await page.$$eval('main > div:first-child input[placeholder^="Search"]', e => e.length);
    assert(search === 0, "no search box in the Dashboard header: " + search);
    const h = await page.$eval("[data-bell]", e => e.getBoundingClientRect().height);
    assert(h === 42, "bell height: " + h);
  } finally { await browser.close(); }
});

test("Saved stays visible on Accounts (hidden only on Dashboard)", async () => {
  const { page, browser } = await launch(rows);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ready(page);
    await page.waitForSelector("[data-dash-greeting]");
    await page.locator("aside").getByText("Accounts", { exact: true }).first().click();
    await page.waitForSelector('[data-sync-status="saved"]');
    assert(!(await page.$("[data-dash-greeting]")), "greeting only on Dashboard");
    assert(await visible(page, '[data-sync-status="saved"]'), "Saved visible on Accounts");
  } finally { await browser.close(); }
});

const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rgb = s => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);

for (const theme of ["light", "dark"]) test(`bell badge text contrast >= 4.5:1 (${theme})`, async () => {
  const { page, browser } = await launch(`try { localStorage.setItem("onevio.theme", "${theme}"); } catch (e) {}` + rows);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload(); await ready(page);
    await page.waitForSelector("[data-dash-greeting]");
    // the badge only renders with unread alerts: force one in the DOM if none is derived from the seed
    const c = await page.evaluate(() => {
      const b = document.querySelector("[data-bell]");
      let s = b.querySelector(":scope > span");
      if (!s) { s = document.createElement("span"); s.className = "absolute"; s.textContent = "1"; b.appendChild(s); }
      const cs = getComputedStyle(s); return [cs.color, cs.backgroundColor, cs.fontSize];
    });
    const r = ratio(rgb(c[0]), rgb(c[1]));
    assert(r >= 4.5, `badge contrast ${r.toFixed(2)} (${c})`);
    assert(c[2] === "10.5px", "badge font: " + c[2]);
  } finally { await browser.close(); }
});

// Pills must land on Accounts actually filtered, not just navigate there.
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const P = [
  seedAccount({ id: "g1", name: "Green One", csm: "Priya Shah", inputs: { usage: 95, sentiment: 95, tickets: 0, nps: 60 }, nextQbrDate: day(10), qbrFrequency: "Quarterly" }),
  seedAccount({ id: "y1", name: "Yellow One", csm: "Priya Shah", inputs: { usage: 55, sentiment: 55, tickets: 3, nps: 0 }, nextQbrDate: day(120), qbrFrequency: "Quarterly" }),
  seedAccount({ id: "r1", name: "Red One", csm: "Priya Shah", inputs: { usage: 5, sentiment: 5, tickets: 20, nps: -80 }, nextQbrDate: day(-5), qbrFrequency: "Quarterly" }),
];
const pillRows = `window.__seedRows = { accounts: ${JSON.stringify(P.map(d => ({ id: d.id, data: d })))},
  contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [] };
  window.__seedProfile = { id: "u1", name: "Priya Shah", role: "admin", org_id: "org-a", platform_admin: false };`;

test("health and QBR pills open Accounts filtered to exactly the matching accounts", async () => {
  const { page, browser } = await launch(pillRows);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 3);
    const names = async () => (await page.$$eval("[data-account-row]", r => r.map(x => x.textContent))).map(t => ["Green One", "Yellow One", "Red One"].filter(n => t.includes(n))[0]).sort();
    const cases = [["Healthy", ["Green One"], "Green"], ["Watch", ["Yellow One"], "Yellow"], ["At risk", ["Red One"], "Red"], ["QBRs due (30d)", ["Green One", "Red One"], "All"]];
    for (const [pill, want, riskSel] of cases) {
      await page.goto(page.url()); // fresh dashboard each time
      await page.waitForFunction(() => window.__store && window.__store.getState().accounts.length === 3);
      await page.waitForSelector(`[data-health-pill="${pill}"]`);
      await page.click(`[data-health-pill="${pill}"]`);
      await page.waitForSelector("[data-account-row]");
      const got = await names();
      assert(JSON.stringify(got) === JSON.stringify([...want].sort()), `${pill}: rows ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
      const sel = await page.$eval('select[aria-label="Filter by health risk"]', e => e.value);
      assert(sel === riskSel, `${pill}: health filter ${sel}, wanted ${riskSel}`);
    }
  } finally { await browser.close(); }
});

// Top panels: Renewals 90d, Needs attention, week tasks, Implementation.
const T = [
  seedAccount({ id: "n1", name: "Near Renewal", csm: "Priya Shah", renewalDate: day(12), inputs: { usage: 5, sentiment: 5, tickets: 20, nps: -80 } }),
  seedAccount({ id: "n2", name: "Later Renewal", csm: "Priya Shah", renewalDate: day(70) }),
  seedAccount({ id: "n3", name: "Far Renewal", csm: "Priya Shah", renewalDate: day(200) }),
];
const proj = (id, stage, goLive) => ({ id, accountId: "n1", type: "onboarding", stage, implementerId: null, createdBy: "x", checklistTemplate: [], checklist: {}, targetGoLive: goLive, startedAt: null, liveAt: null, holdReason: "", history: [] });
const ptask = (id, projectId, status) => ({ id, projectId, title: id, status, order: 1 });
const wrap = l => `${JSON.stringify(l)}.map(d => ({ id: d.id, data: d }))`;
const panelSeed = projects => `window.__seedRows = { accounts: ${wrap(T)}, contacts: [], activities: [], opportunities: [], team: [], settings: [],
  tasks: ${wrap([{ id: "k1", accountId: "n1", title: "Call them", due: day(-2), owner: "Priya Shah", priority: "High", status: "Open", createdAt: day(-9) }])},
  projects: ${wrap(projects)}, project_tasks: ${wrap([ptask("pt1", "p1", "done"), ptask("pt2", "p1", "open"), ptask("pt3", "p1", "open"), ptask("pt4", "p1", "open")])} };
  window.__seedProfile = { id: "u1", name: "Priya Shah", role: "admin", org_id: "org-a", platform_admin: false };`;

test("renewals panel lists only the next 90 days, soonest first, and its rows and View all navigate", async () => {
  const { page, browser } = await launch(panelSeed([]));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector("[data-renewal-row]");
    const ids = await page.$$eval("[data-renewal-row]", r => r.map(x => x.getAttribute("data-renewal-row")));
    assert(JSON.stringify(ids) === JSON.stringify(["n1", "n2"]), "rows " + JSON.stringify(ids));
    await page.click('[data-view-all="renewals"]');
    await page.waitForSelector('[data-stat="Due next 90d"]');
  } finally { await browser.close(); }
});

test("a renewals row opens its account", async () => {
  const { page, browser } = await launch(panelSeed([]));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('[data-renewal-row="n2"]');
    await page.waitForSelector("[data-transition-pill]");
  } finally { await browser.close(); }
});

test("needs-attention rows open the account; week-task checkbox completes the task", async () => {
  const { page, browser } = await launch(panelSeed([]));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector('[data-attention-row="n1"]');
    await page.waitForSelector('[data-week-task="k1"]');
    // the playbook auto-seeds more overdue tasks, so compare the pill with the rows marked Overdue
    const rowsOverdue = await page.$$eval("[data-week-task]", r => r.filter(x => /Overdue$/.test(x.textContent)).length);
    const pill = (await page.textContent("#week-tasks")).match(/(\d+) overdue/);
    assert(pill && +pill[1] === rowsOverdue && rowsOverdue >= 1, `pill ${pill && pill[1]} vs ${rowsOverdue} overdue rows`);
    await page.click('[data-week-task="k1"] input[type=checkbox]');
    await page.waitForFunction(() => window.__store.getState().tasks.find(t => t.id === "k1").status === "Done");
    await page.waitForFunction(() => !document.querySelector('[data-week-task="k1"]'));
    await page.click('[data-attention-row="n1"]');
    await page.waitForSelector("[data-transition-pill]");
  } finally { await browser.close(); }
});

test("implementation panel shows open projects with task progress, hides live ones, and opens the project", async () => {
  const { page, browser } = await launch(panelSeed([proj("p1", "in_progress", day(30)), proj("p2", "live", day(5))]));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector('[data-impl-row="p1"]');
    assert(await page.$('[data-impl-row="p2"]') === null, "live project shown");
    const w = await page.$eval('[data-impl-row="p1"] > span:last-child > span', e => e.style.width);
    assert(parseFloat(w) === 25, "progress width " + w);
    await page.click('[data-impl-row="p1"]');
    await page.waitForSelector("[data-project-stage]");
  } finally { await browser.close(); }
});

test("implementation panel is absent when nothing is open", async () => {
  const { page, browser } = await launch(panelSeed([proj("p2", "live", day(5))]));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector("[data-renewal-row]");
    assert(await page.$("[data-impl-row]") === null, "impl row present");
  } finally { await browser.close(); }
});

// More detail section.
test("team task rows open Tasks filtered to that owner; header counts team tasks due in 7 days", async () => {
  const { page, browser } = await launch(panelSeed([]));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector('[data-team-row="Priya Shah"]');
    const head = await page.$eval('[data-scroll-list="Team tasks"]', e => e.parentElement.textContent);
    assert(/\d+ due in 7 days/.test(head), "header " + head.slice(0, 60));
    await page.click('[data-team-row="Priya Shah"]');
    await page.waitForSelector("[data-task-owner-filter]");
    assert(/Priya Shah/.test(await page.textContent("[data-task-owner-filter]")), "owner chip");
  } finally { await browser.close(); }
});

test("ARR bridge header carries GRR and Churned ARR hooks with values (QA 09 reads them)", async () => {
  const { page, browser } = await launch(panelSeed([]));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector("[data-bridge-head]");
    for (const k of ["GRR (12m)", "Churned ARR (12m)"]) {
      const v = (await page.textContent(`[data-bridge-head] [data-stat="${k}"] [data-stat-value]`) || "").trim();
      assert(v.length > 0 && !/NaN|undefined/.test(v), `${k} value "${v}"`);
    }
    // the QA scenario's selector is page-global and must resolve to exactly one element
    assert((await page.$$('[data-stat="GRR (12m)"]')).length === 1, "GRR key not unique");
    await page.click('[data-stat="GRR (12m)"]');
    await page.waitForSelector("[data-accounts-page], [data-acct-row], table");
  } finally { await browser.close(); }
});

const mo = n => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - n, 1); return d.toISOString().slice(0, 7); };
const snapSeed = `window.__seedRows = { accounts: ${wrap(T)}, contacts: [], activities: [], opportunities: [], team: [], tasks: [], projects: [], project_tasks: [],
  settings: [{ id: 1, data: { snapshots: [{ month: "${mo(3)}", totalARR: 100000, nrr: 1, grr: 1, Green: 1, Yellow: 1, Red: 1 }, { month: "${mo(2)}", totalARR: 120000, nrr: 1.05, grr: 0.95, Green: 2, Yellow: 1, Red: 0 }] } }] };
  window.__seedProfile = { id: "u1", name: "Priya Shah", role: "admin", org_id: "org-a", platform_admin: false };`;

test("More detail divider shows, and monthly Trends sit inside Analytics (not above it) once 2 snapshots exist", async () => {
  const { page, browser } = await launch(snapSeed);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector("[data-dash-more]");
    await page.click("[data-analytics-toggle]");
    const where = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("h3")).filter(h => h.textContent.trim() === "Trends (monthly)");
      return { n: cards.length, inside: cards.filter(h => h.closest("[data-analytics]")).length };
    });
    assert(where.n === 1 && where.inside === 1, "Trends (monthly) cards " + JSON.stringify(where));
    assert(await page.$("[data-trends-note]") === null, "no-data note shown despite 2 snapshots");
  } finally { await browser.close(); }
});

// ---- Task 6: theme + accessibility pass. One focused check per owner-required item. ----
const A11Y = [
  seedAccount({ id: "x1", name: "Globex International Holdings Worldwide Limited", csm: "Priya Shah", renewalDate: day(12), licenses: 200, deployedLicenses: 40, inputs: { usage: 5, sentiment: 5, tickets: 20, nps: -80 } }),
  seedAccount({ id: "x2", name: "Watch Co", csm: "Priya Shah", renewalDate: day(50), inputs: { usage: 55, sentiment: 55, tickets: 3, nps: 0 } }),
  seedAccount({ id: "x3", name: "Calm Co", csm: "Priya Shah", renewalDate: day(80) }),
];
const a11ySeed = (theme, accts = A11Y) => `try { localStorage.setItem("onevio.theme", "${theme}"); localStorage.setItem("dashAnalytics_Priya Shah", "1"); } catch (e) {}
  window.__seedRows = { accounts: ${wrap(accts)}, contacts: [], activities: [], team: [],
  tasks: ${wrap([{ id: "k1", accountId: "x1", title: "Call them about the renewal", due: day(-2), owner: "Priya Shah", priority: "High", status: "Open", createdAt: day(-9) }])},
  opportunities: ${wrap([{ id: "o1", accountId: "x1", name: "Add-on", type: "Upsell", value: 40000, stage: "Proposal", probability: 50, closeDate: day(40) }])},
  projects: ${wrap([{ ...proj("p1", "in_progress", day(30)), accountId: "x1" }])}, project_tasks: ${wrap([ptask("pt1", "p1", "done"), ptask("pt2", "p1", "open")])},
  settings: [{ id: 1, data: { snapshots: [{ month: "${mo(3)}", totalARR: 100000, nrr: 1, grr: 1, Green: 1, Yellow: 1, Red: 1 }, { month: "${mo(2)}", totalARR: 120000, nrr: 1.05, grr: 0.95, Green: 2, Yellow: 1, Red: 0 }] } }] };
  window.__seedProfile = { id: "u1", name: "Priya Shah", role: "admin", org_id: "org-a", platform_admin: false };`;
async function openDash(theme, w = 1440, accts) {
  const r = await launch(a11ySeed(theme, accts));
  await r.page.reload(); // the head theme script reads the stored theme on the next load
  await r.page.setViewportSize({ width: w, height: 900 });
  await r.page.waitForSelector("[data-dash] [data-row]");
  await r.page.waitForTimeout(300);
  return r;
}
// In-page helpers: effective background (first ancestor with an opaque fill) and contrast.
const PAGE_FNS = `window.__c = (() => {
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = s => (s.match(/[\\d.]+/g) || [0, 0, 0]).map(Number);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const bgOf = e => { for (let x = e; x; x = x.parentElement) { const c = parse(getComputedStyle(x).backgroundColor); if (c.length < 4 || c[3] > 0.5) return c.slice(0, 3); } return [255, 255, 255]; };
  const shown = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  return { parse, ratio, bgOf, shown };
})();`;
const TARGETS = "[data-dash] :is(button:not(:disabled), [role=button], label.dash-check), [data-bell], [data-scope-toggle] button";

for (const theme of ["light", "dark"]) test(`dashboard text >= 4.5:1 and KPI icon tiles >= 3:1 (${theme})`, async () => {
  const { page, browser } = await openDash(theme);
  try {
    await page.addScriptTag({ content: PAGE_FNS });
    const r = await page.evaluate(() => {
      const { parse, ratio, bgOf, shown } = window.__c, low = [], tiles = [];
      for (const e of document.querySelectorAll("[data-dash] *")) {
        if (!shown(e) || e.closest("svg") || e.closest("[data-kpi-icon]")) continue;
        if (!Array.from(e.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())) continue;
        const k = ratio(parse(getComputedStyle(e).color).slice(0, 3), bgOf(e));
        if (k < 4.5) low.push(k.toFixed(2) + " " + e.textContent.trim().slice(0, 30));
      }
      for (const t of document.querySelectorAll("[data-kpi-icon]")) tiles.push(ratio(parse(getComputedStyle(t).color).slice(0, 3), bgOf(t)));
      return { low, tiles, n: document.querySelectorAll("[data-dash] [data-row]").length };
    });
    assert(r.n > 3, "precondition: panels rendered " + r.n);
    assert(r.low.length === 0, "low-contrast text: " + r.low.join(" | "));
    assert(r.tiles.length === 4 && r.tiles.every(k => k >= 3), "icon tiles: " + r.tiles.map(k => k.toFixed(2)));
  } finally { await browser.close(); }
});

for (const theme of ["light", "dark"]) test(`every dashboard click target shows a focus ring >= 3:1 (${theme})`, async () => {
  const { page, browser } = await openDash(theme);
  try {
    await page.addScriptTag({ content: PAGE_FNS });
    const ids = await page.evaluate(t => Array.from(document.querySelectorAll(t)).filter(e => window.__c.shown(e)).map((e, i) => { e.setAttribute("data-t6", i); return i; }), TARGETS);
    assert(ids.length > 20, "targets " + ids.length);
    await page.keyboard.press("Shift"); // keyboard modality, so programmatic focus is :focus-visible
    const bad = [];
    for (const i of ids) {
      const r = await page.evaluate(i => {
        const e = document.querySelector(`[data-t6="${i}"]`), f = e.matches("label") ? e.querySelector("input") : e;
        f.focus({ preventScroll: true });
        const cs = getComputedStyle(f), { parse, ratio, bgOf } = window.__c;
        return { ok: cs.outlineStyle === "solid" && parseFloat(cs.outlineWidth) >= 2, k: ratio(parse(cs.outlineColor).slice(0, 3), bgOf(f.parentElement)), what: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 25) };
      }, i);
      if (!r.ok || r.k < 3) bad.push(`${r.what} ${r.ok} ${r.k.toFixed(2)}`);
    }
    assert(bad.length === 0, "focus rings: " + bad.join(" | "));
  } finally { await browser.close(); }
});

test("reduced motion: cards, pills, rows, sparkline and progress bars neither move nor animate", async () => {
  const { page, browser } = await openDash("light");
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.hover("[data-health-pill]");
    const r = await page.evaluate(() => Array.from(document.querySelectorAll("[data-dash] :is(.nm, .dash-pill, [data-row], [data-kpi-trend], [role=progressbar])"))
      .map(e => { const cs = getComputedStyle(e); return [cs.transform, cs.animationName, cs.transitionProperty]; }));
    assert(r.length > 10, "elements " + r.length);
    const moving = r.filter(([t, a, tp]) => t !== "none" || a !== "none" || tp !== "none");
    assert(moving.length === 0, "still moving: " + JSON.stringify(moving.slice(0, 3)));
  } finally { await browser.close(); }
});

test("accessible names: spark, progress bars, week checkbox, decorative icons, names match labels", async () => {
  const { page, browser } = await openDash("light");
  try {
    const r = await page.evaluate(() => {
      const sp = document.querySelector("[data-kpi-trend]");
      const pb = document.querySelector('[data-impl-row="p1"] [role=progressbar]');
      const cb = document.querySelector('[data-week-task="k1"] input');
      const icons = Array.from(document.querySelectorAll("[data-kpi-icon], .dash-dot, .dash-av, [data-sev-bar]")).filter(e => e.getAttribute("aria-hidden") !== "true").length;
      // a button's aria-label, when set, must contain its visible text
      const mism = Array.from(document.querySelectorAll("[data-dash] :is(button, [role=button])")).filter(b => b.getAttribute("aria-label") && !b.getAttribute("aria-label").includes(b.innerText.trim())).length;
      return { sp: sp && [sp.getAttribute("role"), sp.getAttribute("aria-label"), sp.getAttribute("aria-hidden")],
        pb: pb && ["aria-valuenow", "aria-valuemin", "aria-valuemax", "aria-label"].map(a => pb.getAttribute(a)), cb: cb && cb.getAttribute("aria-label"), icons, mism };
    });
    // the app adds this month's snapshot on load, so the count is the stored series length
    const n = await page.evaluate(() => window.__store.getState().settings.snapshots.length);
    assert(JSON.stringify(r.sp) === JSON.stringify(["img", `NRR trend, last ${n} months`, null]) && n >= 2, "spark " + JSON.stringify(r.sp) + " n=" + n);
    assert(JSON.stringify(r.pb) === JSON.stringify(["50", "0", "100", "Globex International Holdings Worldwide Limited progress"]), "progressbar " + JSON.stringify(r.pb));
    assert(r.cb === "Complete Call them about the renewal", "checkbox " + r.cb);
    assert(r.icons === 0 && r.mism === 0, `undecorated icons ${r.icons}, label mismatches ${r.mism}`);
  } finally { await browser.close(); }
});

test("colour-blind safety: every status mark carries words", async () => {
  const { page, browser } = await openDash("light");
  try {
    const r = await page.evaluate(() => ({
      sev: Array.from(document.querySelectorAll("[data-attention-row]")).map(row => (row.querySelector("[data-sev]") || {}).textContent),
      pills: Array.from(document.querySelectorAll("[data-health-pill]")).map(p => p.innerText.replace(/\s+/g, " ").trim()),
      chips: Array.from(document.querySelectorAll("[data-dash] [data-days-chip]")).map(c => c.textContent.trim()),
      overdue: (document.querySelector("#week-tasks h3") || {}).textContent }));
    assert(r.sev.length >= 2 && r.sev.includes("At risk") && r.sev.includes("Watch") && r.sev.every(s => s === "At risk" || s === "Watch"), "severity words " + JSON.stringify(r.sev));
    assert(r.pills.length === 6 && r.pills.every(p => /[A-Za-z]{3,}/.test(p)), "pills " + JSON.stringify(r.pills));
    assert(r.chips.length > 0 && r.chips.every(c => /\d+d/.test(c)), "chips " + JSON.stringify(r.chips));
    assert(/\d+ overdue/.test(r.overdue), "overdue pill " + r.overdue);
  } finally { await browser.close(); }
});

test("forced colors: cards and pills keep a border, status marks and spark stay painted", async () => {
  const { page, browser } = await openDash("light");
  try {
    await page.emulateMedia({ forcedColors: "active" });
    const r = await page.evaluate(() => {
      const cs = s => getComputedStyle(document.querySelector(s));
      return { card: cs("[data-dash] .nm").borderTopStyle, pill: cs(".dash-pill").borderTopStyle, row: cs("[data-renewal-row]").borderTopStyle,
        dot: cs(".dash-dot").forcedColorAdjust, bar: cs("[data-sev-bar]").forcedColorAdjust, fill: cs("[role=progressbar] > span").forcedColorAdjust, spark: cs("[data-kpi-trend]").forcedColorAdjust };
    });
    assert(r.card === "solid" && r.pill === "solid" && r.row === "solid", "borders " + JSON.stringify(r));
    assert([r.dot, r.bar, r.fill, r.spark].every(v => v === "none"), "status marks " + JSON.stringify(r));
  } finally { await browser.close(); }
});

const sizes = (page, sel) => page.evaluate(s => Array.from(document.querySelectorAll(s)).map(e => { const r = e.getBoundingClientRect(); return r.width > 1 ? [Math.round(r.width), Math.round(r.height), (e.innerText || e.getAttribute("aria-label") || "").trim().slice(0, 20)] : null; }).filter(Boolean), sel);
test("touch targets: >= 24px everywhere at 1440; rows, pills, links, bell, toggle, checkbox >= 44px tall at 390", async () => {
  const { page, browser } = await openDash("light");
  try {
    const desk = await sizes(page, TARGETS);
    assert(desk.length > 20 && desk.every(([w, h]) => w >= 24 && h >= 24), "1440 small: " + JSON.stringify(desk.filter(([w, h]) => w < 24 || h < 24)));
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    const ph = await sizes(page, "[data-dash] :is([data-row], .dash-pill, [data-view-all], [data-impl-row], [data-stat][role=button], label.dash-check), [data-bell], [data-scope-toggle] button");
    assert(ph.length > 15 && ph.every(([, h]) => h >= 44), "390 short: " + JSON.stringify(ph.filter(([, h]) => h < 44)));
  } finally { await browser.close(); }
});

const hScroll = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const untitled = page => page.evaluate(() => Array.from(document.querySelectorAll("[data-dash] *")).filter(e => getComputedStyle(e).textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1 && !e.closest("[title]")).map(e => e.textContent.slice(0, 30)));
test("200% zoom (640px): no horizontal scroll; every truncated text keeps a title", async () => {
  const { page, browser } = await openDash("light", 640);
  try {
    assert(await hScroll(page) <= 0, "h-scroll " + await hScroll(page));
    const u = await untitled(page);
    assert(u.length === 0, "truncated without title: " + JSON.stringify(u));
  } finally { await browser.close(); }
});

test("RTL guard: dir=rtl at 640 and 1440 has no horizontal overflow; rows use logical alignment", async () => {
  const { page, browser } = await openDash("light", 640);
  try {
    await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    for (const w of [640, 1440]) {
      await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(200);
      assert(await hScroll(page) <= 0, `rtl h-scroll at ${w}: ` + await hScroll(page));
    }
    const r = await page.evaluate(() => [document.querySelectorAll("[data-dash] :is([data-row], [data-impl-row]).text-left").length, getComputedStyle(document.querySelector("[data-renewal-row]")).textAlign]);
    assert(r[0] === 0 && r[1] === "start", "physical alignment " + r);
  } finally { await browser.close(); }
});

test("print: chrome hidden, light colours even from dark, panels unbroken and within A4", async () => {
  const { page, browser } = await openDash("dark", 794);
  try {
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({
      hidden: ["[data-bell]", "[data-scope-toggle]", "[data-view-all]"].map(s => getComputedStyle(document.querySelector(s)).display),
      card: getComputedStyle(document.querySelector("[data-dash] .nm")).backgroundColor,
      brk: getComputedStyle(document.querySelector("[data-dash] .nm")).breakInside,
      wide: Array.from(document.querySelectorAll("[data-dash] .nm")).filter(e => e.getBoundingClientRect().right > 794).length,
      cut: Array.from(document.querySelectorAll("[data-dash] [data-stat-value]")).filter(e => e.scrollWidth > e.clientWidth + 1).length }));
    assert(r.hidden.every(d => d === "none"), "print-visible chrome " + r.hidden);
    assert(r.card === "rgb(255, 255, 255)", "card prints " + r.card);
    assert(r.brk === "avoid" && r.wide === 0 && r.cut === 0, "print layout " + JSON.stringify(r));
  } finally { await browser.close(); }
});

const BIG = [
  seedAccount({ id: "x1", name: "Huge Co", csm: "Priya Shah", arr: 999999999999, renewalDate: day(12), licenses: 99999999, deployedLicenses: 12345678, inputs: { usage: 5, sentiment: 5, tickets: 20, nps: -80 } }),
  seedAccount({ id: "x2", name: "Tiny Co", csm: "Priya Shah", arr: 0.01, renewalDate: day(50) }),
  seedAccount({ id: "x3", name: "Old Co", csm: "Priya Shah", arr: 50000, renewalDate: day(-200000) }),
];
for (const w of [1280, 390, 640]) test(`long numbers at ${w}: no overflow, no float tails, truncated values titled`, async () => {
  const { page, browser } = await openDash("light", w, BIG);
  try {
    assert(await hScroll(page) <= 0, "h-scroll " + await hScroll(page));
    const r = await page.evaluate(() => ({
      text: document.querySelector("[data-dash]").innerText,
      over: Array.from(document.querySelectorAll("[data-dash] [data-stat-value]")).filter(e => e.scrollWidth > e.clientWidth + 1 && !e.title).length }));
    assert(/\$1000000\.00M/.test(r.text), "precondition: huge ARR shown");
    assert(!/\d\.\d{3,}|e\+\d/.test(r.text), "float tail: " + (r.text.match(/\S*(\d\.\d{3,}|e\+\d)\S*/) || [])[0]);
    assert(r.over === 0, "overflowing untitled values " + r.over);
    const u = await untitled(page);
    assert(u.length === 0, "truncated without title " + JSON.stringify(u));
  } finally { await browser.close(); }
});

test("empty org and loading: no NaN/undefined/Infinity/Invalid Date; empty lines and dashes", async () => {
  const { page, browser } = await launch(`window.__loadDelay = 600; window.__seedRows = { accounts: [], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [], projects: [], project_tasks: [] };
    window.__seedProfile = { id: "u1", name: "Priya Shah", role: "admin", org_id: "org-a", platform_admin: false };`);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const bad = /NaN|undefined|Infinity|Invalid Date/;
    await page.waitForSelector("main");
    assert(!bad.test(await page.innerText("main")), "while loading");
    await page.waitForSelector("[data-dash]");
    await page.click("[data-analytics-toggle]");
    const t = await page.innerText("main");
    assert(!bad.test(t), "empty org: " + (t.match(new RegExp(".{0,20}(" + bad.source + ").{0,20}")) || [])[0]);
    assert(/No accounts need attention\./.test(await page.textContent('[data-scroll-list="Needs attention"]')), "needs-attention empty line");
    assert((await page.textContent('[data-scroll-list="Team tasks"]')).trim() === "No open tasks.", "team tasks empty line");
    assert((await page.textContent('[data-stat="NRR (12m)"] [data-stat-value]')).trim() === "—", "NRR dash");
  } finally { await browser.close(); }
});
