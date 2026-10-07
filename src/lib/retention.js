import { DAY, iso } from "./dates.js";
import { toUSD } from "./money.js";
/* trailing-12-month revenue retention (USD) from churn events, renewal deltas and ARR events */
export function retentionStats(accounts, rates) {
  const yearAgo = Date.now() - 365 * DAY;
  const moves = list => {
    let churnedARR = 0, expansion = 0, contraction = 0;
    list.forEach(a => {
      if (a.churn && new Date(a.churn.date).getTime() >= yearAgo) churnedARR += toUSD(a.churn.arr, a.churn.currency || a.currency, rates);
      (a.renewals || []).forEach(r => {
        if (new Date(r.completedOn).getTime() >= yearAgo) {
          const d = toUSD(r.arr - r.prevArr, r.currency || a.currency, rates);
          if (d >= 0) expansion += d; else contraction -= d;
        }
      });
      (a.arrEvents || []).forEach(ev => { // won opportunities + manual ARR adjustments
        // a currency restatement is not revenue movement. Skipped explicitly rather than
        // relying on its delta being 0, so the intent is legible and a future non-zero
        // delta cannot leak into NRR.
        if (ev.kind === "redenomination") return;
        if (new Date(ev.date).getTime() >= yearAgo) {
          const d = toUSD(ev.delta, ev.currency || a.currency, rates);
          if (d >= 0) expansion += d; else contraction -= d;
        }
      });
    });
    return { churnedARR, expansion, contraction };
  };
  // The displayed totals cover every account. The RATIOS cover only the book that existed a
  // year ago: a logo signed inside the window has no opening ARR, and counting it in both
  // base and retained ARR pulled NRR/GRR toward 100% (new business masking churn). Same
  // rule as accountRetention's isNew. No startDate -> assume it predates the window.
  const totals = moves(accounts);
  const cohort = accounts.filter(a => !(a.startDate && new Date(a.startDate).getTime() > yearAgo));
  const c = moves(cohort);
  const retARR = cohort.reduce((s, a) => s + (a.churn ? 0 : a.arrUSD), 0);
  const base = retARR + c.churnedARR - c.expansion + c.contraction;
  return { ...totals,
    grr: base > 0 ? (base - c.churnedARR - c.contraction) / base : null,
    nrr: base > 0 ? (base - c.churnedARR - c.contraction + c.expansion) / base : null,
    lost: accounts.filter(a => a.churn && new Date(a.churn.date).getTime() >= yearAgo).length };
}

/* ------------------------- point-in-time ARR ------------------------- */
// The last 31 December that has actually finished. December itself counts as complete
// on the 31st. Rolling by design: this reads Dec'25 through 2026 and Dec'26 from 2027,
// so the comparison never silently decays into an irrelevant baseline.
export function lastCompletedDecember(now = iso(Date.now())) {
  const [y, m, d] = String(now).slice(0, 10).split("-").map(Number);
  const year = (m === 12 && d === 31) ? y : y - 1;
  return `${year}-12-31`;
}

// An account's ARR (USD) as at `isoDate`, reconstructed by undoing every movement dated
// after it. There is no stored per-account history -- snapshots are aggregate-only -- so
// this replays the ledger rather than reading a value.
//
// Both sides convert at TODAY's rates, deliberately: the delta should show revenue
// movement, not FX drift. An EUR account whose local ARR never moved must read as flat.
export function arrAsOf(account, isoDate, rates) {
  const cut = String(isoDate).slice(0, 10);
  const after = when => String(when || "").slice(0, 10) > cut;
  // Already churned AT the baseline: it carried no ARR then, so the baseline is zero.
  // Falling through to account.arr here would read the pre-churn figure -- CHURN_ACCOUNT
  // leaves `arr` untouched and writes no arrEvent -- and report a churn that happened
  // BEFORE the baseline as movement since it.
  if (account.churn && !after(account.churn.date)) return 0;
  // Churned after the baseline: the account still held its pre-churn ARR back then.
  let arr = account.churn
    ? toUSD(account.churn.arr, account.churn.currency || account.currency, rates)
    : toUSD(account.arr, account.currency, rates);

  (account.renewals || []).forEach(r => {
    if (!after(r.completedOn)) return;
    arr -= toUSD(r.arr - r.prevArr, r.currency || account.currency, rates);
  });
  (account.arrEvents || []).forEach(ev => {
    // A currency restatement is not revenue movement. Skipped explicitly rather than
    // relying on its delta being 0, matching retentionStats.
    if (ev.kind === "redenomination") return;
    if (!after(ev.date)) return;
    arr -= toUSD(ev.delta, ev.currency || account.currency, rates);
  });
  return Math.round(arr);
}

