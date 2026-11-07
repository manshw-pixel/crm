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
  // <main> has transition-all, so after shrinking from the 1280 launch size its desktop margin slides
  // away over 150ms. Widths read during the slide are not the phone layout: wait for it to land.
  if (width < 1024) await r.page.waitForFunction(() => document.querySelector("main[data-main]").getBoundingClientRect().left === 0);
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

// ---- Task 4: Responses tab ----
const RT = { id: "qbr", name: "QBR feedback", questions: [{ id: "val", type: "rating", scale: 7, text: "Value?" }, { id: "why", type: "text", text: "Why?" }] };
const RA = [seedAccount({ id: "a1", name: "Alpha Co", csm: "Priya", tier: "Enterprise" }), seedAccount({ id: "a2", name: "Beta Co", csm: "Ravi", tier: "Mid" })];
const rs = (id, acct, role, source, date, tpl, answers) => ({ id, account_id: acct, contact_id: null, contact_name: "P " + id, contact_role: role, template_id: tpl.id, template_snapshot: tpl, source,
  sent_at: source === "sent" ? date + "T00:00:00Z" : null, expires_at: "2030-01-01T00:00:00Z", submitted_at: date + "T00:00:00Z", survey_answers: answers });
const nA = (n, t) => [{ question_id: "nps", value_num: n }, ...(t ? [{ question_id: "reason", value_text: t }] : [])];
const RS = [
  rs("r1", "a1", "CIO", "sent", "2026-03-06", TPL, nA(3, "Too slow")),
  rs("r2", "a1", "User", "sent", "2026-03-07", TPL, nA(9)),
  rs("r3", "a2", "CIO", "import", "2025-11-14", RT, [{ question_id: "val", value_num: 4 }, { question_id: "why", value_text: "<img src=x onerror=window.__xss=1>" }]),
  rs("r4", "a2", "", "sent", "2026-05-01", RT, [{ question_id: "val", value_num: 6 }]),
  { ...rs("r5", "a1", "CIO", "sent", "2026-03-05", TPL, []), submitted_at: null },
];
const rseed = (surveys = RS, extra = "") => `window.__seedRows = { accounts: ${rows(RA)}, contacts: [], activities: [], tasks: [], opportunities: [], team: [],
  settings: [], surveys: ${JSON.stringify(surveys)}, profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "admin" }] }; ${extra}`;
async function openResponses(script, width = 1280) {
  const r = await open(script, width);
  await r.page.waitForSelector("[data-sv-overview]");
  await r.page.click('[data-sv-tab="responses"]');
  await r.page.waitForSelector("[data-sv-responses]");
  return r;
}
const rowIds = page => page.$$eval("[data-sv-resp-row]", els => els.map(e => e.getAttribute("data-sv-resp-row")));

test("responses lists submitted surveys only, newest first", async () => {
  const { page, browser } = await openResponses(rseed());
  try {
    const ids = await rowIds(page);
    assert(JSON.stringify(ids) === JSON.stringify(["r4", "r2", "r1", "r3"]), "rows " + ids);
    const c = (await page.locator("[data-sv-count]").innerText()).replace(/\s+/g, " ");
    assert(/4 responses · 3 sent, 1 imported/.test(c), "count: " + c);
    const r1 = (await page.locator('[data-sv-resp-row="r1"]').innerText()).replace(/\s+/g, " ");
    assert(/NPS 3 · Detractor/.test(r1) && /Too slow/.test(r1) && /Alpha Co/.test(r1) && /Priya/.test(r1) && /6 Mar 2026/.test(r1), "r1: " + r1);
    const r4 = (await page.locator('[data-sv-resp-row="r4"]').innerText()).replace(/\s+/g, " ");
    assert(/6\/7/.test(r4) && /No comment/.test(r4), "r4: " + r4);
  } finally { await browser.close(); }
});

