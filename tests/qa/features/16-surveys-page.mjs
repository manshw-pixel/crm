// Surveys PR 4a: the admin Surveys page (Overview, Responses, Reports), the account CSV survey
// columns, and a CSM seeing no Surveys entry. Needs surveys.sql (send_survey): every scenario that
// sends skips with "surveys.sql not applied" until it has been run.
//
// The scenarios share state (the survey sent in the first is read by the rest) and so must run in
// file order, which run.mjs guarantees. The survey goes to a run-scoped contact on the run's Harbor
// Pharma account with a .invalid email, so send_survey never posts real email (it returns the
// survey token in the response instead). The template is passed inline with a run-scoped id and
// name, so nothing is added to Settings and filters can pick this run's answer out of any others.
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCSV } from "../../../src/lib/csv.js";
import { openAccount } from "./_accounts.mjs";
import { nav } from "./_users-card.mjs";
import { SkipScenario } from "../core.mjs";
import { waitForSaved } from "../reset.mjs";

const F = "16-surveys-page";
const ACCT = runId => `QA ${runId} Harbor Pharma`;
const CONTACT = t => `QA ${t} Page Contact`;
const MAIL = t => `qa-${t}-page@qa.onevio.invalid`;
const TPL_ID = t => `qa-page-${t}`;
const TPL_NAME = t => `QA ${t} Page Survey`;
const COMMENT = t => `QA ${t} page comment`;
const tpl = t => ({
  id: TPL_ID(t), name: TPL_NAME(t), intro: "", archived: false,
  questions: [
    { id: "nps", type: "nps", text: "How likely are you to recommend {orgName} to a friend or colleague?", required: true },
    { id: "rate", type: "rating", scale: 5, text: "How would you rate our support?", required: true },
    { id: "why", type: "text", text: "Anything else?", required: false },
  ],
});
const S = { sent: null }; // shared across this file's scenarios

async function requireSurveysSql(page) {
  const r = await page.evaluate(async () => {
    try { const x = await sb.rpc("send_survey", { p_account: "qa-probe", p_contact_ids: [], p_template: {} }); return { status: x.status, error: x.error && { code: x.error.code, message: x.error.message } }; }
    catch (e) { return { thrown: String(e && e.message || e) }; }
  });
  const e = r.error || {};
  if (r.status === 404 || e.code === "PGRST202" || /does not exist|could not find the function/i.test(e.message || r.thrown || ""))
    throw new SkipScenario("surveys.sql not applied");
}

async function addContact(page, name, email) {
  if (await page.locator("[data-contact-row]").filter({ hasText: name }).count()) return;
  await page.locator("[data-more-actions]").click();
  await page.getByRole("menuitem", { name: "+ Contact" }).click();
  const form = page.locator("[data-contact-form]");
  await form.getByPlaceholder("Name *").fill(name);
  await form.getByPlaceholder("Email").fill(email);
  await form.getByLabel("Send surveys to this contact").check();
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await waitForSaved(page);
}

async function send(page, name, t) {
  const r = await page.evaluate(async ([name, tpl]) => {
    const c = window.__store.getState().contacts.find(x => x.name === name);
    if (!c) return { error: "contact not in store" };
    if (!/\.invalid$/.test(c.email || "")) return { error: "refusing to send: not a .invalid address" };
    const x = await sb.rpc("send_survey", { p_account: c.accountId, p_contact_ids: [c.id], p_template: tpl });
    return x.error ? { error: x.error.message } : x.data;
  }, [name, tpl(t)]);
  assert.ok(!r.error, `send failed: ${r.error}`);
  assert.ok(r.sent && r.sent[0] && r.sent[0].token, "an .invalid recipient gets its token back");
  return { token: r.sent[0].token, surveyId: r.sent[0].survey_id };
}

// Answers on the public page, signed out: NPS 9, rating 4, and a comment.
async function answer(context, env, token, comment) {
  const fresh = await context.browser().newContext();
  try {
    const p = await fresh.newPage();
    await p.goto(new URL(`survey.html?t=${encodeURIComponent(token)}`, env.baseUrl).href);
    const nps = p.locator('input[name="nps"][value="9"]');
    await nps.waitFor({ state: "attached", timeout: 20000 });
    await nps.check({ force: true });
    await p.locator('input[name="rate"][value="4"]').check({ force: true });
    await p.locator('textarea[name="why"]').fill(comment);
    await p.locator("form button[type=submit]").click();
    await p.locator('[data-state="thanks"]').waitFor({ timeout: 20000 });
  } finally { await fresh.close(); }
}

async function reloadUntilSurvey(page, surveyId) {
  await page.reload();
  await page.waitForFunction(id => (window.__store?.getState?.().surveys || []).some(s => s.id === id && s.submittedAt), surveyId, { timeout: 20000, polling: 250 });
}

// Opens the Surveys page on a tab (the tab choice is remembered per browser, so always click it).
async function openSurveys(page, tab) {
  await nav(page, "Surveys").click();
  await page.locator("[data-surveys-page]").waitFor({ timeout: 15000 });
  await page.locator(`[data-sv-tab="${tab}"]`).click();
  await page.locator(`[data-sv-${tab}]`).first().waitFor({ timeout: 15000 });
}
const needSent = () => { if (!S.sent) throw new SkipScenario("admin-opens-surveys did not send the survey"); };
const flat = async loc => (await loc.innerText()).replace(/\s+/g, " ").trim();

