import { test } from "node:test";
import assert from "node:assert/strict";
import { STARTER_TEMPLATES, isNpsTemplate, validateTemplate, normaliseTemplate, newQuestion, copyTemplate, moveQuestion, activeTemplates } from "../../src/lib/survey-templates.js";
import { NPS_CHECKIN, sendCandidates } from "../../src/lib/surveys.js";

const T = over => ({ id: "t1", name: "N", intro: "", questions: [{ id: "a", type: "text", text: "Q", required: false, long: false }], ...over });
const err = t => validateTemplate(t).error;

test("starters", () => {
  assert.deepEqual(STARTER_TEMPLATES.map(t => t.id), ["onboarding-review", "support-quality", "product-usage", "feature-requests"]);
  for (const t of STARTER_TEMPLATES) assert.equal(validateTemplate(t).ok, true, t.id);
  assert.equal(STARTER_TEMPLATES[1].questions[0].scale, 7);
});

test("validation messages", () => {
  assert.equal(validateTemplate(T()).ok, true);
  assert.equal(err(T({ name: "  " })), "Name is required");
  assert.equal(err(T({ questions: [] })), "Add at least one question");
  assert.equal(err(T({ questions: Array.from({ length: 21 }, (_, i) => ({ id: "q" + i, type: "text", text: "x" })) })), "At most 20 questions");
  const nps = id => ({ id, type: "nps", text: "x" });
  assert.equal(err(T({ questions: [nps("a"), nps("b")] })), "Only one NPS question per template");
  assert.equal(err(T({ questions: [{ id: "a", type: "text", text: "ok" }, { id: "b", type: "text", text: " " }] })), "Question 2: text is required");
  assert.equal(err(T({ questions: [{ id: "a", type: "rating", text: "x", scale: 6 }] })), "Question 1: scale must be 1–5, 1–7 or 1–10");
  assert.equal(err(T({ questions: [{ id: "a", type: "single", text: "x", options: ["a"] }] })), "Question 1: add 2 to 12 options");
  assert.equal(err(T({ questions: [{ id: "a", type: "single", text: "x", options: ["a", " "] }] })), "Question 1: add 2 to 12 options");
  assert.equal(err(T({ questions: [{ id: "a", type: "multi", text: "x", options: Array.from({ length: 13 }, (_, i) => "o" + i) }] })), "Question 1: add 2 to 12 options");
  assert.equal(err(T({ questions: [{ id: "a", type: "single", text: "x", options: ["Daily", " daily"] }] })), "Question 1: options must be unique");
  assert.equal(err(T({ questions: [{ id: "a", type: "text", text: "x".repeat(301) }] })), "Question 1: too long");
  assert.equal(err(T({ questions: [{ id: "a", type: "rating", text: "x", scale: 5, lowLabel: "l".repeat(41) }] })), "Question 1: too long");
  assert.equal(err(T({ questions: [{ id: "a", type: "text", text: "ok" }, { id: "b", type: "weird", text: "x" }] })), "Question 2: unknown type");
  assert.equal(err(T({ questions: [{ id: "a", text: "x" }] })), "Question 1: unknown type");
  assert.equal(validateTemplate(T({ name: "n".repeat(81) })).ok, false);
  assert.equal(validateTemplate(T({ intro: "i".repeat(301) })).ok, false);
});

test("options trimmed and unique", () => {
  const t = normaliseTemplate(T({ questions: [{ id: "a", type: "single", text: " x ", options: [" Daily ", "Weekly"] }] }));
  assert.deepEqual(t.questions[0].options, ["Daily", "Weekly"]);
  assert.equal(t.questions[0].text, "x");
  assert.equal(validateTemplate(T({ questions: [{ id: "a", type: "multi", text: "x", options: [" Daily", "daily"] }] })).ok, false);
});

test("normaliseTemplate drops foreign fields and sets defaults", () => {
  const t = normaliseTemplate(T({ questions: [
    { id: "a", type: "text", text: "x", scale: 7, options: ["z"], lowLabel: "l" },
    { id: "b", type: "rating", text: "y", long: true, options: ["z"] },
    { id: "c", type: "single", text: "z", scale: 5, long: true, options: ["p", "q"] },
  ] }));
  assert.deepEqual(t.questions[0], { id: "a", type: "text", text: "x", required: false, long: false });
  assert.deepEqual(t.questions[1], { id: "b", type: "rating", text: "y", required: false, scale: 5, lowLabel: "", highLabel: "" });
  assert.deepEqual(t.questions[2], { id: "c", type: "single", text: "z", required: false, options: ["p", "q"] });
});

