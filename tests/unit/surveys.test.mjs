import { test } from "node:test";
import assert from "node:assert/strict";
import { NPS_CHECKIN, SURVEY_DEFAULTS, fillPlaceholders, firstNameOf, greeting, contactSurveyState, sendCandidates, validateAnswers, npsSummary } from "../../src/lib/surveys.js";

const ctx = { firstName: "Arjun", accountName: "Lumen", csmName: "Priya", orgName: "OneVio" };

test("constants", () => {
  assert.equal(NPS_CHECKIN.id, "nps-checkin");
  assert.equal(NPS_CHECKIN.questions.length, 2);
  assert.deepEqual(SURVEY_DEFAULTS, { throttleDays: 90, minNpsResponses: 3, npsCampaignMonth: 3, dailyCap: 50, fromName: "" });
});
test("fillPlaceholders fills known and blanks unknown", () => {
  assert.equal(fillPlaceholders("{firstName} at {accountName} via {csmName}/{orgName} {password}!", ctx), "Arjun at Lumen via Priya/OneVio !");
  assert.equal(fillPlaceholders("Hi {firstName}{x}", {}), "Hi ");
});
test("firstNameOf / greeting", () => {
  assert.equal(firstNameOf("  Arjun  Rao "), "Arjun");
  assert.equal(firstNameOf(""), "");
  assert.equal(greeting({ firstName: "Arjun" }), "Hi Arjun");
  assert.equal(greeting({ firstName: "" }), "Hi there");
});
test("contactSurveyState", () => {
  assert.deepEqual(contactSurveyState({ email: "a@b.c", surveyRecipient: true }), { key: "on", label: "Receives surveys", sev: "green", canToggle: true });
  assert.deepEqual(contactSurveyState({ email: "a@b.c" }), { key: "off", label: "Not flagged", sev: "grey", canToggle: true });
  assert.deepEqual(contactSurveyState({ email: "a@b.c", surveyRecipient: true, surveyOptOut: "2026-11-05" }), { key: "optout", label: "Opted out · 5 Nov", sev: "grey", canToggle: false });
  assert.deepEqual(contactSurveyState({ surveyRecipient: true }), { key: "noemail", label: "No email", sev: "grey", canToggle: false });
  assert.equal(contactSurveyState({ email: " ", surveyOptOut: "2026-11-05" }).key, "noemail");
});
test("sendCandidates", () => {
  const cs = [
    { id: "ok", email: "a@x.com", surveyRecipient: true },
    { id: "exp", email: "b@x.com", surveyRecipient: true },
    { id: "off", email: "c@x.com" },
    { id: "ne", surveyRecipient: true },
    { id: "oo", email: "d@x.com", surveyRecipient: true, surveyOptOut: "2026-01-01" },
    { id: "pend", email: "e@x.com", surveyRecipient: true },
    { id: "done", email: "f@x.com", surveyRecipient: true },
  ];
  const sv = [
    { templateId: "t", contactId: "exp", expiresAt: "2026-11-04T10:00:00Z", submittedAt: null, sentAt: "2026-10-05T10:00:00Z" },
    { templateId: "t", contactId: "pend", expiresAt: "2026-11-20T10:00:00Z", submittedAt: null, sentAt: "2026-10-21T10:00:00Z" },
    { templateId: "other", contactId: "ok", expiresAt: "2026-11-20T10:00:00Z", submittedAt: null, sentAt: "2026-10-21T10:00:00Z" },
    { templateId: "t", contactId: "done", expiresAt: "2026-11-20T10:00:00Z", submittedAt: "2026-10-22T10:00:00Z", sentAt: "2026-10-21T10:00:00Z" },
  ];
  const r = sendCandidates(cs, sv, "t", "2026-11-05");
  assert.deepEqual(r.ticked.map(c => c.id), ["ok", "exp", "done"]);
  assert.deepEqual(r.other.map(o => [o.contact.id, o.reason]), [
    ["off", "Not flagged for surveys"], ["ne", "No email"], ["oo", "Opted out"], ["pend", "Survey pending since 21 Oct"],
  ]);
});
test("validateAnswers", () => {
  const qs = [
    { id: "nps", type: "nps", text: "How likely…", required: true },
    { id: "r", type: "rating", text: "Rate", scale: 5 },
    { id: "t", type: "text", text: "Why", required: false },
  ];
  assert.deepEqual(validateAnswers(qs, { nps: 10 }), { ok: true });
  assert.deepEqual(validateAnswers(qs, { nps: 0, t: "" }), { ok: true });
  assert.deepEqual(validateAnswers(qs, { nps: 11 }), { ok: false, error: "Invalid answer" });
  assert.deepEqual(validateAnswers(qs, { nps: "7" }), { ok: false, error: "Invalid answer" });
  assert.deepEqual(validateAnswers(qs, { nps: 7.5 }), { ok: false, error: "Invalid answer" });
  assert.deepEqual(validateAnswers(qs, {}), { ok: false, error: 'Answer "How likely…"' });
  assert.deepEqual(validateAnswers(qs, { nps: 5, r: 6 }), { ok: false, error: "Invalid answer" });
  assert.deepEqual(validateAnswers(qs, { nps: 5, r: 0 }), { ok: false, error: "Invalid answer" });
  assert.deepEqual(validateAnswers(qs, { nps: 5, r: 5 }), { ok: true });
  assert.deepEqual(validateAnswers(qs, { nps: 5, t: "x".repeat(4001) }), { ok: false, error: "Invalid answer" });
  assert.deepEqual(validateAnswers(qs, { nps: 5, zzz: 1 }), { ok: false, error: "Invalid answer" });
});
test("validateAnswers: choice answers must be options", () => {
  const qs = [
    { id: "s", type: "single", text: "Pick", options: ["A", "B"] },
    { id: "m", type: "multi", text: "Pick many", options: ["A", "B", "C"] },
    { id: "n", type: "single", text: "No options" },
  ];
  const bad = { ok: false, error: "Invalid answer" };
  assert.deepEqual(validateAnswers(qs, { s: "A", m: ["A", "C"] }), { ok: true });
  assert.deepEqual(validateAnswers(qs, { s: "Z" }), bad);
  assert.deepEqual(validateAnswers(qs, { s: ["A"] }), bad);
  assert.deepEqual(validateAnswers(qs, { m: "A" }), bad);
  assert.deepEqual(validateAnswers(qs, { m: ["A", "Z"] }), bad);
  assert.deepEqual(validateAnswers(qs, { m: ["A", "A"] }), bad);
  assert.deepEqual(validateAnswers(qs, { m: ["x".repeat(5000)] }), bad);
  assert.deepEqual(validateAnswers(qs, { n: "anything" }), bad);
  assert.deepEqual(validateAnswers([{ id: "w", type: "weird", text: "?" }], { w: "x" }), bad);
});
test("validateAnswers: whitespace-only text is blank", () => {
  const qs = [{ id: "t", type: "text", text: "Why?", required: true }];
  assert.deepEqual(validateAnswers(qs, { t: "   " }), { ok: false, error: 'Answer "Why?"' });
  assert.deepEqual(validateAnswers(qs, { t: " ok " }), { ok: true });
  assert.deepEqual(validateAnswers([{ id: "t", type: "text", text: "Why?" }], { t: " 	 " }), { ok: true });
});
test("npsSummary", () => {
  assert.equal(npsSummary([]), null);
  assert.deepEqual(npsSummary([10, 9, 8, 3]), { nps: 25, n: 4, promoters: 2, passives: 1, detractors: 1 });
});