test("responses: each filter narrows the list", async () => {
  const { page, browser } = await openResponses(rseed());
  try {
    const sel = async (k, v) => { await page.selectOption(`[data-sv-filter="${k}"]`, v); return rowIds(page); };
    const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), m + ": " + a);
    eq(await sel("templateId", "qbr"), ["r4", "r3"], "template"); await sel("templateId", "");
    eq(await sel("csm", "Priya"), ["r2", "r1"], "csm"); await sel("csm", "");
    eq(await sel("tier", "Mid"), ["r4", "r3"], "tier"); await sel("tier", "");
    eq(await sel("role", "CIO"), ["r1", "r3"], "role"); eq(await sel("role", "(none)"), ["r4"], "no role"); await sel("role", "");
    eq(await sel("source", "import"), ["r3"], "imported"); eq(await sel("source", "sent"), ["r4", "r2", "r1"], "sent"); await sel("source", "");
    await page.fill('[data-sv-filter="from"]', "2026-03-07"); await page.fill('[data-sv-filter="to"]', "2026-03-31");
    eq(await rowIds(page), ["r2"], "date");
    await page.fill('[data-sv-filter="from"]', "2030-01-01");
    await page.waitForSelector("[data-sv-resp-empty]");
    assert(/No responses match/.test(await page.locator("[data-sv-resp-empty]").innerText()), "empty message");
  } finally { await browser.close(); }
});

test("responses: row opens its account, imported rows are marked, text answers render as text", async () => {
  const { page, browser } = await openResponses(rseed());
  try {
    assert(/Imported/.test(await page.locator('[data-sv-resp-row="r3"] [data-sv-source]').innerText()), "imported mark");
    assert(/Sent/.test(await page.locator('[data-sv-resp-row="r1"] [data-sv-source]').innerText()), "sent mark");
    assert(await page.locator("[data-sv-responses] img").count() === 0, "no img element");
    assert(/<img src=x/.test(await page.locator('[data-sv-resp-row="r3"]').innerText()), "shown as text");
    assert(await page.evaluate(() => window.__xss) === undefined, "no script ran");
    await page.locator('[data-sv-resp-row="r1"] button').first().click();
    await page.waitForSelector('nav[aria-label="Main"] button[title="Accounts"][aria-current="page"]');
  } finally { await browser.close(); }
});

test("responses: paging shows 25 per page and filters reset to page 1", async () => {
  const many = Array.from({ length: 30 }, (_, i) => rs("m" + String(i).padStart(2, "0"), "a1", "CIO", "sent", `2026-04-${String(i + 1).padStart(2, "0")}`, TPL, nA(9)));
  const { page, browser } = await openResponses(rseed([...many, ...RS]));
  try {
    assert((await rowIds(page)).length === 25, "25 rows");
    assert(/Showing 1–25 of 34/.test(await page.locator("[data-sv-paging]").innerText()), "paging text");
    await page.click("[data-sv-next]");
    assert((await rowIds(page)).length === 9, "second page");
    assert(/Showing 26–34 of 34/.test(await page.locator("[data-sv-paging]").innerText()), "page 2 text");
    await page.selectOption('[data-sv-filter="source"]', "import");
    assert(/Showing 1–1 of 1/.test(await page.locator("[data-sv-paging]").innerText()), "reset");
  } finally { await browser.close(); }
});

test("responses: CSV export uses the filtered rows", async () => {
  const { page, browser } = await openResponses(rseed());
  try {
    await page.selectOption('[data-sv-filter="source"]', "import");
    await page.evaluate(() => { window.__csv = null; const b = window.Blob; window.Blob = function (parts, o) { if (o && o.type === "text/csv") window.__csv = parts.join(""); return new b(parts, o); }; });
    await page.click("[data-sv-export]");
    const csv = await page.evaluate(() => window.__csv);
    assert(csv && /^Date,Account,CSM,Tier,Template/.test(csv), "header: " + csv);
    assert(/Beta Co/.test(csv) && !/Alpha Co/.test(csv), "only the filtered rows: " + csv);
  } finally { await browser.close(); }
});

