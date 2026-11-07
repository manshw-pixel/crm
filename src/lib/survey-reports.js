// Pure report logic for the admin Surveys page. No window, document or React.
import { npsSummary, campaignWindow, answerLabel } from "./surveys.js";
import { csvCell } from "./csv.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = v => String(v || "").slice(0, 10);
const dayNum = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : NaN;
};
const isoOfDay = n => new Date(n * 86400000).toISOString().slice(0, 10);
const surveyDate = s => day(s.submittedAt) || day(s.sentAt);
const questionsOf = s => (s && s.template && Array.isArray(s.template.questions) ? s.template.questions.filter(Boolean) : []);
const blank = v => v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

export function filterSurveys(surveys, accountsById, f) {
  const o = f || {};
  const accts = accountsById || {};
  return (surveys || []).filter(s => {
    const a = accts[s.accountId] || {};
    if (o.templateId && s.templateId !== o.templateId) return false;
    if (o.csm && a.csm !== o.csm) return false;
    if (o.tier && a.tier !== o.tier) return false;
    if (o.role) {
      const r = String(s.contactRole || "").trim();
      if (o.role === "(none)" ? r !== "" : r !== o.role) return false;
    }
    if (o.source && s.source !== o.source) return false;
    const d = surveyDate(s);
    if (o.from && d < o.from) return false;
    if (o.to && d > o.to) return false;
    return true;
  });
}

export function previousPeriod(from, to) {
  const f = dayNum(from), t = dayNum(to);
  const len = t - f + 1;
  return { from: isoOfDay(f - len), to: isoOfDay(f - 1) };
}

function npsQuestion(s) {
  return questionsOf(s).find(q => q.type === "nps") || null;
}

// One row per campaign window with any NPS send or answer. Sent counts fall in the window of the
// send date, scores in the window of the answer date. `today` is accepted for call-site symmetry.
export function npsByYear(surveys, month, _today) {
  const wins = new Map();
  const get = date => {
    const w = campaignWindow(date, month);
    if (!wins.has(w.start)) wins.set(w.start, { start: w.start, latest: new Map(), sent: 0, submitted: 0 });
    return wins.get(w.start);
  };
  for (const s of surveys || []) {
    const q = npsQuestion(s);
    if (!q) continue;
    if (s.source === "sent" && day(s.sentAt)) {
      const w = get(day(s.sentAt));
      w.sent++;
      if (s.submittedAt) w.submitted++;
    }
    const v = (s.answers || {})[q.id];
    if (s.submittedAt && Number.isInteger(v)) {
      const w = get(day(s.submittedAt));
      const key = s.contactId != null ? "c:" + s.contactId : "s:" + s.id;
      const d = String(s.submittedAt);
      const prev = w.latest.get(key);
      if (!prev || d >= prev.d) w.latest.set(key, { d, v });
    }
  }
  return [...wins.values()].sort((a, b) => (a.start < b.start ? -1 : 1)).map(w => {
    const sum = npsSummary([...w.latest.values()].map(x => x.v)) || { nps: null, n: 0, promoters: 0, passives: 0, detractors: 0 };
    const y = +w.start.slice(0, 4), m = +w.start.slice(5, 7);
    const label = `${MONTHS[m - 1]} ${y} – ${MONTHS[(m + 10) % 12]} ${m === 1 ? y : y + 1}`;
    return { start: w.start, label, ...sum, sent: w.sent, submitted: w.submitted, responseRate: w.sent ? Math.round((w.submitted / w.sent) * 100) : null };
  });
}

