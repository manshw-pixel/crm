// Pure survey-template logic. Bundled with the rest of src/lib (not inlined into survey.html),
// so it may import from ./surveys.js.
import { NPS_CHECKIN } from "./surveys.js";

const rating = (id, text, scale, required) => ({ id, type: "rating", text, required, scale, lowLabel: "Very poor", highLabel: "Excellent" });
const longText = (id, text, required) => ({ id, type: "text", text, required: !!required, long: true });
const choice = (id, type, text, options, required) => ({ id, type, text, required: !!required, options });

export const STARTER_TEMPLATES = [
  { id: "onboarding-review", name: "Onboarding review", intro: "", archived: false, questions: [
    rating("q1", "How was your onboarding experience?", 5, true),
    longText("q2", "What could we have done better?", false),
  ] },
  { id: "support-quality", name: "Support quality", intro: "", archived: false, questions: [
    rating("q1", "How would you rate our support?", 7, true),
    longText("q2", "Any comments on our support?", false),
  ] },
  { id: "product-usage", name: "Product usage", intro: "", archived: false, questions: [
    choice("q1", "single", "How often does your team use {orgName}?", ["Daily", "Weekly", "Monthly", "Rarely"], true),
    choice("q2", "multi", "Which areas do you use?", ["Reporting", "Dashboards", "Integrations", "Mobile app"], false),
  ] },
  { id: "feature-requests", name: "Feature requests", intro: "", archived: false, questions: [
    longText("q1", "What would you like us to build next?", true),
    choice("q2", "multi", "Which of these would you use?", ["Bulk actions", "Custom reports", "More integrations", "Mobile app"], false),
  ] },
];

export function isNpsTemplate(t) {
  return !!t && Array.isArray(t.questions) && t.questions.some(q => q && q.type === "nps");
}

const trim = v => String(v == null ? "" : v).trim();

export function normaliseTemplate(t) {
  const x = t || {};
  return {
    ...x,
    name: trim(x.name),
    intro: trim(x.intro),
    archived: !!x.archived,
    questions: (x.questions || []).map(q => {
      const o = { id: q.id, type: q.type, text: trim(q.text), required: !!q.required };
      if (q.type === "rating") {
        o.scale = q.scale == null ? 5 : q.scale;
        o.lowLabel = trim(q.lowLabel);
        o.highLabel = trim(q.highLabel);
      } else if (q.type === "single" || q.type === "multi") {
        o.options = (q.options || []).map(trim);
      } else if (q.type === "text") {
        o.long = !!q.long;
      }
      if (q.followUp !== undefined) o.followUp = q.followUp;
      return o;
    }),
  };
}

export function validateTemplate(t) {
  const n = normaliseTemplate(t);
  const bad = error => ({ ok: false, error });
  if (!n.name) return bad("Name is required");
  if (n.name.length > 80) return bad("Name is too long (80 characters at most)");
  if (n.intro.length > 300) return bad("Intro is too long (300 characters at most)");
  if (!n.questions.length) return bad("Add at least one question");
  if (n.questions.length > 20) return bad("At most 20 questions");
  if (n.questions.filter(q => q.type === "nps").length > 1) return bad("Only one NPS question per template");
  const ids = new Set();
  for (let i = 0; i < n.questions.length; i++) {
    const q = n.questions[i];
    const p = `Question ${i + 1}: `;
    if (!["nps", "rating", "single", "multi", "text"].includes(q.type)) return bad(p + "unknown type");
    if (!q.text) return bad(p + "text is required");
    if (q.text.length > 300) return bad(p + "too long");
    if (ids.has(q.id)) return bad(p + "duplicate id");
    ids.add(q.id);
    if (q.type === "rating") {
      if (![5, 7, 10].includes(q.scale)) return bad(p + "scale must be 1–5, 1–7 or 1–10");
      if (q.lowLabel.length > 40 || q.highLabel.length > 40) return bad(p + "too long");
    } else if (q.type === "single" || q.type === "multi") {
      const o = q.options;
      if (o.length < 2 || o.length > 12 || o.some(x => !x)) return bad(p + "add 2 to 12 options");
      if (o.some(x => x.length > 80)) return bad(p + "too long");
      if (new Set(o.map(x => x.toLowerCase())).size !== o.length) return bad(p + "options must be unique");
    }
    const f = q.followUp;
    if (f != null) {
      if (q.type === "text") return bad(p + "text questions take no follow-up rule");
      if (f.op === "lte") {
        const max = q.type === "nps" ? 10 : q.type === "rating" ? q.scale : 0;
        const min = q.type === "nps" ? 0 : 1;
        if (!max || !Number.isInteger(f.value) || f.value < min || f.value > max) return bad(p + "follow-up score must be a whole number from " + min + " to " + (max || min));
      } else if (f.op === "in") {
        if ((q.type !== "single" && q.type !== "multi") || !Array.isArray(f.value) || !f.value.length || !f.value.every(v => q.options.includes(v))) return bad(p + "follow-up options must be some of the question's options");
      } else return bad(p + "unknown follow-up rule");
    }
  }
  return { ok: true };
}

export function newQuestion(type, newId) {
  const q = { id: newId(), type, text: "", required: false };
  if (type === "nps") q.text = "How likely are you to recommend {orgName} to a friend or colleague?";
  else if (type === "rating") { q.scale = 5; q.lowLabel = ""; q.highLabel = ""; }
  else if (type === "single" || type === "multi") q.options = ["", ""];
  else if (type === "text") q.long = false;
  return q;
}

export function copyTemplate(t, newId, now) {
  return {
    ...t,
    id: newId(),
    name: `Copy of ${t.name}`,
    archived: false,
    createdAt: now,
    updatedAt: now,
    questions: (t.questions || []).map(q => ({ ...q, options: q.options ? [...q.options] : q.options })),
  };
}

export function moveQuestion(t, from, to) {
  const qs = [...(t.questions || [])];
  if (from < 0 || from >= qs.length || to < 0 || to >= qs.length) return t;
  const [q] = qs.splice(from, 1);
  qs.splice(to, 0, q);
  return { ...t, questions: qs };
}

// Non-archived templates; the built-in NPS check-in leads unless a stored copy exists.
export function activeTemplates(stored) {
  const list = Array.isArray(stored) ? stored : [];
  const live = list.filter(t => !t.archived);
  return list.some(t => t.id === NPS_CHECKIN.id) ? live : [NPS_CHECKIN, ...live];
}
