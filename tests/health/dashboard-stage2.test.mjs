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