test("sendCandidates: an unflagged contact with an open survey reads pending, not 'Not flagged'", () => {
  const cs = [{ id: "u1", email: "u@x.com", surveyRecipient: false }];
  const sv = [{ templateId: "t", contactId: "u1", sentAt: "2026-11-05T10:00:00Z", expiresAt: "2026-12-05T10:00:00Z", submittedAt: null }];
  const r = sendCandidates(cs, sv, "t", "2026-11-05");
  assert.deepEqual(r.other.map(o => o.reason), ["Survey pending since 5 Nov"]);
});

import { campaignWindow, accountNps, npsByAccount, withSurveyNps, followUpRule, followUpMatches, answerLabel } from "../../src/lib/surveys.js";

test("campaignWindow", () => {
  assert.deepEqual(campaignWindow("2026-02-28", 3), { start: "2025-03-01", end: "2026-03-01" });
  assert.equal(campaignWindow("2026-03-01", 3).start, "2026-03-01");
  assert.equal(campaignWindow("2026-06-01", 99).start, "2026-03-01");
});
test("accountNps", () => {
  const a = (contactId, value, date, surveyId = "s" + value + date) => ({ contactId, surveyId, value, date });
  const o = { campaignMonth: 3, minResponses: 3 };
  assert.equal(accountNps([], "2026-06-01", o), null);
  assert.equal(accountNps([a("c1", 9, "2026-02-01")], "2026-06-01", o), null);
  const r = accountNps([a("c1", 2, "2026-04-01"), a("c1", 10, "2026-05-01"), a("c2", 9, "2026-05-02")], "2026-06-01", o);
  assert.equal(r.n, 2); assert.equal(r.promoters, 2); assert.equal(r.nps, 100);
  assert.equal(r.enough, false); assert.equal(r.lastDate, "2026-05-02");
  assert.equal(accountNps([a("c1", 9, "2026-04-01"), a("c2", 9, "2026-04-01"), a(null, 3, "2026-04-02", "x")], "2026-06-01", o).enough, true);
  assert.equal(accountNps([a(null, 9, "2026-04-01", "x"), a(null, 9, "2026-04-01", "y")], "2026-06-01", o).n, 2);
});
test("npsByAccount", () => {
  const tpl = { questions: [{ id: "q", type: "nps" }] };
  const sv = (id, accountId, contactId, v, at) => ({ id, accountId, contactId, template: tpl, submittedAt: at, answers: { q: v } });
  const m = npsByAccount([sv("1", "A", "c1", 9, "2026-04-01T10:00:00Z"), sv("2", "A", "c2", 3, null), sv("3", "A", "c3", 5.5, "2026-04-01"), { id: "4", accountId: "B", submittedAt: "2026-04-01", answers: {} }], "2026-06-01", { npsCampaignMonth: 3, minNpsResponses: 1 });
  assert.equal(m.size, 1);
  assert.equal(m.get("A").n, 1);
});
test("withSurveyNps", () => {
  const acct = { inputs: { nps: 5, x: 1 }, inputsUpdatedAt: "2026-01-01" };
  const r = withSurveyNps(acct, { nps: 40, enough: true, lastDate: "2026-05-01" });
  assert.equal(r.inputs.nps, 40); assert.equal(r.inputsUpdatedAt, "2026-05-01"); assert.equal(acct.inputs.nps, 5);
  const r2 = withSurveyNps(acct, { nps: 40, enough: false, lastDate: "2026-05-01" });
  assert.equal(r2.inputs.nps, 5); assert.equal(r2.inputsUpdatedAt, "2026-05-01");
  assert.equal(withSurveyNps(acct, null), acct);
});
test("follow-up rules", () => {
  assert.deepEqual(followUpRule({ type: "nps" }), { op: "lte", value: 6 });
  assert.equal(followUpRule({ type: "nps", followUp: null }), null);
  assert.equal(followUpRule({ type: "rating" }), null);
  assert.equal(followUpMatches({ type: "nps" }, 6), true);
  assert.equal(followUpMatches({ type: "nps" }, 7), false);
  assert.equal(followUpMatches({ type: "multi", followUp: { op: "in", value: ["B"] } }, ["A", "B"]), true);
  assert.equal(followUpMatches({ type: "single", followUp: { op: "in", value: ["B"] } }, ""), false);
  assert.equal(answerLabel({ type: "nps" }, 6), "6/10");
  assert.equal(answerLabel({ type: "rating", scale: 7 }, 2), "2/7");
  assert.equal(answerLabel({ type: "multi" }, ["A", "B"]), "A, B");
});
