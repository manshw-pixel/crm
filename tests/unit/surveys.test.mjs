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
