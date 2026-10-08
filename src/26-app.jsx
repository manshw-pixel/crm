/* --------------------------------- App --------------------------------- */
const NavIcon = ({ children }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">{children}</svg>
);
const NAV_ICONS = {
  Dashboard: <NavIcon><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></NavIcon>,
  Tasks: <NavIcon><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></NavIcon>,
  Accounts: <NavIcon><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></NavIcon>,
  Renewals: <NavIcon><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></NavIcon>,
  Settings: <NavIcon><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></NavIcon>,
};
/* --------------------------- command palette --------------------------- */
/* case-insensitive subsequence match: "nrw" matches "Northwind" */
function subseqMatch(q, text) {
  q = q.toLowerCase(); text = text.toLowerCase();
  if (!q) return true;
  let i = 0;
  for (const ch of text) { if (ch === q[i]) i++; if (i === q.length) return true; }
  return false;
}
const PALETTE_ACTIONS = [
  { key: "activity", label: "Log activity" }, { key: "task", label: "Add task" },
  { key: "renewal", label: "Complete renewal" }, { key: "health", label: "Update health" },
  { key: "edit", label: "Edit account" },
];
function CommandPalette({ open, onClose, accounts, user, go }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  useEffect(() => { if (open) { setQ(""); setSel(0); } }, [open]);
  if (!open) return null;
  const views = (user.role === "admin" ? VIEWS : VIEWS.filter(v => v !== "Settings"))
    .filter(v => subseqMatch(q, "go to " + v))
    .map(v => ({ type: "view", id: "v-" + v, label: `Go to ${v}`, run: () => go(v) }));
  const prefix = t => t.toLowerCase().startsWith(q.toLowerCase());
  const accts = accounts.filter(a => subseqMatch(q, a.name))
    .sort((a, b) => (prefix(b.name) - prefix(a.name)) || a.name.localeCompare(b.name))
    .map(a => ({ type: "account", id: a.id, label: a.name + (a.churn ? " · churned" : ""), acct: a, run: () => go("Accounts", a.id) }));
  const rows = (q ? [...accts, ...views] : [...views, ...accts]).slice(0, 12);
  // contextual actions expand under the top account match (only when it leads the list)
  const list = [];
  rows.forEach((r, idx) => {
    list.push(r);
    if (idx === 0 && r.type === "account") {
      PALETTE_ACTIONS.filter(x => !(r.acct.churn && x.key === "renewal")).forEach(x =>
        list.push({ type: "action", id: r.id + "-" + x.key, label: "↳ " + x.label, run: () => go("Accounts", r.acct.id, x.key) }));
    }
  });
  const cur = Math.min(sel, Math.max(list.length - 1, 0));
  const onKey = e => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); if (!list.length) return; setSel((cur + 1) % list.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (!list.length) return; setSel((cur - 1 + list.length) % list.length); }
    else if (e.key === "Enter" && list.length) { e.preventDefault(); list[cur].run(); onClose(); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-scrim/40 pt-[15vh]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="nm w-full max-w-lg p-3" onClick={e => e.stopPropagation()}>
        <Input autoFocus placeholder="Type a view or account…" value={q}
          onChange={e => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey} className="w-full" />
        <div className="mt-2 max-h-80 overflow-y-auto">
          {list.length === 0 && <div className="px-2 py-1.5 text-sm text-slate-500">No results</div>}
          {list.map((it, i) => (
            <div key={it.id} onClick={() => { it.run(); onClose(); }} onMouseEnter={() => setSel(i)}
              className={`cursor-pointer rounded px-2 py-1.5 text-sm ${it.type === "action" ? "pl-6 " : ""}${i === cur ? "bg-indigo-100 text-indigo-800" : "text-slate-800"}`}>
              {it.label}
            </div>
          ))}
        </div>
        <div className="mt-2 px-2 text-[11px] text-slate-500">↑↓ navigate · Enter select · Esc close</div>
      </div>
    </div>
  );
}
function SyncStatus() {
  const [s, setS] = useState(() => writeQueue.queueState());
  useEffect(() => { window.__onQueueChange = setS; return () => { window.__onQueueChange = null; }; }, []);
  if (s.status === "saved") return <span data-sync-status="saved" className="text-xs text-slate-500">Saved</span>;
  if (s.status === "saving") return <span data-sync-status="saving" className="text-xs text-slate-500">Saving…</span>;
  // Deliberately persistent. A toast scrolls away; an unsaved change must not. This is also
  // the first honest answer to the observability gap -- an error state that STAYS on screen.
  return <span data-sync-status="error" className="nm-inset px-2 py-1 text-xs font-medium text-rose-700"
    title="Your last change could not be saved and was rolled back. Check your connection and try again.">
    Not saved</span>;
}
const VIEWS = ["Dashboard", "Tasks", "Accounts", "Renewals", "Settings"];
// Catches render/lifecycle errors in the view area only, so a crash costs one screen
// instead of the session. Does NOT catch errors in event handlers or async callbacks --
// those already route through the try/catch blocks and the error toast.
class ViewBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null, attempt: 0 }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error("View crashed:", this.props.view, error, info);
    reportError("crash", error, { view: this.props.view });
  }
  render() {
    // Fragment, not a div: the views are laid out by their parent, and injecting a wrapper
    // element would change that layout. The key is still what remounts the subtree on retry.
    if (!this.state.error) return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    return (
      <div data-viewerror className="nm m-4 p-6" role="alert">
        <h2 className="mb-2 text-sm font-bold text-rose-700">Something went wrong in {this.props.view}</h2>
        <p className="mb-1 text-xs text-slate-600">This view couldn't be displayed. Your data is safe — nothing was changed.</p>
        <p className="mb-4 font-mono text-[11px] text-slate-500">{String(this.state.error?.message || this.state.error)}</p>
        <button className="nm-btn px-3 py-1.5 text-xs font-bold text-indigo-600"
          onClick={() => this.setState(s => ({ error: null, attempt: s.attempt + 1 }))}>Try again</button>
      </div>
    );
  }
}

