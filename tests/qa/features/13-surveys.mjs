// Surveys PR 1: flag contacts, send an NPS check-in, answer it on the public page, see it on the
// account, CSM read-only, unsubscribe. Needs surveys.sql applied: every scenario skips with
// "surveys.sql not applied" when the send_survey RPC is missing.
//
// The scenarios share state (the contacts created in the first, the tokens captured in the
// second) and so must run in file order, which run.mjs guarantees. All contacts live on the run's
// Cedar Foods account and use .invalid emails, so send_survey never posts real email (it returns
// the survey token in the response instead).
//
// Token source: the first token is read off the UI's own send_survey response (page.waitForResponse),
// so the real Send dialog is what produces it; the second contact's survey is sent through the
// signed-in page's own supabase client (sb.rpc), because that one is setup, not the thing under test.
import assert from "node:assert/strict";
import { openAccount } from "./_accounts.mjs";
import { SkipScenario } from "../core.mjs";
import { waitForSaved } from "../reset.mjs";

const F = "13-surveys";
const ACCT = runId => `QA ${runId} Cedar Foods`;
const NAMES = t => [1, 2, 3, 4].map(n => `QA ${t} Survey Contact ${n}`);
const MAIL = (t, n) => `qa-${t}-${n}@qa.onevio.invalid`;
const NPS_TPL = {
  id: "nps-checkin", name: "NPS check-in", intro: "Thanks for working with us — this takes under a minute.",
  questions: [
    { id: "nps", type: "nps", text: "How likely are you to recommend {orgName} to a friend or colleague?", required: true },
    { id: "reason", type: "text", text: "What's the main reason for your score?", required: false },
  ],
};
const S = { tokens: {} }; // shared across this file's scenarios

// Skips when the send_survey function does not exist. A call with an empty template always errors
// ("template" validation) when it exists, and never writes.
async function requireSurveysSql(page) {
  const r = await page.evaluate(async () => {
    try { const x = await sb.rpc("send_survey", { p_account: "qa-probe", p_contact_ids: [], p_template: {} }); return { status: x.status, error: x.error && { code: x.error.code, message: x.error.message } }; }
    catch (e) { return { thrown: String(e && e.message || e) }; }
  });
  const e = r.error || {};
  if (r.status === 404 || e.code === "PGRST202" || /does not exist|could not find the function/i.test(e.message || r.thrown || ""))
    throw new SkipScenario("surveys.sql not applied");
}

const contactRow = (page, name) => page.locator("[data-contact-row]").filter({ hasText: name }).first();

async function addContact(page, name, email, flagged) {
  if (await page.locator("[data-contact-row]").filter({ hasText: name }).count()) return;
  await page.locator("[data-more-actions]").click();
  await page.getByRole("menuitem", { name: "+ Contact" }).click();
  const form = page.locator("[data-contact-form]");
  await form.getByPlaceholder("Name *").fill(name);
  await form.getByPlaceholder("Email").fill(email);
  if (flagged) await form.getByLabel("Send surveys to this contact").check();
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await waitForSaved(page);
}

// Reload and come back to the account, so what we read is what the database holds.
async function reopen(page, co) {
  await page.reload();
  await openAccount(page, co);
}

const surveyState = (page, name) => contactRow(page, name).locator("[data-survey-state]");

