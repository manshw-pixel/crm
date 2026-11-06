// Surveys PR 3: a low NPS answer makes one Survey task for the CSM with a bell alert, an edit keeps
// it to one task, the outcome is stored, a high answer makes none, and three answers move the
// account onto survey NPS. Needs the PR 3 surveys.sql: every scenario skips with
// "surveys.sql PR 3 not applied" until it has been re-run.
//
// The scenarios share state and so must run in file order, which run.mjs guarantees. Answers go on
// the run's Granite Infra account, which no other feature surveys, so the n=3 below is exact.
// Contacts are run-scoped with .invalid emails, so send_survey never posts real email (it returns
// the survey token in the response instead). Everything lives on the run's account, which the next
// reset removes.
import assert from "node:assert/strict";
import { openAccount } from "./_accounts.mjs";
import { openTasks } from "./_tasks.mjs";
import { SkipScenario } from "../core.mjs";
import { waitForSaved } from "../reset.mjs";

const F = "15-survey-followups";
const ACCT = runId => `QA ${runId} Granite Infra`; // CSM-owned fixture row
const NAME = (t, k) => `QA ${t} Followup ${k}`;
const MAIL = (t, k) => `qa-${t}-fu-${k}@qa.onevio.invalid`;
const NPS_TPL = {
  id: "nps-checkin", name: "NPS check-in", intro: "", archived: false,
  questions: [
    { id: "nps", type: "nps", text: "How likely are you to recommend {orgName} to a friend or colleague?", required: true },
    { id: "reason", type: "text", text: "What's the main reason for your score?", required: false },
  ],
};
const S = { low: null, high: null, third: null, typedNps: undefined }; // shared across this file's scenarios