function App({ user, onBackToClients }) {
  const theme = useTheme();
  const toast = useToast();
  // Platform admins can switch between workspaces, so they are shown which one they are in.
  const [orgName, setOrgName] = useState("");
  useEffect(() => {
    if (!user.platform_admin || !user.org_id) return;
    sb.from("orgs").select("name").eq("id", user.org_id).single().then(({ data }) => data && setOrgName(data.name));
  }, [user.org_id, user.platform_admin]);
  // Client limits: every member reads their own org row (orgs_select), not just platform admins.
  useEffect(() => {
    // Reset first so a platform admin switching clients never keeps the previous client's limit,
    // and ignore a slow response that lands after the org changed again.
    ORG_LIMITS.maxAccounts = null; ORG_LIMITS.loaded = false;
    if (!user.org_id) return;
    let cancelled = false;
    sb.from("orgs").select("max_accounts").eq("id", user.org_id).single()
      .then(({ data }) => { if (cancelled) return; ORG_LIMITS.maxAccounts = data?.max_accounts ?? null; ORG_LIMITS.loaded = true; })
      .catch(() => { if (!cancelled) ORG_LIMITS.loaded = true; }); // a failed read is treated as Unlimited, as before
    return () => { cancelled = true; };
  }, [user.org_id]);
  const views = user.role === "admin" ? VIEWS : VIEWS.filter(v => v !== "Settings");
  const [st, setSt] = useState(emptyData);
  const [loaded, setLoaded] = useState(false);
  // a failed first load falls back to rendering the (empty) views, as before the skeleton existed
  const [loadFailed, setLoadFailed] = useState(false);
  const [view, setView] = useState("Dashboard");
  const [acctId, setAcctId] = useState(null);
  const [acctFilter, setAcctFilter] = useState(null); // {risk, showChurned} applied to AccountList on dashboard card click
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingForm, setPendingForm] = useState(null); // form to auto-open on next AccountDetail mount (from palette)
  // The five keys below are supplied explicitly on every card click because AccountList
  // now applies only the keys it actually receives. Before saved segments existed the
  // effect read them as `initialFilter.risk || "All"`, so an absent key meant "reset";
  // spelling them out here preserves that exact behavior -- a card means "show me this
  // slice", not "add to whatever was already filtered". `q`/`tier`/`csm`/`renew`/`sort`
  // are deliberately omitted: they were never reset by a card and must survive it.
  const openAccounts = filter => {
    setView("Accounts"); setAcctId(null);
    setAcctFilter({ risk: "All", showChurned: false, onlyChurned: false, billing: "All", qbrDue: false, ...(filter || {}), t: Date.now() });
  };
  // Picking "Accounts" from the sidebar (or its keyboard shortcut) means "show me
  // everything", not "show me whatever dashboard card I last clicked". Unlike a card,
  // this clears every filter key including the typed `q` and any tier/csm/renew choice.
  const resetAccounts = () => {
    setView("Accounts"); setAcctId(null);
    setAcctFilter({ q: "", tier: "All", risk: "All", csm: "All", renew: "All",
      billing: "All", showChurned: false, onlyChurned: false, qbrDue: false, t: Date.now() });
  };
  const searchRef = useRef();
  const dispatch = useCallback(action => setSt(prev => {
    const next = reducer(prev, action);
    if (action.type !== "REPLACE") persist(action, next, prev);
    return next;
  }), []);
  useEffect(() => { window.__store = { getState: () => st, dispatch }; });
  useEffect(() => { window.__openAccounts = openAccounts; });
  useEffect(() => { window.__snapshotFor = snapshotFor; }, []);
  const refetch = useCallback(() => fetchAll()
    .then(s => { setSt(s); setLoaded(true); })
    .catch(e => {
      console.error(e);
      setLoadFailed(true);
      reportError("load_failed", e, { where: "fetchAll" });
      toast({ text: "Could not load shared data: " + e.message, tone: "error" });
    }), []);
  useEffect(() => { refetch(); }, [refetch]);
  // Read by writeQueue for rollback: when a write permanently fails, it resyncs local state
  // to the server by calling this rather than trying to invert the reducer (see the write
  // queue's comment in crm.html for why refetch is the correct rollback).
  useEffect(() => { window.__refetch = refetch; }, [refetch]);
  useEffect(() => { // errors that never reach a React boundary
    const onErr = e => reportError("crash", e.error || e.message, { where: "window.onerror" });
    const onRej = e => reportError("crash", e.reason, { where: "unhandledrejection" });
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);
  useEffect(() => { // live updates from teammates: debounce, then refetch everything (data is small)
    let timer = null;
    const fire = () => {
      // Defer while our own writes are in flight. A refetch mid-queue replaces local state
      // with a server view that does not contain them yet, so the user's edit visibly
      // vanishes and then comes back.
      if (writeQueue.queueState().pending > 0) { timer = setTimeout(fire, 300); return; }
      refetch();
    };
    const ch = sb.channel("crm-live").on("postgres_changes", { event: "*", schema: "public" },
      () => { clearTimeout(timer); timer = setTimeout(fire, 800); }).subscribe();
    return () => { clearTimeout(timer); sb.removeChannel(ch); };
  }, [refetch]);
  useEffect(() => {
    const h = e => {
      if (paletteOpen) return; // palette modal owns the keyboard while open
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "/") { e.preventDefault(); resetAccounts(); setTimeout(() => searchRef.current?.focus(), 50); }
      const i = "12345".indexOf(e.key);
      if (i >= 0 && i < views.length) { if (views[i] === "Accounts") resetAccounts(); else { setView(views[i]); setAcctId(null); } }
      if (e.key === "Escape") setAcctId(null);
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [paletteOpen]);
  useEffect(() => { // Ctrl/Cmd+K toggles the command palette from anywhere, incl. inputs
    const h = e => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(o => !o); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);
  const scored = useMemo(() => st.accounts.map(a => {
    const score = healthScore(a, st.activities, st.settings.weights, st.settings);
    return { ...a, score, risk: riskOf(score), flags: flagsFor(a, st.activities, score), arrUSD: toUSD(a.arr, a.currency, st.settings.rates) };
  }), [st]);
  // Record today's health baseline once per session. This is the ONLY writer of
  // health_snapshots: the scoring formula lives here in JS and must stay the single source
  // of truth, so SQL is given finished numbers rather than the inputs to recompute from.
  //
  // Once per session, not once per render: `scored` re-computes on every account edit, and
  // a write per edit would be hundreds of pointless round trips for a value that is keyed
  // by day anyway. The upsert makes a second write harmless, not merely tolerable.
  const healthRecorded = React.useRef(false);
  React.useEffect(() => {
    if (!loaded || healthRecorded.current || !user || !scored.length) return;
    const payload = scored.map(a => ({ accountId: a.id, score: Math.round(a.score) }));
    if (typeof window !== "undefined") {
      // Test seam: the suite asserts on what was sent without a live database.
      window.__recordHealthCalls = (window.__recordHealthCalls || []).concat([payload]);
    }
    // Deliberately NOT writeQueue.enqueue. A baseline is advisory: losing today's row costs
    // one day of drop-detection sensitivity, whereas putting it in the serial write queue
    // would delay real user edits behind it.
    try {
      const p = sb.rpc("record_health", { p_scores: payload });
      // supabase-js REJECTS on network/CORS and RESOLVES { error } otherwise. Swallow both:
      // a failed baseline must never surface as a user-visible error. Only the SUCCESS path
      // marks the ref, so a failure leaves healthRecorded.current false and this effect can
      // still fire again -- but effects run on DEPENDENCY CHANGE, not on every render, and
      // once `loaded` is true the only dep left that can change is `scored.length`. That
      // retries the baseline write after an account is added or deleted, and only then: a
      // session that only edits existing accounts, or only reads, never touches
      // scored.length and so never retries after a failed load.
      if (p && p.then) p.then(() => { healthRecorded.current = true; }, () => {});
      else healthRecorded.current = true;
    } catch (e) { /* same reasoning */ }
  }, [loaded, user, scored.length]);
  useEffect(() => { // one aggregate snapshot per calendar month (whole book) for trend lines
    if (!loaded || !scored.length) return;
    const month = iso(Date.now()).slice(0, 7);
    const snaps = st.settings.snapshots || [];
    // re-take this month's snapshot once if it predates forecast recording
    if (snaps.some(s => s.month === month && s.commit90 !== undefined)) return;
    const act = scored.filter(a => !a.churn);
    const r = retentionStats(scored, st.settings.rates);
    const counts = { Green: 0, Yellow: 0, Red: 0 };
    act.forEach(a => counts[a.risk]++);
    const due90 = act.filter(a => { const d = daysUntil(a.renewalDate); return d >= 0 && d <= 90; });
    const s90 = list => Math.round(list.reduce((s, a) => s + a.arrUSD, 0));
    dispatch({ type: "SET_SNAPSHOTS", snapshots: [...snaps.filter(s => s.month !== month),
      { month, totalARR: Math.round(act.reduce((s, a) => s + a.arrUSD, 0)), accounts: act.length,
        nrr: r.nrr, grr: r.grr, churnedARR: Math.round(r.churnedARR), ...counts,
        due90: s90(due90), commit90: s90(due90.filter(a => renewalStageOf(a) === "Committed")),
        atRisk90: s90(due90.filter(a => renewalStageOf(a) === "At risk")), due90Count: due90.length }].slice(-24) });
  }, [loaded, scored]);
  useEffect(() => { // auto-create renewal playbook tasks when an account is within 90d of renewal
    if (!loaded) return;
    const pb = playbookOf(st.settings);
    if (!pb.length) return;
    st.accounts.forEach(a => {
      // no lower bound on daysUntil: accounts already past renewal still seed (spec: include overdue)
      if (a.churn || daysUntil(a.renewalDate) > 90 || a.playbookSeededFor === a.renewalDate) return;
      const items = pb.filter(p => p.title.trim()).map(p => ({
        id: `pb-${a.id}-${a.renewalDate}-${p.id}`, accountId: a.id, playbook: true, renewalFor: a.renewalDate,
        title: "▶ " + p.title, due: isoMinus(a.renewalDate, p.offsetDays),
        priority: p.priority, status: "Open", owner: a.csm || "" }));
      if (items.length) dispatch({ type: "SEED_PLAYBOOK", id: a.id, seededFor: a.renewalDate, items });
    });
  }, [loaded, st.accounts, st.settings.playbook]);
  useEffect(() => { // auto: detect health-band crossings, seed per-band playbook tasks
    if (!loaded) return;
    const today = iso(Date.now());
    const hpb = healthPlaybookOf(st.settings);
    scored.forEach(a => {
      if (a.churn) return;
      const cur = a.risk;                       // live band from score
      const prev = a.healthBand;
      if (prev === undefined) {                 // first run: initialize silently
        dispatch({ type: "SEED_HEALTH_PLAYBOOK", id: a.id, healthBand: cur,
          healthPlaybookBand: a.healthPlaybookBand, event: null, items: [] });
        return;
      }
      if (cur === prev) return;                 // no crossing
      const worsening = BAND_RANK[cur] > BAND_RANK[prev];
      const event = { date: today, from: prev, to: cur };
      let items = [], pbBand = a.healthPlaybookBand;
      if (worsening && (cur === "Yellow" || cur === "Red") &&
          (pbBand === undefined || BAND_RANK[cur] > BAND_RANK[pbBand])) {
        // Task shape mirrors HealthBackfillCard's construction — see the cross-reference
        // comment there. Id shape is load-bearing for both dedup guards, keep them in sync.
        items = (hpb[cur] || []).filter(s => s.title.trim()).map(s => ({
          id: `hpb-${a.id}-${cur}-${today}-${s.id}`, accountId: a.id, healthPlaybook: true,
          healthBand: cur, healthFor: today, title: "♥ " + s.title,
          due: isoPlus(today, s.dueDays), priority: s.priority, status: "Open", owner: a.csm || "" }));
        pbBand = cur;
      } else if (!worsening && cur === "Green") {
        pbBand = undefined;                     // recovered: allow re-seed on next decline
      }
      dispatch({ type: "SEED_HEALTH_PLAYBOOK", id: a.id, healthBand: cur,
        healthPlaybookBand: pbBand, event, items });
    });
  }, [loaded, scored, st.settings.healthPlaybook]);
  const [scopeSel, setScopeSel] = useState(null);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("crm-nav") === "1"; } catch (e) { return false; } });
  useEffect(() => { try { localStorage.setItem("crm-nav", collapsed ? "1" : "0"); } catch (e) {} }, [collapsed]);
  // below lg the sidebar is an overlay drawer; at lg+ it is the fixed rail it always was
  const [mobileNav, setMobileNav] = useState(false);
  const myCount = scored.filter(a => a.csm === user.name).length;
  const scope = scopeSel ?? (user.role === "admin" ? "all" : myCount > 0 ? "mine" : "all"); // admins default to the whole book
  const visible = scope === "mine" ? scored.filter(a => a.csm === user.name) : scored; // includes churned
  const active = visible.filter(a => !a.churn);
  const openAccount = (id, form) => { setView("Accounts"); setAcctId(id); if (form) setPendingForm(form); };
  const [notifOpen, setNotifOpen] = useState(false);
  const bellRef = useRef(null);
  const [bellBottom, setBellBottom] = useState(64);
  // measure where the bell sits each time the panel opens (the header wraps on phones), and
  // close on Escape
  useEffect(() => {
    if (!notifOpen) return;
    if (bellRef.current) setBellBottom(Math.round(bellRef.current.getBoundingClientRect().bottom));
    const onKey = e => { if (e.key === "Escape") setNotifOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notifOpen]);
  const renewalsDue = active
    .filter(a => { const d = daysUntil(a.renewalDate); return d >= 0 && d <= 30; })
    .sort((x, y) => daysUntil(x.renewalDate) - daysUntil(y.renewalDate));
  // notification bell: account renewals (≤30d) + Contract documents expiring within EXPIRY_WARN_DAYS
  // or expired within the last EXPIRED_GRACE_DAYS + health drops (≤30d). Every source is windowed on
  // both sides, so alerts age out on their own rather than piling up in the bell forever.
  const notifKey = "notifRead_" + user.name;
  const [notifRead, setNotifRead] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem(notifKey) || "[]")); } catch { return new Set(); } });
  const [showRead, setShowRead] = useState(false);
  const alerts = [
    ...renewalsDue.map(a => ({ id: `renewal-${a.id}-${a.renewalDate}`, accountId: a.id, name: a.name, sub: "Account renewal", date: a.renewalDate, days: daysUntil(a.renewalDate) })),
    ...active.flatMap(a => (a.documents || [])
      .filter(d => { if (d.category !== "Contract" || !d.expiryDate) return false;
        const days = daysUntil(d.expiryDate); return days <= EXPIRY_WARN_DAYS && days >= -EXPIRED_GRACE_DAYS; })
      .map(d => ({ id: `contract-${a.id}-${d.id}-${d.expiryDate}`, accountId: a.id, name: a.name, sub: `Contract: ${d.title || d.name}`, date: d.expiryDate, days: daysUntil(d.expiryDate) }))),
    ...scored.flatMap(a => (a.healthEvents || [])
      .filter(e => BAND_RANK[e.to] > BAND_RANK[e.from] && daysSince(e.date) <= 30)
      .map(e => ({ id: `health-${a.id}-${e.date}-${e.to}`, accountId: a.id, name: a.name,
        sub: `Health dropped to ${e.to}`, date: e.date, days: -daysSince(e.date) }))),
  ].sort((x, y) => x.days - y.days);
  const alertIds = new Set(alerts.map(a => a.id));
  // Prune on write: ids for alerts that have aged out would otherwise accumulate in localStorage
  // forever. Dropping them also means a renewed contract (new expiryDate ⇒ new id) resurfaces unread.
  const markNotifRead = id => setNotifRead(prev => {
    const n = new Set([...prev, id].filter(x => x === id || alertIds.has(x)));
    try { localStorage.setItem(notifKey, JSON.stringify([...n])); } catch {}
    return n;
  });
  const unreadCount = alerts.filter(a => !notifRead.has(a.id)).length;
  const readCount = alerts.length - unreadCount;
  const shownAlerts = showRead ? alerts : alerts.filter(a => !notifRead.has(a.id));
  return (
    <div className="flex min-h-screen">
      {mobileNav && <div data-nav-backdrop className="fixed inset-0 z-20 bg-scrim/30 lg:hidden" onClick={() => setMobileNav(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-30 flex flex-col border-r border-slate-200 bg-white transition-all ${mobileNav ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 ${collapsed ? "w-14" : "w-52"}`}>
        <div className={`flex items-center pb-4 pt-5 ${collapsed ? "justify-center px-0" : "justify-between px-5"}`}>
          {!collapsed && <span className="text-lg font-extrabold tracking-tight text-slate-900">One<span className="text-indigo-600">Vio</span></span>}
          <button title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed(c => !c)}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {collapsed ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}
            </svg>
          </button>
        </div>
        <nav aria-label="Main" className={`flex-1 space-y-0.5 ${collapsed ? "px-2" : "px-3"}`}>
          {views.map(v => (
            <button key={v} title={v} aria-label={v} aria-current={view === v ? "page" : undefined}
              onClick={() => { setMobileNav(false); if (v === "Accounts") resetAccounts(); else { setView(v); setAcctId(null); } }}
              className={`flex w-full items-center rounded-lg py-2 text-sm font-medium ${collapsed ? "justify-center px-0" : "gap-2.5 px-3"} ${view === v ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
              {NAV_ICONS[v]}{!collapsed && <span className="flex-1 text-left">{v}</span>}
            </button>
          ))}
        </nav>
        <div className={`border-t border-slate-200 ${collapsed ? "p-2" : "p-4"}`}>
          {!collapsed && <>
            {user.platform_admin && <div data-current-org className="mb-1 flex items-center gap-1 truncate rounded bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-700" title="You are viewing this workspace as platform admin">
              <button data-back-to-clients className="hover:underline" onClick={onBackToClients}>← Clients</button>
              <span className="truncate">· {orgName || "…"}</span>
            </div>}
            <div className="truncate text-sm font-semibold text-slate-900">{user.name}</div>
            <div className="text-xs text-slate-500">{user.role}{loaded ? "" : " · loading…"}</div>
          </>}
          {/* Light -> Dark -> Auto. Settings is admin-only, so this is the control most users
              have and it must reach all three choices. */}
          <button data-theme-toggle onClick={() => theme.choose(nextChoice(theme.choice))}
            aria-label={`Theme: ${{ light: "Light", dark: "Dark", auto: "Auto" }[theme.choice]}. Switch to ${{ light: "Light", dark: "Dark", auto: "Auto" }[nextChoice(theme.choice)]}`}
            title={`Theme: ${{ light: "Light", dark: "Dark", auto: "Auto" }[theme.choice]}`}
            className={`nm-btn text-xs font-semibold text-slate-600 ${collapsed ? "mb-2 flex h-9 w-9 items-center justify-center" : "mt-3 flex w-full items-center justify-center gap-1.5 px-3 py-1.5"}`}>
            <span aria-hidden="true">{{ light: "☀", dark: "☾", auto: "A" }[theme.choice]}</span>
            {!collapsed && <span>{{ light: "Light", dark: "Dark", auto: "Auto" }[theme.choice]} theme</span>}
          </button>
          <button title={`Sign out (${user.name})`} className={`nm-btn text-xs font-semibold text-slate-600 ${collapsed ? "flex h-9 w-9 items-center justify-center" : "mt-2 w-full px-3 py-1.5"}`}
            onClick={signOut}>{collapsed ? "⎋" : "Sign out"}</button>
        </div>
      </aside>
      <main className={`${collapsed ? "lg:ml-14" : "lg:ml-52"} min-w-0 flex-1 px-4 py-4 transition-all lg:px-6 lg:py-5`}>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button data-nav-toggle aria-label="Open menu" onClick={() => setMobileNav(true)}
          className="nm-btn flex h-9 w-9 items-center justify-center text-slate-600 lg:hidden">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg>
        </button>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{view === "Accounts" && acctId
          ? <><button data-crumb-accounts className="text-slate-500 hover:text-indigo-600 hover:underline" onClick={() => setAcctId(null)}>Accounts</button><span className="mx-1.5 text-slate-400">›</span>{st.accounts.find(x => x.id === acctId)?.name || "Account"}</>
          : view}</h1>
        {view !== "Tasks" && view !== "Settings" && <div data-scope-toggle className="nm-inset flex items-center gap-0.5 !rounded-lg p-0.5 lg:ml-3">
          {[["mine", `My book${myCount ? ` (${myCount})` : ""}`], ["all", "All"]].map(([k, label]) => (
            <button key={k} onClick={() => setScopeSel(k)}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${scope === k ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{label}</button>
          ))}
        </div>}
        <div className="ml-1"><SyncStatus /></div>
        <div className="relative ml-1">
          <button data-bell ref={bellRef} onClick={() => setNotifOpen(o => !o)} title="Renewal & contract alerts"
            aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={notifOpen}
            className="nm-btn relative flex h-9 w-9 items-center justify-center text-slate-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
            {unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">{unreadCount}</span>}
          </button>
          {/* Phones: a full-width sheet fixed just under the bell, wherever the header has
              wrapped it -- anchored to the bell (absolute right-0) it opened off the left edge
              once the bell dropped to the second row (x = -231 at 360px). sm+: unchanged
              dropdown. Both cap their height and scroll. The backdrop closes on a tap outside. */}
          {notifOpen && <div data-notif-backdrop className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />}
          {notifOpen && (
            <div data-notif-panel style={{ "--bell-bottom": `${bellBottom}px` }}
              className="nm fixed inset-x-3 top-[calc(var(--bell-bottom)+8px)] z-20 max-h-[calc(100dvh-var(--bell-bottom)-20px)] overflow-y-auto p-3 sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:max-h-[70vh] sm:w-80">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-xs font-semibold text-slate-700">Renewals, contracts &amp; health</span>
                {unreadCount > 0 && <button className="text-[11px] font-semibold text-indigo-600 hover:underline" onClick={() => alerts.forEach(a => markNotifRead(a.id))}>Mark all read</button>}
              </div>
              {shownAlerts.length === 0 && <div className="px-2 py-2 text-sm text-slate-500">
                {alerts.length === 0 ? "Nothing due soon. 🎉" : "All caught up. 🎉"}
              </div>}
              {shownAlerts.map(a => { const read = notifRead.has(a.id); return (
                <button key={a.id} onClick={() => { markNotifRead(a.id); setNotifOpen(false); openAccount(a.accountId); }}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${read ? "bg-transparent" : "bg-indigo-500"}`} />
                    <span className="min-w-0">
                      <span className={`block truncate ${read ? "font-medium text-slate-500" : "font-semibold text-slate-900"}`}>{a.name}</span>
                      <span className="block truncate text-[11px] text-slate-500">{a.sub}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs">
                    <span className="text-slate-700">{fmtDate(a.date)}</span>
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${a.days <= 7 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{a.days < 0 ? "expired" : a.days + "d"}</span>
                  </span>
                </button>
              ); })}
              {readCount > 0 && (
                <div className="mt-1 border-t border-slate-100 px-2 pt-1.5">
                  <button className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:underline"
                    onClick={() => setShowRead(s => !s)}>
                    {showRead ? "Hide read" : `Show ${readCount} read`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <ViewBoundary key={view} view={view}>
        {!loaded && !loadFailed ? <LoadingSkeleton view={view} /> : <>
        {view === "Dashboard" && <Dashboard st={st} scored={active} all={visible} allAccounts={scored} scope={scope} setScopeSel={setScopeSel} myCount={myCount} renewalsDue={renewalsDue} user={user} dispatch={dispatch} openAccount={openAccount} openAccounts={openAccounts} />}
        {view === "Tasks" && <TasksView st={st} scored={scored} dispatch={dispatch} user={user} openAccount={openAccount} />}
        {view === "Accounts" && (acctId
          ? <AccountDetail st={st} scored={scored} id={acctId} dispatch={dispatch} back={() => setAcctId(null)} user={user} team={st.team} openAccount={openAccount} initialForm={pendingForm} clearInitialForm={() => setPendingForm(null)} />
          : <AccountList scored={visible} allAccounts={st.accounts} openAccount={openAccount} searchRef={searchRef} dispatch={dispatch} team={st.team} initialFilter={acctFilter} user={user} settings={st.settings} />)}
        {view === "Renewals" && <Renewals scored={active} openAccount={openAccount} dispatch={dispatch} allBook={scored} rates={st.settings.rates} snapshots={st.settings.snapshots || []} tasks={st.tasks} user={user} />}
        {view === "Settings" && user.role === "admin" && <Settings st={st} dispatch={dispatch} user={user} scored={scored} theme={theme} />}
        </>}
      </ViewBoundary>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} accounts={scored} user={user}
        go={(v, id, form) => { if (id) openAccount(id, form); else { setView(v); setAcctId(null); } }} />
      <Copyright />
      </main>
    </div>
  );
}
// The platform admin's home org (OneVio). Disabling it is allowed, behind an extra warning.
const HOME_ORG = "00000000-0000-0000-0000-000000000001";
// Console routing for the platform admin. Session-scoped on purpose: every new sign-in
// starts at the console. Storage can throw (private mode, blocked site data); the fallback
// is the console, which is safe.
const IN_CLIENT_KEY = "onevio.inClient";
const inClientGet = () => { try { return sessionStorage.getItem(IN_CLIENT_KEY) === "1"; } catch { return false; } };
const inClientSet = on => { try { on ? sessionStorage.setItem(IN_CLIENT_KEY, "1") : sessionStorage.removeItem(IN_CLIENT_KEY); } catch {} };
function Root() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [orgDisabled, setOrgDisabled] = useState(false);
  const [inClient, setInClient] = useState(inClientGet);
  const [recovering, setRecovering] = useState(IS_RECOVERY);
  useEffect(() => {
    if (!CONFIGURED) return;
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = sb.auth.onAuthStateChange((e, s) => { if (e === "SIGNED_OUT") { inClientSet(false); setInClient(false); } setSession(s); });
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) { setProfile(null); return; }
    sb.from("profiles").select("id,name,role,disabled,org_id,platform_admin").eq("id", session.user.id).single()
      // Same reasoning as the saveError helper: profile loading runs BEFORE ToastProvider
      // wraps App, so window.__toast is genuinely undefined here and alert is the only
      // channel left. Deliberately kept.
      .then(async ({ data, error }) => {
        if (error) return window.__toast?.({ text: "Could not load your profile: " + error.message, tone: "error" }) ?? alert("Could not load your profile: " + error.message);
        // A disabled client's users are already locked out by RLS (org_enabled()). Resolve
        // the flag BEFORE setProfile so the suspended screen never flashes an empty app.
        // orgs_select does not depend on is_active(), so this read still works for them.
        let suspended = false;
        if (data.org_id && !data.platform_admin) {
          const { data: o } = await sb.from("orgs").select("disabled").eq("id", data.org_id).single();
          suspended = !!o?.disabled;
        }
        CURRENT_ORG = data.org_id; setOrgDisabled(suspended); setProfile(data);
      })
      // A throw (network failure, or the orgs read rejecting) would otherwise leave
      // "Loading profile…" on screen forever with no way out.
      .catch(ex => alert("Could not load your profile: " + (ex?.message || ex)));
  }, [session]);
  if (!CONFIGURED) return <SetupScreen />;
  if (!ready) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading…</div>;
  if (!session) return <AuthScreen />;
  // Ahead of the profile load on purpose: setting a new password must not depend on the
  // profiles row resolving, and a disabled user has no business getting this far anyway
  // (the disabled gate below still runs once they are done here).
  if (recovering) return <NewPasswordScreen onDone={() => setRecovering(false)} />;
  if (!profile) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading profile…</div>;
  // The RLS policies are the real boundary -- a disabled user's queries already return
  // nothing. This is the humane surface on top: say what happened instead of rendering an
  // app with no data in it. Deliberately NOT worded "cannot sign in": GoTrue still issues
  // them a token; what they have lost is access.
  if (profile.disabled) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-slate-600">
      <p className="font-semibold text-slate-900">Your access has been removed.</p>
      <p>Ask an administrator to re-enable your account.</p>
      <button className="nm-btn px-3 py-1.5 text-xs font-semibold" onClick={signOut}>Sign out</button>
    </div>
  );
  // The platform admin works from the client console and enters a client explicitly. Ahead
  // of the no-workspace screen: a platform admin with no org of their own still needs the
  // console, since that is where they pick one. Behind the disabled gate, which still wins.
  if (profile.platform_admin && !inClient) return <ToastProvider><ClientConsole me={profile} onEnter={() => setInClient(true)} /></ToastProvider>;
  // Sign-ups that matched no invite land here. RLS already returns them nothing; this
  // says why instead of rendering an empty app.
  if (!profile.org_id) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-slate-600">
      <p className="font-semibold text-slate-900">Your account is not attached to a workspace yet.</p>
      <p>Ask your administrator to invite {profile.name ? "you" : "this email"}.</p>
      <button className="nm-btn px-3 py-1.5 text-xs font-semibold" onClick={signOut}>Sign out</button>
    </div>
  );
  if (orgDisabled) return (
    <div data-org-suspended className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-slate-600">
      <p className="font-semibold text-slate-900">Your organisation's access is suspended.</p>
      <p>Contact your provider to restore it.</p>
      <button className="nm-btn px-3 py-1.5 text-xs font-semibold" onClick={signOut}>Sign out</button>
    </div>
  );
  // Two boundaries, deliberately. The inner per-view one degrades gracefully: a crash in
  // Renewals leaves the nav and every other view usable. This outer one is the backstop --
  // App's own body computes analytics (retentionStats at ~3204), so data that breaks THAT
  // throws before any view renders, and without this the user gets a blank white page.
  return <ToastProvider><ViewBoundary view="the app"><App user={profile} onBackToClients={() => { inClientSet(false); setInClient(false); }} /></ViewBoundary></ToastProvider>;
}
window.__orgLimits = ORG_LIMITS; // test seam: lets tests wait for the org limit to load
window.__health = { bandImpact, windowScore, recencyBreakdown, scoreComponents, healthScore, mergeSettings, ACTIVITY_TYPES, VALUE_ITEMS, parseCsvDate, csvDateOrder, importBillingCSV, isoPlus, addMonths, BAND_RANK, healthPlaybookOf, DEFAULT_HEALTH_PLAYBOOK, backfillCandidates, bucketTasks, filterTasks, parseCSV, importAccountsCSV, accountsCSVText,
  retentionStats, cohortData, churnRows, renewalOutcomeRows, quarterKey, monthsBetween, toUSD, diffRow, writeQueue, reportError, fingerprintOf,
  lastCompletedDecember, arrAsOf, accountRetention, amBookMovement };
ReactDOM.createRoot(document.getElementById("root")).render(<Root />);
