// Surveys PR 1 Task 5: the account Surveys card and the Send survey dialog (send_survey mocked).
import { test, assert } from "./framework.mjs";
import { launch, seedAccount } from "./harness.mjs";

const A = seedAccount({ id: "s1", name: "Survey Co", accountNo: "2001", csm: "Priya Shah" });
const CT = [
  { id: "k1", accountId: "s1", name: "Flagged Fay", email: "fay@s.example", surveyRecipient: true },
  { id: "k2", accountId: "s1", name: "Plain Pat", email: "pat@s.example" },
  { id: "k3", accountId: "s1", name: "Optout Oz", email: "oz@s.example", surveyRecipient: true, surveyOptOut: "2026-10-01" },
  { id: "k4", accountId: "s1", name: "Mailless Max" },
  { id: "k5", accountId: "s1", name: "Pending Pia", email: "pia@s.example", surveyRecipient: true },
];
const far = new Date(Date.now() + 20 * 86400000).toISOString();
const SV = [
  { id: "old1", account_id: "s1", contact_id: "k5", contact_name: "Pending Pia", contact_role: "CIO", template_id: "nps-checkin",
    template_snapshot: { id: "nps-checkin", name: "NPS check-in", questions: [{ id: "nps", type: "nps" }, { id: "reason", type: "text" }] },
    source: "sent", sent_at: new Date().toISOString(), expires_at: far, submitted_at: null, survey_answers: [] },
  { id: "exp1", account_id: "s1", contact_id: "k2", contact_name: "Plain Pat", contact_role: "", template_id: "nps-checkin",
    template_snapshot: { id: "nps-checkin", name: "NPS check-in", questions: [{ id: "nps", type: "nps" }] },
    source: "sent", sent_at: "2026-03-01T00:00:00Z", expires_at: "2026-03-31T00:00:00Z", submitted_at: null, survey_answers: [] },
  { id: "done1", account_id: "s1", contact_id: "k1", contact_name: "Flagged Fay", contact_role: "VP", template_id: "nps-checkin",
    template_snapshot: { id: "nps-checkin", name: "NPS check-in", questions: [{ id: "nps", type: "nps" }, { id: "reason", type: "text" }] },
    source: "sent", sent_at: "2026-01-02T00:00:00Z", expires_at: "2026-02-01T00:00:00Z", submitted_at: "2026-01-03T00:00:00Z",
    survey_answers: [{ question_id: "nps", value_num: 9 }, { question_id: "reason", value_text: "Great support" }] },
];
const TPL = [
  { id: "t-onb", name: "Onboarding pulse", intro: "How is onboarding going, {firstName}?", archived: false, createdAt: "2026-11-01", updatedAt: "2026-11-01",
    questions: [{ id: "q1", type: "rating", text: "Rate your onboarding", required: true, scale: 5, lowLabel: "Poor", highLabel: "Great" }] },
  { id: "t-old", name: "Retired survey", intro: "", archived: true, createdAt: "2026-10-01", updatedAt: "2026-10-01",
    questions: [{ id: "q1", type: "text", text: "Old question", required: false }] },
];
const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const seed = (role, settingsRows = "[]") => `window.__seedRows = { accounts: ${rows([A])}, contacts: ${rows(CT)}, activities: [], tasks: [], opportunities: [], settings: ${settingsRows},
  surveys: ${JSON.stringify(SV)}, profiles: [{ id: "u1", org_id: "org-a", name: "Test User", role: "${role}" }] };`;

async function openAccount(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click('button[title="Accounts"]');
  await page.waitForSelector("[data-account-row]");
  await page.locator("[data-account-row]").first().click();
  await page.waitForSelector("[data-surveys-card]");
}

