import { test, assert } from "./framework.mjs";
import { launch, launchPersistent, seedAccount } from "./harness.mjs";

// Task 10: the Workload tab (admin / impl_lead) and the Dashboard "Implementation projects" card.
const DAY = 86400000;
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const TODAY = Date.now();
const YEAR = new Date().getUTCFullYear();
const rows = list => `${JSON.stringify(list)}.map(d => ({ id: d.id, data: d }))`;
const proj = (id, accountId, stage, implementerId, history) => ({ id, accountId, type: "onboarding", stage, implementerId, createdBy: "Cara",
  checklistTemplate: [], checklist: {}, targetGoLive: null, startedAt: null, liveAt: null, history, holdReason: "" });
const h = (at, from, to, y = YEAR) => ({ at: `${y}-${at}T09:00:00.000Z`, by: "Cara", from, to, note: "" });

/* ------------------------------- Workload ------------------------------- */
const W_ACCT = seedAccount({ id: "a1", name: "Acme", csm: "Cara" });
const W_TASK = { id: "k1", projectId: "p1", accountId: "a1", title: "Configure", ownerId: "u2", due: isoDay(TODAY + 14 * DAY), estHours: 10,
  timeLog: [{ by: "Ivy", at: isoDay(TODAY - 2 * DAY), hours: 2 }], status: "todo", signoff: "pending", signoffNote: "", signedBy: null, signedAt: null, order: 1 };
const wSeed = role => `window.__seedRows = { accounts: ${rows([W_ACCT])}, contacts: [], activities: [], tasks: [], opportunities: [],
  projects: ${rows([proj("p1", "a1", "in_progress", "u2", [h("01-01", "queued", "in_progress")])])}, project_tasks: ${rows([W_TASK])},
  settings: [], team: [],
  profiles: [{ id: "u1", org_id: "org-a", name: "Boss", role: "${role}" }, { id: "u2", org_id: "org-a", name: "Ivy", role: "impl_user" },
    { id: "u3", org_id: "org-a", name: "Zed", role: "impl_user" }] };`;
const openWorkload = async page => {
  await page.click('button[title="Implementation"]').catch(() => {});
  await page.click('[data-impl-tab="Workload"]');
  await page.waitForSelector('[data-workload-row="u2"]');
};
const cells = (page, id) => page.locator(`[data-workload-row="${id}"] [data-col]`).evaluateAll(els => Object.fromEntries(els.map(e => [e.dataset.col, e.textContent.trim()])));

test("workload: rows show active, remaining, logged 30d, free-from and coloured load; no-task implementer shows —", async () => {
  const { page, browser } = await launch(wSeed("admin"));
  try {
    await openWorkload(page);
    const ivy = await cells(page, "u2");
    assert(ivy.active === "1" && ivy.remaining === "8h" && ivy.logged30 === "2h", "ivy " + JSON.stringify(ivy));
    assert(ivy.freeFrom && ivy.freeFrom !== "—", "ivy free-from " + ivy.freeFrom);
    assert(ivy.load === "13%", "ivy load " + ivy.load);
    assert(await page.locator('[data-workload-row="u2"] [data-col="load"][data-band="green"].text-emerald-600').count() === 1, "green class");
    const zed = await cells(page, "u3");
    assert(zed.active === "0" && zed.freeFrom === "—" && zed.load === "—", "zed " + JSON.stringify(zed));
  } finally { await browser.close(); }
});

test("workload: admin edits capacity -> load re-bands amber and the value survives a reload", async () => {
  const { page, browser, reload } = await launchPersistent(wSeed("admin"));
  try {
    await openWorkload(page);
    await page.fill('[data-workload-row="u2"] [data-capacity-input]', "4");
    await page.locator('[data-workload-row="u2"] [data-capacity-input]').blur();
    await page.waitForSelector('[data-workload-row="u2"] [data-col="load"][data-band="amber"].text-amber-600');
    assert((await cells(page, "u2")).load === "100%", "load after capacity 4");
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
    await reload();
    await openWorkload(page);
    assert(await page.inputValue('[data-workload-row="u2"] [data-capacity-input]') === "4", "capacity persisted");
    assert(await page.locator('[data-workload-row="u2"] [data-col="load"][data-band="amber"]').count() === 1, "band persisted");
  } finally { await browser.close(); }
});

test("workload: impl_lead sees the table read-only; impl_user has no Workload tab", async () => {
  let r = await launch(wSeed("impl_lead"));
  try {
    await openWorkload(r.page);
    assert(await r.page.locator("[data-capacity-input]").count() === 0, "capacity input shown to impl_lead");
    assert((await cells(r.page, "u2")).capacity === "30h", "capacity shown as text");
  } finally { await r.browser.close(); }
  r = await launch(wSeed("impl_user"));
  try {
    await r.page.waitForSelector('[data-impl-tab="Board"]');
    assert(await r.page.locator('[data-impl-tab="Workload"]').count() === 0, "Workload tab shown to impl_user");
  } finally { await r.browser.close(); }
});

