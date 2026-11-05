// Surveys PR 2: survey templates. Settings -> Surveys (starters, edit, copy, validation, archive),
// then sending a non-NPS template, answering it on the public page, and the per-contact throttle.
// Needs the PR 2 surveys.sql (survey_template_valid + the throttle in send_survey): every scenario
// skips with "surveys.sql PR 2 not applied" until it has been re-run.
//
// The scenarios share state and so must run in file order, which run.mjs guarantees. Contacts
// live on the run's Cedar Foods account with run-scoped names and .invalid emails, so send_survey
// never posts real email (it returns the survey token in the response instead).
//
// Cleanup: templates live in settings.surveyTemplates and would pile up across runs, so the first
// scenario sweeps any template a previous run left (the starters this file adds, "Copy of ..."
// copies and the "QA ... NPS twice" probe) and the last scenario (archive) sweeps this run's.
// The sweep goes through the app's own store/write queue (SET_SURVEY_TEMPLATES), the same path the
// Settings card uses; it only runs against the QA org, never the stored NPS check-in.
import assert from "node:assert/strict";
import { openAccount } from "./_accounts.mjs";
import { nav } from "./_users-card.mjs";
import { SkipScenario } from "../core.mjs";
import { waitForSaved } from "../reset.mjs";

const F = "14-survey-templates";
const ACCT = runId => `QA ${runId} Cedar Foods`;
const CONTACT = t => `QA ${t} Template Contact`;
const MAIL = t => `qa-${t}-tpl@qa.onevio.invalid`;
const TWO_NPS = t => `QA ${t} NPS twice`;
const STARTER_IDS = ["support-quality", "onboarding-review"];
const S = { copyId: null, token: null }; // shared across this file's scenarios

// Skips unless PR 2's SQL is applied. send_survey with an empty-questions template and no contacts
// always raises before it writes anything: 'not allowed' (non-admin), 'template required' (PR 1 SQL
// rejects a template without id/questions array only), or 'invalid template' (PR 2:
// survey_template_valid rejects a template with no questions). Only the last means PR 2 is live.
async function requirePr2Sql(page) {
  const r = await page.evaluate(async () => {
    try {
      const x = await sb.rpc("send_survey", { p_account: "qa-probe", p_contact_ids: [], p_template: { id: "qa-probe", name: "x", questions: [] } });
      return { error: x.error && { code: x.error.code, message: x.error.message } };
    } catch (e) { return { thrown: String(e && e.message || e) }; }
  });
  const msg = (r.error && r.error.message) || r.thrown || "";
  if (!/invalid template/i.test(msg)) throw new SkipScenario("surveys.sql PR 2 not applied");
}

// Removes the templates this file creates (see the header). `extra` are names to drop as well.
async function sweepTemplates(page, extraNames = []) {
  const changed = await page.evaluate(([ids, extra]) => {
    const st = window.__store.getState();
    const list = st.settings.surveyTemplates || [];
    const drop = t => ids.includes(t.id) || /^Copy of (Support quality|Onboarding review)$/.test(t.name || "") || extra.includes(t.name) || /^QA .* NPS twice$/.test(t.name || "");
    const next = list.filter(t => !drop(t));
    if (next.length === list.length) return false;
    window.__store.dispatch({ type: "SET_SURVEY_TEMPLATES", templates: next });
    return true;
  }, [STARTER_IDS, extraNames]);
  if (changed) await waitForSaved(page);
}

async function openSurveySettings(page) {
  await nav(page, "Settings").click();
  await page.locator("[data-surveys-settings]").waitFor({ timeout: 20000 });
}

async function reloadToSettings(page) {
  await page.reload();
  await openSurveySettings(page);
}

const row = (page, id) => page.locator(`[data-template-row="${id}"]`);
const rowByName = (page, name) => page.locator("[data-template-row]").filter({ has: page.getByText(name, { exact: true }) });

async function setSupportScale(page, scale) {
  await row(page, "support-quality").locator("[data-template-edit]").click();
  const ed = page.locator("[data-template-editor]");
  await ed.waitFor({ timeout: 15000 });
  await ed.locator('[data-q-row="q1"] [data-q-scale]').selectOption(String(scale));
  await ed.locator("[data-template-save]").click();
  await ed.waitFor({ state: "detached", timeout: 15000 });
  await waitForSaved(page);
}

const storedTemplate = (page, id) => page.evaluate(id => (window.__store.getState().settings.surveyTemplates || []).find(t => t.id === id) || null, id);

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

// Opens the account's Send dialog and picks a template by its visible name.
async function openSend(page, co, templateName) {
  await openAccount(page, co);
  await page.locator("[data-send-survey]").click();
  const dlg = page.locator("[data-send-survey-dialog]");
  await dlg.waitFor({ timeout: 15000 });
  await dlg.locator("#sv-template").selectOption({ label: templateName });
  return dlg;
}

