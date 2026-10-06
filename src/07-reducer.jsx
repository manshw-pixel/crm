/* write-through: mirror a just-reduced action into Supabase */
function persist(action, next, prev) {
  const prevOf = (t, id) => ((prev && prev[t]) || []).find(x => x.id === id);
  // Write the DIFF, not the blob. Two people editing different fields of one account used
  // to revert each other with no error raised (D2); merge_row applies only what moved.
  const up = (t, item) => {
    const { patch, appends, sets } = diffRow(prevOf(t, item.id), item);
    const full = { ...patch, ...sets };
    if (!Object.keys(full).length && !Object.keys(appends).length) return;
    writeQueue.enqueue({ table: t, rowId: item.id, patch: full, appends });
  };
  switch (action.type) {
    case "ADD_ACCOUNT": { const a = next.accounts.find(x => x.id === action.item.id); return up("accounts", a || action.item); }
    case "ADD_CONTACT": return up("contacts", action.item);
    case "EDIT_CONTACT": { const c = next.contacts.find(x => x.id === action.id); return c && up("contacts", c); }
    case "DELETE_CONTACT": return writeQueue.enqueueDelete({ table: "contacts", column: "id", value: action.id });
    case "ADD_OPP": return up("opportunities", action.item);
    case "ADD_ACTIVITY": {
      if (action.item.type === "QBR") { const a = next.accounts.find(x => x.id === action.item.accountId); if (a && QBR_FREQ_MONTHS[a.qbrFrequency]) up("accounts", a); }
      return up("activities", action.item);
    }
    case "ADD_TASK": return up("tasks", action.item);
    case "SEED_PLAYBOOK": { action.items.forEach(t => up("tasks", t)); const a = next.accounts.find(x => x.id === action.id); return a && up("accounts", a); }
    case "SEED_HEALTH_PLAYBOOK": { action.items.forEach(t => up("tasks", t)); const a = next.accounts.find(x => x.id === action.id); return a && up("accounts", a); }
    case "TOGGLE_TASK": case "EDIT_TASK": { const t = next.tasks.find(x => x.id === action.id); return t && up("tasks", t); }
    case "EDIT_ACTIVITY": { const x = next.activities.find(v => v.id === action.id); return x && up("activities", x); }
    case "UPDATE_INPUTS": case "EDIT_ACCOUNT": case "COMPLETE_RENEWAL": case "CHURN_ACCOUNT": case "REACTIVATE_ACCOUNT": case "ADJUST_ARR": case "ADD_DOCUMENT": case "EDIT_DOCUMENT": case "DELETE_DOCUMENT": { const a = next.accounts.find(x => x.id === action.id); return a && up("accounts", a); }
    case "BULK_PATCH_ACCOUNTS": {
      const ids = new Set(action.ids);
      next.accounts.filter(a => ids.has(a.id)).forEach(a => up("accounts", a));
      return;
    }
    case "BULK_ADD_TASKS": {
      // mirror the reducer's existence filter by writing only the items it kept,
      // so a dropped orphan never reaches the database either
      const kept = new Set(next.tasks.map(t => t.id));
      return action.items.filter(t => kept.has(t.id)).forEach(t => up("tasks", t));
    }
    case "BULK_DELETE_TASKS":
      return action.ids.forEach(id => writeQueue.enqueueDelete({ table: "tasks", column: "id", value: id }));
    case "BULK_CHURN": {
      const ids = new Set(action.ids);
      next.accounts.filter(a => ids.has(a.id)).forEach(a => up("accounts", a));
      // write only the activities the reducer kept, as BULK_ADD_TASKS does
      const kept = new Set(next.activities.map(v => v.id));
      (action.activities || []).filter(v => kept.has(v.id)).forEach(v => up("activities", v));
      return;
    }
    case "BULK_DELETE_ACTIVITIES":
      return action.ids.forEach(id => writeQueue.enqueueDelete({ table: "activities", column: "id", value: id }));
    case "BULK_DELETE":
      action.ids.forEach(id => {
        writeQueue.enqueueDelete({ table: "accounts", column: "id", value: id });
        ["contacts", "activities", "tasks", "opportunities"].forEach(t =>
          writeQueue.enqueueDelete({ table: t, column: "data->>accountId", value: id }));
      });
      next.accounts.filter(a => a._orphaned).forEach(a => { delete a._orphaned; up("accounts", a); });
      return;
    case "RESTORE_SNAPSHOT": {
      const s = action.snapshot;
      s.accounts.forEach(a => up("accounts", a));
      ["contacts", "activities", "tasks", "opportunities"].forEach(t => s[t].forEach(r => up(t, r)));
      return;
    }
    case "SET_OPP_STAGE": { const o = next.opportunities.find(x => x.id === action.id); return o && up("opportunities", o); }
    case "DELETE_ACCOUNT":
      writeQueue.enqueueDelete({ table: "accounts", column: "id", value: action.id });
      ["contacts", "activities", "tasks", "opportunities"].forEach(t =>
        writeQueue.enqueueDelete({ table: t, column: "data->>accountId", value: action.id }));
      // orphaned subs (parent just deleted) need their cleared parentId written back
      next.accounts.filter(a => a._orphaned).forEach(a => { delete a._orphaned; up("accounts", a); });
      return;
    case "SET_WEIGHTS": case "SET_RECENCY_MIX": case "SET_VALUE_MIX": case "SET_RATES": case "SET_INTEGRATIONS": case "SET_SNAPSHOTS":
    case "SET_PLAYBOOK": case "SET_HEALTH_PLAYBOOK": case "SET_SEGMENTS": {
      const { patch, appends, sets } = diffRow(prev && prev.settings, next.settings);
      return writeQueue.enqueue({ table: "settings", rowId: "1", patch: { ...patch, ...sets }, appends });
    }
  }
}

