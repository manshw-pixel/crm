/* Implementation projects: stage machine, sign-off, workload. Pure -- no store access.
   Dates are ISO strings compared textually (a Date round-trip shifts days across UTC). */
export const STAGES = ["handover", "queued", "planning", "in_progress", "csm_review", "live", "on_hold", "cancelled"];
export const STAGE_LABEL = { handover: "Handover", queued: "Queued", planning: "Planning", in_progress: "In progress",
  csm_review: "CSM review", live: "Live", on_hold: "On hold", cancelled: "Cancelled" };
export const OPEN_STAGES = ["queued", "planning", "in_progress", "csm_review"];

const DAY_MS = 86400000;
const DEFAULT_CAPACITY = 30;
const day = s => String(s || "").slice(0, 10);
const dayMs = s => Date.parse(day(s));

export function projectType(accountId, projects) {
  return (projects || []).some(p => p.accountId === accountId) ? "expansion" : "onboarding";
}

const isManager = actor => actor.role === "admin" || actor.role === "impl_lead";
const isImplementer = (actor, project) => !!project.implementerId && actor.id === project.implementerId;
const canWork = (actor, project) => isManager(actor) || isImplementer(actor, project);
const isCsm = (actor, account) => actor.role === "admin" || (!!account && !!account.csm && actor.name === account.csm);

function checklistFilled(project) {
  const values = project.checklist || {};
  const missing = (project.checklistTemplate || []).filter(it => {
    if (!it.required) return false;
    const v = values[it.id];
    return it.kind === "check" ? v !== true : v == null || String(v).trim() === "";
  });
  return missing;
}

// The stage a held project resumes to: the `from` of the latest history entry that moved it to on_hold.
function resumeTarget(project) {
  const h = (project.history || []).slice().reverse().find(e => e.to === "on_hold");
  return h ? h.from : null;
}

/* Can `actor` move `project` to stage `to`? `tasks` are that project's tasks; `account` ({csm}) is
   needed only for the CSM-review exits. Returns { ok, reason? }. */
export function canTransition(project, tasks, to, actor, account) {
  const no = reason => ({ ok: false, reason });
  const from = project.stage;
  tasks = tasks || [];
  if (!STAGES.includes(to)) return no("Unknown stage");
  if (from === to) return no("Already in that stage");
  if (from === "live" || from === "cancelled") return no(`A ${STAGE_LABEL[from].toLowerCase()} project cannot be moved`);

  if (to === "cancelled") return isManager(actor) ? { ok: true } : no("Only an implementation lead or admin can cancel a project");

  if (to === "on_hold") {
    if (!OPEN_STAGES.includes(from)) return no("Only an open project can be put on hold");
    return canWork(actor, project) ? { ok: true } : no("Only the implementer, a lead or an admin can put a project on hold");
  }
  if (from === "on_hold") {
    const target = resumeTarget(project);
    if (!target || to !== target) return no(target ? `Resume to ${STAGE_LABEL[target]}` : "No earlier stage to resume to");
    return canWork(actor, project) ? { ok: true } : no("Only the implementer, a lead or an admin can resume a project");
  }

  if (from === "handover" && to === "queued") {
    const missing = checklistFilled(project);
    return missing.length ? no(`Required checklist items missing: ${missing.map(m => m.label || m.id).join(", ")}`) : { ok: true };
  }
  if (from === "queued" && to === "planning") {
    if (!isManager(actor)) return no("Only an implementation lead or admin can start planning");
    return project.implementerId ? { ok: true } : no("Assign an implementer first");
  }
  if (from === "planning" && to === "in_progress") {
    if (!canWork(actor, project)) return no("Only the implementer, a lead or an admin can start work");
    return tasks.length ? { ok: true } : no("Add at least one task first");
  }
  if (from === "in_progress" && to === "csm_review") {
    if (!canWork(actor, project)) return no("Only the implementer, a lead or an admin can send for review");
    return tasks.every(t => t.status === "done") ? { ok: true } : no("Every task must be done");
  }
  if (from === "csm_review" && to === "live") {
    if (!isCsm(actor, account)) return no("Only the account CSM or an admin can sign off");
    return tasks.length && tasks.every(t => t.signoff === "signed") ? { ok: true } : no("Every task must be signed off");
  }
  if (from === "csm_review" && to === "in_progress") {
    return isCsm(actor, account) ? { ok: true } : no("Only the account CSM or an admin can send a project back");
  }
  return no(`Cannot move from ${STAGE_LABEL[from] || from} to ${STAGE_LABEL[to]}`);
}

