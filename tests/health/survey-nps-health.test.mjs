import { test, assert } from "./framework.mjs";
import { launch, seedAccount, rootText } from "./harness.mjs";

// Survey NPS is applied at read time: scores use it, stored inputs.nps never changes.
const NOW = new Date().toISOString();
const SNAP = { id: "nps-checkin", name: "NPS check-in", questions: [{ id: "nps", type: "nps", text: "Recommend?", required: true }] };
const answers = (accountId, n, value = 10) => Array.from({ length: n }, (_, i) => ({
  id: `${accountId}-s${i}`, account_id: accountId, contact_id: `${accountId}-c${i}`, contact_name: "C", contact_role: "", template_id: "nps-checkin",
  template_snapshot: SNAP, source: "manual", sent_at: NOW, expires_at: NOW, submitted_at: NOW,
  survey_answers: [{ question_id: "nps", value_num: value, value_text: null, value_choices: null }] }));
const seed = (accounts, surveys) => `window.__seedRows = { accounts: ${JSON.stringify(accounts.map(d => ({ id: d.id, data: d })))}, contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: [], surveys: ${JSON.stringify(surveys)} };`;
const TYPED = { usage: 100, sentiment: 100, tickets: 0, nps: -50 };
const ready = page => page.waitForFunction(() => window.__recordHealthCalls && window.__recordHealthCalls.length > 0, null, { timeout: 15000 });
const expected = (page, nps) => page.evaluate(n => {
  const st = window.__store.getState(), a = st.accounts[0];
  return Math.round(window.__health.healthScore({ ...a, inputs: { ...a.inputs, nps: n } }, st.activities, st.settings.weights, st.settings));
}, nps);
const recorded = page => page.evaluate(() => window.__recordHealthCalls[0][0].score);
async function openDetail(page, name) {
  await page.click('button[title="Accounts"]');
  await page.getByText(name).first().click();
  await page.waitForSelector("[data-more-actions]", { timeout: 8000 });
}

test("survey nps: 3 answers score as NPS 100 and leave the typed -50 stored", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "n1", inputs: TYPED })], answers("n1", 3)));
  try {
    await ready(page);
    const want = await expected(page, 100);
    assert(want !== await expected(page, -50), "fixture cannot tell the two scores apart");
    assert(await recorded(page) === want, "score should use survey NPS");
    assert(await page.evaluate(() => window.__store.getState().accounts[0].inputs.nps) === -50, "stored inputs.nps changed");
  } finally { await browser.close(); }
});

test("survey nps: 2 answers are too few, so the typed -50 scores", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "n2", inputs: TYPED })], answers("n2", 2)));
  try {
    await ready(page);
    assert(await recorded(page) === await expected(page, -50), "score should use typed NPS");
  } finally { await browser.close(); }
});

test("survey nps: Update health shows the typed -50 and saving leaves it", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "n3", name: "Dialog Co", inputs: TYPED })], answers("n3", 3)));
  try {
    await ready(page);
    await openDetail(page, "Dialog Co");
    await page.getByRole("button", { name: "✎ Update health" }).click();
    const box = page.getByLabel(/^nps/);
    assert(await box.inputValue() === "-50", "dialog shows " + await box.inputValue());
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() => (window.__store.getState().accounts[0].history || []).length === 1);
    const a = await page.evaluate(() => window.__store.getState().accounts[0]);
    assert(a.inputs.nps === -50, "saved nps " + a.inputs.nps);
  } finally { await browser.close(); }
});

test("survey nps: an answer newer than inputsUpdatedAt removes the Inputs stale flag", async () => {
  const old = new Date(Date.now() - 100 * 864e5).toISOString().slice(0, 10);
  const accounts = [seedAccount({ id: "n4", name: "Fresh Co", inputsUpdatedAt: old }), seedAccount({ id: "n5", name: "Stale Co", inputsUpdatedAt: old })];
  const { page, browser } = await launch(seed(accounts, answers("n4", 1)));
  try {
    await ready(page);
    await openDetail(page, "Stale Co");
    assert(/Inputs stale/.test(await rootText(page)), "control account should be flagged stale");
    await openDetail(page, "Fresh Co");
    assert(!/Inputs stale/.test(await rootText(page)), "survey answer should clear the flag");
    assert(/Inputs last updated today/.test(await rootText(page)), "breakdown should date from the answer");
  } finally { await browser.close(); }
});

