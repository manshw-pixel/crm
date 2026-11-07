// Surveys PR 4a Task 3: the admin Surveys page shell and its Overview tab.
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const A1 = seedAccount({ id: "a1", name: "Alpha Co", csm: "Priya" });
const A2 = seedAccount({ id: "a2", name: "Beta Co", csm: "Ravi" });
const TPL = { id: "nps-checkin", name: "NPS check-in", questions: [{ id: "nps", type: "nps", text: "Recommend?" }, { id: "reason", type: "text", text: "Why?" }] };
const sv = (id, acct, contact, name, sent, submitted, nps, reason) => ({ id, account_id: acct, contact_id: contact, contact_name: name, contact_role: "CIO", template_id: "nps-checkin",
  template_snapshot: TPL, source: "sent", sent_at: sent + "T00:00:00Z", expires_at: "2030-01-01T00:00:00Z", submitted_at: submitted ? submitted + "T00:00:00Z" : null,
  survey_answers: submitted ? [{ question_id: "nps", value_num: nps }, ...(reason ? [{ question_id: "reason", value_text: reason }] : [])] : [] });
// 2026 campaign: 4 sent, 3 answered (10, 2, 3) -> NPS -33; 2025 campaign: 2 sent, 2 answered (9, 9) -> NPS +100.
const SV = [
  sv("v1", "a1", "c1", "Ann Lee", "2026-03-05", "2026-03-06", 10, "Love it"),
  sv("v2", "a1", "c2", "Bob Roy", "2026-03-05", "2026-03-07", 2, "Too slow"),
  sv("v3", "a2", "c3", "Cy Tan", "2026-03-05", "2026-03-08", 3),
  sv("v4", "a2", "c4", "Di Fox", "2026-03-05", null),
  sv("v5", "a1", "c1", "Ann Lee", "2025-03-05", "2025-03-06", 9),
  sv("v6", "a2", "c3", "Cy Tan", "2025-03-05", "2025-03-06", 9),
];
const T = o => ({ accountId: "a1", title: "Follow up", due: "2026-03-14", priority: "High", status: "Open", owner: "Priya", source: "survey", questionId: "nps", ...o });
const TASKS = [
  T({ id: "t1", surveyId: "v2", createdAt: "2026-03-07T00:00:00Z" }),
  T({ id: "t2", surveyId: "v3", accountId: "a2", owner: "Ravi", status: "Done", createdAt: "2026-03-08T00:00:00Z", doneAt: "2026-03-10T00:00:00Z" }),
];
const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const seed = (role = "admin", { surveys = SV, tasks = TASKS, extra = "" } = {}) => `window.__seedRows = { accounts: ${rows([A1, A2])}, contacts: [], activities: [], tasks: ${rows(tasks)}, opportunities: [], team: [],
  settings: [], surveys: ${JSON.stringify(surveys)}, profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "${role}" }] }; ${extra}`;

const nav = (page, v) => page.locator(`nav[aria-label="Main"] button[title="${v}"]`);
async function open(script, width = 1280) {
  const r = await launch(script);
  await r.page.setViewportSize({ width, height: 900 });
  await r.page.waitForSelector('nav[aria-label="Main"] button[title="Dashboard"]');
  // the sidebar is a drawer on a phone, so open the page with its number key (6 for an admin)
  if (await nav(r.page, "Surveys").count()) await r.page.keyboard.press("6");
  return r;
}
const titles = page => page.$$eval('nav[aria-label="Main"] button[title]', els => els.map(e => e.getAttribute("title")));

test("surveys page: admin sees Surveys between Renewals and Finance, and the number key opens it", async () => {
  const { page, browser } = await launch(seed("admin"));
  try {
    await page.waitForSelector('nav[aria-label="Main"] button[title="Surveys"]');
    const t = await titles(page);
    assert(JSON.stringify(t) === JSON.stringify(["Dashboard", "Implementation", "Tasks", "Accounts", "Renewals", "Surveys", "Finance", "Settings"]), "sidebar " + JSON.stringify(t));
    await page.keyboard.press("6");
    await page.waitForSelector('nav[aria-label="Main"] button[title="Surveys"][aria-current="page"]');
    await page.waitForSelector("[data-surveys-page]");
    assert((await page.locator("h1").first().innerText()).trim() === "Surveys", "h1");
    // the palette offers it too
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog", { name: "Command palette" }).locator("input").fill("surveys");
    assert(await page.getByText("Go to Surveys").count() === 1, "palette entry");
  } finally { await browser.close(); }
});

test("surveys page: CSM has no Surveys entry, no palette entry, and keys are unchanged", async () => {
  const { page, browser } = await launch(seed("user"));
  try {
    await page.waitForSelector('nav[aria-label="Main"] button[title="Finance"]');
    const t = await titles(page);
    assert(JSON.stringify(t) === JSON.stringify(["Dashboard", "Implementation", "Tasks", "Accounts", "Renewals", "Finance"]), "sidebar " + JSON.stringify(t));
    await page.keyboard.press("6");
    await page.waitForSelector('nav[aria-label="Main"] button[title="Finance"][aria-current="page"]');
    assert(await page.locator("[data-surveys-page]").count() === 0, "no page");
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog", { name: "Command palette" }).locator("input").fill("surveys");
    assert(await page.getByText("Go to Surveys").count() === 0, "palette must not offer Surveys");
  } finally { await browser.close(); }
});

