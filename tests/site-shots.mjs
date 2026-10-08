// Marketing screenshots for onevio.in. Renders the built CRM (dist/crm.html) against a rich,
// ENTIRELY FICTIONAL dataset and writes PNGs to site-shots/ (gitignored).
//   npm run build && node tests/site-shots.mjs
// All names, people and figures below are invented. Nothing here comes from live data.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildMockedHtml, seedAccount } from "./health/harness.mjs";

const OUT = fileURLToPath(new URL("../site-shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const CHANNEL = process.env.CRM_TEST_CHANNEL ?? "msedge";

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const RATE = { USD: 1, INR: 0.012, PHP: 0.018 };
const native = (usd, cur) => cur === "USD" ? usd : Math.round(usd / RATE[cur] / 1000) * 1000;

// ---- accounts: [name, tier, usdARR, cur, industry, csm, [usage,sent,tickets,nps], renewIn, startAgoDays, [licTotal, deployed|null]|null]
const ROWS = [
  ["Northwind Logistics", "Enterprise", 380000, "USD", "Logistics", "Priya", [86, 82, 1, 55], 38, 900, [600, 468]],
  ["Brightline Health", "Enterprise", 340000, "USD", "Healthcare", "Rahul", [78, 74, 2, 40], 64, 760, [450, 360]],
  ["Kestrel Analytics", "Enterprise", 290000, "USD", "Data & BI", "Ananya", [90, 88, 0, 62], 112, 1100, [400, 372]],
  ["Harbor & Pine", "Mid", 160000, "USD", "Retail", "Priya", [48, 40, 6, -15], 21, 640, [220, 96]],
  ["Lumen Freight", "Mid", 148000, "INR", "Logistics", "Rahul", [66, 60, 3, 15], 52, 520, [260, 182]],
  ["Corvid Labs", "Mid", 132000, "USD", "Software", "Ananya", [84, 80, 1, 45], 96, 480, [180, 158]],
  ["Meridian Textiles", "Mid", 118000, "INR", "Manufacturing", "Priya", [35, 30, 8, -35], 14, 700, [200, 62]],
  ["Skyforge Media", "SMB", 54000, "USD", "Media", "Rahul", [28, 24, 7, -45], 9, 330, [80, 21]],
  ["Tidewater Energy", "Enterprise", 400000, "USD", "Energy", "Ananya", [72, 68, 3, 30], 74, 1300, [700, 560]],
  ["Alder & Finch", "SMB", 42000, "USD", "Legal", "Priya", [80, 76, 0, 50], 105, 260, [60, 51]],
  ["Zephyr Payments", "Mid", 205000, "USD", "FinTech", "Rahul", [60, 55, 4, 5], 44, 590, [310, 205]],
  ["Quillstone Books", "SMB", 46000, "PHP", "Publishing", "Ananya", [70, 64, 2, 20], 83, 410, null],
  ["Basalt Mining", "Mid", 175000, "USD", "Mining", "Priya", [55, 48, 5, -5], 31, 810, [240, 120]],
  ["Marigold Foods", "Mid", 98000, "INR", "Food & Bev", "Rahul", [88, 84, 1, 58], 118, 370, [140, 133]],
  ["Ostrava Robotics", "Enterprise", 330000, "USD", "Robotics", "Ananya", [82, 79, 2, 48], 58, 980, [520, 437]],
  ["Pinecrest Schools", "SMB", 52000, "USD", "Education", "Priya", [74, 70, 1, 35], 68, 290, null],
  ["Solace Pharma", "Mid", 187000, "USD", "Pharma", "Rahul", [42, 36, 6, -20], 27, 740, [300, 114]],
  ["Vantage Aviation", "Enterprise", 360000, "USD", "Aviation", "Ananya", [68, 64, 3, 25], 91, 1050, [480, 336]],
  ["Willow Analytics", "SMB", 40000, "USD", "Data & BI", "Rahul", [92, 90, 0, 65], 40, 150, [50, 47]],
  ["Ember Hospitality", "Mid", 112000, "PHP", "Hospitality", "Priya", [58, 52, 4, 0], 77, 450, null],
  ["Granite Insurance", "Enterprise", 310000, "USD", "Insurance", "Rahul", [76, 72, 2, 38], 109, 860, [420, 311]],
  ["Halcyon Telecom", "Mid", 142000, "INR", "Telecom", "Ananya", [64, 58, 3, 10], 49, 530, [210, 160]],
  ["Juniper Labs", "SMB", 48000, "USD", "Biotech", "Priya", [86, 83, 0, 52], 87, 200, [70, 66]],
  ["Foxglove Retail", "Mid", 125000, "USD", "Retail", "Ananya", [78, 72, 2, 32], 33, 600, null],
  ["Cinder Games", "SMB", 44000, "USD", "Gaming", "Rahul", [66, 62, 2, 18], 61, 240, null],
];
// Two churned accounts with reasons (inside the 12-month window so the bridge and churn cards show them).
const CHURNED = [
  ["Drift Couriers", "Mid", 92000, "USD", "Logistics", "Priya", 70, "Budget cuts"],
  ["Plume Studios", "SMB", 58000, "USD", "Media", "Rahul", 150, "Moved to a competitor"],
];
// ARR events (expansion / contraction), keyed by account index. [daysAgo, delta USD, kind]
const EVENTS = {
  0: [[40, 45000, "expansion"], [200, 30000, "expansion"]], 1: [[95, 25000, "expansion"]],
  2: [[60, 40000, "expansion"], [250, 20000, "expansion"]], 3: [[120, -20000, "contraction"]],
  6: [[80, -15000, "contraction"]], 8: [[30, 55000, "expansion"], [300, 35000, "expansion"]],
  10: [[150, 28000, "expansion"]], 12: [[65, -22000, "contraction"]], 14: [[20, 38000, "expansion"]],
  17: [[110, 30000, "expansion"]], 20: [[180, 26000, "expansion"]], 4: [[55, 14000, "expansion"]],
  5: [[210, 18000, "expansion"]], 16: [[130, -18000, "contraction"]],
};
// A few genuinely new customers in the last 12 months (start date inside the window).
const NEW_START = { 18: 150, 22: 200, 25: 240, 24: 120 };

const accounts = [];
ROWS.forEach((r, i) => {
  const [name, tier, usd, cur, industry, csm, [usage, sentiment, tickets, nps], renewIn, startAgo, lic] = r;
  const arr = native(usd, cur);
  const ev = (EVENTS[i] || []).map(([ago, d, kind], k) => ({ id: `ev-${i}-${k}`, date: day(-ago), delta: native(d, cur), kind, currency: cur, reason: kind === "expansion" ? "Added seats" : "Seat reduction", by: csm, source: "manual" }));
  const trend = usage >= 75 ? [-4, -3, -2, 0] : usage < 50 ? [6, 4, 3, 0] : [1, 0, -1, 0];
  const base = Math.round(usage * 0.5 + sentiment * 0.4 + 10 - tickets * 1.5);
  accounts.push(seedAccount({
    id: `acc${i + 1}`, accountNo: i + 1, name, tier, arr, currency: cur, industry, csm,
    startDate: day(-(NEW_START[i] ?? startAgo)), renewalDate: day(renewIn),
    contractStatus: renewIn < 30 ? "In negotiation" : "Active",
    inputs: { usage: usage >= 60 ? Math.min(96, usage + 8) : usage, sentiment: sentiment >= 55 ? Math.min(96, sentiment + 8) : sentiment, tickets, nps }, inputsUpdatedAt: day(-8),
    playbookSeededFor: day(renewIn), // stops the app auto-creating a renewal playbook task burst on load
    history: [-90, -60, -30, -7].map((off, k) => ({ d: day(off), s: Math.max(5, Math.min(98, base + trend[k] * 2)) })),
    arrEvents: ev,
    ...(lic ? { licenses: lic[0], ...(lic[1] != null ? { deployedLicenses: lic[1] } : {}) } : {}),
    qbrFrequency: "Quarterly", nextQbrDate: day(((i * 11) % 80) - 8),
  }));
});
CHURNED.forEach(([name, tier, usd, cur, industry, csm, ago, reason], j) => {
  accounts.push(seedAccount({
    id: `ch${j + 1}`, accountNo: ROWS.length + j + 1, name, tier, arr: usd, currency: cur, industry, csm,
    startDate: day(-700), renewalDate: day(-ago), contractStatus: "Churned",
    inputs: { usage: 20, sentiment: 18, tickets: 6, nps: -50 },
    churn: { date: day(-ago), reason, note: "", arr: usd, currency: cur, by: csm },
  }));
});

const SHOW = "acc1"; // Northwind Logistics: the account page we showcase
const contacts = [
  ["Meera Kulkarni", "VP Operations", "Positive", true], ["Oliver Brandt", "IT Director", "Neutral", false],
  ["Sanjay Rao", "Procurement Lead", "Neutral", false], ["Hannah Weiss", "Head of Analytics", "Positive", true],
].map(([name, role, sentiment, isChampion], k) => ({ id: `c${k}`, accountId: SHOW, name, role, sentiment, isChampion, email: `${name.split(" ")[0].toLowerCase()}@northwind-logistics.example` }));

const act = (id, accountId, type, off, summary, extra = {}) => ({ id, accountId, type, date: day(off), summary, loggedBy: "Priya", ...extra });
const activities = [
  act("a1", SHOW, "email", -1, "Forward: renewal terms and the 3-year option", { details: "Meera confirmed budget is approved for FY27. Wants the multi-year discount in writing before the board meets.", source: "email", participants: ["meera@northwind-logistics.example", "priya@acmeanalytics.example"] }),
  act("a2", SHOW, "QBR", -9, "Q3 business review: adoption up 18% across depots"),
  act("a3", SHOW, "call", -17, "Expansion call: dispatch team wants 100 more seats"),
  act("a4", SHOW, "note", -26, "Champion Meera presented our dashboards at their leadership offsite"),
  act("a5", SHOW, "ticket", -33, "Resolved: API latency from the Pune region, root cause fixed"),
  act("a6", SHOW, "email", -48, "Sent onboarding plan for the new warehouse sites"),
  act("a7", "acc4", "call", -6, "Harbor & Pine usage review: seats idle in two stores"),
  act("a8", "acc7", "ticket", -12, "Escalation: report exports timing out"),
  act("a9", "acc2", "QBR", -20, "Brightline QBR: roadmap alignment on compliance reports"),
  act("a10", "acc9", "call", -4, "Tidewater: kickoff for the field-ops rollout"),
];

const tasks = [];
const T = (accountId, title, off, priority, owner, status = "Open") => tasks.push({ id: `t${tasks.length}`, accountId, title, due: day(off), priority, status, owner });
T("acc1", "Send multi-year renewal proposal", 3, "High", "Priya"); T("acc1", "Schedule expansion scoping for 100 seats", 9, "Medium", "Priya");
T("acc4", "Run adoption workshop for idle stores", -2, "High", "Priya"); T("acc7", "Exec escalation call with COO", -4, "High", "Priya");
T("acc13", "Prepare mine-site usage review", 5, "Medium", "Priya"); T("acc20", "Confirm renewal terms with finance", 12, "Low", "Priya");
T("acc10", "Collect testimonial for case study", 18, "Low", "Priya"); T("acc16", "Update champion map", 6, "Low", "Priya", "Done");
T("acc2", "Compliance roadmap briefing", 2, "High", "Rahul"); T("acc8", "Rescue plan: low usage and open tickets", -5, "High", "Rahul");
T("acc11", "Renewal discount approval", 4, "High", "Rahul"); T("acc17", "Executive sponsor intro", 1, "Medium", "Rahul");
T("acc21", "Send 3-year pricing options", 15, "Medium", "Rahul"); T("acc14", "Share expansion deck", 22, "Low", "Rahul");
T("acc19", "Onboarding health check", 7, "Medium", "Rahul"); T("acc5", "Quarterly usage review", -1, "Medium", "Rahul");
T("acc3", "Plan executive QBR", 11, "Medium", "Ananya"); T("acc9", "Field-ops training sessions", 3, "High", "Ananya");
T("acc15", "Draft renewal business case", 8, "Medium", "Ananya"); T("acc18", "Check in on adoption dip", -3, "High", "Ananya");
T("acc22", "Pricing alignment call", 10, "Medium", "Ananya"); T("acc25", "Intro to new product lead", 14, "Low", "Ananya");
T("acc6", "Send integration guide", 5, "Low", "Ananya"); T("acc12", "Localised onboarding session", 19, "Low", "Ananya");
T("acc24", "Review contract amendments", 2, "Medium", "Ananya"); T("acc13", "Collect NPS survey results", -6, "Low", "Priya", "Done");
T("acc23", "Welcome call for new team", 4, "Medium", "Priya"); T("acc7", "Recovery plan draft", 1, "High", "Priya");
T("acc17", "Clinical-ops stakeholder map", 13, "Low", "Rahul"); T("acc9", "Executive summary for board pack", 6, "Medium", "Ananya");

const opportunities = [
  ["acc1", "upsell", 90000, "Proposal", 40], ["acc3", "cross-sell", 60000, "Negotiation", 25], ["acc9", "upsell", 120000, "Discovery", 80],
  ["acc15", "upsell", 75000, "Proposal", 55], ["acc6", "cross-sell", 30000, "Discovery", 95], ["acc18", "upsell", 85000, "Stalled", 110],
].map(([accountId, type, value, stage, off], k) => ({ id: `o${k}`, accountId, type, value, stage, closeDate: day(off) }));

// 12 prior monthly snapshots, ARR growing, NRR/GRR healthy, health mix improving.
const approxTotal = ROWS.reduce((s, r) => s + r[2], 0);
const snapshots = Array.from({ length: 12 }, (_, k) => {
  const back = 12 - k, d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back);
  const f = 0.74 + (k / 11) * 0.24;
  const green = 9 + Math.round(k * 0.8), red = Math.max(2, 7 - Math.round(k * 0.4));
  return { month: d.toISOString().slice(0, 7), totalARR: Math.round(approxTotal * f), accounts: 18 + Math.round(k * 0.6),
    nrr: +(0.98 + k * 0.0085 + (k % 3) * 0.004).toFixed(3), grr: +(0.91 + k * 0.0035).toFixed(3), churnedARR: 12000 + (k % 4) * 9000,
    Green: green, Yellow: 25 - green - red, Red: red, due90: 0, commit90: 0, atRisk90: 0, due90Count: 0 };
});

const settings = { snapshots, rates: { ...RATE } };
delete settings.rates.USD;

const profiles = [
  { id: "u1", name: "Priya", role: "admin", org_id: "org-a", platform_admin: false },
  { id: "u2", name: "Rahul", role: "csm", org_id: "org-a", platform_admin: false },
  { id: "u3", name: "Ananya", role: "csm", org_id: "org-a", platform_admin: false },
];
const wrap = r => ({ id: r.id, data: r });
const seedJs = `window.__seedRows = ${JSON.stringify({
  accounts: accounts.map(wrap), contacts: contacts.map(wrap), activities: activities.map(wrap),
  tasks: tasks.map(wrap), opportunities: opportunities.map(wrap), team: [],
  settings: [{ id: "settings", data: settings }], profiles,
  orgs: [{ id: "org-a", name: "Acme Analytics", max_accounts: null, max_users: null }],
})};
window.__seedProfile = ${JSON.stringify(profiles[0])};`;

// ---- capture ----
const url = buildMockedHtml(seedJs);
const browser = await chromium.launch({ channel: CHANNEL || undefined, headless: true });
const results = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce", colorScheme: "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  // Hide any transient toast so it cannot photobomb a shot; real error toasts are checked below.
  const load = async theme => {
    await page.addInitScript(t => { try { if (!localStorage.getItem("onevio.theme")) localStorage.setItem("onevio.theme", t); localStorage.setItem("dashAnalytics_Priya", "1"); } catch (e) {} }, theme);
    await page.goto(url);
    await page.waitForFunction(n => window.__store && window.__store.getState().accounts.length === n, accounts.length, { timeout: 20000 });
    await page.waitForFunction(() => window.__orgLimits && window.__orgLimits.loaded === true, null, { timeout: 15000 });
    await page.waitForSelector("[data-arr-bridge]", { state: "attached", timeout: 15000 });
    await page.waitForSelector("[data-analytics-toggle][aria-expanded='true']", { timeout: 10000 });
    await page.waitForFunction(() => window.__store.getState().settings.snapshots.length >= 12);
    await settle();
  };
  // fonts loaded + no toast on screen
  const settle = async () => {
    await page.evaluate(() => document.fonts && document.fonts.ready);
    const bad = await page.evaluate(() => [...document.querySelectorAll('[role="status"],[role="alert"]')].map(e => e.textContent).filter(t => /fail|error|could not|rolled back/i.test(t)));
    if (bad.length) throw new Error("error toast on screen: " + bad.join(" | "));
  };
  const view = async title => { await page.click(`button[title="${title}"]`, { timeout: 10000 }); await settle(); };
  const shot = async (name, opts = {}) => { await page.screenshot({ path: OUT + name + ".png", ...opts }); results.push(name + ".png"); };
  const card = async (name, locator) => {
    const el = page.locator(locator).first();
    await el.scrollIntoViewIfNeeded(); await el.waitFor({ state: "visible" });
    await el.screenshot({ path: OUT + name + ".png" }); results.push(name + ".png");
  };
  const top = () => page.evaluate(() => window.scrollTo(0, 0));
  const cardOf = title => `.nm:has(> div > h3:text-is("${title}"))`;

  await load("light");
  // Dashboard (top of page)
  await top(); await shot("dashboard");
  await card("health-card", cardOf("Health distribution"));
  await card("tasks-card", cardOf("Team tasks by owner"));
  await card("arr-bridge-card", cardOf("ARR bridge (12m, USD)"));
  // Analytics-expanded ARR bridge: scroll the bridge into the middle of the viewport
  await page.locator("[data-arr-bridge]").scrollIntoViewIfNeeded();
  await page.evaluate(() => { const e = document.querySelector("[data-arr-bridge]"); const r = e.getBoundingClientRect(); window.scrollBy(0, r.top - 120); });
  await shot("arr-bridge");
  // Licenses
  await page.locator("[data-license-card]").scrollIntoViewIfNeeded();
  await page.evaluate(() => { const e = document.querySelector("[data-license-card]"); const r = e.getBoundingClientRect(); window.scrollBy(0, r.top - 260); });
  await shot("licenses");
  await card("licenses-card", "[data-license-card]");

  // Health: accounts list sorted by score (riskiest first)
  await view("Accounts"); await page.waitForSelector("[data-account-row]");
  await page.click('th[data-sort-key="score"]'); await page.waitForSelector('th[data-sort-key="score"][aria-sort="ascending"]');
  await top(); await shot("health");

  // Renewals
  await view("Renewals"); await page.waitForFunction(() => /Renewal/.test(document.getElementById("root").textContent));
  await top(); await shot("renewals");

  // Tasks
  await view("Tasks"); await page.waitForFunction(() => /Work queue/.test(document.getElementById("root").textContent));
  await top(); await shot("tasks");

  // Account page
  await view("Accounts"); await page.waitForSelector("[data-account-row]");
  await page.click(`[data-account-row]:has-text("Northwind Logistics")`);
  await page.waitForSelector("[data-header-card]");
  await page.waitForFunction(() => /Activity timeline \(6\)/.test(document.getElementById("root").textContent));
  await top(); await shot("account");
  await card("account-header-card", "[data-header-card]");

  // Settings weights
  await view("Settings"); await page.waitForSelector("#set-scoring");
  await page.evaluate(() => document.getElementById("set-scoring").scrollIntoView());
  await page.evaluate(() => window.scrollBy(0, -20));
  await shot("settings-weights");
  await card("settings-weights-card", "#set-scoring");

  // Dark dashboard
  await page.context().clearCookies();
  await page.evaluate(() => { try { localStorage.setItem("onevio.theme", "dark"); } catch (e) {} });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await page.waitForSelector("[data-arr-bridge]", { state: "attached", timeout: 15000 });
  await page.waitForFunction(n => window.__store && window.__store.getState().accounts.length === n, accounts.length);
  await top(); await shot("dashboard-dark");

  if (errors.length) console.warn("page errors:", errors);
} finally {
  await browser.close();
}
console.log("wrote", results.length, "files to", OUT + "\n" + results.join("\n"));
