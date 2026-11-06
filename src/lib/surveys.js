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

// ---- NPS campaign window, per-account NPS, and follow-up rules ----
const pad2 = n => String(n).padStart(2, "0");

// One-year window [start, end) starting on the 1st of `month`, the latest such date <= today.
export function campaignWindow(today, month) {
  const m = Number.isInteger(month) && month >= 1 && month <= 12 ? month : 3;
  const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(today || ""));
  const y = t ? +t[1] : new Date().getUTCFullYear();
  const cur = t ? `${t[1]}-${t[2]}-${t[3]}` : "";
  const startYear = cur && cur >= `${y}-${pad2(m)}-01` ? y : y - 1;
  return { start: `${startYear}-${pad2(m)}-01`, end: `${startYear + 1}-${pad2(m)}-01` };
}

// answers: [{ contactId, surveyId, value, date }]. Latest answer per contact inside the window.
export function accountNps(answers, today, opts) {
  const o = opts || {};
  const { start, end } = campaignWindow(today, o.campaignMonth);
  const latest = new Map();
  for (const a of answers || []) {
    if (!a || !Number.isInteger(a.value)) continue;
    const d = String(a.date || "").slice(0, 10);
    if (d < start || d >= end) continue;
    const key = a.contactId != null ? "c:" + a.contactId : "s:" + a.surveyId;
    const prev = latest.get(key);
    if (!prev || d >= prev.d) latest.set(key, { d, value: a.value });
  }
  if (!latest.size) return null;
  const rows = [...latest.values()];
  const sum = npsSummary(rows.map(r => r.value));
  const min = o.minResponses == null ? 0 : Number(o.minResponses);
  return { ...sum, enough: sum.n >= min, lastDate: rows.reduce((m, r) => (r.d > m ? r.d : m), "") };
}

// Submitted surveys grouped by account; the NPS question comes from each survey's own snapshot.
export function npsByAccount(surveys, today, surveySettings) {
  const s = surveySettings || {};
  const groups = new Map();
  for (const sv of surveys || []) {
    if (!sv || !sv.submittedAt || !sv.template || !Array.isArray(sv.template.questions)) continue;
    const q = sv.template.questions.find(x => x && x.type === "nps");
    if (!q) continue;
    const value = (sv.answers || {})[q.id];
    if (!Number.isInteger(value)) continue;
    if (!groups.has(sv.accountId)) groups.set(sv.accountId, []);
    groups.get(sv.accountId).push({ contactId: sv.contactId == null ? null : sv.contactId, surveyId: sv.id, value, date: String(sv.submittedAt).slice(0, 10) });
  }
  const out = new Map();
  for (const [accountId, list] of groups) {
    const r = accountNps(list, today, { campaignMonth: s.npsCampaignMonth, minResponses: s.minNpsResponses });
    if (r) out.set(accountId, r);
  }
  return out;
}

export function withSurveyNps(acct, result) {
  if (!result) return acct;
  const next = { ...acct };
  if (result.enough) next.inputs = { ...(acct.inputs || {}), nps: result.nps };
  const cur = acct.inputsUpdatedAt;
  if (!cur || String(result.lastDate) > String(cur)) next.inputsUpdatedAt = result.lastDate;
  return next;
}

export function followUpRule(q) {
  if (!q) return null;
  if (q.followUp !== undefined) return q.followUp;
  return q.type === "nps" ? { op: "lte", value: 6 } : null;
}

export function followUpMatches(q, value) {
  const r = followUpRule(q);
  if (!r) return false;
  const blank = value == null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
  if (blank) return false;
  if (r.op === "lte") return (q.type === "nps" || q.type === "rating") && typeof value === "number" && value <= r.value;
  if (r.op === "in") {
    const list = Array.isArray(r.value) ? r.value : [];
    if (q.type === "single") return list.includes(value);
    if (q.type === "multi") return Array.isArray(value) && value.some(v => list.includes(v));
  }
  return false;
}

export function answerLabel(q, value) {
  if (q.type === "nps") return `${value}/10`;
  if (q.type === "rating") return `${value}/${q.scale || 5}`;
  if (Array.isArray(value)) return value.join(", ");
  return String(value == null ? "" : value);
}
