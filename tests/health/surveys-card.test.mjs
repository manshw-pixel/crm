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
  { id: "done1", account_id: "s1", contact_id: "k1", contact_name: "Flagged Fay", contact_role: "VP", template_id: "nps-checkin",
    template_snapshot: { id: "nps-checkin", name: "NPS check-in", questions: [{ id: "nps", type: "nps" }, { id: "reason", type: "text" }] },
    source: "sent", sent_at: "2026-01-02T00:00:00Z", expires_at: "2026-02-01T00:00:00Z", submitted_at: "2026-01-03T00:00:00Z",
    survey_answers: [{ question_id: "nps", value_num: 9 }, { question_id: "reason", value_text: "Great support" }] },
];
const rows = l => JSON.stringify(l.map(d => ({ id: d.id, data: d })));
const seed = role => `window.__seedRows = { accounts: ${rows([A])}, contacts: ${rows(CT)}, activities: [], tasks: [], opportunities: [], settings: [],
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

test("surveys card: CSM sees read-only tag and no Send button", async () => {
  const { page, browser } = await launch(seed("user"));
  try {
    await openAccount(page);
    const card = page.locator("[data-surveys-card]");
    assert(/Read only · sent by admins/.test(await card.innerText()), "tag");
    assert(await card.locator("[data-send-survey]").count() === 0, "no send button");
  } finally { await browser.close(); }
});
