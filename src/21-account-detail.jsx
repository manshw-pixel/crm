/* ------------------------------ Account detail ------------------------------ */
const AUDIT_FIELD_LABEL = { arr: "ARR", renewalDate: "Renewal date", csm: "CSM", tier: "Tier", contractStatus: "Contract status", renewalStage: "Renewal stage", document: "Document" };
function ChangeHistoryCard({ a }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const entries = [...(a.audit || [])].sort((x, y) => y.date.localeCompare(x.date) || (y.id > x.id ? 1 : -1));
  const shown = showAll ? entries : entries.slice(0, 50);
  const fmtVal = (f, v) => f === "arr" ? fmtMoney(+v || 0, a.currency) : f === "renewalDate" ? fmtDate(v) : (v === "" || v == null ? "—" : String(v));
  return (
    <AdCard title="Change history" n={`(${entries.length})`} right={<button className="ad-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? "Hide ▴" : "Show ▾"}</button>}>
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
    </AdCard>
  );
}
// Overview card shell: h2 title + muted count. The visible title text stays "Title (N)" so
// long-standing text tests keep matching.
const AdCard = ({ title, n, right, children, compact }) => (
  <section data-ad-card aria-label={title} className={`ad-card ${compact && !children ? "ad-box-c" : "ad-box"}`}>
    <div className="flex items-center gap-2.5">
      <h2 className={`ad-h2 ${right ? "!mb-0" : ""}`}>{title}{n != null && <> <span className="ad-n">{n}</span></>}</h2>{right}
    </div>
    {children}
  </section>
);
// Activity icon paths, from the approved preview's `I` table. Unknown types fall back to note.
const ACTIVITY_ICON = {
  call: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  email: "M4 6h16v12H4z M4 7l8 6 8-6",
  meeting: "M8 7V3m8 4V3M4 11h16M5 5h14v16H5z",
  qbr: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  note: "M5 4h10l4 4v12H5z M9 12h6 M9 16h4",
};
const activityIconKey = type => { const k = String(type || "").toLowerCase(); return ACTIVITY_ICON[k] ? k : "note"; };
const PRIORITY_SEV = { High: "red", Medium: "amber", Low: "grey" };
function RevenueHistoryCard({ a }) {
  const [open, setOpen] = useState(false);
  const events = [
    ...(a.renewals || []).map(r => ({ id: r.id, date: r.completedOn, sort: r.completedOn, kind: "renewal", r })),
    ...(a.arrEvents || []).map(ev => ({ id: ev.id, date: ev.date, sort: ev.date, kind: ev.kind, ev })),
    ...(a.churn ? [{ id: "churn", date: a.churn.date, sort: a.churn.date, kind: "churn" }] : []),
  ].sort((x, y) => y.sort.localeCompare(x.sort));
  return (
    <AdCard title="Revenue history" n={`(${events.length})`} right={<button className="ad-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? "Hide ▴" : "Show ▾"}</button>}>
      {open && <div className="mt-2">
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
      </div>}
    </AdCard>
  );
}
const Meta = ({ label, value }) => (value === "" || value == null) ? null : (
  <span className="whitespace-nowrap"><span className="ad-meta">{label} </span><b className="ad-val">{value}</b></span>
);
// Status pill colour, one place (approved Stage 4 severity tables). The text always names the state.
const statusSev = {
  billing: done => done ? "green" : "amber",
  handover: () => "grey", // Sales -> AM, Impl -> CSM, "Transition date not set"
  qbr: kind => kind === "overdue" ? "red" : kind === "due" ? "amber" : "grey",
  playbook: (done, total, behind) => done === total ? "green" : behind ? "amber" : "red",
};
const StatusPill = ({ sev, children, ...rest }) => (
  <span data-status-pill data-sev={sev} className="ad-pill" {...rest}><span className="ad-dot" aria-hidden="true" />{children}</span>
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
  // Σ rollup (own ARR + live subs, USD): one value for the ARR stat and the Sub-accounts title.
  const rollup = subs.length > 0 ? toUSD(a.arr, a.currency, st.settings.rates) + subs.filter(s => !s.churn).reduce((t, s) => t + s.arrUSD, 0) : null;
  return (
    <div className="ad-page space-y-4">
      <button onClick={back} className="ad-back">← Accounts</button>
      {/* data-header-card wraps all three header cards (identity, stats, profile & status) so the
          long-standing hook still finds every part it always held. */}
      <div data-header-card className="space-y-4">
      {(() => { const f = licenseFigures(a); const r = accountRetention(a, (st.settings && st.settings.rates) || {});
        const ld = a.leadId && (team || []).find(u => u.id === a.leadId);
        const iu = daysSince(a.inputsUpdatedAt || a.startDate);
        const rk = riskOf(a.score);
        // Sub line: empty parts drop out entirely, so there is never a stray "·".
        const subParts = [a.tier, a.industry, ld && `Lead ${ld.name}`,
          parent && <>Parent <button className="ad-link" onClick={() => openAccount(parent.id)}>{parent.name}</button></>].filter(Boolean);
        const renewSev = d < 0 ? "red" : d < 60 ? flagSeverity(`Renewal in ${d}d`) : undefined;
        const arrSub = [a.currency !== "USD" ? `≈ ${fmtMoney(a.arrUSD)} USD` : (rollup !== null ? "USD" : null),
          rollup !== null ? `Σ ${fmtMoney(rollup)} with subs` : null].filter(Boolean).join(" · ");
        const Stat = ({ k, glyph, label, value, sub, sev }) => (
          <div data-stat={k} data-sev={sev} className="ad-card ad-stat">
            <span aria-hidden="true" className="ad-stat-tile">{glyph}</span>
            <div className="min-w-0">
              <div className="ad-stat-label">{label}</div>
              <div className="ad-stat-value truncate tabular-nums">{value}</div>
              {sub && <div className="ad-stat-sub truncate">{sub}</div>}
            </div>
          </div>);
        return <>
          <section aria-label="Account header" className="ad-card ad-head">
            <span aria-hidden="true" data-avatar className="acct-av ad-av" data-av={avatarSlot(a.id)}>{initialsOf(a.name)}</span>
            <div className="ad-ident">
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                <h1 className="ad-h1" title={a.name}>{a.name}</h1>
                <span className="ad-no">#{subNumbers(scored).get(a.id) || a.accountNo || "—"}</span>
              </div>
              {subParts.length > 0 && <p data-sub-line className="ad-sub">
                {subParts.map((p, i) => <React.Fragment key={i}>{i > 0 && " · "}{p}</React.Fragment>)}</p>}
            </div>
            <div className="ad-health" data-risk={rk}>
              <HealthRing score={a.score} size={72} />
              <div>
                <div data-health-word className="ad-health-word">{RISK_WORD[rk]}</div>
                <div className="ad-meta-sm">Inputs updated {iu === 0 ? "today" : iu + "d ago"}</div>
              </div>
            </div>
            {!ro && <div className="ad-actions">
              <Btn kind="primary" onClick={() => setForm("activity")}>+ Log activity</Btn>
              <Btn onClick={() => setForm("task")}>+ Add task</Btn>
              <Btn onClick={() => setForm("health")}>✎ Update health</Btn>
              {!a.churn && <Btn onClick={() => setForm("renewal")}>✓ Complete renewal</Btn>}
              <Btn onClick={() => setForm("edit")}>✎ Edit account</Btn>
              {a.churn && <Btn data-reactivate
                onClick={() => {
                  // Reversible in one dispatch, so no dialog: act, then offer Undo.
                  const prev = a.churn;
                  dispatch({ type: "REACTIVATE_ACCOUNT", id: a.id, by: user.name });
                  dispatch({ type: "ADD_ACTIVITY", item: { id: uid(), accountId: a.id, type: "note", date: iso(Date.now()), summary: `Account reactivated by ${user.name}` } });
                  toast({ text: `Reactivated ${a.name}.`, tone: "success",
                    undo: () => dispatch({ type: "CHURN_ACCOUNT", id: a.id, entry: prev }) });
                }}>↻ Reactivate</Btn>}
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
          </section>
          <section aria-label="Key numbers" className="ad-stats">
            <Stat k="arr" glyph="$" label="ARR" value={fmtMoney(a.arr, a.currency)} sub={arrSub || null} />
            <Stat k="renewal" glyph="R" label="Renewal" value={fmtDate(a.renewalDate)} sev={renewSev} sub={`${d < 0 ? `${-d}d ago` : `in ${d}d`} · ${a.contractStatus}`} />
            {f.total > 0
              ? <Stat k="licenses" glyph="L" label="Licenses" value={f.deployed == null ? f.total : `${f.pct}%`} sub={f.deployed == null ? "total" : `${f.deployed} deployed of ${f.total} (${f.pct}%)`} />
              : null}
            <Stat k="csm" glyph={a.csm ? initialsOf(a.csm) : "—"} label="CSM" value={a.csm || "—"} sub={a.csm && a.csmSince ? <span data-csm-since-label>since {fmtDate(a.csmSince)}</span> : null} />
          </section>
          {/* Profile & status: quiet profile facts, retention since the prior-year close, then status pills. */}
          <section aria-label="Profile and status" className="ad-card ad-profile">
            <div className="ad-meta-row">
              <Meta label="Tier" value={a.tier} />
              {ld ? <span data-lead-meta><Meta label="Lead" value={ld.name} /></span> : null}
              <Meta label="Industry" value={a.industry} />
              {a.modules ? <Meta label="Modules" value={a.modules} /> : null}
              {a.dedicatedSupport ? <Meta label="Support" value="Dedicated" /> : null}
              {parent && <Meta label="Parent" value={<button className="ad-link" onClick={() => openAccount(parent.id)}>{parent.name}</button>} />}
            </div>
            {(() => { const shown = activeCustomFields(st.settings && st.settings.customFields)
                .map(d => ({ d, text: formatCustomValue(d.type, a.custom && a.custom[d.id]) })).filter(x => x.text);
              return shown.length > 0 && <div data-custom-details className="ad-meta-row">
                {shown.map(({ d, text }) => <Meta key={d.id} label={d.label}
                  value={<span data-custom-value={d.id}>{d.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(text) ? fmtDate(text) : text}</span>} />)}
              </div>; })()}
            {/* Retention: the arithmetic lives in accountRetention so this and the list column cannot disagree. */}
            <div data-retention-block className="ad-section ad-retention">
              <span className="ad-caps">Retention since {r.baselineKey}</span>
              {r.isNew ? (
                <p className="ad-meta">
                  This account started after the {r.baselineKey} close, so there is no prior-year
                  figure to compare against. New accounts are excluded from NRR and GRR.
                </p>
              ) : (
                <span className="flex flex-wrap items-baseline gap-x-[18px] gap-y-1">
                  <span><span className="ad-meta">{r.baselineKey} close </span><span data-baseline-arr className="ad-val tabular-nums">{fmtMoney(r.baselineARR)}</span></span>
                  <span><span className="ad-meta">Today </span><span data-current-arr className="ad-val tabular-nums">{fmtMoney(r.currentARR)}</span></span>
                  <span><span className="ad-meta">Change </span><span data-change data-tone={r.delta > 0 ? "up" : r.delta < 0 ? "down" : undefined} className="ad-val tabular-nums">
                    {r.delta > 0 ? "+" : ""}{fmtMoney(r.delta)}{r.pct !== null ? ` (${r.pct > 0 ? "+" : ""}${r.pct.toFixed(1)}%)` : ""}
                  </span></span>
                  <span><span className="ad-meta">Retained </span><span data-ratio className="ad-val tabular-nums">
                    {r.baselineARR > 0 ? `${((r.currentARR / r.baselineARR) * 100).toFixed(1)}%` : "—"}
                  </span></span>
                </span>
              )}
            </div>
            {/* Status pills: small and flat so they read as state, not as buttons. Colour comes from statusSev; the text always says it. */}
            <div className="ad-section flex flex-wrap items-center gap-1.5">
              {!a.churn && ro && <span data-renewal-stage className="ad-stage">{renewalStageOf(a)}</span>}
              {!a.churn && !ro && <>
                <label htmlFor={`ad-stage-${a.id}`} className="sr-only">Renewal stage</label>
                <select id={`ad-stage-${a.id}`} data-renewal-stage value={renewalStageOf(a)} title="Renewal stage"
                  onChange={e => dispatch({ type: "EDIT_ACCOUNT", id: a.id, patch: { renewalStage: e.target.value }, by: user?.name, source: "inline" })}
                  className="ad-stage cursor-pointer">
                  {RENEWAL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select></>}
              <StatusPill sev={statusSev.billing(a.billingCompleted)}>
                {a.billingCompleted ? `Billing ✓ ${fmtDate(a.billingCompletedDate)}` : "Billing pending"}</StatusPill>
              {/* Handoff from sales to account management. Unset is the normal state for accounts
                  predating the field, so it reads as absent data, not as a risk flag. */}
              <StatusPill data-transition-pill sev={statusSev.handover()}>
                {a.transitionDate ? `Sales → AM ${fmtDate(a.transitionDate)}` : "Transition date not set"}</StatusPill>
              {/* Implementation → CSM: derived from each project's CSM sign-off (csmHandovers), one pill per project. */}
              {csmHandovers(a.id, st.projects).map(h => (
                <StatusPill key={h.projectId} data-csm-handover-pill sev={statusSev.handover()}
                  title={`CSM sign-off${h.by ? ` by ${h.by}` : ""} (${h.type === "expansion" ? "expansion" : "onboarding"} project)`}>
                  {h.n === 1 ? `Impl → CSM ${fmtDate(h.date)}` : `Project ${h.n} → CSM ${fmtDate(h.date)}`}</StatusPill>))}
              {(() => { const s = qbrStatus(a); return s && (
                <StatusPill data-qbr-pill sev={statusSev.qbr(s.kind)}>
                  {s.kind === "overdue" ? `QBR overdue ${s.d}d` : s.kind === "due" ? `QBR due in ${s.d}d` : s.kind === "scheduled" ? `Next QBR ${fmtDate(a.nextQbrDate)}` : "QBR not scheduled"}
                </StatusPill>); })()}
              {hEpisode.length > 0 && <StatusPill data-playbook-pill sev={statusSev.playbook(hDone, hEpisode.length, hBehind)}
                title={hBehind ? "Health playbook behind pace — an open step is past due" : "Health playbook progress"}>♥ {hDone}/{hEpisode.length} playbook</StatusPill>}
              {/* "Renewal in Nd" is already the Renewal stat above. */}
              {a.flags.filter(f => !f.startsWith("Renewal in")).map(f => <FlagPill key={f} flag={f} />)}
            </div>
          </section>
        </>; })()}
      </div>
      {a.churn && <div className="nm-sm flex flex-wrap items-center gap-3 p-3 text-sm">
        <span className="rounded-full bg-rose-500 px-3 py-1 text-xs font-bold text-white">CHURNED</span>
        <span className="text-slate-700">{fmtDate(a.churn.date)} · {a.churn.reason}{a.churn.note ? ` — ${a.churn.note}` : ""}</span>
        <span className="ml-auto text-xs text-slate-500">{fmtMoney(a.churn.arr, a.churn.currency)} ARR lost · recorded by {a.churn.by}</span>
      </div>}
      {subs.length > 0 && <Card title={`Sub-accounts (${subs.length}) · rollup ${fmtMoney(rollup)} USD`}>
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
      <div className="ad-tabs" role="tablist" aria-label="Account sections">
        {[["overview", "Overview"], ["Invoices", "Invoices"], ["Purchase orders", "Purchase orders"]].filter(([k]) => !ro || k === "overview").map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} data-account-tab={k}
          className="ad-tab" onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === "Invoices" && <Card title="Invoices"><AccountInvoices account={a} user={user} /></Card>}
      {tab === "Purchase orders" && <Card title="Purchase orders"><AccountPurchaseOrders account={a} user={user} /></Card>}
      {tab === "overview" && <div data-overview className="ad-cols">
        <div className="ad-col-l">
          <AdCard title="Activity timeline" n={`(${acts.length})`}>
            {acts.length === 0 && <div className="ad-empty">No activity yet.</div>}
            {acts.map(x => { const ik = activityIconKey(x.type); return (
              <div key={x.id} data-activity-row className="ad-row !items-start !gap-3.5">
                <span aria-hidden="true" data-activity-icon={ik} className="ad-act-ico">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={ACTIVITY_ICON[ik]} /></svg></span>
                <div className="min-w-0 flex-auto">
                  <div className="ad-t" style={{ overflowWrap: "anywhere" }}><span data-activity-type className="ad-act-type">{x.type}</span><span>{x.summary}</span></div>
                  {x.details && <div className="ad-body">{x.details}</div>}
                  {x.attachments && x.attachments.length > 0 && <div className="mt-1"><AttachmentLinks items={x.attachments} /></div>}
                </div>
                <span className="ad-sm flex-none pt-0.5">{fmtDate(x.date)}</span>
                {!ro && <button title="Edit activity" aria-label="Edit activity" className="ad-ico" onClick={() => setForm({ t: "editActivity", item: x })}>✎</button>}
              </div>); })}
          </AdCard>
          <AdCard title="Opportunities" n={`(${opps.filter(o => !["Won", "Lost"].includes(o.stage)).length} open)`}>
            {opps.length === 0 && <div className="ad-empty">None.</div>}
            {opps.map(o => (
              <div key={o.id} className={`ad-row flex-wrap ${["Won", "Lost"].includes(o.stage) ? "opacity-60" : ""}`}>
                <span className="ad-chip">{o.type}</span>
                <b className="flex-auto tabular-nums" style={{ color: "var(--d-fg)" }}>{fmtMoney(o.value, a.currency)}</b>
                {ro ? <span className="ad-pill">{o.stage}</span> : <select value={o.stage} aria-label="Opportunity stage"
                  disabled={!!a.churn} title={a.churn ? "Account is churned — reactivate it to work opportunities" : undefined}
                  className="ad-opp-stage disabled:opacity-50" onChange={e => {
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
                  }}>
                  {["Discovery", "Proposal", "Negotiation", "Stalled", "Won", "Lost"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>}
                <span className="ad-xs">close {fmtDate(o.closeDate)}</span>
              </div>
            ))}
          </AdCard>
          <RevenueHistoryCard a={a} />
          {(a.audit || []).length > 0 && <ChangeHistoryCard a={a} />}
        </div>
        <div className="ad-col-r">
          {(() => { const iu = daysSince(a.inputsUpdatedAt || a.startDate); const sev = iu >= 45 ? "red" : iu >= 30 ? "amber" : undefined;
            const pts = [...(a.history || []), { d: iso(Date.now()), s: a.score }];
            return (
            <AdCard title="Health breakdown" right={<span data-sev={sev} className="ad-stale ml-auto text-right">
              Inputs last updated {iu === 0 ? "today" : iu + "d ago"}{iu >= 30 ? (ro ? " — inputs are stale" : " — refresh via ✎ Update health") : ""}</span>}>
              <div className="ad-spark mt-2"><Sparkline points={pts} w={260} h={44} /></div>
              <div className="mt-1 flex flex-col gap-[11px]">
                {Object.keys(comps).filter(k => k !== "value" || st.settings.weights?.value > 0).map(k => { const rk = riskOf(comps[k]); return <React.Fragment key={k}>
                  <div className="flex flex-col gap-1">
                    <div className="flex text-[13px]"><span style={{ color: "var(--d-label)" }}>{WEIGHT_LABELS[k]}</span><b data-risk={rk} className="ad-bar-n ml-auto tabular-nums">{comps[k]}</b></div>
                    <span data-input-bar data-risk={rk} aria-hidden="true" className="ad-bar"><span style={{ width: `${Math.max(0, Math.min(100, comps[k]))}%` }} /></span>
                  </div>
                  {k === "recency" && st.settings.recencyMix?.enabled && <div data-recency-breakdown className="ml-4 space-y-0.5 text-[11px]" style={{ color: "var(--d-meta)" }}>
                    {recencyBreakdown(a, st.activities, st.settings.recencyMix).filter(b => b.weight > 0).map(b =>
                      <div key={b.type} data-recency-type={b.type} className="flex justify-between">
                        <span>{b.type}</span>
                        <span className="tabular-nums">{b.score} · {b.lastDate ? `last ${daysSince(b.lastDate)}d ago` : "never"}</span>
                      </div>)}
                  </div>}
                </React.Fragment>; })}
              </div>
            </AdCard>); })()}
          <AdCard title="Open tasks" n={`(${tasks.length})`}>
            {tasks.length === 0 && <div className="ad-empty">None open.</div>}
            {tasks.map(t => { const du = daysUntil(t.due); return (
              <div key={t.id}>
                <label data-task-row className="ad-task">
                  {!ro && <input type="checkbox" checked={false} aria-label={`Complete ${t.title}`} onChange={() => dispatch({ type: "TOGGLE_TASK", id: t.id })} />}
                  <span className="min-w-0 flex-auto" style={{ overflowWrap: "anywhere" }}>{t.title}
                    <span className="ad-xs block">{t.owner}{t.owner ? " · " : ""}<span data-task-due data-overdue={du < 0 ? "true" : undefined} className="ad-due">{du < 0 ? `Overdue · ${fmtDate(t.due)}` : du === 0 ? "Today" : fmtDate(t.due)}</span></span></span>
                  {t.priority && <span data-priority data-sev={PRIORITY_SEV[t.priority] || "grey"} className="ad-pill ad-pill-sm">{t.priority}</span>}
                  {!ro && <button title="Edit task" aria-label="Edit task" className="ad-ico" onClick={e => { e.preventDefault(); setForm({ t: "editTask", item: t }); }}>✎</button>}
                </label>
                {t.details && <div className="ad-body ml-[26px] mb-1">{t.details}</div>}
                {t.attachments && t.attachments.length > 0 && <div className="mb-1 ml-[26px]"><AttachmentLinks items={t.attachments} /></div>}
              </div>); })}
          </AdCard>
          <AdCard title="Contacts" n={`(${contacts.length})`}>
            {contacts.map(c => (
              <div key={c.id} data-contact-row className="ad-row !gap-2.5">
                <span aria-hidden="true" data-contact-av className="ad-cav">{initialsOf(c.name)}</span>
                <div className="min-w-0 flex-auto">
                  <div className="ad-t-sm font-semibold" style={{ overflowWrap: "anywhere" }}>{c.name}{c.isChampion && <> <span className="ad-champ">★ Champion</span></>}</div>
                  <div className="ad-xs truncate" title={[c.role, c.email].filter(Boolean).join(" · ")}>{[c.role, c.email].filter(Boolean).join(" · ")}</div>
                </div>
                {c.sentiment && <span data-sent={c.sentiment} className="ad-sent">{c.sentiment}</span>}
                {!ro && <button title="Edit contact" aria-label="Edit contact" data-edit-contact={c.id} className="nm-btn ad-ico" onClick={() => setForm({ t: "editContact", item: c })}>✎</button>}
                {!ro && <button title="Delete contact" aria-label="Delete contact" data-delete-contact={c.id} data-danger className="nm-btn ad-ico" onClick={() => setConfirmContact(c)}>🗑</button>}
              </div>
            ))}
          </AdCard>
        </div>
      </div>}
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
    </div>
  );
}