export const scenarios = [
  { id: `${F}/admin-opens-surveys`, feature: F, title: "Admin has a Surveys entry that opens the page with Overview, Responses and Reports tabs; a sent and answered survey is stored", role: "admin",
    run: async ({ page, context, env, runId, thisRunId }) => {
      await requireSurveysSql(page);
      await openAccount(page, ACCT(runId));
      await addContact(page, CONTACT(thisRunId), MAIL(thisRunId));
      const sent = S.sent || await send(page, CONTACT(thisRunId), thisRunId);
      await answer(context, env, sent.token, COMMENT(thisRunId));
      S.sent = sent; // only once the answer is in, so later scenarios do not run against an unanswered survey
      await reloadUntilSurvey(page, S.sent.surveyId);
      await nav(page, "Surveys").click();
      await page.locator("[data-surveys-page]").waitFor({ timeout: 15000 });
      assert.equal((await page.locator("h1").first().innerText()).trim(), "Surveys", "page heading");
      for (const k of ["overview", "responses", "reports"]) assert.equal(await page.locator(`[data-sv-tab="${k}"]`).count(), 1, `${k} tab`);
    } },

  { id: `${F}/overview-shows-answers`, feature: F, title: "Overview is not empty once an answer exists: KPI cards and the NPS-by-year panel render with a scored campaign", role: "admin",
    run: async ({ page }) => {
      needSent();
      await openSurveys(page, "overview");
      assert.equal(await page.locator("[data-sv-empty], [data-sv-failed]").count(), 0, "neither empty nor failed");
      for (const k of ["nps", "rate", "awaiting", "followup"]) assert.equal(await page.locator(`[data-sv-kpi="${k}"]`).count(), 1, `${k} card`);
      const years = page.locator("[data-sv-years] [data-sv-year]");
      assert.ok(await years.count() >= 1, "at least one campaign year");
      assert.match(await flat(years.first()), /n=[1-9]\d*/, "the latest campaign has scored answers");
    } },

  { id: `${F}/responses-filter-and-account-link`, feature: F, title: "Responses lists the answer, the Template filter narrows to it, and the account name opens that account", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      needSent();
      await openSurveys(page, "responses");
      await page.locator('[data-sv-filter="templateId"]').selectOption(TPL_ID(thisRunId));
      const row = page.locator(`[data-sv-resp-row="${S.sent.surveyId}"]`);
      await row.waitFor({ timeout: 15000 });
      assert.match(await flat(page.locator("[data-sv-count]")), /^1 response /, "exactly this run's answer");
      const text = await flat(row);
      assert.ok(text.includes(CONTACT(thisRunId)), "contact name");
      assert.ok(text.includes(COMMENT(thisRunId)), "comment shown");
      assert.equal((await flat(row.locator("[data-sv-source]"))), "Sent", "source shown");
      await row.getByRole("button", { name: ACCT(runId), exact: true }).click();
      await page.getByRole("heading", { level: 1, name: ACCT(runId), exact: true }).waitFor({ timeout: 15000 });
    } },

  { id: `${F}/reports-rating-n-of-scale`, feature: F, title: "Reports shows the rating as n / scale (4 / 5, n=1) for this run's template", role: "admin",
    run: async ({ page, thisRunId }) => {
      needSent();
      await openSurveys(page, "reports");
      await page.locator('[data-sv-filter="report-template"]').selectOption(TPL_ID(thisRunId));
      const card = page.locator('[data-sv-question="rate"]');
      await card.waitFor({ timeout: 15000 });
      assert.match(await flat(card.locator(".sv-avg")), /^4 \/ 5 ?n=1$/, "average / scale and n");
      assert.match(await flat(page.locator('[data-sv-question="nps"]')), /n=1/, "NPS question counts the answer");
    } },

  { id: `${F}/accounts-csv-survey-columns`, feature: F, title: "The account CSV export has the four survey columns, and this run's account row has a last-answered date", role: "admin",
    run: async ({ page, runId }) => {
      needSent();
      await nav(page, "Accounts").click();
      const search = page.getByPlaceholder(/^Search/);
      await search.waitFor({ timeout: 15000 });
      await search.fill(ACCT(runId));
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: "Export CSV" }).click()]);
      const csv = fs.readFileSync(await dl.path(), "utf8").replace(/^﻿/, "");
      const rows = parseCSV(csv);
      const head = rows[0];
      for (const c of ["Survey NPS", "Survey NPS responses", "Last survey sent", "Last survey answered"]) assert.ok(head.includes(c), `column ${c}`);
      const row = rows.find(r => r.some(c => c.includes(ACCT(runId))));
      assert.ok(row, "this run's account is in the export");
      const answered = row[head.indexOf("Last survey answered")];
      assert.match(answered || "", /\d/, "last-answered date filled in");
    } },

  { id: `${F}/csm-has-no-surveys-entry`, feature: F, title: "A CSM has no Surveys entry in the sidebar", role: "csm",
    run: async ({ page }) => {
      await nav(page, "Accounts").waitFor({ timeout: 15000 });
      assert.equal(await nav(page, "Surveys").count(), 0, "no Surveys entry");
      assert.equal(await page.locator("[data-surveys-page]").count(), 0, "no Surveys page");
    } },
];