test("survey nps: a refetch whose surveys read fails keeps the score and adds no task", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "n6", healthBand: "Green", healthPlaybookBand: "Green", inputs: TYPED })], answers("n6", 3)));
  try {
    await ready(page);
    assert(await expected(page, 100) >= 70 && await expected(page, -50) < 70, "fixture must cross a band without the survey");
    await page.evaluate(async () => { window.__tableError = { surveys: { message: "network" } }; await window.__refetch(); await new Promise(r => setTimeout(r, 300)); });
    const s = await page.evaluate(() => { const st = window.__store.getState(); return { surveys: st.surveys.length, band: st.accounts[0].healthBand, tasks: st.tasks.filter(t => t.healthPlaybook).length }; });
    assert(s.surveys === 3, "surveys dropped: " + s.surveys);
    assert(s.band === "Green" && s.tasks === 0, "score moved: " + JSON.stringify(s));
  } finally { await browser.close(); }
});

// ---- Task 6: NPS source on the account, Surveys card campaign window, Settings fields ----
const dated = (accountId, list) => list.map(([value, at], i) => ({ ...answers(accountId, 1, value)[0], id: `${accountId}-d${i}`, contact_id: `${accountId}-dc${i}`, submitted_at: at }));
const seedWith = (accounts, surveys, settings, role = "admin") => `window.__seedRows = { accounts: ${JSON.stringify(accounts.map(d => ({ id: d.id, data: d })))}, contacts: [], activities: [], tasks: [], opportunities: [],
  settings: ${JSON.stringify([{ id: "1", data: settings }])}, surveys: ${JSON.stringify(surveys)},
  profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "${role}" }] };`;
const TYPED20 = { usage: 100, sentiment: 100, tickets: 0, nps: 20 };
const FIVE = [10, 10, 10, 8, 2].map(v => [v, NOW]); // 3 promoters, 1 detractor of 5: +40
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("nps source: enough answers show the green pill and the typed value as fallback", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "p1", name: "Source Co", inputs: TYPED20 })], dated("p1", FIVE)));
  try {
    await ready(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await openDetail(page, "Source Co");
    const pill = page.locator("[data-nps-source] .ad-pill");
    assert((await pill.innerText()).trim() === "NPS from surveys (n=5)", "pill: " + await pill.innerText());
    assert(await pill.getAttribute("data-sev") === "green", "enough is green");
    assert((await page.locator("[data-nps-source-note]").innerText()).trim() === "Score +40 · typed value +20 kept as fallback", "note: " + await page.locator("[data-nps-source-note]").innerText());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    assert(await noOverflow(page), "page overflows at 390px");
    const box = await pill.boundingBox();
    assert(box.x >= 0 && box.x + box.width <= 390, "pill leaves the screen: " + JSON.stringify(box));
    assert(await page.evaluate(() => window.__store.getState().accounts[0].inputs.nps) === 20, "typed value changed");
  } finally { await browser.close(); }
});

