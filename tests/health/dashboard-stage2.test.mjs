// Dashboard stage 2: header (date line, greeting, "Whole team", quiet Saved, 42px bell).
import { test, assert } from "./framework.mjs";
import { launch, launchFinance, launchPersistent, seedAccount } from "./harness.mjs";

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

// A real unread alert (x1 renews in 12 days, inside the bell's 30-day window): the app renders the badge itself.
for (const theme of ["light", "dark"]) test(`bell badge text contrast >= 4.5:1 with a real unread alert (${theme})`, async () => {
  const { page, browser } = await openDash(theme);
  try {
    const c = await page.evaluate(() => {
      const s = document.querySelector("[data-bell] > span");
      if (!s) return null;
      const cs = getComputedStyle(s); return [cs.color, cs.backgroundColor, cs.fontSize, s.textContent, document.querySelector("[data-bell]").getAttribute("aria-label")];
    });
    assert(c, "no unread badge rendered for the seeded renewal alert");
    assert(/^\d+$/.test(c[3]) && +c[3] >= 1 && c[4] === `Notifications, ${c[3]} unread`, "badge " + JSON.stringify(c));
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
const a11ySeed = (theme, accts = A11Y, more = []) => `try { localStorage.setItem("onevio.theme", "${theme}"); localStorage.setItem("dashAnalytics_Priya Shah", "1"); } catch (e) {}
  window.__seedRows = { accounts: ${wrap(accts)}, contacts: [], activities: [], team: [],
  tasks: ${wrap([{ id: "k1", accountId: "x1", title: "Call them about the renewal", due: day(-2), owner: "Priya Shah", priority: "High", status: "Open", createdAt: day(-9) }, ...more])},
  opportunities: ${wrap([{ id: "o1", accountId: "x1", name: "Add-on", type: "Upsell", value: 40000, stage: "Proposal", probability: 50, closeDate: day(40) }])},
  projects: ${wrap([{ ...proj("p1", "in_progress", day(30)), accountId: "x1" }])}, project_tasks: ${wrap([ptask("pt1", "p1", "done"), ptask("pt2", "p1", "open")])},
  settings: [{ id: 1, data: { snapshots: [{ month: "${mo(3)}", totalARR: 100000, nrr: 1, grr: 1, Green: 1, Yellow: 1, Red: 1 }, { month: "${mo(2)}", totalARR: 120000, nrr: 1.05, grr: 0.95, Green: 2, Yellow: 1, Red: 0 }] } }] };
  window.__seedProfile = { id: "u1", name: "Priya Shah", role: "admin", org_id: "org-a", platform_admin: false };`;
async function openDash(theme, w = 1440, accts, more) {
  const r = await launch(a11ySeed(theme, accts, more));
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
  const rgba = s => { const c = parse(s); return c.length < 4 ? [...c.slice(0, 3), 1] : c.slice(0, 4); };
  const over = (top, a, base) => top.map((v, i) => v * a + base[i] * (1 - a));
  const opOf = e => { let o = 1; for (let x = e; x; x = x.parentElement) o *= +getComputedStyle(x).opacity; return o; };
  // Background as painted: stack every translucent layer (alpha x opacity) down to the first
  // opaque one. null when nothing opaque sits behind -- a test failure, never a guess.
  const bgOf = e => {
    const layers = [];
    for (let x = e; x; x = x.parentElement) {
      const c = rgba(getComputedStyle(x).backgroundColor), a = c[3] * opOf(x);
      if (a >= 1) return layers.reduceRight((b, [col, al]) => over(col, al, b), c.slice(0, 3));
      if (a > 0) layers.push([c.slice(0, 3), a]);
    }
    return null;
  };
  // text colour composited (its own alpha x every ancestor's opacity) over the painted background
  const textOn = e => { const bg = bgOf(e); if (!bg) return null; const c = rgba(getComputedStyle(e).color); return ratio(over(c.slice(0, 3), c[3] * opOf(e), bg), bg); };
  const shown = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  return { parse, ratio, bgOf, shown, textOn };
})();`;
const TARGETS = "[data-dash] :is(button:not(:disabled), [role=button], label.dash-check), [data-bell], [data-scope-toggle] button";

for (const theme of ["light", "dark"]) test(`dashboard text >= 4.5:1 and KPI icon tiles >= 3:1 (${theme})`, async () => {
  const { page, browser } = await openDash(theme);
  try {
    await page.addScriptTag({ content: PAGE_FNS });
    const r = await page.evaluate(() => {
      const { shown, textOn } = window.__c, low = [], tiles = [];
      for (const e of document.querySelectorAll("[data-dash] *")) {
        if (!shown(e) || e.closest("svg") || e.closest("[data-kpi-icon]")) continue;
        if (!Array.from(e.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())) continue;
        const k = textOn(e);
        if (k === null || k < 4.5) low.push((k === null ? "no opaque background" : k.toFixed(2)) + " " + e.textContent.trim().slice(0, 30));
      }
      for (const t of document.querySelectorAll("[data-kpi-icon]")) tiles.push(textOn(t) ?? 0);
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
    // AM book rows (Analytics) are keyboard targets too: precondition one is in the list
    await page.click("[data-am-book-toggle]");
    const am = await page.evaluate(() => { const e = document.querySelector("[data-am-row]"); if (!e) return null; e.setAttribute("data-t6", "am"); return e.tabIndex; });
    assert(am === 0, "AM book row tabIndex " + am);
    ids.push("am");
    await page.keyboard.press("Shift"); // keyboard modality, so programmatic focus is :focus-visible
    const bad = [];
    for (const i of ids) {
      const r = await page.evaluate(i => {
        const e = document.querySelector(`[data-t6="${i}"]`), f = e.matches("label") ? e.querySelector("input") : e;
        f.focus({ preventScroll: true });
        const cs = getComputedStyle(f), { parse, ratio, bgOf } = window.__c;
        return { ok: cs.outlineStyle === "solid" && parseFloat(cs.outlineWidth) >= 2, k: ratio(parse(cs.outlineColor).slice(0, 3), bgOf(f.parentElement) || [0, 0, 0]), what: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 25) };
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
      overdue: (document.querySelector("#week-tasks h3") || {}).textContent,
      words: Array.from(document.querySelectorAll("[data-renewal-row]")).map(r => { const w = r.querySelector("[data-health-word]"); return w && w.getBoundingClientRect().width > 1 ? w.textContent : null; }) }));
    assert(r.words.length >= 3 && r.words.every(w => /^\d+ · (Healthy|Watch|At risk)$/.test(w)) && new Set(r.words.map(w => w && w.split(" · ")[1])).size >= 2, "row health words " + JSON.stringify(r.words));
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
    await page.keyboard.press("Shift");
    const r = await page.evaluate(() => {
      const cs = s => getComputedStyle(document.querySelector(s));
      const vis = s => { const c = cs(s); return c.borderTopStyle === "solid" && parseFloat(c.borderTopWidth) >= 1 && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(c.borderTopColor) ? "solid" : `${c.borderTopStyle} ${c.borderTopWidth} ${c.borderTopColor}`; };
      const probe = document.createElement("i"); probe.style.cssText = "forced-color-adjust:none;color:Highlight"; document.body.appendChild(probe);
      const hl = getComputedStyle(probe).color; probe.remove();
      const btn = document.querySelector("[data-view-all]"); btn.focus();
      return { card: vis("[data-dash] .nm"), pill: vis(".dash-pill"), row: vis("[data-renewal-row]:not(:first-child)"), hl,
        ring: [getComputedStyle(btn).outlineStyle, getComputedStyle(btn).outlineColor], sparkColor: cs("[data-kpi-trend]").color,
        dot: cs(".dash-dot").forcedColorAdjust, bar: cs("[data-sev-bar]").forcedColorAdjust, fill: cs("[role=progressbar] > span").forcedColorAdjust, spark: cs("[data-kpi-trend]").forcedColorAdjust };
    });
    assert(r.card === "solid" && r.pill === "solid" && r.row === "solid", "borders " + JSON.stringify(r));
    assert([r.dot, r.bar, r.fill, r.spark].every(v => v === "none"), "status marks " + JSON.stringify(r));
    assert(r.ring[0] === "solid" && r.ring[1] === r.hl && r.sparkColor === r.hl, `focus ring ${r.ring} / spark ${r.sparkColor} vs Highlight ${r.hl}`);
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

// Text stays inside its card and never overlaps text: every text node's painted box (clipped to its scroll/truncate
// container), per dashboard card, compared pairwise.
const overlaps = page => page.evaluate(() => {
  const out = [], hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  for (const card of document.querySelectorAll("[data-dash] .nm")) {
    const boxes = [], w = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      if (!n.textContent.trim() || n.parentElement.closest("svg")) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      let b = r.getBoundingClientRect(); if (b.width < 1 || b.height < 1) continue;
      for (let x = n.parentElement; x && x !== card; x = x.parentElement)
        if (getComputedStyle(x).overflowX !== "visible") { const c = x.getBoundingClientRect(); b = { left: Math.max(b.left, c.left), right: Math.min(b.right, c.right), top: Math.max(b.top, c.top), bottom: Math.min(b.bottom, c.bottom) }; }
      if (b.right - b.left < 1 || b.bottom - b.top < 1) continue;
      const cb = card.getBoundingClientRect();
      if (b.left < cb.left - 1 || b.right > cb.right + 1) out.push(`"${n.textContent.trim().slice(0, 20)}" spills out of its card`);
      boxes.push([b, n.textContent.trim().slice(0, 20), n.parentElement]);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
      if (boxes[i][2] !== boxes[j][2] && hit(boxes[i][0], boxes[j][0])) out.push(`"${boxes[i][1]}" overlaps "${boxes[j][1]}"`);
  }
  return out;
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
      const o = await overlaps(page);
      assert(o.length === 0, `rtl overlap at ${w}: ` + o.slice(0, 5).join(" | "));
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
    await page.addScriptTag({ content: PAGE_FNS });
    const r = await page.evaluate(() => ({
      hidden: ["[data-bell]", "[data-scope-toggle]", "[data-view-all]"].map(s => getComputedStyle(document.querySelector(s)).display),
      card: getComputedStyle(document.querySelector("[data-dash] .nm")).backgroundColor,
      brk: getComputedStyle(document.querySelector("[data-dash] .nm")).breakInside,
      wide: Array.from(document.querySelectorAll("[data-dash] .nm")).filter(e => e.getBoundingClientRect().right > 794).length,
      cut: Array.from(document.querySelectorAll("[data-dash] [data-stat-value]")).filter(e => e.scrollWidth > e.clientWidth + 1).length,
      // dark-only fills must not reach paper: the overdue pill and the orange KPI tile print light
      fills: ["#week-tasks h3 .bg-rose-100", "[data-kpi-icon].bg-orange-100"].map(s => { const e = document.querySelector(s); return e && [window.__c.parse(getComputedStyle(e).backgroundColor).slice(0, 3), window.__c.textOn(e)]; }) }));
    assert(r.fills.every((f, i) => f && f[0].every(v => v >= 200) && f[1] >= [4.5, 3][i]) /* pill text 4.5; tile glyph is a graphic, 3:1 */, "print fills " + JSON.stringify(r.fills));
    assert(r.hidden.every(d => d === "none"), "print-visible chrome " + r.hidden);
    assert(r.card === "rgb(255, 255, 255)", "card prints " + r.card);
    assert(r.brk === "avoid" && r.wide === 0 && r.cut === 0, "print layout " + JSON.stringify(r));
  } finally { await browser.close(); }
});

const BIG = [
  seedAccount({ id: "x1", name: "Huge Co", csm: "Priya Shah", arr: 999999999999, startDate: day(-100), renewalDate: day(12), licenses: 99999999, deployedLicenses: 12345678, inputs: { usage: 5, sentiment: 5, tickets: 20, nps: -80 } }),
  seedAccount({ id: "x2", name: "Tiny Co", csm: "Priya Shah", arr: 0.01, startDate: day(-100), renewalDate: day(50) }),
  seedAccount({ id: "x3", name: "Old Co", csm: "Priya Shah", arr: 50000, startDate: day(-100), renewalDate: day(-200000) }),
  // x1-x3 are new logos (outside NRR). NRR 1234% on a 300,000 base: +3,602,000 expansion, -100,000 contraction, a 100,000 churn
  seedAccount({ id: "x4", name: "Grow Co", csm: "Priya Shah", arr: 3702000, arrEvents: [{ date: day(-30), delta: 3602000 }] }),
  seedAccount({ id: "x5", name: "Shrink Co", csm: "Priya Shah", arr: 0, arrEvents: [{ date: day(-30), delta: -100000 }] }),
  seedAccount({ id: "x6", name: "Gone Co", csm: "Priya Shah", arr: 100000, churn: { date: day(-20), arr: 100000, reason: "Price" } }),
];
const MANY_TASKS = Array.from({ length: 10050 }, (_, i) => ({ id: "m" + i, accountId: "x3", title: "Bulk " + i, due: day(30), owner: "Priya Shah", priority: "Low", status: "Open", createdAt: day(-9) }));
for (const w of [1280, 390, 640]) test(`long numbers at ${w}: no overflow, no float tails, truncated values titled`, async () => {
  const { page, browser } = await openDash("light", w, BIG, MANY_TASKS);
  try {
    assert(await hScroll(page) <= 0, "h-scroll " + await hScroll(page));
    const r = await page.evaluate(() => ({
      text: document.querySelector("[data-dash]").innerText,
      over: Array.from(document.querySelectorAll("[data-dash] [data-stat-value]")).filter(e => e.scrollWidth > e.clientWidth + 1 && !e.title).length }));
    assert(/\$1000000\.00M/.test(r.text), "precondition: huge ARR shown");
    const pre = [/1234%/.test(r.text), /-\$100K/.test(r.text), /100\d\d open/.test(r.text)];
    assert(pre.every(Boolean), "precondition: NRR 1000%+, negative bridge rows, 10,000+ tasks: " + pre + " " + (r.text.match(/\d+%/g) || []).slice(0, 4));
    const o = await overlaps(page);
    assert(o.length === 0, "overlap: " + o.slice(0, 5).join(" | "));
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
    // Task 7 (owner item 6): every panel's empty line, no Implementation panel, dashes where data is missing
    assert((await page.textContent('[data-scroll-list="Renewals in the next 90 days"]')).trim() === "No renewals in the next 90 days.", "renewals empty line");
    assert((await page.textContent('[data-scroll-list="Tasks this week"]')).trim() === "Nothing due.", "my tasks empty line");
    assert((await page.textContent('[data-scroll-list="Needs attention"]')).trim() === "No accounts need attention.", "needs-attention exact line");
    const implCard = await page.$$eval("[data-dash] h3", hs => hs.filter(h => h.textContent.trim() === "Implementation").length);
    assert(implCard === 0 && await page.$("[data-impl-row]") === null, "Implementation panel shown for an empty org");
    assert((await page.textContent('[data-stat="GRR (12m)"] [data-stat-value]')).trim() === "—", "GRR dash");
    const kpis = await page.$$eval("[data-kpi] [data-stat-value]", e => e.map(x => x.textContent.trim()));
    assert(kpis.length === 4 && kpis.every(v => /^(\$0|0|—)$/.test(v)), "KPI values " + JSON.stringify(kpis));
  } finally { await browser.close(); }
});

// ---- Task 7: every new click target, keyboard, shortcuts, error/empty states, phone per panel. ----
const GREEN = { usage: 95, sentiment: 95, tickets: 0, nps: 60 }, YELLOW = { usage: 55, sentiment: 55, tickets: 3, nps: 0 }, RED = { usage: 5, sentiment: 5, tickets: 20, nps: -80 };
const N = { g1: "Green Gamma Global Manufacturing Holdings Private Limited", y1: "Yellow Yonder Worldwide Logistics Services Corporation", r1: "Red Rocket Interplanetary Freight and Logistics Limited", c1: "Churned Cobalt Consolidated Enterprises" };
const T7 = (churned = true) => [
  seedAccount({ id: "g1", name: N.g1, csm: "Priya Shah", renewalDate: day(60), billingCompleted: true, billingCompletedDate: day(-5), licenses: 100, deployedLicenses: 30, inputs: GREEN, nextQbrDate: day(10), qbrFrequency: "Quarterly" }),
  seedAccount({ id: "y1", name: N.y1, csm: "Priya Shah", inputs: YELLOW, nextQbrDate: day(120), qbrFrequency: "Quarterly" }),
  seedAccount({ id: "r1", name: N.r1, csm: "Priya Shah", renewalDate: day(10), inputs: RED, nextQbrDate: day(120), qbrFrequency: "Quarterly" }),
  ...(churned ? [seedAccount({ id: "c1", name: N.c1, csm: "Priya Shah", churn: { date: day(-20), arr: 100000, reason: "Price" } })] : []),
];
const T7_TASKS = [
  { id: "t1", accountId: "r1", title: "Rahul overdue call", due: day(-3), owner: "Rahul", priority: "High", status: "Open", createdAt: day(-9) },
  { id: "t2", accountId: "g1", title: "Priya prep deck", due: day(3), owner: "Priya Shah", priority: "Medium", status: "Open", createdAt: day(-9) },
  { id: "t3", accountId: "y1", title: "Nobody owns this yet", due: day(5), owner: "", priority: "Low", status: "Open", createdAt: day(-9) },
  { id: "t4", accountId: "y1", title: "Long owner task", due: day(20), owner: "Bartholomew Montgomery-Fitzgerald Venkataraman", priority: "Low", status: "Open", createdAt: day(-9) },
];
const SNAPS2 = [{ month: mo(3), totalARR: 100000, nrr: 1, grr: 1, Green: 1, Yellow: 1, Red: 1 }, { month: mo(2), totalARR: 120000, nrr: 1.05, grr: 0.95, Green: 2, Yellow: 1, Red: 0 }];
const wrapRows = l => l.map(d => ({ id: d.id, data: d }));
const TODAY7 = day(0);
// launchFinance so the "Finance this quarter" card has an invoice to show (the default mock has no invoices table).
async function t7Launch({ theme = "light", w = 1440, h = 900, snaps = [], churned = true, accounts, tasks = T7_TASKS, projects } = {}) {
  const accts = accounts || T7(churned);
  const r = await launchFinance({
    user: { name: "Priya Shah", role: "admin", finance: true },
    seed: `try { localStorage.setItem("onevio.theme", "${theme}"); } catch (e) {}`,
    tables: { accounts: wrapRows(accts), contacts: [], activities: [], team: [],
      tasks: wrapRows(tasks),
      opportunities: wrapRows([{ id: "o1", accountId: "g1", name: "Add-on", type: "Upsell", value: 40000, stage: "Proposal", probability: 50, closeDate: day(40) }]),
      projects: wrapRows(projects || [{ ...proj("p1", "in_progress", day(30)), accountId: "r1" }]),
      project_tasks: wrapRows([ptask("pt1", "p1", "done"), ptask("pt2", "p1", "open")]),
      settings: [{ id: 1, data: { snapshots: snaps } }],
      invoices: [{ id: "i1", number: "A", account_id: "g1", currency: "INR", total: 100, subtotal: 100, status: "paid", paid_date: TODAY7, issue_date: TODAY7, due_date: TODAY7, sent_at: TODAY7 + "T00:00:00Z", entity_id: "e1", pdf_path: "org-a/x.pdf" }],
      billing_entities: [] },
  });
  if (theme !== "light") await r.page.reload(); // the head theme script reads the stored theme on the next load
  await r.page.setViewportSize({ width: w, height: h });
  await r.page.waitForFunction(n => window.__store && window.__store.getState().accounts.length === n, accts.length);
  await r.page.waitForSelector("[data-kpi]");
  await r.page.waitForTimeout(300);
  return r;
}
const h1 = async page => (await page.textContent("main h1")).replace(/\s+/g, " ").trim();
const waitH1 = (page, want) => page.waitForFunction(w => { const e = document.querySelector("main h1"); return e && e.textContent.replace(/\s+/g, " ").trim().startsWith(w); }, want, { timeout: 5000 })
  .catch(async () => { throw new Error(`h1 "${await h1(page)}", wanted "${want}"`); });
// Account list rows -> seed ids (each row's text matched to the seeded names, row by row).
const acctRows = page => page.$$eval("[data-account-row]", (rs, n) => rs.map(r => Object.keys(n).find(k => r.textContent.includes(n[k])) || "?").sort(), N);
const riskSel = page => page.$eval('select[aria-label="Filter by health risk"]', e => e.value);
const home = async page => { await page.keyboard.press("1"); await page.waitForSelector("[data-kpi]"); await page.waitForTimeout(150); };
const crumbIs = async (page, id) => { await page.waitForSelector("[data-crumb-accounts]", { timeout: 5000 }); const t = await h1(page); assert(t.includes(N[id]), `crumb "${t}" wanted ${N[id]}`); };

test("T7 click 1: ARR at risk card (click and Enter) opens Accounts filtered to Red", async () => {
  const { page, browser } = await t7Launch();
  try {
    for (const how of ["click", "enter"]) {
      if (how === "click") await page.click('[data-kpi][data-stat="ARR at risk (USD)"]');
      else { await page.focus('[data-kpi][data-stat="ARR at risk (USD)"]'); await page.keyboard.press("Enter"); }
      await waitH1(page, "Accounts");
      await page.waitForSelector("[data-account-row]");
      assert(await riskSel(page) === "Red", `${how}: risk ${await riskSel(page)}`);
      const rows = await acctRows(page);
      assert(rows.join() === "r1", `${how}: rows ${rows}`);
      await home(page);
    }
  } finally { await browser.close(); }
});

test("T7 click 2-4: Renewals card opens Renewals; NRR opens Accounts unfiltered; Overdue opens Tasks with only Overdue open", async () => {
  const { page, browser } = await t7Launch();
  try {
    await page.click('[data-kpi][data-stat="Renewals · 90 days"]');
    await waitH1(page, "Renewals");
    await home(page);
    await page.click('[data-kpi][data-stat="NRR (12m)"]');
    await waitH1(page, "Accounts");
    await page.waitForSelector("[data-account-row]");
    const rows = await acctRows(page);
    assert(await riskSel(page) === "All" && rows.join() === "g1,r1,y1", `NRR: risk ${await riskSel(page)} rows ${rows}`);
    await home(page);
    await page.click('[data-kpi][data-stat="Overdue tasks"]');
    await waitH1(page, "Tasks");
    await page.waitForSelector("[data-task-row]");
    // section header buttons are [label, (count), arrow]; only Overdue is expanded
    const secs = await page.$$eval("main button", bs => bs.map(b => Array.from(b.children).map(c => c.textContent.trim())).filter(c => c.length === 3 && /^[▾▸]$/.test(c[2])).map(c => [c[0], c[2]]));
    const open = Object.fromEntries(secs.map(([l, a]) => [l.toLowerCase(), a === "▾"]));
    assert(open.overdue === true && !open.today && !open["this week"] && secs.length >= 2, "sections " + JSON.stringify(secs));
    const titles = await page.$$eval("[data-task-row] [data-task-title]", e => e.map(x => x.textContent));
    assert(titles.includes("Rahul overdue call") && !titles.includes("Priya prep deck"), "rows " + JSON.stringify(titles));
  } finally { await browser.close(); }
});

test("T7 click 5: pills -- Total ARR all, Healthy/Watch/At risk one each, QBRs due flag, Billing completed filter", async () => {
  const { page, browser } = await t7Launch();
  try {
    for (const [pill, want, risk] of [["Total ARR (USD)", "g1,r1,y1", "All"], ["Healthy", "g1", "Green"], ["Watch", "y1", "Yellow"], ["At risk", "r1", "Red"]]) {
      await page.click(`[data-health-pill="${pill}"]`);
      await waitH1(page, "Accounts"); await page.waitForSelector("[data-account-row]");
      const rows = (await acctRows(page)).join();
      assert(rows === want && await riskSel(page) === risk, `${pill}: rows ${rows} risk ${await riskSel(page)}`);
      await home(page);
    }
    await page.click('[data-health-pill="QBRs due (30d)"]');
    await waitH1(page, "Accounts");
    await page.waitForSelector('button[title="Remove QBR-due filter"]', { timeout: 5000 });
    assert((await acctRows(page)).join() === "g1", "QBR rows " + await acctRows(page));
    await home(page);
    await page.click('[data-health-pill="Billing completed"]');
    await waitH1(page, "Accounts");
    const bill = await page.$eval('select[aria-label="Filter by billing status"]', e => e.value);
    assert(bill === "Completed" && (await acctRows(page)).join() === "g1", `billing ${bill} rows ${await acctRows(page)}`);
  } finally { await browser.close(); }
});

test("T7 click 6: renewal, needs-attention and license rows open that account", async () => {
  const { page, browser } = await t7Launch();
  try {
    for (const [sel, id] of [['[data-renewal-row="r1"]', "r1"], ['[data-attention-row="r1"]', "r1"], ['[data-license-row="g1"]', "g1"]]) {
      await page.click(sel);
      await crumbIs(page, id);
      await home(page);
    }
  } finally { await browser.close(); }
});

test("T7 click 7: My tasks checkbox completes in the store; account link opens it; Tab goes checkbox -> link", async () => {
  const { page, browser } = await t7Launch();
  try {
    await page.focus('[data-week-task="t3"] input');
    await page.keyboard.press("Tab");
    const next = await page.evaluate(() => document.activeElement === document.querySelector('[data-week-task="t3"] button'));
    assert(next, "Tab from the checkbox did not reach the account link");
    await page.click('[data-week-task="t2"] input');
    const st = await page.evaluate(async () => { await new Promise(r => setTimeout(r, 50)); return window.__store.getState().tasks.find(t => t.id === "t2").status; });
    assert(st === "Done", "t2 status " + st);
    await page.click('[data-week-task="t3"] button');
    await crumbIs(page, "y1");
  } finally { await browser.close(); }
});

test("T7 click 8: implementation row opens that project's detail, not the board", async () => {
  const { page, browser } = await t7Launch();
  try {
    await page.click('[data-impl-row="p1"]');
    await waitH1(page, "Implementation");
    await page.waitForSelector("[data-project-stage]", { timeout: 5000 });
    assert(await page.$("[data-board-project]") === null, "board still shown");
    assert(await visible(page, "[data-project-stage]"), "project detail hidden");
  } finally { await browser.close(); }
});

test("T7 click 9: team row Rahul opens Tasks filtered to Rahul's tasks only", async () => {
  const { page, browser } = await t7Launch();
  try {
    await page.click('[data-team-row="Rahul"]');
    await waitH1(page, "Tasks");
    await page.waitForSelector("[data-task-owner-filter]", { timeout: 5000 }).catch(() => { throw new Error("no owner filter chip on Tasks"); });
    assert(await page.getAttribute("[data-task-owner-filter]", "title") === "Owner: Rahul", "owner chip");
    const titles = await page.$$eval("[data-task-row] [data-task-title]", e => e.map(x => x.textContent));
    assert(JSON.stringify(titles) === '["Rahul overdue call"]', "rows " + JSON.stringify(titles));
  } finally { await browser.close(); }
});

test("T7 click 10: Finance card's Open Finance opens Finance", async () => {
  const { page, browser } = await t7Launch();
  try {
    await page.waitForSelector("[data-fin-card-link]", { timeout: 10000 });
    await page.click("[data-fin-card-link]");
    await waitH1(page, "Finance");
  } finally { await browser.close(); }
});

test("T7 click 11: ARR bridge GRR opens Accounts; Churned ARR opens churned-only; disabled with no churn", async () => {
  let { page, browser } = await t7Launch();
  try {
    await page.click('[data-bridge-head] [data-stat="GRR (12m)"]');
    await waitH1(page, "Accounts"); await page.waitForSelector("[data-account-row]");
    assert((await acctRows(page)).join() === "g1,r1,y1", "GRR rows " + await acctRows(page));
    await home(page);
    await page.click('[data-bridge-head] [data-stat="Churned ARR (12m)"]');
    await waitH1(page, "Accounts"); await page.waitForSelector("[data-account-row]");
    assert((await acctRows(page)).join() === "c1", "churned rows " + await acctRows(page));
    await browser.close();
    ({ page, browser } = await t7Launch({ churned: false }));
    assert(await page.$eval('[data-stat="Churned ARR (12m)"]', e => e.disabled), "Churned ARR enabled with no churned account");
  } finally { await browser.close(); }
});

const T7_TARGETS = ["[data-kpi]", "[data-health-pill]", "[data-renewal-row]", "[data-attention-row]", "[data-impl-row]", "[data-team-row]", "[data-view-all]",
  "[data-week-task] input", "[data-week-task] button", "[data-bridge-head] button:not(:disabled)", "[data-fin-card-link]", "[data-license-row]"];
test("T7 click 12: every new target has a pointer cursor and is keyboard focusable; Enter activates (3 spot checks)", async () => {
  const { page, browser } = await t7Launch();
  try {
    await page.waitForSelector("[data-fin-card-link]");
    const r = await page.evaluate(sels => sels.map(s => {
      const els = Array.from(document.querySelectorAll(s));
      return [s, els.length, els.filter(e => getComputedStyle(e).cursor !== "pointer" || !(e.tabIndex >= 0)).map(e => e.outerHTML.slice(0, 60))];
    }), T7_TARGETS);
    assert(r.every(([, n]) => n > 0), "missing targets " + JSON.stringify(r.filter(([, n]) => !n).map(x => x[0])));
    const bad = r.filter(([, , b]) => b.length);
    assert(bad.length === 0, "not pointer/focusable: " + JSON.stringify(bad));
    for (const [sel, check] of [['[data-health-pill="Watch"]', async () => { await waitH1(page, "Accounts"); assert(await riskSel(page) === "Yellow", "Watch via Enter"); }],
      ['[data-team-row="Rahul"]', () => page.waitForSelector("[data-task-owner-filter]", { timeout: 5000 })],
      ['[data-view-all="renewals"]', () => waitH1(page, "Renewals")]]) {
      await page.focus(sel); await page.keyboard.press("Enter"); await check(); await home(page);
    }
  } finally { await browser.close(); }
});

test("T7 click 13: no trend line with under 2 snapshots; one on the NRR card only with 2", async () => {
  let { page, browser } = await t7Launch();
  try {
    assert((await page.$$("[data-kpi-trend]")).length === 0, "trend drawn with no snapshot series");
    await browser.close();
    ({ page, browser } = await t7Launch({ snaps: SNAPS2 }));
    const where = await page.$$eval("[data-kpi-trend]", e => e.map(x => x.closest("[data-stat]")?.getAttribute("data-stat")));
    assert(JSON.stringify(where) === '["NRR (12m)"]', "trend cards " + JSON.stringify(where));
  } finally { await browser.close(); }
});

test("T7 click 14: nothing dropped -- GRR, Churned ARR, 7-day subs, pills sum to active accounts", async () => {
  const { page, browser } = await t7Launch();
  try {
    const r = await page.evaluate(() => {
      const v = s => (document.querySelector(s) || {}).textContent;
      return { grr: v('[data-stat="GRR (12m)"] [data-stat-value]'), ch: v('[data-stat="Churned ARR (12m)"] [data-stat-value]'),
        sub: v('[data-stat="Overdue tasks"] [data-stat-value] + div'), team: (document.querySelector('[data-scroll-list="Team tasks"]')?.closest(".nm")?.querySelector("h3") || {}).textContent,
        pills: ["Healthy", "Watch", "At risk"].map(k => +v(`[data-health-pill="${k}"] [data-stat-value]`)),
        active: window.__store.getState().accounts.filter(a => !a.churn).length };
    });
    assert(/^(\d+%|—)$/.test(r.grr) && /^\$/.test(r.ch), `GRR ${r.grr} churned ${r.ch}`);
    assert(/^\d+ due in the next 7 days$/.test(r.sub), "overdue sub " + r.sub);
    assert(/\d+ due in 7 days$/.test(r.team), "team header " + r.team);
    assert(r.pills.reduce((a, b) => a + b, 0) === r.active && r.active === 3 && r.pills.every(n => n === 1), `pills ${r.pills} vs ${r.active}`);
  } finally { await browser.close(); }
});

// Owner item 2 (and brief step 3): each named panel at 390x844, light and dark, with long names.
const PANELS = {
  "Renewals in the next 90 days": '[data-scroll-list="Renewals in the next 90 days"]', "Needs attention": '[data-scroll-list="Needs attention"]',
  "My tasks this week": "#week-tasks", "Implementation": "[data-impl-row]", "Team tasks": '[data-scroll-list="Team tasks"]',
  "Expansion pipeline": '[data-scroll-list="Expansion pipeline"]', "Finance this quarter": "[data-finance-card] .nm", "ARR bridge": "[data-arr-bridge]",
  "License deployment": "[data-license-card] .nm", "Implementation chart": "[data-impl-chart]" };
for (const theme of ["light", "dark"]) test(`T7 390px (${theme}): every named panel present, no page or panel overflow`, async () => {
  const { page, browser } = await t7Launch({ theme, w: 390, h: 844 });
  try {
    await page.waitForSelector("[data-finance-card]", { timeout: 10000 });
    const r = await page.evaluate(P => {
      const out = { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, panels: {}, stray: [] };
      for (const [name, sel] of Object.entries(P)) {
        const hit = document.querySelector(sel), card = hit && (hit.matches(".nm") ? hit : hit.closest(".nm"));
        if (!card) { out.panels[name] = "MISSING"; continue; }
        const b = card.getBoundingClientRect();
        // rows must fit their card too: a scroll list clips a too-wide row instead of overflowing the page
        const wide = Array.from(card.querySelectorAll("[data-row], [data-impl-row]")).filter(x => x.getBoundingClientRect().right > b.right + 0.5).length;
        out.panels[name] = card.scrollWidth <= card.clientWidth && b.right <= 390.5 && b.width > 50 && !wide ? "ok" : `scroll ${card.scrollWidth}/${card.clientWidth} right ${b.right} wide rows ${wide}`;
      }
      const clipped = e => { for (let x = e.parentElement; x && !x.matches("[data-dash]"); x = x.parentElement) if (getComputedStyle(x).overflowX !== "visible") return true; return false; };
      for (const e of document.querySelectorAll("[data-dash] *")) { const b = e.getBoundingClientRect(); if (b.width && b.right > 390.5 && !clipped(e)) out.stray.push(e.tagName + "." + String(e.className).slice(0, 40) + " " + Math.round(b.right)); }
      return out;
    }, PANELS);
    assert(r.page <= 0, "page h-scroll " + r.page);
    const bad = Object.entries(r.panels).filter(([, v]) => v !== "ok");
    assert(bad.length === 0, "panels: " + JSON.stringify(bad));
    assert(r.stray.length === 0, "past 390: " + r.stray.slice(0, 5).join(" | "));
  } finally { await browser.close(); }
});

// Owner item 3: real Tab presses reach every new target, never stall, and Enter lands per the click table.
const mark = `(() => { const a = document.activeElement; if (!a || a === document.body) return null;
  if (!a.dataset.t7k) a.dataset.t7k = String(window.__t7k = (window.__t7k || 0) + 1); return a; })()`;
const tabTo = async (page, sel, max = 250) => {
  let last = null;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(([s, m]) => { const a = eval(m); return a ? { at: a.matches(s), id: a.dataset.t7k } : { at: false, id: null }; }, [sel, mark]);
    if (r.at) return true;
    if (r.id && r.id === last) throw new Error(`Tab stuck on element ${r.id} looking for ${sel}`);
    last = r.id;
  }
  return false;
};
test("T7 keyboard: Tab reaches every new target (and passes bell, Analytics, Month/Quarter) without sticking", async () => {
  const { page, browser } = await t7Launch();
  try {
    await page.waitForSelector("[data-fin-card-link]");
    const want = await page.evaluate(sels => { let n = 0; const out = [];
      for (const s of [...sels, "[data-bell]", "[data-analytics-toggle]", "[data-impl-mode]"]) for (const e of document.querySelectorAll(s)) { e.dataset.t7want = ++n; out.push(n); }
      return out; }, T7_TARGETS);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    const seen = new Set(); let prev = null, first = null;
    for (let i = 0; i < 400; i++) {
      await page.keyboard.press("Tab");
      const r = await page.evaluate(m => { const a = eval(m); return a ? [a.dataset.t7k, a.dataset.t7want || null] : null; }, mark);
      if (!r) continue;
      assert(r[0] !== prev, "Tab stuck on " + r[0]);
      if (r[0] === first) break; // wrapped round
      first = first || r[0]; prev = r[0];
      if (r[1]) seen.add(+r[1]);
    }
    const miss = want.filter(n => !seen.has(n));
    const names = await page.evaluate(m => m.map(n => document.querySelector(`[data-t7want="${n}"]`).outerHTML.slice(0, 70)), miss);
    assert(want.length > 25 && miss.length === 0, `never reached by Tab (${miss.length}/${want.length}): ` + names.join(" | "));
  } finally { await browser.close(); }
});

const ENTER_TABLE = [
  ['[data-kpi][data-stat="ARR at risk (USD)"]', async p => { await waitH1(p, "Accounts"); assert(await riskSel(p) === "Red", "risk"); }],
  ['[data-kpi][data-stat="Renewals · 90 days"]', p => waitH1(p, "Renewals")],
  ['[data-kpi][data-stat="NRR (12m)"]', async p => { await waitH1(p, "Accounts"); assert(await riskSel(p) === "All", "risk"); }],
  ['[data-kpi][data-stat="Overdue tasks"]', p => waitH1(p, "Tasks")],
  ['[data-health-pill="Total ARR (USD)"]', async p => { await waitH1(p, "Accounts"); assert(await riskSel(p) === "All", "risk"); }],
  ['[data-health-pill="Healthy"]', async p => { await waitH1(p, "Accounts"); assert(await riskSel(p) === "Green", "risk"); }],
  ['[data-health-pill="Watch"]', async p => { await waitH1(p, "Accounts"); assert(await riskSel(p) === "Yellow", "risk"); }],
  ['[data-health-pill="At risk"]', async p => { await waitH1(p, "Accounts"); assert(await riskSel(p) === "Red", "risk"); }],
  ['[data-health-pill="QBRs due (30d)"]', p => p.waitForSelector('button[title="Remove QBR-due filter"]', { timeout: 5000 })],
  ['[data-health-pill="Billing completed"]', async p => { await waitH1(p, "Accounts"); assert(await p.$eval('select[aria-label="Filter by billing status"]', e => e.value) === "Completed", "billing"); }],
  ['[data-renewal-row="r1"]', p => crumbIs(p, "r1")],
  ['[data-attention-row="r1"]', p => crumbIs(p, "r1")],
  ['[data-impl-row="p1"]', p => p.waitForSelector("[data-project-stage]", { timeout: 5000 })],
  ['[data-team-row="Rahul"]', async p => { await p.waitForSelector("[data-task-owner-filter]", { timeout: 5000 }); assert(await p.getAttribute("[data-task-owner-filter]", "title") === "Owner: Rahul", "owner"); }],
  ['[data-view-all="renewals"]', p => waitH1(p, "Renewals")],
  ['[data-view-all="attention"]', p => waitH1(p, "Accounts")],
  ['[data-view-all="tasks"]', p => waitH1(p, "Tasks")],
  ['[data-week-task="t3"] button', p => crumbIs(p, "y1")],
  ['[data-bridge-head] [data-stat="GRR (12m)"]', p => waitH1(p, "Accounts")],
  ['[data-bridge-head] [data-stat="Churned ARR (12m)"]', p => p.waitForSelector('button[title="Remove churned-only filter"]', { timeout: 5000 })],
  ["[data-fin-card-link]", p => waitH1(p, "Finance")],
  ['[data-license-row="g1"]', p => crumbIs(p, "g1")],
];
test("T7 keyboard: Tab to each new target and press Enter -- lands where the click does; Space ticks the week checkbox", async () => {
  const { page, browser } = await t7Launch();
  try {
    for (const [sel, check] of ENTER_TABLE) {
      await page.waitForSelector("[data-fin-card-link]");
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      assert(await tabTo(page, sel), "Tab never reached " + sel);
      await page.keyboard.press("Enter");
      try { await check(page); } catch (e) { throw new Error(`${sel}: ${e.message}`); }
      await home(page);
    }
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    assert(await tabTo(page, '[data-week-task="t2"] input'), "Tab never reached the week checkbox");
    await page.keyboard.press("Space");
    await page.waitForFunction(() => window.__store.getState().tasks.find(t => t.id === "t2").status === "Done", null, { timeout: 5000 });
  } finally { await browser.close(); }
});

// Owner item 4: shortcuts on the new dashboard.
test("T7 shortcuts: number keys in sidebar order, Ctrl+K go to Tasks unfiltered, Esc closes, keys inert in inputs and on the checkbox", async () => {
  const { page, browser } = await t7Launch();
  try {
    const order = await page.$$eval("aside button[title]", els => [...new Set(els.map(e => e.getAttribute("title")))].filter(t => ["Dashboard", "Implementation", "Tasks", "Accounts", "Renewals", "Finance", "Settings"].includes(t)));
    assert(order[3] === "Accounts" && order[2] === "Tasks", "sidebar " + order);
    for (const [k, v] of [["4", "Accounts"], ["5", "Renewals"], ["2", "Implementation"], ["1", null]]) {
      await page.keyboard.press(k);
      if (v) await waitH1(page, v); else await page.waitForSelector("[data-kpi]");
    }
    // a filtered Tasks hand-off first, so "unfiltered" from the palette is a real reset
    await page.click('[data-team-row="Rahul"]');
    await page.waitForSelector("[data-task-owner-filter]");
    await home(page);
    await page.keyboard.press("Control+k");
    await page.waitForSelector('[role=dialog][aria-label="Command palette"]');
    await page.keyboard.type("go to Tasks");
    await page.keyboard.press("Enter");
    await waitH1(page, "Tasks");
    assert(await page.$('[role=dialog][aria-label="Command palette"]') === null, "palette still open");
    assert(await page.$("[data-task-owner-filter]") === null, "Tasks opened filtered from the palette");
    await home(page);
    await page.keyboard.press("Control+k");
    await page.waitForSelector('[role=dialog][aria-label="Command palette"]');
    await page.keyboard.press("4"); // typed into the palette's text input, not a view switch
    await page.waitForTimeout(150);
    assert(await page.$("[data-kpi]") !== null, "4 in the palette input switched view");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[role=dialog][aria-label="Command palette"]'));
    assert(await page.$("[data-kpi]") !== null, "Esc left the dashboard");
    await page.focus('[data-week-task="t3"] input');
    await page.keyboard.press("4");
    await page.focus("[data-impl-year]");
    await page.keyboard.press("4");
    await page.waitForTimeout(200);
    assert(await page.$("[data-kpi]") !== null && await page.$("[data-account-row]") === null, "4 on the checkbox / year select switched view");
    const t3 = await page.evaluate(() => window.__store.getState().tasks.find(t => t.id === "t3").status);
    assert(t3 === "Open", "number key toggled the checkbox: " + t3);
  } finally { await browser.close(); }
});

// Owner item 5a: malformed rows render without a crash or a junk token.
const BAD_TOKENS = /NaN|undefined|Infinity|Invalid Date/;
test("T7 errors (a): malformed data renders the dashboard with no throw and no NaN/undefined/Invalid Date", async () => {
  const { page, browser } = await t7Launch({
    snaps: [{ month: mo(3), totalARR: 100000, nrr: null, grr: null, Green: 1, Yellow: 0, Red: 0 }, { month: mo(2), totalARR: null, nrr: null, grr: 0.9 }],
    accounts: [
      seedAccount({ id: "g1", name: N.g1, csm: "Priya Shah", arr: null, renewalDate: day(20) }),
      seedAccount({ id: "y1", name: N.y1, csm: "Priya Shah", arr: "", renewalDate: undefined, healthBand: "Purple" }),
      seedAccount({ id: "r1", name: N.r1, csm: "Priya Shah", renewalDate: "not-a-date", startDate: "31/31/2026", inputs: RED }),
    ],
    tasks: [{ id: "t1", title: "No owner, no account", due: day(2), status: "Open" }, { id: "t2", accountId: "zz", title: "Bad due", due: "garbage", owner: "Rahul", status: "Open" }],
    projects: [{ ...proj("p9", "in_progress", "not-a-date"), accountId: "nope" }],
  });
  try {
    const errs = [];
    page.on("pageerror", e => errs.push(e.message));
    await page.click("[data-analytics-toggle]");
    await page.waitForTimeout(300);
    assert(await page.$("[data-viewerror]") === null, "view crashed: " + await page.textContent("[data-viewerror]").catch(() => ""));
    assert(await page.$("[data-impl-row]") !== null, "precondition: the task-less project renders");
    const t = await page.innerText("[data-dash]");
    const m = t.match(new RegExp(".{0,30}(" + BAD_TOKENS.source + ").{0,30}"));
    assert(!m, "junk token: " + (m && m[0]));
    assert(errs.length === 0, "page errors " + errs.join(" | "));
  } finally { await browser.close(); }
});

// Owner items 5b and 5d: a failed save shows the existing "Not saved" on the dashboard (readable in both
// themes); ticking a week checkbox while saves fail takes that path rather than losing the change silently.
const failSeed = theme => `try { localStorage.setItem("onevio.theme", "${theme}"); } catch (e) {}
  window.__seedRows = { accounts: ${JSON.stringify(wrapRows(T7()))}, contacts: [], activities: [], team: [], opportunities: [], projects: [], project_tasks: [], settings: [],
  tasks: ${JSON.stringify(wrapRows(T7_TASKS))}, profiles: [{ id: "u1", org_id: "org-a", name: "Priya Shah", role: "admin" }] };`;
for (const theme of ["light", "dark"]) test(`T7 errors (b, d): week checkbox save failure shows "Not saved" on the dashboard, >= 4.5:1 (${theme})`, async () => {
  const { page, browser } = await launchPersistent(failSeed(theme));
  try {
    await page.reload();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector('[data-week-task="t2"] input');
    // let the load-time playbook writes drain first, so the failure lands on the checkbox's write
    await page.waitForFunction(() => window.__health.writeQueue.queueState().status === "saved", null, { timeout: 15000 });
    await page.evaluate(() => { window.__rpcFailures = 99; });
    await page.click('[data-week-task="t2"] input');
    await page.waitForSelector('[data-sync-status="error"]', { timeout: 30000 });
    // the existing rollback: the unsaved tick is undone (refetch), not left looking saved
    await page.waitForFunction(() => window.__store.getState().tasks.find(t => t.id === "t2").status === "Open", null, { timeout: 10000 });
    await page.addScriptTag({ content: PAGE_FNS });
    const r = await page.evaluate(() => { const e = document.querySelector('[data-sync-status="error"]'); return { shown: window.__c.shown(e), k: window.__c.textOn(e), dash: !!document.querySelector("[data-dash]") }; });
    assert(r.dash && r.shown, "Not saved not visible on the dashboard " + JSON.stringify(r));
    assert(r.k !== null && r.k >= 4.5, "Not saved contrast " + r.k);
  } finally { await browser.close(); }
});

// Owner item 5c: a throwing dashboard child is caught by the view boundary; the sidebar still navigates.
test("T7 errors (c): a throwing panel shows the ViewBoundary message and the sidebar still works", async () => {
  const { page, browser } = await t7Launch();
  try {
    const ok = await page.evaluate(() => { if (typeof window.LicenseCard !== "function") return false; window.LicenseCard = () => { throw new Error("t7 deliberate panel crash"); }; return true; });
    assert(ok, "precondition: LicenseCard is a replaceable global");
    await page.click('[data-scope-toggle] button[aria-pressed="false"]'); // re-render the dashboard
    await page.waitForSelector("[data-viewerror]", { timeout: 5000 });
    const msg = await page.textContent("[data-viewerror]");
    assert(/Something went wrong in Dashboard/.test(msg) && /t7 deliberate panel crash/.test(msg), "boundary text " + msg.slice(0, 120));
    await page.click('aside button[title="Accounts"]');
    await waitH1(page, "Accounts");
    assert(await page.$("[data-viewerror]") === null, "boundary stuck after navigating");
  } finally { await browser.close(); }
});