test("surveys card: admin dialog defaults, disabled reasons, send adds pending row + timeline", async () => {
  const { page, browser } = await launch(seed("admin") + `
    window.__sendSurvey = a => ({ data: { sent: a.p_contact_ids.map((id, i) => ({ contact_id: id, survey_id: "new" + i })), skipped: [{ contact_id: "zz", reason: "x" }] }, error: null });`);
  try {
    await openAccount(page);
    const card = page.locator("[data-surveys-card]");
    const txt = await card.innerText();
    assert(/NPS 100 from 1 answer/.test(txt), "nps line: " + txt);
    assert(/9\/10/.test(txt) && /“Great support”/.test(txt), "answers shown");
    assert(await card.locator('[data-survey-row="pending"]').count() === 1, "one pending row");
    const exp = card.locator('[data-survey-row="expired"]');
    assert(await exp.count() === 1 && /Sent 1 Mar · expired, no answer/.test(await exp.innerText()), "expired row");
    assert(!/awaiting answer/.test(await exp.innerText()), "expired is not awaiting");
    assert(await card.locator("[data-surveys-readonly]").count() === 0, "admin: no read-only tag");
    await card.locator("[data-send-survey]").click();
    const dlg = page.locator("[data-send-survey-dialog]");
    await dlg.waitFor();
    const box = id => dlg.locator(`[data-send-contact="${id}"] input`);
    assert(await box("k1").isChecked() && !(await box("k1").isDisabled()), "Fay ticked");
    assert(!(await box("k2").isChecked()) && !(await box("k2").isDisabled()), "Pat unticked but tickable");
    for (const id of ["k3", "k4", "k5"]) assert(await box(id).isDisabled(), id + " disabled");
    const reasons = await dlg.locator("[data-send-reason]").allInnerTexts();
    assert(reasons.includes("Opted out") && reasons.includes("No email") && reasons.some(r => /^Survey pending/.test(r)), "reasons: " + reasons);
    const prev = await dlg.locator("[data-send-preview]").innerText();
    assert(/Acme Corp would like your feedback/.test(prev) && /Hi Flagged/.test(prev), "preview: " + prev);
    await box("k2").check();
    assert(/Send to 2 contacts/.test(await dlg.locator("[data-send-confirm]").innerText()), "count");
    await dlg.locator("[data-send-confirm]").click();
    await page.waitForSelector("[data-send-survey-dialog]", { state: "detached" });
    const body = await page.locator("body").innerText();
    assert(/Survey sent to 2 contacts · 1 skipped/.test(body), "toast");
    assert(await card.locator('[data-survey-row="pending"]').count() === 3, "pending rows added");
    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.fn === "send_survey").args);
    assert(call.p_account === "s1" && call.p_contact_ids.join() === "k1,k2" && call.p_template.id === "nps-checkin", JSON.stringify(call));
    const acts = await page.evaluate(() => window.__store.getState().activities.filter(x => x.type === "survey").map(x => x.id + "|" + x.summary));
    assert(acts.includes("sv-sent-new0|Survey sent (NPS check-in) to Flagged Fay"), "activity: " + acts);
    assert(/Survey sent \(NPS check-in\) to Plain Pat/.test(body), "timeline shows entry");
  } finally { await browser.close(); }
});

test("surveys card: send error shows inline and dialog stays open", async () => {
  const { page, browser } = await launch(seed("admin") + `
    window.__sendSurvey = () => ({ data: null, error: { message: "Daily survey limit reached (50). Try again tomorrow." } });`);
  try {
    await openAccount(page);
    await page.locator("[data-send-survey]").click();
    await page.locator("[data-send-confirm]").click();
    await page.waitForSelector("[data-send-error]");
    assert(/Daily survey limit reached \(50\)/.test(await page.locator("[data-send-error]").innerText()), "error text");
    assert(await page.locator("[data-send-survey-dialog]").count() === 1, "dialog still open");
  } finally { await browser.close(); }
});

test("surveys card: missing send_survey function shows a setup message", async () => {
  const { page, browser } = await launch(seed("admin") + `
    window.__sendSurvey = () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.send_survey(p_account, p_contact_ids, p_template) in the schema cache" } });`);
  try {
    await openAccount(page);
    await page.locator("[data-send-survey]").click();
    await page.locator("[data-send-confirm]").click();
    await page.waitForSelector("[data-send-error]");
    const t = await page.locator("[data-send-error]").innerText();
    assert(t === "Surveys aren't set up yet — an admin needs to run surveys.sql.", "error text: " + t);
  } finally { await browser.close(); }
});

test("surveys card: CSM sees read-only tag and no Send button", async () => {
  const { page, browser } = await launch(seed("user"));
  try {
    await openAccount(page);
    const card = page.locator("[data-surveys-card]");
    assert(/Read only · sent by admins/.test(await card.innerText()), "tag");
    assert(await card.locator("[data-send-survey]").count() === 0, "no send button");
  } finally { await browser.close(); }
});

test("surveys card: double-clicking Send calls send_survey once", async () => {
  const { page, browser } = await launch(seed("admin") + `
    window.__sendSurvey = a => new Promise(r => setTimeout(() => r({ data: { sent: a.p_contact_ids.map((id, i) => ({ contact_id: id, survey_id: "dc" + i })), skipped: [] }, error: null }), 300));`);
  try {
    await openAccount(page);
    await page.locator("[data-send-survey]").click();
    await page.locator("[data-send-confirm]").dblclick();
    await page.waitForSelector("[data-send-survey-dialog]", { state: "detached" });
    const n = await page.evaluate(() => window.__rpcCalls.filter(c => c.fn === "send_survey").length);
    assert(n === 1, "send_survey calls: " + n);
  } finally { await browser.close(); }
});