/* CSM verdict on one task. Other tasks are untouched, so a return keeps already-signed tasks signed. */
export function applySignoff(tasks, taskId, verdict, note, actor, now) {
  if (verdict !== "signed" && verdict !== "returned") throw new Error(`applySignoff: verdict must be "signed" or "returned", got ${verdict}`);
  const out = tasks.map(t => {
    if (t.id !== taskId) return t;
    if (verdict === "returned") return { ...t, status: "todo", signoff: "returned", signoffNote: note };
    return { ...t, signoff: "signed", signedBy: actor.name, signedAt: now };
  });
  const projectStage = verdict === "returned" ? "in_progress"
    : out.length && out.every(t => t.signoff === "signed") ? "live" : "csm_review";
  return { tasks: out, projectStage };
}

export function historyEntry(from, to, actor, note, now) {
  return { at: now, by: actor.name, from, to, note };
}

export function loggedHours(task) {
  return (task.timeLog || []).reduce((s, e) => s + (Number(e.hours) || 0), 0);
}

/* Per-implementer load. Open tasks = not done, on the implementer's open projects, owned by them. */
export function workload(implementers, projects, tasks, capacityById, today) {
  const cutoff = day(new Date(dayMs(today) - 30 * DAY_MS).toISOString());
  const openProjects = new Set(projects.filter(p => OPEN_STAGES.includes(p.stage)).map(p => p.id));
  const rows = implementers.map(u => {
    const mine = tasks.filter(t => t.ownerId === u.id);
    const open = mine.filter(t => t.status !== "done" && openProjects.has(t.projectId));
    const remainingHours = open.reduce((s, t) => s + Math.max(0, (Number(t.estHours) || 0) - loggedHours(t)), 0);
    const logged30 = mine.reduce((s, t) => s + (t.timeLog || []).filter(e => day(e.at) >= cutoff && day(e.at) <= day(today))
      .reduce((a, e) => a + (Number(e.hours) || 0), 0), 0);
    const dues = open.map(t => day(t.due)).filter(Boolean).sort();
    const freeFrom = dues.length ? dues[dues.length - 1] : null;
    let loadPct = null, band = null;
    if (open.length) {
      const weeks = Math.max(1, freeFrom ? (dayMs(freeFrom) - dayMs(today)) / (7 * DAY_MS) : 1);
      const cap = (capacityById && capacityById[u.id]) || DEFAULT_CAPACITY;
      loadPct = Math.round(remainingHours / (cap * weeks) * 100);
      band = loadPct > 100 ? "red" : loadPct >= 80 ? "amber" : "green";
    }
    const active = projects.filter(p => OPEN_STAGES.includes(p.stage) && p.implementerId === u.id).length;
    return { id: u.id, name: u.name, active, remainingHours, logged30, freeFrom, loadPct, band };
  });
  // loadPct ascending, nulls first (no open work = most free)
  const key = r => r.loadPct === null ? -1 : r.loadPct;
  return rows.sort((a, b) => key(a) - key(b));
}

/* Stage on an ISO date, by replaying history. null before the first entry. */
export function stageAt(project, isoDate) {
  let stage = null;
  for (const e of project.history || []) if (day(e.at) <= day(isoDate)) stage = e.to; else break;
  return stage;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = n => String(n).padStart(2, "0");
const lastDay = (year, month1) => `${year}-${pad(month1)}-${pad(new Date(Date.UTC(year, month1, 0)).getUTCDate())}`;

/* Dashboard chart counts for a year. Active / On hold = stage at the end of each period (history
   replay); Completed = projects that went Live inside the period (flow, not a running total).
   Projects cancelled at period end are left out. `series` honours tierFilter ("All"/null = every
   tier); `byTier` always covers every tier, one array per status, so tiers can be compared. */
export function chartCounts(projects, year, mode, tierOf, tierFilter) {
  const ranges = mode === "quarter"
    ? [1, 2, 3, 4].map(q => ({ label: "Q" + q, start: `${year}-${pad(q * 3 - 2)}-01`, end: lastDay(year, q * 3) }))
    : MONTHS.map((label, i) => ({ label, start: `${year}-${pad(i + 1)}-01`, end: lastDay(year, i + 1) }));
  const blank = () => ({ active: ranges.map(() => 0), completed: ranges.map(() => 0), onHold: ranges.map(() => 0) });
  const series = blank(), byTier = {};
  const all = !tierFilter || tierFilter === "All";
  for (const p of projects || []) {
    const tier = tierOf(p.accountId) || "—";
    const bucket = byTier[tier] || (byTier[tier] = blank());
    const targets = all || tier === tierFilter ? [series, bucket] : [bucket];
    ranges.forEach((r, i) => {
      const s = stageAt(p, r.end);
      if (s === "cancelled") return;
      const wentLive = (p.history || []).some(e => e.to === "live" && day(e.at) >= r.start && day(e.at) <= r.end);
      for (const t of targets) {
        if (OPEN_STAGES.includes(s)) t.active[i]++;
        if (s === "on_hold") t.onHold[i]++;
        if (wentLive) t.completed[i]++;
      }
    });
  }
  return { periods: ranges.map(r => r.label), series, byTier };
}