export function followUpStats(surveys, tasks) {
  const byId = new Map((surveys || []).map(s => [s.id, s]));
  const groups = new Map();
  let total = 0, onTime = 0, open = 0;
  for (const t of tasks || []) {
    if (!t || t.source !== "survey") continue;
    const s = byId.get(t.surveyId);
    if (!s || !s.submittedAt) continue;
    const q = questionsOf(s).find(x => x.id === t.questionId);
    if (!q || q.type !== "nps") continue;
    const isDone = t.status === "Done";
    const gap = dayNum(t.doneAt) - dayNum(t.createdAt);
    const ok = isDone && gap >= 0 && gap <= 7;
    const csm = String(t.owner || "").trim() || "Unassigned";
    if (!groups.has(csm)) groups.set(csm, { csm, total: 0, onTime: 0, open: 0 });
    const g = groups.get(csm);
    total++; g.total++;
    if (ok) { onTime++; g.onTime++; }
    if (!isDone) { open++; g.open++; }
  }
  const rate = (a, b) => (b ? Math.round((a / b) * 100) : null);
  return {
    total, onTime, rate: rate(onTime, total), open,
    byCsm: [...groups.values()].sort((a, b) => (a.csm < b.csm ? -1 : 1)).map(g => ({ ...g, rate: rate(g.onTime, g.total) })),
  };
}