test("surveys card: on a 1280x720 screen the Send button is reachable and works", async () => {
  // Live regression: the dialog grew past the viewport and did not scroll, so Send could never be clicked.
  const { page, browser } = await launch(seed("admin") + `
    window.__sendSurvey = () => ({ data: null, error: { message: "Daily survey limit reached (50). Try again tomorrow." } });`);
  try {
    await openAccount(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator("[data-send-survey]").click();
    const box = await page.locator("[data-send-survey-dialog]").boundingBox();
    assert(box.y + box.height <= 720, `dialog fits the viewport (bottom ${box.y + box.height})`);
    await page.locator("[data-send-confirm]").click({ timeout: 5000 });
    await page.waitForSelector("[data-send-error]", { timeout: 5000 });
  } finally { await browser.close(); }
});

const tplSettings = (extra = {}) => JSON.stringify([{ id: "1", data: { surveyTemplates: TPL, ...extra } }]);

test("surveys card: template picker changes candidates and preview", async () => {
  const { page, browser } = await launch(seed("admin", tplSettings()) + `
    window.__sendSurvey = a => ({ data: { sent: a.p_contact_ids.map((id, i) => ({ contact_id: id, survey_id: "tp" + i })), skipped: [] }, error: null });`);
  try {
    await openAccount(page);
    await page.locator("[data-send-survey]").click();
    const dlg = page.locator("[data-send-survey-dialog]");
    await dlg.waitFor();
    const sel = dlg.locator("#sv-template");
    assert((await sel.inputValue()) === "nps-checkin", "defaults to NPS check-in");
    assert(/How likely are you to recommend/.test(await dlg.locator("[data-send-preview]").innerText()), "nps preview");
    await sel.selectOption("t-onb");
    const prev = await dlg.locator("[data-send-preview]").innerText();
    assert(/Rate your onboarding/.test(prev) && /How is onboarding going, Flagged\?/.test(prev), "template preview: " + prev);
    assert(!/How likely are you to recommend/.test(prev), "nps question gone");
    await dlg.locator("[data-send-confirm]").click();
    await page.waitForSelector("[data-send-survey-dialog]", { state: "detached" });
    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.fn === "send_survey").args);
    assert(call.p_template.id === "t-onb" && call.p_template.name === "Onboarding pulse", JSON.stringify(call.p_template));
  } finally { await browser.close(); }
});

test("surveys card: archived template not offered", async () => {
  const { page, browser } = await launch(seed("admin", tplSettings()));
  try {
    await openAccount(page);
    await page.locator("[data-send-survey]").click();
    const opts = await page.locator("#sv-template option").allInnerTexts();
    assert(opts.includes("NPS check-in") && opts.includes("Onboarding pulse"), "active offered: " + opts);
    assert(!opts.includes("Retired survey"), "archived hidden: " + opts);
  } finally { await browser.close(); }
});

test("surveys card: throttle reason shown", async () => {
  // Throttle only applies to non-NPS templates: Fay got a non-NPS survey 10 days ago (default window 90 days).
  const recent = new Date(Date.now() - 10 * 86400000).toISOString();
  const sv = [{ id: "r1", account_id: "s1", contact_id: "k1", contact_name: "Flagged Fay", contact_role: "VP", template_id: "t-onb",
    template_snapshot: TPL[0], source: "sent", sent_at: recent, expires_at: recent, submitted_at: recent, survey_answers: [{ question_id: "q1", value_num: 4 }] }];
  const { page, browser } = await launch(seed("admin", tplSettings()).replace(/surveys: \[[\s\S]*?\], profiles/, () => "surveys: " + JSON.stringify(sv) + ", profiles"));
  try {
    await openAccount(page);
    await page.locator("[data-send-survey]").click();
    const dlg = page.locator("[data-send-survey-dialog]");
    await dlg.waitFor();
    const fay = dlg.locator('[data-send-contact="k1"]');
    assert(!/Surveyed/.test(await fay.innerText()), "NPS template is not throttled");
    await dlg.locator("#sv-template").selectOption("t-onb");
    const t = await fay.innerText();
    assert(/Surveyed \d{1,2} \w{3} — wait until \d{1,2} \w{3}/.test(t), "throttle reason: " + t);
    assert(!(await fay.locator("input").isChecked()), "Fay not ticked by default");
  } finally { await browser.close(); }
});