export const scenarios = [
  { id: `${F}/add-starters`, feature: F, title: "Add starter templates: Support quality (and Onboarding review) appear in the list and survive a reload", role: "admin",
    run: async ({ page }) => {
      await requirePr2Sql(page);
      await sweepTemplates(page); // leftovers from an earlier run
      await openSurveySettings(page);
      assert.equal(await row(page, "support-quality").count(), 0, "starter not present before adding");
      await page.locator("[data-starter-open]").click();
      const dlg = page.locator("[data-starter-dialog]");
      await dlg.waitFor({ timeout: 15000 });
      await dlg.locator('[data-starter="support-quality"] input[type="checkbox"]').check();
      // Onboarding review is added too: the throttle scenario needs a second non-NPS template.
      await dlg.locator('[data-starter="onboarding-review"] input[type="checkbox"]').check();
      await dlg.locator("[data-starter-add]").click();
      await dlg.waitFor({ state: "detached", timeout: 15000 });
      await waitForSaved(page);
      await reloadToSettings(page);
      await row(page, "support-quality").waitFor({ timeout: 15000 });
      assert.match(await row(page, "support-quality").textContent(), /Support quality/);
      assert.equal(await row(page, "onboarding-review").count(), 1, "Onboarding review listed");
    } },

  { id: `${F}/edit-and-copy`, feature: F, title: "Editing Support quality to a 1-5 scale and copying it gives 'Copy of Support quality'", role: "admin",
    run: async ({ page }) => {
      await requirePr2Sql(page);
      await openSurveySettings(page);
      await row(page, "support-quality").waitFor({ timeout: 15000 });
      await setSupportScale(page, 5);
      await row(page, "support-quality").locator("[data-template-copy]").click();
      await waitForSaved(page);
      await reloadToSettings(page);
      const copy = rowByName(page, "Copy of Support quality");
      await copy.waitFor({ timeout: 15000 });
      assert.equal(await row(page, "support-quality").count(), 1, "the original is still listed");
      S.copyId = await copy.getAttribute("data-template-row");
      assert.notEqual(S.copyId, "support-quality", "the copy has its own id");
      const orig = await storedTemplate(page, "support-quality");
      const cp = await storedTemplate(page, S.copyId);
      assert.equal(orig.questions[0].scale, 5, "original saved at 1-5");
      assert.equal(cp.questions[0].scale, 5, "copy carries the 1-5 scale");
      // The next scenarios answer 6/7, so put the original back on its 1-7 scale (the copy stays 1-5).
      await setSupportScale(page, 7);
      await reloadToSettings(page);
      assert.equal((await storedTemplate(page, "support-quality")).questions[0].scale, 7, "original restored to 1-7");
    } },

  { id: `${F}/two-nps-refused`, feature: F, title: "A new template with two NPS questions is refused with 'Only one NPS question per template'", role: "admin",
    run: async ({ page, thisRunId }) => {
      await requirePr2Sql(page);
      await openSurveySettings(page);
      const before = await page.evaluate(() => (window.__store.getState().settings.surveyTemplates || []).length);
      await page.locator("[data-template-new]").click();
      const ed = page.locator("[data-template-editor]");
      await ed.waitFor({ timeout: 15000 });
      await ed.locator("[data-template-name]").fill(TWO_NPS(thisRunId));
      await ed.locator('[data-q-row] [data-q-text]').first().fill("QA first question");
      await ed.locator("[data-add-question]").click();
      await ed.locator('[data-add-type="nps"]').click();
      await ed.locator("[data-q-row] [data-q-text]").nth(1).fill("QA second question");
      // The Add menu greys out NPS once there is one, so make the second one by retyping question 1.
      await ed.locator("[data-q-row]").first().locator("[data-q-type]").selectOption("nps");
      await ed.locator("[data-template-save]").click();
      const err = ed.locator("[data-template-error]");
      await err.waitFor({ timeout: 10000 });
      assert.match(await err.textContent(), /Only one NPS question per template/);
      assert.equal(await ed.count(), 1, "editor stays open");
      await ed.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Discard", exact: true }).click();
      await ed.waitFor({ state: "detached", timeout: 10000 });
      const after = await page.evaluate(() => (window.__store.getState().settings.surveyTemplates || []).length);
      assert.equal(after, before, "nothing was saved");
    } },

  { id: `${F}/send-support-quality`, feature: F, title: "Sending Support quality to a run contact and answering 6/7 on the public page shows 6/7 on the account", role: "admin",
    run: async ({ page, context, env, runId, thisRunId }) => {
      await requirePr2Sql(page);
      const co = ACCT(runId), name = CONTACT(thisRunId);
      await openAccount(page, co);
      await addContact(page, name, MAIL(thisRunId));
      const dlg = await openSend(page, co, "Support quality");
      // Other flagged contacts on this account (from 13-surveys) are also eligible for a non-NPS
      // template, so tick only this run's contact before sending.
      for (const lbl of await dlg.locator("[data-send-contact]").all()) {
        const box = lbl.locator('input[type="checkbox"]');
        if (await box.isDisabled()) continue;
        const mine = (await lbl.textContent()).includes(name);
        if (mine !== (await box.isChecked())) await (mine ? box.check() : box.uncheck());
      }
      const confirm = dlg.locator("[data-send-confirm]");
      assert.equal((await confirm.textContent()).trim(), "Send to 1 contact", "only the run's contact is ticked");
      // Promise.all so a failed click is one recorded failure, not an unhandled rejection that crashes the run.
      const [resp] = await Promise.all([
        page.waitForResponse(r => /\/rpc\/send_survey/.test(r.url()) && r.request().method() === "POST", { timeout: 30000 }),
        confirm.click(),
      ]);
      const body = await resp.json();
      assert.equal(body.sent.length, 1, "one survey sent");
      assert.ok(body.sent[0].token, "an .invalid recipient gets its token back in the response");
      S.token = body.sent[0].token;
      await dlg.waitFor({ state: "detached", timeout: 15000 });

      const fresh = await context.browser().newContext(); // signed out
      try {
        const p = await fresh.newPage();
        await p.goto(new URL(`survey.html?t=${encodeURIComponent(S.token)}`, env.baseUrl).href);
        await p.locator('input[name="q1"][value="6"]').waitFor({ state: "attached", timeout: 20000 });
        assert.equal(await p.locator('input[name="q1"]').count(), 7, "a 1-7 scale is offered");
        await p.locator('input[name="q1"][value="6"]').check({ force: true });
        await p.getByRole("button", { name: "Submit", exact: true }).click();
        await p.locator('[data-state="thanks"]').waitFor({ timeout: 20000 });
      } finally { await fresh.close(); }

      await openAccount(page, co);
      await page.reload();
      await openAccount(page, co);
      const done = page.locator('[data-survey-row="submitted"]').filter({ hasText: name }).filter({ hasText: "Support quality" });
      await done.waitFor({ timeout: 20000 });
      assert.match(await done.textContent(), /6\/7/, "the answer reads 6/7");
    } },

  { id: `${F}/throttle`, feature: F, title: "After a Support quality survey, Onboarding review greys the contact out with 'Surveyed ... wait until ...'; NPS check-in still ticks them", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      await requirePr2Sql(page);
      const co = ACCT(runId), name = CONTACT(thisRunId);
      const dlg = await openSend(page, co, "Onboarding review");
      const label = dlg.locator("[data-send-contact]").filter({ hasText: name });
      await label.waitFor({ timeout: 15000 });
      assert.match(await label.locator("[data-send-reason]").textContent(), /^Surveyed \d{1,2} \w{3} — wait until \d{1,2} \w{3}$/, "throttle reason shown");
      assert.equal(await label.locator('input[type="checkbox"]').isDisabled(), true, "contact is disabled for Onboarding review");
      await dlg.locator("#sv-template").selectOption({ label: "NPS check-in" });
      const nps = dlg.locator("[data-send-contact]").filter({ hasText: name });
      assert.equal(await nps.locator("[data-send-reason]").count(), 0, "no throttle reason for NPS");
      assert.equal(await nps.locator('input[type="checkbox"]').isDisabled(), false, "contact is tickable for NPS");
      await dlg.getByRole("button", { name: "Cancel", exact: true }).click(); // nothing is sent
      await dlg.waitFor({ state: "detached", timeout: 10000 });
    } },

  { id: `${F}/archive`, feature: F, title: "Archiving the copy removes it from the Send dialog's template list (then this run's templates are removed)", role: "admin",
    run: async ({ page, runId }) => {
      await requirePr2Sql(page);
      assert.ok(S.copyId, "copy id from edit-and-copy");
      const co = ACCT(runId);
      try {
        await openSurveySettings(page);
        const copy = row(page, S.copyId);
        await copy.waitFor({ timeout: 15000 });
        await copy.locator("[data-template-archive]").click();
        await waitForSaved(page);
        await reloadToSettings(page);
        await row(page, S.copyId).locator("[data-template-archived]").waitFor({ timeout: 15000 });
        const dlg = await openSend(page, co, "Support quality");
        const names = await dlg.locator("#sv-template option").allTextContents();
        assert.ok(names.includes("Support quality"), "the original is still offered");
        assert.ok(!names.includes("Copy of Support quality"), `archived copy still offered: ${names.join(", ")}`);
        await dlg.getByRole("button", { name: "Cancel", exact: true }).click();
      } finally {
        // Remove this run's templates so they don't pile up in the QA org's settings.
        await sweepTemplates(page);
      }
    } },
];