// Per-account retention. NRR and GRR are delegated to retentionStats with a
// single-account array, so there is exactly ONE retention formula in this codebase and
// the account column agrees with the Analytics headline by construction rather than by
// coincidence. A test ties the two together; if it ever fails, this delegation broke.
//
// An account that started after the baseline has no prior close, so a percentage would be
// meaningless: it is flagged `isNew` and left out of the maths. New logos belong to new
// business, not to retention.
export function accountRetention(account, rates, now = iso(Date.now())) {
  const baselineDate = lastCompletedDecember(now);
  const baselineKey = `Dec'${baselineDate.slice(2, 4)}`;
  const isNew = String(account.startDate || "").slice(0, 10) > baselineDate;
  // A churned account carries no ARR today -- `arr` still holds its pre-churn value,
  // since CHURN_ACCOUNT leaves that field alone.
  const currentARR = Math.round(toUSD(account.churn ? 0 : account.arr, account.currency, rates));
  if (isNew) {
    return { nrr: null, grr: null, baselineARR: null, currentARR, delta: null, pct: null, isNew: true, baselineKey };
  }
  const baselineARR = arrAsOf(account, baselineDate, rates);
  const { nrr, grr } = retentionStats([account], rates);
  const delta = currentARR - baselineARR;
  return { nrr, grr, baselineARR, currentARR, delta,
    pct: baselineARR > 0 ? (delta / baselineARR) * 100 : null,
    isNew: false, baselineKey };
}

/* --------------------------- AM book by handover --------------------------- */
// The AM book split by when each account was handed over from sales, with this year's
// ARR movement per cohort. Cohorts come from `transitionDate`; the money is the SAME
// ledger replay arrAsOf performs, so this card and Analytics cannot drift apart.
//
// The year opens at the prior 31 December close, so `opening` here is the balance on
// 1 January and a movement "in the year" is anything dated after that close. Both
// cohorts share that baseline, which is what lets their openings be added together.
export function amBookMovement(accounts, rates, now = iso(Date.now())) {
  const today = String(now).slice(0, 10);
  const priorClose = `${+today.slice(0, 4) - 1}-12-31`;
  const inYear = when => { const d = String(when || "").slice(0, 10); return d > priorClose && d <= today; };

  const movementOf = a => {
    let expansion = 0, reduction = 0;
    const add = usd => { if (usd > 0) expansion += usd; else reduction -= usd; };
    (a.renewals || []).forEach(r => {
      if (inYear(r.completedOn)) add(toUSD(r.arr - r.prevArr, r.currency || a.currency, rates));
    });
    (a.arrEvents || []).forEach(ev => {
      // A currency restatement is not revenue movement -- skipped explicitly rather than
      // relying on its delta being 0, matching arrAsOf and retentionStats.
      if (ev.kind === "redenomination") return;
      if (inYear(ev.date)) add(toUSD(ev.delta, ev.currency || a.currency, rates));
    });
    // CHURN_ACCOUNT writes no arrEvent and leaves `arr` alone, so the loss has to be
    // booked here or the cohort would never show the revenue leaving.
    if (a.churn && inYear(a.churn.date)) {
      add(-toUSD(a.churn.arr, a.churn.currency || a.currency, rates));
    }
    return { expansion: Math.round(expansion), reduction: Math.round(reduction) };
  };

  const rowOf = a => {
    const opening = arrAsOf(a, priorClose, rates);
    const current = Math.round(toUSD(a.churn ? 0 : a.arr, a.currency, rates));
    return { id: a.id, name: a.name, transitionDate: a.transitionDate || null,
      opening, current, ...movementOf(a) };
  };

  const sectionOf = rows => ({
    accounts: rows,
    totals: rows.reduce((t, r) => ({
      count: t.count + 1, opening: t.opening + r.opening, expansion: t.expansion + r.expansion,
      reduction: t.reduction + r.reduction, current: t.current + r.current,
    }), { count: 0, opening: 0, expansion: 0, reduction: 0, current: 0 }),
  });

  const owned = [], moved = [], scheduled = [];
  accounts.forEach(a => {
    const t = String(a.transitionDate || "").slice(0, 10);
    // No date, or a handover still in the future: not AM's book yet. A churned account is
    // never going to be handed over, so it is left out of the pending list entirely.
    if (!t || t > today) { if (!a.churn) scheduled.push(rowOf(a)); return; }
    (t <= priorClose ? owned : moved).push(rowOf(a));
  });
  const byARR = (x, y) => y.current - x.current;
  return { year: +today.slice(0, 4), priorClose,
    owned: sectionOf(owned.sort(byARR)),
    moved: sectionOf(moved.sort(byARR)),
    scheduled: sectionOf(scheduled.sort(byARR)) };
}