// Per-CSM rows for the Overview. `win` ({ start: "YYYY-MM-DD" } of a campaign window, as npsByYear
// reports it) picks the campaign; without it the latest campaign with any NPS activity is used.
// Sent counts only emailed surveys; follow-up is per task owner and, like the KPI card, all-time.
export function surveyStatsByCsm(surveys, accountsById, tasks, win) {
  const accts = accountsById || {};
  const csmOf = s => String((accts[s.accountId] || {}).csm || "").trim() || "Unassigned";
  const list = surveys || [];
  let start = win && win.start;
  if (!start) {
    const all = npsByYear(list, 3);
    start = all.length ? all[all.length - 1].start : "";
  }
  const month = start ? +start.slice(5, 7) : 3;
  const groups = new Map();
  for (const s of list) {
    const k = csmOf(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const fu = new Map(followUpStats(list, tasks).byCsm.map(g => [g.csm, g]));
  const rows = new Map();
  const blankRow = csm => ({ csm, sent: 0, answered: 0, rate: null, nps: null, n: 0, followUp: { total: 0, onTime: 0, rate: null } });
  for (const [csm, ss] of groups) {
    const w = npsByYear(ss, month).find(r => r.start === start);
    if (!w) continue;
    rows.set(csm, { csm, sent: w.sent, answered: w.submitted, rate: w.responseRate, nps: w.nps, n: w.n, followUp: { total: 0, onTime: 0, rate: null } });
  }
  for (const [csm, g] of fu) {
    if (!rows.has(csm)) rows.set(csm, blankRow(csm));
    rows.get(csm).followUp = { total: g.total, onTime: g.onTime, rate: g.rate };
  }
  return [...rows.values()].sort((a, b) => (a.csm === "Unassigned" ? 1 : b.csm === "Unassigned" ? -1 : a.csm.localeCompare(b.csm)));
}

// Open follow-up tasks tied to an answered NPS question, oldest first, with the score and the
// first free-text answer on the same survey (the "why" comment), if any.
export function detractorsAwaiting(surveys, tasks) {
  const byId = new Map((surveys || []).map(s => [s.id, s]));
  const out = [];
  for (const t of tasks || []) {
    if (!t || t.source !== "survey" || t.status === "Done") continue;
    const s = byId.get(t.surveyId);
    if (!s || !s.submittedAt) continue;
    const qs = questionsOf(s);
    const q = qs.find(x => x.id === t.questionId);
    if (!q || q.type !== "nps") continue;
    const answers = s.answers || {};
    const score = answers[q.id];
    if (!Number.isInteger(score)) continue;
    const tq = qs.find(x => x.type === "text" && !blank(answers[x.id]));
    out.push({ survey: s, task: t, score, comment: tq ? String(answers[tq.id]) : "" });
  }
  return out.sort((a, b) => String(a.task.createdAt || "").localeCompare(String(b.task.createdAt || "")));
}

export function questionResults(surveys, templateId) {
  const list = (surveys || []).filter(s => s.templateId === templateId);
  const order = [];
  const byKey = new Map();
  for (const s of list) {
    for (const q of questionsOf(s)) {
      const key = `${q.id}|${q.type}|${q.scale || ""}`;
      if (!byKey.has(key)) { byKey.set(key, { q, values: [], opts: [] }); order.push(key); }
      const e = byKey.get(key);
      if (Array.isArray(q.options)) for (const o of q.options) if (!e.opts.includes(o)) e.opts.push(o);
      if (!s.submittedAt) continue;
      const v = (s.answers || {})[q.id];
      if (blank(v)) continue;
      e.values.push({ v, s });
    }
  }
  return order.map(key => {
    const { q, values, opts } = byKey.get(key);
    const base = { key, id: q.id, type: q.type, text: q.text, scale: q.scale || null, n: values.length };
    if (q.type === "nps") return { ...base, ...(npsSummary(values.map(x => x.v).filter(Number.isInteger)) || {}), n: values.length };
    if (q.type === "rating") {
      const scale = q.scale || 5;
      const dist = Array(scale).fill(0);
      let sum = 0;
      for (const { v } of values) if (Number.isInteger(v) && v >= 1 && v <= scale) { dist[v - 1]++; sum += v; }
      return { ...base, scale, dist, avg: values.length ? Math.round((sum / values.length) * 10) / 10 : null };
    }
    if (q.type === "single" || q.type === "multi") {
      const m = new Map(opts.map(o => [o, 0]));
      for (const { v } of values) for (const x of Array.isArray(v) ? v : [v]) m.set(x, (m.get(x) || 0) + 1);
      return { ...base, counts: [...m].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n) };
    }
    if (q.type === "text") {
      const items = values.map(({ v, s }) => ({ text: String(v), source: s.source || "", contactName: s.contactName || "", accountId: s.accountId, date: surveyDate(s) }));
      items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      return { ...base, items };
    }
    return base;
  });
}

export function roleSplit(surveys, templateId) {
  const groups = new Map();
  for (const s of (surveys || []).filter(x => x.templateId === templateId)) {
    const r = String(s.contactRole || "").trim();
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(s);
  }
  const roles = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  return roles.map(r => ({ role: r || "No role", results: questionResults(groups.get(r), templateId) }));
}

export function responsesCSV(surveys, accountsById) {
  const accts = accountsById || {};
  const head = ["Date", "Account", "CSM", "Tier", "Template", "Contact", "Role", "Source", "Question", "Answer"].join(",");
  const out = [];
  for (const s of surveys || []) {
    const a = accts[s.accountId] || {};
    for (const q of questionsOf(s)) {
      const v = (s.answers || {})[q.id];
      if (blank(v)) continue;
      out.push([surveyDate(s), a.name || "", a.csm || "", a.tier || "", (s.template && s.template.name) || s.templateId || "", s.contactName || "", s.contactRole || "", s.source || "", q.text || q.id, answerLabel(q, v)]);
    }
  }
  return [head, ...out.map(r => r.map(csvCell).join(","))].join("\n");
}

/* accountId -> { lastSent, lastAnswered } (YYYY-MM-DD), for the account CSV. "Sent" counts only surveys the
 * app emailed (source "sent"); a manually entered answer is not a send. */
export function surveyDatesByAccount(surveys) {
  const m = new Map();
  for (const s of surveys || []) {
    if (!s || !s.accountId) continue;
    const e = m.get(s.accountId) || { lastSent: "", lastAnswered: "" };
    const sent = s.source === "sent" ? day(s.sentAt) : "", ans = day(s.submittedAt);
    if (sent > e.lastSent) e.lastSent = sent;
    if (ans > e.lastAnswered) e.lastAnswered = ans;
    m.set(s.accountId, e);
  }
  return m;
}
