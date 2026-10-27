/* Sales-feed routing: decide what an onboarding-marked CSV row becomes. Pure -- no store access. */
import { projectType, historyEntry, checklistFilled } from "./implementation.js";
import { parseCsvDate } from "./csv.js";

const OPEN = ["queued", "planning", "in_progress", "csm_review", "on_hold", "handover"];
const YES = ["yes", "y", "true", "1", "\u2713"];

export function rowDestination(value, fallback) {
  const v = String(value == null ? "" : value).trim();
  if (!v) return fallback;
  const l = v.toLowerCase();
  return l === "onboarding" || l === "accounts" ? l : { unknown: v };
}

export function checklistFromRow(cells, template, order) {
  const out = {};
  for (const it of template || []) {
    const raw = cells && cells[it.id];
    const s = raw == null ? "" : String(raw).trim();
    if (!s) continue;
    if (it.kind === "check") out[it.id] = YES.includes(s.toLowerCase());
    else if (it.kind === "date") { const d = parseCsvDate(s, order); if (d) out[it.id] = d; }
    else out[it.id] = s;
  }
  return out;
}

export function planOnboardingRow({ accountId, cells, template, order, projects, user, now, file, newId }) {
  if (!accountId) return { kind: "skip", reason: "account not imported" };
  if ((projects || []).some(p => p.accountId === accountId && OPEN.includes(p.stage))) return { kind: "skip", reason: "open project exists" };
  const checklist = checklistFromRow(cells, template, order);
  const dateItem = template.find(it => it.kind === "date" && it.id === "go_live_target") || template.find(it => it.kind === "date");
  const project = {
    id: newId, accountId, type: projectType(accountId, projects), stage: "queued", implementerId: null, createdBy: user.name,
    checklistTemplate: template.map(it => ({ ...it })), checklist,
    targetGoLive: (dateItem && checklist[dateItem.id]) || null, startedAt: null, liveAt: null,
    history: [historyEntry("handover", "queued", user, `Imported from sales feed (${file})`, now)], holdReason: "", source: "sales-feed" };
  const missing = checklistFilled(project);
  if (!missing.length) return { kind: "queued", project };
  return { kind: "draft", project: { ...project, stage: "handover", history: [], missing: missing.map(m => m.label || m.id) } };
}