/* ------------------------------- Dashboard card ------------------------------- */
const ENT = seedAccount({ id: "a1", name: "Bigco", csm: "Test User" }); ENT.tier = "Enterprise";
const MID = seedAccount({ id: "a2", name: "Smallco", csm: "Test User" }); MID.tier = "Mid";
// last year, so no period is in the future (the card blanks future periods)
const LAST = YEAR - 1;
const D_PROJECTS = [
  proj("p1", "a1", "in_progress", "u2", [h("01-01", "queued", "in_progress", LAST)]),
  proj("p2", "a2", "live", "u2", [h("02-01", "handover", "queued", LAST), h("02-10", "queued", "in_progress", LAST), h("03-05", "csm_review", "live", LAST)]),
  proj("p3", "a2", "on_hold", "u2", [h("04-01", "handover", "queued", LAST), h("04-03", "queued", "on_hold", LAST)]),
];
const dSeed = `window.__seedRows = { accounts: ${rows([ENT, MID])}, contacts: [], activities: [], tasks: [], opportunities: [],
  projects: ${rows(D_PROJECTS)}, project_tasks: [], settings: [],
  profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "admin" }, { id: "u2", org_id: "org-a", name: "Ivy", role: "impl_user" }] };`;
const bar = (page, label) => page.locator(`[data-impl-bar="${label}"]`).evaluate(e => ({ a: +e.dataset.active, c: +e.dataset.completed, o: +e.dataset.onHold }));
const labels = page => page.locator("[data-impl-period-label]").evaluateAll(els => els.map(e => e.textContent));

test("dashboard impl card: 12 months, quarter toggle, tier filter changes counts, tier table", async () => {
  const { page, browser } = await launch(dSeed);
  try {
    await page.waitForSelector("[data-impl-chart]");
    assert((await labels(page)).join() === "Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec", "months " + (await labels(page)).join());
    assert(await page.locator("[data-impl-year]").inputValue() === String(YEAR), "year picker defaults to current year");
    // this year: p1 still in progress, so the current month counts it; later months are blank
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], m = new Date().getUTCMonth();
    assert((await bar(page, MON[m])).a === 1, "current month active");
    if (m < 11) assert((await bar(page, MON[m + 1])).a === 0, "a future month is blank");
    await page.selectOption("[data-impl-year]", String(LAST));
    let feb = await bar(page, "Feb"), mar = await bar(page, "Mar"), apr = await bar(page, "Apr");
    assert(feb.a === 2 && mar.c === 1 && apr.o === 1, JSON.stringify({ feb, mar, apr }));
    // tier table defaults to the latest period with data (Dec: p1 active, p3 on hold)
    assert(await page.locator("[data-impl-tier-period]").textContent() === "Dec", "tier period");
    const ent = await page.locator('[data-impl-tier-row="Enterprise"]').evaluate(e => e.dataset.counts);
    const mid = await page.locator('[data-impl-tier-row="Mid"]').evaluate(e => e.dataset.counts);
    assert(ent === "1,0,0" && mid === "0,0,1", `tier rows ent=${ent} mid=${mid}`);
    await page.selectOption("[data-impl-tier-filter]", "Enterprise");
    feb = await bar(page, "Feb"); mar = await bar(page, "Mar");
    assert(feb.a === 1 && mar.c === 0, "filtered " + JSON.stringify({ feb, mar }));
    await page.selectOption("[data-impl-tier-filter]", "All");
    await page.click('[data-impl-mode="quarter"]');
    assert((await labels(page)).join() === "Q1,Q2,Q3,Q4", "quarters " + (await labels(page)).join());
    const q1 = await bar(page, "Q1");
    assert(q1.a === 1 && q1.c === 1, "Q1 " + JSON.stringify(q1));
  } finally { await browser.close(); }
});

test("dashboard impl card: dark mode switches bar fills to the dark palette steps and keeps labels legible", async () => {
  const { page, browser } = await launch(dSeed);
  try {
    await page.waitForSelector("[data-impl-chart]");
    await page.selectOption("[data-impl-year]", String(LAST));
    const read = () => page.evaluate(() => {
      const seg = document.querySelector('[data-impl-bar="Feb"] [data-seg="active"]');
      const lbl = document.querySelector("[data-impl-period-label]");
      return { fill: getComputedStyle(seg).fill, label: getComputedStyle(lbl).fill };
    });
    const light = await read();
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const dark = await read();
    assert(light.fill === "rgb(99, 102, 241)", "light active fill " + light.fill);
    assert(dark.fill === "rgb(90, 95, 190)", "dark active fill " + dark.fill);
    assert(light.label !== dark.label, "axis labels flip with the palette " + JSON.stringify({ light, dark }));
  } finally { await browser.close(); }
});