test("nps source: too few answers show the grey pill with the threshold", async () => {
  const { page, browser } = await launch(seed([seedAccount({ id: "p2", name: "Few Co", inputs: TYPED20 })], dated("p2", [[10, NOW], [8, NOW]])));
  try {
    await ready(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await openDetail(page, "Few Co");
    const pill = page.locator("[data-nps-source] .ad-pill");
    assert((await pill.innerText()).trim() === "Survey NPS +50 (n=2, needs 3)", "pill: " + await pill.innerText());
    assert(await pill.getAttribute("data-sev") === "grey", "too few is grey");
    assert((await page.locator("[data-nps-source-note]").innerText()).trim() === "Using typed NPS", "note");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    assert(await noOverflow(page), "page overflows at 390px");
    const box = await pill.boundingBox();
    assert(box.x >= 0 && box.x + box.width <= 390, "grey pill leaves the screen: " + JSON.stringify(box));
  } finally { await browser.close(); }
});

test("nps source: the threshold comes from settings, and no answers means no line", async () => {
  const accounts = [seedAccount({ id: "p3", name: "Five Co", inputs: TYPED20 }), seedAccount({ id: "p4", name: "None Co", inputs: TYPED20 })];
  const { page, browser } = await launch(seedWith(accounts, dated("p3", FIVE), { surveys: { minNpsResponses: 6 } }));
  try {
    await ready(page);
    await openDetail(page, "Five Co");
    assert((await page.locator("[data-nps-source] .ad-pill").innerText()).trim() === "Survey NPS +40 (n=5, needs 6)", "needs 6");
    await openDetail(page, "None Co");
    assert(await page.locator("[data-nps-source]").count() === 0, "no answers, no line");
  } finally { await browser.close(); }
});

test("nps source: a negative score keeps its sign and a zero score has none", async () => {
  const accounts = [seedAccount({ id: "p5", name: "Negative Co", inputs: TYPED20 }), seedAccount({ id: "p6", name: "Zero Co", inputs: TYPED20 })];
  const { page, browser } = await launch(seed(accounts, [...dated("p5", [[2, NOW], [3, NOW]]), ...dated("p6", [[10, NOW], [2, NOW]])]));
  try {
    await ready(page);
    await openDetail(page, "Negative Co");
    const pill = page.locator("[data-nps-source] .ad-pill");
    assert((await pill.innerText()).trim() === "Survey NPS -100 (n=2, needs 3)", "negative: " + await pill.innerText());
    await openDetail(page, "Zero Co");
    assert((await pill.innerText()).trim() === "Survey NPS 0 (n=2, needs 3)", "zero: " + await pill.innerText());
  } finally { await browser.close(); }
});

// A February answer belongs to the campaign that began the March before it.
const CAMPAIGN = [[10, "2026-02-10T10:00:00Z"], [0, "2025-04-10T10:00:00Z"], [10, "2025-02-10T10:00:00Z"]];
test("surveys card: March campaign puts a February 2026 answer in the 2025 campaign", async () => {
  const { page, browser } = await launch(seedWith([seedAccount({ id: "w1", name: "Window Co" })], dated("w1", CAMPAIGN), { surveys: { npsCampaignMonth: 3 } }));
  try {
    await ready(page);
    await openDetail(page, "Window Co");
    const t = await page.locator("[data-surveys-nps]").innerText();
    assert(/NPS 0 from 2 answers/.test(t) && /2025 campaign/.test(t), "latest: " + t);
    assert(/2024 campaign: NPS \+100 from 1 answer/.test(t), "previous: " + t);
  } finally { await browser.close(); }
});

test("surveys card: a January campaign month regroups the same answers", async () => {
  const { page, browser } = await launch(seedWith([seedAccount({ id: "w2", name: "January Co" })], dated("w2", CAMPAIGN), { surveys: { npsCampaignMonth: 1 } }));
  try {
    await ready(page);
    await openDetail(page, "January Co");
    const t = await page.locator("[data-surveys-nps]").innerText();
    assert(/NPS \+100 from 1 answer/.test(t) && /2026 campaign/.test(t), "latest: " + t);
    assert(/2025 campaign: NPS 0 from 2 answers/.test(t), "previous: " + t);
  } finally { await browser.close(); }
});

const cfg = page => page.evaluate(() => window.__store.getState().settings.surveys);
const settingsPage = async page => { await page.click("text=Settings"); await page.waitForSelector("[data-surveys-settings]"); };

test("survey settings: both fields save on blur, not per keystroke", async () => {
  const { page, browser } = await launch(seedWith([seedAccount({ id: "t1" })], [], {}));
  try {
    assert(await page.locator('button[title="Settings"]').count() === 1, "the CSM test's selector must find the admin link");
    await settingsPage(page);
    const min = page.locator("[data-survey-min-nps]"), month = page.locator("[data-survey-campaign-month]");
    assert(await min.inputValue() === "3" && await month.inputValue() === "3", "defaults shown");
    await min.fill("7");
    assert((await cfg(page)).minNpsResponses === 3, "wrote before blur");
    await min.blur();
    await month.fill("12");
    await month.blur();
    const c = await cfg(page);
    assert(c.minNpsResponses === 7 && c.npsCampaignMonth === 12, "saved " + JSON.stringify(c));
  } finally { await browser.close(); }
});

test("survey settings: out-of-range and non-whole values do not save", async () => {
  const { page, browser } = await launch(seedWith([seedAccount({ id: "t2" })], [], { surveys: { minNpsResponses: 4, npsCampaignMonth: 6 } }));
  try {
    await settingsPage(page);
    for (const [sel, key, keep, bad] of [["[data-survey-min-nps]", "minNpsResponses", "4", ["0", "51", "2.5", ""]], ["[data-survey-campaign-month]", "npsCampaignMonth", "6", ["0", "13", "2.5", ""]]]) {
      for (const v of bad) {
        const box = page.locator(sel);
        await box.fill(v);
        await box.blur();
        assert((await cfg(page))[key] === +keep, `${key} took "${v}": ` + (await cfg(page))[key]);
        assert(await box.inputValue() === keep, `${key} box shows ${await box.inputValue()} after "${v}"`);
      }
    }
    for (const [sel, key, v] of [["[data-survey-min-nps]", "minNpsResponses", 50], ["[data-survey-min-nps]", "minNpsResponses", 1], ["[data-survey-campaign-month]", "npsCampaignMonth", 1]]) {
      await page.locator(sel).fill(String(v));
      await page.locator(sel).blur();
      assert((await cfg(page))[key] === v, `boundary ${v} refused`);
    }
  } finally { await browser.close(); }
});

test("survey settings: a CSM has no NPS fields", async () => {
  const { page, browser } = await launch(seedWith([seedAccount({ id: "t3" })], [], {}, "csm"));
  try {
    await ready(page); // the app is up, so an absent Settings link is the role, not a slow start
    assert(await page.locator('button[title="Settings"]').count() === 0, "CSM can reach Settings");
    assert(await page.locator("[data-survey-min-nps]").count() === 0 && await page.locator("[data-survey-campaign-month]").count() === 0, "CSM sees the fields");
  } finally { await browser.close(); }
});
