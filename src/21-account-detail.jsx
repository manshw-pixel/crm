/* ------------------------------ Account detail ------------------------------ */
const AUDIT_FIELD_LABEL = { arr: "ARR", renewalDate: "Renewal date", csm: "CSM", tier: "Tier", contractStatus: "Contract status", renewalStage: "Renewal stage", document: "Document" };
function ChangeHistoryCard({ a }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const entries = [...(a.audit || [])].sort((x, y) => y.date.localeCompare(x.date) || (y.id > x.id ? 1 : -1));
  const shown = showAll ? entries : entries.slice(0, 50);
  const fmtVal = (f, v) => f === "arr" ? fmtMoney(+v || 0, a.currency) : f === "renewalDate" ? fmtDate(v) : (v === "" || v == null ? "—" : String(v));
  return (
    <Card title={`Change history (${entries.length})`}>
      <button className="mb-1 text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setOpen(o => !o)}>{open ? "Hide" : "Show"}</button>
      {open && <>
        {shown.map(e => (
          <div key={e.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-1 text-xs last:border-0">
            <span className="text-slate-500">{fmtDate(e.date)}</span>
            <span className="font-semibold text-slate-800">{AUDIT_FIELD_LABEL[e.field] || e.field}:</span>
            <span className="text-slate-700">{fmtVal(e.field, e.from)} → <b>{fmtVal(e.field, e.to)}</b></span>
            <span className="ml-auto text-slate-500">by {e.by} · {e.source}</span>
          </div>
        ))}
        {!showAll && entries.length > 50 && <button className="mt-1 text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setShowAll(true)}>Show all ({entries.length})</button>}
      </>}
    </Card>
  );
}
const Meta = ({ label, value }) => (value === "" || value == null) ? null : (
  <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
    <span className="text-sm font-semibold text-slate-700">{value}</span>
  </span>
);
function AccountDetail({ st, scored, id, dispatch, back, user, team, openAccount, initialForm, clearInitialForm, openProject }) {
  const toast = useToast();
  const a = scored.find(x => x.id === id);
  const subs = scored.filter(x => x.parentId === id);
  const parent = a && a.parentId ? scored.find(x => x.id === a.parentId) : null;
  const [handoverOpen, setHandoverOpen] = useState(false);
  const shownId = useRef(id); shownId.current = id; // the toast action can outlive this account's page
  const ro = isImplRole(user); // implementation roles: read-only on CRM data (RLS enforces it; the UI hides the controls)
  const [form, setForm] = useState(null);
  const [tab, setTab] = useState("overview");
  useEffect(() => { setTab("overview"); setHandoverOpen(false); }, [id]);
  const [confirmOpp, setConfirmOpp] = useState(null); // { kind: "won" | "stage", opp, run }
  const [confirmContact, setConfirmContact] = useState(null); // the contact pending deletion
  useEffect(() => { if (initialForm && !ro) { setForm(initialForm); clearInitialForm && clearInitialForm(); } }, [initialForm]);
  useEffect(() => { const h = e => e.key === "Escape" && setForm(null); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);
  if (!a) return null;
  const acts = st.activities.filter(x => x.accountId === id).sort((x, y) => y.date.localeCompare(x.date));
  const tasks = st.tasks.filter(t => t.accountId === id && t.status !== "Done");
  const contacts = st.contacts.filter(c => c.accountId === id);
  const opps = st.opportunities.filter(o => o.accountId === id);
  const d = daysUntil(a.renewalDate);
  // health playbook progress: tasks from the latest crossing (episode), done vs total
  const healthAll = st.tasks.filter(t => t.accountId === id && t.healthPlaybook);
  const hLatest = healthAll.reduce((m, t) => (t.healthFor > m ? t.healthFor : m), "");
  const hEpisode = healthAll.filter(t => t.healthFor === hLatest);
  const hDone = hEpisode.filter(t => t.status === "Done").length;
  const hBehind = hEpisode.some(t => t.status !== "Done" && t.due < iso(Date.now())); // textual ISO compare
  const comps = scoreComponents(a, st.activities, st.settings);
  return (
    <div className="space-y-4">
      {/* Title row: back, identity, health, main actions. Everything else lives in the header card. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button onClick={back} className="text-sm font-semibold text-slate-500 hover:text-slate-800">← Back</button>
        <h2 className="text-xl font-bold text-slate-900">{a.name}</h2>
        <span className="text-xs font-semibold text-slate-400">#{subNumbers(scored).get(a.id) || a.accountNo || "—"}</span>
        <HealthChip score={a.score} /><Chip risk={a.risk}>{a.risk}</Chip>
        {!ro && <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Btn kind="primary" onClick={() => setForm("activity")}>+ Log activity</Btn>
          <Btn onClick={() => setForm("task")}>+ Add task</Btn>
          <Btn onClick={() => setForm("health")}>✎ Update health</Btn>
          {!a.churn && <Btn onClick={() => setForm("renewal")}>✓ Complete renewal</Btn>}
          <Btn onClick={() => setForm("edit")}>✎ Edit account</Btn>
          {a.churn && <button className="nm-btn px-3 py-1.5 text-xs font-bold text-emerald-600"
            onClick={() => {
              // Reversible in one dispatch, so no dialog: act, then offer Undo.
              const prev = a.churn;
              dispatch({ type: "REACTIVATE_ACCOUNT", id: a.id, by: user.name });
              dispatch({ type: "ADD_ACTIVITY", item: { id: uid(), accountId: a.id, type: "note", date: iso(Date.now()), summary: `Account reactivated by ${user.name}` } });
              toast({ text: `Reactivated ${a.name}.`, tone: "success",
                undo: () => dispatch({ type: "CHURN_ACCOUNT", id: a.id, entry: prev }) });
            }}>↻ Reactivate</button>}
          <MoreMenu items={[
            { label: "+ Contact", onClick: () => setForm("contact") },
            { label: "+ Opportunity", onClick: () => setForm("opp") },
            !a.churn && { label: "⇄ Adjust ARR", onClick: () => setForm("adjust") },
            !a.churn && !a.billingCompleted && { label: "$ Mark billing completed", onClick: () => setForm("billing") },
            !a.churn && { label: "✖ Mark churned", onClick: () => setForm("churn"), danger: true },
            user.role === "admin" && { label: "Delete account", danger: true, separate: true, onClick: () => {
              // No dialog: the Undo toast below is the guard, and it is a better one --
              // a confirm people click through protects nothing.
              // snapshot BEFORE the dispatch -- snapshotFor reads the pre-delete state and
              // already handles a single id, including sub-account parentIds
              const snapshot = snapshotFor(st, [a.id]);
              dispatch({ type: "DELETE_ACCOUNT", id: a.id });
              toast({ text: `Deleted ${a.name}.`, tone: "success",
                undo: () => dispatch({ type: "RESTORE_SNAPSHOT", snapshot }) });
              back();
            } },
          ]} />
        </div>}
      </div>
      {/* Header card, in reading order: the numbers that matter, quiet profile facts,
          retention since the prior-year close, then small status pills. */}
      <div data-header-card className="nm-sm p-4">
        {(() => { const f = licenseFigures(a); const r = accountRetention(a, (st.settings && st.settings.rates) || {});
          const Stat = ({ label, value, sub, tone = "text-slate-900" }) => (
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
              <div className={`truncate text-lg font-bold tabular-nums ${tone}`}>{value}</div>
              {sub && <div className="truncate text-xs text-slate-500">{sub}</div>}
            </div>);
          return <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="ARR" value={fmtMoney(a.arr, a.currency)} sub={a.currency !== "USD" ? `≈ ${fmtMoney(a.arrUSD)} USD` : null} />
              <Stat label="Renewal" value={fmtDate(a.renewalDate)} tone={d < 60 ? "text-amber-600" : "text-slate-900"} sub={`${d < 0 ? `${-d}d ago` : `in ${d}d`} · ${a.contractStatus}`} />
              {f.total > 0
                ? <Stat label="Licenses" value={f.deployed == null ? f.total : `${f.pct}%`} sub={f.deployed == null ? "total" : `${f.deployed} deployed of ${f.total} (${f.pct}%)`} />
                : null}
              <Stat label="CSM" value={a.csm || "—"} sub={a.csm && a.csmSince ? <span data-csm-since-label>since {fmtDate(a.csmSince)}</span> : null} />
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 pt-3">
              <Meta label="Tier" value={a.tier} />
              {(() => { const ld = a.leadId && (team || []).find(u => u.id === a.leadId); return ld ? <span data-lead-meta><Meta label="Lead" value={ld.name} /></span> : null; })()}
              <Meta label="Industry" value={a.industry} />
              {a.modules ? <Meta label="Modules" value={a.modules} /> : null}
              {a.dedicatedSupport ? <Meta label="Support" value="Dedicated" /> : null}
              {parent && <Meta label="Parent" value={<button className="text-indigo-600 hover:underline" onClick={() => openAccount(parent.id)}>{parent.name}</button>} />}
            </div>
            {(() => { const shown = activeCustomFields(st.settings && st.settings.customFields)
                .map(d => ({ d, text: formatCustomValue(d.type, a.custom && a.custom[d.id]) })).filter(x => x.text);
              return shown.length > 0 && <div data-custom-details className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                {shown.map(({ d, text }) => <Meta key={d.id} label={d.label}
                  value={<span data-custom-value={d.id}>{d.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(text) ? fmtDate(text) : text}</span>} />)}
              </div>; })()}
            {/* Retention: the arithmetic lives in accountRetention so this and the list column cannot disagree. */}
            <div data-retention-block className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Retention since {r.baselineKey}</span>
              {r.isNew ? (
                <p className="text-slate-500">
                  This account started after the {r.baselineKey} close, so there is no prior-year
                  figure to compare against. New accounts are excluded from NRR and GRR.
                </p>
              ) : (
                <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span><span className="text-slate-500">{r.baselineKey} close </span><span data-baseline-arr className="font-semibold tabular-nums text-slate-700">{fmtMoney(r.baselineARR)}</span></span>
                  <span><span className="text-slate-500">Today </span><span data-current-arr className="font-semibold tabular-nums text-slate-700">{fmtMoney(r.currentARR)}</span></span>
                  <span><span className="text-slate-500">Change </span><span data-change className={`font-semibold tabular-nums ${r.delta > 0 ? "text-emerald-600" : r.delta < 0 ? "text-rose-600" : "text-slate-700"}`}>
                    {r.delta > 0 ? "+" : ""}{fmtMoney(r.delta)}{r.pct !== null ? ` (${r.pct > 0 ? "+" : ""}${r.pct.toFixed(1)}%)` : ""}
                  </span></span>
                  <span><span className="text-slate-500">Retained </span><span data-ratio className="font-semibold tabular-nums text-slate-700">
                    {r.baselineARR > 0 ? `${((r.currentARR / r.baselineARR) * 100).toFixed(1)}%` : "—"}
                  </span></span>
                </span>
              )}
            </div>
          </>; })()}
        {/* Status pills: small and flat so they read as state, not as buttons. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          {!a.churn && ro && <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${RENEWAL_STAGE_STYLE[renewalStageOf(a)]}`}>{renewalStageOf(a)}</span>}
          {!a.churn && !ro && <select value={renewalStageOf(a)} title="Renewal stage"
            onChange={e => dispatch({ type: "EDIT_ACCOUNT", id: a.id, patch: { renewalStage: e.target.value }, by: user?.name, source: "inline" })}
            className={`cursor-pointer rounded-full border-0 px-2.5 py-0.5 text-xs font-bold outline-none ${RENEWAL_STAGE_STYLE[renewalStageOf(a)]}`}>
            {RENEWAL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>}
          <span className={`rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold ${a.billingCompleted ? "text-emerald-600" : "text-amber-600"}`}>
            {a.billingCompleted ? `Billing ✓ ${fmtDate(a.billingCompletedDate)}` : "Billing pending"}</span>
          {/* Handoff from sales to account management. Unset is the normal state for accounts
              predating the field, so it reads as absent data, not as a risk flag. */}
          <span data-transition-pill className={`rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold ${a.transitionDate ? "text-slate-700" : "text-slate-500"}`}>
            {a.transitionDate ? `Sales → AM ${fmtDate(a.transitionDate)}` : "Transition date not set"}</span>
          {/* Implementation → CSM: derived from each project's CSM sign-off (csmHandovers), one pill per project. */}
          {csmHandovers(a.id, st.projects).map(h => (
            <span key={h.projectId} data-csm-handover-pill className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700"
              title={`CSM sign-off${h.by ? ` by ${h.by}` : ""} (${h.type === "expansion" ? "expansion" : "onboarding"} project)`}>
              {h.n === 1 ? `Impl → CSM ${fmtDate(h.date)}` : `Project ${h.n} → CSM ${fmtDate(h.date)}`}</span>))}
          {(() => { const s = qbrStatus(a); return s && (
            <span className={`rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold ${s.kind === "overdue" ? "text-rose-600" : s.kind === "due" ? "text-amber-600" : "text-slate-700"}`}>
              {s.kind === "overdue" ? `QBR overdue ${s.d}d` : s.kind === "due" ? `QBR due in ${s.d}d` : s.kind === "scheduled" ? `Next QBR ${fmtDate(a.nextQbrDate)}` : "QBR not scheduled"}
            </span>); })()}
          {hEpisode.length > 0 && <span title={hBehind ? "Health playbook behind pace — an open step is past due" : "Health playbook progress"}
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${hDone === hEpisode.length ? "bg-emerald-100 text-emerald-700" : hBehind ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>♥ {hDone}/{hEpisode.length}</span>}
          {/* "Renewal in Nd" is already the Renewal stat above. */}
          {a.flags.filter(f => !f.startsWith("Renewal in")).map(f => <span key={f} data-flag className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-600">{f}</span>)}
        </div>
      </div>
      {a.churn && <div className="nm-sm flex flex-wrap items-center gap-3 p-3 text-sm">
        <span className="rounded-full bg-rose-500 px-3 py-1 text-xs font-bold text-white">CHURNED</span>
        <span className="text-slate-700">{fmtDate(a.churn.date)} · {a.churn.reason}{a.churn.note ? ` — ${a.churn.note}` : ""}</span>
        <span className="ml-auto text-xs text-slate-500">{fmtMoney(a.churn.arr, a.churn.currency)} ARR lost · recorded by {a.churn.by}</span>
      </div>}
      {subs.length > 0 && <Card title={`Sub-accounts (${subs.length}) · rollup ${fmtMoney(toUSD(a.arr, a.currency, st.settings.rates) + subs.filter(s => !s.churn).reduce((t, s) => t + s.arrUSD, 0))} USD`}>
        {subs.map(s => (
          <button key={s.id} onClick={() => openAccount(s.id)} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50">
            <span>{s.name}{s.churn && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-600">churned</span>}</span>
            <span className="flex items-center gap-2 text-xs text-slate-700">{fmtMoney(s.arr, s.currency)} <HealthChip score={s.score} /></span>
          </button>
        ))}
      </Card>}
      {form && !ro && <Card>{form === "activity" ? <LogActivityForm acct={a} dispatch={dispatch} onDone={() => setForm(null)} />
        : form === "task" ? <AddTaskForm acct={a} dispatch={dispatch} onDone={() => setForm(null)} team={team} user={user} />
        : form === "contact" ? <AddContactForm acct={a} dispatch={dispatch} onDone={() => setForm(null)} />
        : form && form.t === "editContact" ? <AddContactForm key={form.item.id} acct={a} existing={form.item} dispatch={dispatch} onDone={() => setForm(null)} />
        : form === "opp" ? <AddOppForm acct={a} dispatch={dispatch} onDone={() => setForm(null)} />
        : form === "edit" ? <AccountForm existing={a} dispatch={dispatch} onDone={() => setForm(null)} team={team} accounts={st.accounts} user={user} customFields={st.settings && st.settings.customFields} />
        : form === "renewal" ? <CompleteRenewalForm acct={a} user={user} dispatch={dispatch} onDone={() => setForm(null)} />
        : form === "billing" ? <BillingForm acct={a} user={user} dispatch={dispatch} onDone={() => setForm(null)} />
        : form === "churn" ? <ChurnForm acct={a} user={user} dispatch={dispatch} onDone={() => setForm(null)} />
        : form === "adjust" ? <AdjustArrForm acct={a} user={user} dispatch={dispatch} onDone={() => setForm(null)} />
        : form && form.t === "editActivity" ? <LogActivityForm acct={a} existing={form.item} dispatch={dispatch} onDone={() => setForm(null)} />
        : form && form.t === "editTask" ? <AddTaskForm acct={a} existing={form.item} team={team} user={user} dispatch={dispatch} onDone={() => setForm(null)} />
        : <UpdateHealthForm acct={a} dispatch={dispatch} onDone={() => setForm(null)} />}</Card>}
      <div className="flex gap-2" role="tablist">
        {[["overview", "Overview"], ["Invoices", "Invoices"], ["Purchase orders", "Purchase orders"]].filter(([k]) => !ro || k === "overview").map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} data-account-tab={k}
          className={`nm-btn px-3 py-1.5 text-xs font-bold ${tab === k ? "text-indigo-700" : "text-slate-600"}`} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === "Invoices" && <Card title="Invoices"><AccountInvoices account={a} user={user} /></Card>}
      {tab === "Purchase orders" && <Card title="Purchase orders"><AccountPurchaseOrders account={a} user={user} /></Card>}
      {tab === "overview" && <>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Health trend">
          {(() => { const iu = daysSince(a.inputsUpdatedAt || a.startDate); return (
            <div className={`mb-2 text-xs font-bold ${iu >= 45 ? "text-rose-500" : iu >= 30 ? "text-amber-600" : "text-slate-500"}`}>
              Inputs last updated {iu === 0 ? "today" : iu + "d ago"}{iu >= 30 ? (ro ? " — inputs are stale" : " — refresh via ✎ Update health") : ""}
            </div>); })()}
          <Sparkline points={[...(a.history || []), { d: iso(Date.now()), s: a.score }]} />
          <div className="mt-2 space-y-0.5 text-xs text-slate-700">
            {Object.keys(comps).filter(k => k !== "value" || st.settings.weights?.value > 0).map(k => <React.Fragment key={k}>
              <div className="flex items-center gap-2">
                <span className="w-36 shrink-0">{WEIGHT_LABELS[k]}</span>
                <span data-input-bar className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, comps[k]))}%`, background: comps[k] >= 70 ? RISK_HEX.Green : comps[k] >= 40 ? RISK_HEX.Yellow : RISK_HEX.Red }} /></span>
                <span className="w-8 text-right font-semibold tabular-nums">{comps[k]}</span>
              </div>
              {k === "recency" && st.settings.recencyMix?.enabled && <div data-recency-breakdown className="mb-1 ml-4 space-y-0.5 text-[11px] text-slate-500">
                {recencyBreakdown(a, st.activities, st.settings.recencyMix).filter(b => b.weight > 0).map(b =>
                  <div key={b.type} data-recency-type={b.type} className="flex justify-between">
                    <span>{b.type}</span>
                    <span className="tabular-nums">{b.score} · {b.lastDate ? `last ${daysSince(b.lastDate)}d ago` : "never"}</span>
                  </div>)}
              </div>}
            </React.Fragment>)}
          </div>
        </Card>
        <Card title={`Open tasks (${tasks.length})`}>
          {tasks.length === 0 && <div className="text-sm text-slate-500">None open.</div>}
          {tasks.map(t => (
            <div key={t.id} className="border-b border-slate-100 py-1.5 last:border-0">
              <div className="flex items-center gap-2 text-sm">
                {!ro && <input type="checkbox" checked={false} onChange={() => dispatch({ type: "TOGGLE_TASK", id: t.id })} />}
                <span className="flex-1">{t.title}</span>
                <span className="text-xs text-slate-500">{t.owner}</span>
                <span className={`text-xs ${daysUntil(t.due) < 0 ? "text-rose-600 font-semibold" : "text-slate-700"}`}>{fmtDate(t.due)}</span>
                <span className="text-xs text-slate-500">{t.priority}</span>
                {!ro && <button title="Edit task" aria-label="Edit task" className="text-xs text-indigo-500 hover:text-indigo-700" onClick={() => setForm({ t: "editTask", item: t })}>✎</button>}
              </div>
              {t.details && <div className="ml-6 mt-1 whitespace-pre-wrap text-xs text-slate-600">{t.details}</div>}
              {t.attachments && t.attachments.length > 0 && <div className="ml-6 mt-1"><AttachmentLinks items={t.attachments} /></div>}
            </div>
          ))}
        </Card>
        <Card title={`Contacts (${contacts.length})`}>
          {contacts.map(c => (
            <div key={c.id} className="border-b border-slate-100 py-1.5 text-sm last:border-0">
              <div className="flex items-center gap-1 font-medium">{c.isChampion && <span title="Champion">⭐</span>}{c.name}
                <span className={`ml-auto text-xs ${c.sentiment === "Positive" ? "text-emerald-600" : c.sentiment === "Negative" ? "text-rose-600" : "text-slate-500"}`}>{c.sentiment}</span>
                {!ro && <button title="Edit contact" aria-label="Edit contact" data-edit-contact={c.id} className="nm-btn shrink-0 px-1.5 py-0.5 text-xs text-indigo-600 hover:text-indigo-800" onClick={() => setForm({ t: "editContact", item: c })}>✎</button>}
                {!ro && <button title="Delete contact" aria-label="Delete contact" data-delete-contact={c.id} className="nm-btn shrink-0 px-1.5 py-0.5 text-xs text-rose-600 hover:text-rose-800" onClick={() => setConfirmContact(c)}>🗑</button>}</div>
              <div className="text-xs text-slate-700">{c.role} · {c.email}</div>
            </div>
          ))}
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Activity timeline (${acts.length})`}>
          {acts.length === 0 && <div className="text-sm text-slate-500">No activity yet.</div>}
          {acts.map(x => (
            <div key={x.id} className="border-b border-slate-100 py-1.5 last:border-0">
              <div className="flex items-center gap-3 text-sm">
                <span className="nm-inset w-16 shrink-0 px-1.5 py-0.5 text-center text-xs font-bold text-slate-700">{x.type}</span>
                <span className="flex-1">{x.summary}</span>
                <span className="shrink-0 text-xs text-slate-500">{fmtDate(x.date)}</span>
                {!ro && <button title="Edit activity" aria-label="Edit activity" className="shrink-0 text-xs text-indigo-500 hover:text-indigo-700" onClick={() => setForm({ t: "editActivity", item: x })}>✎</button>}
              </div>
              {x.details && <div className="ml-[76px] mt-1 whitespace-pre-wrap text-xs text-slate-600">{x.details}</div>}
              {x.attachments && x.attachments.length > 0 && <div className="ml-[76px] mt-1"><AttachmentLinks items={x.attachments} /></div>}
            </div>
          ))}
        </Card>
        <Card title={`Opportunities (${opps.filter(o => !["Won", "Lost"].includes(o.stage)).length} open)`}>
          {opps.length === 0 && <div className="text-sm text-slate-500">None.</div>}
          {opps.map(o => (
            <div key={o.id} className={`flex items-center gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0 ${["Won", "Lost"].includes(o.stage) ? "opacity-60" : ""}`}>
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-600">{o.type}</span>
              <span className="flex-1 font-medium">{fmtMoney(o.value, a.currency)}</span>
              {ro ? <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{o.stage}</span> : <Select value={o.stage} options={["Discovery", "Proposal", "Negotiation", "Stalled", "Won", "Lost"]}
                disabled={!!a.churn} title={a.churn ? "Account is churned — reactivate it to work opportunities" : undefined}
                className="!px-2 !py-0.5 text-xs disabled:opacity-50" onChange={e => {
                  const stage = e.target.value;
                  if (stage === o.stage) return;
                  if (stage === "Won") {
                    // The select is controlled by o.stage, so opening the dialog re-renders
                    // it back to the current stage until the change is actually confirmed.
                    setConfirmOpp({ kind: "won", opp: o, run: () => {
                      dispatch({ type: "SET_OPP_STAGE", id: o.id, stage });
                      toast({ text: `${o.type} won for ${a.name}.`, tone: "success", action: { label: "Start onboarding", run: () => { if (shownId.current === a.id) setHandoverOpen(true); } } });
                      dispatch({ type: "ADJUST_ARR", id: a.id, newArr: a.arr + o.value,
                        entry: { id: uid(), date: iso(Date.now()), delta: o.value, kind: "expansion", source: "opportunity", reason: `${o.type} won`, note: "", by: user.name } });
                      dispatch({ type: "ADD_ACTIVITY", item: { id: uid(), accountId: a.id, type: "note", date: iso(Date.now()),
                        summary: `Opportunity WON — ${fmtMoney(o.value, a.currency)} ${o.type} · ARR now ${fmtMoney(a.arr + o.value, a.currency)} · by ${user.name}` } });
                    } });
                  } else if (o.stage === "Won") {
                    setConfirmOpp({ kind: "stage", opp: o, run: () => dispatch({ type: "SET_OPP_STAGE", id: o.id, stage }) });
                  } else {
                    dispatch({ type: "SET_OPP_STAGE", id: o.id, stage });
                  }
                }} />}
              <span className="text-xs text-slate-500">close {fmtDate(o.closeDate)}</span>
            </div>
          ))}
        </Card>
      </div>
      </>}
      {confirmContact && <ConfirmDialog
        title="Delete contact"
        body={`Delete ${confirmContact.name}${confirmContact.email ? ` (${confirmContact.email})` : ""}? This cannot be undone. Email touchpoints will stop matching this address.`}
        confirmLabel="Delete"
        onConfirm={() => dispatch({ type: "DELETE_CONTACT", id: confirmContact.id })}
        onClose={() => setConfirmContact(null)} />}
      {confirmOpp && <ConfirmDialog
        title={confirmOpp.kind === "won" ? "Book expansion ARR" : "Change a booked opportunity"}
        tone={confirmOpp.kind === "won" ? "normal" : "danger"}
        body={confirmOpp.kind === "won"
          ? `Mark this ${confirmOpp.opp.type} as WON and book ${fmtMoney(confirmOpp.opp.value, a.currency)} expansion ARR onto ${a.name}?`
          : "This opportunity was already booked as Won expansion. Changing its stage does NOT reverse the ARR — use ⇄ Adjust ARR for that."}
        confirmLabel={confirmOpp.kind === "won" ? "Book it" : "Continue"}
        onConfirm={() => confirmOpp.run()}
        onClose={() => setConfirmOpp(null)} />}
      <ProjectsCard account={a} st={st} dispatch={dispatch} user={user} open={handoverOpen} setOpen={setHandoverOpen} openProject={openProject} />
      <DocumentsCard a={a} dispatch={dispatch} user={user} readOnly={ro} />
      {(() => {
        const events = [
          ...(a.renewals || []).map(r => ({ id: r.id, date: r.completedOn, sort: r.completedOn, kind: "renewal", r })),
          ...(a.arrEvents || []).map(ev => ({ id: ev.id, date: ev.date, sort: ev.date, kind: ev.kind, ev })),
          ...(a.churn ? [{ id: "churn", date: a.churn.date, sort: a.churn.date, kind: "churn" }] : []),
        ].sort((x, y) => y.sort.localeCompare(x.sort));
        return (
          <Card title={`Revenue history (${events.length})`}>
            {events.length === 0 && <div className="text-sm text-slate-500">No revenue events yet — renewals, won opportunities, ARR adjustments and churn all land here.</div>}
            {events.map(e => (
              <div key={e.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0">
                {e.kind === "renewal" && <>
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">✓ renewed</span>
                  <span className="text-slate-800">{fmtDate(e.date)}</span>
                  <span className="flex-1 text-xs text-slate-700">term extended {fmtDate(e.r.from)} → <b>{fmtDate(e.r.to)}</b></span>
                  <span className={`text-xs ${e.r.billingCompleted ? "text-emerald-600" : "text-slate-500"}`}>{e.r.billingCompleted ? `billed ${fmtDate(e.r.billingCompletedDate)}` : "billing n/a"}</span>
                  <span className="text-xs">{fmtMoney(e.r.arr, a.currency)}{e.r.arr !== e.r.prevArr && <span className={e.r.arr > e.r.prevArr ? "ml-1 text-emerald-600" : "ml-1 text-rose-600"}>({e.r.arr > e.r.prevArr ? "▲" : "▼"} from {fmtMoney(e.r.prevArr, a.currency)})</span>}</span>
                  <span className="text-xs text-slate-500">by {e.r.by}</span>
                </>}
                {(e.kind === "expansion" || e.kind === "contraction") && <>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${e.kind === "expansion" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-600"}`}>{e.kind === "expansion" ? "▲ expansion" : "▼ reduction"}</span>
                  <span className="text-slate-800">{fmtDate(e.date)}</span>
                  <span className="flex-1 text-xs text-slate-700">{e.ev.reason}{e.ev.note ? ` — ${e.ev.note}` : ""}{e.ev.source === "opportunity" ? " (from opportunity)" : ""}</span>
                  <span className={`text-xs font-bold ${e.ev.delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>{e.ev.delta > 0 ? "+" : "−"}{fmtMoney(Math.abs(e.ev.delta), a.currency)}</span>
                  <span className="text-xs text-slate-500">by {e.ev.by}</span>
                </>}
                {e.kind === "redenomination" && <>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">⇄ redenominated</span>
                  <span className="text-slate-800">{fmtDate(e.date)}</span>
                  <span className="flex-1 text-xs text-slate-700">{e.ev.reason} — same revenue, restated</span>
                  <span className="text-xs font-semibold text-slate-600">{fmtMoney(e.ev.fromArr, e.ev.fromCurrency)} → {fmtMoney(e.ev.toArr, e.ev.toCurrency)}</span>
                  <span className="text-xs text-slate-500">by {e.ev.by}</span>
                </>}
                {e.kind === "churn" && <>
                  <span className="rounded bg-rose-500 px-1.5 py-0.5 text-xs font-bold text-white">✖ churned</span>
                  <span className="text-slate-800">{fmtDate(e.date)}</span>
                  <span className="flex-1 text-xs text-slate-700">{a.churn.reason}{a.churn.note ? ` — ${a.churn.note}` : ""}</span>
                  <span className="text-xs font-bold text-rose-600">−{fmtMoney(a.churn.arr, a.churn.currency || a.currency)}</span>
                  <span className="text-xs text-slate-500">by {a.churn.by}</span>
                </>}
              </div>
            ))}
          </Card>
        );
      })()}
      {(a.audit || []).length > 0 && <ChangeHistoryCard a={a} />}
    </div>
  );
}