export const scenarios = [
  { id: `${F}/flag-toggle`, feature: F, title: "Toggling a contact on survives a reload; bulk unflag turns two contacts off", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      await requireSurveysSql(page);
      const co = ACCT(runId), [n1, n2, n3, n4] = NAMES(thisRunId);
      await openAccount(page, co);
      await addContact(page, n1, MAIL(thisRunId, 1), true);
      await addContact(page, n2, MAIL(thisRunId, 2), true);
      await addContact(page, n3, MAIL(thisRunId, 3), false);
      await addContact(page, n4, MAIL(thisRunId, 4), false);
      await reopen(page, co);
      assert.match(await surveyState(page, n1).textContent(), /Receives surveys/, "contact 1 starts flagged");
      assert.match(await surveyState(page, n3).textContent(), /Not flagged/, "contact 3 starts unflagged");

      await contactRow(page, n3).locator("[data-survey-toggle]").click();
      await waitForSaved(page);
      await reopen(page, co);
      assert.equal((await surveyState(page, n3).textContent()).trim(), "Receives surveys", "toggle on persisted");

      await contactRow(page, n1).getByLabel(`Select ${n1}`).check();
      await contactRow(page, n2).getByLabel(`Select ${n2}`).check();
      await page.locator("[data-survey-bulk]").getByRole("button", { name: /^Unflag \(2\)/ }).click();
      await waitForSaved(page);
      await reopen(page, co);
      assert.equal((await surveyState(page, n1).textContent()).trim(), "Not flagged", "contact 1 unflagged");
      assert.equal((await surveyState(page, n2).textContent()).trim(), "Not flagged", "contact 2 unflagged");
      assert.equal((await surveyState(page, n3).textContent()).trim(), "Receives surveys", "contact 3 untouched");
    } },

  { id: `${F}/send-and-pending`, feature: F, title: "Sending to the one flagged contact shows a pending row and a 'Survey sent' timeline entry", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      await requireSurveysSql(page);
      const co = ACCT(runId), [, , n3, n4] = NAMES(thisRunId);
      await openAccount(page, co);
      await page.locator("[data-send-survey]").click();
      const confirm = page.locator("[data-send-confirm]");
      await confirm.waitFor({ timeout: 15000 });
      assert.equal((await confirm.textContent()).trim(), "Send to 1 contact", "only contact 3 is flagged");
      // Promise.all so a failed click rejects both together; a bare waitForResponse left pending
      // after a click timeout became an unhandled rejection that crashed the whole run.
      const [resp] = await Promise.all([
        page.waitForResponse(r => /\/rpc\/send_survey/.test(r.url()) && r.request().method() === "POST", { timeout: 30000 }),
        confirm.click(),
      ]);
      const body = await resp.json();
      assert.equal(body.sent.length, 1, "one survey sent");
      assert.ok(body.sent[0].token, "an .invalid recipient gets its token back in the response");
      S.tokens.a = body.sent[0].token;
      await confirm.waitFor({ state: "detached", timeout: 15000 });
      await reopen(page, co);
      const row = page.locator('[data-survey-row="pending"]').filter({ hasText: n3 });
      await row.waitFor({ timeout: 15000 });
      assert.match(await row.textContent(), /awaiting answer/);
      const tl = page.locator("[data-activity-row]").filter({ hasText: `Survey sent (NPS check-in) to ${n3}` });
      assert.equal(await tl.count(), 1, "timeline shows the send");

      // Setup for the unsubscribe scenario: flag contact 4 and send to it through the page's own client.
      await contactRow(page, n4).locator("[data-survey-toggle]").click();
      await waitForSaved(page);
      const sent = await page.evaluate(async ([name, tpl]) => {
        const st = window.__store.getState();
        const c = st.contacts.find(x => x.name === name);
        const r = await sb.rpc("send_survey", { p_account: c.accountId, p_contact_ids: [c.id], p_template: tpl });
        return r.error ? { error: r.error.message } : r.data;
      }, [n4, NPS_TPL]);
      assert.ok(!sent.error, `setup send failed: ${sent.error}`);
      assert.ok(sent.sent && sent.sent[0] && sent.sent[0].token, "second token returned");
      S.tokens.b = sent.sent[0].token;
    } },

  { id: `${F}/answer-public`, feature: F, title: "The public link pre-selects 9; submitting with a reason shows the thanks message", role: "admin",
    run: async ({ page, context, env }) => {
      await requireSurveysSql(page);
      assert.ok(S.tokens.a, "token from send-and-pending");
      const fresh = await context.browser().newContext(); // signed out
      try {
        const p = await fresh.newPage();
        await p.goto(new URL(`survey.html?t=${encodeURIComponent(S.tokens.a)}&q=nps&v=9`, env.baseUrl).href);
        await p.locator('form input[name="nps"]').first().waitFor({ timeout: 20000 });
        assert.equal(await p.locator('input[name="nps"][value="9"]').isChecked(), true, "9 is pre-selected");
        await p.locator('textarea[name="reason"]').fill("QA: onboarding was smooth");
        await p.getByRole("button", { name: "Submit", exact: true }).click();
        await p.locator('[data-state="thanks"]').waitFor({ timeout: 20000 });
        assert.match(await p.locator('[data-state="thanks"]').textContent(), /Thank you/);
      } finally { await fresh.close(); }
    } },

  { id: `${F}/answer-shows`, feature: F, title: "The account shows 9/10 with the reason and a 'Survey answered by' timeline entry", role: "admin",
    run: async ({ page, runId, thisRunId }) => {
      await requireSurveysSql(page);
      const co = ACCT(runId), [, , n3] = NAMES(thisRunId);
      await openAccount(page, co);
      await reopen(page, co);
      const row = page.locator('[data-survey-row="submitted"]').filter({ hasText: n3 });
      await row.waitFor({ timeout: 20000 });
      const t = await row.textContent();
      assert.match(t, /9\/10/, "score");
      assert.match(t, /QA: onboarding was smooth/, "reason");
      assert.equal(await page.locator("[data-activity-row]").filter({ hasText: `Survey answered by ${n3}` }).count(), 1, "timeline shows the answer");
    } },

  { id: `${F}/csm-read-only`, feature: F, title: "The CSM sees the Surveys card read-only, with no Send survey button", role: "csm",
    run: async ({ page, runId }) => {
      await requireSurveysSql(page);
      await openAccount(page, ACCT(runId));
      await page.locator("[data-surveys-card]").waitFor({ timeout: 15000 });
      assert.match(await page.locator("[data-surveys-readonly]").textContent(), /Read only · sent by admins/);
      assert.equal(await page.locator("[data-send-survey]").count(), 0, "no Send survey button");
    } },

  { id: `${F}/unsubscribe`, feature: F, title: "Unsubscribing from the link shows 'Opted out' on the contact with its toggle gone", role: "admin",
    run: async ({ page, context, env, runId, thisRunId }) => {
      await requireSurveysSql(page);
      assert.ok(S.tokens.b, "token from send-and-pending");
      const co = ACCT(runId), n4 = NAMES(thisRunId)[3];
      const fresh = await context.browser().newContext();
      try {
        const p = await fresh.newPage();
        await p.goto(new URL(`survey.html?t=${encodeURIComponent(S.tokens.b)}&u=1`, env.baseUrl).href);
        await p.getByRole("button", { name: "Unsubscribe", exact: true }).click({ timeout: 20000 });
        await p.locator('[data-state="unsubscribed"]').waitFor({ timeout: 20000 });
      } finally { await fresh.close(); }
      await openAccount(page, co);
      await reopen(page, co);
      const pill = surveyState(page, n4);
      await pill.waitFor({ timeout: 15000 });
      assert.match(await pill.textContent(), /^Opted out · /, "contact reads Opted out");
      // The app removes the toggle for opted-out contacts (canToggle false); a disabled one would also satisfy the brief.
      const tg = contactRow(page, n4).locator("[data-survey-toggle]");
      assert.ok((await tg.count()) === 0 || (await tg.isDisabled()), "toggle is gone or disabled");
    } },
];
