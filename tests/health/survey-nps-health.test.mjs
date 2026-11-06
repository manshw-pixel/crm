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