test("responses: no sideways page scroll at 390px", async () => {
  const { page, browser } = await openResponses(rseed(), 390);
  try {
    const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    assert(w.doc <= w.win, "page scrolls sideways: " + JSON.stringify(w));
  } finally { await browser.close(); }
});

// ---- Task 5: Reports tab ----
const QB = { id: "qbr", name: "QBR feedback", questions: [{ id: "val", type: "rating", scale: 7, text: "Value?" }, { id: "pick", type: "single", text: "Improve next?", options: ["Reporting", "SSO"] }, { id: "why", type: "text", text: "Anything else?" }] };
const OLD = { id: "old", name: "Old pulse", questions: [{ id: "o1", type: "rating", scale: 5, text: "Happy?" }] };
const qa = (val, pick, why) => [{ question_id: "val", value_num: val }, { question_id: "pick", value_choices: [pick] }, ...(why ? [{ question_id: "why", value_text: why }] : [])];
const PS = [
  rs("p1", "a1", "CIO", "sent", "2026-07-10", QB, qa(6, "Reporting", "Fast")),
  rs("p2", "a1", "User", "sent", "2026-07-12", QB, qa(4, "SSO")),
  rs("p3", "a2", "CIO", "import", "2026-07-20", QB, qa(5, "Reporting", "Imported note")),
  rs("p4", "a2", "User", "sent", "2026-01-15", QB, qa(3, "SSO")),
  rs("p5", "a1", "CIO", "sent", "2025-01-01", OLD, [{ question_id: "o1", value_num: 5 }]),
  rs("n1", "a1", "CIO", "sent", "2026-03-06", TPL, nA(3, "Too slow")),
  rs("n2", "a1", "User", "sent", "2025-03-07", TPL, nA(10)),
];
async function openReports(surveys = PS, width = 1280) {
  const r = await open(rseed(surveys), width);
  await r.page.waitForSelector("[data-sv-overview]");
  await r.page.click('[data-sv-tab="reports"]');
  await r.page.waitForSelector("[data-sv-reports]");
  return r;
}
const flatOf = async (page, sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ");

test("reports: template picker lists sent templates, including archived ones, and defaults to the latest answered", async () => {
  const { page, browser } = await openReports();
  try {
    const opts = await page.$$eval('[data-sv-filter="report-template"] option', els => els.map(e => e.textContent));
    assert(JSON.stringify(opts) === JSON.stringify(["NPS check-in", "Old pulse", "QBR feedback"]), "options " + opts);
    assert(await page.locator('[data-sv-filter="report-template"]').inputValue() === "qbr", "default template");
    await page.selectOption('[data-sv-filter="report-template"]', "old");
    await page.waitForSelector('[data-sv-question="o1"]');
  } finally { await browser.close(); }
});

test("reports: rating shows 4.5 / 7 with its own distribution", async () => {
  const { page, browser } = await openReports();
  try {
    const q = await flatOf(page, '[data-sv-question="val"]');
    assert(/Q1 · RATING 1–7/.test(q) && /Value\?/.test(q) && /4\.5 \/ 7/.test(q) && /n ?= ?4/.test(q), "rating: " + q);
    const aria = await page.locator('[data-sv-question="val"] [role="img"]').first().getAttribute("aria-label");
    assert(/3: 1/.test(aria) && /6: 1/.test(aria) && /7: 0/.test(aria), "aria " + aria);
  } finally { await browser.close(); }
});

test("reports: nps shows the split by yearly campaign", async () => {
  const { page, browser } = await openReports();
  try {
    await page.selectOption('[data-sv-filter="report-template"]', "nps-checkin");
    const q = await flatOf(page, '[data-sv-question="nps"]');
    assert(/Mar 2026/.test(q) && /Mar 2025/.test(q) && /-100/.test(q) && /\+100/.test(q), "nps: " + q);
    assert(/always compare by yearly campaign/.test(await flatOf(page, "[data-sv-reports]")), "footnote");
    assert(await page.locator('[data-sv-question="nps"] [role="img"]').count() >= 2, "bars");
  } finally { await browser.close(); }
});

test("reports: choices show counts as text", async () => {
  const { page, browser } = await openReports();
  try {
    const q = await flatOf(page, '[data-sv-question="pick"]');
    assert(/Reporting 2/.test(q) && /SSO 2/.test(q) && /PICK ONE/.test(q), "choices: " + q);
  } finally { await browser.close(); }
});

test("reports: text answers list, five first, imported ones marked", async () => {
  const many = Array.from({ length: 7 }, (_, i) => rs("t" + i, "a1", "CIO", "sent", `2026-08-0${i + 1}`, QB, qa(5, "SSO", "note " + i)));
  const { page, browser } = await openReports([...PS, ...many]);
  try {
    assert(await page.locator("[data-sv-text-item]").count() === 5, "first five");
    const btn = page.locator("[data-sv-show-all]");
    assert(/Show all 9 text answers/.test(await btn.innerText()), "button " + await btn.innerText());
    await btn.click();
    assert(await page.locator("[data-sv-text-item]").count() === 9, "all");
    assert(/imported/.test(await flatOf(page, '[data-sv-text-item]:has-text("Imported note")')), "imported mark");
    assert(await page.locator("[data-sv-reports] img").count() === 0, "text only");
  } finally { await browser.close(); }
});

test("reports: filters by date, tier and CSM", async () => {
  const { page, browser } = await openReports();
  try {
    const n = async () => /n ?= ?(\d+)/.exec(await flatOf(page, '[data-sv-question="val"]'))[1];
    assert(await n() === "4", "all");
    await page.selectOption('[data-sv-filter="csm"]', "Priya"); assert(await n() === "2", "csm");
    await page.selectOption('[data-sv-filter="csm"]', "");
    await page.selectOption('[data-sv-filter="tier"]', "Mid"); assert(await n() === "2", "tier");
    await page.selectOption('[data-sv-filter="tier"]', "");
    await page.fill('[data-sv-filter="from"]', "2026-07-01"); await page.fill('[data-sv-filter="to"]', "2026-07-31");
    assert(await n() === "3", "date");
  } finally { await browser.close(); }
});

test("reports: comparison shows the previous period, and a dash when it has no answers", async () => {
  const { page, browser } = await openReports();
  try {
    assert(await page.locator("[data-sv-prev]").count() === 0, "no comparison without a range");
    // 2026-07-01..07-31 (31 days) -> previous 2026-05-31..06-30, no answers
    await page.fill('[data-sv-filter="from"]', "2026-07-01"); await page.fill('[data-sv-filter="to"]', "2026-07-31");
    const none = await flatOf(page, '[data-sv-question="val"] [data-sv-prev]');
    assert(/—/.test(none) && !/\/ 7/.test(none), "dash: " + none);
    // 2026-01-16..2026-07-31 holds p1-p3; the previous period ends 2026-01-15 and holds p4
    await page.fill('[data-sv-filter="from"]', "2026-01-16"); await page.fill('[data-sv-filter="to"]', "2026-07-31");
    const prev = await flatOf(page, '[data-sv-question="val"] [data-sv-prev]');
    assert(/3 \/ 7/.test(prev) && /n ?= ?1/.test(prev), "previous: " + prev);
    // half-filled or reversed ranges must not crash the page
    await page.fill('[data-sv-filter="to"]', "");
    await page.waitForSelector("[data-sv-reports]");
    await page.fill('[data-sv-filter="from"]', "2026-09-01"); await page.fill('[data-sv-filter="to"]', "2026-08-01");
    await page.waitForSelector("[data-sv-reports]");
    assert(await page.locator("[data-sv-prev]").count() === 0, "no comparison for a reversed range");
  } finally { await browser.close(); }
});

test("reports: role split shows roles side by side", async () => {
  const { page, browser } = await openReports();
  try {
    assert(await page.locator("[data-sv-role]").count() === 0, "off by default");
    await page.check("[data-sv-split]");
    const cio = await flatOf(page, '[data-sv-question="val"] [data-sv-role="CIO"]');
    const usr = await flatOf(page, '[data-sv-question="val"] [data-sv-role="User"]');
    assert(/5\.5 \/ 7/.test(cio) && /n ?= ?2/.test(cio), "CIO " + cio);
    assert(/3\.5 \/ 7/.test(usr) && /n ?= ?2/.test(usr), "User " + usr);
  } finally { await browser.close(); }
});

test("reports: CSV export uses the filtered rows", async () => {
  const { page, browser } = await openReports();
  try {
    await page.selectOption('[data-sv-filter="tier"]', "Mid");
    await page.evaluate(() => { window.__csv = null; const b = window.Blob; window.Blob = function (parts, o) { if (o && o.type === "text/csv") window.__csv = parts.join(""); return new b(parts, o); }; });
    await page.click("[data-sv-export]");
    const csv = await page.evaluate(() => window.__csv);
    assert(csv && /Beta Co/.test(csv) && !/Alpha Co/.test(csv) && /QBR feedback/.test(csv), "csv: " + csv);
  } finally { await browser.close(); }
});

test("reports: no sideways page scroll at 390px, with comparison and role split on", async () => {
  const { page, browser } = await openReports(PS, 390);
  try {
    await page.fill('[data-sv-filter="from"]', "2026-07-01"); await page.fill('[data-sv-filter="to"]', "2026-07-31");
    await page.check("[data-sv-split]");
    const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    assert(w.doc <= w.win, "page scrolls sideways: " + JSON.stringify(w));
  } finally { await browser.close(); }
});

test("surveys page: long names and text stay inside a 390px page, on every tab", async () => {
  const L = "Averylongunbrokenname".repeat(5);
  const LT = { ...TPL, name: L, questions: [{ id: "nps", type: "nps", text: L }, { id: "reason", type: "text", text: L }, { id: "pick", type: "multi", text: L, options: [L, "SSO"] }, { id: "val", type: "rating", scale: 10, text: L }] };
  const accts = [seedAccount({ id: "a1", name: L, csm: L, tier: L })];
  const list = [0, 1, 2].map(i => ({ ...sv("x" + i, "a1", "c" + i, L, "2026-03-05", `2026-03-0${i + 6}`, 2, L), contact_role: L, template_snapshot: LT,
    survey_answers: [{ question_id: "nps", value_num: 2 }, { question_id: "reason", value_text: L }, { question_id: "pick", value_choices: [L] }, { question_id: "val", value_num: 7 }] }));
  const tasks = list.map((s, i) => T({ id: "k" + i, surveyId: s.id, owner: L, due: "2030-01-01", createdAt: "2026-03-07T00:00:00Z" }));
  const script = `window.__seedRows = { accounts: ${rows(accts)}, contacts: [], activities: [], tasks: ${rows(tasks)}, opportunities: [], team: [],
    settings: [], surveys: ${JSON.stringify(list)}, profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "admin" }] };`;
  const { page, browser } = await open(script, 390);
  const fits = async tab => { const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth })); assert(w.doc <= w.win, tab + " scrolls sideways: " + JSON.stringify(w)); };
  try {
    await page.waitForSelector("[data-sv-awaiting-row]");
    await fits("overview");
    await page.click('[data-sv-tab="responses"]'); await page.waitForSelector("[data-sv-resp-row]");
    await fits("responses");
    await page.click('[data-sv-tab="reports"]'); await page.waitForSelector("[data-sv-question]");
    await page.fill('[data-sv-filter="from"]', "2026-01-01"); await page.fill('[data-sv-filter="to"]', "2026-12-31"); await page.check("[data-sv-split]");
    await page.waitForSelector("[data-sv-role]");
    await fits("reports");
  } finally { await browser.close(); }
});