test("edit keeps question ids; copy keeps ids, new template id", () => {
  const t = T({ questions: [{ id: "q-1", type: "text", text: "Old" }] });
  const edited = normaliseTemplate({ ...t, questions: [{ ...t.questions[0], text: "New" }] });
  assert.equal(edited.questions[0].id, "q-1");
  const c = copyTemplate(t, () => "t2", "2026-11-05T00:00:00Z");
  assert.equal(c.id, "t2");
  assert.equal(c.name, "Copy of N");
  assert.equal(c.archived, false);
  assert.deepEqual(c.questions.map(q => q.id), ["q-1"]);
});

test("newQuestion, moveQuestion, isNpsTemplate", () => {
  let n = 0;
  const id = () => "id" + ++n;
  assert.equal(newQuestion("nps", id).text, "How likely are you to recommend {orgName} to a friend or colleague?");
  assert.deepEqual(newQuestion("single", id).options, ["", ""]);
  assert.equal(newQuestion("text", id).text, "");
  assert.equal(isNpsTemplate(NPS_CHECKIN), true);
  assert.equal(isNpsTemplate(STARTER_TEMPLATES[0]), false);
  const m = moveQuestion(STARTER_TEMPLATES[0], 0, 1);
  assert.deepEqual(m.questions.map(q => q.id), ["q2", "q1"]);
  assert.deepEqual(STARTER_TEMPLATES[0].questions.map(q => q.id), ["q1", "q2"]);
});

test("activeTemplates adds NPS_CHECKIN when absent and hides archived", () => {
  const a = { id: "a", name: "A", questions: [] }, b = { id: "b", name: "B", archived: true, questions: [] };
  assert.deepEqual(activeTemplates([a, b]).map(t => t.id), ["nps-checkin", "a"]);
  assert.deepEqual(activeTemplates(undefined).map(t => t.id), ["nps-checkin"]);
  const stored = { id: "nps-checkin", name: "Mine", questions: [] };
  assert.deepEqual(activeTemplates([a, stored]).map(t => t.name), ["A", "Mine"]);
  assert.deepEqual(activeTemplates([a, { ...stored, archived: true }]).map(t => t.id), ["a"]);
});

test("sendCandidates throttle", () => {
  const cs = [{ id: "c", email: "c@x.com", surveyRecipient: true }];
  const sv = [{ templateId: "support-quality", template: STARTER_TEMPLATES[1], contactId: "c", sentAt: "2026-10-26T09:00:00Z", expiresAt: "2026-11-02T09:00:00Z", submittedAt: "2026-10-27T09:00:00Z" }];
  const onb = STARTER_TEMPLATES[0];
  const r = sendCandidates(cs, sv, onb, "2026-11-05", 90);
  assert.deepEqual(r.other.map(o => o.reason), ["Surveyed 26 Oct — wait until 24 Jan"]);
  assert.equal(sendCandidates(cs, sv, NPS_CHECKIN, "2026-11-05", 90).ticked.length, 1);
  assert.equal(sendCandidates(cs, sv, onb, "2026-11-05", 0).ticked.length, 1);
  assert.equal(sendCandidates(cs, sv, onb, "2026-11-05", 9).ticked.length, 1);
  const nsv = [{ templateId: "nps-checkin", template: NPS_CHECKIN, contactId: "c", sentAt: "2026-10-26T09:00:00Z", expiresAt: "2026-11-02T09:00:00Z", submittedAt: "x" }];
  assert.equal(sendCandidates(cs, nsv, onb, "2026-11-05", 90).ticked.length, 1);
  const pend = [{ ...sv[0], templateId: "onboarding-review", sentAt: "2026-11-01T09:00:00Z", expiresAt: "2026-12-01T09:00:00Z", submittedAt: null }, ...sv];
  assert.match(sendCandidates(cs, pend, onb, "2026-11-05", 90).other[0].reason, /^Survey pending/);
  const unflagged = [{ ...cs[0], surveyRecipient: false }];
  assert.match(sendCandidates(unflagged, sv, onb, "2026-11-05", 90).other[0].reason, /^Surveyed/);
});

test("sendCandidates: old string-id call still works", () => {
  const cs = [{ id: "c", email: "c@x.com", surveyRecipient: true }];
  const sv = [{ templateId: "t", contactId: "c", sentAt: "2026-11-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z", submittedAt: null }];
  assert.match(sendCandidates(cs, sv, "t", "2026-11-05").other[0].reason, /^Survey pending since 1 Nov/);
});
