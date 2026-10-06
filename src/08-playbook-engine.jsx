/* --------------------------- renewal playbook --------------------------- */
/* Shared checklist template; offsetDays = days before the renewal date the task is due.
 * settings.playbook stays unset until first edited in Settings — the default applies meanwhile. */
const DEFAULT_PLAYBOOK = [
  { id: "pb90", title: "Renewal kickoff call", offsetDays: 90, priority: "High" },
  { id: "pb75", title: "Health & usage review", offsetDays: 75, priority: "Medium" },
  { id: "pb60", title: "Send renewal quote", offsetDays: 60, priority: "High" },
  { id: "pb45", title: "Negotiate terms", offsetDays: 45, priority: "High" },
  { id: "pb30", title: "Confirm commercials", offsetDays: 30, priority: "High" },
  { id: "pb14", title: "Contract out for signature", offsetDays: 14, priority: "High" },
  { id: "pb7", title: "Confirm signature & billing", offsetDays: 7, priority: "High" },
];
const playbookOf = settings => settings.playbook || DEFAULT_PLAYBOOK;

const BAND_RANK = { Green: 0, Yellow: 1, Red: 2 };
const DEFAULT_HEALTH_PLAYBOOK = {
  Yellow: [
    { id: "hy1", title: "Schedule check-in call with account", dueDays: 3, priority: "Medium" },
    { id: "hy2", title: "Review usage & recent activity for decline drivers", dueDays: 5, priority: "Medium" },
    { id: "hy3", title: "Confirm champion still engaged", dueDays: 7, priority: "Low" },
  ],
  Red: [
    { id: "hr1", title: "Escalate to CSM lead / exec sponsor", dueDays: 1, priority: "High" },
    { id: "hr2", title: "Book save/recovery call with decision maker", dueDays: 2, priority: "High" },
    { id: "hr3", title: "Draft recovery plan & risk summary", dueDays: 5, priority: "High" },
  ],
};
const healthPlaybookOf = settings => settings.healthPlaybook || DEFAULT_HEALTH_PLAYBOOK;
/* Accounts eligible for the one-time playbook backfill: every live at-risk account.
 * Re-seeds accounts that already have a playbook (deliberate — see the 2026-08-11 spec). */
const backfillCandidates = scored => scored.filter(a => !a.churn && (a.risk === "Yellow" || a.risk === "Red"));

/* ------------------------------ task queue ------------------------------ */
const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };
/* Buckets tasks for the work queue. `today` is an ISO YYYY-MM-DD string; comparing two
 * UTC-midnight timestamps keeps this deterministic (daysUntil compares against Date.now(),
 * which makes results depend on the time of day the suite happens to run). */
const bucketTasks = (tasks, today) => {
  const out = { overdue: [], today: [], week: [], later: [], done: [] };
  const t0 = new Date(today).getTime();
  tasks.forEach(t => {
    if (t.status === "Done") { out.done.push(t); return; }
    if (!t.due) { out.later.push(t); return; }        // guards imported/hand-edited rows
    const d = Math.round((new Date(t.due).getTime() - t0) / DAY);
    if (d < 0) out.overdue.push(t);
    else if (d === 0) out.today.push(t);
    else if (d <= 7) out.week.push(t);
    else out.later.push(t);
  });
  const cmp = (a, b) => (a.due || "9999-99-99").localeCompare(b.due || "9999-99-99")
    || (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
  Object.keys(out).forEach(k => out[k].sort(cmp));
  return out;
};
/* Source of a task: the two seeders tag their own rows, anything untagged is hand-created. */
const taskSource = t => (t.healthPlaybook ? "health" : t.playbook ? "renewal" : "manual");
/* accountsById maps account id -> scored account (carries `risk` and `name`). */
const filterTasks = (tasks, accountsById, { scope = "all", userName = "", source = "all", band = "all", q = "" } = {}) =>
  tasks.filter(t => {
    if (scope === "mine" && t.owner !== userName) return false;
    if (source !== "all" && taskSource(t) !== source) return false;
    const a = accountsById[t.accountId];
    if (band !== "all" && (!a || a.risk !== band)) return false;
    if (q.trim()) {
      const hay = `${t.title || ""} ${a ? a.name : ""}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