// Skips unless PR 3's SQL is applied. A followUp with an unknown op is refused only by PR 3's
// survey_template_valid ('invalid template'); PR 2 ignores followUp and goes on to 'account not
// found'. Either way send_survey raises before it writes anything. Admin only: send_survey says
// 'not allowed' to anyone else, so CSM scenarios rely on needLow() instead.
async function requirePr3Sql(page) {
  const bad = { ...NPS_TPL, id: "qa-probe", questions: [{ ...NPS_TPL.questions[0], followUp: { op: "qa-probe" } }] };
  const r = await page.evaluate(async tpl => {
    try {
      const x = await sb.rpc("send_survey", { p_account: "qa-probe", p_contact_ids: [], p_template: tpl });
      return { error: x.error && { message: x.error.message } };
    } catch (e) { return { thrown: String(e && e.message || e) }; }
  }, bad);
  if (r.thrown) assert.fail("survey probe failed: " + r.thrown);
  if (!/invalid template/i.test((r.error && r.error.message) || "")) throw new SkipScenario("surveys.sql PR 3 not applied");
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

// Sends the NPS check-in to one named contact through the page's own client.
async function send(page, name) {
  const r = await page.evaluate(async ([name, tpl]) => {
    const c = window.__store.getState().contacts.find(x => x.name === name);
    if (!c) return { error: "contact not in store" };
    if (!/\.invalid$/.test(c.email || "")) return { error: "refusing to send: not a .invalid address" };
    const x = await sb.rpc("send_survey", { p_account: c.accountId, p_contact_ids: [c.id], p_template: tpl });
    return x.error ? { error: x.error.message } : x.data;
  }, [name, NPS_TPL]);
  assert.ok(!r.error, `send failed: ${r.error}`);
  assert.ok(r.sent && r.sent[0] && r.sent[0].token, "an .invalid recipient gets its token back");
  return { token: r.sent[0].token, surveyId: r.sent[0].survey_id };
}

// Answers on the public page, signed out. A second visit opens the form again, which is the edit.
async function answer(context, env, token, value, reason) {
  const fresh = await context.browser().newContext();
  try {
    const p = await fresh.newPage();
    await p.goto(new URL(`survey.html?t=${encodeURIComponent(token)}`, env.baseUrl).href);
    const box = p.locator(`input[name="nps"][value="${value}"]`);
    await box.waitFor({ state: "attached", timeout: 20000 });
    await box.check({ force: true });
    if (reason) await p.locator('textarea[name="reason"]').fill(reason);
    await p.locator("form button[type=submit]").click(); // reads "Update answers" on a revisit
    await p.locator('[data-state="thanks"]').waitFor({ timeout: 20000 });
  } finally { await fresh.close(); }
}

// Reloads, so what is read is what the database holds, and waits for the survey to be in the store.
async function reloadUntilSurvey(page, surveyId) {
  await page.reload();
  await page.waitForFunction(id => (window.__store?.getState?.().surveys || []).some(s => s.id === id && s.submittedAt), surveyId, { timeout: 20000, polling: 250 });
}
const surveyTasks = (page, surveyId) => page.evaluate(id => window.__store.getState().tasks.filter(t => t.surveyId === id), surveyId);
const taskCount = page => page.evaluate(() => window.__store.getState().tasks.length);
const waitForTask = (page, surveyId) => page.waitForFunction(id => (window.__store?.getState?.().tasks || []).some(t => t.surveyId === id), surveyId, { timeout: 20000, polling: 250 });
// An earlier scenario skipped (no PR 3 SQL, say), so there is nothing here to check.
const needLow = () => { if (!S.low) throw new SkipScenario("low-answer-makes-task did not run"); };

export const scenarios = [
  { id: `${F}/low-answer-makes-task`, feature: F, title: "An NPS answer of 6 creates one High priority Survey task owned by the account's CSM, with the reason in its details", role: "admin",
    run: async ({ page, context, env, runId, thisRunId, csmName }) => {
      await requirePr3Sql(page);
      const co = ACCT(runId);
      await openAccount(page, co);
      const pre = await page.evaluate(n => { const st = window.__store.getState(), a = st.accounts.find(x => x.name === n);
        return { id: a.id, typed: a.inputs && a.inputs.nps, surveys: st.surveys.filter(s => s.accountId === a.id).length, min: st.settings.surveys.minNpsResponses }; }, co);
      if (pre.min !== 3) throw new SkipScenario(`this org needs ${pre.min} answers; the scenarios assume 3`);
      if (!S.low) {
        if (pre.surveys) throw new SkipScenario("the account already has surveys; run without --skip-reset");
        S.typedNps = pre.typed;
        for (const k of ["low", "high", "third"]) await addContact(page, NAME(thisRunId, k), MAIL(thisRunId, k));
        S.low = await send(page, NAME(thisRunId, "low"));
      }
      await answer(context, env, S.low.token, 6, "QA: support was slow");
      await reloadUntilSurvey(page, S.low.surveyId);
      const tasks = await surveyTasks(page, S.low.surveyId);
      assert.equal(tasks.length, 1, "exactly one task");
      const t = tasks[0];
      assert.equal(t.source, "survey", "tagged as a survey task");
      assert.equal(t.owner, csmName, "owned by the account's CSM");
      assert.equal(t.priority, "High", "High priority");
      assert.equal(t.status, "Open", "starts open");
      assert.equal(t.accountId, pre.id, "on the right account");
      assert.match(t.title, /: 6\/10$/, "title carries the answer");
      assert.match(t.details, /QA: support was slow/, "details carry the reason");
    } },

  { id: `${F}/csm-sees-task-and-bell`, feature: F, title: "The CSM sees the task under Mine with the Survey tag, and a bell alert for it", role: "csm",
    run: async ({ page, thisRunId }) => {
      needLow();
      await waitForTask(page, S.low.surveyId);
      await openTasks(page, { scope: "Mine", q: NAME(thisRunId, "low") });
      const row = page.locator("[data-task-row]").filter({ hasText: NAME(thisRunId, "low") });
      assert.equal(await row.count(), 1, "one row under Mine");
      assert.equal((await row.locator('[data-task-source="survey"]').textContent()).trim(), "Survey", "Survey tag");
      await page.locator("[data-bell]").click();
      const alert = page.locator(`[data-notif-item="survey-${S.low.surveyId}"]`);
      await alert.waitFor({ timeout: 10000 });
      assert.match(await alert.textContent(), /Survey follow-up needed/);
    } },

  { id: `${F}/edit-keeps-one-task`, feature: F, title: "Editing the answer from 6 to 5 within 7 days keeps one task and updates its title", role: "admin",
    run: async ({ page, context, env }) => {
      await requirePr3Sql(page);
      needLow();
      await waitForTask(page, S.low.surveyId);
      const before = await surveyTasks(page, S.low.surveyId);
      assert.equal(before.length, 1, "one task before the edit");
      await answer(context, env, S.low.token, 5);
      await reloadUntilSurvey(page, S.low.surveyId);
      await waitForTask(page, S.low.surveyId);
      const after = await surveyTasks(page, S.low.surveyId);
      assert.equal(after.length, 1, "still one task");
      assert.equal(after[0].id, before[0].id, "the same task");
      assert.match(after[0].title, /: 5\/10$/, "title follows the edit");
      assert.equal(after[0].status, "Open", "status untouched");
    } },

  { id: `${F}/complete-with-outcome`, feature: F, title: "Completing the task through the outcome dialog stores the result and note after a reload, and clears the bell", role: "csm",
    run: async ({ page, thisRunId, csmName }) => {
      needLow();
      await waitForTask(page, S.low.surveyId);
      await openTasks(page, { scope: "Mine", q: NAME(thisRunId, "low") });
      const row = page.locator("[data-task-row]").filter({ hasText: NAME(thisRunId, "low") });
      await row.locator(".tk-check").click();
      const dlg = page.locator("[data-survey-outcome-dialog]");
      await dlg.waitFor({ timeout: 10000 });
      await dlg.locator("[data-outcome-option]").filter({ hasText: "Called" }).locator("input").check();
      await dlg.locator("[data-outcome-note]").fill("QA: spoke to them");
      await dlg.locator("[data-outcome-save]").click();
      await dlg.waitFor({ state: "detached", timeout: 10000 });
      await waitForSaved(page);
      await page.reload();
      await waitForTask(page, S.low.surveyId);
      const [t] = await surveyTasks(page, S.low.surveyId);
      assert.equal(t.status, "Done", "task done after reload");
      assert.equal(t.surveyOutcome && t.surveyOutcome.result, "Called", "outcome stored");
      assert.equal(t.surveyOutcome.note, "QA: spoke to them", "note stored");
      assert.equal(t.surveyOutcome.by, csmName, "who completed it");
      await page.locator("[data-bell]").click();
      await page.locator("[data-notif-panel]").waitFor({ timeout: 10000 });
      assert.equal(await page.locator(`[data-notif-item="survey-${S.low.surveyId}"]`).count(), 0, "a finished follow-up leaves the bell");
    } },

  { id: `${F}/high-answer-no-task`, feature: F, title: "An NPS answer of 9 creates no task", role: "admin",
    run: async ({ page, context, env, runId, thisRunId }) => {
      await requirePr3Sql(page);
      needLow();
      await openAccount(page, ACCT(runId));
      if (!S.high) S.high = await send(page, NAME(thisRunId, "high"));
      await answer(context, env, S.high.token, 9);
      await reloadUntilSurvey(page, S.high.surveyId);
      await waitForTask(page, S.low.surveyId); // tasks have loaded, so an empty list below means none
      assert.ok(await taskCount(page) > 0, "tasks loaded");
      assert.deepEqual(await surveyTasks(page, S.high.surveyId), [], "no task for a 9");
    } },

  { id: `${F}/three-answers-use-survey-nps`, feature: F, title: "A third answer puts the account on survey NPS: 'NPS from surveys (n=3)', score +33, typed value unchanged", role: "admin",
    run: async ({ page, context, env, runId, thisRunId }) => {
      await requirePr3Sql(page);
      if (!S.high) throw new SkipScenario("high-answer-no-task did not run");
      const co = ACCT(runId);
      await openAccount(page, co);
      const line = page.locator("[data-nps-source]");
      await line.waitFor({ timeout: 15000 });
      if (!S.third) { // a retry has already sent and answered the third
        assert.equal((await line.locator(".ad-pill").textContent()).trim(), "Survey NPS 0 (n=2, needs 3)", "two answers (5 and 9) are too few");
        S.third = await send(page, NAME(thisRunId, "third"));
      }
      await answer(context, env, S.third.token, 10);
      await reloadUntilSurvey(page, S.third.surveyId);
      await openAccount(page, co);
      await line.waitFor({ timeout: 15000 });
      assert.equal((await line.locator(".ad-pill").textContent()).trim(), "NPS from surveys (n=3)", "enough answers");
      assert.match(await line.locator("[data-nps-source-note]").textContent(), /^Score \+33 · /, "5, 9 and 10 give +33");
      const typed = await page.evaluate(n => { const a = window.__store.getState().accounts.find(x => x.name === n); return a.inputs && a.inputs.nps; }, co);
      assert.equal(typed, S.typedNps, "the typed NPS is never written");
    } },
];