/* bulk replace (sample data / clear / JSON import) — admin only, RLS enforced.
   One RPC, therefore one transaction: the deletes and inserts commit together or not at
   all. This previously deleted all five tables client-side and only then inserted, so any
   failure in between emptied the team's database with no backup. */
async function replaceAllRemote(state) {
  const payload = { settings: state.settings };
  for (const t of ENTITY_TABLES) {
    // Deliberately NOT `state[t] || []`. The old client threw a TypeError here on a
    // malformed import, which surfaced as a visible "Import failed" toast; defaulting to
    // an empty array instead would silently EMPTY that table on an irreversible operation.
    if (!Array.isArray(state[t])) throw new Error(`${t} is missing from the imported data`);
    payload[t] = state[t];
  }
  const { error } = await sb.rpc("replace_all", { payload });
  if (error) throw error;
}
function reducer(state, action) {
  switch (action.type) {
    case "REPLACE": return action.state;
    case "ADD_ACCOUNT": { const item = action.item.accountNo ? action.item
      : { ...action.item, accountNo: state.accounts.reduce((m, a) => Math.max(m, +a.accountNo || 0), 0) + 1 };
      return { ...state, accounts: [...state.accounts, item] }; }
    case "EDIT_ACCOUNT": return { ...state, accounts: state.accounts.map(a => {
      if (a.id !== action.id) return a;
      const entries = auditChanges(a, action.patch, action.by, action.source);
      let upd = withAudit({ ...a, ...action.patch }, entries);
      const arrCh = entries.find(x => x.field === "arr");
      const curCh = entries.find(x => x.field === "currency");
      const evSource = action.source === "csv import" ? "import" : "edit";
      // Changing the billing currency RESTATES the same revenue in another unit — it is not
      // expansion or contraction, and `to - from` across two currencies is not a number that
      // means anything (INR 1,000,000 -> USD 12,000 used to book a 988,000 "contraction").
      // Recorded rather than suppressed, for two reasons: the ARR audit trail exists so that
      // changes are not invisible, and a currency-only change still moves arrUSD — and with
      // it retARR and the NRR/GRR base — by the whole FX factor, which previously happened
      // with no event at all.
      if (curCh) upd = { ...upd, arrEvents: [...(a.arrEvents || []), { id: uid(), date: iso(Date.now()),
        kind: "redenomination", delta: 0, currency: curCh.to,
        fromCurrency: curCh.from, toCurrency: curCh.to,
        fromArr: arrCh ? arrCh.from : (+a.arr || 0), toArr: arrCh ? arrCh.to : (+a.arr || 0),
        source: evSource, reason: "Billing currency changed", note: "", by: curCh.by }] };
      // `a` is pre-patch, so a.currency is the one arrCh.from was denominated in.
      else if (arrCh) upd = { ...upd, arrEvents: [...(a.arrEvents || []), { id: uid(), date: iso(Date.now()), currency: a.currency,
        delta: arrCh.to - arrCh.from, kind: arrCh.to > arrCh.from ? "expansion" : "contraction",
        source: evSource, reason: "ARR edited", note: "", by: arrCh.by }] };
      return upd;
    }) };
    case "COMPLETE_RENEWAL": return { ...state, accounts: state.accounts.map(a => a.id === action.id
      // stamp the billing currency onto the entry: analytics convert historical money at
      // the currency it was BOOKED in, not at whatever the account is billed in today.
      // Stamped here rather than at each dispatch site so every caller is covered.
      ? withAudit({ ...a, renewalDate: action.newDate, arr: action.newArr, contractStatus: "Active", billingCompleted: false, billingCompletedDate: null, renewalStage: "Not started", renewals: [...(a.renewals || []), { ...action.entry, currency: action.entry.currency ?? a.currency }] },
          [ ...((+a.arr || 0) !== (+action.newArr || 0) ? [{ id: uid(), date: iso(Date.now()), field: "arr", from: +a.arr || 0, to: +action.newArr || 0, by: action.entry.by, source: "renewal" }] : []),
            ...(a.renewalDate !== action.newDate ? [{ id: uid(), date: iso(Date.now()), field: "renewalDate", from: a.renewalDate, to: action.newDate, by: action.entry.by, source: "renewal" }] : []) ])
      : a) };
    case "CHURN_ACCOUNT": return { ...state, accounts: state.accounts.map(a => a.id === action.id
      ? withAudit({ ...a, contractStatus: "Churned", churn: action.entry },
          [{ id: uid(), date: iso(Date.now()), field: "contractStatus", from: a.contractStatus, to: "Churned", by: action.entry.by, source: "churn" }]) : a) };
    case "REACTIVATE_ACCOUNT": return { ...state, accounts: state.accounts.map(a => a.id === action.id
      ? withAudit({ ...a, contractStatus: "Active", churn: null },
          [{ id: uid(), date: iso(Date.now()), field: "contractStatus", from: a.contractStatus, to: "Active", by: action.by || "unknown", source: "reactivate" }]) : a) };
    case "ADJUST_ARR": return { ...state, accounts: state.accounts.map(a => a.id === action.id
      // same currency stamp as COMPLETE_RENEWAL — covers the adjust form, opportunity-won,
      // and any future dispatcher without touching their call sites
      ? withAudit({ ...a, arr: action.newArr, arrEvents: [...(a.arrEvents || []), { ...action.entry, currency: action.entry.currency ?? a.currency }] },
          [{ id: uid(), date: iso(Date.now()), field: "arr", from: +a.arr || 0, to: +action.newArr || 0, by: action.entry.by, source: action.entry.source === "opportunity" ? "opportunity" : "adjustment" }]) : a) };
    case "ADD_DOCUMENT": return { ...state, accounts: state.accounts.map(a => {
      if (a.id !== action.id) return a;
      const label = `${action.doc.category}: ${action.doc.title || action.doc.name}`;
      return withAudit({ ...a, documents: [...(a.documents || []), action.doc] },
        [{ id: uid(), date: iso(Date.now()), field: "document", from: "", to: label, by: action.by || "unknown", source: action.source || "upload" }]);
    }) };
    case "EDIT_DOCUMENT": return { ...state, accounts: state.accounts.map(a => {
      if (a.id !== action.id) return a;
      const doc = (a.documents || []).find(d => d.id === action.docId);
      if (!doc) return a;
      const updated = { ...doc, ...action.patch };
      const from = `${doc.category}: ${doc.title || doc.name}`;
      const to = `${updated.category}: ${updated.title || updated.name}`;
      return withAudit({ ...a, documents: (a.documents || []).map(d => d.id === action.docId ? updated : d) },
        [{ id: uid(), date: iso(Date.now()), field: "document", from, to, by: action.by || "unknown", source: action.source || "edit" }]);
    }) };
    case "DELETE_DOCUMENT": return { ...state, accounts: state.accounts.map(a => {
      if (a.id !== action.id) return a;
      const doc = (a.documents || []).find(d => d.id === action.docId);
      if (!doc) return a;
      const label = `${doc.category}: ${doc.title || doc.name}`;
      return withAudit({ ...a, documents: (a.documents || []).filter(d => d.id !== action.docId) },
        [{ id: uid(), date: iso(Date.now()), field: "document", from: label, to: "", by: action.by || "unknown", source: action.source || "delete" }]);
    }) };
    case "SET_OPP_STAGE": return { ...state, opportunities: state.opportunities.map(o => o.id === action.id ? { ...o, stage: action.stage } : o) };
    case "DELETE_ACCOUNT": return { ...state,
      // _orphaned marks subs whose parent was just deleted so persist() can write them back
      accounts: state.accounts.filter(a => a.id !== action.id).map(a => a.parentId === action.id ? { ...a, parentId: null, _orphaned: true } : a),
      contacts: state.contacts.filter(c => c.accountId !== action.id),
      activities: state.activities.filter(x => x.accountId !== action.id),
      tasks: state.tasks.filter(t => t.accountId !== action.id),
      opportunities: state.opportunities.filter(o => o.accountId !== action.id) };
    case "ADD_CONTACT": return { ...state, contacts: [...state.contacts, action.item] };
    case "EDIT_CONTACT": return { ...state, contacts: state.contacts.map(c => c.id === action.id ? { ...c, ...action.patch } : c) };
    case "DELETE_CONTACT": return { ...state, contacts: state.contacts.filter(c => c.id !== action.id) };
    case "ADD_OPP": return { ...state, opportunities: [...state.opportunities, action.item] };
    case "ADD_ACTIVITY": {
      let accounts = state.accounts;
      if (action.item.type === "QBR") { // logging a QBR schedules the next one per the account's cadence
        accounts = accounts.map(a => {
          if (a.id !== action.item.accountId) return a;
          const m = QBR_FREQ_MONTHS[a.qbrFrequency];
          return m ? { ...a, nextQbrDate: addMonths(action.item.date, m) } : a;
        });
      }
      return { ...state, accounts, activities: [...state.activities, action.item] };
    }
    case "EDIT_ACTIVITY": return { ...state, activities: state.activities.map(x => x.id === action.id ? { ...x, ...action.patch } : x) };
    case "ADD_TASK": return { ...state, tasks: [...state.tasks, action.item] };
    case "EDIT_TASK": return { ...state, tasks: state.tasks.map(t => t.id === action.id ? { ...t, ...action.patch } : t) };
    case "TOGGLE_TASK": return { ...state, tasks: state.tasks.map(t => t.id === action.id ? { ...t, status: t.status === "Done" ? "Open" : "Done" } : t) };
    case "UPDATE_INPUTS": {
      return { ...state, accounts: state.accounts.map(a => {
        if (a.id !== action.id) return a;
        const upd = { ...a, inputs: { ...a.inputs, ...clampInputs(action.inputs) }, inputsUpdatedAt: iso(Date.now()) };
        const s = healthScore(upd, state.activities, state.settings.weights, state.settings);
        return { ...upd, history: [...(a.history || []), { d: iso(Date.now()), s }] };
      }) };
    }
    case "BULK_PATCH_ACCOUNTS": {
      const ids = new Set(action.ids);
      return { ...state, accounts: state.accounts.map(a => {
        if (!ids.has(a.id)) return a;
        // one audit entry per genuinely-changed field, matching EDIT_ACCOUNT's shape
        const entries = Object.entries(action.patch)
          .filter(([f, v]) => a[f] !== v)
          .map(([f, v]) => ({ id: uid(), date: iso(Date.now()), field: f, from: a[f], to: v, by: action.by, source: "bulk" }));
        return withAudit({ ...a, ...action.patch }, entries);
      }) };
    }
    case "BULK_ADD_TASKS": {
      // ids can go stale between the dialog opening and this dispatch landing. The
      // reducer is the only layer that sees authoritative state -- a caller reading
      // window.__store sees the last committed render, not a dispatch still in flight
      // -- so drop items whose account is gone rather than fabricating orphan tasks.
      const live = new Set(state.accounts.map(a => a.id));
      return { ...state, tasks: [...state.tasks, ...action.items.filter(t => live.has(t.accountId))] };
    }
    case "BULK_DELETE_TASKS": { const ids = new Set(action.ids); return { ...state, tasks: state.tasks.filter(t => !ids.has(t.id)) }; }
    case "BULK_CHURN": {
      const ids = new Set(action.ids);
      const live = new Set(state.accounts.map(a => a.id));
      // ChurnForm dispatches ADD_ACTIVITY alongside CHURN_ACCOUNT, so a single churn
      // lands on the account timeline. Carrying the activities here keeps bulk churn's
      // timeline identical instead of leaving a gap. Filtered like BULK_ADD_TASKS so a
      // stale id cannot fabricate an activity against an account that is gone.
      const acts = (action.activities || []).filter(v => live.has(v.accountId));
      return { ...state,
        activities: acts.length ? [...state.activities, ...acts] : state.activities,
        accounts: state.accounts.map(a => ids.has(a.id)
        ? withAudit({ ...a, contractStatus: "Churned",
            churn: { date: action.date, reason: action.reason, note: action.note || "", arr: a.arr, currency: a.currency, by: action.by } },
            [{ id: uid(), date: iso(Date.now()), field: "contractStatus", from: a.contractStatus, to: "Churned", by: action.by, source: "churn" }])
        : a) };
    }
    case "BULK_DELETE_ACTIVITIES": { const ids = new Set(action.ids); return { ...state, activities: state.activities.filter(v => !ids.has(v.id)) }; }
    case "BULK_DELETE": {
      const ids = new Set(action.ids);
      const gone = r => ids.has(r.accountId);
      return { ...state,
        // _orphaned marks subs whose parent was just deleted so persist() writes them back
        accounts: state.accounts.filter(a => !ids.has(a.id))
          .map(a => (a.parentId && ids.has(a.parentId)) ? { ...a, parentId: null, _orphaned: true } : a),
        contacts: state.contacts.filter(r => !gone(r)),
        activities: state.activities.filter(r => !gone(r)),
        tasks: state.tasks.filter(r => !gone(r)),
        opportunities: state.opportunities.filter(r => !gone(r)) };
    }
    case "RESTORE_SNAPSHOT": {
      const merge = (cur, saved) => {
        const byId = new Map(saved.map(r => [r.id, r]));
        const kept = cur.map(r => byId.has(r.id) ? byId.get(r.id) : r);
        const present = new Set(cur.map(r => r.id));
        return [...kept, ...saved.filter(r => !present.has(r.id))];
      };
      const s = action.snapshot;
      return { ...state,
        accounts: merge(state.accounts, s.accounts),
        contacts: merge(state.contacts, s.contacts),
        activities: merge(state.activities, s.activities),
        tasks: merge(state.tasks, s.tasks),
        opportunities: merge(state.opportunities, s.opportunities) };
    }
    case "SET_WEIGHTS": return { ...state, settings: { ...state.settings, weights: action.weights } };
    case "SET_RECENCY_MIX": return { ...state, settings: { ...state.settings, recencyMix: action.mix } };
    case "SET_VALUE_MIX": return { ...state, settings: { ...state.settings, valueMix: action.mix } };
    case "SET_RATES": return { ...state, settings: { ...state.settings, rates: action.rates } };
    case "SET_INTEGRATIONS": return { ...state, settings: { ...state.settings, integrations: action.integrations } };
    case "SET_SNAPSHOTS": return { ...state, settings: { ...state.settings, snapshots: action.snapshots } };
    case "SET_PLAYBOOK": return { ...state, settings: { ...state.settings, playbook: action.playbook } };
    case "SET_SEGMENTS": return { ...state, settings: { ...state.settings, segments: action.segments } };
    case "SEED_PLAYBOOK": return { ...state,
      tasks: [...state.tasks, ...action.items],
      accounts: state.accounts.map(a => a.id === action.id ? { ...a, playbookSeededFor: action.seededFor } : a) };
    case "SET_HEALTH_PLAYBOOK": return { ...state, settings: { ...state.settings, healthPlaybook: action.healthPlaybook } };
    case "SEED_HEALTH_PLAYBOOK": return { ...state,
      tasks: [...state.tasks, ...action.items],
      accounts: state.accounts.map(a => a.id === action.id
        ? { ...a, healthBand: action.healthBand, healthPlaybookBand: action.healthPlaybookBand,
            healthEvents: action.event ? [...(a.healthEvents || []), action.event] : (a.healthEvents || []) }
        : a) };
    default: return state;
  }
}

