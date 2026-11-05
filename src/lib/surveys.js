// Pure survey logic. No imports and no globals: this file is also inlined into the public
// survey page by stripping `export`, so it must stay self-contained.
export const NPS_CHECKIN = {
  id: "nps-checkin",
  name: "NPS check-in",
  intro: "Thanks for working with us — this takes under a minute.",
  questions: [
    { id: "nps", type: "nps", text: "How likely are you to recommend {orgName} to a friend or colleague?", required: true },
    { id: "reason", type: "text", text: "What's the main reason for your score?", required: false },
  ],
};

export const SURVEY_DEFAULTS = { throttleDays: 90, minNpsResponses: 3, npsCampaignMonth: 3, dailyCap: 50, fromName: "" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dMon(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]}` : "";
}

export function fillPlaceholders(text, ctx) {
  const c = ctx || {};
  const known = { firstName: 1, accountName: 1, csmName: 1, orgName: 1 };
  return String(text == null ? "" : text).replace(/\{(\w+)\}/g, (_, k) => (known[k] && c[k] != null ? String(c[k]) : ""));
}

export function firstNameOf(name) {
  const t = String(name || "").trim().split(/\s+/)[0];
  return t || "";
}

export function greeting(ctx) {
  const f = ctx && ctx.firstName ? String(ctx.firstName).trim() : "";
  return f ? `Hi ${f}` : "Hi there";
}

export function contactSurveyState(contact) {
  const c = contact || {};
  if (!String(c.email || "").trim()) return { key: "noemail", label: "No email", sev: "grey", canToggle: false };
  if (c.surveyOptOut) return { key: "optout", label: `Opted out · ${dMon(c.surveyOptOut)}`, sev: "grey", canToggle: false };
  if (c.surveyRecipient) return { key: "on", label: "Receives surveys", sev: "green", canToggle: true };
  return { key: "off", label: "Not flagged", sev: "grey", canToggle: true };
}

// An unanswered survey whose link has not expired yet (expiry compared by date, inclusive).
export function isOpenSurvey(s, today) {
  return !!s && !s.submittedAt && String(s.expiresAt || "").slice(0, 10) >= today;
}

function hasNpsQuestion(t) {
  return !!t && Array.isArray(t.questions) && t.questions.some(q => q && q.type === "nps");
}
// A sent survey is NPS when its snapshot has an nps question (older rows without a snapshot: by id).
function surveyIsNps(s) {
  return s.template ? hasNpsQuestion(s.template) : s.templateId === "nps-checkin";
}
function dayNum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : NaN;
}
function isoOfDay(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

// Splits contacts into the default-ticked set and the rest (with a reason). "Not flagged" only
// decides the default tick: an admin may still tick that contact for one send, and
// send_survey accepts it. No email, opted out and a pending survey are hard skips there.
// `template` is the template object (a bare id string still works). For a non-NPS template, a
// contact sent any non-NPS survey within throttleDays days is held back (0/undefined = off).
export function sendCandidates(contacts, surveys, template, today, throttleDays) {
  const t = typeof template === "string" ? { id: template, questions: [] } : (template || {});
  const throttled = !hasNpsQuestion(t) && Number(throttleDays) > 0;
  const days = Number(throttleDays);
  const ticked = [];
  const other = [];
  for (const contact of contacts || []) {
    const open = (surveys || []).find(s => s.templateId === t.id && s.contactId === contact.id && isOpenSurvey(s, today));
    let recent = null;
    if (throttled) {
      for (const s of surveys || []) {
        if (s.contactId !== contact.id || surveyIsNps(s)) continue;
        const d = dayNum(s.sentAt);
        if (isNaN(d) || dayNum(today) - d >= days) continue;
        if (!recent || d > recent) recent = d;
      }
    }
    let reason = null;
    if (!String(contact.email || "").trim()) reason = "No email";
    else if (contact.surveyOptOut) reason = "Opted out";
    // Pending before "not flagged": an unflagged contact can still hold an open survey (ticked
    // for a one-off send), and the server refuses a resend, so the dialog must disable it.
    else if (open) reason = `Survey pending since ${dMon(open.sentAt)}`;
    else if (recent != null) reason = `Surveyed ${dMon(isoOfDay(recent))} — wait until ${dMon(isoOfDay(recent + days))}`;
    else if (!contact.surveyRecipient) reason = "Not flagged for surveys";
    if (reason) other.push({ contact, reason });
    else ticked.push(contact);
  }
  return { ticked, other };
}

export function validateAnswers(questions, answers) {
  const qs = questions || [];
  const a = answers || {};
  const bad = { ok: false, error: "Invalid answer" };
  const ids = new Set(qs.map(q => q.id));
  for (const k of Object.keys(a)) if (!ids.has(k)) return bad;
  for (const q of qs) {
    const v = a[q.id];
    const blank = v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
    if (blank) {
      if (q.required) return { ok: false, error: `Answer "${q.text}"` };
      continue;
    }
    if (q.type === "nps") {
      if (!Number.isInteger(v) || v < 0 || v > 10) return bad;
    } else if (q.type === "rating") {
      if (!Number.isInteger(v) || v < 1 || v > (q.scale || 5)) return bad;
    } else if (q.type === "text") {
      if (typeof v !== "string" || v.length > 4000) return bad;
    } else if (q.type === "single" || q.type === "multi") {
      // Choice answers must be one of the question's options; no options means no valid answer.
      const opts = Array.isArray(q.options) ? q.options : null;
      if (!opts) return bad;
      if (q.type === "single") {
        if (typeof v !== "string" || !opts.includes(v)) return bad;
      } else {
        if (!Array.isArray(v) || new Set(v).size !== v.length) return bad;
        if (!v.every(x => typeof x === "string" && opts.includes(x))) return bad;
      }
    } else return bad;
  }
  return { ok: true };
}

export function npsSummary(values) {
  const n = (values || []).length;
  if (!n) return null;
  let promoters = 0, passives = 0, detractors = 0;
  for (const v of values) {
    if (v >= 9) promoters++;
    else if (v >= 7) passives++;
    else detractors++;
  }
  return { nps: Math.round((promoters / n) * 100 - (detractors / n) * 100), n, promoters, passives, detractors };
}