test("surveys page: overview numbers", async () => {
  const { page, browser } = await open(seed());
  try {
    await page.waitForSelector("[data-sv-overview]");
    const flat = async sel => (await page.locator(sel).innerText()).replace(/\s+/g, " ");
    const kpi = k => flat(`[data-sv-kpi="${k}"]`);
    const nps = await kpi("nps");
    assert(/Customer NPS/.test(nps) && /2026/.test(nps) && /-33/.test(nps) && /n ?= ?3/.test(nps) && /-133 vs 2025/.test(nps), "nps kpi: " + nps);
    const rate = await kpi("rate");
    assert(/Response rate/.test(rate) && /75%/.test(rate) && /3 of 4/.test(rate), "rate kpi: " + rate);
    const aw = await kpi("awaiting");
    assert(/Detractors awaiting follow-up/.test(aw) && /\b1\b/.test(aw), "awaiting kpi: " + aw);
    const fu = await kpi("followup");
    assert(/Followed up within 7 days/.test(fu) && /50%/.test(fu), "followup kpi: " + fu);
    const years = await flat("[data-sv-years]");
    assert(/Mar 2026/.test(years) && /Mar 2025/.test(years) && /\+100/.test(years) && /one campaign each March/.test(years), "years: " + years);
    const rowsAw = page.locator("[data-sv-awaiting] [data-sv-awaiting-row]");
    assert(await rowsAw.count() === 1, "one awaiting row");
    const awt = (await rowsAw.innerText()).replace(/\s+/g, " ");
    assert(/Alpha Co/.test(awt) && /Bob Roy/.test(awt) && /CIO/.test(awt) && /\b2\b/.test(awt) && /Too slow/.test(awt) && /Priya/.test(awt), "awaiting row: " + awt);
    const pt = await flat('[data-sv-csm-row="Priya"]'), rt = await flat('[data-sv-csm-row="Ravi"]');
    assert(/0 of 1 · 0%/.test(pt) && /2 2 100%/.test(pt), "Priya: " + pt);
    assert(/1 of 1 · 100%/.test(rt) && /2 1 50%/.test(rt), "Ravi: " + rt);
    assert(await page.locator('[aria-label="Detractors followed up within 7 days: 1 of 1 (100%)"]').count() === 1, "cell label");
    assert(await page.locator("[data-sv-export]").count() === 0 && !/Export CSV/.test(await page.locator("[data-surveys-page]").innerText()), "no Export CSV on Overview");
    // the account link opens the account
    await rowsAw.locator("button").first().click();
    await page.waitForSelector('nav[aria-label="Main"] button[title="Accounts"][aria-current="page"]');
  } finally { await browser.close(); }
});

test("surveys page: empty and failed states", async () => {
  let { page, browser } = await open(seed("admin", { surveys: [], tasks: [] }));
  try {
    await page.waitForSelector("[data-sv-empty]");
    assert(/No survey responses yet/.test(await page.locator("[data-sv-empty]").innerText()), "empty text");
    assert(await page.locator("[data-sv-kpi]").count() === 0, "no zero KPIs when empty");
  } finally { await browser.close(); }
  ({ page, browser } = await open(seed("admin", { extra: `window.__tableError = { surveys: { code: "42501", message: "permission denied" } };` })));
  try {
    await page.waitForSelector("[data-sv-failed]");
    const t = await page.locator("[data-surveys-page]").innerText();
    assert(/Survey data could not be loaded/.test(t), "failed text: " + t);
    assert(await page.locator("[data-sv-kpi]").count() === 0, "no KPI of zero on failure");
  } finally { await browser.close(); }
});

test("surveys page: tab is remembered, and blocked storage still renders", async () => {
  let { page, browser } = await open(seed());
  try {
    await page.waitForSelector("[data-sv-overview]");
    const tabs = await page.$$eval('[role="tab"][data-sv-tab]', els => els.map(e => e.getAttribute("data-sv-tab")));
    assert(JSON.stringify(tabs) === JSON.stringify(["overview", "responses", "reports"]), "tabs " + tabs);
    await page.click('[data-sv-tab="responses"]');
    await page.waitForSelector("[data-sv-responses]");
    assert(await page.locator('[data-sv-tab="responses"]').getAttribute("aria-selected") === "true", "selected");
    assert(await page.evaluate(() => localStorage.getItem("onevio.surveys.tab")) === "responses", "stored");
    await page.reload();
    await page.waitForSelector('nav[aria-label="Main"] button[title="Surveys"]');
    await page.click('nav[aria-label="Main"] button[title="Surveys"]');
    await page.waitForSelector("[data-sv-responses]");
  } finally { await browser.close(); }
  ({ page, browser } = await open(seed("admin", { extra: `Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });` })));
  try {
    await page.waitForSelector("[data-sv-overview]");
    await page.click('[data-sv-tab="reports"]');
    await page.waitForSelector("[data-sv-reports]");
  } finally { await browser.close(); }
});

test("surveys page: no horizontal scroll at 390px", async () => {
  const { page, browser } = await open(seed(), 390);
  try {
    await page.waitForSelector("[data-sv-overview]");
    const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    assert(w.doc <= w.win, "page scrolls sideways: " + JSON.stringify(w));
    for (const sel of ["[data-sv-awaiting]", "[data-sv-years]", "[data-sv-csm]"]) {
      const v = await page.evaluate(s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { right: r.right, win: window.innerWidth }; }, sel);
      assert(v.right <= v.win + 1, sel + " overflows: " + JSON.stringify(v));
    }
  } finally { await browser.close(); }
});
